"""
run_city_pipeline.py — Run the full AQI pipeline for one or more cities.

Steps per city:
  1. Ingest: CSV → hourly AQI + weather merge → ingested_data.parquet
  2. H3 binning: assign hex IDs, aggregate per hex/hour → hex_indexed_ts.parquet
  3. Feature engineering: lags, rolling means, cyclical time → features.parquet
  4. Model training: LightGBM 24h / 48h / 72h → lgbm_model_<h>h.pkl

Usage (from project root):
  python data/run_city_pipeline.py                        # all cities
  python data/run_city_pipeline.py --cities Delhi Mumbai  # specific cities
  python data/run_city_pipeline.py --skip-train           # ingest+features only
"""
import os
import sys
import argparse
import pickle

import pandas as pd
import numpy as np
import h3 as h3lib
import requests

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from cities import CITY_REGISTRY, CITY_KEYS, city_cache_dir, get_city

# ── Shared constants ──────────────────────────────────────────────────────────
KAGGLE_CSV  = os.path.join(_HERE, "india_air_quality_consolidated.csv")
COORDS_CSV  = os.path.join(_HERE, "location_coords.csv")
CSV_SCHEMA  = {"city": "city", "station": "location",
               "timestamp": "date", "pollutant_avg": "pm25"}
CSV_DATE_FMT = "%Y/%m/%d"
POLLUTANT_COLS = ["pm25", "pm10", "o3", "no2", "so2", "co"]
FEATURE_COLS = [
    'pollutant_avg', 'temperature', 'humidity', 'wind_speed', 'wind_direction',
    'city_road_density', 'aqi_lag_1h', 'aqi_lag_6h', 'aqi_lag_24h',
    'aqi_roll_6h_mean', 'aqi_roll_24h_mean', 'hour_sin', 'hour_cos',
    'dow_sin', 'dow_cos'
]

# ── Step 1: Ingest ─────────────────────────────────────────────────────────────
def _normalise(s: str) -> str:
    return " ".join(s.strip().lower().replace(",", " ").split())

def ingest_city(city_key: str, cfg: dict, live: bool = False) -> pd.DataFrame:
    cache_dir  = city_cache_dir(city_key)
    cache_file = os.path.join(cache_dir, "ingested_data.parquet")

    if os.path.exists(cache_file) and not live:
        print(f"  [ingest] cache hit → {cache_file}")
        return pd.read_parquet(cache_file)

    print(f"  [ingest] reading CSV for {city_key} …")
    raw = pd.read_csv(KAGGLE_CSV)
    rename_map = {v: k for k, v in CSV_SCHEMA.items()}
    df = raw.rename(columns=rename_map)
    df = df[df["city"] == city_key].copy()
    if df.empty:
        raise ValueError(f"No rows for city '{city_key}' in CSV.")
    print(f"  [ingest] {len(df)} rows after city filter")

    for col in POLLUTANT_COLS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    if "pollutant_avg" in df.columns:
        df["pollutant_avg"] = pd.to_numeric(df["pollutant_avg"], errors="coerce")

    avail = [c for c in ["pollutant_avg", "pm10", "o3", "no2"] if c in df.columns]
    df["pollutant_avg"] = df[avail].mean(axis=1, skipna=True)
    df = df.dropna(subset=["pollutant_avg"])

    # Hourly expansion
    df["_date"] = pd.to_datetime(df["timestamp"], format=CSV_DATE_FMT, errors="coerce")
    df = df.dropna(subset=["_date"])
    print(f"  [ingest] expanding {len(df)} daily rows to hourly …")
    rows = []
    for _, row in df.iterrows():
        base = row["_date"]
        for h in range(24):
            r = row.copy()
            r["timestamp"] = base + pd.Timedelta(hours=h)
            rows.append(r)
    df = pd.DataFrame(rows).drop(columns=["_date"], errors="ignore").reset_index(drop=True)
    print(f"  [ingest] {len(df)} hourly rows")

    # Lat/lon join
    coords = pd.read_csv(COORDS_CSV)
    coords["_key"] = (coords["city"].str.strip().str.lower()
                      + "|" + coords["location"].apply(_normalise))
    coords = coords[["_key", "lat", "lon"]].drop_duplicates("_key")
    df["_key"] = (df["city"].str.strip().str.lower()
                  + "|" + df["station"].apply(_normalise))
    df = df.merge(coords, on="_key", how="left").drop(columns=["_key"])
    unmatched = df["lat"].isna().sum()
    if unmatched:
        miss = df[df["lat"].isna()]["station"].unique()
        print(f"  [ingest] WARNING: {unmatched} rows with no coords (stations: {miss})")
    df = df.dropna(subset=["lat", "lon"])
    print(f"  [ingest] {len(df)} rows after coord join")

    # Weather
    bbox = cfg["bbox"]
    start_date = df["timestamp"].min().strftime("%Y-%m-%d")
    end_date   = df["timestamp"].max().strftime("%Y-%m-%d")
    print(f"  [ingest] fetching weather {start_date} → {end_date} …")
    try:
        clat = (bbox[0] + bbox[2]) / 2
        clon = (bbox[1] + bbox[3]) / 2
        url = (
            f"https://archive-api.open-meteo.com/v1/archive"
            f"?latitude={clat}&longitude={clon}"
            f"&start_date={start_date}&end_date={end_date}"
            f"&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m"
        )
        wr = requests.get(url, timeout=90)
        wr.raise_for_status()
        wd = wr.json()
        weather_df = pd.DataFrame({
            "timestamp_hr": pd.to_datetime(wd["hourly"]["time"]),
            "temperature":  wd["hourly"]["temperature_2m"],
            "humidity":     wd["hourly"]["relative_humidity_2m"],
            "wind_speed":   wd["hourly"]["wind_speed_10m"],
            "wind_direction": wd["hourly"]["wind_direction_10m"],
        })
        print(f"  [ingest] weather rows: {len(weather_df)}")
    except Exception as e:
        print(f"  [ingest] weather API failed ({e}), using synthetic fallback")
        dates = pd.date_range(start=start_date, end=end_date, freq="h")
        weather_df = pd.DataFrame({
            "timestamp_hr": dates,
            "temperature": 25.0, "humidity": 60.0,
            "wind_speed": 10.0,  "wind_direction": 180.0,
        })

    # Road density via Overpass
    print(f"  [ingest] fetching OSM road density …")
    try:
        q = f'[out:json];way["highway"]({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]});out count;'
        rr = requests.get("https://overpass-api.de/api/interpreter",
                          params={"data": q},
                          headers={"User-Agent": "PollutionDetectionResearch/1.0"},
                          timeout=30)
        rr.raise_for_status()
        rd = rr.json()
        road_count = int(rd["elements"][0]["tags"].get("ways", 5000)) if rd.get("elements") else 5000
    except Exception as e:
        print(f"  [ingest] OSM failed ({e}), using 5000")
        road_count = 5000
    print(f"  [ingest] road count: {road_count}")

    # Merge
    df["timestamp_hr"] = pd.to_datetime(df["timestamp"]).dt.floor("h")
    joined = df.merge(weather_df, on="timestamp_hr", how="left")
    joined["city_road_density"] = float(road_count)

    joined.to_parquet(cache_file, index=False)
    print(f"  [ingest] saved → {cache_file}")
    return joined


# ── Step 2: H3 binning ─────────────────────────────────────────────────────────
def bin_hex(city_key: str, cfg: dict, df: pd.DataFrame) -> pd.DataFrame:
    cache_dir  = city_cache_dir(city_key)
    cache_file = os.path.join(cache_dir, "hex_indexed_ts.parquet")

    h3_res = cfg.get("h3_res", 8)

    def _assign(row):
        try:    return h3lib.geo_to_h3(row["lat"], row["lon"], h3_res)
        except: return h3lib.latlng_to_cell(row["lat"], row["lon"], h3_res)

    print(f"  [h3bin] assigning H3 res-{h3_res} indices …")
    df = df.copy()
    df["h3_hex"] = df.apply(_assign, axis=1)
    df["timestamp_hr"] = pd.to_datetime(df["timestamp"]).dt.floor("h")

    agg_cols = {k: "mean" for k in
                ["pollutant_avg","temperature","humidity","wind_speed","wind_direction","city_road_density"]
                if k in df.columns}
    hex_ts = df.groupby(["h3_hex","timestamp_hr"]).agg(agg_cols).reset_index()
    print(f"  [h3bin] {len(hex_ts)} hex-hour rows, {hex_ts['h3_hex'].nunique()} hexes")

    hex_ts.to_parquet(cache_file, index=False)
    print(f"  [h3bin] saved → {cache_file}")
    return hex_ts


# ── Step 3: Feature engineering ────────────────────────────────────────────────
def build_features(city_key: str, df: pd.DataFrame) -> pd.DataFrame:
    cache_dir  = city_cache_dir(city_key)
    cache_file = os.path.join(cache_dir, "features.parquet")

    print(f"  [features] computing lag/rolling features …")
    df = df.sort_values(["h3_hex","timestamp_hr"]).reset_index(drop=True)

    df["aqi_lag_1h"]  = df.groupby("h3_hex")["pollutant_avg"].shift(1)
    df["aqi_lag_6h"]  = df.groupby("h3_hex")["pollutant_avg"].shift(6)
    df["aqi_lag_24h"] = df.groupby("h3_hex")["pollutant_avg"].shift(24)
    df["aqi_roll_6h_mean"]  = df.groupby("h3_hex")["pollutant_avg"].transform(
        lambda x: x.rolling(6,  min_periods=1).mean())
    df["aqi_roll_24h_mean"] = df.groupby("h3_hex")["pollutant_avg"].transform(
        lambda x: x.rolling(24, min_periods=1).mean())

    df["hour"]        = df["timestamp_hr"].dt.hour
    df["hour_sin"]    = np.sin(2 * np.pi * df["hour"] / 24.0)
    df["hour_cos"]    = np.cos(2 * np.pi * df["hour"] / 24.0)
    df["day_of_week"] = df["timestamp_hr"].dt.dayofweek
    df["dow_sin"]     = np.sin(2 * np.pi * df["day_of_week"] / 7.0)
    df["dow_cos"]     = np.cos(2 * np.pi * df["day_of_week"] / 7.0)

    df.to_parquet(cache_file, index=False)
    print(f"  [features] {len(df)} rows, saved → {cache_file}")
    return df


# ── Step 4: Train LightGBM models ─────────────────────────────────────────────
def train_models(city_key: str, df: pd.DataFrame) -> dict:
    """
    Train 24h/48h/72h LightGBM models for a city.
    Returns {horizon: (model, baseline_rmse, model_rmse)}.
    """
    from sklearn.metrics import mean_squared_error
    try:
        import lightgbm as lgb
    except ImportError:
        print("  [train] lightgbm not installed — skipping training")
        return {}

    cache_dir = city_cache_dir(city_key)
    feats = [c for c in FEATURE_COLS if c in df.columns]
    df = df.sort_values(["h3_hex","timestamp_hr"]).reset_index(drop=True)

    results = {}
    for h in [24, 48, 72]:
        target_col = f"target_{h}h"
        df[target_col] = df.groupby("h3_hex")["pollutant_avg"].shift(-h)
        valid = feats + [target_col, "pollutant_avg"]
        train_df = df.dropna(subset=valid).copy()

        if len(train_df) < 100:
            print(f"  [train] +{h}h: insufficient data ({len(train_df)} rows), skipping")
            continue

        split = int(len(train_df) * 0.8)
        tr, te = train_df.iloc[:split], train_df.iloc[split:]
        if len(te) == 0:
            te = tr

        X_tr, y_tr = tr[feats], tr[target_col]
        X_te, y_te = te[feats], te[target_col]

        baseline_rmse = float(np.sqrt(mean_squared_error(y_te, te["pollutant_avg"])))

        model = lgb.LGBMRegressor(n_estimators=100, random_state=42)
        model.fit(X_tr, y_tr)
        preds = model.predict(X_te)
        model_rmse = float(np.sqrt(mean_squared_error(y_te, preds)))

        model_path = os.path.join(cache_dir, f"lgbm_model_{h}h.pkl")
        with open(model_path, "wb") as f:
            pickle.dump(model, f)

        print(f"  [train] +{h}h  baseline RMSE:{baseline_rmse:.2f}  "
              f"model RMSE:{model_rmse:.2f}  saved→{model_path}")
        results[h] = {
            "model":          model,
            "baseline_rmse":  round(baseline_rmse, 2),
            "model_rmse":     round(model_rmse, 2),
            "improvement_pct": round((1 - model_rmse / baseline_rmse) * 100, 1),
            "n_train":        len(tr),
        }

    return results


# ── Zone label builder ─────────────────────────────────────────────────────────
def build_zone_labels(city_key: str, df: pd.DataFrame):
    """Write a simple zone_labels.json: {h3_hex: 'Zone XX'} for the city."""
    import json
    cache_dir = city_cache_dir(city_key)
    hexes = sorted(df["h3_hex"].unique())
    labels = {hx: f"Zone {i:02d}" for i, hx in enumerate(hexes, 1)}
    out = os.path.join(cache_dir, "zone_labels.json")
    with open(out, "w") as f:
        json.dump(labels, f, indent=2)
    print(f"  [zones] {len(labels)} zone labels → {out}")
    return labels


# ── Main entry point ───────────────────────────────────────────────────────────
def run_pipeline(city_key: str, live: bool = False, skip_train: bool = False) -> dict:
    cfg = CITY_REGISTRY[city_key]
    print(f"\n{'='*60}")
    print(f"  PIPELINE: {city_key}")
    print(f"{'='*60}")

    ingested = ingest_city(city_key, cfg, live=live)
    hex_ts   = bin_hex(city_key, cfg, ingested)
    features = build_features(city_key, hex_ts)
    build_zone_labels(city_key, features)

    model_results = {}
    if not skip_train:
        model_results = train_models(city_key, features)

    return {
        "city":         city_key,
        "hexes":        features["h3_hex"].nunique(),
        "rows":         len(features),
        "model_results": model_results,
    }


def main():
    parser = argparse.ArgumentParser(description="Run AQI pipeline for one or more cities")
    parser.add_argument("--cities", nargs="+", default=CITY_KEYS,
                        help="City names to process (default: all)")
    parser.add_argument("--live",       action="store_true", help="Force re-fetch from APIs")
    parser.add_argument("--skip-train", action="store_true", help="Skip model training")
    args = parser.parse_args()

    summaries = []
    for city in args.cities:
        # Normalise to registry key
        matched = next((k for k in CITY_REGISTRY if k.lower() == city.lower()), None)
        if not matched:
            print(f"WARNING: '{city}' not in registry, skipping. "
                  f"Known: {list(CITY_REGISTRY)}")
            continue
        result = run_pipeline(matched, live=args.live, skip_train=args.skip_train)
        summaries.append(result)

    print(f"\n{'='*60}")
    print("  PIPELINE SUMMARY")
    print(f"{'='*60}")
    for s in summaries:
        mr = s.get("model_results", {})
        print(f"  {s['city']:15s}  hexes:{s['hexes']}  rows:{s['rows']}")
        for h, r in mr.items():
            print(f"    +{h}h  baseline:{r['baseline_rmse']:.2f}  "
                  f"model:{r['model_rmse']:.2f}  "
                  f"improvement:{r['improvement_pct']}%  "
                  f"n_train:{r['n_train']}")


if __name__ == "__main__":
    main()
