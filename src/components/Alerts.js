import React from 'react';

export default function Alerts({ events = [], removeAlertByTs, symbol, symbolValid, status, connect, disconnect, monitorMinutes, monitorEma1, monitorEma2, monitorConfirm }) {
  // Only show primary alert events (bull/bear). Hide telegram_send / telegram status events
  const normTarget = (symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const visible = (events || []).filter((ev) => {
    try {
      if (!ev || !ev.type) return false;
      const t = (ev.type || '').toString();
      // hide auxiliary telegram events
      if (t.startsWith('telegram')) return false;
      // only show items for the currently-selected symbol
      const evSym = (ev.symbol || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (normTarget && evSym !== normTarget) return false;
      // show only bull/bear or similar alert types
      return t === 'bull' || t === 'bear' || t === 'alert';
    } catch (e) {
      return false;
    }
  });

  if (!visible || visible.length === 0) return null;

  return (
    <div className="alerts">
      <div style={{display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between'}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <div className="alerts-title">Alerts</div>
          <div className="monitor-badge">{`${monitorMinutes}m · EMA${monitorEma1}/${monitorEma2}`}</div>
        </div>
        {/* Controls (Start/Stop) are shown in the Controls panel; remove duplicate buttons from here */}
      </div>

      <ul className="alerts-list">
        {visible.map((ev, i) => (
          <li key={ev?.ts ?? i} className="alert-item">
            <div className="alert-left">
              <span className={`alert-indicator ${ev.type === 'bull' ? 'bull' : 'bear'}`} />
              <div className="alert-symbol">{ev.symbol || ''}</div>
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
