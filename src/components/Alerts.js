import React, { useState } from 'react';
import { sendTelegramMessage } from '../utils/telegram';
import React, { useState } from 'react';

export default function Alerts({ events = [], removeAlertByTs, symbol, monitorMinutes, monitorEma1, monitorEma2 }) {
  const normTarget = (symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const visible = (events || []).filter((ev) => {
      try {
        if (!ev || !ev.type) return false;
        const t = (ev.type || '').toString();
      if (t.startsWith('telegram')) return false;
      const evSym = (ev.symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (normTarget && evSym !== normTarget) return false;
      return t === 'bull' || t === 'bear' || t === 'alert';
    } catch (e) {
      return false;
    }
  });
    const [error, setError] = useState(null);
    const [chatId, setChatId] = useState('');
    const [text, setText] = useState('');
    const [status, setStatus] = useState(null);

    const onSend = async () => {
      setError(null);
      setStatus('sending');
      try {
        const resp = await sendTelegramMessage({ chatId, text });
        setStatus('sent');
      } catch (e) {
        setStatus(null);
        setError(e.message);
      }
    };

    return (
      <div className="Alerts">
        <h3>Telegram Alerts</h3>
        <div>
          <label>Chat ID</label>
          <input value={chatId} onChange={(e)=>setChatId(e.target.value)} placeholder="@username or numeric id" />
        </div>
        <div>
          <label>Message</label>
          <input value={text} onChange={(e)=>setText(e.target.value)} placeholder="Enter message" />
        </div>
        <button onClick={onSend} disabled={!chatId || !text || status==='sending'}>Send</button>
        {status && <div className="status">{status}</div>}
        {error && <div className="error">{error}</div>}
      </div>
    );

  const [copiedSymbol, setCopiedSymbol] = useState(null);

  const copyToClipboard = async (s) => {
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(s);
      } else {
        const ta = document.createElement('textarea');
        ta.value = s;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedSymbol(s);
      setTimeout(() => setCopiedSymbol(null), 1200);
    } catch (e) {}
  };

  if (!visible || visible.length === 0) return null;

  return (
    <div className="alerts">
      <div style={{display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between'}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <div className="alerts-title">Alerts</div>
          <div className="monitor-badge">{`${monitorMinutes}m · EMA${monitorEma1}/${monitorEma2}`}</div>
        </div>
      </div>

      <ul className="alerts-list">
        {visible.map((ev, i) => (
          <li key={ev?.ts ?? i} className="alert-item">
            <div className="alert-left">
              <span className={`alert-indicator ${ev.type === 'bull' ? 'bull' : 'bear'}`} />
              <button type="button" className={`alert-symbol copy-btn ${copiedSymbol === ev.symbol ? 'copied' : ''}`} title="Copy symbol" onClick={(e) => { e.preventDefault(); copyToClipboard(ev.symbol || ''); }}>
                {ev.symbol || ''}
              </button>
            </div>

            <div className="alert-body">
              <div className="alert-info">
                <div className="alert-type-short">{ev.type === 'bull' ? 'Bull' : 'Bear'}</div>
                <div className="alert-time">{ev.time}</div>
              </div>
              <div className="alert-right">
                <div className="alert-price">{typeof ev.price === 'number' ? ev.price : ev.price}</div>
                <div className="alert-source">{ev.source || ''}</div>
                <button className="delete-btn" onClick={() => removeAlertByTs(ev.ts)} aria-label="삭제" title="삭제">✕</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
