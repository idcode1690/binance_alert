import React, { useCallback, useEffect, useState } from 'react';
import './App.css';
import TopMenu from './components/TopMenu';
import ScannerPage from './pages/ScannerPage';
import Alerts from './components/Alerts';

function App() {
  const [view, setView] = useState('scanner');

  // Monitoring settings shared across pages
  const [monitorMinutes, setMonitorMinutes] = useState(5);
  const [monitorEma1, setMonitorEma1] = useState(26);
  const [monitorEma2, setMonitorEma2] = useState(200);
  const [monitorConfirm, setMonitorConfirm] = useState(1);

  // symbol list (optional) and alerts/events
  const [availableSymbols, setAvailableSymbols] = useState([]);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('alerts');
      if (raw) setEvents(JSON.parse(raw));
    } catch (e) {
      setEvents([]);
    }
  }, []);

  const fetchExchangeInfo = useCallback(async () => {
    try {
      const res = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
      if (!res.ok) return;
      const data = await res.json();
      if (data && Array.isArray(data.symbols)) {
        setAvailableSymbols(data.symbols.map((s) => s.symbol));
      }
    } catch (e) {}
  }, []);

  const removeAlertByTs = useCallback((ts) => {
    setEvents((prev) => {
      const next = (prev || []).filter((e) => e && e.ts !== ts);
      try { localStorage.setItem('alerts', JSON.stringify(next)); } catch (err) {}
      return next;
    });
  }, []);

  return (
    <div className="App">
      <TopMenu onNavigate={setView} view={view} />

      <main style={{ maxWidth: 980, margin: '12px auto', padding: '0 12px' }}>
        {view === 'scanner' && (
          <ScannerPage
            availableSymbols={availableSymbols}
            fetchExchangeInfo={fetchExchangeInfo}
            monitorMinutes={monitorMinutes}
            setMonitorMinutes={setMonitorMinutes}
            monitorEma1={monitorEma1}
            setMonitorEma1={setMonitorEma1}
            monitorEma2={monitorEma2}
            setMonitorEma2={setMonitorEma2}
          />
        )}

        {view === 'alerts' && (
          <Alerts
            events={events}
            removeAlertByTs={removeAlertByTs}
            symbol={''}
            monitorMinutes={monitorMinutes}
            monitorEma1={monitorEma1}
            monitorEma2={monitorEma2}
            monitorConfirm={monitorConfirm}
          />
        )}
      </main>
    </div>
  );
}

export default App;
