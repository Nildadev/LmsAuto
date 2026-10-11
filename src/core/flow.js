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
const { findPlayerFrame } = require('../h5p/answers');
const { solveBook } = require('../h5p/book');
const { solveVideo } = require('../h5p/interactiveVideo');

const DEFAULT_WAIT_MS = 7000;

/** Gộp deps mặc định với deps tiêm vào (để test offline). */
function deps(overrides = {}) {
  return {
    launch, sleep, scanAll, videoUrl, dismissAll, findPlayerFrame, solveBook, solveVideo,
    detectKind, DEFAULT_BLACKLIST,
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
    return { kind: first ? 'single' : 'unknown', library: first ? c[first].library : '' };
  });
}

/** Mở 1 bài: goto URL, chờ render, đóng modal. Trả frame player. */
async function openItem(page, url, logger, opts = {}, d = deps()) {
  logger(`🌐 ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await d.sleep(opts.waitMs || DEFAULT_WAIT_MS);
  await d.dismissAll(page).catch(() => {});
  await d.sleep(600);
  return d.findPlayerFrame(page, opts.frameTimeoutMs || 15000);
}

/**
 * Giải 1 bài theo URL. Trả { ok, kind, result }.
 */
async function solveItem(page, item, logger = console.log, opts = {}, d = deps()) {
  const url = typeof item === 'string' ? item : d.videoUrl(item);
  const frame = await openItem(page, url, logger, opts, d);
  if (!frame) { logger('  ⚠️ Không tìm thấy frame player'); return { ok: false, kind: 'unknown', url }; }

  const { kind, library } = await d.detectKind(frame);
  logger(`  🔎 Loại: ${kind} (${library || '?'})`);

  let result;
  if (kind === 'book') {
    result = await d.solveBook(page, frame, logger);
  } else if (kind === 'iv') {
    // InteractiveVideo đứng riêng: cần bấm play splash trước.
    const splash = await frame.locator('.h5p-splash-play,.h5p-splash-main').first().boundingBox().catch(() => null);
    if (splash) await page.mouse.click(splash.x + 20, splash.y + 20).catch(() => {});
    await d.sleep(1200);
    result = await d.solveVideo(page, frame, logger);
  } else if (kind === 'single') {
    result = await d.solveBook(page, frame, logger); // solveBook tự fallback nếu không phải book
  } else {
    logger('  ⚠️ Không nhận diện được loại H5P');
    result = { solved: 0, slides: 0, kind };
  }
  const ok = !!(result && (result.solved > 0 || (result.finalScore && result.finalScore.bar === '100%')));
  return { ok, kind, library, url, result };
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

  try {
    const { todo, summary, studentName } = await d.scanAll(token, {
      logger, blacklist: opts.blacklist !== undefined ? opts.blacklist : d.DEFAULT_BLACKLIST,
      skipEssay: opts.skipEssay, statuses: opts.statuses, fetchImpl: opts.fetchImpl,
    });
    report.studentName = studentName;
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
        res = await solveItem(page, it, logger, opts, d);
      } catch (e) {
        logger(`  ❌ Lỗi: ${String(e && e.message).slice(0, 120)}`);
        res = { ok: false, kind: 'error', error: String(e && e.message).slice(0, 200), url: d.videoUrl(it) };
      }
      const entry = { title: it.title, subject: it.subject, ...res };
      report.items.push(entry);
      if (res.ok) { report.solved++; logger(`  ✅ Xong (${res.kind})`); }
      else { report.failed++; logger('  ⚠️ Chưa xác nhận hoàn thành'); }
      if (typeof opts.onProgress === 'function') opts.onProgress(i, list.length, entry);
      if (i < list.length - 1) await d.sleep(opts.betweenMs || 2500 + Math.floor(Math.random() * 2500));
    }

    logger(`\n📊 Kết quả: ${report.solved}/${report.total} bài xác nhận xong, ${report.failed} lỗi.`);
    return report;
  } finally {
    if (context && context.close) await context.close().catch(() => {});
    if (browser && browser.close) await browser.close().catch(() => {});
  }
}

module.exports = { runFlow, solveItem, openItem, detectKind, deps };

