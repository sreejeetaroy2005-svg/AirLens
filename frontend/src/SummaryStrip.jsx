import React, { useState, useEffect, useMemo } from 'react';

const API_BASE = 'http://localhost:8000';

const SEVERITY = { Good: 0, Satisfactory: 1, Moderate: 2, Poor: 3, 'Very Poor': 4, Severe: 5 };

function avgAqi(features) {
  if (!features?.length) return 0;
  return features.reduce((s, f) => s + (f.properties?.aqi || 0), 0) / features.length;
}

function dominantBand(features) {
  if (!features?.length) return null;
  const counts = {};
  features.forEach(f => {
    const b = f.properties?.cpcb_band;
    if (b) counts[b] = (counts[b] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

const BAND_ACCENT = {
  Good:         'var(--good)',
  Satisfactory: 'var(--satisfactory)',
  Moderate:     'var(--moderate)',
  Poor:         'var(--poor)',
  'Very Poor':  'var(--very-poor)',
  Severe:       'var(--severe)',
};

// Live "last updated" heartbeat ticker
function Heartbeat() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const label = elapsed < 60 ? `${secs}s ago` : `${mins}m ${secs}s ago`;
  return (
    <div className="heartbeat-tick">
      <span className="heartbeat-dot" />
      UPDATED {label}
    </div>
  );
}

export default function SummaryStrip({ geoData, horizon, activeCity, onBandChange }) {
  const [forecast72, setForecast72] = useState(null);

  useEffect(() => {
    const cityParam = activeCity ? `&city=${activeCity}` : '';
    fetch(`${API_BASE}/forecast?hours=72${cityParam}`)
      .then(r => r.json())
      .then(setForecast72)
      .catch(() => {});
  }, [activeCity]);

  const stats = useMemo(() => {
    if (!geoData?.features?.length) return null;
    const features = geoData.features;
    const total = features.length;

    const poorCount = features.filter(f => {
      const sev = SEVERITY[f.properties?.cpcb_band] ?? 0;
      return sev >= SEVERITY['Poor'];
    }).length;
    const poorPct = ((poorCount / total) * 100).toFixed(0);

    const currentAvg = avgAqi(features);
    const forecastAvg = forecast72 ? avgAqi(forecast72.features) : null;

    let trendSymbol = '—';
    let trendColor  = 'var(--text-dim)';
    let trendDelta  = '';
    if (forecastAvg !== null) {
      const delta = forecastAvg - currentAvg;
      if (delta > 5) {
        trendSymbol = '↑'; trendColor = 'var(--very-poor)';
        trendDelta = `+${delta.toFixed(0)}`;
      } else if (delta < -5) {
        trendSymbol = '↓'; trendColor = 'var(--good)';
        trendDelta = `${delta.toFixed(0)}`;
      } else {
        trendSymbol = '→'; trendColor = 'var(--moderate)';
        trendDelta = '±0';
      }
    }

    return {
      total,
      poorPct,
      trendSymbol, trendColor, trendDelta,
      currentAvg: currentAvg.toFixed(0),
      band: dominantBand(features),
    };
  }, [geoData, forecast72]);

  useEffect(() => {
    if (stats?.band) {
      if (onBandChange) onBandChange(stats.band);
      const colorMap = {
        Good: '#00c853',
        Satisfactory: '#aeea00',
        Moderate: '#ffd600',
        Poor: '#ff6d00',
        'Very Poor': '#dd2c00',
        Severe: '#880e4f',
      };
      const c = colorMap[stats.band] || '#880e4f';
      document.documentElement.style.setProperty('--active-band-color', c);
      document.documentElement.style.setProperty('--active-band-glow', `${c}33`);
    }
  }, [stats?.band]);

  if (!stats) return (
    <div className="summary-strip-bar">
      <div className="summary-item">
        <span className="summary-label">Initialising</span>
        <span className="summary-value" style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>—</span>
      </div>
    </div>
  );

  const bandColor = BAND_ACCENT[stats.band] || 'var(--text-primary)';

  return (
    <div className="summary-strip-bar">
      {/* System ID */}
      <div className="summary-item" style={{ paddingLeft: 0 }}>
        <span className="summary-label">System</span>
        <span className="summary-value" style={{ fontSize: '0.78rem', letterSpacing: '0.06em', fontWeight: 700 }}>
          AQI·INTEL
          <span className="unit">v1</span>
        </span>
      </div>

      <div className="summary-item">
        <span className="summary-label">Hexes Monitored</span>
        <span className="summary-value">{stats.total}</span>
      </div>

      <div className="summary-item">
        <span className="summary-label">City Avg AQI</span>
        <span className="summary-value" style={{ color: bandColor }}>
          {stats.currentAvg}
          <span className="unit">AQI</span>
        </span>
      </div>

      <div className="summary-item">
        <span className="summary-label">Poor+ Hexes</span>
        <span className="summary-value" style={{ color: Number(stats.poorPct) > 30 ? 'var(--very-poor)' : 'var(--good)' }}>
          {stats.poorPct}
          <span className="unit">%</span>
        </span>
      </div>

      <div className="summary-item">
        <span className="summary-label">Dominant Band</span>
        <span className="summary-value" style={{ color: bandColor, fontSize: '0.85rem' }}>
          {stats.band || '—'}
        </span>
      </div>

      <div className="summary-item">
        <span className="summary-label">72h Trend</span>
        <span className="summary-value" style={{ color: stats.trendColor }}>
          {stats.trendSymbol}
          <span className="unit" style={{ color: stats.trendColor, opacity: 0.8 }}>{stats.trendDelta} AQI</span>
        </span>
      </div>

      <div className="summary-item">
        <span className="summary-label">Lead Time</span>
        <span className="summary-value" style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>
          72
          <span className="unit">h ahead</span>
        </span>
      </div>

      {/* Push heartbeat to far right */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingLeft: 22 }}>
        <Heartbeat />
      </div>
    </div>
  );
}
