'use client';

import { useState, useEffect, useRef } from 'react';

/* ─── Helpers ──────────────────────────────────────────────────────────── */
function getTimeStamp() {
  return new Date().toLocaleTimeString('vi-VN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function getLogStyle(msg) {
  if (msg.startsWith('❌') || msg.startsWith('⚠️')) return 'text-[#ffb4ab]';
  if (msg.startsWith('✅') || msg.startsWith('🏁'))  return 'text-[#4edea3]';
  if (msg.startsWith('🚀') || msg.startsWith('📊'))  return 'text-[#89ceff]';
  if (msg.includes('WARN') || msg.includes('⚠'))     return 'text-[#facc15]';
  return 'text-[#dae2fd]';
}

/* ─── Circular Progress SVG ────────────────────────────────────────────── */
function CircularStat({ value, max, color, icon, label }) {
  const r = 28;
  const circ = 2 * Math.PI * r; // ≈ 175.9
  const offset = max > 0 ? circ - (value / max) * circ : circ;
  return (
    <div className="glass-panel rounded-lg p-6 flex items-center justify-between relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-[#89ceff]/5 to-transparent pointer-events-none" />
      <div>
        <div className="font-mono-label text-mono-label text-on-surface-variant mb-1 uppercase tracking-wider">
          {label}
        </div>
        <div className={`text-headline-lg font-semibold ${color}`}>{value}</div>
      </div>
      <div className="w-16 h-16 flex items-center justify-center relative">
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 64 64">
          <circle className="text-surface-container" cx="32" cy="32" r={r}
            fill="none" stroke="currentColor" strokeWidth="4" />
          <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="4"
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round"
            className={`${color} transition-all duration-700`} />
        </svg>
        <span className={`material-symbols-outlined text-xl relative z-10 ${color}`}>{icon}</span>
      </div>
    </div>
  );
}

/* ─── Toggle Switch ────────────────────────────────────────────────────── */
function Toggle({ label, checked, onChange, disabled }) {
  return (
    <label className={`flex items-center justify-between ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <span className="text-[14px] text-[#bec8d2]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={disabled ? undefined : onChange}
        disabled={disabled}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200
          focus:outline-none disabled:cursor-not-allowed
          ${checked ? 'bg-[#00a572]' : 'bg-[#222a3d]'}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-[#4edea3] shadow transition-transform duration-200
            ${checked ? 'translate-x-[18px]' : 'translate-x-[3px]'}`}
        />
      </button>
    </label>
  );
}

/* ─── Main Page ────────────────────────────────────────────────────────── */
export default function Home() {
  const [username, setUsername]             = useState('');
  const [password, setPassword]             = useState('');
  const [headlessMode, setHeadlessMode]     = useState(false);
  const [autoConfirm, setAutoConfirm]       = useState(false);
  const [saveCredentials, setSaveCredentials] = useState(false);
  const [debugMode, setDebugMode]           = useState(false);
  const [blacklistSubjects, setBlacklistSubjects] = useState(
    'võ nhạc,thể dục,xuất phát,nhịp điệu,âm nhạc,bốn mùa hòa ca,đá cầu,quan họ,giai điệu'
  );
  const [showSettings, setShowSettings]     = useState(false);
  const [logs, setLogs]                     = useState([]);
  const [isRunning, setIsRunning]           = useState(false);
  const [stats, setStats]                   = useState({ total: 0, completed: 0, skipped: 0 });
  const logEndRef  = useRef(null);
  const loadedRef  = useRef(false); // gate: don't persist before loading

  /* Load saved settings on mount */
  useEffect(() => {
    const savedUser     = localStorage.getItem('lms_username');
    const savedPass     = localStorage.getItem('lms_password');
    const savedSettings = localStorage.getItem('lms_settings');
    if (savedUser) setUsername(savedUser);
    if (savedPass) setPassword(savedPass);
    if (savedSettings) {
      try {
        const s = JSON.parse(savedSettings);
        // Explicit Boolean() so stored 'false' is not coerced to true by '||'
        if (typeof s.debugMode      === 'boolean') setDebugMode(s.debugMode);
        if (typeof s.headlessMode   === 'boolean') setHeadlessMode(s.headlessMode);
        if (typeof s.autoConfirm    === 'boolean') setAutoConfirm(s.autoConfirm);
        if (typeof s.saveCredentials=== 'boolean') setSaveCredentials(s.saveCredentials);
        if (s.blacklistSubjects)                   setBlacklistSubjects(s.blacklistSubjects);
      } catch { /* corrupted storage — ignore */ }
    }
    loadedRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Persist settings — only after initial load to avoid clobbering */
  useEffect(() => {
    if (!loadedRef.current) return;
    if (saveCredentials) {
      localStorage.setItem('lms_username', username);
      localStorage.setItem('lms_password', password);
    } else {
      localStorage.removeItem('lms_username');
      localStorage.removeItem('lms_password');
    }
    localStorage.setItem('lms_settings', JSON.stringify({
      debugMode, headlessMode, autoConfirm, saveCredentials, blacklistSubjects,
    }));
  }, [username, password, debugMode, headlessMode, autoConfirm, saveCredentials, blacklistSubjects]);

  /* Auto-scroll terminal */
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  /* Parse log messages for stats */
  const addLog = (message) => {
    setLogs((prev) => [...prev, { message, time: getTimeStamp() }]);
    if (message.includes('Tổng số bài quét thấy')) {
      const m = message.match(/Tổng số bài quét thấy: (\d+)/);
      if (m) setStats((p) => ({ ...p, total: parseInt(m[1]) }));
    }
    if (message.includes('Số bài sẽ học')) {
      const m = message.match(/Số bài sẽ học: (\d+)/);
      if (m) setStats((p) => ({ ...p, completed: 0, total: parseInt(m[1]) }));
    }
    if (message.includes('Số bài bỏ qua')) {
      const m = message.match(/Số bài bỏ qua: (\d+)/);
      if (m) setStats((p) => ({ ...p, skipped: parseInt(m[1]) }));
    }
    if (message.includes('Hoàn tất khóa học')) {
      setStats((p) => ({ ...p, completed: p.completed + 1 }));
    }
  };

  /* Start automation */
  const startAutomation = async (e) => {
    e.preventDefault();
    if (isRunning) return;
    setIsRunning(true);
    setLogs([]);
    setStats({ total: 0, completed: 0, skipped: 0 });
    addLog('🚀 Đang khởi tạo kết nối với LMS360...');

    const subjects = blacklistSubjects.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      const response = await fetch('/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, debugMode, headlessMode, autoConfirm, blacklistSubjects: subjects }),
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
            if (data.done) { addLog('🏁 Tự động hóa hoàn tất thành công!'); setIsRunning(false); }
            if (data.error) { addLog(`❌ Lỗi: ${data.error}`); setIsRunning(false); }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      addLog(`❌ Không thể kết nối: ${err.message}`);
      setIsRunning(false);
    }
  };

  const clearLogs = () => { setLogs([]); setStats({ total: 0, completed: 0, skipped: 0 }); };

  const progress = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col min-h-screen bg-background text-on-surface font-['Inter',system-ui,sans-serif] text-[16px]">

      {/* ── Top App Bar ─────────────────────────────────────────────────── */}
      <header className="z-50 w-full flex justify-between items-center px-8 h-16 shrink-0
        bg-slate-950/70 backdrop-blur-[25px] border-b border-slate-800/50
        shadow-[inset_0_0_8px_rgba(14,165,233,0.1)]">
        <div className="flex items-center gap-4">
          <span className="text-lg font-black tracking-tighter text-sky-400
            drop-shadow-[0_0_10px_rgba(14,165,233,0.5)]">
            LMS360 AUTO SOLVER
          </span>
          <div className="flex items-center gap-2 ml-4">
            <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-[#4edea3] pulse-dot' : 'bg-slate-500'}`} />
            <span className="font-['Space_Grotesk'] text-[12px] tracking-widest font-medium
              text-[#4edea3]">
              {isRunning ? 'Running...' : 'System Online'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-slate-500 hover:text-sky-300
            hover:bg-sky-500/10 p-2 rounded-full cursor-pointer transition-all">
            monitoring
          </span>
          <span className="material-symbols-outlined text-slate-500 hover:text-sky-300
            hover:bg-sky-500/10 p-2 rounded-full cursor-pointer transition-all">
            smart_toy
          </span>
          <span className="material-symbols-outlined text-slate-500 hover:text-sky-300
            hover:bg-sky-500/10 p-2 rounded-full cursor-pointer transition-all">
            query_stats
          </span>
          <div className="h-6 w-px bg-[#3e4850]/50 mx-1" />
          <span className="material-symbols-outlined text-slate-500 hover:text-sky-300
            hover:bg-sky-500/10 p-2 rounded-full cursor-pointer transition-all">
            notifications_active
          </span>
          <div className="w-8 h-8 rounded-full bg-[#222a3d] border border-[#3e4850]
            flex items-center justify-center hover:border-[#89ceff] transition-colors cursor-pointer
            text-xs font-bold text-[#89ceff]">
            ND
          </div>
        </div>
      </header>

      {/* ── Main Scrollable Area ─────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-6 lg:p-8">
        <div className="max-w-[1600px] mx-auto space-y-6">

          {/* ── Stats Row ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="fade-up-1">
              <CircularStat
                value={stats.total}
                max={Math.max(stats.total, 1)}
                color="text-[#89ceff]"
                icon="library_books"
                label="Total Courses"
              />
            </div>
            <div className="fade-up-2">
              <CircularStat
                value={stats.completed}
                max={Math.max(stats.total, 1)}
                color="text-[#4edea3]"
                icon="task_alt"
                label="Completed"
              />
            </div>
            <div className="fade-up-3">
              <CircularStat
                value={stats.skipped}
                max={Math.max(stats.total, 1)}
                color="text-[#3e4850]"
                icon="skip_next"
                label="Skipped"
              />
            </div>
          </div>

          {/* ── Work Area ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 fade-up-4">

            {/* ── Terminal Console (8 cols) ──────────────────────────────── */}
            <div className="lg:col-span-8 flex flex-col glass-panel rounded-lg overflow-hidden h-[580px]">
              {/* Terminal chrome bar */}
              <div className="flex items-center px-4 py-2.5 bg-[#2d3449] border-b border-[#3e4850]/40 shrink-0">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#ffb4ab]" />
                  <div className="w-3 h-3 rounded-full bg-[#facc15]" />
                  <div className="w-3 h-3 rounded-full bg-[#4edea3]" />
                </div>
                <div className="mx-auto font-['Space_Grotesk'] text-[12px] tracking-widest
                  font-medium text-[#bec8d2]">
                  solver_process.log
                </div>
                <button
                  onClick={clearLogs}
                  disabled={isRunning || logs.length === 0}
                  className="font-['Space_Grotesk'] text-[11px] tracking-wider text-[#3e4850]
                    hover:text-[#89ceff] disabled:opacity-30 disabled:cursor-not-allowed
                    transition-colors px-2 py-0.5 rounded border border-transparent
                    hover:border-[#89ceff]/30">
                  CLR
                </button>
              </div>

              {/* Terminal body */}
              <div className="flex-1 terminal-bg p-4 overflow-y-auto font-['Fira_Code',Consolas,monospace] text-[13px] leading-relaxed">
                {logs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-[#3e4850]">
                    <span className="material-symbols-outlined text-5xl opacity-40">terminal</span>
                    <span className="font-['Space_Grotesk'] text-[12px] tracking-widest">
                      AWAITING COMMAND...
                    </span>
                  </div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className="flex gap-0 log-entry mb-0.5">
                      <span className="text-[#3e4850] w-9 shrink-0 text-right pr-3 select-none
                        text-[11px] pt-[1px]">
                        {i + 1}
                      </span>
                      <span className="text-[#89ceff]/60 shrink-0 pr-2">[{log.time}]</span>
                      <span className={`${getLogStyle(log.message)} break-all`}>
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
                {/* Blinking cursor */}
                {isRunning && (
                  <div className="flex items-center mt-2 pl-9">
                    <span className="w-[7px] h-4 bg-[#89ceff] animate-pulse" />
                  </div>
                )}
                <div ref={logEndRef} />
              </div>
            </div>

            {/* ── Control Card (4 cols) ──────────────────────────────────── */}
            <div className="lg:col-span-4 fade-up-4">
              <div className="glass-panel rounded-lg p-6 flex flex-col h-full relative overflow-hidden">
                {/* Decorative glow */}
                <div className="absolute top-0 right-0 w-40 h-40 bg-[#89ceff]/10 rounded-full
                  blur-3xl -mr-20 -mt-20 pointer-events-none" />

                <h2 className="text-[24px] leading-tight font-semibold text-[#89ceff] mb-6">
                  Execution Protocol
                </h2>

                <form onSubmit={startAutomation} className="flex flex-col gap-4 flex-1">
                  {/* Username floating label */}
                  <div className="relative">
                    <input
                      id="username"
                      type="text"
                      placeholder=" "
                      required
                      disabled={isRunning}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="peer block w-full px-4 pb-2.5 pt-5 text-[16px] text-on-surface
                        bg-[#131b2e] border-b border-[#3e4850] rounded-t-lg appearance-none
                        focus:outline-none focus:border-[#89ceff] focus:shadow-[0_1px_0_0_#89ceff]
                        disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    />
                    <label
                      htmlFor="username"
                      className="absolute font-['Space_Grotesk'] text-[12px] tracking-widest
                        font-medium text-[#bec8d2] duration-200 transform -translate-y-4 scale-75
                        top-4 z-10 origin-[0] left-4
                        peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0
                        peer-focus:scale-75 peer-focus:-translate-y-4 peer-focus:text-[#89ceff]">
                      Target Username
                    </label>
                  </div>

                  {/* Password floating label */}
                  <div className="relative">
                    <input
                      id="password"
                      type="password"
                      placeholder=" "
                      required
                      disabled={isRunning}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="peer block w-full px-4 pb-2.5 pt-5 text-[16px] text-on-surface
                        bg-[#131b2e] border-b border-[#3e4850] rounded-t-lg appearance-none
                        focus:outline-none focus:border-[#89ceff] focus:shadow-[0_1px_0_0_#89ceff]
                        disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    />
                    <label
                      htmlFor="password"
                      className="absolute font-['Space_Grotesk'] text-[12px] tracking-widest
                        font-medium text-[#bec8d2] duration-200 transform -translate-y-4 scale-75
                        top-4 z-10 origin-[0] left-4
                        peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0
                        peer-focus:scale-75 peer-focus:-translate-y-4 peer-focus:text-[#89ceff]">
                      Security Key
                    </label>
                  </div>

                  {/* Toggles */}
                  <div className="pt-2 space-y-3 border-t border-[#3e4850]/50">
                    <Toggle label="Headless Mode"        checked={headlessMode}    onChange={() => setHeadlessMode(!headlessMode)}       disabled={isRunning} />
                    <Toggle label="Auto-Confirm"         checked={autoConfirm}     onChange={() => setAutoConfirm(!autoConfirm)}         disabled={isRunning} />
                    <Toggle label="Save Credentials"     checked={saveCredentials} onChange={() => setSaveCredentials(!saveCredentials)} disabled={isRunning} />
                    <Toggle label="Debug Mode"           checked={debugMode}       onChange={() => setDebugMode(!debugMode)}             disabled={isRunning} />
                  </div>

                  {/* Blacklist — collapsible */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowSettings(!showSettings)}
                      className="flex items-center gap-2 font-['Space_Grotesk'] text-[12px]
                        tracking-widest font-medium text-[#bec8d2] hover:text-[#89ceff]
                        transition-colors mb-2">
                      <span className="material-symbols-outlined text-[16px]">
                        {showSettings ? 'expand_less' : 'expand_more'}
                      </span>
                      BLACKLIST SUBJECTS
                    </button>
                    {showSettings && (
                      <textarea
                        rows={2}
                        disabled={isRunning}
                        value={blacklistSubjects}
                        onChange={(e) => setBlacklistSubjects(e.target.value)}
                        placeholder="võ nhạc, thể dục, âm nhạc..."
                        className="w-full px-3 py-2 text-[13px] text-on-surface bg-[#060e20]
                          border border-[#3e4850] rounded-lg resize-none
                          focus:outline-none focus:border-[#89ceff]
                          disabled:opacity-50 disabled:cursor-not-allowed
                          font-['Fira_Code',monospace] transition-all"
                      />
                    )}
                  </div>

                  {/* Progress bar */}
                  {stats.total > 0 && (
                    <div>
                      <div className="flex justify-between font-['Space_Grotesk'] text-[12px]
                        tracking-widest font-medium mb-2">
                        <span className="text-[#89ceff]">Automation Status</span>
                        <span className="text-[#89ceff]">{progress}%</span>
                      </div>
                      <div className="w-full h-2 bg-[#060e20] rounded-full overflow-hidden shadow-inner">
                        <div
                          className="h-full rounded-full relative transition-all duration-700"
                          style={{
                            width: `${progress}%`,
                            background: 'linear-gradient(90deg, #89ceff 0%, #4edea3 100%)',
                            boxShadow: '0 0 10px rgba(137,206,255,0.5)',
                          }}>
                          <div className="absolute inset-0 bg-white/20 animate-pulse rounded-full" />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* CTA Button */}
                  <button
                    type="submit"
                    disabled={isRunning}
                    className="mt-auto w-full py-4 rounded-lg btn-cyan
                      font-['Space_Grotesk'] text-[12px] tracking-widest font-medium
                      text-[#00344d] flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-[20px]">
                      {isRunning ? 'hourglass_top' : 'bolt'}
                    </span>
                    {isRunning ? 'PROCESSING...' : 'START AUTOMATION'}
                  </button>
                </form>
              </div>
            </div>

          </div>{/* end work area grid */}
        </div>{/* end max-w container */}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="shrink-0 py-3 px-8 border-t border-slate-800/40
        flex items-center justify-between text-[11px] text-slate-600
        font-['Space_Grotesk'] tracking-widest">
        <span>© 2026 NILDADEV · Apache-2.0</span>
        <span>LMS360 AUTO SOLVER v2.0</span>
      </footer>

    </div>
  );
}
