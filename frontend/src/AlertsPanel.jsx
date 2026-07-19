import React, { useMemo } from 'react';

const SEVERITY = { Good: 0, Satisfactory: 1, Moderate: 2, Poor: 3, 'Very Poor': 4, Severe: 5 };

// Band colours matching CPCB palette
const BAND_COLOR = {
  Good:         '#00B050',
  Satisfactory: '#92D050',
  Moderate:     '#FFFF00',
  Poor:         '#FF9900',
  'Very Poor':  '#FF0000',
  Severe:       '#C00000',
};

// Rough area labels for Bengaluru by lon/lat quadrant — good enough for demo
function areaLabel(lat, lon) {
  if (lat > 13.0)  return lon > 77.65 ? 'Yelahanka area' : 'Hebbal area';
  if (lat > 12.97) return lon > 77.65 ? 'Whitefield area' : 'Rajajinagar area';
  if (lat > 12.94) return lon > 77.6  ? 'Indiranagar area' : 'Malleswaram area';
  return lon > 77.6 ? 'HSR Layout area' : 'JP Nagar area';
}

export default function AlertsPanel({ compareData, onSelectHex }) {
  const alerts = useMemo(() => {
    if (!compareData?.length) return [];

    return compareData
      .filter(d => {
        const curSev = SEVERITY[d.current_band] ?? 0;
        const fcSev  = SEVERITY[d.forecast_24h_band] ?? 0;
        return fcSev > curSev;   // only hexes getting worse
      })
      .map(d => ({
        ...d,
        severity: SEVERITY[d.forecast_24h_band] ?? 0,
        label: areaLabel(d.lat, d.lon),
      }))
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 12);   // cap at 12 to keep panel usable
  }, [compareData]);

  return (
    <div className="alerts-panel">
      <div className="alerts-header">
        <span>⚠️ 24h Alerts</span>
        <span className="alerts-count">{alerts.length}</span>
      </div>

      {!alerts.length ? (
        <div style={{ fontSize: '0.78rem', color: '#666', padding: '12px 0', textAlign: 'center' }}>
          No band crossings forecast — air quality stable ✓
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {alerts.map(a => (
            <li
              key={a.h3_hex}
              className="alert-item"
              onClick={() => onSelectHex(a.lat, a.lon)}
              title="Click to fly to this hex"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: '0.9rem' }}>⚠️</span>
                <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>{a.label}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}>
                <span style={{
                  background: BAND_COLOR[a.current_band],
                  color: a.current_band === 'Moderate' ? '#333' : '#fff',
                  padding: '1px 6px', borderRadius: 3, fontWeight: 600,
                }}>{a.current_band}</span>
                <span style={{ color: '#888' }}>→</span>
                <span style={{
                  background: BAND_COLOR[a.forecast_24h_band],
                  color: a.forecast_24h_band === 'Moderate' ? '#333' : '#fff',
                  padding: '1px 6px', borderRadius: 3, fontWeight: 600,
                }}>{a.forecast_24h_band}</span>
                <span style={{ color: '#666', marginLeft: 'auto' }}>within 24h</span>
              </div>
              <div style={{ fontSize: '0.7rem', color: '#555', marginTop: 2 }}>
                AQI {a.current_aqi.toFixed(0)} → {a.forecast_24h_aqi.toFixed(0)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
