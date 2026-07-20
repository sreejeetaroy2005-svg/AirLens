import React, { useMemo } from 'react';

const SEVERITY = { Good: 0, Satisfactory: 1, Moderate: 2, Poor: 3, 'Very Poor': 4, Severe: 5 };

const BAND_COLOR = {
  Good:         '#00c853',
  Satisfactory: '#aeea00',
  Moderate:     '#ffd600',
  Poor:         '#ff6d00',
  'Very Poor':  '#dd2c00',
  Severe:       '#880e4f',
};

const SEV_BORDER = {
  5: '#c0392b', 4: '#dd2c00', 3: '#e65100',
  2: '#f57f17', 1: '#558b2f', 0: '#1b5e20',
};

const DEMO_TIMES = ['00:02','00:05','00:08','00:11','00:14','00:19',
                    '00:23','00:27','00:31','00:36','00:44','00:51'];

// Confidence mini-bar
function ConfBar({ value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{
        width: 36, height: 3,
        background: 'rgba(255,255,255,0.06)',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(value, 100)}%`,
          height: '100%',
          background: color,
          borderRadius: 2,
          transition: 'width 0.4s ease',
        }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color, letterSpacing: '0.04em' }}>
        {value?.toFixed(0)}%
      </span>
    </div>
  );
}

export default function AlertsPanel({ compareData, srcLookup, onSelectHex }) {
  const alerts = useMemo(() => {
    if (!compareData?.length) return [];
    return compareData
      .filter(d => {
        const curSev = SEVERITY[d.current_band] ?? 0;
        const fcSev  = SEVERITY[d.forecast_24h_band] ?? 0;
        return fcSev > curSev;
      })
      .map(d => ({
        ...d,
        severity: SEVERITY[d.forecast_24h_band] ?? 0,
        // use zone_label from API if present
        label: d.zone_label || d.h3_hex?.slice(0, 10),
      }))
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 12);
  }, [compareData]);

  return (
    <div className="alerts-panel panel">
      <div className="alerts-header">
        <div className="panel-label">⚡ Signal Alerts</div>
        <span className="alerts-count">{alerts.length}</span>
      </div>

      {!alerts.length ? (
        <div className="rec-empty">NO BAND CROSSINGS DETECTED — STABLE ✓</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {alerts.map((a, i) => {
            const src = srcLookup?.[a.h3_hex] || {};
            return (
              <li
                key={a.h3_hex}
                className="alert-item"
                style={{ borderLeftColor: SEV_BORDER[a.severity] || 'transparent', animationDelay: `${i * 40}ms` }}
                onClick={() => onSelectHex(a.lat, a.lon)}
                title="Click to fly to this zone"
              >
                {/* Top row: zone label + timestamp */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {a.label}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
                    T-{DEMO_TIMES[i] || '01:00'}
                  </span>
                </div>

                {/* Band transition */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    background: BAND_COLOR[a.current_band] + '22',
                    border: `1px solid ${BAND_COLOR[a.current_band]}55`,
                    color: BAND_COLOR[a.current_band],
                    padding: '1px 6px', borderRadius: 2,
                    fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>{a.current_band}</span>

                  <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem' }}>→</span>

                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    background: BAND_COLOR[a.forecast_24h_band] + '22',
                    border: `1px solid ${BAND_COLOR[a.forecast_24h_band]}55`,
                    color: BAND_COLOR[a.forecast_24h_band],
                    padding: '1px 6px', borderRadius: 2,
                    fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>{a.forecast_24h_band}</span>

                  <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--text-dim)' }}>
                    {a.current_aqi.toFixed(0)} → {a.forecast_24h_aqi.toFixed(0)}
                  </span>
                </div>

                {/* Confidence bars — only show if we have OSM scores */}
                {(src.traffic_confidence !== undefined) && (
                  <div style={{ display: 'flex', gap: 10, paddingTop: 4, borderTop: '1px solid var(--border-dim)' }}>
                    <ConfBar value={src.traffic_confidence}      color="#fbbf24" />
                    <ConfBar value={src.industrial_confidence}   color="#a78bfa" />
                    <ConfBar value={src.construction_confidence} color="#34d399" />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: 'var(--text-dim)', marginLeft: 'auto', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      {src.dominant_source}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
