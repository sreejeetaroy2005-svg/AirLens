"""
traffic_proxy.py — Time-of-day multiplier for the traffic-source attribution proxy.

HONEST FRAMING (required in any public presentation of this system):
  The traffic confidence scores in this system are a STRUCTURAL TRAFFIC PROXY.
  They are computed from:
    1. OSM highway classification (motorway/trunk/primary/secondary/tertiary/residential)
       with class weights calibrated to approximate relative traffic volumes
    2. Ground-truth matching against CPCB/DPCC monitoring station zone types
    3. AQI signal strength (higher AQI → stronger evidence of an active source)
    4. Time-of-day scaling (this module) — rush-hour hours weighted higher

  What this is NOT:
    - Not live vehicle telemetry
    - Not real-time congestion data
    - Not GPS trace or mobile phone mobility data
    - Not any "mobility feed" in the live-data sense

  The time-of-day multiplier is derived from well-established traffic engineering
  diurnal patterns (AM peak 8–10h, PM peak 17–20h) documented in Delhi's traffic
  studies (Delhi Traffic Police Annual Report, CPCB road-transport AQI studies).
  It adjusts the BASE confidence score — which comes from static infrastructure —
  to reflect that the same road network is more likely to be a dominant pollution
  source during peak hours than at 2am.

Usage:
    from traffic_proxy import traffic_tod_multiplier, apply_tod_to_confidence
"""
import math


# ── Time-of-day multiplier curve ─────────────────────────────────────────────
#
# Shape: two Gaussian peaks centred on typical Delhi rush hours.
#   AM peak: 09:00 (σ = 1.5h)
#   PM peak: 18:30 (σ = 1.5h)
#   Off-peak floor: 0.35 (2am–5am)
#
# The multiplier is [0.35, 1.0]. At peak it returns 1.0 (no penalty, full
# base confidence). At trough (early morning) it returns 0.35.
#
# Source basis: CPCB PM2.5 diurnal studies for Delhi show traffic contribution
# peaks at 08:00–10:00 and 17:00–20:00 (CPCB Air Quality Assessment 2021).

_AM_PEAK_H   = 9.0    # hour of AM peak (24h)
_PM_PEAK_H   = 18.5   # hour of PM peak (24h)
_PEAK_SIGMA  = 1.5    # width (hours) of each rush-hour Gaussian
_FLOOR       = 0.35   # minimum multiplier (deep night)
_CEIL        = 1.0    # maximum multiplier (peak hour)


def traffic_tod_multiplier(hour: float) -> float:
    """
    Returns a time-of-day multiplier in [_FLOOR, _CEIL] for a given hour (0–23).

    The multiplier represents how much MORE likely the observed road network
    is to be the dominant pollution source at this hour vs. a neutral baseline.

    This is a PROXY ADJUSTMENT — it does not measure actual traffic volume.
    It reflects the statistical likelihood that high-class roads are busy
    based on known diurnal patterns for Delhi (AM/PM rush hours).

    Parameters
    ----------
    hour : float  — hour of day, 0–23 (fractional OK)

    Returns
    -------
    float in [0.35, 1.0]
    """
    # Two Gaussians: AM peak + PM peak
    am_peak = math.exp(-0.5 * ((hour - _AM_PEAK_H)  / _PEAK_SIGMA) ** 2)
    pm_peak = math.exp(-0.5 * ((hour - _PM_PEAK_H)  / _PEAK_SIGMA) ** 2)

    # Handle wrap-around for late PM (23h close to 0h)
    pm_wrap = math.exp(-0.5 * ((hour - _PM_PEAK_H + 24) / _PEAK_SIGMA) ** 2)
    pm_peak = max(pm_peak, pm_wrap)

    raw = max(am_peak, pm_peak)  # take the higher of the two peaks
    # Rescale from [0,1] to [_FLOOR, _CEIL]
    return _FLOOR + (_CEIL - _FLOOR) * raw


def apply_tod_to_confidence(base_traffic_conf: float, hour: float) -> float:
    """
    Scale the base traffic confidence by the time-of-day multiplier.

    The base score (from fetch_osm.py) is computed from static infrastructure.
    At query time we adjust it downward during off-peak hours to avoid
    overclaiming road-traffic causation when vehicles are unlikely to be present.

    Parameters
    ----------
    base_traffic_conf : float  — base score 0–100 from OSM attribution cache
    hour              : float  — current hour of day 0–23

    Returns
    -------
    float — adjusted confidence 0–100, never exceeds base_traffic_conf
    """
    multiplier = traffic_tod_multiplier(hour)
    return round(base_traffic_conf * multiplier, 1)


def tod_label(hour: float) -> str:
    """Returns a human-readable label for the current traffic regime."""
    m = traffic_tod_multiplier(hour)
    if m >= 0.85:   return "Rush hour"
    if m >= 0.60:   return "Moderate traffic"
    if m >= 0.45:   return "Light traffic"
    return               "Off-peak / night"


# ── Pre-computed lookup table for the API (avoids math per request) ──────────
# TOD_TABLE[h] = multiplier for hour h (0–23), rounded to 3dp
TOD_TABLE = {h: round(traffic_tod_multiplier(h), 3) for h in range(24)}


if __name__ == '__main__':
    # Print the full diurnal curve for inspection
    print('Time-of-day traffic multiplier curve (PROXY — not live data):')
    print(f'{"Hour":>5}  {"Multiplier":>10}  {"Label":<22}')
    print('-' * 45)
    for h in range(24):
        m   = traffic_tod_multiplier(h)
        lbl = tod_label(h)
        bar = '█' * int(m * 20)
        print(f'  {h:02d}:00  {m:10.3f}  {lbl:<22}  {bar}')
