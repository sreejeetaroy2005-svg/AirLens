import os
import numpy as np
import pandas as pd

def compute_features(df):
    # Ensure sorted by hex and time
    df = df.sort_values(by=['h3_hex', 'timestamp_hr']).reset_index(drop=True)
    
    # Lag features
    df['aqi_lag_1h'] = df.groupby('h3_hex')['pollutant_avg'].shift(1)
    df['aqi_lag_6h'] = df.groupby('h3_hex')['pollutant_avg'].shift(6)
    df['aqi_lag_24h'] = df.groupby('h3_hex')['pollutant_avg'].shift(24)
    
    # Rolling mean features (ensure minimum periods so we don't just get NaNs early on)
    df['aqi_roll_6h_mean'] = df.groupby('h3_hex')['pollutant_avg'].transform(
        lambda x: x.rolling(window=6, min_periods=1).mean()
    )
    df['aqi_roll_24h_mean'] = df.groupby('h3_hex')['pollutant_avg'].transform(
        lambda x: x.rolling(window=24, min_periods=1).mean()
    )
    
    # Cyclical time features
    # hour of day: 0 to 23
    df['hour'] = df['timestamp_hr'].dt.hour
    df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24.0)
    df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24.0)
    
    # day of week: 0 to 6
    df['day_of_week'] = df['timestamp_hr'].dt.dayofweek
    df['dow_sin'] = np.sin(2 * np.pi * df['day_of_week'] / 7.0)
    df['dow_cos'] = np.cos(2 * np.pi * df['day_of_week'] / 7.0)
    
    return df

def main():
    input_file = "data/cache/hex_indexed_ts.parquet"
    output_file = "data/cache/features.parquet"
    
    if not os.path.exists(input_file):
        print(f"File {input_file} not found.")
        return
        
    print(f"Loading {input_file}...")
    df = pd.read_parquet(input_file)
    
    print("Computing features...")
    df_features = compute_features(df)
    
    print(f"Saving features to {output_file}...")
    df_features.to_parquet(output_file, index=False)
    print("Feature engineering complete. Sample output:")
    
    # Show a slice of features to prove they computed successfully
    print(df_features[['h3_hex', 'timestamp_hr', 'pollutant_avg', 'aqi_lag_1h', 'aqi_lag_24h', 'aqi_roll_24h_mean', 'hour_sin', 'dow_sin']].tail())

if __name__ == "__main__":
    main()
