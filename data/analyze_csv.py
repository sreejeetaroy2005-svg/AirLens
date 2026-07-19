import pandas as pd

CSV = r'data/india_air_quality_consolidated.csv'
df = pd.read_csv(CSV)

print('='*60)
print('STEP A-1: ALL COLUMN NAMES')
print('='*60)
print(list(df.columns))

print()
print('='*60)
print('STEP A-2: UNIQUE CITIES WITH ROW COUNTS')
print('='*60)
print(df['city'].value_counts().to_string())

print()
print('='*60)
print('STEP A-3: LAT/LON COLUMNS CHECK')
print('='*60)
lat_like = [c for c in df.columns if any(x in c.lower() for x in ['lat','lon','lng','coord','geo'])]
print('Lat/lon-like columns found:', lat_like if lat_like else 'NONE')
print('All columns:', list(df.columns))

print()
print('='*60)
print('STEP A-4: BENGALURU / BANGALORE CHECK')
print('='*60)
mask_blr = df['city'].str.lower().str.strip().isin(['bengaluru','bangalore','bengalore','bangaluru'])
mask_chikka = df['city'].str.lower().str.contains('chikka', na=False)
print('Exact Bengaluru/Bangalore matches:', mask_blr.sum())
print('Chikkamagaluru rows (NOT Bengaluru):', mask_chikka.sum())
contains_bang = df[df['city'].str.lower().str.contains('bang|bengal', na=False)]['city'].unique().tolist()
print('Cities containing bang/bengal:', contains_bang)

print()
print('='*60)
print('STEP A-5: DATE RANGE AND ROW COUNT PER CITY')
print('='*60)
# Parse dates
df['_date'] = pd.to_datetime(df['date'], errors='coerce')
print(f'Total rows: {len(df)}')
print(f'Rows with unparseable date: {df["_date"].isna().sum()}')
print()
for city, grp in df.groupby('city'):
    mn = grp['_date'].min()
    mx = grp['_date'].max()
    days = (mx - mn).days + 1 if pd.notna(mn) and pd.notna(mx) else 0
    null_pm25 = pd.to_numeric(grp['pm25'], errors='coerce').isna().sum() if 'pm25' in grp else 'N/A'
    print(f"  {city:<20} rows={len(grp):>6}  date={str(mn.date()) if pd.notna(mn) else 'N/A'} to {str(mx.date()) if pd.notna(mx) else 'N/A'}  span={days}d  pm25_nulls={null_pm25}")

print()
print('='*60)
print('ALL UNIQUE (city, location) PAIRS')
print('='*60)
pairs = df[['city','location']].drop_duplicates().sort_values(['city','location'])
print(f'Total unique (city, location) pairs: {len(pairs)}')
print(pairs.to_string(index=False))
