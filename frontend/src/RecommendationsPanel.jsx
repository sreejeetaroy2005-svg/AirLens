import React, { useState, useEffect, useMemo } from 'react';

const API_BASE = 'http://localhost:8000';

const PRIORITY_META = {
  URGENT: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', label: 'URGENT' },
  HIGH:   { color: '#f97316', bg: 'rgba(249,115,22,0.10)', label: 'HIGH' },
  MEDIUM: { color: '#fbbf24', bg: 'rgba(251,191,36,0.10)', label: 'MEDIUM' },
  LOW:    { color: '#60a5fa', bg: 'rgba(96,165,250,0.08)', label: 'LOW' },
};

export default function RecommendationsPanel({ onSelectHex }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/recommendations`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const items = useMemo(() => data || [], [data]);

  return (
    <div className="rec-panel">
      <div className="rec-header">
        <span>🏛️ Enforcement Actions</span>
        <span className="rec-count">{items.length}</span>
      </div>

      {loading ? (
        <div className="rec-empty">Loading recommendations…</div>
      ) : !items.length ? (
        <div className="rec-empty">No enforcement actions required — conditions nominal ✓</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((item, i) => {
            const meta = PRIORITY_META[item.priority] || PRIORITY_META.LOW;
            const isOpen = expanded === i;
            return (
              <li
                key={item.h3_hex}
                className="rec-item"
                style={{ borderLeft: `3px solid ${meta.color}`, background: meta.bg }}
              >
                {/* Header row */}
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                  onClick={() => setExpanded(isOpen ? null : i)}
                >
                  <span style={{ fontSize: '1rem' }}>{item.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em',
                        color: meta.color, textTransform: 'uppercase',
                      }}>{meta.label}</span>
                      <span style={{ fontSize: '0.75rem', color: '#aaa' }}>
                        AQI {item.current_aqi} · {item.current_band}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#ccc', marginTop: 2 }}>
                      {[
                        item.is_traffic    && '🚗 Traffic',
                        item.is_industrial && '🏭 Industrial',
                        item.worsening_24h && '📈 Worsening',
                      ].filter(Boolean).join('  ')}
                    </div>
                  </div>
                  <span style={{ color: '#555', fontSize: '0.8rem', flexShrink: 0 }}>
                    {isOpen ? '▲' : '▼'}
                  </span>
                </div>

                {/* Expanded recommendation text + fly-to */}
                {isOpen && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: '#e5e7eb', lineHeight: 1.5 }}>
                      {item.recommendation}
                    </p>
                    <button
                      className="rec-fly-btn"
                      onClick={() => onSelectHex(item.lat, item.lon)}
                    >
                      📍 Fly to hex
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
