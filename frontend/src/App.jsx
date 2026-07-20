import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers';
import { FlyToInterpolator } from '@deck.gl/core';
import SummaryStrip from './SummaryStrip';
import AlertsPanel from './AlertsPanel';
import AdvisoryBanner from './AdvisoryBanner';
import HexPopup from './HexPopup';
import RecommendationsPanel from './RecommendationsPanel';
import CityComparison from './CityComparison';
import FeatureTour from './FeatureTour';
import './index.css';

// ─── Constants ────────────────────────────────────────────────────────────────
const INITIAL_VIEW_STATE = {
  longitude: 77.2090,
  latitude:  28.6139,
  zoom:      11,
  pitch:     30,
  bearing:   0,
  minZoom:   2,
  maxZoom:   18,
  transitionDuration: 0,
};

const CARTO_DARK_TILE = 'https://a.basemaps.cartocdn.com/dark_matter_nolabels/{z}/{x}/{y}@2x.png';
const API_BASE = 'http://localhost:8000';

const LEGEND = [
  { band: 'Good',         color: '#00c853' },
  { band: 'Satisfactory', color: '#aeea00' },
  { band: 'Moderate',     color: '#ffd600' },
  { band: 'Poor',         color: '#ff6d00' },
  { band: 'Very Poor',    color: '#dd2c00' },
  { band: 'Severe',       color: '#880e4f' },
];

const HORIZON_STEPS = ['0', '24', '48', '72'];

function hexToRGBA(hex, alpha = 190) {
  if (!hex || hex.length < 7) return [80, 80, 80, alpha];
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
    alpha,
  ];
}

function pct(v) {
  return v !== null && v !== undefined ? `${(v * 100).toFixed(0)}%` : '—';
}

// ─── App ─────────────────────────────────────────────────────────────────────
function App() {
  const [horizon, setHorizon]         = useState('0');
  const [activeCity, setActiveCity]   = useState('Delhi');
  const [geoData, setGeoData]         = useState(null);
  const [sourceData, setSourceData]   = useState(null);
  const [compareData, setCompareData] = useState(null);
  const [accuracy, setAccuracy]       = useState(null);
  const [loading, setLoading]         = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [playing, setPlaying]         = useState(false);
  const [viewState, setViewState]     = useState(INITIAL_VIEW_STATE);
  const [selectedHex, setSelectedHex] = useState(null);
  const [currentBand, setCurrentBand] = useState(null);
  const [showComparison, setShowComparison] = useState(false);

  const playIntervalRef = useRef(null);

  // ─── Play / Pause ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (playing) {
      playIntervalRef.current = setInterval(() => {
        setHorizon(prev => {
          const idx = HORIZON_STEPS.indexOf(prev);
          return HORIZON_STEPS[(idx + 1) % HORIZON_STEPS.length];
        });
      }, 2000);
    } else {
      clearInterval(playIntervalRef.current);
    }
    return () => clearInterval(playIntervalRef.current);
  }, [playing]);

  // ─── Fetch AQI GeoJSON — city-aware ────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setSelectedHex(null);   // clear popup on city change
    const cityParam = `&city=${activeCity}`;
    const url = horizon === '0'
      ? `${API_BASE}/current?city=${activeCity}`
      : `${API_BASE}/forecast?hours=${horizon}${cityParam}`;
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => setGeoData(d))
      .catch(e => console.error('AQI fetch failed:', e))
      .finally(() => setLoading(false));
  }, [horizon, activeCity]);

  // ─── One-off fetches — city-aware ──────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE}/source-attribution?city=${activeCity}`)
      .then(r => r.json()).then(setSourceData)
      .catch(e => console.error('Source fetch failed:', e));

    fetch(`${API_BASE}/forecast-compare?city=${activeCity}`)
      .then(r => r.json()).then(setCompareData)
      .catch(e => console.error('Forecast-compare fetch failed:', e));

    // Accuracy only meaningful for Delhi (has ground truth zones)
    if (activeCity === 'Delhi') {
      fetch(`${API_BASE}/source-attribution-accuracy`)
        .then(r => r.json()).then(setAccuracy)
        .catch(e => console.error('Accuracy fetch failed:', e));
    } else {
      setAccuracy(null);
    }
  }, [activeCity]);

  // ─── Source lookup ──────────────────────────────────────────────────────────
  const srcLookup = useMemo(() => {
    if (!sourceData) return {};
    const m = {};
    sourceData.features.forEach(f => { m[f.properties.h3_hex] = f.properties; });
    return m;
  }, [sourceData]);

  // ─── Fly-to ─────────────────────────────────────────────────────────────────
  const flyToHex = useCallback((lat, lon) => {
    setViewState(vs => ({
      ...vs, latitude: lat, longitude: lon, zoom: 14,
      transitionDuration: 1200,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.5 }),
    }));
  }, []);

  // Switch to a different city — update state and fly to its centre
  const handleCitySelect = useCallback((cityStats) => {
    setActiveCity(cityStats.city);
    setHorizon('0');
    setPlaying(false);
    setViewState(vs => ({
      ...vs,
      latitude:  cityStats.map_lat,
      longitude: cityStats.map_lon,
      zoom:      cityStats.map_zoom,
      transitionDuration: 1400,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.2 }),
    }));
  }, []);

  // ─── Layers ─────────────────────────────────────────────────────────────────
  const layers = useMemo(() => {
    const result = [];

    result.push(new TileLayer({
      id: 'basemap',
      data: CARTO_DARK_TILE,
      maxRequests: 20,
      pickable: false,
      minZoom: 0,
      maxZoom: 19,
      tileSize: 256,
      renderSubLayers: props => {
        const { bbox: { west, south, east, north } } = props.tile;
        return new BitmapLayer(props, {
          data: null,
          image: props.data,
          bounds: [west, south, east, north],
        });
      },
    }));

    if (geoData?.features?.length) {
      result.push(new GeoJsonLayer({
        id: 'aqi-layer',
        data: geoData,
        pickable: true,
        filled: true,
        stroked: true,
        getFillColor: d => hexToRGBA(d.properties?.fillColor),
        getLineColor: [255, 255, 255, 30],
        lineWidthMinPixels: 1,
        getLineWidth: 5,
        updateTriggers: { getFillColor: [horizon, geoData] },
        transitions: { getFillColor: { duration: 700, type: 'interpolation' } },
        onClick: ({ object, x, y }) => {
          if (object?.properties) setSelectedHex({ props: object.properties, screenX: x, screenY: y });
        },
      }));
    }

    if (showSources && sourceData?.features?.length) {
      result.push(new GeoJsonLayer({
        id: 'source-layer',
        data: sourceData,
        pickable: false,
        filled: false,
        stroked: true,
        getLineColor: d => {
          if (d.properties?.traffic_linked)    return [245, 158, 11, 220];
          if (d.properties?.industrial_linked) return [139, 92, 246, 220];
          return [0, 0, 0, 0];
        },
        lineWidthMinPixels: 2,
        getLineWidth: 30,
      }));
    }

    return result;
  }, [geoData, sourceData, showSources, horizon]);

  // ─── Tooltip ────────────────────────────────────────────────────────────────
  const getTooltip = ({ object }) => {
    if (!object?.properties) return null;
    const p = object.properties;
    // Look up zone label from source data
    const zoneLabel = srcLookup[p.h3_hex]?.zone_label || p.h3_hex?.slice(0, 10);
    const domSrc    = srcLookup[p.h3_hex]?.dominant_source;
    const domConf   = srcLookup[p.h3_hex]?.dominant_confidence;
    return {
      html: `<div class="deck-tooltip">
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.62rem;letter-spacing:0.14em;text-transform:uppercase;color:#00d4ff;margin-bottom:3px">${zoneLabel}</div>
        <div class="tooltip-title" style="font-size:0.52rem;opacity:0.5;margin-bottom:6px">${p.h3_hex || ''}</div>
        <div style="display:flex;justify-content:space-between;margin:5px 0;font-family:'JetBrains Mono',monospace;font-size:0.78rem">
          <span style="color:#4a5568;letter-spacing:0.06em">AQI</span>
          <strong style="color:${p.fillColor || '#e8edf4'};font-size:1rem;letter-spacing:-0.02em">${Number(p.aqi || 0).toFixed(0)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;margin:5px 0;font-size:0.72rem">
          <span style="color:#4a5568;font-family:'JetBrains Mono',monospace;letter-spacing:0.06em">BAND</span>
          <span style="color:${p.fillColor || '#e8edf4'};font-family:'JetBrains Mono',monospace;font-weight:700;letter-spacing:0.08em;text-transform:uppercase">${p.cpcb_band || '—'}</span>
        </div>
        ${domSrc ? `<div style="display:flex;justify-content:space-between;margin:5px 0;font-size:0.68rem">
          <span style="color:#4a5568;font-family:'JetBrains Mono',monospace;letter-spacing:0.06em">SOURCE</span>
          <span style="color:#00d4ff;font-family:'JetBrains Mono',monospace;font-weight:700;letter-spacing:0.06em;text-transform:uppercase">${domSrc} ${domConf?.toFixed(0)}%</span>
        </div>` : ''}
        ${p.is_forecast ? `<div style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#4a5568;margin-top:5px;letter-spacing:0.08em">FORECAST +${horizon}H</div>` : ''}
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.58rem;color:#2d3748;margin-top:6px;letter-spacing:0.06em">CLICK FOR TELEMETRY →</div>
      </div>`,
      style: { background: 'transparent', border: 'none', padding: 0 },
    };
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: 'var(--bg-base)' }}>

      {/* Advisory banner */}
      <AdvisoryBanner currentBand={currentBand} />

      {/* Summary hero strip */}
      <SummaryStrip geoData={geoData} horizon={horizon} activeCity={activeCity} onBandChange={setCurrentBand} />

      {/* Left column */}
      <div className="left-panel-col">
        <AlertsPanel compareData={compareData} srcLookup={srcLookup} onSelectHex={flyToHex} />
        <RecommendationsPanel onSelectHex={flyToHex} activeCity={activeCity} />
        {showComparison && (
          <CityComparison onSelectCity={handleCitySelect} activeCity={activeCity} />
        )}
      </div>

      {/* Map */}
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => setViewState(vs)}
        controller={true}
        layers={layers}
        getTooltip={getTooltip}
        style={{ position: 'absolute', inset: 0 }}
        onClick={({ object }) => { if (!object) setSelectedHex(null); }}
      />

      {/* Hex popup */}
      {selectedHex && (
        <HexPopup
          hexProps={selectedHex.props}
          screenX={selectedHex.screenX}
          screenY={selectedHex.screenY}
          horizon={horizon}
          srcLookup={srcLookup}
          onClose={() => setSelectedHex(null)}
          apiBase={API_BASE}
          activeCity={activeCity}
        />
      )}

      {/* ─── Right control panel ─────────────────────────────────────────── */}
      <div className="ui-panel" id="tour-control-panel">

        {/* Identity */}
        <div id="tour-identity">
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.58rem',
            letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'var(--accent)', marginBottom: 5,
          }}>
            AQI · INTEL / {activeCity.toUpperCase()}
          </div>
          <h1>Air Quality<br />Intelligence</h1>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.6rem',
            color: 'var(--text-dim)', letterSpacing: '0.08em', marginTop: 4,
          }}>
            H3 HEX · LGBM · 72H AHEAD
          </div>
        </div>

        {/* City selector */}
        <div id="tour-city-selector">
          <h2>Active City</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {['Delhi','Ghaziabad','Noida','Mumbai'].map(c => (
              <button
                key={c}
                onClick={() => {
                  // Fly to city centre — reuse city-stats data or known defaults
                  const CENTRES = {
                    Delhi:      { map_lat: 28.6139, map_lon: 77.2090, map_zoom: 11 },
                    Ghaziabad:  { map_lat: 28.6692, map_lon: 77.4538, map_zoom: 12 },
                    Noida:      { map_lat: 28.5355, map_lon: 77.3910, map_zoom: 12 },
                    Mumbai:     { map_lat: 19.0760, map_lon: 72.8777, map_zoom: 11 },
                  };
                  handleCitySelect({ city: c, display: c, ...(CENTRES[c] || CENTRES.Delhi) });
                }}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.62rem',
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  background: activeCity === c ? 'rgba(0,212,255,0.15)' : 'transparent',
                  border: `1px solid ${activeCity === c ? 'var(--accent)' : 'var(--border-dim)'}`,
                  color: activeCity === c ? 'var(--accent)' : 'var(--text-secondary)',
                  borderRadius: 2,
                  padding: '4px 8px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  if (activeCity !== c) {
                    e.target.style.borderColor = 'var(--border-hi)';
                    e.target.style.color = 'var(--text-primary)';
                  }
                }}
                onMouseLeave={e => {
                  if (activeCity !== c) {
                    e.target.style.borderColor = 'var(--border-dim)';
                    e.target.style.color = 'var(--text-secondary)';
                  }
                }}
              >{c}</button>
            ))}
          </div>
        </div>

        {/* Loading indicator */}
        {loading && (
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.6rem',
            color: 'var(--accent)',
            letterSpacing: '0.12em',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: -6,
          }}>
            <span className="heartbeat-dot" />
            FETCHING DATA…
          </div>
        )}

        {/* Horizon control */}
        <div className="control-group" id="tour-horizon">
          <h2>Forecast Horizon</h2>
          <div className="button-group">
            {[['0','NOW'],['24','+24H'],['48','+48H'],['72','+72H']].map(([val, label]) => (
              <button
                key={val}
                className={horizon === val ? 'active' : ''}
                onClick={() => setHorizon(val)}
              >{label}</button>
            ))}
          </div>
          <div className="play-pause-controls">
            <button className="play-pause-btn" onClick={() => setPlaying(p => !p)}>
              {playing ? '⏸ PAUSE' : '▶ PLAY'}
            </button>
            {playing && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
                CYCLING…
              </span>
            )}
          </div>
        </div>

        {/* Source attribution toggle */}
        <div id="tour-source-toggle">
          <div className="toggle-row" style={{ marginBottom: 6 }}>
            <span>Source Attribution</span>
            <label className="switch">
              <input type="checkbox" checked={showSources} onChange={e => setShowSources(e.target.checked)} />
              <span className="slider" />
            </label>
          </div>
          {showSources && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingLeft: 2 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: '#fbbf24', letterSpacing: '0.06em' }}>◆ TRAFFIC</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: '#a78bfa', letterSpacing: '0.06em' }}>◆ INDUSTRIAL</span>
              </div>
              {/* Traffic proxy disclosure — visible whenever source overlay is on */}
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.55rem',
                color: 'var(--text-dim)', letterSpacing: '0.05em',
                lineHeight: 1.5, padding: '5px 7px',
                border: '1px solid var(--border-dim)', borderRadius: 2,
                background: 'rgba(0,0,0,0.2)',
              }}>
                <span style={{ color: 'var(--accent)', letterSpacing: '0.1em' }}>PROXY NOTE</span>
                {' '}Traffic scores = OSM road-class weights (motorway 10× → residential 0.5×) + time-of-day scaling.
                {' '}<span style={{ color: '#2d3748' }}>Not live vehicle telemetry.</span>
              </div>
            </div>
          )}
        </div>

        {/* Cross-city comparison toggle */}
        <div className="toggle-row">
          <span>Cross-City Comparison</span>
          <label className="switch">
            <input type="checkbox" checked={showComparison} onChange={e => setShowComparison(e.target.checked)} />
            <span className="slider" />
          </label>
        </div>

        {/* CPCB legend */}
        <div className="control-group">
          <h2>CPCB AQI Scale</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {LEGEND.map(({ band, color }) => (
              <div key={band} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 10, height: 10,
                  background: color,
                  flexShrink: 0,
                  clipPath: 'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
                }} />
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>{band}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Model stats */}
        <div className="stats-box" id="tour-model-stats">
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.58rem',
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
            borderBottom: '1px solid var(--border-dim)',
            paddingBottom: 7,
            marginBottom: 8,
          }}>
            Model Performance
          </div>

          <div className="stats-row">
            <span>Persistence RMSE</span>
            <span className="stats-val" style={{ color: '#ef4444' }}>40.59</span>
          </div>
          <div className="stats-row">
            <span>LightGBM RMSE</span>
            <span className="stats-val" style={{ color: '#4ade80' }}>32.44</span>
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.6rem',
            color: 'var(--accent)',
            letterSpacing: '0.06em',
            marginTop: 3,
            marginBottom: 10,
          }}>
            ↓ 20% vs. PERSISTENCE
          </div>

          {/* Source accuracy — Delhi only */}
          {activeCity === 'Delhi' && (
            <div style={{ borderTop: '1px solid var(--border-dim)', paddingTop: 8 }}>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.56rem',
                letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'var(--text-dim)', marginBottom: 7,
              }}>Attribution Accuracy</div>
              {!accuracy ? (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--text-dim)' }}>LOADING…</div>
              ) : (
                <>
                  <div className="stats-row">
                    <span>Traffic Precision</span>
                    <span className="stats-val" style={{ color: '#fbbf24' }}>{pct(accuracy.traffic?.precision)}</span>
                  </div>
                  <div className="stats-row">
                    <span>Traffic Recall</span>
                    <span className="stats-val" style={{ color: '#fbbf24' }}>{pct(accuracy.traffic?.recall)}</span>
                  </div>
                  <div className="stats-row">
                    <span>Industrial Precision</span>
                    <span className="stats-val" style={{ color: '#a78bfa' }}>{pct(accuracy.industrial?.precision)}</span>
                  </div>
                  <div className="stats-row">
                    <span>Industrial Recall</span>
                    <span className="stats-val" style={{ color: '#a78bfa' }}>{pct(accuracy.industrial?.recall)}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Lead time */}
          <div style={{ borderTop: '1px solid var(--border-dim)', paddingTop: 8, marginTop: 8 }}>
            <div className="stats-row">
              <span>Forecast Lead Time</span>
              <span className="stats-val" style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>72H</span>
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.56rem',
              color: 'var(--text-dim)',
              marginTop: 3,
              letterSpacing: '0.04em',
              lineHeight: 1.5,
            }}>
              VS. 0H REACTIVE (CAAQMS)
            </div>
          </div>
        </div>

      </div>
      {/* ─── Feature Tour ────────────────────────────────────────────────── */}
      <FeatureTour />

    </div>
  );
}

export default App;
