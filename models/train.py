import os
import pandas as pd
import numpy as np
import lightgbm as lgb
import pickle
from sklearn.metrics import mean_squared_error

def train_and_evaluate(df, features, horizon):
    """
    Trains a LightGBM model for a specific horizon.
    Returns the trained model, baseline RMSE, and model RMSE.
    """
    # Create target variable: future AQI
    # Negative shift brings future values to current row
    target_col = f'target_{horizon}h'
    df[target_col] = df.groupby('h3_hex')['pollutant_avg'].shift(-horizon)
    
    # Drop rows with NaNs in features or target
    valid_cols = features + [target_col, 'pollutant_avg']
    train_df = df.dropna(subset=valid_cols).copy()
    
    if len(train_df) == 0:
        print(f"Not enough data to train horizon {horizon}h.")
        return None, None, None
        
    # Split into train/test (chronological split)
    train_size = int(len(train_df) * 0.8)
    train_data = train_df.iloc[:train_size]
    test_data = train_df.iloc[train_size:]
    
    if len(test_data) == 0:
        print(f"Not enough test data to evaluate horizon {horizon}h. Using train data for eval.")
        test_data = train_data
    
    X_train = train_data[features]
    y_train = train_data[target_col]
    X_test = test_data[features]
    y_test = test_data[target_col]
    
    # Baseline: tomorrow = today (i.e. predicted = current pollutant_avg)
    baseline_preds = test_data['pollutant_avg']
    baseline_rmse = np.sqrt(mean_squared_error(y_test, baseline_preds))
    
    # Train LightGBM
    model = lgb.LGBMRegressor(n_estimators=100, random_state=42)
    model.fit(X_train, y_train)
    
    # Predict and evaluate
    model_preds = model.predict(X_test)
    model_rmse = np.sqrt(mean_squared_error(y_test, model_preds))
    
    return model, baseline_rmse, model_rmse

def main():
    input_file = "data/cache/features.parquet"
    if not os.path.exists(input_file):
        print(f"File {input_file} not found.")
        return
        
    print(f"Loading {input_file}...")
    df = pd.read_parquet(input_file)
    
    # Sort carefully to ensure shifts work correctly
    df = df.sort_values(by=['h3_hex', 'timestamp_hr']).reset_index(drop=True)
    
    # Define features
    features = [
        'pollutant_avg', 'temperature', 'humidity', 'wind_speed', 'wind_direction',
        'city_road_density', 'aqi_lag_1h', 'aqi_lag_6h', 'aqi_lag_24h',
        'aqi_roll_6h_mean', 'aqi_roll_24h_mean', 'hour_sin', 'hour_cos',
        'dow_sin', 'dow_cos'
    ]
    
    # Ensure all features exist in df
    features = [f for f in features if f in df.columns]
    
    os.makedirs("models", exist_ok=True)
    
    horizons = [24, 48, 72]
    
    # Tradeoff Explanation:
    # We choose 3 separate models instead of 1 model with horizon as a feature.
    # Tradeoff: 3 models require slightly more storage and independent training steps.
    # However, it allows each model to learn tailored feature importance for its specific horizon 
    # (e.g., lag_24h is more important for 24h horizon than 72h horizon). 
    # It also greatly simplifies the backend inference code.
    print("Training 3 separate models for horizons 24, 48, 72.")
    
    for h in horizons:
        print(f"\n--- Training Horizon +{h}h ---")
        model, base_rmse, mod_rmse = train_and_evaluate(df, features, h)
        
        if model is not None:
            print(f"Baseline RMSE (Persistence): {base_rmse:.4f}")
            print(f"Model RMSE (LightGBM):     {mod_rmse:.4f}")
            
            # Save model
            model_path = f"models/lgbm_model_{h}h.pkl"
            with open(model_path, "wb") as f:
                pickle.dump(model, f)
            print(f"Saved model to {model_path}")
            
if __name__ == "__main__":
    main()
