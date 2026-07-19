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
  Good:         '#00B050',
  Satisfactory: '#92D050',
  Moderate:     '#FFFF00',
  Poor:         '#FF9900',
  'Very Poor':  '#FF0000',
  Severe:       '#C00000',
};

function shortTimestamp(iso) {
  try {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2,'0')}:00`;
  } catch {
    return iso;
  }
}

export default function HexPopup({ hexProps, screenX, screenY, horizon, srcLookup, onClose, apiBase }) {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const popupRef = useRef(null);

  useEffect(() => {
    if (!hexProps?.h3_hex) return;
    setLoading(true);
    fetch(`${apiBase}/hex-history?hex_id=${encodeURIComponent(hexProps.h3_hex)}`)
      .then(r => r.json())
      .then(d => setHistory(d))
      .catch(() => setHistory(null))
      .finally(() => setLoading(false));
  }, [hexProps?.h3_hex, apiBase]);

  // Keep popup inside viewport
  const popupW = 320;
  const popupH = 300;
  const left = Math.min(screenX + 12, window.innerWidth  - popupW - 20);
  const top  = Math.min(screenY + 12, window.innerHeight - popupH - 20);

  const src = srcLookup?.[hexProps?.h3_hex] || {};

  // Build sparkline data
  const chartData = React.useMemo(() => {
    if (!history) return null;

    const actualLabels = history.actual.labels.map(shortTimestamp);
    const actualValues = history.actual.values;

    // Append forecast points
    const fcLabels = [];
    const fcValues = [];
    const fcColors = [];
    for (const [key, val] of Object.entries(history.forecast || {})) {
      fcLabels.push(key);
      fcValues.push(val);
    }

    const allLabels = [...actualLabels, ...fcLabels];
    // Actual dataset (null for forecast positions)
    const actualDs = [...actualValues, ...fcLabels.map(() => null)];
    // Forecast dataset (null for actual positions, connect from last actual)
    const forecastDs = [
      ...actualValues.map(() => null),
      actualValues[actualValues.length - 1] ?? null,  // bridge
      ...fcValues,
    ];
    // Trim bridge so chart aligns properly
    const bridgedForecastDs = [
      ...actualValues.map((_, i) => (i === actualValues.length - 1 ? actualValues[i] : null)),
      ...fcValues,
    ];

    return {
      labels: allLabels,
      datasets: [
        {
          label: 'Actual AQI',
          data: actualDs,
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96,165,250,0.15)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: true,
          spanGaps: false,
        },
        {
          label: 'Forecast AQI',
          data: bridgedForecastDs,
          borderColor: '#f97316',
          backgroundColor: 'rgba(249,115,22,0.1)',
          borderWidth: 2,
          borderDash: [4, 4],
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
          color: '#aaa',
          font: { size: 10 },
          boxWidth: 12,
          padding: 8,
        },
      },
      tooltip: {
        backgroundColor: 'rgba(24,24,24,0.95)',
        titleColor: '#fff',
        bodyColor: '#aaa',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        callbacks: {
          label: ctx => ` AQI ${ctx.parsed.y?.toFixed(1) ?? '—'}`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: '#666', font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
        grid: { color: 'rgba(255,255,255,0.05)' },
      },
      y: {
        ticks: { color: '#666', font: { size: 9 } },
        grid: { color: 'rgba(255,255,255,0.05)' },
      },
    },
  };

  return (
    <div
      ref={popupRef}
      className="hex-popup"
      style={{ left, top, width: popupW }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div className="tooltip-title" style={{ marginBottom: 2 }}>
            H3: {(hexProps.h3_hex || '').slice(0, 10)}…
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>
              AQI {Number(hexProps.aqi || 0).toFixed(1)}
            </span>
            <span style={{
              background: BAND_COLOR[hexProps.cpcb_band] || '#888',
              color: hexProps.cpcb_band === 'Moderate' ? '#333' : '#fff',
              padding: '1px 7px',
              borderRadius: 4,
              fontSize: '0.75rem',
              fontWeight: 600,
            }}>{hexProps.cpcb_band || '—'}</span>
            {hexProps.is_forecast && (
              <span style={{ fontSize: '0.72rem', color: '#888' }}>Forecast +{horizon}h</span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: 0 }}
          aria-label="Close popup"
        >✕</button>
      </div>

      {/* Source badges */}
      {(src.traffic_linked || src.industrial_linked) && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {src.traffic_linked    && <span className="badge traffic">🚗 Traffic Linked</span>}
          {src.industrial_linked && <span className="badge industry">🏭 Industrial Linked</span>}
        </div>
      )}

      {/* Sparkline */}
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: 4 }}>
          Last 24h actual · Next 72h forecast
        </div>
        {loading ? (
          <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: '0.8rem' }}>
            Loading sparkline…
          </div>
        ) : chartData ? (
          <div style={{ height: 110 }}>
            <Line data={chartData} options={chartOptions} />
          </div>
        ) : (
          <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: '0.8rem' }}>
            Sparkline unavailable for this hex
          </div>
        )}
      </div>
    </div>
  );
}
