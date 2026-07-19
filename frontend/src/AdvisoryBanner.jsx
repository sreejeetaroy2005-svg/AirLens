import React, { useState, useEffect, useRef } from 'react';

const API_BASE = 'http://localhost:8000';

// Cycle order: EN → KN → HI → EN …
const LANG_CYCLE = ['en', 'kn', 'hi'];
const LANG_LABEL = { en: 'EN', kn: 'ಕನ್ನಡ', hi: 'हिं' };

// Fallback static messages used until the API responds
const FALLBACK = [
  { lang: 'en', text: '🏙️ Smart City Air Quality Intelligence · Bengaluru Pollution Detection Dashboard' },
  { lang: 'kn', text: '🏙️ ಸ್ಮಾರ್ಟ್ ಸಿಟಿ ವಾಯು ಗುಣಮಟ್ಟ ತಿಳಿವಳಿಕೆ · ಬೆಂಗಳೂರು ಮಾಲಿನ್ಯ ಪತ್ತೆ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್' },
  { lang: 'hi', text: '🏙️ स्मार्ट सिटी वायु गुणवत्ता बुद्धिमत्ता · बेंगलुरु प्रदूषण जांच डैशबोर्ड' },
];

// Derive banner messages from the /advisory API response for the current city avg band
function buildMessages(advisoryData, band) {
  if (!advisoryData?.advisories || !band) return null;
  const entry = advisoryData.advisories[band];
  if (!entry) return null;
  const msgs = [];
  for (const lang of LANG_CYCLE) {
    const genText  = entry.general?.[lang];
    const sensText = entry.sensitive?.[lang];
    if (genText)  msgs.push({ lang, audience: 'general',   text: genText });
    if (sensText) msgs.push({ lang, audience: 'sensitive', text: `⚕️ ${sensText}` });
  }
  return msgs;
}

export default function AdvisoryBanner({ currentBand }) {
  const [advisoryData, setAdvisoryData] = useState(null);
  const [msgIdx, setMsgIdx]   = useState(0);
  const [visible, setVisible] = useState(true);
  const timerRef = useRef(null);

  // Fetch full advisory table once
  useEffect(() => {
    fetch(`${API_BASE}/advisory`)
      .then(r => r.json())
      .then(setAdvisoryData)
      .catch(() => {});
  }, []);

  const messages = (advisoryData && currentBand)
    ? (buildMessages(advisoryData, currentBand) || FALLBACK)
    : FALLBACK;

  // Auto-cycle with fade
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setMsgIdx(i => (i + 1) % messages.length);
        setVisible(true);
      }, 350);
    }, 4500);
    return () => clearInterval(timerRef.current);
  }, [messages.length]);

  // Reset index if band/messages change
  useEffect(() => { setMsgIdx(0); }, [currentBand]);

  const msg = messages[msgIdx] || messages[0];

  return (
    <div
      className="advisory-banner"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.35s ease' }}
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="advisory-lang-tag">{LANG_LABEL[msg.lang] || msg.lang}</span>
      {msg.audience === 'sensitive' && (
        <span className="advisory-sensitive-tag">Sensitive Groups</span>
      )}
      <span className="advisory-text">{msg.text}</span>
    </div>
  );
}
