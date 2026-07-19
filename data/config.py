# data/config.py

# Bengaluru Bounding Box: [min_lat, min_lon, max_lat, max_lon]
BENGALURU_BBOX = [12.73, 77.37, 13.19, 77.83]

# H3 Resolution
H3_RESOLUTION = 8

# CSV Schema Mapping
CSV_SCHEMA = {
    "station": "station",
    "city": "city",
    "lat": "lat",
    "lon": "lon",
    "timestamp": "timestamp",
    "pollutant_id": "pollutant_id",
    "pollutant_avg": "pollutant_avg"
}

# Cache Directory
CACHE_DIR = "data/cache"
