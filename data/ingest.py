"""
STEP 1 — Ingestion
Reads india_air_quality_consolidated.csv, filters to TARGET_CITY (Delhi),
joins lat/lon from location_coords.csv, expands daily rows to hourly,
merges weather data, and writes data/cache/ingested_data.parquet.
"""
import os
import sys
import argparse
import pandas as pd
import requests

# Allow running from project root OR from data/
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from config import (
    CITY_BBOX, CSV_SCHEMA, CSV_DATE_FORMAT, POLLUTANT_COLS,
    CITIES_TO_KEEP, KAGGLE_CSV_PATH, LOCATION_COORDS_PATH, CACHE_DIR,
    TARGET_CITY,
)

os.makedirs(CACHE_DIR, exist_ok=True)


def _normalise_location(s: str) -> str:
    """Strip, lowercase, collapse internal whitespace, remove commas.
    Used for fuzzy-matching location names that may differ in punctuation."""
    return " ".join(s.strip().lower().replace(",", " ").split())


def load_location_coords() -> pd.DataFrame:
    """Load location_coords.csv and build a normalised-key lookup."""
    coords = pd.read_csv(LOCATION_COORDS_PATH)
    # Normalise the join key
    coords["_key"] = (
        coords["city"].str.strip().str.lower()
        + "|"
        + coords["location"].apply(_normalise_location)
    )
    return coords[["_key", "lat", "lon", "confidence"]].drop_duplicates("_key")


def load_historical_aqi(csv_path: str) -> pd.DataFrame:
    """
    Load and normalise the Kaggle India Air Quality CSV.

    Transformations:
      1. Rename columns via CSV_SCHEMA.
      2. Filter to CITIES_TO_KEEP.
      3. Coerce pollutant columns to numeric.
      4. Compute composite pollutant_avg = mean(pm25, pm10, o3, no2) per row.
      5. Parse date string and expand each daily row to 24 hourly timestamps.
      6. Join lat/lon from location_coords.csv on normalised (city, location).
      7. Report coordinate match stats — flag any misses.
    """
    print(f"\n[ingest] Reading CSV: {csv_path}")
    df = pd.read_csv(csv_path)
    print(f"[ingest] Raw shape: {df.shape}  columns: {list(df.columns)}")

    # 1. Rename columns
    rename_map = {v: k for k, v in CSV_SCHEMA.items()}   # csv_col → internal
    df = df.rename(columns=rename_map)
    # After rename: city, station, timestamp, pollutant_avg(=pm25), pm10, o3, no2, so2, co

    # 2. Filter to target city
    if CITIES_TO_KEEP:
        before = len(df)
        df = df[df["city"].isin(CITIES_TO_KEEP)].copy()
        print(f"[ingest] City filter ({CITIES_TO_KEEP}): {before} → {len(df)} rows")
    if df.empty:
        raise ValueError(f"No rows after city filter. CITIES_TO_KEEP={CITIES_TO_KEEP}")

    # 3. Coerce pollutants to numeric
    for col in POLLUTANT_COLS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    if "pollutant_avg" in df.columns:
        df["pollutant_avg"] = pd.to_numeric(df["pollutant_avg"], errors="coerce")

    # 4. Composite pollutant_avg — mean of available cols (PM2.5-primary)
    avail = [c for c in ["pollutant_avg", "pm10", "o3", "no2"] if c in df.columns]
    df["pollutant_avg"] = df[avail].mean(axis=1, skipna=True)
    before = len(df)
    df = df.dropna(subset=["pollutant_avg"])
    dropped = before - len(df)
    if dropped:
        print(f"[ingest] Dropped {dropped} rows with no usable pollutant value.")
    print(f"[ingest] After pollutant coercion: {len(df)} rows")

    # 5. Parse date and expand to 24 hourly rows
    df["_date"] = pd.to_datetime(df["timestamp"], format=CSV_DATE_FORMAT, errors="coerce")
    bad_dates = df["_date"].isna().sum()
    if bad_dates:
        print(f"[ingest] WARNING: {bad_dates} rows with unparseable dates — dropped.")
    df = df.dropna(subset=["_date"])

    print(f"[ingest] Expanding {len(df)} daily rows × 24 hours …")
    hourly_rows = []
    for _, row in df.iterrows():
        base = row["_date"]
        for h in range(24):
            r = row.copy()
            r["timestamp"] = base + pd.Timedelta(hours=h)
            hourly_rows.append(r)
    df = pd.DataFrame(hourly_rows).reset_index(drop=True)
    df = df.drop(columns=["_date"], errors="ignore")
    print(f"[ingest] After hourly expansion: {len(df)} rows")

    # 6. Join lat/lon from location_coords.csv
    coords = load_location_coords()
    df["_key"] = (
        df["city"].str.strip().str.lower()
        + "|"
        + df["station"].apply(_normalise_location)
    )
    before_join = len(df)
    df = df.merge(coords, on="_key", how="left")
    df = df.drop(columns=["_key"], errors="ignore")
    assert len(df) == before_join, "Row count changed during merge — check for duplicate keys in coords CSV"

    # 7. Report match stats
    matched   = df["lat"].notna().sum()
    unmatched = df["lat"].isna().sum()
    match_pct = matched / len(df) * 100
    print(f"\n[ingest] Coordinate join results:")
    print(f"  Matched:   {matched:>7} rows  ({match_pct:.1f}%)")
    print(f"  Unmatched: {unmatched:>7} rows  ({100-match_pct:.1f}%)")

    if unmatched > 0:
        miss_stations = df[df["lat"].isna()]["station"].unique()
        print(f"  ⚠️  Stations with NO coordinates (check location_coords.csv):")
        for s in miss_stations:
            print(f"       - '{s}'")
        # Drop unmatched rows — can't place them on a map
        df = df.dropna(subset=["lat", "lon"])
        print(f"  Dropped unmatched rows. Remaining: {len(df)}")

    print(f"\n[ingest] Final shape from load_historical_aqi: {df.shape}")
    print(f"[ingest] Date range: {df['timestamp'].min()} → {df['timestamp'].max()}")
    return df


def fetch_live_weather(min_lat, min_lon, max_lat, max_lon, start_date, end_date):
    center_lat = (min_lat + max_lat) / 2.0
    center_lon = (min_lon + max_lon) / 2.0
    url = (
        f"https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={center_lat}&longitude={center_lon}"
        f"&start_date={start_date}&end_date={end_date}"
        f"&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m"
    )
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    d = r.json()
    return pd.DataFrame({
        "timestamp":      pd.to_datetime(d["hourly"]["time"]),
        "temperature":    d["hourly"]["temperature_2m"],
        "humidity":       d["hourly"]["relative_humidity_2m"],
        "wind_speed":     d["hourly"]["wind_speed_10m"],
        "wind_direction": d["hourly"]["wind_direction_10m"],
    })


def fetch_osm_road_density(min_lat, min_lon, max_lat, max_lon):
    url = "http://overpass-api.de/api/interpreter"
    q = (
        f"[out:json];\n"
        f'way["highway"]({min_lat},{min_lon},{max_lat},{max_lon});\n'
        f"out count;\n"
    )
    r = requests.get(url, params={"data": q}, timeout=30)
    r.raise_for_status()
    d = r.json()
    if d.get("elements"):
        return int(d["elements"][0].get("tags", {}).get("ways", 0))
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv_path", default=KAGGLE_CSV_PATH)
    parser.add_argument("--live", action="store_true",
                        help="Force refresh from APIs instead of cache.")
    args = parser.parse_args()

    cache_file = os.path.join(CACHE_DIR, "ingested_data.parquet")

    if os.path.exists(cache_file) and not args.live:
        print(f"[ingest] Cache hit: {cache_file}")
        return pd.read_parquet(cache_file)

    # ── AQI ──────────────────────────────────────────────────────────────────
    aqi_df = load_historical_aqi(args.csv_path)

    start_date = aqi_df["timestamp"].min().strftime("%Y-%m-%d")
    end_date   = aqi_df["timestamp"].max().strftime("%Y-%m-%d")

    # ── Weather ───────────────────────────────────────────────────────────────
    print(f"\n[ingest] Fetching weather {start_date} → {end_date} …")
    try:
        weather_df = fetch_live_weather(*CITY_BBOX, start_date, end_date)
        print(f"[ingest] Weather rows: {len(weather_df)}")
    except Exception as e:
        print(f"[ingest] Weather API failed: {e}. Using synthetic fallback.")
        dates = pd.date_range(start=start_date, end=end_date, freq="h")
        weather_df = pd.DataFrame({
            "timestamp":      dates,
            "temperature":    25.0,
            "humidity":       60.0,
            "wind_speed":     10.0,
            "wind_direction": 180.0,
        })

    # ── Road density ──────────────────────────────────────────────────────────
    print("[ingest] Fetching OSM road density …")
    try:
        total_roads = fetch_osm_road_density(*CITY_BBOX)
        print(f"[ingest] OSM road count: {total_roads}")
    except Exception as e:
        print(f"[ingest] OSM failed: {e}. Fallback = 5000.")
        total_roads = 5000

    # ── Merge ─────────────────────────────────────────────────────────────────
    print("\n[ingest] Merging AQI + weather on timestamp_hr …")
    aqi_df["timestamp_hr"]     = aqi_df["timestamp"].dt.floor("h")
    weather_df["timestamp_hr"] = weather_df["timestamp"].dt.floor("h")
    weather_df = weather_df.drop(columns=["timestamp"])

    joined = pd.merge(aqi_df, weather_df, on="timestamp_hr", how="left")
    joined["city_road_density"] = total_roads

    print(f"[ingest] Final joined shape: {joined.shape}")
    print(f"[ingest] Saving to: {cache_file}")
    joined.to_parquet(cache_file, index=False)
    print("[ingest] ✓ Done.")
    return joined


if __name__ == "__main__":
    main()
