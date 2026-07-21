# AQI·INTEL — Urban Air Quality Intelligence System

> **Full-stack, multi-city air quality forecasting and enforcement-recommendation platform.**
> Real CPCB data → H3 hex grid → LightGBM 72h ahead forecast → OSM-enriched source attribution → composite urgency scoring → evidence-backed enforcement recommendations.

---

## What This System Does

AQI·INTEL ingests historical air quality data from 4 Indian cities, trains per-city LightGBM models that beat a persistence baseline by 8–20%, and serves a real-time dashboard that:

- **Forecasts AQI 24 / 48 / 72 hours ahead** per H3 hex cell
- **Attributes pollution sources** (traffic proxy, industrial, construction) with per-hex confidence scores derived from OSM road classification and proximity analysis
- **Ranks enforcement actions** by a composite urgency score combining current severity, forecast trend, source confidence, and proximity to schools / hospitals
- **Generates evidence-backed recommendations** — one-sentence basis per action citing real computed values, not hardcoded text
- **Supports 4 cities** (Delhi, Ghaziabad, Noida, Mumbai) with a city-selector UI and cross-city comparison view

---

## Live Metrics (real data, December 2025 snapshot)

### Model Performance vs Persistence Baseline

| City | Horizon | Baseline RMSE | LightGBM RMSE | Improvement |
|---|---|---|---|---|
| Delhi | +24h | 30.20 | 24.91 | **−17.5%** |
| Delhi | +48h | 37.12 | 30.13 | **−18.8%** |
| Delhi | +72h | 40.59 | 32.44 | **−20.1%** |
| Ghaziabad | +72h | 39.38 | 33.17 | **−15.8%** |
| Noida | +72h | 34.97 | 28.52 | **−18.5%** |
| Mumbai | +72h | 33.67 | 26.99 | **−19.8%** |

### Source Attribution Accuracy (Delhi, vs DPCC/CPCB ground-truth zones)

| Source | Precision | Recall | GT Hexes Evaluated |
|---|---|---|---|
| Traffic | 66.7% | 100% | 4 hexes (1-ring expanded) |
| Industrial | — | — | GT zones not in dataset |

### Attribution Confidence Distribution (Delhi, 6 monitoring hexes)

| Threshold | Count | Fraction |
|---|---|---|
| Dominant source ≥ 70% | 6/6 | **100%** |
| Dominant source ≥ 80% | 3/6 | 50% |
| Mean dominant confidence | — | **82.4%** |

### Current City Snapshot

| City | Avg AQI | Band | 72h Trend | Poor+ Hexes |
|---|---|---|---|---|
| Delhi | 254 | Severe | Improving −79 | 100% |
| Ghaziabad | 246 | Very Poor | Improving −75 | 100% |
| Noida | 240 | Very Poor | Improving −74 | 100% |
| Mumbai | 126 | Very Poor | Improving −44 | 100% |

---

## Architecture — Multi-Agent Pipeline

AQI·INTEL is structured as a **multi-agent system**: six specialised agents, each with a single responsibility, that chain together from raw CSV to a natural-language explanation a government administrator can act on.

```
CSV (CPCB India Air Quality)
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│  AGENT 1 — Ingestion Agent                                   │
│  data/run_city_pipeline.py  →  ingest.py                     │
│  • Filters CSV by city, expands daily → 24 hourly rows       │
│  • Joins lat/lon from location_coords.csv                    │
│  • Merges Open-Meteo weather (temperature, humidity, wind)   │
│  • Fetches OSM road count per city bbox                      │
│  Output: ingested_data.parquet                               │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│  AGENT 2 — Attribution Agent                                 │
│  data/fetch_osm.py  +  data/traffic_proxy.py                 │
│  • OSM highway class weights (motorway 10× → resident 0.5×) │
│  • Industrial/construction proximity (exponential decay)     │
│  • Ground-truth matching (DPCC/CPCB zone registry)           │
│  • Time-of-day multiplier (AM/PM rush-hour Gaussian peaks)   │
│  Output: osm_attribution.json (confidence 0–100 per hex)     │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│  AGENT 3 — Forecasting Agent                                 │
│  data/h3_binning.py  →  models/features.py  →  models/train │
│  • H3 res-8 hex assignment + hourly aggregation              │
│  • Lag features (1h/6h/24h), rolling means, cyclical time   │
│  • LightGBM 24h/48h/72h models, chronological 80/20 split   │
│  • −17–20% RMSE vs persistence baseline across all cities   │
│  Output: lgbm_model_{24|48|72}h.pkl per city                 │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│  AGENT 4 — Prioritization Agent                              │
│  backend/main.py:  GET /recommendations                      │
│  Composite urgency score (0–100):                            │
│    severity 30%  +  forecast trend 30%  +                    │
│    source confidence 20%  +  vulnerability proximity 20%     │
│  Vulnerability = schools×3 + hospitals×2.5 (OSM, 500m)      │
│  Output: ranked enforcement actions + evidence basis         │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│  AGENT 5 — Reasoning Agent                          ★ NEW   │
│  backend/reasoning_agent.py                                  │
│  GET /recommendations/{hex_id}/explain                       │
│  Takes the structured Prioritization output and generates a  │
│  natural-language explanation of WHY this zone was ranked    │
│  where it was — causal narrative for administrators.         │
│  • LLM: Gemini Flash when GEMINI_API_KEY is set              │
│  • Falls back to deterministic template (always functional)  │
│  • Ground truth scores unchanged — reasoning layer only      │
│  Output: explanation + method + agent_pipeline trace         │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│  AGENT 6 — Advisory Agent                                    │
│  backend/main.py:  GET /advisory                             │
│  CPCB band → citizen-facing advisory in EN / HI / KN        │
│  Two audience variants: general public + sensitive groups    │
│  Output: multilingual health guidance (frontend banner)      │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
frontend/src/  (React + Vite + Deck.gl)
    ├── App.jsx                     ← map, city selector, controls
    ├── SummaryStrip.jsx            ← hero stats + heartbeat ticker
    ├── AlertsPanel.jsx             ← band-crossing signal alerts
    ├── RecommendationsPanel.jsx    ← enforcement log
    │     └── "Why this was flagged" — Reasoning Agent output
    ├── HexPopup.jsx                ← sparkline + confidence bars
    ├── CityComparison.jsx          ← cross-city comparison table
    ├── AdvisoryBanner.jsx          ← multilingual citizen advisory
    └── FeatureTour.jsx             ← 9-step guided demo walkthrough
```

> Each pipeline stage is independently runnable, has its own input/output contract,
> and can be upgraded without breaking the others. Agent 5 (Reasoning) is the only
> stage with an external LLM dependency — all other agents are fully deterministic.

---

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+

### 1. Install Python dependencies

```bash
pip install -r backend/requirements.txt
pip install -r data/requirements.txt
```

### 2. Run the pipeline (all 4 cities)

```bash
# From project root — ingests, bins, engineers features, trains models
python data/run_city_pipeline.py

# Or for a single city:
python data/run_city_pipeline.py --cities Delhi
```

### 3. Build OSM attribution cache (Delhi)

```bash
python data/fetch_osm.py          # class-weighted road + industrial + construction
python data/fetch_vulnerability.py # schools/hospitals/parks within 500m
```

### 4. Start the backend

```bash
# Must run from project root (paths are relative)
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```


### 5a. (Optional) Enable LLM Reasoning Agent

The Reasoning Agent (Agent 5) generates natural-language explanations for
why each zone was prioritized. It works immediately with a deterministic
fallback, but plug in an LLM key for richer output:

```bash
# Edit .env in the project root (already gitignored):
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

Get a free key at **https://openrouter.ai/keys** — uses `google/gemini-2.5-flash`
which is in the free tier. Restart the backend after adding the key.

Alternatively set `GEMINI_API_KEY` for direct Google AI Studio access.

### 5. Start the frontend

```bash
cd frontend
npm install        # first time only
npm run dev
```

Open **http://localhost:5173**

---

## API Reference

All endpoints accept an optional `?city=` parameter (`Delhi` | `Ghaziabad` | `Noida` | `Mumbai`). Defaults to Delhi.

### Map Data

| Method | Endpoint | Description |
|---|---|---|
| GET | `/current` | Current AQI GeoJSON per hex |
| GET | `/forecast?hours=24\|48\|72` | Forecast AQI GeoJSON |
| GET | `/hex-history?hex_id=<id>` | Last-24h actual + 24/48/72h forecasts for one hex |
| GET | `/forecast-compare` | Current band vs 24h forecast band per hex |

### Source Attribution

| Method | Endpoint | Description |
|---|---|---|
| GET | `/source-attribution` | Per-hex traffic/industrial/construction confidence scores (0–100), ToD-adjusted |
| GET | `/source-attribution-accuracy` | Precision/recall vs DPCC/CPCB ground-truth zones (Delhi only) |
| GET | `/confidence-distribution` | Distribution stats across all hexes |
| GET | `/traffic-proxy-info` | Current ToD multiplier + full diurnal curve + honest-framing disclosure |

### Intelligence

| Method | Endpoint | Description |
|---|---|---|
| GET | `/recommendations` | Urgency-ranked enforcement actions with composite score, evidence basis, vulnerability data |
| GET | `/advisory` | Citizen advisories in EN/HI/KN per CPCB band |

### Multi-City

| Method | Endpoint | Description |
|---|---|---|
| GET | `/cities` | All cities with readiness flags |
| GET | `/city-stats` | Cross-city AQI, forecast trend, Poor+ %, for comparison view |

---

## Feature Deep-Dives

### LightGBM Forecast Models

Three separate models per city (24h / 48h / 72h horizon). Separate models outperform a single multi-horizon model because feature importance differs by horizon — `aqi_lag_24h` dominates the 24h model; longer-range temporal patterns matter more at 72h.

**Features used:**
- Pollutant: `pollutant_avg` (PM2.5-primary composite), lag 1h/6h/24h, rolling mean 6h/24h
- Weather: `temperature`, `humidity`, `wind_speed`, `wind_direction` (Open-Meteo API)
- Infrastructure: `city_road_density` (OSM road count)
- Time: `hour_sin`, `hour_cos`, `dow_sin`, `dow_cos` (cyclical encoding)

**Training:** chronological 80/20 split (no data leakage). Evaluated against persistence baseline (predict tomorrow = today).

### Source Attribution Engine

**Traffic proxy** — derived from OSM highway classification, NOT live vehicle telemetry:

| Highway class | Weight | Basis |
|---|---|---|
| motorway | 10× | Expressway / NH — highest PCU |
| trunk | 7× | Major national/state highway |
| primary | 5× | Major arterial (Ring Road, GT Karnal Road) |
| secondary | 3× | Sub-arterial collector |
| tertiary | 1.5× | Local distributor |
| residential | 0.5× | Neighbourhood street |

Each road segment within ~900m of a hex centroid contributes `class_weight × exp(−d / 450m)`. Normalised across hexes.

**Time-of-day multiplier** (AM peak 09:00, PM peak 18:30, floor 0.35×):

```
02:00  ×0.350  Off-peak / night
09:00  ×1.000  Rush hour (peak)
18:00  ×0.965  Rush hour (peak)
23:00  ×0.357  Off-peak / night
```

Applied at API query time — traffic confidence is lower at 2am (when the same roads are likely quiet) and full at rush hour.

**Industrial** — exponential decay proximity to OSM `landuse=industrial` ways/relations (305 elements fetched for Delhi).

**Construction** — proximity to OSM `landuse=construction`, `building=construction`, `amenity=construction` (164 elements).

**Ground-truth matching** — bonus weight from CPCB/DPCC-tagged monitoring station zone types in `data/ground_truth_zones.geojson`.

**Final confidence formula (traffic):**

```
traffic_conf = 0.40 × road_score_norm
             + 0.35 × gt_match_bonus
             + 0.25 × aqi_signal_norm
```

Then scaled by time-of-day multiplier at query time.

### Composite Urgency Scoring

Each flagged hex is scored on four independent signals (0–100 total):

| Component | Weight | Signal |
|---|---|---|
| Current severity | 30% | CPCB band (Good→Severe normalised 0–1) |
| Forecast trend | 30% | Band worsening over 72h + AQI acceleration |
| Source confidence | 20% | Dominant source confidence (ToD-adjusted) |
| Vulnerability | 20% | Schools × 3 + hospitals × 2.5 + parks × 1, within 500m |

Vulnerability data pulled from OSM for each hex: Zone 01 (Mandir Marg) has 7 schools within 500m; Zone 05 (Bawana) has 2 schools + 5 hospitals.

Sorted descending by urgency score. Priority labels:

| Score | Label |
|---|---|
| ≥ 75 | URGENT |
| ≥ 55 | HIGH |
| ≥ 35 | MEDIUM |
| < 35 | LOW |

### Evidence Basis

Each recommendation includes a one-sentence evidence string built from real computed values:

> *"Based on: 97% industrial-source confidence, 2 schools and 5 hospitals within 500 m, AQI improving Severe→Very Poor (−146 over 24 h)."*

> *"Based on: 71% traffic-proxy confidence (road-class weighted, Rush hour), 7 schools and 1 hospital within 500 m, AQI stable at Very Poor (183)."*

Nothing is hardcoded — every figure is derived from the pipeline at runtime.

### Honest Traffic Proxy Framing

The system is explicit at every layer that traffic scores are structural proxies:

- `data/traffic_proxy.py` module docstring
- `/traffic-proxy-info` endpoint — returns `honest_framing` field
- `/source-attribution` — each feature has `proxy_note`, `tod_regime`, `tod_multiplier`
- `/recommendations` — each item has `traffic_proxy_note`
- Frontend — HexPopup shows `TRAFFIC PROXY · OFF-PEAK / NIGHT · ×0.36 (road-class weighted, not live data)`

### Multi-City Support

The pipeline is fully config-driven via `data/cities.py`. Adding a new city requires:
1. An entry in `CITY_REGISTRY` with bbox, centre, zoom, H3 resolution
2. Stations in `location_coords.csv`
3. Running `python data/run_city_pipeline.py --cities <CityName>`

Each city gets its own `data/cache/<city>/` directory with isolated parquet files and model pickles.

### Cross-City Comparison

`/city-stats` returns AQI, forecast trend, and Poor+ % for all cities side by side. The frontend `CityComparison` component renders this as a clickable table — clicking a row switches the active city and flies the map to that city's centre.

**What the comparison does NOT include:** compliance outcomes or intervention effectiveness. That requires real enforcement outcome data which is not available in this dataset. The comparison covers air quality trends only — this is stated explicitly in the UI and API response.

---

## Project Structure

```
pollution_detection/
├── data/
│   ├── cities.py                   # City registry (bbox, centre, H3 res)
│   ├── config.py                   # Legacy Delhi config (kept for compat)
│   ├── run_city_pipeline.py        # Multi-city pipeline runner
│   ├── ingest.py                   # Single-city ingestion (called by runner)
│   ├── h3_binning.py               # H3 hex assignment + aggregation
│   ├── fetch_osm.py                # Class-weighted road + industrial/construction
│   ├── fetch_vulnerability.py      # Schools/hospitals/parks per hex
│   ├── traffic_proxy.py            # Time-of-day multiplier + honest framing
│   ├── analyze_csv.py              # Data exploration utility
│   ├── verify_hexes.py             # Hex→station mapping diagnostic
│   ├── identify_hexes.py           # Hex ID diagnostic
│   ├── india_air_quality_consolidated.csv
│   ├── location_coords.csv         # Station lat/lon lookup
│   ├── ground_truth_zones.geojson  # DPCC/CPCB-tagged zones for accuracy eval
│   └── cache/
│       ├── delhi/                  # Per-city cached parquets + models
│       ├── ghaziabad/
│       ├── noida/
│       ├── mumbai/
│       ├── osm_attribution.json    # Delhi OSM attribution cache
│       └── vulnerability.json      # Delhi vulnerability cache
├── models/
│   ├── features.py                 # Feature engineering (used by legacy pipeline)
│   └── train.py                    # Legacy single-city training script
├── backend/
│   ├── main.py                     # FastAPI — 17 endpoints, all ?city= aware
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx                 # Main app — map, city selector, controls
│   │   ├── SummaryStrip.jsx        # Hero stats bar + heartbeat ticker
│   │   ├── AlertsPanel.jsx         # Band-crossing signal alerts
│   │   ├── RecommendationsPanel.jsx# Urgency-ranked enforcement log
│   │   ├── HexPopup.jsx            # Hex sparkline + confidence bars
│   │   ├── CityComparison.jsx      # Cross-city comparison table
│   │   ├── AdvisoryBanner.jsx      # Multilingual citizen advisory
│   │   ├── index.css               # Design tokens + component styles
│   │   └── App.css                 # (consolidated into index.css)
│   ├── index.html
│   └── package.json
└── README.md
```

---

## CPCB AQI Bands

| Band | AQI Range | Color |
|---|---|---|
| Good | 0–30 | `#00c853` |
| Satisfactory | 31–60 | `#aeea00` |
| Moderate | 61–90 | `#ffd600` |
| Poor | 91–120 | `#ff6d00` |
| Very Poor | 121–250 | `#dd2c00` |
| Severe | > 250 | `#880e4f` |

---

## Data Sources

| Source | What | License |
|---|---|---|
| [Kaggle — India Air Quality](https://www.kaggle.com/) | CPCB PM2.5/PM10/O3/NO2/SO2/CO, 96,755 rows, 16 cities | Public |
| [Open-Meteo Archive API](https://open-meteo.com/) | Hourly temperature, humidity, wind speed/direction | CC BY 4.0 |
| [OpenStreetMap Overpass API](https://overpass-api.de/) | Roads, industrial landuse, construction, schools, hospitals, parks | ODbL |
| DPCC/CPCB station records | Ground-truth zone tagging (`ground_truth_zones.geojson`) | Public domain |

---

## Limitations & Honest Caveats

1. **Traffic is a proxy, not live data.** `traffic_confidence` is derived from OSM highway classification and a time-of-day diurnal curve. It is not GPS telemetry, not real-time congestion data, and not any mobility feed.

2. **6 hexes per city.** The dataset has 4–6 monitoring stations per city. H3 res-8 maps each station to one hex, so spatial coverage is coarse — not wall-to-wall. This is a limitation of the source data density, not the pipeline design.

3. **Compliance outcomes not included.** The cross-city comparison covers air quality trends only. Intervention effectiveness requires real enforcement outcome data (GRAP compliance logs, vehicle restriction records) which is not in this dataset.

4. **Industrial attribution (non-Delhi).** The OSM-based industrial/construction proximity cache is only fully computed for Delhi. Other cities use rule-based fallback scores.

5. **Weather is city-centre average.** Open-Meteo provides one weather time series per city bounding-box centroid, not per-station or per-hex. Wind direction variation within a city is not captured.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Data ingestion | Python, pandas, requests, Open-Meteo API, OSM Overpass |
| Geospatial indexing | h3-py (resolution 8, configurable per city) |
| ML Forecast | LightGBM (3 models per city: +24h, +48h, +72h) |
| ML evaluation | scikit-learn RMSE vs persistence baseline |
| Backend API | FastAPI + Uvicorn (17 endpoints) |
| Frontend map | React + Vite + Deck.gl (GeoJsonLayer) + MapLibre GL (CartoDB dark basemap) |
| Fonts | JetBrains Mono (instrumentation numerics) + Inter (body) |
| OSM data | Overpass API — highway classification, landuse, amenities |
