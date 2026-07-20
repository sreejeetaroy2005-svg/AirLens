import React, { useState, useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Filler,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(LineElement, CategoryScale, LinearScale, PointElement, Tooltip, Filler, Legend);

const BAND_COLOR = {
  Good:         '#00c853',
  Satisfactory: '#aeea00',
  Moderate:     '#ffd600',
  Poor:         '#ff6d00',
  'Very Poor':  '#dd2c00',
  Severe:       '#880e4f',
};

function shortTimestamp(iso) {
  try {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2,'0')}:00`;
  } catch { return iso; }
}

export default function HexPopup({ hexProps, screenX, screenY, horizon, srcLookup, onClose, apiBase, activeCity }) {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const popupRef = useRef(null);

  useEffect(() => {
    if (!hexProps?.h3_hex) return;
    setLoading(true);
    const cityParam = activeCity ? `&city=${encodeURIComponent(activeCity)}` : '';
    fetch(`${apiBase}/hex-history?hex_id=${encodeURIComponent(hexProps.h3_hex)}${cityParam}`)
      .then(r => r.json())
      .then(d => setHistory(d))
      .catch(() => setHistory(null))
      .finally(() => setLoading(false));
  }, [hexProps?.h3_hex, apiBase, activeCity]);

  const popupW = 320, popupH = 310;
  const left = Math.min(screenX + 12, window.innerWidth  - popupW - 20);
  const top  = Math.min(screenY + 12, window.innerHeight - popupH - 20);

  const src = srcLookup?.[hexProps?.h3_hex] || {};

  const chartData = React.useMemo(() => {
    if (!history) return null;
    const actualLabels = history.actual.labels.map(shortTimestamp);
    const actualValues = history.actual.values;
    const fcLabels = [], fcValues = [];
    for (const [key, val] of Object.entries(history.forecast || {})) {
      fcLabels.push(key); fcValues.push(val);
    }
    const allLabels = [...actualLabels, ...fcLabels];
    const actualDs = [...actualValues, ...fcLabels.map(() => null)];
    const bridgedForecastDs = [
      ...actualValues.map((_, i) => (i === actualValues.length - 1 ? actualValues[i] : null)),
      ...fcValues,
    ];
    return {
      labels: allLabels,
      datasets: [
        {
          label: 'Actual',
          data: actualDs,
          borderColor: 'var(--accent, #00d4ff)',
          backgroundColor: 'rgba(0,212,255,0.08)',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.3,
          fill: true,
          spanGaps: false,
        },
        {
          label: 'Forecast',
          data: bridgedForecastDs,
          borderColor: '#f97316',
          backgroundColor: 'rgba(249,115,22,0.06)',
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 3,
          pointBackgroundColor: '#f97316',
          tension: 0.3,
          fill: false,
          spanGaps: true,
        },
      ],
    };
  }, [history]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    plugins: {
      legend: {
        display: true,
        labels: {
          color: '#4a5568',
          font: { size: 9, family: "'JetBrains Mono', monospace" },
          boxWidth: 10,
          padding: 6,
        },
      },
      tooltip: {
        backgroundColor: 'rgba(17,20,24,0.96)',
        titleColor: '#8b96a8',
        bodyColor: '#e8edf4',
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        titleFont: { family: "'JetBrains Mono', monospace", size: 10 },
        bodyFont: { family: "'JetBrains Mono', monospace", size: 10 },
        callbacks: { label: ctx => ` AQI ${ctx.parsed.y?.toFixed(1) ?? '—'}` },
      },
    },
    scales: {
      x: {
        ticks: {
          color: '#4a5568',
          font: { size: 8, family: "'JetBrains Mono', monospace" },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8,
        },
        grid: { color: 'rgba(255,255,255,0.04)' },
      },
      y: {
        ticks: { color: '#4a5568', font: { size: 8, family: "'JetBrains Mono', monospace" } },
        grid: { color: 'rgba(255,255,255,0.04)' },
      },
    },
  };

  const bandColor = BAND_COLOR[hexProps.cpcb_band] || '#8b96a8';
  const zoneLabel = src?.zone_label || (hexProps.h3_hex ? `Hex ${hexProps.h3_hex.slice(0,6)}` : '—');

  return (
    <div ref={popupRef} className="hex-popup" style={{ left, top, width: popupW }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          {/* Zone label as primary ID */}
          <div style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '0.62rem',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--accent, #00d4ff)',
            marginBottom: 3,
          }}>{zoneLabel}</div>
          <div className="tooltip-title" style={{ marginBottom: 5, fontSize: '0.56rem' }}>
            {(hexProps.h3_hex || '')}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '1.3rem',
              fontWeight: 700,
              color: bandColor,
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}>
              {Number(hexProps.aqi || 0).toFixed(0)}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '0.6rem',
              color: bandColor,
              background: bandColor + '18',
              border: `1px solid ${bandColor}44`,
              padding: '2px 7px',
              borderRadius: 2,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}>{hexProps.cpcb_band || '—'}</span>
            {hexProps.is_forecast && (
              <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.6rem', color: 'var(--text-dim, #4a5568)', letterSpacing: '0.06em' }}>
                +{horizon}H
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: '1px solid var(--border-dim, rgba(255,255,255,0.06))',
            color: 'var(--text-dim, #4a5568)',
            cursor: 'pointer',
            fontSize: '0.7rem',
            lineHeight: 1,
            padding: '4px 6px',
            borderRadius: 2,
            fontFamily: 'var(--font-mono, monospace)',
            transition: 'border-color 0.15s, color 0.15s',
          }}
          aria-label="Close popup"
          onMouseEnter={e => { e.target.style.borderColor = 'var(--accent, #00d4ff)'; e.target.style.color = 'var(--accent, #00d4ff)'; }}
          onMouseLeave={e => { e.target.style.borderColor = ''; e.target.style.color = ''; }}
        >ESC</button>
      </div>

      {/* Source badges — includes construction + confidence + ToD proxy disclosure */}
      {(src.traffic_linked || src.industrial_linked || src.construction_linked) && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 5, marginBottom: 4 }}>
            {src.traffic_linked      && <span className="badge traffic">◆ TRAFFIC</span>}
            {src.industrial_linked   && <span className="badge industry">◆ INDUSTRIAL</span>}
            {src.construction_linked && <span className="badge construction">◆ CONSTRUCTION</span>}
          </div>
          {/* ToD regime — explicit proxy disclosure so judges/operators understand the basis */}
          {src.tod_regime && (
            <div style={{
              fontFamily: 'var(--font-mono,monospace)', fontSize: '0.55rem',
              color: 'var(--text-dim,#4a5568)', letterSpacing: '0.07em', marginBottom: 5,
            }}>
              TRAFFIC PROXY · {src.tod_regime.toUpperCase()} · ×{src.tod_multiplier?.toFixed(2)}
              <span style={{ color: '#2d3748', marginLeft: 5 }}>(road-class weighted, not live data)</span>
            </div>
          )}
          {/* Confidence bars */}
          {src.traffic_confidence !== undefined && (
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { label: 'T', val: src.traffic_confidence,      color: '#fbbf24' },
                { label: 'I', val: src.industrial_confidence,   color: '#a78bfa' },
                { label: 'C', val: src.construction_confidence, color: '#34d399' },
              ].map(b => (
                <div key={b.label} style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: '0.52rem', color: b.color, textAlign: 'center', marginBottom: 2, letterSpacing: '0.08em' }}>{b.label}</div>
                  <div style={{ height: 24, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden', display: 'flex', alignItems: 'flex-end' }}>
                    <div style={{ width: '100%', height: `${Math.min(b.val || 0, 100)}%`, background: b.color, opacity: 0.75, transition: 'height 0.5s ease' }} />
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: '0.54rem', color: 'var(--text-dim,#4a5568)', textAlign: 'center', marginTop: 2 }}>{(b.val || 0).toFixed(0)}%</div>
                </div>
              ))}
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingLeft: 4 }}>
                <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: '0.55rem', color: 'var(--text-dim,#4a5568)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  dominant
                </div>
                <div style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: '0.62rem', fontWeight: 700, color: 'var(--accent,#00d4ff)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  {src.dominant_source || '—'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sparkline */}
      <div>
        <div style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '0.56rem',
          color: 'var(--text-dim, #4a5568)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}>
          24h Actual · 72h Forecast
        </div>
        {loading ? (
          <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim, #4a5568)', fontSize: '0.72rem', fontFamily: 'var(--font-mono, monospace)', letterSpacing: '0.08em' }}>
            LOADING TELEMETRY…
          </div>
        ) : chartData ? (
          <div style={{ height: 115 }}>
            <Line data={chartData} options={chartOptions} />
          </div>
        ) : (
          <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim, #4a5568)', fontSize: '0.72rem', fontFamily: 'var(--font-mono, monospace)' }}>
            NO SIGNAL DATA
          </div>
        )}
      </div>
    </div>
  );
}
