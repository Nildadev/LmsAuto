'use strict';
/**
 * index.js — Điều phối giải "sách online" H5P (CoursePresentation + InteractiveBook).
 *
 * Kiến trúc module (dễ mở rộng/thay thế từng phần):
 *   read.js      tìm frame + đọc jsonContent
 *   schema.js    parse jsonContent -> model { kind, pages[] } (thuần logic)
 *   navigate.js  điều hướng slide (CP) / trang (IB)
 *   question.js  giải 1 container câu hỏi (choice/blanks/summary)
 *   dom.js       primitives click/scroll/feedback
 *
 * Đã verify thực tế lms360.vn:
 *  - CP "UNIT 6": 3/3 slide đúng, bar 100%, API /h5p/scores 18/18.
 *  - IB "Bài 7. Lăng kính": 7 trang (6 chương + Tóm tắt), MC/TrueFalse/CP/IV.
 */
const { sleep } = require('../../core/stealth');
const { findBookFrame, readBook } = require('./read');
const { cpPartCount, cpGoto, openInteractiveBook, ibPageState, ibNext, ibSubmit } = require('./navigate');
const { solveElement } = require('./question');
const { solveVideo } = require('../interactiveVideo');
const { readFeedback, pressCheckIn } = require('./dom');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const QUESTION_KINDS = new Set(['choice', 'blanks', 'summary', 'dragquestion']);

/** Lấy danh sách container .h5p-question đang hiển thị (DOM order). */
async function visibleQuestionContainers(frame) {
  const qs = frame.locator('.h5p-question');
  const n = await qs.count().catch(() => 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    const loc = qs.nth(i);
    if (await loc.isVisible().catch(() => false)) out.push(loc);
  }
  return out;
}

/** Đọc điểm cuối trong frame (score bar + ratio). */
async function readFinalScore(frame) {
  return frame.evaluate(() => {
    const bar = document.querySelector('.h5p-joubelui-score-bar-progress, .h5p-score-bar-progress');
    const txt = (document.body.innerText || '').match(/(\d+)\s*\/\s*(\d+)/g);
    return { bar: bar ? bar.style.width : null, ratios: txt ? txt.slice(0, 6) : [] };
  }).catch(() => ({}));
}

/**
 * Giải các container câu hỏi của MỘT trang: zip container DOM với element JSON.
 * @returns {{filled:number, good:number, wrong:number, details:Array}}
 */
/** Trích text thuần của 1 element (để so khớp với container DOM). */
function elementProbeText(el) {
  const parts = [];
  const push = (v) => { if (typeof v === 'string' && v.trim()) parts.push(v); };
  const walk = (o, depth) => {
    if (o == null || depth > 4) return;
    if (typeof o === 'string') { push(o); return; }
    if (Array.isArray(o)) { o.slice(0, 8).forEach((x) => walk(x, depth + 1)); return; }
    if (typeof o !== 'object') return;
    ['question', 'text', 'taskDescription', 'introduction', 'title', 'header'].forEach((k) => {
      const v = o[k];
      if (typeof v === 'string') push(v);
      else if (v && typeof v === 'object') walk(v, depth + 1);
    });
    if (Array.isArray(o.answers)) o.answers.slice(0, 8).forEach((a) => { if (a && a.text) push(a.text); });
    if (typeof o.text === 'string' && o.text.includes('*')) push(o.text);
  };
  try { walk(el.params, 0); } catch (_) {}
  return parts.join(' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Chuẩn hoá để so khớp probe với DOM. */
function probeNorm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Giải các container câu hỏi của MỘT trang.
 * KHỚP THEO NỘI DUNG: mỗi element JSON tìm container có text chứa probe
 * (thay vì zip theo thứ tự — vì trang có thể có text/media xen giữa).
 * @returns {{filled:number, good:number, wrong:number, details:Array}}
 */
async function solvePage(frame, elements, logger) {
  const qElements = elements.filter((e) => QUESTION_KINDS.has(e.kind));
  const containers = await visibleQuestionContainers(frame);
  const details = [];
  let filled = 0, good = 0, wrong = 0;

  // InteractiveVideo lồng trong trang: delegate sang solveVideo (đã verify riêng).
  const ivEl = elements.find((e) => e.kind === 'iv');
  if (ivEl && await frame.locator('.h5p-interactive-video:visible').count().catch(() => 0)) {
    try {
      const ivRes = await solveVideo(frame.page(), frame, (m) => logger && logger(`  ${m}`), { params: ivEl.params });
      details.push({ kind: 'iv', solved: ivRes.solved, total: ivRes.total });
      filled += ivRes.solved; good += ivRes.solved;
      logger && logger(`  IV lồng: ${ivRes.solved}/${ivRes.total}`);
    } catch (e) { logger && logger(`  IV lồng lỗi: ${String(e.message).slice(0, 60)}`); }
    return { filled, good, wrong, details };
  }

  // Đọc text của từng container để khớp nội dung (thay vì zip theo thứ tự).
  const containerTexts = [];
  for (let c = 0; c < containers.length; c++) {
    const t = await containers[c].innerText().catch(() => '');
    containerTexts.push(probeNorm(t).slice(0, 500));
  }
  const used = new Set();
  const findContainer = (el) => {
    const probe = probeNorm(elementProbeText(el));
    if (probe) {
      let best = -1, bestLen = 0;
      const words = probe.split(' ').filter((w) => w.length >= 4);
      for (let c = 0; c < containers.length; c++) {
        if (used.has(c)) continue;
        const ct = containerTexts[c];
        let hits = 0;
        for (const w of words.slice(0, 12)) if (ct.includes(w)) hits++;
        if (hits >= Math.min(3, words.length) && hits > bestLen) { bestLen = hits; best = c; }
      }
      if (best >= 0) { used.add(best); return { c: best, via: 'content' }; }
    }
    for (let c = 0; c < containers.length; c++) {
      if (!used.has(c)) { used.add(c); return { c, via: 'order' }; }
    }
    return null;
  };
  for (let k = 0; k < qElements.length; k++) {
    const el = qElements[k];
    const slot = findContainer(el);
    if (!slot) { details.push({ k, kind: el.kind, base: el.base, note: 'no-container' }); continue; }
    const container = containers[slot.c];
    const r = await solveElement(frame, container, el, logger).catch((e) => ({ solved: false, err: e.message }));
    if (r && r.solved) filled++;
    // Bấm "Kiểm tra" NGAY TRONG container này (mỗi câu có nút riêng).
    await pressCheckIn(container, logger).catch(() => {});
    await sleep(900);
    const fb = await readFeedback(container);
    good += fb.correct; wrong += fb.wrong;
    details.push({ k, kind: el.kind, base: el.base, via: slot.via, solved: !!(r && r.solved), ...fb });
    await sleep(200);
  }
  for (let c = 0; c < containers.length; c++) {
    if (!used.has(c)) details.push({ k: 'extra', kind: 'dom-extra', note: containerTexts[c].slice(0, 60) });
  }
  return { filled, good, wrong, details };
}

/** Giải CoursePresentation: lật từng slide bằng progressbar-part. */
async function solveCoursePresentation(page, frame, model, logger) {
  const nParts = await cpPartCount(frame);
  const total = nParts || model.pages.length;
  logger(`CP: ${total} phần (${model.pages.length} slide + Summary)`);
  let solvedSlides = 0;
  const details = [];
  for (let i = 0; i < total; i++) {
    await cpGoto(frame, i, logger);
    const pg = model.pages[i];
    if (!pg || !pg.elements.length) { details.push({ i, kind: 'none' }); continue; }
    const r = await solvePage(frame, pg.elements, logger);
    if (r.good > 0 && r.wrong === 0) solvedSlides++;
    details.push({ i, ...r });
    logger(`  slide ${i}: filled=${r.filled} good=${r.good} wrong=${r.wrong}`);
  }
  const finalScore = await readFinalScore(frame);
  logger(`CP done: ${solvedSlides}/${total} slide đúng | final=${JSON.stringify(finalScore)}`);
  return { solved: solvedSlides, slides: total, details, finalScore, kind: model.kind };
}

/** Giải InteractiveBook: mở sách, lật từng trang bằng "Trang tiếp theo". */
async function solveInteractiveBook(page, frame, model, logger) {
  await openInteractiveBook(frame, logger);
  const st = await ibPageState(frame);
  const total = (st && st.total) || (model.pages.length + 1);
  logger(`IB: ${model.pages.length} chương, điều hướng ${total} trang`);
  let solvedPages = 0;
  const details = [];
  for (let i = 0; i < total; i++) {
    const pg = model.pages[i];
    if (pg && pg.elements.length) {
      const r = await solvePage(frame, pg.elements, logger);
      if (r.good > 0 && r.wrong === 0) solvedPages++;
      details.push({ i, title: pg.title, ...r });
      logger(`  trang ${i + 1}/${total} "${pg.title}": filled=${r.filled} good=${r.good} wrong=${r.wrong}`);
    } else {
      details.push({ i, title: pg ? pg.title : 'Summary', kind: 'none' });
      logger(`  trang ${i + 1}/${total}: (không có câu hỏi)`);
    }
    if (i < total - 1) await ibNext(frame, logger);
  }
  await ibSubmit(frame, logger);
  const finalScore = await readFinalScore(frame);
  logger(`IB done: ${solvedPages}/${total} trang đúng | final=${JSON.stringify(finalScore)}`);
  return { solved: solvedPages, slides: total, details, finalScore, kind: model.kind };
}

/**
 * Entry point: giải sách nếu frame có CP/IB. Trả về { solved, slides, details, finalScore }.
 */
async function solveBook(page, frameArg, logger = log) {
  const frame = frameArg || await findBookFrame(page);
  if (!frame) { logger('Book: không tìm thấy frame CP/IB'); return { solved: 0, slides: 0, kind: null }; }
  const model = await readBook(frame);
  if (!model) { logger('Book: không đọc được jsonContent'); return { solved: 0, slides: 0, kind: null }; }
  if (model.kind === 'interactivebook') return solveInteractiveBook(page, frame, model, logger);
  if (model.kind === 'coursepresentation') return solveCoursePresentation(page, frame, model, logger);
  logger(`Book: loại chưa hỗ trợ (${model.kind})`);
  return { solved: 0, slides: 0, kind: model.kind };
}

module.exports = {
  solveBook,
  findBookFrame, readBook,
  solveCoursePresentation, solveInteractiveBook, solvePage,
  readFinalScore, visibleQuestionContainers,
  elementProbeText, probeNorm, log,
};
