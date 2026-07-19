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
import './index.css';

// ── Constants ────────────────────────────────────────────────────────────────
const INITIAL_VIEW_STATE = {
  longitude: 77.5946,
  latitude:  12.9716,
  zoom:      11,
  pitch:     30,
  bearing:   0,
  minZoom:   2,
  maxZoom:   18,
  transitionDuration: 0,
};

const CARTO_DARK_TILE = 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';
const API_BASE = 'http://localhost:8000';

const LEGEND = [
  { band: 'Good',         color: '#00B050' },
  { band: 'Satisfactory', color: '#92D050' },
  { band: 'Moderate',     color: '#FFFF00' },
  { band: 'Poor',         color: '#FF9900' },
  { band: 'Very Poor',    color: '#FF0000' },
  { band: 'Severe',       color: '#C00000' },
];

const HORIZON_STEPS = ['0', '24', '48', '72'];

function hexToRGBA(hex, alpha = 185) {
  if (!hex || hex.length < 7) return [120, 120, 120, alpha];
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

// ── App ──────────────────────────────────────────────────────────────────────
function App() {
  const [horizon, setHorizon]         = useState('0');
  const [geoData, setGeoData]         = useState(null);
  const [sourceData, setSourceData]   = useState(null);
  const [compareData, setCompareData] = useState(null);
  const [accuracy, setAccuracy]       = useState(null);   // source attribution accuracy
  const [loading, setLoading]         = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [playing, setPlaying]         = useState(false);
  const [viewState, setViewState]     = useState(INITIAL_VIEW_STATE);
  const [selectedHex, setSelectedHex] = useState(null);
  const [currentBand, setCurrentBand] = useState(null);  // dominant band for advisory

  const playIntervalRef = useRef(null);

  // ── Play / Pause ─────────────────────────────────────────────────────────
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

  // ── Fetch main AQI / forecast GeoJSON ────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    const url = horizon === '0'
      ? `${API_BASE}/current`
      : `${API_BASE}/forecast?hours=${horizon}`;
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => setGeoData(d))
      .catch(e => console.error('AQI fetch failed:', e))
      .finally(() => setLoading(false));
  }, [horizon]);

  // ── One-off fetches ───────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE}/source-attribution`)
      .then(r => r.json()).then(setSourceData)
      .catch(e => console.error('Source fetch failed:', e));

    fetch(`${API_BASE}/forecast-compare`)
      .then(r => r.json()).then(setCompareData)
      .catch(e => console.error('Forecast-compare fetch failed:', e));

    fetch(`${API_BASE}/source-attribution-accuracy`)
      .then(r => r.json()).then(setAccuracy)
      .catch(e => console.error('Accuracy fetch failed:', e));
  }, []);

  // ── Source lookup map ─────────────────────────────────────────────────────
  const srcLookup = useMemo(() => {
    if (!sourceData) return {};
    const m = {};
    sourceData.features.forEach(f => { m[f.properties.h3_hex] = f.properties; });
    return m;
  }, [sourceData]);

  // ── Camera fly-to ─────────────────────────────────────────────────────────
  const flyToHex = useCallback((lat, lon) => {
    setViewState(vs => ({
      ...vs,
      latitude: lat,
      longitude: lon,
      zoom: 14,
      transitionDuration: 1200,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.5 }),
    }));
  }, []);

  // ── Deck.gl layers ────────────────────────────────────────────────────────
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
        return new BitmapLayer(props, { data: null, image: props.data, bounds: [west, south, east, north] });
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
        getLineColor: [255, 255, 255, 60],
        lineWidthMinPixels: 1,
        getLineWidth: 5,
        updateTriggers: { getFillColor: [horizon, geoData] },
        transitions: { getFillColor: { duration: 600, type: 'interpolation' } },
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
          if (d.properties?.traffic_linked)    return [245, 158, 11, 230];
          if (d.properties?.industrial_linked) return [139, 92, 246, 230];
          return [0, 0, 0, 0];
        },
        lineWidthMinPixels: 2,
        getLineWidth: 30,
      }));
    }

    return result;
  }, [geoData, sourceData, showSources, horizon]);

  // ── Tooltip ───────────────────────────────────────────────────────────────
  const getTooltip = ({ object }) => {
    if (!object?.properties) return null;
    const p = object.properties;
    return {
      html: `<div class="deck-tooltip">
        <div class="tooltip-title">${(p.h3_hex || '').slice(0, 10)}…</div>
        <div style="display:flex;justify-content:space-between;margin:4px 0">
          <span>AQI</span><strong>${Number(p.aqi || 0).toFixed(1)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;margin:4px 0">
          <span>Band</span>
          <strong style="color:${p.fillColor || '#fff'}">${p.cpcb_band || '—'}</strong>
        </div>
        ${p.is_forecast ? `<div style="font-size:0.74rem;color:#888;margin-top:4px">Forecast +${horizon}h</div>` : ''}
        <div style="font-size:0.72rem;color:#666;margin-top:6px">Click hex for sparkline →</div>
      </div>`,
      style: { background: 'transparent', border: 'none', padding: 0 },
    };
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>

      {/* Advisory banner — top, uses real /advisory API */}
      <AdvisoryBanner currentBand={currentBand} />

      {/* Summary strip — below banner, also computes lead-time stat */}
      <SummaryStrip
        geoData={geoData}
        horizon={horizon}
        onBandChange={setCurrentBand}
      />

      {/* Left column: Alerts + Recommendations stacked */}
      <div className="left-panel-col">
        <AlertsPanel compareData={compareData} onSelectHex={flyToHex} />
        <RecommendationsPanel onSelectHex={flyToHex} />
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

      {/* Hex popup with sparkline */}
      {selectedHex && (
        <HexPopup
          hexProps={selectedHex.props}
          screenX={selectedHex.screenX}
          screenY={selectedHex.screenY}
          horizon={horizon}
          srcLookup={srcLookup}
          onClose={() => setSelectedHex(null)}
          apiBase={API_BASE}
        />
      )}

      {/* ── Control Panel (right side) ─────────────────────────────── */}
      <div className="ui-panel">
        <div>
          <h1>Smart City Air Quality</h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#888' }}>
            Bengaluru Intervention Dashboard
          </p>
        </div>

        {/* Horizon + Play */}
        <div className="control-group">
          <h2>Forecast Horizon</h2>
          <div className="button-group">
            {[['0','Now'],['24','+24h'],['48','+48h'],['72','+72h']].map(([val, label]) => (
              <button
                key={val}
                className={horizon === val ? 'active' : ''}
                onClick={() => setHorizon(val)}
              >{label}</button>
            ))}
          </div>
          <div className="play-pause-controls">
            <button className="play-pause-btn" onClick={() => setPlaying(p => !p)}>
              {playing ? '⏸ Pause' : '▶ Play'}
            </button>
            {playing && <span style={{ fontSize: '0.75rem', color: '#888' }}>cycling every 2s…</span>}
          </div>
          {loading && (
            <div style={{ fontSize: '0.75rem', color: '#888', marginTop: 6, textAlign: 'center' }}>
              Fetching data…
            </div>
          )}
        </div>

        {/* Source attribution toggle */}
        <div className="toggle-row">
          <span>Source Attribution Overlay</span>
          <label className="switch">
            <input type="checkbox" checked={showSources} onChange={e => setShowSources(e.target.checked)} />
            <span className="slider" />
          </label>
        </div>
        {showSources && (
          <div style={{ fontSize: '0.8rem', color: '#aaa', display: 'flex', gap: 12 }}>
            <span><span style={{ color: '#f59e0b' }}>■</span> Traffic</span>
            <span><span style={{ color: '#8b5cf6' }}>■</span> Industrial</span>
          </div>
        )}

        {/* CPCB legend */}
        <div className="control-group">
          <h2>CPCB AQI Bands</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {LEGEND.map(({ band, color }) => (
              <div key={band} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem' }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: color, flexShrink: 0 }} />
                <span>{band}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Model + attribution accuracy stat card ── */}
        <div className="stats-box">
          <div style={{ fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 6, marginBottom: 8 }}>
            Model vs. Baseline (72h)
          </div>
          <div className="stats-row">
            <span>Persistence RMSE</span>
            <span className="stats-val" style={{ color: '#f87171' }}>18.81</span>
          </div>
          <div className="stats-row">
            <span>LightGBM RMSE</span>
            <span className="stats-val" style={{ color: '#4ade80' }}>15.68</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#888', marginTop: 4, marginBottom: 10 }}>
            ↓ 17% improvement over persistence
          </div>

          {/* Source attribution accuracy — item 1 */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8, marginTop: 2 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#aaa', marginBottom: 6 }}>
              Source Attribution Accuracy
              <span style={{ fontSize: '0.65rem', color: '#555', marginLeft: 6 }}>vs. BBMP/KSPCB GT zones</span>
            </div>

            {!accuracy ? (
              <div style={{ fontSize: '0.72rem', color: '#555' }}>Loading…</div>
            ) : (
              <>
                <div className="stats-row">
                  <span style={{ fontSize: '0.78rem' }}>🚗 Traffic Precision</span>
                  <span className="stats-val" style={{ color: '#f59e0b', fontSize: '0.78rem' }}>
                    {pct(accuracy.traffic?.precision)}
                  </span>
                </div>
                <div className="stats-row">
                  <span style={{ fontSize: '0.78rem' }}>🚗 Traffic Recall</span>
                  <span className="stats-val" style={{ color: '#f59e0b', fontSize: '0.78rem' }}>
                    {pct(accuracy.traffic?.recall)}
                  </span>
                </div>
                <div className="stats-row">
                  <span style={{ fontSize: '0.78rem' }}>🏭 Industrial Precision</span>
                  <span className="stats-val" style={{ color: '#8b5cf6', fontSize: '0.78rem' }}>
                    {pct(accuracy.industrial?.precision)}
                  </span>
                </div>
                <div className="stats-row">
                  <span style={{ fontSize: '0.78rem' }}>🏭 Industrial Recall</span>
                  <span className="stats-val" style={{ color: '#8b5cf6', fontSize: '0.78rem' }}>
                    {pct(accuracy.industrial?.recall)}
                  </span>
                </div>
                <div style={{ fontSize: '0.67rem', color: '#444', marginTop: 4, lineHeight: 1.4 }}>
                  Evaluated against {accuracy.traffic?.gt_relevant_hexes ?? '—'} traffic +{' '}
                  {accuracy.industrial?.gt_relevant_hexes ?? '—'} industrial GT hexes
                </div>
              </>
            )}
          </div>

          {/* Lead-time callout */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8, marginTop: 8 }}>
            <div className="stats-row">
              <span style={{ fontSize: '0.78rem' }}>⏱ Forecast Lead Time</span>
              <span className="stats-val" style={{ color: '#a78bfa', fontSize: '0.78rem' }}>Up to 72h</span>
            </div>
            <div style={{ fontSize: '0.67rem', color: '#444', marginTop: 2, lineHeight: 1.4 }}>
              Traditional CAAQMS: reactive only (0h lead time). This system warns up to 72h before threshold breach.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
