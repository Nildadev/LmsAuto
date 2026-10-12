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
const { solveOne, pressCheck } = require('../h5p/solver');
const { solveDoc } = require('../h5p/doc');
const { markComplete } = require('../h5p/doc');
const { scanIncomplete } = require('./complete');

const DEFAULT_WAIT_MS = 7000;

/** Gộp deps mặc định với deps tiêm vào (để test offline). */
function deps(overrides = {}) {
  return {
    launch, sleep, scanAll, videoUrl, dismissAll, findPlayerFrame, solveBook, solveVideo,
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
  // solveOne chấp nhận { kind, data } cấp cao nhất.
  const r = await d.solveOne(frame, { kind: data && data.kind, data, library: lib }, logger);
  if (r && r.solved) {
    await d.pressCheck(frame, logger).catch(() => {});
    await d.sleep(1200);
  }
  return { ...r, kind: 'single', library: lib };
}

/**
 * Giải 1 bài theo URL (mở tab mới, giải, đóng tab). Trả { ok, kind, result }.
 */

/**
 * Giải 1 bài theo URL. Trả { ok, kind, result }.
 */
async function solveItem(page, item, logger = console.log, opts = {}, d = deps()) {
  const url = typeof item === 'string' ? item : d.videoUrl(item);
  const { tab, frame } = await openItem(page, url, logger, opts, d);
  const closeTab = async () => { try { await tab.close(); } catch (_) {} };
  if (!frame) { logger('  ⚠️ Không tìm thấy frame player'); await closeTab(); return { ok: false, kind: 'unknown', url }; }

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
    logger('  ⚠️ Không nhận diện được loại H5P');
    result = { solved: 0, slides: 0, kind };
  }
  const ok = !!(result && (result.solved > 0 || (result.finalScore && result.finalScore.bar === '100%')));
  await closeTab();
  d.currentTab = null; // tab đã đóng -> quay lại chụp trang chính
  // Ưu tiên kind do solver cụ thể trả về (vd 'doc') nếu có, nếu không giữ kind detect được.
  return { ok, kind: (result && result.kind) || kind, library, url, result };
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
    const MIN_MS = 33; // cap ~30fps để ổn định
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
          if (now - lastSent >= MIN_MS) {
            lastSent = now;
            try { opts.onScreenshot('data:image/jpeg;base64,' + f.data); } catch (_) {}
          }
          try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (_) {}
        });
        await client.send('Page.startScreencast', {
          format: 'jpeg', quality: 50, maxWidth: 1100, maxHeight: 700, everyNthFrame: 1,
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
      todo = parts.filter((x) => !x.isFile).map((x) => ({
        title: x.title || x.courseTitle || '(không rõ tên)', subject: '', courseTitle: x.courseTitle,
        p: x.p, c: '', cs: x.cs, status: x.status,
      }));
      logger(`🧩 Parts mode: ${todo.length} phần H5P chưa hoàn thành (bỏ qua file — dùng --complete-files)`);
      if (opts.blacklist === undefined && todo.length) logger('   ℹ️ parts mode: không áp blacklist mặc định');
    } else {
      const blacklist = opts.blacklist !== undefined ? opts.blacklist : d.DEFAULT_BLACKLIST;
      const r = await d.scanAll(token, {
        logger, blacklist,
        skipEssay: opts.skipEssay, statuses: opts.statuses, fetchImpl: opts.fetchImpl,
      });
      todo = r.todo; summary = r.summary; report.studentName = r.studentName;

      // Bổ sung: quét TOÀN BỘ khóa học của lớp (learn_status) để không bỏ sót bài
      // không nằm trong "việc cần làm". Chỉ thêm phần H5P (file dùng --complete-files).
      if (opts.scanClass !== false) {
        try {
          const { parts } = await d.scanIncomplete(token, { logger, fetchImpl: opts.fetchImpl, apiBase: opts.apiBase });
          const have = new Set(todo.map((t) => t.p));
          let added = 0;
          for (const x of parts) {
            if (x.isFile || have.has(x.p)) continue;
            if (blacklist && blacklist.test(`${x.courseTitle || ''} ${x.title || ''}`)) continue;
            todo.push({
              title: x.title || x.courseTitle || '(không rõ tên)', subject: '', courseTitle: x.courseTitle,
              p: x.p, c: '', cs: x.cs, status: x.status,
            });
            have.add(x.p);
            added++;
          }
          if (added) logger(`➕ Bổ sung ${added} bài từ khóa học của lớp (ngoài việc cần làm)`);
        } catch (e) {
          logger(`⚠️ Không quét được khóa học của lớp: ${String(e && e.message).slice(0, 120)}`);
        }
      }
    }
    report.summary = summary;
    const list = opts.limit ? todo.slice(0, opts.limit) : todo;
    report.total = list.length;

    if (opts.dryRun) {
      logger('\n📋 (dry-run) Danh sách bài sẽ giải:');
      list.forEach((it, i) => logger(`  ${i + 1}. [${it.subject}] ${it.title}`));
      report.items = list.map((it) => ({ title: it.title, subject: it.subject, url: d.videoUrl(it), solved: false, dryRun: true }));
      return report;
    }

    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      logger(`\n━━━ [${i + 1}/${list.length}] [${it.subject}] ${it.title} ━━━`);
      let res;
      try {
        res = await solveItem(page, it, logger, { ...opts, token }, d);
      } catch (e) {
        logger(`  ❌ Lỗi: ${String(e && e.message).slice(0, 120)}`);
        res = { ok: false, kind: 'error', error: String(e && e.message).slice(0, 200), url: d.videoUrl(it) };
      }
      const entry = { title: it.title, subject: it.subject, ...res };
      report.items.push(entry);
      if (res.ok) {
        report.solved++;
        logger(`  ✅ Xong (${res.kind})`);
        // Đánh dấu hoàn thành server-side (learn_status status=3) — player H5P
        // KHÔNG tự gọi API này khi solver bấm "Tóm tắt & gửi", nên ta gọi trực tiếp.
        // (kind=doc đã được solveDoc đánh dấu rồi -> bỏ qua.)
        if (opts.markDone !== false && res.kind !== 'doc' && it.p && it.cs) {
          const m = await d.markComplete(token, it.p, it.cs, logger, opts).catch(() => null);
          if (m && m.ok) logger('  🏁 Đã đánh dấu hoàn thành (learn_status=3)');
          else if (m) logger(`  ⚠️ Đánh dấu hoàn thành thất bại (HTTP ${m.status})`);
        }
      }
      else { report.failed++; logger('  ⚠️ Chưa xác nhận hoàn thành'); }
      if (typeof opts.onProgress === 'function') opts.onProgress(i, list.length, entry);
      if (i < list.length - 1) await d.sleep(opts.betweenMs || 2500 + Math.floor(Math.random() * 2500));
    }

    logger(`\n📊 Kết quả: ${report.solved}/${report.total} bài xác nhận xong, ${report.failed} lỗi.`);
    return report;
  } finally {
    if (previewTimer) clearInterval(previewTimer);
    await previewStop().catch(() => {});
    if (context && context.close) await context.close().catch(() => {});
    if (browser && browser.close) await browser.close().catch(() => {});
  }
}

module.exports = { runFlow, solveItem, solveSingle, openItem, detectKind, deps };

