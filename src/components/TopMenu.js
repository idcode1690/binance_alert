import React from 'react';
import { sendTelegramMessage } from '../utils/telegram';

export default function TopMenu({ onNavigate, view, darkMode, toggleDark, status = 'idle', connected = false }) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const handleTelegramTest = async () => {
    try {
      const resp = await sendTelegramMessage({ message: `Binance Alert: 테스트 메시지 (${new Date().toLocaleString()})`, confirmed: true });
      console.log('Telegram test sent:', resp);
      if (typeof window !== 'undefined') {
        alert('Telegram 테스트 메시지를 전송했습니다.');
      }
    } catch (e) {
      console.error('Telegram test failed:', e);
      if (typeof window !== 'undefined') {
        alert(`Telegram 전송 실패: ${e?.message || e}`);
      }
    }
  };
  return (
    <div className="top-menu-bar" style={{width: '100%', display: 'flex', justifyContent: 'center', padding: '10px 0', background: 'transparent'}}>
      <div style={{maxWidth: 980, width: '100%', display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center'}}>
        {/* Left side: desktop menu or mobile hamburger */}
        <div className="top-left" style={{display: 'flex', gap: 8, justifyContent: 'flex-start', alignItems: 'center'}}>
          <button className="hamburger-btn" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>
            <span className="hamburger-lines" />
          </button>
          <div className="top-links">
            <button className={`menu-btn ${view === 'alerts' ? 'active' : ''}`} onClick={() => onNavigate && onNavigate('alerts')}>Alerts</button>
            <button className={`menu-btn ${view === 'scanner' ? 'active' : ''}`} onClick={() => onNavigate && onNavigate('scanner')}>Scanner</button>
            <button className="menu-btn" onClick={handleTelegramTest} title="Send a Telegram test message">Telegram Test</button>
          </div>
        </div>
        {/* Right side: status + theme toggle */}
        <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
          <div className="top-status" style={{fontSize: 13, color: 'var(--muted-2)'}}>
            Status: <strong style={{color: 'var(--text)'}}>{status}</strong> {connected ? <span className="status-connected">(connected)</span> : <span className="status-disconnected">(disconnected)</span>}
          </div>
          <button className={`menu-btn theme-toggle ${darkMode ? 'active' : ''}`} onClick={() => toggleDark && toggleDark()} title={darkMode ? 'Light mode' : 'Dark mode'} aria-pressed={!!darkMode}>
            {darkMode ? 'Dark' : 'Light'}
          </button>
        </div>
      </div>
      {/* Slide-out drawer for mobile */}
      <div className={`side-drawer ${drawerOpen ? 'open' : ''}`} aria-hidden={!drawerOpen}>
        <div className="drawer-header">
          <button className="drawer-close" aria-label="Close menu" onClick={() => setDrawerOpen(false)}>✕</button>
        </div>
        <div className="drawer-links">
          <button className={`menu-link ${view === 'alerts' ? 'active' : ''}`} onClick={() => { onNavigate && onNavigate('alerts'); setDrawerOpen(false); }}>Alerts</button>
          <button className={`menu-link ${view === 'scanner' ? 'active' : ''}`} onClick={() => { onNavigate && onNavigate('scanner'); setDrawerOpen(false); }}>Scanner</button>
          <button className="menu-link" onClick={() => { handleTelegramTest(); setDrawerOpen(false); }}>Telegram Test</button>
          <button className={`menu-link theme ${darkMode ? 'active' : ''}`} onClick={() => { toggleDark && toggleDark(); setDrawerOpen(false); }}>{darkMode ? 'Dark' : 'Light'}</button>
        </div>
      </div>
      {/* Backdrop */}
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
    </div>
  );
}
