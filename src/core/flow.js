'use strict';
/**
 * flow.js — Orchestrator: login → scan → giải từng bài → báo cáo.
 *
 * Dùng các module con:
 *   core/auth.js    login API -> JWT
 *   core/stealth.js launch browser + inject token
 *   core/scan.js    quét bài được giao -> URL xem-video
 *   h5p/book        giải CoursePresentation / InteractiveBook (kể cả IV lồng)
 *   h5p/interactiveVideo.js  giải InteractiveVideo đứng riêng
 *
 * Mỗi bài được xử lý tuần tự, có delay giữa các bài để giống người và tránh
 * rate-limit. Lỗi ở 1 bài không làm dừng cả flow (ghi vào report).
 */
const { launch, sleep } = require('./stealth');
const { scanAll, videoUrl, DEFAULT_BLACKLIST } = require('./scan');
const { dismissAll } = require('./dismiss');
const { findPlayerFrame, collectH5P } = require('../h5p/answers');
const { extractAnswers } = require('../h5p/extract');
const { solveBook } = require('../h5p/book');
const { solveVideo } = require('../h5p/interactiveVideo');
const { solveExerciseList } = require('../h5p/lessonList');
const { solveOne, pressCheck } = require('../h5p/solver');
const { solveDoc } = require('../h5p/doc');
const { markComplete } = require('../h5p/doc');
const { scanIncomplete } = require('./complete');

// Chờ NGẮN sau khi goto rồi để findPlayerFrame tự poll (nó chờ tới 15s và trả
// về ngay khi thấy player). Trước đây ngủ cứng 7s cho MỌI bài -> chậm vô ích.
const DEFAULT_WAIT_MS = 2500;

/** true nếu thanh điểm đạt ~100%. `bar` là style.width (có thể "100%"/"100.00%"). */
function barReached(finalScore) {
  const w = finalScore && finalScore.bar;
  return w != null && parseFloat(w) >= 99.5;
}

/** Gộp deps mặc định với deps tiêm vào (để test offline). */
function deps(overrides = {}) {
  return {
    launch, sleep, scanAll, videoUrl, dismissAll, findPlayerFrame, solveBook, solveVideo,
    solveExerciseList,
    solveOne, pressCheck, collectH5P, extractAnswers,
    solveSingle, newTab: null,
    solveDoc, detectKind, DEFAULT_BLACKLIST,
    markComplete, scanIncomplete,
    currentTab: null, // tab đang giải (dùng cho preview), do openItem/solveItem đặt
    ...overrides,
  };
}

/** Phát hiện loại H5P chính trên frame (book / iv / single / unknown). */
async function detectKind(frame) {
  return frame.evaluate(() => {
    const c = (window.H5PIntegration && window.H5PIntegration.contents) || {};
    for (const k in c) {
      const lib = c[k].library || '';
      if (/CoursePresentation|InteractiveBook|BranchingScenario/.test(lib)) return { kind: 'book', library: lib };
    }
    for (const k in c) {
      const lib = c[k].library || '';
      if (/InteractiveVideo/.test(lib)) return { kind: 'iv', library: lib };
    }
    const first = Object.keys(c)[0];
    if (first) return { kind: 'single', library: c[first].library };
    // Không có H5PIntegration.contents => bài "TÀI LIỆU ĐÍNH KÈM" dạng file
    // (.pptx/.pdf/.doc): không phải H5P, chỉ cần đánh dấu đã xem qua API.
    const hasViewer = !!document.querySelector('.ql-container, .ql-editor, [class*="preview"], [class*="Preview"], [class*="viewer"], [class*="Viewer"], iframe');
    return { kind: 'unknown', library: '', isDoc: hasViewer };
  });
}

/** Mở 1 bài trong tab MỚI (page mới trong cùng context, KHÔNG điều hướng page chính).
 * Trả { tab, frame } — caller PHẢI đóng tab sau khi xong.
 * Tab riêng tránh H5PIntegration.contents cache nhầm + không mất tab scan. */
async function openItem(page, url, logger, opts = {}, d = deps()) {
  logger(`🌐 ${url}`);
  // Mở tab mới trong cùng context (kế thừa token localStorage/cookie).
  // Cho phép inject d.newTab(page) trong test offline.
  const tab = d.newTab ? await d.newTab(page)
    : await page.context().newPage();
  d.currentTab = tab; // đánh dấu tab đang giải để WebUI chụp ảnh xem trước
  await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await d.sleep(opts.waitMs || DEFAULT_WAIT_MS);
  await d.dismissAll(tab).catch(() => {});
  await d.sleep(600);
  const frame = await d.findPlayerFrame(tab, opts.frameTimeoutMs || 15000);
  return { tab, frame };
}

/**
 * Giải 1 H5P lẻ (single): DragText/Blanks/Choice lẻ — KHÔNG phải Book/IV.
 * Đọc jsonContent của content chính, extract đáp án rồi solveOne + Check.
 */
async function solveSingle(page, frame, library, logger, d = deps()) {
  // Đọc jsonContent của content single đầu tiên tìm được trong frame.
  const raw = await frame.evaluate(() => {
    const c = (window.H5PIntegration && window.H5PIntegration.contents) || {};
    for (const k in c) {
      const lib = c[k].library || '';
      if (/CoursePresentation|InteractiveBook|BranchingScenario|InteractiveVideo/.test(lib)) continue;
      let j = c[k].jsonContent;
      if (typeof j === 'string') { try { j = JSON.parse(j); } catch (_) {} }
      return { library: lib, json: j };
    }
    return null;
  }).catch(() => null);
  if (!raw || !raw.json) { logger('  Single: không đọc được jsonContent'); return { solved: 0, kind: 'single' }; }
  const lib = library || raw.library;
  const data = d.extractAnswers(lib, { params: (raw.json.params || raw.json) });
  logger(`  Single ${lib} => ${data ? data.kind : 'unknown'}`);
  if (!data || data.kind === 'unknown') {
    // Chẩn đoán: xem cấu trúc json (vd H5P.Column có params.content[] là sub-content).
    const j = raw.json || {};
    const params = j.params || j;
    const c = params.content;
    logger(`  🐞 single-unknown: lib=${lib} jsonKeys=${JSON.stringify(Object.keys(j))}`
      + ` contentType=${Array.isArray(c) ? `array[${c.length}]` : typeof c}`
      + ` firstKeys=${c && c[0] ? JSON.stringify(Object.keys(c[0])) : 'n/a'}`
      + ` raw=${JSON.stringify(params).slice(0, 1200)}`);
  }
  // Nội dung KHÔNG có câu hỏi nào (vd H5P.Column chỉ chứa H5P.Link/Text/Image) ->
  // chỉ cần "xem" là xong. Dò mọi `library` trong json; nếu không có loại câu hỏi
  // nào thì đánh dấu hoàn thành thay vì báo lỗi.
  if (!data || data.kind === 'unknown') {
    const libs = [];
    (function walk(n, depth) {
      if (!n || depth > 5) return;
      if (Array.isArray(n)) { n.slice(0, 60).forEach((x) => walk(x, depth + 1)); return; }
      if (typeof n !== 'object') return;
      if (typeof n.library === 'string') libs.push(n.library);
      for (const k of Object.keys(n)) { const v = n[k]; if (v && typeof v === 'object') walk(v, depth + 1); }
    })(raw.json, 0);
    const hasQ = libs.some((l) => /MultiChoice|SingleChoice|TrueFalse|Blanks|DragText|DragQuestion|MarkTheWords|Summary|QuestionSet|InteractiveVideo|CoursePresentation|InteractiveBook/i.test(l));
    if (!hasQ) {
      logger(`  ℹ️ Không có câu hỏi (chỉ cần xem) — nội dung con: ${JSON.stringify(libs.slice(0, 6))}`);
      return { solved: 0, kind: 'single', library: lib, noQuestions: true };
    }
  }
  // solveOne chấp nhận { kind, data } cấp cao nhất.
  const r = await d.solveOne(frame, { kind: data && data.kind, data, library: lib }, logger);
  if (r && r.solved) {
    await d.pressCheck(frame, logger).catch(() => {});
    await d.sleep(1200);
  }
  return { ...r, kind: 'single', library: lib };
}

/** Chẩn đoán khi không tìm thấy frame player: liệt kê các frame + dấu hiệu nội dung. */
async function dumpNoFrame(tab, logger) {
  const out = [];
  for (const f of tab.frames()) {
    try {
      const s = await f.evaluate(() => ({
        integ: !!(window.H5PIntegration && window.H5PIntegration.contents),
        libs: (window.H5PIntegration && window.H5PIntegration.contents)
          ? Object.values(window.H5PIntegration.contents).map((c) => c.library) : [],
        nodes: document.querySelectorAll('.h5p-answer, .h5p-container, .h5p-question-content, .h5p-column, .h5p-interactive-video, iframe').length,
        txt: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 140),
      }));
      out.push({ url: f.url().slice(0, 90), ...s });
    } catch (_) { /* frame detach */ }
  }
  logger(`  🐞 no-frame: ${JSON.stringify(out)}`);
}

/**
 * Giải 1 bài theo URL. Trả { ok, kind, result }.
 */
async function solveItem(page, item, logger = console.log, opts = {}, d = deps()) {
  const url = typeof item === 'string' ? item : d.videoUrl(item);
  // Phần FILE tài liệu (.pptx/.pdf/.doc...): KHÔNG cần mở browser — chỉ gọi API
  // view + learn_status(status=3) để đánh dấu hoàn thành (giống bấm nút "mắt").
  if (item && typeof item === 'object' && item.isFile && d.solveDoc) {
    const token = opts.token || d.token || '';
    logger(`📄 File tài liệu: ${item.title || item.p} -> đánh dấu hoàn thành`);
    const result = await d.solveDoc(item, token, logger, opts);
    return { ok: !!result.solved, kind: 'doc', url, result };
  }
  const { tab, frame } = await openItem(page, url, logger, opts, d);
  // try/finally: LUÔN đóng tab + reset currentTab dù detectKind/solver NÉM lỗi.
  // Trước đây throw giữa chừng -> tab rò rỉ (không đóng) + preview chụp tab chết.
  try {
  if (!frame) {
    logger('  ⚠️ Không tìm thấy frame player');
    await dumpNoFrame(tab, logger).catch(() => {});
    return { ok: false, kind: 'unknown', url };
  }

  const { kind, library, isDoc } = await d.detectKind(frame);
  logger(`  🔎 Loại: ${kind} (${library || '?'})${isDoc ? ' [tài liệu file]' : ''}`);

  let result;
  if (kind === 'book') {
    result = await d.solveBook(tab, frame, logger);
  } else if (kind === 'iv') {
    // InteractiveVideo đứng riêng: cần bấm play splash trước.
    const splash = await frame.locator('.h5p-splash-play,.h5p-splash-main').first().boundingBox().catch(() => null);
    if (splash) await tab.mouse.click(splash.x + 20, splash.y + 20).catch(() => {});
    await d.sleep(1200);
    result = await d.solveVideo(tab, frame, logger);
  } else if (kind === 'single') {
    result = await d.solveSingle(tab, frame, library, logger, d);
  } else if (isDoc && d.solveDoc) {
    // File tài liệu (.pptx/.pdf/.doc): chỉ cần đánh dấu đã xem qua API.
    const token = opts.token || d.token || '';
    result = await d.solveDoc(item, token, logger, opts);
  } else {
    // Có thể là bài "nhiều bài tập tương tác" (khối BÀI TẬP TƯƠNG TÁC trong frame).
    const listRes = d.solveExerciseList
      ? await d.solveExerciseList(tab, frame, logger, opts, d).catch(() => null)
      : null;
    if (listRes && listRes.solved > 0) {
      result = { solved: listRes.solved, slides: listRes.total, kind: 'list' };
    } else {
      logger('  ⚠️ Không nhận diện được loại H5P');
      result = { solved: 0, slides: 0, kind };
    }
  }
  // Mốc có câu SAI (result.wrong) hoặc KHÔNG xác minh được (result.unverified) ->
  // bài KHÔNG được coi là hoàn thành, dù đã giải được phần lớn. Chính sách trung
  // thực: thà báo "chưa xác nhận" còn hơn báo xong sai rồi đánh dấu status=3.
  const badStops = result ? ((result.wrong || 0) + (result.unverified || 0)) : 0;
  const ok = !!(result && badStops === 0
    && (result.solved > 0 || barReached(result.finalScore) || result.noQuestions));
  // Bài khoá tua (preventSkipping) bị solver bỏ qua: KHÔNG tính là lỗi, KHÔNG
  // đánh dấu hoàn thành. runFlow sẽ đếm vào report.skipped.
  const skipped = !!(result && result.skippedLocked);
  // Ưu tiên kind do solver cụ thể trả về (vd 'doc') nếu có, nếu không giữ kind detect được.
  return { ok, skipped, kind: (result && result.kind) || kind, library, url, result };
  } finally {
    try { await tab.close(); } catch (_) {}
    d.currentTab = null; // tab đã đóng -> quay lại chụp trang chính (tránh chụp tab chết)
  }
}

/**
 * Chạy toàn bộ flow.
 * @param {object} opts {
 *   username, password, token,        // xác thực (bắt buộc 1 trong 2 cách)
 *   logger, headless,                 // hiển thị
 *   limit,                            // số bài tối đa (mặc định tất cả)
 *   blacklist, skipEssay, statuses,   // lọc bài (truyền cho scan)
 *   waitMs, betweenMs,                // thời gian chờ
 *   dryRun,                           // chỉ liệt kê, không giải
 *   onProgress,                       // callback (i, total, res)
 *   deps                              // tiêm phụ thuộc (dùng cho test offline)
 * }
 * @returns {Promise<object>} report
 */
async function runFlow(opts = {}) {
  const d = deps(opts.deps);
  const logger = opts.logger || console.log;
  const report = { studentName: '', total: 0, solved: 0, skipped: 0, failed: 0, items: [] };

  logger('🚀 Bắt đầu flow: login → scan → solve');
  const { browser, context, page, token } = await d.launch({
    headless: opts.headless !== false,
    token: opts.token,
    username: opts.username,
    password: opts.password,
    logger,
    fetchImpl: opts.fetchImpl,
  });

  // ── Preview: stream ảnh trình duyệt ~30fps qua CDP screencast (ổn định — chỉ
  // gửi frame khi trang vẽ lại, tự ack). Browser vẫn chạy ẩn trên host; WebUI chỉ
  // nhận ảnh. KHÔNG ảnh hưởng CLI (capturePreview=false). Tự đổi nguồn khi chuyển
  // tab (d.currentTab: tab đang giải) hoặc về trang chính.
  let previewTimer = null;
  let previewStop = async () => {};
  if (opts.capturePreview && typeof opts.onScreenshot === 'function') {
    let client = null, boundPage = null, lastSent = 0;
    const MIN_MS = 100; // cap ~10fps preview (đủ xem tiến độ, giảm mạnh tải)
    const stop = async () => {
      if (client) {
        try { await client.send('Page.stopScreencast'); } catch (_) {}
        try { await client.detach(); } catch (_) {}
        client = null;
      }
      boundPage = null;
    };
    const bind = async (pg) => {
      await stop();
      if (!pg) return;
      try {
        client = await context.newCDPSession(pg);
        client.on('Page.screencastFrame', async (f) => {
          const now = Date.now();
          // Chỉ GỬI cho client tối đa ~10fps (giảm băng thông + decode phía client).
          if (now - lastSent >= MIN_MS) {
            lastSent = now;
            try { opts.onScreenshot('data:image/jpeg;base64,' + f.data); } catch (_) {}
          }
          // LƯU Ý: PHẢI ack MỌI frame — Chromium không gửi frame kế tiếp nếu frame
          // trước chưa được ack (nếu bỏ ack -> preview đứng). Việc giảm CPU đến từ
          // everyNthFrame + độ phân giải + quality bên dưới, không phải từ việc bỏ ack.
          try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (_) {}
        });
        await client.send('Page.startScreencast', {
          format: 'jpeg', quality: 35,
          // Giảm độ phân giải preview (960×540) -> encode JPEG nhẹ hơn nhiều so với 1366×768.
          maxWidth: 960, maxHeight: 540,
          everyNthFrame: 3, // encode 1/3 số frame -> giảm ~3x tải CPU renderer
        });
        boundPage = pg;
      } catch (_) { client = null; boundPage = null; }
    };
    previewStop = stop;
    await bind(d.currentTab || page);
    previewTimer = setInterval(() => {
      const target = d.currentTab || page;
      if (target !== boundPage) bind(target); // chuyển tab -> rebind
    }, 700);
  }

  try {
    // ── PARTS MODE (--complete-h5p): dùng learn_status toàn khóa thay my_assigned_pending ──
    // Liệt kê MỌI phần H5P (type=0) chưa hoàn thành -> mở từng phần, giải, đánh dấu xong.
    let todo = [], summary = {};
    if (opts.parts) {
      const { parts } = await d.scanIncomplete(token, { logger, fetchImpl: opts.fetchImpl, apiBase: opts.apiBase });
      todo = parts.filter((x) => !x.isFile && !x.denied).map((x) => ({
        title: x.title || x.courseTitle || '(không rõ tên)', subject: '', courseTitle: x.courseTitle,
        p: x.p, c: '', cs: x.cs, status: x.status,
      }));
      logger(`🧩 Parts mode: ${todo.length} phần H5P chưa hoàn thành (bỏ qua file — dùng --complete-files)`);
      if (opts.blacklist === undefined && todo.length) logger('   ℹ️ parts mode: không áp blacklist mặc định');
    } else {
      const blacklist = opts.blacklist !== undefined ? opts.blacklist : d.DEFAULT_BLACKLIST;
      // Vẫn gọi scanAll để lấy studentName/summary (log đẹp); CHỈ dùng danh sách
      // "việc cần làm" khi bật option doAssigned.
      const r = await d.scanAll(token, {
        logger, blacklist,
        skipEssay: opts.skipEssay, statuses: opts.statuses, fetchImpl: opts.fetchImpl,
      });
      summary = r.summary; report.studentName = r.studentName;

      // NỀN: quét TOÀN BỘ khóa học của lớp (learn_status) — mặc định CHỈ làm phần này.
      // Gồm CẢ phần H5P lẫn phần FILE tài liệu (file đánh dấu qua API, không mở browser).
      const classTodo = [];
      if (opts.scanClass !== false) {
        try {
          const { parts } = await d.scanIncomplete(token, { logger, fetchImpl: opts.fetchImpl, apiBase: opts.apiBase });
          let added = 0, addedFile = 0, denied = 0;
          for (const x of parts) {
            if (x.denied) { denied++; continue; } // bài riêng tư, không có quyền -> bỏ qua
            if (blacklist && blacklist.test(`${x.courseTitle || ''} ${x.title || ''}`)) continue;
            classTodo.push({
              title: x.title || x.courseTitle || '(không rõ tên)', subject: '', courseTitle: x.courseTitle,
              p: x.p, c: '', cs: x.cs, status: x.status, isFile: !!x.isFile,
            });
            if (x.isFile) addedFile++; else added++;
          }
          if (added || addedFile) logger(`📚 Khóa học của lớp: ${added} bài H5P + ${addedFile} file tài liệu chưa xong`);
          if (denied) logger(`🔒 Bỏ qua ${denied} bài riêng tư (không có quyền xem)`);
        } catch (e) {
          logger(`⚠️ Không quét được khóa học của lớp: ${String(e && e.message).slice(0, 120)}`);
        }
      }

      if (opts.doAssigned === true) {
        // BẬT: gộp bài được giao (ưu tiên lên đầu) + bài theo lớp, khử trùng theo `p`.
        const have = new Set();
        todo = [];
        for (const t of [...r.todo, ...classTodo]) {
          if (!t || !t.p || have.has(t.p)) continue;
          have.add(t.p); todo.push(t);
        }
        logger(`📋 Làm bài cần làm: BẬT — ${r.todo.length} bài được giao + ${classTodo.length} bài theo lớp (gộp ${todo.length})`);
      } else {
        // MẶC ĐỊNH: chỉ làm bài theo khóa học của lớp.
        todo = classTodo;
      }
      logger(`📋 Tổng cần giải: ${todo.length} bài`);
    }
    report.summary = summary;
    let list = opts.limit ? todo.slice(0, opts.limit) : todo;

    if (opts.dryRun) {
      logger('\n📋 (dry-run) Danh sách bài sẽ giải:');
      list.forEach((it, i) => logger(`  ${i + 1}. [${it.subject}] ${it.title}`));
      report.total = list.length;
      report.items = list.map((it) => ({ title: it.title, subject: it.subject, url: d.videoUrl(it), solved: false, dryRun: true }));
      return report;
    }

    // Bài khoá tua đã bỏ qua — vòng quét lại KHÔNG mở lại (status vẫn ≠3 nhưng ta cố ý bỏ).
    const skippedLockedIds = new Set();
    // Trạng thái CUỐI theo item (khử trùng giữa các vòng quét lại).
    const keyOf = (it) => it.p || `${it.subject || ''}|${it.title || ''}`;
    const solvedKeys = new Set(), failedKeys = new Set(), skippedKeys = new Set();
    const itemsByKey = new Map(); // report.items khử trùng theo key (giữ trạng thái CUỐI)
    let progressDone = 0;         // đếm xuyên các vòng cho onProgress (không reset về 0)
    const initialTotal = list.length;

    // Quét lại learn_status -> danh sách bài còn status≠3 (để làm tiếp ở vòng sau).
    const rescanRemaining = async () => {
      const blacklist = opts.blacklist !== undefined ? opts.blacklist : d.DEFAULT_BLACKLIST;
      const out = [];
      const seen = new Set();
      try {
        const { parts } = await d.scanIncomplete(token, { logger, fetchImpl: opts.fetchImpl, apiBase: opts.apiBase });
        for (const x of parts) {
          if (x.denied) continue;                                 // riêng tư, không có quyền
          if (opts.parts && x.isFile) continue;                   // parts mode: chỉ H5P
          if (!opts.parts && blacklist && blacklist.test(`${x.courseTitle || ''} ${x.title || ''}`)) continue;
          if (skippedLockedIds.has(x.p) || seen.has(x.p)) continue;
          seen.add(x.p);
          out.push({
            title: x.title || x.courseTitle || '(không rõ tên)', subject: '', courseTitle: x.courseTitle,
            p: x.p, c: '', cs: x.cs, status: x.status, isFile: !!x.isFile,
          });
        }
      } catch (e) { logger(`⚠️ Không quét lại được: ${String(e && e.message).slice(0, 120)}`); }
      // doAssigned: gộp thêm bài được giao còn chưa xong.
      if (opts.doAssigned === true && !opts.parts) {
        try {
          const r2 = await d.scanAll(token, { logger: () => {}, blacklist, skipEssay: opts.skipEssay, statuses: opts.statuses, fetchImpl: opts.fetchImpl });
          for (const t of r2.todo) {
            if (!t || !t.p || seen.has(t.p) || skippedLockedIds.has(t.p)) continue;
            seen.add(t.p); out.push(t);
          }
        } catch (_) { /* bỏ qua */ }
      }
      return out;
    };

    const maxRounds = Math.max(1, Number(opts.retryRounds ?? 2));
    let prevRemain = Infinity;
    // Hủy hợp tác: client ngắt kết nối (web) -> shouldStop() true -> dừng giữa các
    // bài, thoát vòng lặp, rồi finally đóng browser/context (không rò rỉ tài nguyên).
    const stopRequested = () => !!(opts.shouldStop && opts.shouldStop());
    for (let round = 0; round < maxRounds; round++) {
      if (stopRequested()) { logger('⏹️ Dừng theo yêu cầu (client ngắt kết nối).'); break; }
      if (round > 0) {
        // Quét lại cuối phiên: bài nào còn status≠3 thì đưa lại hàng đợi làm tiếp.
        const remain = await rescanRemaining();
        logger(`\n🔁 Vòng ${round + 1}: còn ${remain.length} bài chưa xong — làm lại…`);
        if (!remain.length) { logger('🔁 Đã xong hết — dừng quét lại.'); break; }
        if (remain.length >= prevRemain) { logger('🔁 Không tiến triển -> dừng quét lại.'); break; }
        prevRemain = remain.length;
        list = opts.limit ? remain.slice(0, opts.limit) : remain;
      }
      for (let i = 0; i < list.length; i++) {
        if (stopRequested()) { logger('⏹️ Dừng theo yêu cầu (client ngắt kết nối).'); break; }
        const it = list[i];
        logger(`\n━━━ [${round > 0 ? `vòng ${round + 1} · ` : ''}${i + 1}/${list.length}] [${it.subject}] ${it.title} ━━━`);
        let res;
        try {
          res = await solveItem(page, it, logger, { ...opts, token }, d);
        } catch (e) {
          logger(`  ❌ Lỗi: ${String(e && e.message).slice(0, 120)}`);
          res = { ok: false, kind: 'error', error: String(e && e.message).slice(0, 200), url: d.videoUrl(it) };
        }
        const entry = { title: it.title, subject: it.subject, round: round + 1, ...res };
        const key = keyOf(it);
        // Khử trùng report.items giữa các vòng: 1 bài chỉ 1 dòng (trạng thái cuối).
        itemsByKey.set(key, entry);
        if (res.skipped) {
          // Bài khoá tua -> bỏ qua, KHÔNG tính lỗi, KHÔNG đánh dấu hoàn thành.
          skippedKeys.add(key); solvedKeys.delete(key); failedKeys.delete(key);
          if (it.p) skippedLockedIds.add(it.p);
          logger('  ⏭️ Bỏ qua (khoá tua) — không tính lỗi');
        }
        else if (res.ok) {
          // Chỉ coi là HOÀN THÀNH khi đánh dấu server-side (learn_status=3) thành công.
          // markDone=false (người dùng tự tắt) hoặc kind=doc (solveDoc đã đánh dấu)
          // thì bỏ qua bước này. Trước đây add solvedKeys VÔ ĐIỀU KIỆN -> bài giải
          // xong trên trình duyệt nhưng đánh dấu thất bại vẫn báo "đã xong".
          let marked = true;
          if (opts.markDone !== false && res.kind !== 'doc') {
            if (!it.p || !it.cs) {
              // Thiếu ID -> không gọi được learn_status -> KHÔNG chắc đã hoàn thành.
              marked = false;
              logger(`  ⚠️ Thiếu ${!it.p ? 'p (h5p_content_id)' : 'cs (course_id)'} — không đánh dấu hoàn thành được`);
            } else {
              const m = await d.markComplete(token, it.p, it.cs, logger, opts).catch(() => null);
              if (m && m.ok) logger('  🏁 Đã đánh dấu hoàn thành (learn_status=3)');
              else { marked = false; logger(`  ⚠️ Đánh dấu hoàn thành thất bại${m ? ` (HTTP ${m.status})` : ''}`); }
            }
          }
          if (marked) { solvedKeys.add(key); failedKeys.delete(key); logger(`  ✅ Xong (${res.kind})`); }
          else { failedKeys.add(key); solvedKeys.delete(key); logger('  ⚠️ Chưa xác nhận hoàn thành (đánh dấu server thất bại)'); }
        }
        else { failedKeys.add(key); solvedKeys.delete(key); logger('  ⚠️ Chưa xác nhận hoàn thành'); }
        if (typeof opts.onProgress === 'function') {
          progressDone++;
          // Index không reset về 0 mỗi vòng; total luôn >= index -> i < total.
          opts.onProgress(progressDone - 1, Math.max(initialTotal, progressDone), entry);
        }
        if (i < list.length - 1) await d.sleep(opts.betweenMs || 400 + Math.floor(Math.random() * 500));
      }
    }

    // Report phản ánh trạng thái CUỐI (khử trùng giữa các vòng).
    // total = số bài THỰC SỰ đã xử lý (solved+failed+skipped) -> không bao giờ vượt
    // quá số bài đã làm, kể cả khi có limit + quét lại thêm bài mới ở vòng sau
    // (trước đây lấy initialTotal nên solved có thể > total khi vòng 2 giải thêm).
    report.total = solvedKeys.size + failedKeys.size + skippedKeys.size;
    report.solved = solvedKeys.size;
    report.failed = failedKeys.size;
    report.skipped = skippedKeys.size;
    report.items = [...itemsByKey.values()];
    logger(`\n📊 Kết quả: ${report.solved}/${report.total} bài xác nhận xong, ${report.failed} lỗi.`);
    if (report.skipped > 0) logger(`   ⏭️ Bỏ qua ${report.skipped} bài khoá tua (không tính lỗi).`);
    return report;
  } finally {
    if (previewTimer) clearInterval(previewTimer);
    await previewStop().catch(() => {});
    if (context && context.close) await context.close().catch(() => {});
    if (browser && browser.close) await browser.close().catch(() => {});
  }
}

module.exports = { runFlow, solveItem, solveSingle, openItem, detectKind, deps };

