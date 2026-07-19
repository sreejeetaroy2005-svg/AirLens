import os
import pandas as pd
import h3
from config import H3_RESOLUTION, CACHE_DIR

def assign_h3_index(row):
    # Depending on h3-py version, the function might be h3.geo_to_h3 or h3.latlng_to_cell
    try:
        return h3.geo_to_h3(row['lat'], row['lon'], H3_RESOLUTION)
    except AttributeError:
        return h3.latlng_to_cell(row['lat'], row['lon'], H3_RESOLUTION)

def main():
    input_file = os.path.join(CACHE_DIR, "ingested_data.parquet")
    output_file = os.path.join(CACHE_DIR, "hex_indexed_ts.parquet")
    
    if not os.path.exists(input_file):
        print(f"Input file {input_file} not found. Please run ingest.py first.")
        return
        
    print(f"Loading ingested data from {input_file}...")
    df = pd.read_parquet(input_file)
    
    print(f"Assigning H3 hex indices at resolution {H3_RESOLUTION}...")
    df['h3_hex'] = df.apply(assign_h3_index, axis=1)
    
    print("Aggregating readings per hex per hour...")
    # Ensure timestamp is datetime and rounded to hour
    df['timestamp_hr'] = pd.to_datetime(df['timestamp']).dt.floor('h') # lowercase 'h' for frequency
    
    # Group by hex and hour
    agg_funcs = {
        'pollutant_avg': 'mean',
        'temperature': 'mean',
        'humidity': 'mean',
        'wind_speed': 'mean',
        'wind_direction': 'mean',
        'city_road_density': 'mean' 
    }
    
    # Only aggregate columns that exist
    actual_agg_funcs = {k: v for k, v in agg_funcs.items() if k in df.columns}
    
    hex_ts_df = df.groupby(['h3_hex', 'timestamp_hr']).agg(actual_agg_funcs).reset_index()
    
    print(f"Saving hex-indexed time series to {output_file}...")
    hex_ts_df.to_parquet(output_file, index=False)
    
    print("Binning complete. Sample output:")
    print(hex_ts_df.head())

if __name__ == "__main__":
    main()
