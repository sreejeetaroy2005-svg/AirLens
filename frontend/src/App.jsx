import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import { FlyToInterpolator } from '@deck.gl/core';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import SummaryStrip from './SummaryStrip';
import AlertsPanel from './AlertsPanel';
import AdvisoryBanner from './AdvisoryBanner';
import HexPopup from './HexPopup';
import RecommendationsPanel from './RecommendationsPanel';
import CityComparison from './CityComparison';
import FeatureTour from './FeatureTour';
import BusinessImpact from './BusinessImpact';
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

const CARTO_DARK_TILE = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
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
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);

  // Initialize MapLibre map and MapboxOverlay once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
      zoom: INITIAL_VIEW_STATE.zoom,
      pitch: INITIAL_VIEW_STATE.pitch,
      bearing: INITIAL_VIEW_STATE.bearing,
    });

    const overlay = new MapboxOverlay({
      layers: [],
      getTooltip: (info) => getTooltip(info),
      onClick: ({ object }) => { if (!object) setSelectedHex(null); }
    });

    map.addControl(overlay);
    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

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

  // ─── Auto-fit viewState to monitored hexes when geoData loads ────────────
  useEffect(() => {
    if (!geoData?.features?.length) return;
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    geoData.features.forEach(f => {
      const coords = f.geometry?.coordinates?.[0];
      if (coords) {
        coords.forEach(([lon, lat]) => {
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
        });
      }
    });
    if (minLat < maxLat && minLon < maxLon) {
      const centerLat = (minLat + maxLat) / 2;
      const centerLon = (minLon + maxLon) / 2;
      // Calculate appropriate zoom based on lat/lon span
      const latDiff = maxLat - minLat;
      const lonDiff = maxLon - minLon;
      const maxDiff = Math.max(latDiff, lonDiff);
      let targetZoom = 11;
      if (maxDiff > 0.6) targetZoom = 9.5;
      else if (maxDiff > 0.3) targetZoom = 10.5;
      else if (maxDiff > 0.15) targetZoom = 11.8;
      else targetZoom = 12.8;

      setViewState(vs => ({
        ...vs,
        latitude: centerLat,
        longitude: centerLon,
        zoom: targetZoom,
        transitionDuration: 1000,
        transitionInterpolator: new FlyToInterpolator({ speed: 1.2 }),
      }));
    }
  }, [geoData]);

  // ─── Layers ─────────────────────────────────────────────────────────────────
  const layers = useMemo(() => {
    const result = [];

    if (geoData?.features?.length) {
      // Glow underlayer for focal weight
      result.push(new GeoJsonLayer({
        id: 'aqi-glow-layer',
        data: geoData,
        pickable: false,
        filled: false,
        stroked: true,
        getLineColor: d => {
          const rgba = hexToRGBA(d.properties?.fillColor, 180);
          return [rgba[0], rgba[1], rgba[2], 160];
        },
        lineWidthMinPixels: 4,
        getLineWidth: 25,
        updateTriggers: { getLineColor: [horizon, geoData] },
      }));

      // Main Hex Layer
      result.push(new GeoJsonLayer({
        id: 'aqi-layer',
        data: geoData,
        pickable: true,
        filled: true,
        stroked: true,
        getFillColor: d => hexToRGBA(d.properties?.fillColor, 220),
        getLineColor: d => {
          const rgba = hexToRGBA(d.properties?.fillColor, 255);
          return [Math.min(255, rgba[0] + 50), Math.min(255, rgba[1] + 50), Math.min(255, rgba[2] + 50), 240];
        },
        lineWidthMinPixels: 2,
        getLineWidth: 12,
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
          if (d.properties?.traffic_linked)    return [245, 158, 11, 230];
          if (d.properties?.industrial_linked) return [139, 92, 246, 230];
          return [0, 0, 0, 0];
        },
        lineWidthMinPixels: 3,
        getLineWidth: 35,
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

  // Sync layers & viewState to overlay/map
  useEffect(() => {
    if (overlayRef.current) {
      overlayRef.current.setProps({
        layers,
        getTooltip,
      });
    }
  }, [layers]);

  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [viewState.longitude, viewState.latitude],
        zoom: viewState.zoom,
        essential: true,
        duration: viewState.transitionDuration || 0,
      });
    }
  }, [viewState.latitude, viewState.longitude, viewState.zoom]);

  // Collapsible states
  const [panelsOpen, setPanelsOpen] = useState({
    identity: true,
    alerts: true,
    recommendations: true,
    businessImpact: false,
    modelPerformance: false,
    aqiScale: false,
    toggles: false,
  });

  const togglePanel = (key) => {
    setPanelsOpen(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const setAllPanels = (val) => {
    setPanelsOpen({
      identity: val,
      alerts: val,
      recommendations: val,
      businessImpact: val,
      modelPerformance: val,
      aqiScale: val,
      toggles: val,
    });
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: 'var(--bg-base)' }}>

      {/* Advisory banner */}
      <AdvisoryBanner currentBand={currentBand} activeCity={activeCity} />

      {/* Summary hero strip */}
      <SummaryStrip geoData={geoData} horizon={horizon} activeCity={activeCity} onBandChange={setCurrentBand} />

      {/* ─── Main Content Container (2-Column Layout) ──────────────────── */}
      <div style={{
        position: 'absolute',
        top: 102,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        overflow: 'hidden',
      }}>

        {/* LEFT SIDE: Map Container (65-70% width) */}
        <div style={{
          position: 'relative',
          width: '68%',
          height: '100%',
          flexShrink: 0,
        }}>
          {/* Map */}
          <div
            ref={mapContainerRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />

          {/* Persistent Map Station Label Badge */}
          <div style={{
            position: 'absolute',
            top: 16,
            left: 16,
            zIndex: 10,
            background: 'rgba(9,13,18,0.85)',
            border: '1px solid var(--border-mid)',
            borderLeft: '3px solid var(--accent)',
            borderRadius: 2,
            padding: '5px 10px',
            backdropFilter: 'blur(8px)',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span className="heartbeat-dot" style={{ background: 'var(--accent)' }} />
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.66rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: 'var(--text-primary)',
              textTransform: 'uppercase',
            }}>
              {geoData?.features?.length || 0} monitoring stations, {activeCity}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.55rem',
              color: 'var(--text-dim)',
              letterSpacing: '0.04em',
            }}>
              (H3 RES 8 SPATIAL BOUNDS)
            </span>
          </div>

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
        </div>

        {/* RIGHT SIDE: Single Scrollable Column containing ALL side panels */}
        <div className="ui-panel-scrollable">

          {/* Expand / Collapse All Control */}
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 12,
            marginBottom: -4,
            paddingRight: 4,
          }}>
            <button
              onClick={() => setAllPanels(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.58rem',
                letterSpacing: '0.05em',
                cursor: 'pointer',
                padding: 0,
                textTransform: 'uppercase',
              }}
            >
              [Expand All]
            </button>
            <button
              onClick={() => setAllPanels(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.58rem',
                letterSpacing: '0.05em',
                cursor: 'pointer',
                padding: 0,
                textTransform: 'uppercase',
              }}
            >
              [Collapse All]
            </button>
          </div>

          {/* 1. Identity & Active City & Forecast Horizon & Play */}
          <div className="panel-box" id="tour-identity">
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => togglePanel('identity')}
            >
              <div className="panel-label" style={{ marginBottom: 0 }}>
                ⚙️ CONTROLS / {activeCity.toUpperCase()}
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--text-dim)' }}>
                {panelsOpen.identity ? '▲' : '▼'}
              </span>
            </div>

            {panelsOpen.identity && (
              <div style={{ marginTop: 12 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: '0.58rem',
                  letterSpacing: '0.2em', textTransform: 'uppercase',
                  color: 'var(--accent)', marginBottom: 5,
                }}>
                  AQI · INTEL
                </div>
                <h1 style={{ fontSize: '1rem', marginBottom: 12 }}>Air Quality Intelligence</h1>

                {/* City Selector */}
                <div id="tour-city-selector" style={{ marginBottom: 12 }}>
                  <h2>Active City</h2>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {['Delhi','Ghaziabad','Noida','Mumbai'].map(c => (
                      <button
                        key={c}
                        onClick={() => {
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
                    marginBottom: 12,
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
                  <div className="play-pause-controls" style={{ marginTop: 8 }}>
                    <button className="play-pause-btn" onClick={() => setPlaying(p => !p)}>
                      {playing ? '⏸ PAUSE' : '▶ PLAY'}
                    </button>
                    {playing && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--text-dim)', letterSpacing: '0.06em', marginLeft: 8 }}>
                        CYCLING…
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 2. Signal Alerts */}
          <div className="panel-box">
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => togglePanel('alerts')}
            >
              <div className="panel-label" style={{ marginBottom: 0 }}>
                ⚡ Signal Alerts
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--text-dim)' }}>
                {panelsOpen.alerts ? '▲' : '▼'}
              </span>
            </div>
            {panelsOpen.alerts && (
              <div style={{ marginTop: 12 }}>
                <AlertsPanel compareData={compareData} srcLookup={srcLookup} onSelectHex={flyToHex} />
              </div>
            )}
          </div>

          {/* 3. Enforcement Log (Recommendations) */}
          <div className="panel-box">
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => togglePanel('recommendations')}
            >
              <div className="panel-label" style={{ marginBottom: 0 }}>
                🏛 Enforcement Log
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--text-dim)' }}>
                {panelsOpen.recommendations ? '▲' : '▼'}
              </span>
            </div>
            {panelsOpen.recommendations && (
              <div style={{ marginTop: 12 }}>
                <RecommendationsPanel onSelectHex={flyToHex} activeCity={activeCity} />
              </div>
            )}
          </div>

          {/* 4. Business Impact */}
          <div className="panel-box">
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => togglePanel('businessImpact')}
            >
              <div className="panel-label" style={{ marginBottom: 0 }}>
                📊 Business Impact
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--text-dim)' }}>
                {panelsOpen.businessImpact ? '▲' : '▼'}
              </span>
            </div>
            {panelsOpen.businessImpact && (
              <div style={{ marginTop: 12 }}>
                <BusinessImpact />
              </div>
            )}
          </div>

          {/* 5. Model Performance & 6. Attribution Accuracy */}
          <div className="panel-box" id="tour-model-stats">
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => togglePanel('modelPerformance')}
            >
              <div className="panel-label" style={{ marginBottom: 0 }}>
                📈 Model Stats
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--text-dim)' }}>
                {panelsOpen.modelPerformance ? '▲' : '▼'}
              </span>
            </div>

            {panelsOpen.modelPerformance && (
              <div style={{ marginTop: 12 }}>
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

                {/* Attribution Accuracy — Delhi only */}
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
                    <span className="stats-val" style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 700 }}>72H</span>
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
            )}
          </div>

          {/* 7. CPCB AQI Scale legend */}
          <div className="panel-box">
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => togglePanel('aqiScale')}
            >
              <div className="panel-label" style={{ marginBottom: 0 }}>
                🎨 AQI Scale
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--text-dim)' }}>
                {panelsOpen.aqiScale ? '▲' : '▼'}
              </span>
            </div>
            {panelsOpen.aqiScale && (
              <div style={{ marginTop: 12 }}>
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
              </div>
            )}
          </div>

          {/* 8. Source Attribution / Cross-City Comparison toggles */}
          <div className="panel-box">
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => togglePanel('toggles')}
            >
              <div className="panel-label" style={{ marginBottom: 0 }}>
                🔄 Map Toggles
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--text-dim)' }}>
                {panelsOpen.toggles ? '▲' : '▼'}
              </span>
            </div>
            {panelsOpen.toggles && (
              <div style={{ marginTop: 12 }}>
                {/* Source attribution toggle */}
                <div id="tour-source-toggle" style={{ marginBottom: 12 }}>
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

                {showComparison && (
                  <div style={{ marginTop: 12 }}>
                    <CityComparison onSelectCity={handleCitySelect} activeCity={activeCity} />
                  </div>
                )}
              </div>
            )}
          </div>

        </div>

      </div>
      {/* ─── Feature Tour ────────────────────────────────────────────────── */}
      <FeatureTour />

    </div>
  );
}

export default App;
