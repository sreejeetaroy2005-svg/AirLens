# reasoning_agent.py -- Reasoning Agent for AQI.INTEL
#
# ROLE IN THE MULTI-AGENT PIPELINE:
#   Ingestion Agent -> Attribution Agent -> Forecasting Agent ->
#   Prioritization Agent -> [Reasoning Agent] -> Advisory Agent
#
# LLM BACKEND (tried in order):
#   1. OpenRouter  -- set OPENROUTER_API_KEY in .env  (https://openrouter.ai/keys)
#   2. Gemini SDK  -- set GEMINI_API_KEY in .env       (https://aistudio.google.com)
#   3. Deterministic fallback -- always works, no key required.
#
# DESIGN PRINCIPLE:
#   The existing urgency scores and recommendation text are ground truth
#   and are NEVER modified by this agent. This adds a reasoning layer only.

import os
import re
import requests as _http

# ---------------------------------------------------------------------------
# Load .env
# ---------------------------------------------------------------------------
def _load_dotenv():
    env_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', '.env'
    )
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if v and not os.environ.get(k):
                        os.environ[k] = v

_load_dotenv()

# ---------------------------------------------------------------------------
# Gemini SDK (lazy)
# ---------------------------------------------------------------------------
_gemini_client = None

def _get_gemini():
    global _gemini_client
    if _gemini_client is not None:
        return _gemini_client
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        return None
    try:
        from google import genai
        _gemini_client = genai.Client(api_key=api_key)
        return _gemini_client
    except Exception:
        return None

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------
SYSTEM_CONTEXT = (
    "You are the Reasoning Agent in AQI.INTEL, a multi-agent air quality "
    "intelligence system for Indian smart cities. Explain in 2-3 clear sentences "
    "WHY a specific zone was assigned its urgency rank -- cite the actual numbers, "
    "mention the dominant pollution source and what drives its confidence, mention "
    "vulnerable sites (schools/hospitals) if present, and mention the forecast trend. "
    "Do NOT repeat the recommendation action -- only explain the prioritization logic. "
    "No markdown. Present tense, active voice."
)

# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------
def _build_prompt(rec, rank, total):
    source_desc = {
        'traffic':      'road-traffic emissions (OSM class-weighted road proximity proxy)',
        'industrial':   'industrial activity (DPCC-registered zone proximity)',
        'construction': 'construction activity (OSM site proximity)',
    }.get(rec.get('dominant_source', ''), rec.get('dominant_source', 'unknown'))

    vuln_parts = []
    s = rec.get('schools_500m', 0)
    h = rec.get('hospitals_500m', 0)
    if s: vuln_parts.append("{} school{}".format(s, 's' if s != 1 else ''))
    if h: vuln_parts.append("{} hospital{}".format(h, 's' if h != 1 else ''))
    vuln_str = (', '.join(vuln_parts) + ' within 500m') if vuln_parts else 'no vulnerable sites nearby'

    aqi_now  = rec.get('current_aqi', 0)
    aqi_24h  = rec.get('forecast_24h_aqi', 0)
    delta    = aqi_24h - aqi_now
    bd       = rec.get('urgency_breakdown', {})

    lines = [
        "Zone: {}".format(rec.get('zone_label', rec.get('h3_hex', '?'))),
        "Urgency rank: #{} of {} flagged zones".format(rank, total),
        "Urgency score: {:.1f}/100 (priority: {})".format(
            rec.get('urgency_score', 0), rec.get('priority', '?')),
        "",
        "Urgency components:",
        "  Severity:    {:.1f}/30  (AQI {:.0f}, band: {})".format(
            bd.get('severity_component', 0), aqi_now, rec.get('current_band', '?')),
        "  Trend:       {:.1f}/30  (24h forecast: {} -> {} ({:+.0f} AQI))".format(
            bd.get('trend_component', 0),
            rec.get('current_band', '?'), rec.get('forecast_24h_band', '?'), delta),
        "  Confidence:  {:.1f}/20  (dominant: {} at {:.0f}%)".format(
            bd.get('confidence_component', 0),
            rec.get('dominant_source', '?'), rec.get('dominant_confidence', 0)),
        "    Traffic: {:.0f}%  Industrial: {:.0f}%  Construction: {:.0f}%".format(
            rec.get('traffic_confidence', 0),
            rec.get('industrial_confidence', 0),
            rec.get('construction_confidence', 0)),
        "  Vulnerability: {:.1f}/20  ({}, score {:.0f}/100)".format(
            bd.get('vulnerability_component', 0), vuln_str,
            rec.get('vulnerability_score', 0)),
        "",
        "Source basis: {}".format(source_desc),
        "Time-of-day: {} (traffic multiplier x{:.2f})".format(
            rec.get('tod_regime', ''), rec.get('tod_multiplier', 1.0)),
        "",
        "In 2-3 sentences, explain why this zone was ranked #{} specifically.".format(rank),
    ]
    return '\n'.join(lines)

# ---------------------------------------------------------------------------
# OpenRouter call (OpenAI-compatible endpoint)
# ---------------------------------------------------------------------------
def _call_openrouter(prompt):
    MODEL = "google/gemini-2.5-flash"
    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_CONTEXT},
            {"role": "user",   "content": prompt},
        ],
        "max_tokens": 300,
        "temperature": 0.3,
    }
    headers = {
        "Authorization": "Bearer " + api_key,
        "Content-Type":  "application/json",
        "HTTP-Referer":  "https://github.com/aqi-intel",
        "X-Title":       "AQI-INTEL Reasoning Agent",
    }
    r = _http.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers=headers, json=payload, timeout=20,
    )
    r.raise_for_status()
    text = r.json()["choices"][0]["message"]["content"].strip()
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'^#+\s+', '', text, flags=re.M)
    return text

# ---------------------------------------------------------------------------
# Gemini SDK call
# ---------------------------------------------------------------------------
def _call_gemini(prompt):
    client = _get_gemini()
    if client is None:
        raise RuntimeError("No Gemini client available")
    full = SYSTEM_CONTEXT + "\n\n" + prompt
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=full,
    )
    text = response.text.strip()
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'^#+\s+', '', text, flags=re.M)
    return text

# ---------------------------------------------------------------------------
# Deterministic fallback
# ---------------------------------------------------------------------------
def _deterministic_explanation(rec, rank, total):
    zone      = rec.get('zone_label', rec.get('h3_hex', '?'))
    score     = rec.get('urgency_score', 0)
    src       = rec.get('dominant_source', 'unknown')
    conf      = rec.get('dominant_confidence', 0)
    band      = rec.get('current_band', '?')
    aqi       = rec.get('current_aqi', 0)
    fc24      = rec.get('forecast_24h_aqi', 0)
    fc_band   = rec.get('forecast_24h_band', '?')
    schools   = rec.get('schools_500m', 0)
    hospitals = rec.get('hospitals_500m', 0)
    worsening = rec.get('worsening_24h', False)
    bd        = rec.get('urgency_breakdown', {})
    tod       = rec.get('tod_regime', '')

    src_labels = {
        'traffic':      'traffic-corridor proximity ({:.0f}% confidence from OSM class-weighted road network)'.format(conf),
        'industrial':   'industrial zone proximity ({:.0f}% confidence from DPCC-registered industrial cluster)'.format(conf),
        'construction': 'construction activity ({:.0f}% confidence from OSM site proximity)'.format(conf),
    }
    src_str = src_labels.get(src, '{} source ({:.0f}% confidence)'.format(src, conf))

    delta = fc24 - aqi
    if worsening:
        trend_str = 'the forecast shows further deterioration to {} ({:+.0f} AQI over 24h)'.format(fc_band, delta)
    elif delta < -10:
        trend_str = 'the 24h forecast shows improvement toward {} ({:.0f} AQI)'.format(fc_band, delta)
    else:
        trend_str = 'the 24h forecast holds at {} ({:+.0f} AQI)'.format(fc_band, delta)

    vuln_parts = []
    if schools:   vuln_parts.append('{} school{}'.format(schools,   's' if schools   != 1 else ''))
    if hospitals: vuln_parts.append('{} hospital{}'.format(hospitals, 's' if hospitals != 1 else ''))
    vuln_str = ('{} within 500m elevate the health-risk weight'.format(', '.join(vuln_parts))
                if vuln_parts else 'no flagged sensitive sites nearby')

    sev_comp  = bd.get('severity_component', 0)
    conf_comp = bd.get('confidence_component', 0)
    vuln_comp = bd.get('vulnerability_component', 0)

    explanation = (
        '{} is ranked #{} of {} (urgency {:.0f}/100) '
        'because current AQI of {:.0f} ({}) drives the maximum severity component '
        '({:.0f}/30), while {} contributes {:.0f}/20 to source confidence. '
        'Additionally, {} ({:.0f}/20), and {}.'.format(
            zone, rank, total, score,
            aqi, band, sev_comp,
            src_str, conf_comp,
            vuln_str, vuln_comp,
            trend_str,
        )
    )
    if src == 'traffic' and tod:
        explanation += (
            ' Note: traffic confidence is scaled to x{:.2f} ({} -- road-network proxy, not live telemetry).'.format(
                rec.get('tod_multiplier', 1.0), tod)
        )
    return explanation

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def generate_explanation(rec, rank, total):
    """
    Generate a natural-language explanation for why this zone was prioritized.
    Tries: OpenRouter -> Gemini SDK -> deterministic fallback.

    Returns dict with keys: explanation, method, model, note.
    """
    prompt = _build_prompt(rec, rank, total)

    # 1. OpenRouter
    if os.environ.get("OPENROUTER_API_KEY", ""):
        try:
            text = _call_openrouter(prompt)
            return {
                "explanation": text,
                "method": "openrouter",
                "model": "google/gemini-2.5-flash",
                "note": None,
            }
        except Exception:
            pass

    # 2. Gemini SDK
    if os.environ.get("GEMINI_API_KEY", ""):
        try:
            text = _call_gemini(prompt)
            return {
                "explanation": text,
                "method": "gemini-flash",
                "model": "gemini-2.0-flash",
                "note": None,
            }
        except Exception:
            pass

    # 3. Deterministic fallback
    return {
        "explanation": _deterministic_explanation(rec, rank, total),
        "method": "deterministic-fallback",
        "model": "template",
        "note": "Set OPENROUTER_API_KEY or GEMINI_API_KEY in .env to enable LLM reasoning.",
    }
