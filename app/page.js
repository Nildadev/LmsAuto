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
  const [headlessMode, setHeadlessMode] = useState(false);
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [saveCredentials, setSaveCredentials] = useState(false);
  const [blacklistSubjects, setBlacklistSubjects] = useState('võ nhạc,thể dục,xuất phát,nhịp điệu,âm nhạc,bốn mùa hòa ca,đá cầu,quan họ,giai điệu');
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState({ total: 0, completed: 0, skipped: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const logEndRef = useRef(null);

  useEffect(() => {
    const savedUsername = localStorage.getItem('lms_username');
    const savedPassword = localStorage.getItem('lms_password');
    const savedSettings = localStorage.getItem('lms_settings');
    
    if (savedUsername) setUsername(savedUsername);
    if (savedPassword) setPassword(savedPassword);
    if (savedSettings) {
      const settings = JSON.parse(savedSettings);
      setDebugMode(settings.debugMode || false);
      setHeadlessMode(settings.headlessMode || false);
      setAutoConfirm(settings.autoConfirm || false);
      setSaveCredentials(settings.saveCredentials || false);
      setBlacklistSubjects(settings.blacklistSubjects || 'võ nhạc,thể dục,xuất phát,nhịp điệu,âm nhạc,bốn mùa hòa ca,đá cầu,quan họ,giai điệu');
    }
  }, []);

  useEffect(() => {
    if (saveCredentials) {
      localStorage.setItem('lms_username', username);
      localStorage.setItem('lms_password', password);
    } else {
      localStorage.removeItem('lms_username');
      localStorage.removeItem('lms_password');
    }
    
    localStorage.setItem('lms_settings', JSON.stringify({
      debugMode,
      headlessMode,
      autoConfirm,
      saveCredentials,
      blacklistSubjects
    }));
  }, [username, password, debugMode, headlessMode, autoConfirm, saveCredentials, blacklistSubjects]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (message) => {
    setLogs((prev) => [...prev, { message, time: getTimeStamp() }]);
    
    if (message.includes('Tổng số bài quét thấy')) {
      const match = message.match(/Tổng số bài quét thấy: (\d+)/);
      if (match) setStats(prev => ({ ...prev, total: parseInt(match[1]) }));
    }
    if (message.includes('Số bài sẽ học')) {
      const match = message.match(/Số bài sẽ học: (\d+)/);
      if (match) setStats(prev => ({ ...prev, completed: 0, total: parseInt(match[1]) }));
    }
    if (message.includes('Số bài bỏ qua')) {
      const match = message.match(/Số bài bỏ qua: (\d+)/);
      if (match) setStats(prev => ({ ...prev, skipped: parseInt(match[1]) }));
    }
    if (message.includes('Hoàn tất khóa học')) {
      setStats(prev => ({ ...prev, completed: prev.completed + 1 }));
    }
  };

  const startAutomation = async (e) => {
    e.preventDefault();
    if (isRunning) return;

    setIsRunning(true);
    setLogs([]);
    setStats({ total: 0, completed: 0, skipped: 0 });
    addLog('🚀 Đang khởi tạo kết nối với LMS360...');

    const subjects = blacklistSubjects.split(',').map(s => s.trim()).filter(s => s);

    try {
      const response = await fetch('/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username, 
          password, 
          debugMode, 
          headlessMode, 
          autoConfirm,
          blacklistSubjects: subjects
        }),
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

  const clearLogs = () => {
    setLogs([]);
    setStats({ total: 0, completed: 0, skipped: 0 });
  };

  const progress = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  return (
    <div className="page-wrapper">
      <header className="hero-header">
        <h1 className="hero-title">LMS360 AUTO SOLVER</h1>
        <p className="hero-subtitle">Hệ thống tự động hóa giải bài tập LMS — by Nildadev</p>
      </header>

      <div className="main-grid">
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

            <div className="settings-toggle" onClick={() => setShowSettings(!showSettings)}>
              <span className="settings-toggle-icon">{showSettings ? '▼' : '▶'}</span>
              <span className="settings-toggle-text">Cài đặt nâng cao</span>
            </div>

            {showSettings && (
              <div className="settings-panel">
                <div className="form-group">
                  <label className="form-label">Môn học cần bỏ qua (ngăn cách bằng dấu phẩy)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="võ nhạc, thể dục, âm nhạc..."
                    value={blacklistSubjects}
                    onChange={(e) => setBlacklistSubjects(e.target.value)}
                    disabled={isRunning}
                  />
                </div>

                <div className={`option-toggle${isRunning ? ' disabled-toggle' : ''}`} onClick={() => !isRunning && setHeadlessMode(!headlessMode)}>
                  <input type="checkbox" className="option-checkbox" checked={headlessMode} onChange={() => { }} disabled={isRunning} />
                  <div className="option-label">
                    <span className="option-label-title">👁️ Chế độ ẩn (Headless)</span>
                    <span className="option-label-desc">Không hiển thị trình duyệt khi chạy</span>
                  </div>
                </div>

                <div className={`option-toggle${isRunning ? ' disabled-toggle' : ''}`} onClick={() => !isRunning && setAutoConfirm(!autoConfirm)}>
                  <input type="checkbox" className="option-checkbox" checked={autoConfirm} onChange={() => { }} disabled={isRunning} />
                  <div className="option-label">
                    <span className="option-label-title">⚡ Xác nhận tự động</span>
                    <span className="option-label-desc">Bỏ qua bước xác nhận trước khi chạy</span>
                  </div>
                </div>

                <div className={`option-toggle${isRunning ? ' disabled-toggle' : ''}`} onClick={() => !isRunning && setSaveCredentials(!saveCredentials)}>
                  <input type="checkbox" className="option-checkbox" checked={saveCredentials} onChange={() => { }} disabled={isRunning} />
                  <div className="option-label">
                    <span className="option-label-title">💾 Lưu thông tin đăng nhập</span>
                    <span className="option-label-desc">Lưu tài khoản vào trình duyệt</span>
                  </div>
                </div>

                <div className={`option-toggle${isRunning ? ' disabled-toggle' : ''}`} onClick={() => !isRunning && setDebugMode(!debugMode)}>
                  <input type="checkbox" className="option-checkbox" checked={debugMode} onChange={() => { }} disabled={isRunning} />
                  <div className="option-label">
                    <span className="option-label-title">🐛 Chế độ Debug</span>
                    <span className="option-label-desc">Bỏ qua bộ lọc, quét tất cả bài tập</span>
                  </div>
                </div>
              </div>
            )}

            <button type="submit" className="start-btn" disabled={isRunning}>
              {isRunning ? '⏳ Đang xử lý...' : '▶ Bắt đầu Tự động hóa'}
            </button>
          </form>
        </div>

        <div className="glass-card console-card" style={{ animationDelay: '0.2s' }}>
          <div className="card-title">
            <span>📟</span> Console Log
          </div>

          <div className="stats-bar">
            <div className="stat-item">
              <span className="stat-label">Tổng:</span>
              <span className="stat-value">{stats.total}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Hoàn thành:</span>
              <span className="stat-value success">{stats.completed}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Bỏ qua:</span>
              <span className="stat-value warning">{stats.skipped}</span>
            </div>
          </div>

          {stats.total > 0 && (
            <div className="progress-container">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }}></div>
              </div>
              <span className="progress-text">{progress}%</span>
            </div>
          )}

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
            <button className="clear-btn" onClick={clearLogs} disabled={isRunning || logs.length === 0}>
              🗑️ Xóa
            </button>
          </div>
        </div>
      </div>

      <footer className="page-footer">
        Copyright © 2026 Nildadev · Apache License 2.0 · Phát triển với ❤️ dành cho cộng đồng học tập
      </footer>
    </div>
  );
}
