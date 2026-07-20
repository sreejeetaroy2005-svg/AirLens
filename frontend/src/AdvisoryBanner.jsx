import React, { useState, useEffect, useRef } from 'react';

const API_BASE = 'http://localhost:8000';

const LANG_CYCLE = ['en', 'hi', 'kn'];
const LANG_LABEL = { en: 'EN', hi: 'हिं', kn: 'ಕನ್ನಡ' };

const FALLBACK = [
  { lang: 'en', text: 'Smart City Air Quality Intelligence · Delhi Pollution Detection · LightGBM 72h ahead warning system' },
  { lang: 'hi', text: 'स्मार्ट सिटी वायु गुणवत्ता बुद्धिमत्ता · दिल्ली प्रदूषण जांच डैशबोर्ड' },
  { lang: 'en', text: 'Powered by H3 hexagonal grid · 20% RMSE improvement over persistence baseline · 3-model ensemble' },
];

function buildMessages(advisoryData, band) {
  if (!advisoryData?.advisories || !band) return null;
  const entry = advisoryData.advisories[band];
  if (!entry) return null;
  const msgs = [];
  for (const lang of LANG_CYCLE) {
    const genText  = entry.general?.[lang];
    const sensText = entry.sensitive?.[lang];
    if (genText)  msgs.push({ lang, audience: 'general',   text: genText });
    if (sensText) msgs.push({ lang, audience: 'sensitive', text: sensText });
  }
  return msgs;
}

export default function AdvisoryBanner({ currentBand }) {
  const [advisoryData, setAdvisoryData] = useState(null);
  const [msgIdx, setMsgIdx]   = useState(0);
  const [visible, setVisible] = useState(true);
  const timerRef = useRef(null);

  useEffect(() => {
    fetch(`${API_BASE}/advisory`)
      .then(r => r.json())
      .then(setAdvisoryData)
      .catch(() => {});
  }, []);

  const messages = (advisoryData && currentBand)
    ? (buildMessages(advisoryData, currentBand) || FALLBACK)
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

  useEffect(() => { setMsgIdx(0); }, [currentBand]);

  const msg = messages[msgIdx] || messages[0];

  return (
    <div
      className="advisory-banner"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.3s ease' }}
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="advisory-lang-tag">{LANG_LABEL[msg.lang] || msg.lang}</span>
      {msg.audience === 'sensitive' && (
        <span className="advisory-sensitive-tag">⚕ SENSITIVE GROUPS</span>
      )}
      <span className="advisory-text">{msg.text}</span>
    </div>
  );
}
