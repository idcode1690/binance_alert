import React, { useEffect, useState, useCallback } from 'react';

// 서버 설정 / 상태 / 심볼 관리 페이지
// 포함 기능 (요청 순서 1~4 구현):
// 1. 스캔 메타데이터(lastScanDuration, scannedCount, newMatches) 저장 및 표시
// 2. /scan-now 수동 스캔 트리거 버튼
// 3. 최근 매치 테이블 (최대 20개)
// 4. Telegram 테스트 버튼 (/send-alert 사용)

export default function ServerSettingsPage() {
  const raw = (process.env.REACT_APP_SERVER_URL && typeof process.env.REACT_APP_SERVER_URL === 'string') ? process.env.REACT_APP_SERVER_URL : '';
  const serverUrl = raw.trim().length > 0 ? raw.trim() : (typeof window !== 'undefined' ? window.location.origin : '');

  const [loading, setLoading] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [symbols, setSymbols] = useState([]);
  const [state, setState] = useState(null);
  const [form, setForm] = useState({ interval: '5m', emaShort: 26, emaLong: 200, scanType: 'both', crossCooldownMinutes: 30 });
  const [symbolsInput, setSymbolsInput] = useState('');
  const [message, setMessage] = useState(null);
  const [health, setHealth] = useState(null);

  const showMsg = useCallback((msg, ok = true) => {
    setMessage({ msg, ok, ts: Date.now() });
    setTimeout(() => { setMessage(null); }, 4500);
  }, []);

  const fetchAll = useCallback(async () => {
    if (!serverUrl) return;
    setLoading(true);
    try {
      const [cRes, sRes, stRes, hRes] = await Promise.all([
        fetch(`${serverUrl}/config`),
        fetch(`${serverUrl}/symbols`),
        fetch(`${serverUrl}/scan-state`),
        fetch(`${serverUrl}/health`)
      ]);
      const cJson = await cRes.json().catch(() => null);
      const sJson = await sRes.json().catch(() => null);
      const stJson = await stRes.json().catch(() => null);
      const hJson = await hRes.json().catch(() => null);
      if (cJson && cJson.ok && cJson.config) { setCfg(cJson.config); setForm(cJson.config); }
      if (sJson && sJson.ok && Array.isArray(sJson.symbols)) setSymbols(sJson.symbols);
      if (stJson && stJson.ok && stJson.state) setState(stJson.state);
      if (hJson && (hJson.ok || typeof hJson.telegramConfigured !== 'undefined')) setHealth(hJson);
    } catch (e) { showMsg('설정 조회 실패: ' + String(e), false); }
    finally { setLoading(false); }
  }, [serverUrl, showMsg]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const saveConfig = async () => {
    if (!serverUrl) return;
    try {
      const body = { ...form };
      if (typeof body.interval === 'number' || /^\d+$/.test(String(body.interval))) body.interval = `${body.interval}m`;
      const res = await fetch(`${serverUrl}/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => null);
      if (res.ok && j && j.ok) { setCfg(j.config); showMsg('설정 저장 완료'); }
      else showMsg('설정 저장 실패', false);
    } catch (e) { showMsg('설정 오류: ' + String(e), false); }
  };

  const saveSymbols = async () => {
    if (!serverUrl) return;
    try {
      let arr = symbolsInput.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
      if (!arr.length) { showMsg('심볼 입력이 비어있습니다', false); return; }
      const res = await fetch(`${serverUrl}/symbols`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(arr) });
      const j = await res.json().catch(() => null);
      if (res.ok && j && j.ok) { setSymbols(j.symbols); showMsg('심볼 저장 완료'); }
      else showMsg('심볼 저장 실패', false);
    } catch (e) { showMsg('심볼 오류: ' + String(e), false); }
  };

  const saveSymbolsArray = async (arr) => {
    if (!serverUrl) return;
    try {
      const res = await fetch(`${serverUrl}/symbols`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(arr) });
      const j = await res.json().catch(() => null);
      if (res.ok && j && j.ok) { setSymbols(j.symbols); showMsg('심볼 저장 완료'); }
      else showMsg('심볼 저장 실패', false);
    } catch (e) { showMsg('심볼 오류: ' + String(e), false); }
  };

  const removeSymbol = async (sym) => {
    try { const next = symbols.filter(s => s !== sym); setSymbols(next); await saveSymbolsArray(next); }
    catch (e) { showMsg('삭제 실패: ' + String(e), false); }
  };

  const runScanNow = async () => {
    if (!serverUrl) return;
    try {
      const res = await fetch(`${serverUrl}/scan-now`, { method: 'POST' });
      const j = await res.json().catch(() => null);
      if (res.ok && j) { showMsg(`수동 스캔 완료 (count=${j.count ?? 0})`); await refreshState(); }
      else showMsg('수동 스캔 실패', false);
    } catch (e) { showMsg('수동 스캔 오류: ' + String(e), false); }
  };

  const testTelegram = async () => {
    if (!serverUrl) return;
    try {
      const res = await fetch(`${serverUrl}/send-alert`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: 'TEST', message: '텔레그램 테스트', emaShort: form.emaShort, emaLong: form.emaLong })
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j && j.ok) showMsg('텔레그램 전송 성공'); else showMsg('텔레그램 전송 실패', false);
    } catch (e) { showMsg('텔레그램 오류: ' + String(e), false); }
  };

  const refreshState = async () => {
    if (!serverUrl) return;
    try {
      const res = await fetch(`${serverUrl}/scan-state`);
      const j = await res.json().catch(() => null);
      if (res.ok && j && j.ok) { setState(j.state); showMsg('상태 새로고침 완료'); }
      else showMsg('상태 조회 실패', false);
    } catch (e) { showMsg('상태 오류: ' + String(e), false); }
  };

  return (
    <div className="server-settings-page">
      <h2>Server Settings</h2>
      {!serverUrl && <div className="warning">서버 URL이 설정되지 않았습니다. REACT_APP_SERVER_URL 시크릿을 확인하세요.</div>}
      {message && <div className={`ss-toast ${message.ok ? 'ok' : 'err'}`}>{message.msg}</div>}

      <div className="section">
        <h3>현재 설정 & 상태</h3>
        {loading && <div className="loading">불러오는 중...</div>}
        <div className="btn-row" style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          <button onClick={refreshState}>새로고침</button>
          <button onClick={runScanNow}>수동 스캔 실행</button>
          <button onClick={testTelegram}>Telegram 테스트</button>
        </div>
        {cfg && (
          <div className="cfg-view">
            <div>interval: <strong>{cfg.interval}</strong></div>
            <div>emaShort: <strong>{cfg.emaShort}</strong></div>
            <div>emaLong: <strong>{cfg.emaLong}</strong></div>
            <div>scanType: <strong>{cfg.scanType}</strong></div>
            <div>cooldown(min): <strong>{cfg.crossCooldownMinutes ?? 30}</strong></div>
          </div>
        )}
        {health && (
          <div className="health">
            <div>telegramConfigured: <strong>{String(health.telegramConfigured)}</strong></div>
            <div>server time: {health.time ? new Date(health.time).toLocaleString() : '—'}</div>
          </div>
        )}
        {state && (
          <div className="scan-meta">
            <div>lastRun: {state.lastRun ? new Date(state.lastRun).toLocaleString() : '—'}</div>
            <div>lastError: {state.lastError || '없음'}</div>
            <div>matches stored: {Array.isArray(state.matches) ? state.matches.length : 0}</div>
            <div>lastScanDuration: {typeof state.lastScanDuration === 'number' ? `${state.lastScanDuration} ms` : '—'}</div>
            <div>scannedCount: {typeof state.scannedCount === 'number' ? state.scannedCount : '—'}</div>
            <div>newMatches(last run): {typeof state.newMatches === 'number' ? state.newMatches : '—'}</div>
          </div>
        )}
        {state && Array.isArray(state.matches) && state.matches.length > 0 && (
          <div className="matches">
            <h4>최근 매치 (최대 20)</h4>
            <table className="matches-table">
              <thead>
              <tr><th>Symbol</th><th>Type</th><th>Time</th><th>Interval</th><th>EMA</th></tr>
              </thead>
              <tbody>
              {state.matches.slice(0, 20).map((m,i) => (
                <tr key={m.symbol + m.time + i}>
                  <td>{m.symbol}</td>
                  <td>{m.type}</td>
                  <td>{m.time ? new Date(m.time).toLocaleString() : '—'}</td>
                  <td>{m.interval}</td>
                  <td>{`S${m.emaShort}/L${m.emaLong}`}</td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="section">
        <h3>설정 (읽기 전용 & Cooldown)</h3>
        <p className="note">EMA / Interval 값은 Alerts 페이지에서 변경되며 자동으로 서버에 적용됩니다. 여기서는 중복 알림 Cooldown 만 조정 가능합니다.</p>
        <div className="form-row">
          <label>Interval</label>
          <input value={cfg ? cfg.interval : form.interval} readOnly />
        </div>
        <div className="form-row">
          <label>EMA Short</label>
          <input value={cfg ? cfg.emaShort : form.emaShort} readOnly />
        </div>
        <div className="form-row">
          <label>EMA Long</label>
          <input value={cfg ? cfg.emaLong : form.emaLong} readOnly />
        </div>
        <div className="form-row">
          <label>Scan Type</label>
          <input value={cfg ? cfg.scanType : form.scanType} readOnly />
        </div>
        <div className="form-row">
          <label>Cooldown (minutes)</label>
          <input type="number" min={1} value={form.crossCooldownMinutes ?? 30} onChange={e => setForm(f => ({ ...f, crossCooldownMinutes: Number(e.target.value) }))} />
        </div>
        <button className="primary" onClick={saveConfig}>저장 (Cooldown만)</button>
      </div>

      <div className="section">
        <h3>심볼 목록</h3>
        <div className="symbols-box">
          {symbols.length ? symbols.map(s => (
            <span key={s} className="sym-chip">{s} <button className="chip-x" onClick={() => removeSymbol(s)}>×</button></span>
          )) : <em>없음</em>}
        </div>
        <textarea rows={3} placeholder="BTCUSDT ETHUSDT ..." value={symbolsInput} onChange={e => setSymbolsInput(e.target.value)} />
        <div style={{display:'flex', gap:8}}>
          <button onClick={saveSymbols}>심볼 저장 (입력값)</button>
          <button onClick={() => saveSymbolsArray(symbols)}>현재 심볼 저장</button>
        </div>
      </div>

      <div className="section">
        <h3>도움말</h3>
        <ul className="help-list">
          <li>서버 Cron으로 백그라운드 스캔이 계속 동작합니다.</li>
          <li>심볼은 USDT로 끝나는 선물 마켓 심볼만 유효합니다.</li>
          <li>Cooldown 내 동일 교차는 텔레그램 중복 전송 방지.</li>
          <li>텔레그램 미설정 시 매치만 저장되고 전송은 생략됩니다.</li>
        </ul>
      </div>
    </div>
  );
}
