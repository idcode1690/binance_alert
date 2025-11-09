import React, { useEffect, useState, useCallback } from 'react';

// 간단한 서버 설정 관리 페이지
// 기능:
//  - 현재 /config, /symbols, /scan-state 조회
//  - interval, emaShort, emaLong, scanType 수정 후 저장
//  - 심볼 목록 추가/교체
//  - 최근 매칭 테이블 표시
// REACT_APP_SERVER_URL 환경변수 또는 window.location.origin 사용 (App과 동일 로직 필요시 props로 전달 가능)

export default function ServerSettingsPage() {
  const raw = (process.env.REACT_APP_SERVER_URL && typeof process.env.REACT_APP_SERVER_URL === 'string') ? process.env.REACT_APP_SERVER_URL : '';
  const serverUrl = raw.trim().length > 0 ? raw.trim() : (typeof window !== 'undefined' ? window.location.origin : '');

  const [loading, setLoading] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [symbols, setSymbols] = useState([]);
  const [state, setState] = useState(null);
  const [form, setForm] = useState({ interval: '5m', emaShort: 26, emaLong: 200, scanType: 'both' });
  const [symbolsInput, setSymbolsInput] = useState('');
  const [message, setMessage] = useState(null);

  const showMsg = useCallback((msg, ok = true) => {
    setMessage({ msg, ok, ts: Date.now() });
    setTimeout(() => { setMessage(null); }, 5000);
  }, []);

  const fetchAll = useCallback(async () => {
    if (!serverUrl) return;
    setLoading(true);
    try {
      const [cRes, sRes, stRes] = await Promise.all([
        fetch(`${serverUrl}/config`),
        fetch(`${serverUrl}/symbols`),
        fetch(`${serverUrl}/scan-state`)
      ]);
      const cJson = await cRes.json().catch(() => null);
      const sJson = await sRes.json().catch(() => null);
      const stJson = await stRes.json().catch(() => null);
      if (cJson && cJson.ok && cJson.config) {
        setCfg(cJson.config);
        setForm(cJson.config);
      }
      if (sJson && sJson.ok && Array.isArray(sJson.symbols)) setSymbols(sJson.symbols);
      if (stJson && stJson.ok && stJson.state) setState(stJson.state);
    } catch (e) {
      showMsg('설정 조회 실패: ' + String(e), false);
    } finally {
      setLoading(false);
    }
  }, [serverUrl, showMsg]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const saveConfig = async () => {
    if (!serverUrl) return;
    try {
      const body = { ...form };
      // interval 숫자면 m 붙이기
      if (typeof body.interval === 'number' || /^\d+$/.test(String(body.interval))) body.interval = `${body.interval}m`;
      const res = await fetch(`${serverUrl}/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => null);
      if (res.ok && j && j.ok) {
        setCfg(j.config);
        showMsg('설정 저장 완료');
      } else showMsg('설정 저장 실패', false);
    } catch (e) { showMsg('설정 오류: ' + String(e), false); }
  };

  const saveSymbols = async () => {
    if (!serverUrl) return;
    try {
      // 쉼표/공백 구분해서 배열화
      let arr = symbolsInput.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
      if (!arr.length) { showMsg('심볼 입력이 비어있습니다', false); return; }
      const res = await fetch(`${serverUrl}/symbols`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(arr) });
      const j = await res.json().catch(() => null);
      if (res.ok && j && j.ok) {
        setSymbols(j.symbols);
        showMsg('심볼 저장 완료');
      } else showMsg('심볼 저장 실패', false);
    } catch (e) { showMsg('심볼 오류: ' + String(e), false); }
  };

  const refreshState = async () => {
    if (!serverUrl) return;
    try {
      const res = await fetch(`${serverUrl}/scan-state`);
      const j = await res.json().catch(() => null);
      if (res.ok && j && j.ok) {
        setState(j.state);
        showMsg('상태 새로고침 완료');
      } else showMsg('상태 조회 실패', false);
    } catch (e) { showMsg('상태 오류: ' + String(e), false); }
  };

  return (
    <div className="server-settings-page">
      <h2>Server Settings</h2>
      {!serverUrl && <div className="warning">서버 URL이 설정되지 않았습니다. REACT_APP_SERVER_URL 시크릿을 확인하세요.</div>}
      {message && (
        <div className={`ss-toast ${message.ok ? 'ok' : 'err'}`}>{message.msg}</div>
      )}
      <div className="section">
        <h3>현재 설정</h3>
        {loading && <div className="loading">불러오는 중...</div>}
        {cfg && (
          <div className="cfg-view">
            <div>interval: <strong>{cfg.interval}</strong></div>
            <div>emaShort: <strong>{cfg.emaShort}</strong></div>
            <div>emaLong: <strong>{cfg.emaLong}</strong></div>
            <div>scanType: <strong>{cfg.scanType}</strong></div>
          </div>
        )}
      </div>

      <div className="section">
        <h3>설정 변경</h3>
        <div className="form-row">
          <label>Interval (분 혹은 "5m")</label>
          <input value={form.interval} onChange={e => setForm(f => ({ ...f, interval: e.target.value }))} placeholder="5m" />
        </div>
        <div className="form-row">
          <label>EMA Short</label>
          <input type="number" value={form.emaShort} onChange={e => setForm(f => ({ ...f, emaShort: e.target.value }))} />
        </div>
        <div className="form-row">
          <label>EMA Long</label>
          <input type="number" value={form.emaLong} onChange={e => setForm(f => ({ ...f, emaLong: e.target.value }))} />
        </div>
        <div className="form-row">
          <label>Scan Type</label>
          <select value={form.scanType} onChange={e => setForm(f => ({ ...f, scanType: e.target.value }))}>
            <option value="golden">golden</option>
            <option value="dead">dead</option>
            <option value="both">both</option>
          </select>
        </div>
        <button className="primary" onClick={saveConfig}>저장 (Config)</button>
      </div>

      <div className="section">
        <h3>심볼 목록</h3>
        <div className="symbols-box">
          {symbols && symbols.length ? symbols.map(s => <span key={s} className="sym-chip">{s}</span>) : <em>없음</em>}
        </div>
        <textarea value={symbolsInput} onChange={e => setSymbolsInput(e.target.value)} placeholder="BTCUSDT ETHUSDT ..." rows={3} />
        <button onClick={saveSymbols}>심볼 저장</button>
      </div>

      <div className="section">
        <h3>스캔 상태</h3>
        <button onClick={refreshState}>새로고침</button>
        {state && (
          <div className="state-info">
            <div>lastRun: {state.lastRun ? new Date(state.lastRun).toLocaleString() : '—'}</div>
            <div>lastError: {state.lastError || '없음'}</div>
            <div>matches: {Array.isArray(state.matches) ? state.matches.length : 0}</div>
            {Array.isArray(state.matches) && state.matches.length > 0 && (
              <table className="matches-table">
                <thead>
                  <tr>
                    <th>시간</th><th>심볼</th><th>타입</th><th>Interval</th><th>EMA</th>
                  </tr>
                </thead>
                <tbody>
                  {state.matches.map((m, i) => (
                    <tr key={m.symbol + m.time + i}>
                      <td>{new Date(m.time).toLocaleString()}</td>
                      <td>{m.symbol}</td>
                      <td>{m.type}</td>
                      <td>{m.interval}</td>
                      <td>{`S${m.emaShort}/L${m.emaLong}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <div className="section">
        <h3>도움말</h3>
        <ul className="help-list">
          <li>프론트에서 설정 저장 후 종료해도 서버 Cron이 계속 스캔합니다.</li>
          <li>심볼은 USDT 선물 마켓 심볼만 인식합니다 (정규식 /USDT$/).</li>
          <li>동일 심볼/타입 교차는 30분 내 중복 텔레그램 전송을 방지합니다.</li>
          <li>텔레그램 설정이 없으면 매칭은 저장되지만 메시지는 전송되지 않습니다.</li>
        </ul>
      </div>
    </div>
  );
}
