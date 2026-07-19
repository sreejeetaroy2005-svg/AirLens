import pandas as pd
import h3

df = pd.read_parquet('data/cache/hex_indexed_ts.parquet')
hexes = df['h3_hex'].unique()
print(f'Unique H3 hexes: {len(hexes)}')
print(f'Total hex-hour rows: {len(df)}')
print(f'Date range: {df["timestamp_hr"].min()} to {df["timestamp_hr"].max()}')
print()
print('Hex centroids (confirming Delhi coords):')
for hx in sorted(hexes):
    try:
        lat, lon = h3.h3_to_geo(hx)
    except AttributeError:
        lat, lon = h3.cell_to_latlng(hx)
    in_bbox = 28.40 <= lat <= 28.88 and 76.84 <= lon <= 77.35
    print(f'  {hx}  lat={lat:.4f}  lon={lon:.4f}  in_delhi_bbox={in_bbox}')
