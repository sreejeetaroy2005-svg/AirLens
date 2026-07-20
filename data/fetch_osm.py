"""
fetch_osm.py — Pull OSM features for Delhi hexes and compute per-hex
traffic-proxy confidence scores using highway class weights + industrial/
construction proximity.

IMPORTANT — HONEST FRAMING:
  "traffic_confidence" in this system is a TRAFFIC PROXY derived from:
    - OSM highway classification (motorway > trunk > primary > secondary > tertiary)
    - Road class weights calibrated to approximate relative traffic volumes
      (motorway ≈10× tertiary by vehicle-km-travelled, sourced from CPCB & MoRTH data)
    - Time-of-day scaling applied at query time in the API
  It is NOT live vehicle telemetry, NOT real-time congestion data, and NOT
  derived from any mobility feed. There is no live traffic API integrated.
  The proxy is honest about its basis and should be described as such in any
  public-facing materials.

Run from project root:
    python data/fetch_osm.py
"""
import os, sys, json, math, time
import requests
import h3 as h3lib
import pandas as pd
import numpy as np

HEADERS = {
    'User-Agent': 'PollutionDetectionResearch/1.0 (hackathon)',
    'Accept':     'application/json',
}
OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
BBOX = '28.50,76.98,28.91,77.36'   # Delhi bounding box

# ── Highway class → traffic-volume weight ────────────────────────────────────
# Weights approximate relative PCU (Passenger Car Units) per class.
# Source basis: MoRTH Annual Report traffic volume categories + CPCB road-type
# pollution factor guidance. Motorway/expressway = highest volume; residential = lowest.
# These are ORDER-OF-MAGNITUDE calibrations, not measured traffic counts.
HIGHWAY_WEIGHTS = {
    'motorway':     10.0,   # expressway / NH — highest volume
    'trunk':         7.0,   # major national/state highway
    'primary':       5.0,   # major arterial (Ring Road, GT Karnal Road)
    'secondary':     3.0,   # sub-arterial (collector roads)
    'tertiary':      1.5,   # local distributor
    'residential':   0.5,   # neighbourhood street — lowest weight
    'unclassified':  0.8,   # mapped but unclassified local road
    'service':       0.3,   # access roads, parking lanes
}

# Ground-truth zone lookup (Delhi CPCB/DPCC stations)
GT_ZONES = {
    '883da11441fffff': 'traffic',
    '883da1149bfffff': 'traffic',
    '883da11563fffff': 'traffic',
    '883da18405fffff': 'industrial',
    '883da18565fffff': 'industrial',
    '883da18d9dfffff': 'traffic',
}

OUTPUT_PATH = 'data/cache/osm_attribution.json'
HEX_RADIUS_M = 900   # ~2× H3 res-8 hex radius for road search window


def overpass_query(ql: str, retries: int = 3) -> dict:
    for attempt in range(retries):
        try:
            r = requests.post(OVERPASS_URL, data={'data': ql},
                              headers=HEADERS, timeout=45)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            print(f'  [attempt {attempt+1}] Overpass error: {e}')
            if attempt < retries - 1:
                time.sleep(4)
    return {'elements': []}


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = (math.sin(dphi/2)**2
         + math.cos(phi1) * math.cos(phi2) * math.sin(dlam/2)**2)
    return 2 * R * math.asin(math.sqrt(a))


def hex_centre(hex_id: str):
    try:    return h3lib.h3_to_geo(hex_id)
    except: return h3lib.cell_to_latlng(hex_id)


def element_centre(el: dict):
    if el.get('type') == 'node':
        return el.get('lat'), el.get('lon')
    c = el.get('center', {})
    return c.get('lat'), c.get('lon')


def weighted_road_score(hex_id: str, road_elements: list) -> tuple[float, dict]:
    """
    Compute a class-weighted road score for a hex.

    For each road segment whose centre falls within HEX_RADIUS_M of the hex
    centroid, apply an exponential distance decay and multiply by the highway
    class weight.  Sum all contributions and return both the raw weighted score
    and a breakdown by highway class.

    This produces a proxy for relative traffic-emission potential from road
    infrastructure — NOT a live traffic volume measurement.

    Returns
    -------
    total_weighted : float
        Sum of (class_weight × distance_decay) for all nearby roads.
    class_breakdown : dict
        {highway_class: weighted_contribution} for transparency/debugging.
    """
    hlat, hlon = hex_centre(hex_id)
    total   = 0.0
    by_class: dict[str, float] = {}

    for el in road_elements:
        elat, elon = element_centre(el)
        if elat is None or elon is None:
            continue
        d = haversine_m(hlat, hlon, elat, elon)
        if d > HEX_RADIUS_M:
            continue   # outside search window

        hw_class = el.get('tags', {}).get('highway', 'unclassified')
        weight   = HIGHWAY_WEIGHTS.get(hw_class, 0.8)

        # Exponential distance decay: full weight at 0m, half at 450m
        decay = math.exp(-d / (HEX_RADIUS_M / 2.0 / math.log(2)))
        contribution = weight * decay
        total += contribution
        by_class[hw_class] = by_class.get(hw_class, 0.0) + contribution

    return total, by_class


def proximity_score(hex_id: str, elements: list, decay_m: float = 800) -> float:
    """
    Exponential-decay proximity score [0,1] for industrial/construction elements.
    """
    hlat, hlon = hex_centre(hex_id)
    total = 0.0
    for el in elements:
        elat, elon = element_centre(el)
        if elat is None or elon is None:
            continue
        d = haversine_m(hlat, hlon, elat, elon)
        total += math.exp(-d / (decay_m / math.log(2)))
    return 1 - math.exp(-total)   # logistic squeeze to [0, 1]


def gt_match_score(hex_id: str) -> dict:
    zone_type = GT_ZONES.get(hex_id)
    return {
        'traffic':      1.0 if zone_type == 'traffic'    else 0.0,
        'industrial':   1.0 if zone_type == 'industrial' else 0.0,
        'construction': 0.0,
    }


def compute_confidence(
    road_score_norm: float,   # weighted road score, normalised 0–1 across hexes
    ind_prox: float,
    const_prox: float,
    gt: dict,
    aqi: float,
) -> dict:
    """
    Weighted combination → source confidence scores, 0–100.

    Traffic component uses the CLASS-WEIGHTED road score (road_score_norm),
    not a flat road count.  This means a hex adjacent to a motorway scores
    much higher than one with the same number of residential streets.

    NOTE: The resulting "traffic_confidence" is a STRUCTURAL TRAFFIC PROXY.
    It represents how much high-volume road infrastructure is near this hex,
    adjusted for ground-truth station matching and AQI signal.
    It does NOT represent measured or real-time traffic volume.

    Weights (sum to 1.0 per source):
      Traffic:      road_score(0.40) + gt_match(0.35) + aqi_signal(0.25)
      Industrial:   ind_proximity(0.45) + gt_match(0.40) + aqi_signal(0.15)
      Construction: const_proximity(0.55) + aqi_signal(0.30) + road_score(0.15)
    """
    aqi_norm = min(aqi / 300.0, 1.0)

    traffic_conf = (
        0.40 * road_score_norm +
        0.35 * gt['traffic']   +
        0.25 * aqi_norm
    )
    industrial_conf = (
        0.45 * ind_prox       +
        0.40 * gt['industrial'] +
        0.15 * aqi_norm
    )
    construction_conf = (
        0.55 * const_prox     +
        0.30 * aqi_norm       +
        0.15 * road_score_norm
    )

    return {
        'traffic':      round(traffic_conf * 100, 1),
        'industrial':   round(industrial_conf * 100, 1),
        'construction': round(construction_conf * 100, 1),
    }


def fetch_roads_by_class(bbox: str) -> list:
    """
    Fetch OSM road segments for all highway classes in HIGHWAY_WEIGHTS.
    Returns elements WITH tags so we can read the highway class.
    Split into two Overpass calls to stay under timeout limits.
    """
    # High-volume roads
    q1 = (
        f'[out:json][timeout:40];'
        f'(way[highway=motorway]({bbox});'
        f'way[highway=trunk]({bbox});'
        f'way[highway=primary]({bbox});'
        f'way[highway=secondary]({bbox}););'
        f'out center tags;'
    )
    # Lower-volume roads
    q2 = (
        f'[out:json][timeout:40];'
        f'(way[highway=tertiary]({bbox});'
        f'way[highway=residential]({bbox});'
        f'way[highway=unclassified]({bbox});'
        f'way[highway=service]({bbox}););'
        f'out center tags;'
    )
    els1 = overpass_query(q1).get('elements', [])
    time.sleep(2)
    els2 = overpass_query(q2).get('elements', [])
    return els1 + els2


def main():
    features_path = 'data/cache/features.parquet'
    if not os.path.exists(features_path):
        print(f'ERROR: {features_path} not found. Run feature pipeline first.')
        sys.exit(1)

    df     = pd.read_parquet(features_path)
    latest = df.loc[df.groupby('h3_hex')['timestamp_hr'].idxmax()].copy()
    hexes  = latest['h3_hex'].tolist()
    aqi_map = dict(zip(latest['h3_hex'], latest['pollutant_avg']))

    # Also capture the latest hour so we can report what the ToD multiplier
    # would be — the OSM cache stores BASE scores; ToD is applied at API query time
    latest_hour = int(latest['hour'].iloc[0]) if 'hour' in latest.columns else 12
    print(f'Hexes to score: {len(hexes)}, latest data hour: {latest_hour:02d}:00')

    # ── Fetch OSM data ────────────────────────────────────────────────────────
    print('\nFetching OSM roads by class (motorway → service)…')
    road_elements = fetch_roads_by_class(BBOX)
    # Report class breakdown
    class_counts: dict[str, int] = {}
    for el in road_elements:
        cls = el.get('tags', {}).get('highway', 'unknown')
        class_counts[cls] = class_counts.get(cls, 0) + 1
    print(f'  → {len(road_elements)} road segments:')
    for cls, cnt in sorted(class_counts.items(), key=lambda x: -x[1]):
        w = HIGHWAY_WEIGHTS.get(cls, 0.8)
        print(f'     {cls:<16s} {cnt:5d} segments  weight={w}')

    print('\nFetching OSM industrial ways…')
    q_ind = (
        f'[out:json][timeout:35];'
        f'(way[landuse=industrial]({BBOX});'
        f'relation[landuse=industrial]({BBOX}););'
        f'out center;'
    )
    ind_elements = overpass_query(q_ind).get('elements', [])
    print(f'  → {len(ind_elements)} industrial elements')
    time.sleep(2)

    print('Fetching OSM construction ways/nodes…')
    q_const = (
        f'[out:json][timeout:35];'
        f'(way[landuse=construction]({BBOX});'
        f'node[amenity=construction]({BBOX});'
        f'way[building=construction]({BBOX}););'
        f'out center;'
    )
    const_elements = overpass_query(q_const).get('elements', [])
    print(f'  → {len(const_elements)} construction elements')

    # ── Per-hex class-weighted road score ────────────────────────────────────
    print('\nComputing class-weighted road scores…')
    raw_road_scores = {}
    road_breakdowns = {}
    for hx in hexes:
        score, breakdown = weighted_road_score(hx, road_elements)
        raw_road_scores[hx] = score
        road_breakdowns[hx] = breakdown

    max_road = max(raw_road_scores.values()) or 1.0
    road_norm = {hx: raw_road_scores[hx] / max_road for hx in hexes}

    print('  Class-weighted road scores (raw):')
    for hx, score in raw_road_scores.items():
        breakdown = road_breakdowns[hx]
        top = sorted(breakdown.items(), key=lambda x: -x[1])[:3]
        top_str = ', '.join(f'{c}={v:.1f}' for c, v in top)
        print(f'    {hx[:10]}… score={score:.1f} (norm={road_norm[hx]:.3f}) [{top_str}]')

    # ── Build attribution records ─────────────────────────────────────────────
    results = {}
    for i, hx in enumerate(hexes, 1):
        lat, lon = hex_centre(hx)
        aqi      = float(aqi_map.get(hx, 0))
        gt       = gt_match_score(hx)

        ind_prox   = proximity_score(hx, ind_elements,   decay_m=700)
        const_prox = proximity_score(hx, const_elements, decay_m=600)

        conf = compute_confidence(
            road_score_norm=road_norm[hx],
            ind_prox=ind_prox,
            const_prox=const_prox,
            gt=gt,
            aqi=aqi,
        )

        dominant      = max(conf, key=conf.get)
        dominant_conf = conf[dominant]

        results[hx] = {
            'h3_hex':             hx,
            'zone_label':         f'Zone {i:02d}',
            'lat':                round(lat, 6),
            'lon':                round(lon, 6),
            'current_aqi':        round(aqi, 1),
            # ── Base scores (before time-of-day adjustment) ──────────────────
            # PROXY NOTE: traffic_confidence is derived from OSM highway
            # classification + ground-truth matching + AQI signal. It is NOT
            # live traffic data. Time-of-day scaling is applied at API query
            # time (see backend/main.py: traffic_tod_multiplier()).
            'traffic_confidence':          conf['traffic'],
            'industrial_confidence':       conf['industrial'],
            'construction_confidence':     conf['construction'],
            'dominant_source':             dominant,
            'dominant_confidence':         dominant_conf,
            # Binary flags (backwards compat)
            'traffic_linked':      conf['traffic'] >= 40,
            'industrial_linked':   conf['industrial'] >= 40,
            'construction_linked': conf['construction'] >= 25,
            # Raw signals — stored for auditability
            '_road_score_raw':     round(raw_road_scores[hx], 2),
            '_road_score_norm':    round(road_norm[hx], 4),
            '_road_class_breakdown': {k: round(v, 2) for k, v in road_breakdowns[hx].items()},
            '_ind_proximity':      round(ind_prox, 4),
            '_const_proximity':    round(const_prox, 4),
            '_gt_tag':             GT_ZONES.get(hx, 'none'),
        }

    # ── Save ──────────────────────────────────────────────────────────────────
    os.makedirs('data/cache', exist_ok=True)
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(results, f, indent=2)
    print(f'\nSaved to {OUTPUT_PATH}')

    # ── Distribution report ───────────────────────────────────────────────────
    all_max = [v['dominant_confidence'] for v in results.values()]
    print('\n═══ Confidence Score Distribution (base, before ToD scaling) ═══')
    for t in [30, 50, 70, 80, 90]:
        n = sum(1 for c in all_max if c >= t)
        print(f'  ≥{t}%: {n}/{len(hexes)} ({n/len(hexes)*100:.0f}%)')

    print('\nPer-hex breakdown:')
    for hx, rec in results.items():
        bd = rec['_road_class_breakdown']
        top = sorted(bd.items(), key=lambda x: -x[1])[:2]
        top_str = '+'.join(f'{c}' for c, _ in top)
        print(
            f"  {rec['zone_label']} | "
            f"T:{rec['traffic_confidence']:.1f}%  "
            f"I:{rec['industrial_confidence']:.1f}%  "
            f"C:{rec['construction_confidence']:.1f}%  "
            f"→ {rec['dominant_source'].upper()} @ {rec['dominant_confidence']:.1f}%  "
            f"[road:{top_str}]"
        )

    over70 = sum(1 for c in all_max if c >= 70)
    print(f'\n✓ Hexes with dominant-source confidence >70%: {over70}/{len(hexes)}')


if __name__ == '__main__':
    main()
