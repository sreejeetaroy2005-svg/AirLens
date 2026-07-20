import pandas as pd, h3

df = pd.read_parquet('data/cache/ingested_data.parquet')
# For each unique station, show which hex it maps to
df['h3_hex'] = df.apply(
    lambda r: h3.latlng_to_cell(r['lat'], r['lon'], 8)
    if hasattr(h3, 'latlng_to_cell')
    else h3.geo_to_h3(r['lat'], r['lon'], 8),
    axis=1
)
mapping = df[['station','city','lat','lon','h3_hex']].drop_duplicates('station')
for _, r in mapping.iterrows():
    print(f"  {r['h3_hex']}  {r['city']} / {r['station']}  ({r['lat']:.4f}, {r['lon']:.4f})")
