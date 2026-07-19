import pandas as pd
import numpy as np
from datetime import datetime, timedelta

def main():
    np.random.seed(42)
    # 5 days of data
    start_time = datetime(2023, 10, 1, 0, 0, 0)
    hours = 24 * 5
    
    records = []
    for h in range(hours):
        t = start_time + timedelta(hours=h)
        # Station 1
        records.append({
            "station": "S1",
            "city": "Bengaluru",
            "lat": 12.9716,
            "lon": 77.5946,
            "timestamp": t.strftime("%Y-%m-%d %H:%M:%S"),
            "pollutant_id": "PM2.5",
            "pollutant_avg": np.random.uniform(30.0, 100.0)
        })
        # Station 2
        records.append({
            "station": "S2",
            "city": "Bengaluru",
            "lat": 12.9352,
            "lon": 77.6245,
            "timestamp": t.strftime("%Y-%m-%d %H:%M:%S"),
            "pollutant_id": "PM2.5",
            "pollutant_avg": np.random.uniform(40.0, 120.0)
        })
        
    df = pd.DataFrame(records)
    df.to_csv("data/sample_aqi.csv", index=False)
    print("Generated 5-day dummy data at data/sample_aqi.csv")

if __name__ == "__main__":
    main()
