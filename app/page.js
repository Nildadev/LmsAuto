'use client';

import { useState, useEffect, useRef } from 'react';

/* ─── Helpers ──────────────────────────────────────────────────────────── */
function getTimeStamp() {
  return new Date().toLocaleTimeString('vi-VN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// Màu log theo Material
function getLogStyle(msg) {
  if (msg.startsWith('❌')) return 'text-error';
  if (msg.startsWith('⚠️')) return 'text-warning';
  if (msg.startsWith('✅') || msg.startsWith('🏁')) return 'text-success';
  if (msg.startsWith('🚀') || msg.startsWith('📊')) return 'text-primary';
  return 'text-on-surface';
}

/* ─── Stat card (Material) ─────────────────────────────────────────────── */
function StatCard({ value, label, icon, tone = 'neutral' }) {
  const tones = {
    primary: 'bg-primary-container text-primary',
    success: 'bg-success-container text-success',
    error: 'bg-error-container text-error',
    neutral: 'bg-surface-container text-on-surface-variant',
  };
  return (
    <div className="md-card p-4 sm:p-5 flex items-center gap-3 sm:gap-4">
      <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center shrink-0 ${tones[tone]}`}>
        <span className="material-symbols-outlined text-[20px] sm:text-[24px]">{icon}</span>
      </div>
      <div className="min-w-0">
        <div className="text-[22px] sm:text-[28px] font-semibold leading-none text-on-surface">{value}</div>
        <div className="text-[12px] sm:text-[13px] text-on-surface-variant mt-1 truncate">{label}</div>
      </div>
    </div>
  );
}

/* ─── Material switch ──────────────────────────────────────────────────── */
/* Toàn bộ hàng là một <button> để chạm ở đâu cũng bật/tắt (tốt cho mobile). */
function Switch({ label, checked, onChange, disabled, hint }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={disabled ? undefined : onChange}
      disabled={disabled}
      className={`w-full min-h-[48px] flex items-center justify-between gap-4 text-left py-2
        rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className="flex flex-col">
        <span className="text-[14px] text-on-surface">{label}</span>
        {hint && <span className="text-[12px] text-on-surface-variant">{hint}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0
          ${checked ? 'bg-primary' : 'bg-outline'}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200
            ${checked ? 'translate-x-[22px]' : 'translate-x-[2px]'}`}
        />
      </span>
    </button>
  );
}

/* ─── Material outlined text field (floating label) ────────────────────── */
function TextField({ id, label, type = 'text', value, onChange, disabled, required }) {
  return (
    <div className="relative">
      <input
        id={id}
        type={type}
        placeholder=" "
        required={required}
        disabled={disabled}
        value={value}
        onChange={onChange}
        className="peer w-full rounded-lg border border-outline bg-surface px-4 pt-5 pb-2 text-[15px] text-on-surface outline-none transition-colors
          focus:border-primary focus:ring-1 focus:ring-primary
          disabled:bg-surface-container disabled:cursor-not-allowed"
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-3 top-[-9px] bg-surface px-1 text-[12px] text-on-surface-variant transition-all
          peer-placeholder-shown:top-[15px] peer-placeholder-shown:text-[14px]
          peer-focus:top-[-9px] peer-focus:text-[12px] peer-focus:text-primary"
      >
        {label}
      </label>
    </div>
  );
}

/* ─── Main Page ────────────────────────────────────────────────────────── */
export default function Home() {
  const [username, setUsername]             = useState('');
  const [password, setPassword]             = useState('');
  const [headlessMode, setHeadlessMode]     = useState(true); // mặc định ẩn trên host
  const [blacklistSubjects, setBlacklistSubjects] = useState(
    'võ nhạc,thể dục,xuất phát,nhịp điệu,âm nhạc,bốn mùa hòa ca,đá cầu,quan họ,giai điệu'
  );
  const [showSettings, setShowSettings]     = useState(false);
  const [logs, setLogs]                     = useState([]);
  const [isRunning, setIsRunning]           = useState(false);
  const [hasPreview, setHasPreview]         = useState(false);
  const [currentItem, setCurrentItem]       = useState('');
  const [theme, setTheme]                   = useState('system'); // system | light | dark
  const [scanClass, setScanClass]           = useState(true);     // quét cả khóa học của lớp
  const [stats, setStats]                   = useState({ total: 0, completed: 0, skipped: 0, errors: 0 });
  const logBoxRef     = useRef(null);
  const autoScrollRef = useRef(true);
  const previewImgRef = useRef(null);
  const loadedRef     = useRef(false);

  /* Load saved settings */
  useEffect(() => {
    // Không bao giờ lưu tài khoản/mật khẩu — dọn sạch dữ liệu cũ nếu có.
    localStorage.removeItem('lms_username');
    localStorage.removeItem('lms_password');
    const savedSettings = localStorage.getItem('lms_settings');
    const savedTheme    = localStorage.getItem('lms_theme');
    if (savedTheme) setTheme(savedTheme);
    if (savedSettings) {
      try {
        const s = JSON.parse(savedSettings);
        if (typeof s.headlessMode   === 'boolean') setHeadlessMode(s.headlessMode);
        if (typeof s.scanClass      === 'boolean') setScanClass(s.scanClass);
        if (s.blacklistSubjects)                   setBlacklistSubjects(s.blacklistSubjects);
      } catch { /* ignore */ }
    }
    loadedRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Persist settings (KHÔNG lưu tài khoản/mật khẩu) */
  useEffect(() => {
    if (!loadedRef.current) return;
    localStorage.setItem('lms_settings', JSON.stringify({
      headlessMode, scanClass, blacklistSubjects,
    }));
  }, [headlessMode, scanClass, blacklistSubjects]);

  /* Theme: áp dụng + theo dõi hệ thống khi ở chế độ system */
  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    if (loadedRef.current) localStorage.setItem('lms_theme', theme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (theme === 'system') apply(); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const cycleTheme = () => setTheme((t) => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'));

  /* Auto-scroll log — CHỈ cuộn trong khung nhật ký, không cuộn cả trang.
     Chỉ tự cuộn khi người dùng đang ở gần cuối; nếu họ cuộn lên đọc thì giữ nguyên. */
  useEffect(() => {
    const box = logBoxRef.current;
    if (box && autoScrollRef.current) box.scrollTop = box.scrollHeight;
  }, [logs]);

  const onLogScroll = () => {
    const box = logBoxRef.current;
    if (!box) return;
    autoScrollRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  };

  /* Parse log -> stats (khớp engine mới src/core/flow.js) */
  const addLog = (message) => {
    setLogs((prev) => [...prev, { message, time: getTimeStamp() }]);
    if (message.includes('cần làm')) {
      const totalM = message.match(/cần làm: (\d+)/);
      const assignedM = message.match(/Được giao: (\d+)/);
      if (totalM) {
        const total = parseInt(totalM[1]);
        const assigned = assignedM ? parseInt(assignedM[1]) : total;
        setStats((p) => ({ ...p, total, skipped: Math.max(0, assigned - total), completed: 0, errors: 0 }));
      }
    }
    if (message.includes('✅ Xong')) {
      setStats((p) => ({ ...p, completed: p.completed + 1 }));
    }
    if (message.includes('Chưa xác nhận hoàn thành')) {
      setStats((p) => ({ ...p, errors: p.errors + 1 }));
    }
    if (message.includes('Kết quả:')) {
      const m = message.match(/Kết quả: (\d+)\/(\d+) bài xác nhận xong, (\d+) lỗi\./);
      if (m) setStats((p) => ({ ...p, completed: parseInt(m[1]), total: parseInt(m[2]), errors: parseInt(m[3]) }));
    }
    const itemM = message.match(/━━━ \[\d+\/\d+\] \[[^\]]*\] (.+) ━━━/);
    if (itemM) setCurrentItem(itemM[1]);
  };

  /* Start */
  const startAutomation = async (e) => {
    e.preventDefault();
    if (isRunning) return;
    setIsRunning(true);
    setLogs([]);
    setHasPreview(false);
    if (previewImgRef.current) previewImgRef.current.src = '';
    setCurrentItem('');
    setStats({ total: 0, completed: 0, skipped: 0, errors: 0 });
    addLog('🚀 Đang khởi tạo kết nối với LMS360...');

    const subjects = blacklistSubjects.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      const response = await fetch('/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, headlessMode, blacklistSubjects: subjects, scanClass }),
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
            if (data.screenshot) {
              // Cập nhật ảnh qua ref để không re-render mỗi frame (~30fps).
              if (previewImgRef.current) previewImgRef.current.src = data.screenshot;
              setHasPreview(true); // React bỏ qua nếu đã true
            }
            if (data.done) { addLog('🏁 Hoàn tất!'); setIsRunning(false); }
            if (data.error) { addLog(`❌ Lỗi: ${data.error}`); setIsRunning(false); }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      addLog(`❌ Không thể kết nối: ${err.message}`);
      setIsRunning(false);
    }
  };

  const clearLogs = () => { setLogs([]); setStats({ total: 0, completed: 0, skipped: 0, errors: 0 }); };

  const progress = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  const previewStatus = isRunning ? (headlessMode ? 'HEADLESS' : 'VISIBLE') : 'IDLE';

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-background text-on-surface font-body-base">

      {/* ── Top app bar ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-surface border-b border-outline">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <span className="material-symbols-outlined text-primary text-[24px] sm:text-[26px] shrink-0">school</span>
            <span className="text-[15px] sm:text-[18px] font-medium text-on-surface truncate">LMS360 Auto Solver</span>
            <span className="hidden sm:inline text-[12px] px-2 py-0.5 rounded-full bg-primary-container text-on-primary-container shrink-0">v2.0</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={cycleTheme}
              title={`Giao diện: ${theme === 'system' ? 'Theo hệ thống' : theme === 'light' ? 'Sáng' : 'Tối'}`}
              className="md-iconbtn w-11 h-11 flex items-center justify-center shrink-0"
            >
              <span className="material-symbols-outlined">
                {theme === 'system' ? 'brightness_auto' : theme === 'light' ? 'light_mode' : 'dark_mode'}
              </span>
            </button>
            <div className="flex items-center gap-2 text-[13px] text-on-surface-variant">
              <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-success md-pulse' : 'bg-outline'}`} />
              <span className="hidden sm:inline">{isRunning ? 'Đang chạy…' : 'Sẵn sàng'}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">

        {/* ── Stats ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard value={stats.total}     label="Tổng bài" icon="library_books" tone="primary" />
          <StatCard value={stats.completed} label="Đã xong"  icon="task_alt"      tone="success" />
          <StatCard value={stats.errors}    label="Lỗi"      icon="error"         tone="error" />
          <StatCard value={stats.skipped}   label="Bỏ qua"   icon="skip_next"     tone="neutral" />
        </div>

        {/* ── Work area ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">

          {/* Left: preview + log */}
          <div className="lg:col-span-8 flex flex-col gap-4 sm:gap-6">

            {/* Live preview */}
            <div className="md-card overflow-hidden">
              <div className="flex items-center justify-between px-4 h-11 border-b border-outline">
                <div className="flex items-center gap-2 text-[13px] text-on-surface-variant">
                  <span className="material-symbols-outlined text-[18px]">visibility</span>
                  Xem trực tiếp
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium tracking-wide
                  ${isRunning
                    ? 'bg-primary-container text-on-primary-container'
                    : 'bg-surface-container text-on-surface-variant'}`}>
                  {previewStatus}
                </span>
              </div>
              <div className="relative w-full aspect-[1366/768] bg-surface-container flex items-center justify-center overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={previewImgRef}
                  alt="Xem trực tiếp"
                  className={`w-full h-full object-contain ${hasPreview ? '' : 'hidden'}`}
                />
                {!hasPreview && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-on-surface-variant">
                    <span className="material-symbols-outlined text-4xl opacity-50">visibility_off</span>
                    <span className="text-[13px]">{isRunning ? 'Đang tải hình ảnh…' : 'Chưa có hình ảnh'}</span>
                  </div>
                )}
              </div>
              <div className="px-4 py-2 border-t border-outline text-[13px] text-on-surface-variant truncate">
                {currentItem ? `▶ ${currentItem}`
                  : (isRunning ? 'Đang xử lý…' : 'Trình duyệt chạy ẩn trên máy chủ — đây là hình ảnh trực tiếp.')}
              </div>
            </div>

            {/* Log */}
            <div className="md-card overflow-hidden flex flex-col h-[280px] sm:h-[360px]">
              <div className="flex items-center justify-between px-4 h-11 border-b border-outline">
                <div className="flex items-center gap-2 text-[13px] text-on-surface-variant">
                  <span className="material-symbols-outlined text-[18px]">terminal</span>
                  Nhật ký
                </div>
                <button onClick={clearLogs} disabled={isRunning || logs.length === 0}
                  className="md-textbtn text-[12px] px-3 py-2 font-medium">
                  Xoá
                </button>
              </div>
              <div ref={logBoxRef} onScroll={onLogScroll}
                className="flex-1 overflow-y-auto bg-surface-container-low p-4 font-terminal text-terminal">
                {logs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-on-surface-variant">
                    <span className="material-symbols-outlined text-4xl opacity-50">terminal</span>
                    <span className="text-[13px]">Chưa có nhật ký</span>
                  </div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className="flex gap-2 md-in">
                      <span className="hidden sm:inline text-on-surface-variant/50 w-8 shrink-0 text-right select-none text-[11px] pt-[2px]">{i + 1}</span>
                      <span className="text-on-surface-variant shrink-0 text-[12px]">[{log.time}]</span>
                      <span className={`${getLogStyle(log.message)} break-words`}>{log.message}</span>
                    </div>
                  ))
                )}
                {isRunning && <div className="pl-10 pt-1"><span className="inline-block w-[7px] h-4 bg-primary animate-pulse" /></div>}
              </div>
            </div>
          </div>

          {/* Right: controls */}
          <div className="lg:col-span-4">
            <div className="md-card p-5 sm:p-6 flex flex-col">
              <h2 className="text-headline-md text-on-surface mb-5">Bắt đầu</h2>

              <form onSubmit={startAutomation} className="flex flex-col gap-4">
                <TextField id="username" label="Tài khoản" value={username} onChange={(e) => setUsername(e.target.value)} disabled={isRunning} required />
                <TextField id="password" label="Mật khẩu" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={isRunning} required />

                <div className="pt-2 space-y-3 border-t border-outline">
                  <Switch label="Chạy ẩn (headless)" checked={headlessMode} onChange={() => setHeadlessMode(!headlessMode)} disabled={isRunning} hint="Trình duyệt chạy ẩn trên máy chủ; xem qua khung hình trực tiếp bên trái." />
                  <Switch label="Quét cả lớp" checked={scanClass} onChange={() => setScanClass(!scanClass)} disabled={isRunning} hint="Quét toàn bộ khóa của lớp, không chỉ bài trong “việc cần làm”." />
                </div>

                <div>
                  <button type="button" onClick={() => setShowSettings(!showSettings)}
                    className="flex items-center gap-1 min-h-[44px] text-[13px] font-medium text-on-surface-variant hover:text-primary active:text-primary transition-colors">
                    <span className="material-symbols-outlined text-[18px]">{showSettings ? 'expand_less' : 'expand_more'}</span>
                    Môn bỏ qua
                  </button>
                  {showSettings && (
                    <textarea
                      rows={2}
                      disabled={isRunning}
                      value={blacklistSubjects}
                      onChange={(e) => setBlacklistSubjects(e.target.value)}
                      placeholder="thể dục, âm nhạc, mĩ thuật..."
                      className="w-full rounded-lg border border-outline bg-surface px-3 py-2 text-[13px] text-on-surface outline-none resize-none font-terminal
                        focus:border-primary focus:ring-1 focus:ring-primary disabled:bg-surface-container disabled:cursor-not-allowed"
                    />
                  )}
                </div>

                {stats.total > 0 && (
                  <div>
                    <div className="flex justify-between text-[13px] text-on-surface-variant mb-2">
                      <span>Tiến độ</span>
                      <span className="text-primary font-medium">{progress}%</span>
                    </div>
                    <div className="w-full h-2 bg-surface-container-high rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                )}

                <button type="submit" disabled={isRunning}
                  className="w-full py-3.5 md-btn text-[14px] font-medium flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-[20px]">{isRunning ? 'hourglass_top' : 'bolt'}</span>
                  {isRunning ? 'Đang chạy…' : 'Bắt đầu'}
                </button>
              </form>
            </div>
          </div>

        </div>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-1 text-[12px] text-on-surface-variant">
        <span>© 2026 Nildadev · Apache-2.0</span>
        <span>LMS360 Auto Solver v2.0</span>
      </footer>

    </div>
  );
}
