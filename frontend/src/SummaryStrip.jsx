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

// onBandChange: callback to parent to pass the dominant band for advisory
export default function SummaryStrip({ geoData, horizon, onBandChange }) {
  const [forecast72, setForecast72] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/forecast?hours=72`)
      .then(r => r.json())
      .then(setForecast72)
      .catch(() => {});
  }, []);

  const stats = useMemo(() => {
    if (!geoData?.features?.length) return null;

    const features = geoData.features;
    const total = features.length;

    const poorCount = features.filter(f => {
      const sev = SEVERITY[f.properties?.cpcb_band] ?? 0;
      return sev >= SEVERITY['Poor'];
    }).length;
    const poorPct = ((poorCount / total) * 100).toFixed(1);

    const currentAvg = avgAqi(features);
    const forecastAvg = forecast72 ? avgAqi(forecast72.features) : null;

    let trendIcon = '—';
    let trendColor = '#888';
    let trendLabel = '';
    if (forecastAvg !== null) {
      const delta = forecastAvg - currentAvg;
      if (delta > 5) {
        trendIcon = '↑'; trendColor = '#f87171';
        trendLabel = `+${delta.toFixed(1)} AQI over 72h`;
      } else if (delta < -5) {
        trendIcon = '↓'; trendColor = '#4ade80';
        trendLabel = `${delta.toFixed(1)} AQI over 72h`;
      } else {
        trendIcon = '→'; trendColor = '#fbbf24';
        trendLabel = 'Stable over 72h';
      }
    }

    return {
      total,
      poorPct,
      trendIcon, trendColor, trendLabel,
      currentAvg: currentAvg.toFixed(1),
      band: dominantBand(features),
    };
  }, [geoData, forecast72]);

  // Notify parent of dominant band whenever it changes
  useEffect(() => {
    if (stats?.band && onBandChange) onBandChange(stats.band);
  }, [stats?.band]);

  if (!stats) return null;

  return (
    <div className="summary-strip-bar">
      <div className="summary-item">
        <span className="summary-label">Hexes Monitored</span>
        <span className="summary-value">{stats.total}</span>
      </div>
      <div className="summary-divider" />

      <div className="summary-item">
        <span className="summary-label">City Avg AQI</span>
        <span className="summary-value">{stats.currentAvg}</span>
      </div>
      <div className="summary-divider" />

      <div className="summary-item">
        <span className="summary-label">Poor-or-Worse</span>
        <span className="summary-value" style={{ color: Number(stats.poorPct) > 30 ? '#f87171' : '#4ade80' }}>
          {stats.poorPct}%
        </span>
      </div>
      <div className="summary-divider" />

      <div className="summary-item">
        <span className="summary-label">72h Trend</span>
        <span className="summary-value" style={{ color: stats.trendColor, fontSize: '1.1rem' }}>
          {stats.trendIcon}
          <span style={{ fontSize: '0.75rem', marginLeft: 6, color: '#aaa', fontWeight: 400 }}>
            {stats.trendLabel}
          </span>
        </span>
      </div>
      <div className="summary-divider" />

      {/* ── Item 4: Lead-time stat ── */}
      <div className="summary-item" title="How far ahead this system can warn of a threshold breach vs. traditional reactive CAAQMS detection (0h)">
        <span className="summary-label">Forecast Lead Time</span>
        <span className="summary-value" style={{ color: '#a78bfa' }}>
          Up to 72h
          <span style={{ fontSize: '0.68rem', color: '#666', marginLeft: 6, fontWeight: 400 }}>
            vs. 0h reactive
          </span>
        </span>
      </div>
    </div>
  );
}
