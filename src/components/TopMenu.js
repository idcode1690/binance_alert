import React from 'react';
import { sendTelegramMessage } from '../utils/telegram';

export default function TopMenu({ onNavigate, view, darkMode, toggleDark, status = 'idle', connected = false }) {
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
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-start', alignItems: 'center'}}>
          <button className={`menu-btn ${view === 'alerts' ? 'active' : ''}`} onClick={() => onNavigate && onNavigate('alerts')}>Alerts</button>
          <button className={`menu-btn ${view === 'scanner' ? 'active' : ''}`} onClick={() => onNavigate && onNavigate('scanner')}>Scanner</button>
          <button className="menu-btn" onClick={handleTelegramTest} title="Send a Telegram test message">Telegram Test</button>
          {/* Server Settings removed per request */}
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
          <div className="top-status" style={{fontSize: 13, color: 'var(--muted-2)'}}>
            Status: <strong style={{color: 'var(--text)'}}>{status}</strong> {connected ? <span className="status-connected">(connected)</span> : <span className="status-disconnected">(disconnected)</span>}
          </div>
          <button className={`menu-btn theme-toggle ${darkMode ? 'active' : ''}`} onClick={() => toggleDark && toggleDark()} title={darkMode ? 'Light mode' : 'Dark mode'} aria-pressed={!!darkMode}>
            {darkMode ? 'Dark' : 'Light'}
          </button>
        </div>
      </div>
    </div>
  );
}
