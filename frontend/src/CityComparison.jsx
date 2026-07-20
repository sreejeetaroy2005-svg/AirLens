import React, { useEffect, useState } from 'react';

const API_BASE = 'http://localhost:8000';

const BAND_COLOR = {
  Good:         '#00c853',
  Satisfactory: '#aeea00',
  Moderate:     '#ffd600',
  Poor:         '#ff6d00',
  'Very Poor':  '#dd2c00',
  Severe:       '#880e4f',
};

const TREND_META = {
  Worsening: { color: '#ef4444', symbol: '↑' },
  Improving:  { color: '#4ade80', symbol: '↓' },
  Stable:     { color: '#fbbf24', symbol: '→' },
};

function MiniBar({ value, max, color }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.5s ease' }} />
    </div>
  );
}

export default function CityComparison({ onSelectCity, activeCity }) {
  const [stats, setStats]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/city-stats`)
      .then(r => r.json())
      .then(d => { setStats(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const maxAqi = Math.max(...stats.map(s => s.avg_aqi || 0), 1);

  return (
    <div className="panel" style={{
      padding: '14px',
      marginTop: 8,
    }}>
      <div className="panel-label">🌆 Cross-City Comparison</div>

      {loading ? (
        <div className="rec-empty">LOADING CITY DATA…</div>
      ) : (
        <>
          {/* Header row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '80px 1fr 60px 60px',
            gap: '0 8px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.52rem',
            letterSpacing: '0.1em',
            color: 'var(--text-dim)',
            textTransform: 'uppercase',
            marginBottom: 6,
            paddingBottom: 5,
            borderBottom: '1px solid var(--border-dim)',
          }}>
            <span>City</span>
            <span>AQI / Band</span>
            <span style={{ textAlign: 'right' }}>72h</span>
            <span style={{ textAlign: 'right' }}>Poor+</span>
          </div>

          {stats.map(s => {
            const isActive = s.city === activeCity;
            const trend    = TREND_META[s.trend_72h_label] || TREND_META.Stable;
            const bandCol  = BAND_COLOR[s.dominant_band] || '#8b96a8';

            return (
              <div
                key={s.city}
                onClick={() => onSelectCity(s)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 1fr 60px 60px',
                  gap: '0 8px',
                  alignItems: 'center',
                  padding: '7px 6px',
                  marginBottom: 3,
                  borderRadius: 2,
                  border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border-dim)'}`,
                  background: isActive ? 'rgba(0,212,255,0.06)' : 'rgba(255,255,255,0.02)',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s, background 0.2s',
                }}
                onMouseEnter={e => {
                  if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                }}
                onMouseLeave={e => {
                  if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                }}
              >
                {/* City name */}
                <div style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: '0.72rem',
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? 'var(--accent)' : 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {s.display}
                </div>

                {/* AQI + bar */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      color: bandCol,
                      letterSpacing: '-0.02em',
                      lineHeight: 1,
                    }}>{s.avg_aqi}</span>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.52rem',
                      color: bandCol,
                      background: bandCol + '18',
                      border: `1px solid ${bandCol}44`,
                      padding: '1px 4px',
                      borderRadius: 2,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                    }}>{s.dominant_band}</span>
                  </div>
                  <MiniBar value={s.avg_aqi} max={maxAqi} color={bandCol} />
                </div>

                {/* 72h trend */}
                <div style={{ textAlign: 'right' }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: trend.color,
                  }}>{trend.symbol}</span>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.55rem',
                    color: trend.color,
                    opacity: 0.8,
                  }}>
                    {s.trend_72h_delta > 0 ? '+' : ''}{s.trend_72h_delta}
                  </div>
                </div>

                {/* Poor+ % */}
                <div style={{ textAlign: 'right' }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: s.poor_plus_pct > 50 ? '#ef4444' : s.poor_plus_pct > 25 ? '#f97316' : '#4ade80',
                  }}>{s.poor_plus_pct}%</span>
                </div>
              </div>
            );
          })}

          {/* Disclaimer */}
          <div style={{
            marginTop: 8,
            paddingTop: 6,
            borderTop: '1px solid var(--border-dim)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.52rem',
            color: 'var(--text-dim)',
            lineHeight: 1.5,
            letterSpacing: '0.04em',
          }}>
            ⓘ Trend/AQI comparison only. Compliance outcomes not shown — requires enforcement data not available in this dataset.
          </div>
        </>
      )}
    </div>
  );
}
