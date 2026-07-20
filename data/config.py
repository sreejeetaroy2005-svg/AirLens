# data/config.py
#
# TARGET CITY: Delhi
# Delhi was chosen as the target city based on STEP A analysis:
#   - 22,058 rows (largest dataset, 2.5x the next city)
#   - Longest date span: 2013-12-31 to 2025-12-05 (4,358 days)
#   - 6 monitoring stations — best spatial coverage for H3 hex generation
#   - Only 2.6% PM2.5 nulls (lowest null rate among large cities)

# ── Bounding Box ─────────────────────────────────────────────────────────────
# Delhi NCT bounding box [min_lat, min_lon, max_lat, max_lon]
# Covers the full NCT territory (28.40°N–28.88°N, 76.84°E–77.35°E)
TARGET_CITY    = "Delhi"
TARGET_CITY_DISPLAY = "Delhi"
CITY_BBOX      = [28.40, 76.84, 28.88, 77.35]   # [min_lat, min_lon, max_lat, max_lon]

# Map centre for the frontend
MAP_CENTER_LAT = 28.6139
MAP_CENTER_LON = 77.2090
MAP_ZOOM       = 11

# H3 Resolution
H3_RESOLUTION = 8

# ── Kaggle India Air Quality CSV schema ──────────────────────────────────────
# Actual columns: city, location, date, pm25, pm10, o3, no2, so2, co
# No lat/lon in the CSV — coordinates are joined from location_coords.csv.
#
# CSV_SCHEMA maps  internal_name → csv_column_name
CSV_SCHEMA = {
    "city"         : "city",
    "station"      : "location",    # 'location' in CSV becomes 'station' internally
    "timestamp"    : "date",        # daily date string, expanded to hourly in ingest
    "pollutant_avg": "pm25",        # PM2.5 is the primary AQI proxy
}

# Date format used in the CSV (e.g. "2025/12/1")
CSV_DATE_FORMAT = "%Y/%m/%d"

# Pollutant columns to coerce to numeric (whitespace / empty strings → NaN)
POLLUTANT_COLS = ["pm25", "pm10", "o3", "no2", "so2", "co"]

# Cities to keep from the CSV (empty list = keep all)
CITIES_TO_KEEP = ["Delhi"]

# Absolute path to the Kaggle CSV
import os
_HERE = os.path.dirname(os.path.abspath(__file__))
KAGGLE_CSV_PATH = os.path.join(_HERE, "india_air_quality_consolidated.csv")
LOCATION_COORDS_PATH = os.path.join(_HERE, "location_coords.csv")

# Cache directory
CACHE_DIR = os.path.join(_HERE, "cache")
