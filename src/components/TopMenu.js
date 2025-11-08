import React from 'react';

export default function TopMenu({ onNavigate, view, darkMode, toggleDark, serverSymbol, sseConnected, lastHealthyAt, telegramConfigured }) {
  function formatAge(ts) {
    if (!ts) return null;
    const diff = Math.max(0, Date.now() - ts);
    if (diff < 1000) return 'just now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  }
  const age = formatAge(lastHealthyAt);
  const fresh = lastHealthyAt && (Date.now() - lastHealthyAt) < 30000;

  return (
    <div className="top-menu-bar" style={{width: '100%', display: 'flex', justifyContent: 'center', padding: '10px 0', background: 'transparent'}}>
      <div style={{maxWidth: 980, width: '100%', display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center'}}>
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-start', alignItems: 'center'}}>
          <button className={`menu-btn ${view === 'alerts' ? 'active' : ''}`} onClick={() => onNavigate && onNavigate('alerts')}>Alerts</button>
          <button className={`menu-btn ${view === 'scanner' ? 'active' : ''}`} onClick={() => onNavigate && onNavigate('scanner')}>Scanner</button>
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
          <div style={{fontSize: '0.8rem'}}>
            <span style={{marginRight: 8}}>Server: {serverSymbol || 'n/a'}</span>
            <span className={sseConnected ? 'status-connected' : 'status-disconnected'}>{sseConnected ? 'SSE: connected' : 'SSE: disconnected'}</span>
          </div>
          <div style={{fontSize: '0.75rem'}}>
            <span style={{marginRight: 8}}>Telegram: {typeof telegramConfigured === 'boolean' ? (telegramConfigured ? 'ok' : 'not configured') : 'unknown'}</span>
            <span className={fresh ? 'status-connected' : 'status-disconnected'}>{age ? `healthy ${age}` : 'no health'}</span>
          </div>
          <button className={`menu-btn theme-toggle ${darkMode ? 'active' : ''}`} onClick={() => toggleDark && toggleDark()} title={darkMode ? 'Light mode' : 'Dark mode'} aria-pressed={!!darkMode}>
            {darkMode ? 'Dark' : 'Light'}
          </button>
        </div>
      </div>
    </div>
  );
}
