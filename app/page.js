'use client';

import { useState, useEffect, useRef } from 'react';
import './globals.css';

function getTimeStamp() {
  return new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getLogClass(msg) {
  if (msg.startsWith('❌') || msg.startsWith('⚠️')) return 'error';
  if (msg.startsWith('✅') || msg.startsWith('🏁')) return 'success';
  if (msg.startsWith('🚀') || msg.startsWith('📊')) return 'info';
  return '';
}

export default function Home() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [debugMode, setDebugMode] = useState(false);
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const logEndRef = useRef(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (message) => {
    setLogs((prev) => [...prev, { message, time: getTimeStamp() }]);
  };

  const startAutomation = async (e) => {
    e.preventDefault();
    if (isRunning) return;

    setIsRunning(true);
    setLogs([]);
    addLog('🚀 Đang khởi tạo kết nối với LMS360...');

    try {
      const response = await fetch('/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, debugMode }),
      });

      if (!response.ok) {
        addLog(`❌ Máy chủ trả về lỗi: ${response.status}`);
        setIsRunning(false);
        return;
      }

      const reader = response.body.getReader();
      let partial = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = (partial + chunk).split('\n');
        partial = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.message) addLog(data.message);
            if (data.done) {
              addLog('🏁 Tự động hóa hoàn tất thành công!');
              setIsRunning(false);
            }
            if (data.error) {
              addLog(`❌ Lỗi: ${data.error}`);
              setIsRunning(false);
            }
          } catch { }
        }
      }
    } catch (err) {
      addLog(`❌ Không thể kết nối: ${err.message}`);
      setIsRunning(false);
    }
  };

  return (
    <div className="page-wrapper">
      {/* ─── HEADER ─── */}
      <header className="hero-header">
        <h1 className="hero-title">LMS360 AUTO SOLVER</h1>
        <p className="hero-subtitle">Hệ thống tự động hóa giải bài tập LMS — by Nildadev</p>
      </header>

      {/* ─── MAIN GRID ─── */}
      <div className="main-grid">

        {/* LEFT — Control Panel */}
        <div className="glass-card" style={{ animationDelay: '0.1s' }}>
          <div className="card-title">
            <span>⚙️</span> Bảng điều khiển
          </div>

          <form onSubmit={startAutomation}>
            <div className="form-group">
              <label className="form-label">Tài khoản</label>
              <input
                id="username"
                type="text"
                className="form-input"
                placeholder="Mã định danh"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={isRunning}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Mật khẩu</label>
              <input
                id="password"
                type="password"
                className="form-input"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isRunning}
              />
            </div>

            <div
              className={`debug-toggle${isRunning ? ' disabled-toggle' : ''}`}
              onClick={() => !isRunning && setDebugMode(!debugMode)}
            >
              <input
                type="checkbox"
                className="debug-checkbox"
                checked={debugMode}
                onChange={() => { }}
                disabled={isRunning}
              />
              <div className="debug-label">
                <span className="debug-label-title">🐛 Chế độ Debug</span>
                <span className="debug-label-desc">Bỏ qua bộ lọc, quét tất cả bài tập</span>
              </div>
            </div>

            <button type="submit" className="start-btn" disabled={isRunning}>
              {isRunning ? '⏳ Đang xử lý...' : '▶ Bắt đầu Tự động hóa'}
            </button>
          </form>
        </div>

        {/* RIGHT — Console Log */}
        <div className="glass-card console-card" style={{ animationDelay: '0.2s' }}>
          <div className="card-title">
            <span>📟</span> Console Log
          </div>

          <div className="console-body">
            {logs.length === 0 ? (
              <div className="console-empty">
                <div className="console-empty-icon">⚡</div>
                <div>Sẵn sàng để bắt đầu...</div>
              </div>
            ) : (
              <>
                {logs.map((log, i) => (
                  <div key={i} className="log-line">
                    <span className="log-time">[{log.time}]</span>
                    <span className={`log-msg ${getLogClass(log.message)}`}>{log.message}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </>
            )}
          </div>

          <div className="console-footer">
            <span>
              <span className={`status-dot${isRunning ? ' active' : ''}`}></span>
              {isRunning ? 'Đang chạy tự động...' : 'Chờ lệnh'}
            </span>
            <span>LMS360 Auto Solver v2.0</span>
          </div>
        </div>
      </div>

      {/* ─── FOOTER ─── */}
      <footer className="page-footer">
        Copyright © 2026 Nildadev · Apache License 2.0 · Phát triển với ❤️ dành cho cộng đồng học tập
      </footer>
    </div>
  );
}
