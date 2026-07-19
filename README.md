# AI-Powered Urban Air Quality Intelligence
### Hackathon Prototype — Bengaluru, India

> **Full-stack prototype for smart city air quality monitoring and forecasting.**
> Ingests AQI, weather, and road data → H3 hex binning → LightGBM forecast → interactive Deck.gl map.

---

## Tech Stack
| Layer | Technology |
|---|---|
| Data ingestion | Python, `pandas`, `requests`, Open-Meteo API, OSM Overpass |
| Geospatial indexing | `h3-py` (resolution 8, configurable) |
| ML Forecast | LightGBM (3 models: +24h, +48h, +72h) |
| Backend API | FastAPI + Uvicorn |
| Frontend | React + Vite + Deck.gl + MapLibre GL |

---

## Quick Start (< 10 minutes from clean clone)

### 1. Python Backend
```bash
# From repo root
python -m venv venv
# Windows:
.\venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r data/requirements.txt
pip install -r backend/requirements.txt
```

### 2. Run the Data Pipeline
```bash
# Generate/load AQI data, fetch weather, bin to H3 hexes, engineer features, train model
python data/ingest.py --live          # fetches live weather; omit --live to use cache
python data/h3_binning.py
python models/features.py
python models/train.py                # prints Baseline vs Model RMSE
```
> **Tip:** Replace `data/sample_aqi.csv` with your real Kaggle CPCB CSV.
> Column mapping is configured at the top of `data/config.py`.

### 3. Start the Backend
```bash
uvicorn backend.main:app --host 127.0.0.1 --port 8000
```
Endpoints:
- `GET /current` — current AQI per hex (GeoJSON)
- `GET /forecast?hours=24` — forecast at +24/48/72h (GeoJSON)
- `GET /source-attribution` — traffic/industrial flags per hex (GeoJSON)

### 4. Start the Frontend
```bash
cd frontend
npm install   # first time only
npm run dev -- --port 3000
```
Open **http://localhost:3000** in Chrome/Edge.

---

## Configuration
All tunable parameters are in `data/config.py`:
```python
BENGALURU_BBOX = [12.73, 77.37, 13.19, 77.83]  # bounding box
H3_RESOLUTION = 8                                 # H3 resolution (7-9)
CSV_SCHEMA = { ... }                              # column name mapping
```

---

## Project Structure
```
pollution_detection/
├── data/
│   ├── config.py           # bbox, H3 resolution, column mapping
│   ├── ingest.py           # AQI CSV + weather + OSM ingestion
│   ├── h3_binning.py       # H3 hex assignment and aggregation
│   ├── generate_dummy.py   # generates synthetic 5-day test data
│   ├── requirements.txt
│   ├── sample_aqi.csv      # sample/test CSV (replace with real data)
│   └── cache/              # auto-generated parquet cache files
├── models/
│   ├── features.py         # lag, rolling, cyclical feature engineering
│   ├── train.py            # LightGBM training + RMSE vs baseline
│   ├── lgbm_model_24h.pkl
│   ├── lgbm_model_48h.pkl
│   └── lgbm_model_72h.pkl
├── backend/
│   ├── main.py             # FastAPI app with CORS
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx         # Deck.gl map, controls, popup
│   │   └── index.css       # dark premium UI styles
│   └── package.json
└── README.md
```

---

## Model Performance (72h horizon, synthetic data)
| Model | RMSE |
|---|---|
| Persistence Baseline (tomorrow = today) | 26.06 |
| LightGBM Forecast | **16.41** |
| **Improvement** | **↓ 37%** |

> Note: Numbers will change once you supply the real Kaggle CPCB dataset.

---

## CPCB AQI Severity Bands
| Band | AQI Range | Color |
|---|---|---|
| Good | 0–30 | 🟢 `#00B050` |
| Satisfactory | 31–60 | 🟩 `#92D050` |
| Moderate | 61–90 | 🟡 `#FFFF00` |
| Poor | 91–120 | 🟠 `#FF9900` |
| Very Poor | 121–250 | 🔴 `#FF0000` |
| Severe | >250 | 🟥 `#C00000` |
