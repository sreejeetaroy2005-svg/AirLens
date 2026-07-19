import os
import argparse
import pandas as pd
import requests
import json
from config import BENGALURU_BBOX, CSV_SCHEMA, CACHE_DIR

os.makedirs(CACHE_DIR, exist_ok=True)

def load_historical_aqi(csv_path: str) -> pd.DataFrame:
    """Loads historical AQI data using the configurable schema."""
    df = pd.read_csv(csv_path)
    # Rename columns based on config schema
    inv_schema = {v: k for k, v in CSV_SCHEMA.items()}
    df = df.rename(columns=inv_schema)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    return df

def fetch_live_weather(min_lat, min_lon, max_lat, max_lon, start_date, end_date):
    """Fetches hourly weather data from Open-Meteo for the bounding box center."""
    center_lat = (min_lat + max_lat) / 2.0
    center_lon = (min_lon + max_lon) / 2.0
    
    url = f"https://archive-api.open-meteo.com/v1/archive?latitude={center_lat}&longitude={center_lon}&start_date={start_date}&end_date={end_date}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m"
    response = requests.get(url)
    response.raise_for_status()
    data = response.json()
    
    weather_df = pd.DataFrame({
        'timestamp': pd.to_datetime(data['hourly']['time']),
        'temperature': data['hourly']['temperature_2m'],
        'humidity': data['hourly']['relative_humidity_2m'],
        'wind_speed': data['hourly']['wind_speed_10m'],
        'wind_direction': data['hourly']['wind_direction_10m']
    })
    return weather_df

def fetch_osm_road_density(min_lat, min_lon, max_lat, max_lon):
    """Fetches count of 'highway' tagged ways from OSM Overpass API for bounding box."""
    overpass_url = "http://overpass-api.de/api/interpreter"
    overpass_query = f"""
    [out:json];
    way["highway"]({min_lat},{min_lon},{max_lat},{max_lon});
    out count;
    """
    response = requests.get(overpass_url, params={'data': overpass_query})
    response.raise_for_status()
    data = response.json()
    
    total_roads = 0
    if 'elements' in data and len(data['elements']) > 0:
        total_roads = int(data['elements'][0].get('tags', {}).get('ways', 0))
        
    return total_roads

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv_path", type=str, default="sample_aqi.csv")
    parser.add_argument("--live", action="store_true", help="Force refresh from APIs instead of cache")
    args = parser.parse_args()
    
    # Ensure csv_path handles being in data/ when running from root
    csv_path = args.csv_path
    if not os.path.exists(csv_path) and os.path.exists(os.path.join("data", csv_path)):
        csv_path = os.path.join("data", csv_path)
    
    cache_file = os.path.join(CACHE_DIR, "ingested_data.parquet")
    
    if os.path.exists(cache_file) and not args.live:
        print(f"Loading data from cache: {cache_file}")
        joined_df = pd.read_parquet(cache_file)
        print("Data loaded successfully.")
        return joined_df
        
    print(f"Ingesting historical AQI from {csv_path}...")
    aqi_df = load_historical_aqi(csv_path)
    
    # Get date range from AQI data for weather API
    start_date = aqi_df['timestamp'].min().strftime('%Y-%m-%d')
    end_date = aqi_df['timestamp'].max().strftime('%Y-%m-%d')
    
    print(f"Fetching weather data from {start_date} to {end_date}...")
    try:
        weather_df = fetch_live_weather(*BENGALURU_BBOX, start_date, end_date)
    except Exception as e:
        print(f"Weather API failed: {e}. Generating dummy weather for fallback.")
        # Fallback to dummy data if API fails to ensure reliability requirement
        dates = pd.date_range(start=start_date, end=end_date, freq='h') # lowercase 'h' for frequency
        weather_df = pd.DataFrame({
            'timestamp': dates,
            'temperature': 25.0,
            'humidity': 60.0,
            'wind_speed': 10.0,
            'wind_direction': 180.0
        })

    print("Fetching OSM road density...")
    try:
        total_roads = fetch_osm_road_density(*BENGALURU_BBOX)
    except Exception as e:
        print(f"OSM API failed: {e}. Using fallback road density.")
        total_roads = 5000 # Fallback
        
    print("Joining data...")
    # Join AQI with Weather on Timestamp (approximating to nearest hour)
    aqi_df['timestamp_hr'] = aqi_df['timestamp'].dt.floor('h') # lowercase 'h' for frequency
    weather_df['timestamp_hr'] = weather_df['timestamp'].dt.floor('h')
    
    # Drop timestamp from weather_df before merge to avoid collision
    weather_df = weather_df.drop(columns=['timestamp'])
    
    joined_df = pd.merge(aqi_df, weather_df, on='timestamp_hr', how='left')
    joined_df.drop(columns=['timestamp_hr'], inplace=True)
    
    # Add road density (constant for the bounding box in this simplified version)
    joined_df['city_road_density'] = total_roads
    
    print(f"Saving to cache: {cache_file}")
    joined_df.to_parquet(cache_file, index=False)
    print("Ingestion complete.")
    return joined_df

if __name__ == "__main__":
    main()
