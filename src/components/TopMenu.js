import React from 'react';
import { sendTelegramMessage } from '../utils/telegram';

export default function TopMenu({ onNavigate, view, darkMode, toggleDark, status = 'idle', connected = false, onTelegramTest }) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const handleTelegramTest = async () => {
    if (typeof onTelegramTest === 'function') {
      await onTelegramTest();
      return;
    }
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
          <button className={`theme-toggle icon-only ${darkMode ? 'active' : ''}`} onClick={() => toggleDark && toggleDark()} title={darkMode ? '라이트 모드' : '다크 모드'} aria-pressed={!!darkMode}>
            {darkMode ? (
              // Moon icon for dark mode
              <svg className="icon-moon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z"></path>
              </svg>
            ) : (
              // Sun icon for light mode
              <svg className="icon-sun" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0 4a1 1 0 0 1-1-1v-1a1 1 0 1 1 2 0v1a1 1 0 0 1-1 1Zm0-18a1 1 0 0 1-1-1V2a1 1 0 1 1 2 0v1a1 1 0 0 1-1 1Zm10 9a1 1 0 0 1-1-1h-1a1 1 0 1 1 0-2h1a1 1 0 1 1 2 0v1a1 1 0 0 1-1 1ZM4 12a1 1 0 0 1-1-1H2a1 1 0 1 1 0-2h1a1 1 0 1 1 2 0v1a1 1 0 0 1-1 1Zm14.95 6.364a1 1 0 0 1-1.414 1.414l-.707-.707a1 1 0 1 1 1.414-1.414l.707.707ZM6.121 6.121a1 1 0 0 1-1.414 1.414l-.707-.707A1 1 0 1 1 5.414 5.414l.707.707Zm12.728-4.95a1 1 0 0 1 1.414 1.414l-.707.707a1 1 0 0 1-1.414-1.414l.707-.707ZM6.828 18.364a1 1 0 0 1-1.414 1.414l-.707-.707a1 1 0 1 1 1.414-1.414l.707.707Z"></path>
              </svg>
            )}
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
          <button className={`menu-link theme icon-only ${darkMode ? 'active' : ''}`} onClick={() => { toggleDark && toggleDark(); setDrawerOpen(false); }} title={darkMode ? '라이트 모드' : '다크 모드'}>
            {darkMode ? (
              <svg className="icon-moon" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z"></path>
              </svg>
            ) : (
              <svg className="icon-sun" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0 4a1 1 0 0 1-1-1v-1a1 1 0 1 1 2 0v1a1 1 0 0 1-1 1Zm0-18a1 1 0 0 1-1-1V2a1 1 0 1 1 2 0v1a1 1 0 0 1-1 1Zm10 9a1 1 0 0 1-1-1h-1a1 1 0 1 1 0-2h1a1 1 0 1 1 2 0v1a1 1 0 0 1-1 1ZM4 12a1 1 0 0 1-1-1H2a1 1 0 1 1 0-2h1a1 1 0 1 1 2 0v1a1 1 0 0 1-1 1Zm14.95 6.364a1 1 0 0 1-1.414 1.414l-.707-.707a1 1 0 1 1 1.414-1.414l.707.707ZM6.121 6.121a1 1 0 0 1-1.414 1.414l-.707-.707A1 1 0 1 1 5.414 5.414l.707.707Zm12.728-4.95a1 1 0 0 1 1.414 1.414l-.707.707a1 1 0 0 1-1.414-1.414l.707-.707ZM6.828 18.364a1 1 0 0 1-1.414 1.414l-.707-.707a1 1 0 1 1 1.414-1.414l.707.707Z"></path>
              </svg>
            )}
          </button>
        </div>
      </div>
      {/* Backdrop */}
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
    </div>
  );
}
