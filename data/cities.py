"""
cities.py — City registry for the multi-city AQI pipeline.

Each entry defines everything needed to run the full pipeline
for one city: bbox, map centre, H3 resolution, and display name.

Adding a new city: append a new entry to CITY_REGISTRY and ensure
its stations exist in location_coords.csv.
"""
import os

_HERE = os.path.dirname(os.path.abspath(__file__))

# ── City registry ─────────────────────────────────────────────────────────────
# Key = canonical city name (must match 'city' column in the CSV exactly)
CITY_REGISTRY = {
    "Delhi": {
        "display":   "Delhi",
        "bbox":      [28.40, 76.84, 28.88, 77.35],   # [min_lat, min_lon, max_lat, max_lon]
        "map_lat":   28.6139,
        "map_lon":   77.2090,
        "map_zoom":  11,
        "h3_res":    8,
        "primary":   True,     # default city on load
    },
    "Ghaziabad": {
        "display":   "Ghaziabad",
        "bbox":      [28.58, 77.36, 28.76, 77.55],
        "map_lat":   28.6692,
        "map_lon":   77.4538,
        "map_zoom":  12,
        "h3_res":    8,
        "primary":   False,
    },
    "Noida": {
        "display":   "Noida",
        "bbox":      [28.46, 77.28, 28.64, 77.50],
        "map_lat":   28.5355,
        "map_lon":   77.3910,
        "map_zoom":  12,
        "h3_res":    8,
        "primary":   False,
    },
    "Mumbai": {
        "display":   "Mumbai",
        "bbox":      [18.89, 72.77, 19.27, 73.02],
        "map_lat":   19.0760,
        "map_lon":   72.8777,
        "map_zoom":  11,
        "h3_res":    8,
        "primary":   False,
    },
}

# Ordered list of city keys (primary first, rest alphabetical)
CITY_KEYS = ["Delhi", "Ghaziabad", "Noida", "Mumbai"]

def get_city(city: str) -> dict:
    """Return registry entry for a city, case-insensitive. Raises KeyError if unknown."""
    for k, v in CITY_REGISTRY.items():
        if k.lower() == city.lower():
            return {**v, "city_key": k}
    raise KeyError(f"City '{city}' not found in registry. Available: {list(CITY_REGISTRY)}")

def city_cache_dir(city: str) -> str:
    """Return the per-city cache directory path (created on demand)."""
    key = get_city(city)["city_key"]
    d = os.path.join(_HERE, "cache", key.lower().replace(" ", "_"))
    os.makedirs(d, exist_ok=True)
    return d
