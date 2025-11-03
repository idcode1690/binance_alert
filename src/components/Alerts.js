import React from 'react';

export default function Alerts({ events = [], removeAlertByTs }) {
  return (
    <div className="alerts">
      <div className="alerts-title">Alerts</div>
      {events.length === 0 ? (
        <div className="no-alerts">No alerts yet</div>
      ) : (
        <ul className="alerts-list">
          {events.map((ev, i) => (
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
                  <div className="alert-price">{ev.price}</div>
                  <button className="delete-btn" onClick={() => removeAlertByTs(ev.ts)} aria-label="삭제" title="삭제">✕</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
