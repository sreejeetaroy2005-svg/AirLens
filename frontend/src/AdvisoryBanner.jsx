import React, { useState, useEffect, useRef } from 'react';

const API_BASE = 'http://localhost:8000';

// Language labels shown in the banner tag
const LANG_LABEL = { en: 'EN', hi: 'हिं', mr: 'मराठी' };

// Languages per city — matches the backend /advisory endpoint exactly.
// Delhi/Ghaziabad/Noida: English + Hindi
// Mumbai: English + Hindi + Marathi
// Kannada removed — it was a leftover from the Bengaluru planning stage
// and does not correspond to any city in this system.
function getLangCycle(activeCity) {
  if (activeCity === 'Mumbai') return ['en', 'hi', 'mr'];
  return ['en', 'hi'];
}

const FALLBACK = [
  { lang: 'en', text: 'Smart City Air Quality Intelligence · LightGBM 72h ahead warning · 4-city coverage' },
  { lang: 'hi', text: 'स्मार्ट सिटी वायु गुणवत्ता बुद्धिमत्ता · LightGBM 72 घंटे पूर्व चेतावनी' },
];

function buildMessages(advisoryData, band, langCycle) {
  if (!advisoryData?.advisories || !band) return null;
  const entry = advisoryData.advisories[band];
  if (!entry) return null;
  const msgs = [];
  for (const lang of langCycle) {
    const genText  = entry.general?.[lang];
    const sensText = entry.sensitive?.[lang];
    if (genText)  msgs.push({ lang, audience: 'general',   text: genText });
    if (sensText) msgs.push({ lang, audience: 'sensitive', text: sensText });
  }
  return msgs.length ? msgs : null;
}

export default function AdvisoryBanner({ currentBand, activeCity }) {
  const [advisoryData, setAdvisoryData] = useState(null);
  const [msgIdx, setMsgIdx]   = useState(0);
  const [visible, setVisible] = useState(true);
  const timerRef = useRef(null);

  const langCycle = getLangCycle(activeCity);

  // Re-fetch when city changes so language set is correct
  useEffect(() => {
    const cityParam = activeCity ? `?city=${activeCity}` : '';
    fetch(`${API_BASE}/advisory${cityParam}`)
      .then(r => r.json())
      .then(setAdvisoryData)
      .catch(() => {});
  }, [activeCity]);

  // Reset index on city or band change
  useEffect(() => { setMsgIdx(0); }, [currentBand, activeCity]);

  const messages = (advisoryData && currentBand)
    ? (buildMessages(advisoryData, currentBand, langCycle) || FALLBACK)
    : FALLBACK;

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setMsgIdx(i => (i + 1) % messages.length);
        setVisible(true);
      }, 300);
    }, 5000);
    return () => clearInterval(timerRef.current);
  }, [messages.length]);

  const msg = messages[msgIdx] || messages[0];

  return (
    <div
      className="advisory-banner"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.3s ease' }}
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="advisory-lang-tag">{LANG_LABEL[msg.lang] || msg.lang.toUpperCase()}</span>
      {msg.audience === 'sensitive' && (
        <span className="advisory-sensitive-tag">⚕ SENSITIVE GROUPS</span>
      )}
      <span className="advisory-text">{msg.text}</span>
    </div>
  );
}
