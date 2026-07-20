import React, { useState, useEffect, useMemo } from 'react';

const API_BASE = 'http://localhost:8000';

const PRIORITY_META = {
  URGENT: { color: '#ef4444', border: '#ef444466', bg: 'rgba(239,68,68,0.07)' },
  HIGH:   { color: '#f97316', border: '#f9731666', bg: 'rgba(249,115,22,0.06)' },
  MEDIUM: { color: '#fbbf24', border: '#fbbf2466', bg: 'rgba(251,191,36,0.05)' },
  LOW:    { color: '#60a5fa', border: '#60a5fa55', bg: 'rgba(96,165,250,0.04)' },
};

const SOURCE_META = {
  traffic:      { color: '#fbbf24', label: 'TRAFFIC',      icon: '◆' },
  industrial:   { color: '#a78bfa', label: 'INDUSTRIAL',   icon: '◆' },
  construction: { color: '#34d399', label: 'CONSTRUCTION', icon: '◆' },
};

// Urgency gauge — arc-style bar showing 0–100
function UrgencyGauge({ score, priority }) {
  const meta = PRIORITY_META[priority] || PRIORITY_META.LOW;
  const pct  = Math.min(score, 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* Numeric readout */}
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '1.1rem',
        fontWeight: 700,
        letterSpacing: '-0.02em',
        color: meta.color,
        lineHeight: 1,
        minWidth: 36,
      }}>{score.toFixed(0)}</span>

      {/* Bar */}
      <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: `linear-gradient(90deg, ${meta.color}88, ${meta.color})`,
          borderRadius: 2,
          transition: 'width 0.6s ease',
        }} />
      </div>

      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.56rem',
        fontWeight: 700,
        letterSpacing: '0.12em',
        color: meta.color,
        background: `${meta.color}18`,
        border: `1px solid ${meta.border}`,
        padding: '2px 5px',
        borderRadius: 2,
        textTransform: 'uppercase',
        flexShrink: 0,
      }}>{priority}</span>
    </div>
  );
}

// Urgency component breakdown — four mini columns
function UrgencyBreakdown({ breakdown }) {
  if (!breakdown) return null;
  const components = [
    { key: 'severity_component',      label: 'SEV',  max: 30 },
    { key: 'trend_component',         label: 'TRND', max: 30 },
    { key: 'confidence_component',    label: 'CONF', max: 20 },
    { key: 'vulnerability_component', label: 'VULN', max: 20 },
  ];
  return (
    <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
      {components.map(c => {
        const val = breakdown[c.key] || 0;
        const pct = (val / c.max) * 100;
        return (
          <div key={c.key} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{
              height: 18,
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 2,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'flex-end',
              marginBottom: 2,
            }}>
              <div style={{
                width: '100%',
                height: `${pct}%`,
                background: 'var(--accent)',
                opacity: 0.6,
                transition: 'height 0.5s ease',
              }} />
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5rem', color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
              {c.label}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.52rem', color: 'var(--accent)', opacity: 0.8 }}>
              {val.toFixed(1)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Confidence tri-bar
function ConfidenceMeter({ traffic, industrial, construction }) {
  const bars = [
    { label: 'T', val: traffic,      color: '#fbbf24' },
    { label: 'I', val: industrial,   color: '#a78bfa' },
    { label: 'C', val: construction, color: '#34d399' },
  ];
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
      {bars.map(b => (
        <div key={b.label} style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.52rem', color: b.color, textAlign: 'center', marginBottom: 2, letterSpacing: '0.08em' }}>{b.label}</div>
          <div style={{ height: 22, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden', display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ width: '100%', height: `${Math.min(b.val || 0, 100)}%`, background: b.color, opacity: 0.7, transition: 'height 0.5s ease' }} />
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.52rem', color: 'var(--text-dim)', textAlign: 'center', marginTop: 2 }}>{(b.val || 0).toFixed(0)}%</div>
        </div>
      ))}
    </div>
  );
}

let _seq = 1000;
function nextSeq() { return ++_seq; }

export default function RecommendationsPanel({ onSelectHex, activeCity }) {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    setLoading(true);
    setExpanded(null);
    // Recommendations only fully scored for Delhi (has OSM+vulnerability caches).
    // For other cities we still show the rule-based results.
    const cityParam = activeCity && activeCity !== 'Delhi' ? `?city=${activeCity}` : '';
    fetch(`${API_BASE}/recommendations${cityParam}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [activeCity]);

  // Already sorted by urgency_score descending from the API
  const items = useMemo(() => {
    if (!data) return [];
    return data.map(item => ({ ...item, _logId: nextSeq() }));
  }, [data]);

  return (
    <div className="rec-panel panel">
      <div className="rec-header">
        <div className="panel-label">🏛 Enforcement Log</div>
        <span className="rec-count">{items.length}</span>
      </div>

      {loading ? (
        <div className="rec-empty">FETCHING SIGNAL DATA…</div>
      ) : !items.length ? (
        <div className="rec-empty">CONDITIONS NOMINAL — NO ACTIONS REQUIRED ✓</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((item, i) => {
            const meta   = PRIORITY_META[item.priority] || PRIORITY_META.LOW;
            const isOpen = expanded === i;

            const activeSources = [
              item.is_traffic      && 'traffic',
              item.is_industrial   && 'industrial',
              item.is_construction && 'construction',
            ].filter(Boolean);

            return (
              <li
                key={item.h3_hex}
                className="rec-item"
                style={{ borderLeftColor: meta.color, background: meta.bg }}
              >
                {/* Collapsed header */}
                <div
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}
                  onClick={() => setExpanded(isOpen ? null : i)}
                >
                  {/* Log ID */}
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.52rem',
                    color: 'var(--text-dim)', letterSpacing: '0.06em',
                    flexShrink: 0, paddingTop: 2,
                  }}>#{item._logId}</span>

                  {/* Zone + sources */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'var(--font-sans)', fontSize: '0.76rem',
                      fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3,
                    }}>
                      {item.zone_label || item.h3_hex?.slice(0, 10)}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {activeSources.map(src => {
                        const sm = SOURCE_META[src];
                        return (
                          <span key={src} style={{
                            fontFamily: 'var(--font-mono)', fontSize: '0.58rem',
                            color: sm.color, letterSpacing: '0.05em',
                          }}>
                            {sm.icon} {sm.label}
                          </span>
                        );
                      })}
                      {item.worsening_24h && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color: '#dd2c00', letterSpacing: '0.05em' }}>↑ WORSENING</span>
                      )}
                    </div>
                  </div>

                  {/* Urgency gauge (right side) */}
                  <div style={{ flexShrink: 0, minWidth: 90 }}>
                    <UrgencyGauge score={item.urgency_score} priority={item.priority} />
                  </div>

                  <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem', flexShrink: 0, marginTop: 2 }}>
                    {isOpen ? '▲' : '▼'}
                  </span>
                </div>

                {/* Expanded detail */}
                {isOpen && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-dim)' }}>

                    {/* Urgency breakdown */}
                    <div style={{
                      fontFamily: 'var(--font-mono)', fontSize: '0.55rem',
                      color: 'var(--text-dim)', letterSpacing: '0.1em',
                      textTransform: 'uppercase', marginBottom: 4,
                    }}>Urgency Components</div>
                    <UrgencyBreakdown breakdown={item.urgency_breakdown} />

                    {/* Source confidence */}
                    {item.traffic_confidence !== undefined && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{
                          fontFamily: 'var(--font-mono)', fontSize: '0.55rem',
                          color: 'var(--text-dim)', letterSpacing: '0.1em',
                          textTransform: 'uppercase', marginBottom: 4,
                        }}>Source Attribution</div>
                        <ConfidenceMeter
                          traffic={item.traffic_confidence}
                          industrial={item.industrial_confidence}
                          construction={item.construction_confidence}
                        />
                      </div>
                    )}

                    {/* Vulnerability */}
                    {(item.schools_500m > 0 || item.hospitals_500m > 0) && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 12 }}>
                        {item.schools_500m > 0 && (
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: '#fbbf24', letterSpacing: '0.04em' }}>
                            🏫 {item.schools_500m} school{item.schools_500m !== 1 ? 's' : ''} &lt;500 m
                          </div>
                        )}
                        {item.hospitals_500m > 0 && (
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: '#f87171', letterSpacing: '0.04em' }}>
                            🏥 {item.hospitals_500m} hospital{item.hospitals_500m !== 1 ? 's' : ''} &lt;500 m
                          </div>
                        )}
                      </div>
                    )}

                    {/* Evidence basis */}
                    {item.evidence_basis && (
                      <div style={{
                        marginTop: 8, padding: '7px 9px',
                        background: 'rgba(0,212,255,0.04)',
                        border: '1px solid rgba(0,212,255,0.12)',
                        borderRadius: 2,
                      }}>
                        <div style={{
                          fontFamily: 'var(--font-mono)', fontSize: '0.55rem',
                          color: 'var(--accent)', letterSpacing: '0.1em',
                          textTransform: 'uppercase', marginBottom: 4,
                        }}>Evidence Basis</div>
                        <div style={{
                          fontFamily: 'var(--font-sans)', fontSize: '0.72rem',
                          color: 'rgba(0,212,255,0.75)', lineHeight: 1.5,
                          fontStyle: 'italic',
                        }}>
                          {item.evidence_basis}
                        </div>
                        {/* ToD regime disclosure — shown only when traffic is a source */}
                        {item.tod_regime && (item.is_traffic) && (
                          <div style={{
                            marginTop: 5,
                            fontFamily: 'var(--font-mono)', fontSize: '0.54rem',
                            color: 'var(--text-dim)', letterSpacing: '0.06em',
                          }}>
                            TRAFFIC PROXY · {item.tod_regime} · ×{item.tod_multiplier?.toFixed(2)} ToD scaling
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action text */}
                    <p style={{
                      margin: '10px 0 8px',
                      fontFamily: 'var(--font-sans)', fontSize: '0.75rem',
                      color: 'var(--text-primary)', lineHeight: 1.55,
                    }}>
                      {item.recommendation}
                    </p>

                    {/* Forecast row */}
                    <div style={{ display: 'flex', gap: 10, marginBottom: 10, fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--text-dim)' }}>
                      <span>NOW: <span style={{ color: 'var(--text-primary)' }}>{item.current_aqi} AQI</span></span>
                      <span>+24H: <span style={{ color: 'var(--text-secondary)' }}>{item.forecast_24h_aqi}</span></span>
                      <span>+72H: <span style={{ color: 'var(--text-secondary)' }}>{item.forecast_72h_aqi}</span></span>
                    </div>

                    <button className="rec-fly-btn" onClick={() => onSelectHex(item.lat, item.lon)}>
                      LOCATE {item.zone_label || 'ZONE'} ↗
                    </button>
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
