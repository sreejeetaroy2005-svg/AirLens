import React, { useState, useEffect, useRef, useCallback } from 'react';

// ─── Tour step definitions ────────────────────────────────────────────────────
// target: CSS selector for the element to spotlight
// side:   where to place the caption card relative to the spotlight
//         'right' | 'left' | 'bottom' | 'top' | 'center'
// action: optional function to call before this step renders (e.g. enable toggle)
const STEPS = [
  {
    id: 'map',
    target: 'canvas',
    side: 'center',
    title: '01 — Hyperlocal Hex Grid',
    body: 'Each coloured hexagon is an H3 resolution-8 cell (~0.7 km²), not a city-wide average. Delhi has 6 monitored zones; the system assigns every reading to the hex containing its CPCB monitoring station. Hover any hex for live AQI, band, and dominant pollution source.',
    accent: 'var(--accent)',
  },
  {
    id: 'summary',
    target: '.summary-strip-bar',
    side: 'bottom',
    title: '02 — System Heartbeat',
    body: 'The top bar shows city-wide averages computed from the latest data slice — avg AQI, dominant CPCB band, % hexes in Poor-or-worse, 72h trend direction, and a live elapsed-time ticker. The scanline animation signals the system is live, not static.',
    accent: 'var(--accent)',
  },
  {
    id: 'horizon',
    target: '#tour-horizon',
    side: 'left',
    title: '03 — 24 / 48 / 72h Forecast',
    body: 'Switch between current readings and LightGBM forecasts at 24, 48, or 72 hours ahead. Each horizon has its own trained model — the map colours update in real time. Hit ▶ PLAY to animate the progression. This is what separates the system from a reactive AQI display.',
    accent: '#00d4ff',
  },
  {
    id: 'model-stats',
    target: '#tour-model-stats',
    side: 'left',
    title: '04 — Model vs. Baseline Proof',
    body: 'The persistence baseline predicts "tomorrow = today" (RMSE 40.59). LightGBM achieves RMSE 32.44 — a 20% improvement. All three cities show 15–20% gains. This section also shows source attribution accuracy against DPCC/CPCB ground-truth zones (67% precision, 100% recall on traffic).',
    accent: '#4ade80',
  },
  {
    id: 'alerts',
    target: '.alerts-panel',
    side: 'right',
    title: '05 — Proactive Alert Detection',
    body: 'This panel automatically identifies zones whose forecast band is worse than their current band within 24 hours — before the air actually deteriorates. Each entry shows the band transition (e.g. Very Poor → Severe), the AQI delta, and confidence mini-bars for the dominant pollution source. Click any alert to fly to that zone.',
    accent: '#ef4444',
  },
  {
    id: 'recommendations',
    target: '.rec-panel',
    side: 'right',
    title: '06 — Evidence-Backed Enforcement Actions',
    body: 'Each flagged zone generates a specific enforcement recommendation ranked by a composite urgency score (current severity 30% + forecast trend 30% + source confidence 20% + vulnerable sites within 500m 20%). Expand any entry to see urgency breakdown, confidence bars, and a one-sentence evidence basis citing real computed values — not generic advice.',
    accent: '#f97316',
  },
  {
    id: 'reasoning-agent',
    target: '.rec-panel',
    side: 'right',
    title: '07 — LLM Reasoning Explanation',
    body: 'Expanding a recommendation card invokes an LLM reasoning agent sitting on top of the deterministic scoring engine. It synthesizes current AQI, 72h forecast trajectory, source attribution, and vulnerable site counts into natural-language rationale explaining why the zone was flagged — adding interpretability without replacing deterministic rule safety.',
    accent: '#a78bfa',
  },
  {
    id: 'business-impact',
    target: '#tour-business-impact',
    side: 'right',
    title: '08 — Real-Time Business Impact',
    body: 'The Business Impact panel projects financial and operational exposure (such as health cost impacts, vulnerable workforce risk, and potential compliance penalties). These metrics are dynamically calculated directly from active pipeline outputs and spatial hex overlays — not static or hardcoded marketing claims.',
    accent: '#34d399',
  },
  {
    id: 'source-toggle',
    target: '#tour-source-toggle',
    side: 'left',
    title: '09 — Source Attribution Overlay',
    body: 'Toggle the source attribution layer to colour hex borders by dominant pollution source — amber for traffic corridors, violet for industrial zones. Scores use OSM highway classification weights (motorway 10× down to residential 0.5×) plus a time-of-day multiplier peaking at rush hour. Explicitly labelled as a road-network structural proxy, not live vehicle telemetry.',
    accent: '#fbbf24',
  },
  {
    id: 'advisory',
    target: '.advisory-banner',
    side: 'bottom',
    title: '10 — Multilingual Citizen Advisory',
    body: 'The scrolling banner cycles through actionable public health advisories in regional languages (Hindi for Delhi/Ghaziabad/Noida; Marathi & Hindi for Mumbai) — auto-derived from the dominant CPCB band. Two audience variants: general public and sensitive groups (children, elderly, respiratory patients).',
    accent: 'rgba(0,212,255,0.75)',
  },
  {
    id: 'city-selector',
    target: '#tour-city-selector',
    side: 'left',
    title: '11 — Multi-City Coverage',
    body: 'Switch between Delhi, Ghaziabad, Noida, and Mumbai — each with its own independently trained LightGBM models. The map flies to the selected city. Enable the Cross-City Comparison toggle to see a ranked table showing each city\'s AQI, 72h forecast trend, and % poor-or-worse hexes side by side.',
    accent: 'var(--accent)',
  },
];

const TOTAL = STEPS.length;

// ─── Spotlight geometry helpers ───────────────────────────────────────────────
const PAD = 12;   // px padding around the spotlight target

function getSpotRect(selector) {
  // Canvas step: use center overlay (no spotlight hole — map fills whole screen)
  if (selector === 'canvas') return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: r.left   - PAD,
    y: r.top    - PAD,
    w: r.width  + PAD * 2,
    h: r.height + PAD * 2,
  };
}

// Card placement: tries preferred side, falls back to avoid viewport clipping
function cardStyle(spot, side, cardW = 340, cardH = 200) {
  if (!spot || side === 'center') {
    return {
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      width: cardW,
    };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 18;

  const placements = {
    right:  { left: spot.x + spot.w + gap,          top: spot.y,                            },
    left:   { left: spot.x - cardW - gap,            top: spot.y,                            },
    bottom: { left: spot.x + spot.w / 2 - cardW / 2, top: spot.y + spot.h + gap,            },
    top:    { left: spot.x + spot.w / 2 - cardW / 2, top: spot.y - cardH - gap,             },
  };

  let pos = placements[side] || placements.right;

  // Clamp to viewport
  pos.left = Math.max(12, Math.min(pos.left, vw - cardW - 12));
  pos.top  = Math.max(12, Math.min(pos.top,  vh - cardH - 12));

  return { position: 'fixed', left: pos.left, top: pos.top, width: cardW };
}

// ─── SVG overlay that cuts a spotlight hole ───────────────────────────────────
function SpotlightOverlay({ spot, color }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (!spot) {
    // Full-screen dim, no hole (used for canvas/center steps)
    return (
      <svg
        style={{ position: 'fixed', inset: 0, zIndex: 900, pointerEvents: 'none' }}
        width={vw} height={vh}
      >
        <rect x={0} y={0} width={vw} height={vh} fill="rgba(0,0,0,0.72)" />
      </svg>
    );
  }

  const rx = 4;
  const { x, y, w, h } = spot;
  const maskId = 'tour-spotlight-mask';

  return (
    <svg
      style={{ position: 'fixed', inset: 0, zIndex: 900, pointerEvents: 'none' }}
      width={vw} height={vh}
    >
      <defs>
        {/*
          Mask: white = show dim, black = transparent (shows through = spotlight).
          Full viewport white → spotlight rect black → punch hole.
        */}
        <mask id={maskId}>
          <rect x={0} y={0} width={vw} height={vh} fill="white" />
          <rect x={x} y={y} width={w} height={h} rx={rx} fill="black" />
        </mask>
      </defs>

      {/* Dimmed background with spotlight hole */}
      <rect
        x={0} y={0} width={vw} height={vh}
        fill="rgba(0,0,0,0.72)"
        mask={`url(#${maskId})`}
      />

      {/* Accent border ring around the spotlight */}
      <rect
        x={x - 1} y={y - 1}
        width={w + 2} height={h + 2}
        rx={rx + 1}
        fill="none"
        stroke={color || '#00d4ff'}
        strokeWidth={1.5}
        opacity={0.7}
      />

      {/* Subtle corner ticks — top-left and bottom-right */}
      <line x1={x - 1} y1={y + 8}      x2={x - 1}   y2={y - 1}   stroke={color || '#00d4ff'} strokeWidth={2} opacity={0.9} />
      <line x1={x - 1} y1={y - 1}      x2={x + 8}   y2={y - 1}   stroke={color || '#00d4ff'} strokeWidth={2} opacity={0.9} />
      <line x1={x + w + 1} y1={y + h - 8} x2={x + w + 1} y2={y + h + 1} stroke={color || '#00d4ff'} strokeWidth={2} opacity={0.9} />
      <line x1={x + w + 1} y1={y + h + 1} x2={x + w - 8} y2={y + h + 1} stroke={color || '#00d4ff'} strokeWidth={2} opacity={0.9} />
    </svg>
  );
}

// ─── Tour card ────────────────────────────────────────────────────────────────
function TourCard({ step, stepIdx, total, spot, onNext, onBack, onSkip }) {
  const style = cardStyle(spot, step.side);

  return (
    <div
      style={{
        ...style,
        zIndex: 910,
        background: 'linear-gradient(160deg, var(--bg-surface,#161b22) 0%, var(--bg-mid,#111418) 100%)',
        border: `1px solid ${step.accent}44`,
        borderTop: `1px solid ${step.accent}99`,
        borderRadius: 2,
        padding: '18px 20px',
        boxShadow: `0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px ${step.accent}18`,
        fontFamily: "'Inter', system-ui, sans-serif",
        pointerEvents: 'all',
        animation: 'tourCardIn 0.22s ease',
      }}
    >
      {/* Progress */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} style={{
              width: i === stepIdx ? 16 : 5,
              height: 3,
              borderRadius: 2,
              background: i === stepIdx ? step.accent : 'rgba(255,255,255,0.12)',
              transition: 'width 0.3s ease, background 0.3s ease',
            }} />
          ))}
        </div>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.58rem',
          color: 'rgba(255,255,255,0.3)',
          letterSpacing: '0.1em',
        }}>
          {stepIdx + 1} / {total}
        </span>
      </div>

      {/* Step title */}
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '0.65rem',
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: step.accent,
        marginBottom: 8,
      }}>
        {step.title}
      </div>

      {/* Body */}
      <p style={{
        fontSize: '0.8rem',
        lineHeight: 1.6,
        color: 'rgba(232,237,244,0.85)',
        margin: '0 0 16px',
      }}>
        {step.body}
      </p>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {stepIdx > 0 && (
          <button onClick={onBack} style={btnStyle('secondary')}>← BACK</button>
        )}
        <button onClick={onNext} style={btnStyle('primary', step.accent)}>
          {stepIdx === total - 1 ? 'DONE ✓' : 'NEXT →'}
        </button>
        <button onClick={onSkip} style={{ ...btnStyle('ghost'), marginLeft: 'auto' }}>
          SKIP TOUR
        </button>
      </div>
    </div>
  );
}

function btnStyle(variant, accent = '#00d4ff') {
  const base = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '0.62rem',
    fontWeight: 700,
    letterSpacing: '0.1em',
    border: 'none',
    borderRadius: 2,
    padding: '6px 14px',
    cursor: 'pointer',
    transition: 'opacity 0.15s, box-shadow 0.15s',
  };
  if (variant === 'primary')   return { ...base, background: `${accent}22`, border: `1px solid ${accent}66`, color: accent };
  if (variant === 'secondary') return { ...base, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' };
  return { ...base, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.25)', padding: '6px 6px' };
}

// ─── Main Tour component ──────────────────────────────────────────────────────
export default function FeatureTour({ onTourEnd }) {
  const [active, setActive]   = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [spot, setSpot]       = useState(null);
  const rafRef = useRef(null);

  const step = STEPS[stepIdx];

  // Compute spotlight rect for current step, updated on resize + step change
  const updateSpot = useCallback(() => {
    if (!active) return;
    const r = getSpotRect(step.target);
    setSpot(r);
  }, [active, step?.target]);

  useEffect(() => {
    if (!active) return;
    updateSpot();
    window.addEventListener('resize', updateSpot);
    return () => window.removeEventListener('resize', updateSpot);
  }, [active, updateSpot]);

  // Scroll target into view if needed
  useEffect(() => {
    if (!active) return;
    const el = document.querySelector(step.target);
    el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    // Re-measure after scroll settles
    const t = setTimeout(updateSpot, 200);
    return () => clearTimeout(t);
  }, [active, stepIdx]);

  const startTour = () => {
    setStepIdx(0);
    setActive(true);
  };

  const next = () => {
    if (stepIdx < TOTAL - 1) {
      setStepIdx(i => i + 1);
    } else {
      endTour();
    }
  };

  const back = () => setStepIdx(i => Math.max(0, i - 1));

  const endTour = () => {
    setActive(false);
    setSpot(null);
    onTourEnd?.();
  };

  return (
    <>
      {/* ── "Take the Tour" button — always visible ── */}
      <button
        onClick={startTour}
        style={{
          position: 'fixed',
          top: 68,          // just below summary strip + advisory
          right: 16,
          zIndex: active ? 0 : 950,   // hide behind overlay when tour is running
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.62rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          background: 'rgba(0,212,255,0.1)',
          border: '1px solid rgba(0,212,255,0.35)',
          color: '#00d4ff',
          borderRadius: 2,
          padding: '6px 14px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          transition: 'background 0.2s, box-shadow 0.2s',
          boxShadow: active ? 'none' : '0 0 12px rgba(0,212,255,0.15)',
          pointerEvents: active ? 'none' : 'all',
          opacity: active ? 0 : 1,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,212,255,0.18)'; e.currentTarget.style.boxShadow = '0 0 20px rgba(0,212,255,0.3)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,212,255,0.1)'; e.currentTarget.style.boxShadow = '0 0 12px rgba(0,212,255,0.15)'; }}
        aria-label="Start feature tour"
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <circle cx="5.5" cy="5.5" r="4.5" stroke="#00d4ff" strokeWidth="1.2"/>
          <text x="5.5" y="8.5" textAnchor="middle" fill="#00d4ff" fontSize="7" fontFamily="monospace">?</text>
        </svg>
        TAKE THE TOUR
      </button>

      {/* ── Tour overlay ── */}
      {active && (
        <>
          {/* Spotlight dim */}
          <SpotlightOverlay spot={spot} color={step.accent} />

          {/* Caption card */}
          <TourCard
            step={step}
            stepIdx={stepIdx}
            total={TOTAL}
            spot={spot}
            onNext={next}
            onBack={back}
            onSkip={endTour}
          />

          {/* Keyboard nav */}
          <KeyboardHandler onNext={next} onBack={back} onSkip={endTour} />
        </>
      )}

      {/* Card entrance animation */}
      <style>{`
        @keyframes tourCardIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}

// ─── Keyboard listener ────────────────────────────────────────────────────────
function KeyboardHandler({ onNext, onBack, onSkip }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') onNext();
      if (e.key === 'ArrowLeft')                        onBack();
      if (e.key === 'Escape')                           onSkip();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onNext, onBack, onSkip]);
  return null;
}
