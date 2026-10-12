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
const { parseBook } = require('./schema');
const { cpPartCount, cpGoto, openInteractiveBook, ibPageState, ibNext, ibSubmit } = require('./navigate');
const { solveElement } = require('./question');
const { solveVideo } = require('../interactiveVideo');
const { readFeedback, pressCheckIn } = require('./dom');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const QUESTION_KINDS = new Set(['choice', 'blanks', 'summary', 'dragquestion']);

/** Lấy danh sách container câu hỏi đang hiển thị (DOM order). */
async function visibleQuestionContainers(frame) {
  // Gồm cả các loại KHÔNG dùng .h5p-question (SingleChoiceSet, DragText...).
  const qs = frame.locator('.h5p-question, .h5p-single-choice-set, .h5p-drag-text, .h5p-summary');
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
  let containers = await visibleQuestionContainers(frame);
  if (!containers.length || !qElements.length) {
    // Chẩn đoán: xem vì sao trang không có container câu hỏi nào.
    const domQ = await frame.evaluate(() => ({
      q: document.querySelectorAll('.h5p-question').length,
      scs: document.querySelectorAll('.h5p-single-choice-set').length,
      dt: document.querySelectorAll('.h5p-drag-text').length,
      sum: document.querySelectorAll('.h5p-summary').length,
      colContent: document.querySelectorAll('.h5p-column-content').length,
      elBtn: document.querySelectorAll('.h5p-element-button').length,
      text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
    })).catch(() => null);
    logger && logger(`  🐞 CP-page: elements=${elements.length} kinds=${JSON.stringify(elements.map((e) => e.kind))} containers=${containers.length} dom=${JSON.stringify(domQ)}`);
  }

  // CoursePresentation: câu hỏi ẩn sau nút popup (vd .h5p-multichoice-button, aria-haspopup=dialog).
  // Bấm nút -> dialog chứa .h5p-question xuất hiện -> giải bằng model tương ứng -> đóng -> nút kế.
  // Chỉ chạy khi có model câu hỏi thật (trang IB bọc [cp] sẽ delegate ở nhánh dưới).
  const popupEls = elements.filter((e) => QUESTION_KINDS.has(e.kind) && e.extracted);
  const hasRealQ = popupEls.length > 0 || elements.some((e) => QUESTION_KINDS.has(e.kind));
  let popupFilled = 0;
  if (hasRealQ) {
    // Chỉ nút trong CP đang HIỆN (trang IB trước đó ẩn).
    const visCp = frame.locator('.h5p-course-presentation:visible').last();
    const cpBtns = visCp.locator('.h5p-element-button[aria-haspopup="dialog"]');
    const cpBtnN = await cpBtns.count().catch(() => 0);
    if (cpBtnN > 0) {
      logger && logger(`  CP popup: ${cpBtnN} nút câu hỏi ẩn`);
      let ei = 0;
      for (let b = 0; b < cpBtnN; b++) {
        const btn = cpBtns.nth(b);
        if (!(await btn.isVisible().catch(() => false))) continue;
        const el = popupEls[ei] || elements.find((e) => QUESTION_KINDS.has(e.kind)) || qElements[0];
        ei++;
        try {
          await btn.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
          await btn.click({ timeout: 3000 });
          await sleep(800);
          const dlg = frame.locator('.h5p-popup-wrapper:visible, .h5p-dialog:visible').last();
          const cont = (await dlg.count().catch(() => 0)) ? dlg.locator('.h5p-question').first() : frame.locator('.h5p-question:visible').last();
          const vis = await cont.isVisible().catch(() => false);
          if (vis && el) {
            const r = await solveElement(frame, cont, el, logger).catch((e) => ({ err: String(e.message) }));
            await pressCheckIn(dlg, logger).catch(() => {});
            await sleep(700);
            popupFilled += (r && r.clicked) || (r && r.filled) || 0;
          }
        } catch (e) { logger && logger(`    popup ${b} lỗi: ${String(e.message).slice(0, 50)}`); }
        const close = frame.locator('.h5p-popup-wrapper:visible .h5p-close, .h5p-dialog:visible .h5p-close, .h5p-close:visible, button[aria-label*="Đóng"]:visible, button[aria-label*="Close"]:visible').first();
        if (await close.isVisible().catch(() => false)) { await close.click({ timeout: 2000 }).catch(() => {}); }
        else { await frame.page().keyboard.press('Escape').catch(() => {}); }
        await sleep(400);
      }
      if (popupFilled > 0 || !hasRealQ) return { filled: popupFilled, good: popupFilled, wrong: 0, details: [{ kind: 'cp-popup', filled: popupFilled, buttons: cpBtnN }] };
      // Có cả container thường lẫn popup -> gộp (hiếm). Trả về tổng popup + tiếp tục bên dưới.
      containers = await visibleQuestionContainers(frame);
      if (!containers.length) return { filled: popupFilled, good: popupFilled, wrong: 0, details: [{ kind: 'cp-popup', filled: popupFilled, buttons: cpBtnN }] };
      // fall-through để giải container thường, cộng dồn popupFilled ở cuối.
    }
  }
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

  // CoursePresentation lồng trong trang IB: giải các slide CP (delegate).
  // LƯU Ý: KHÔNG return sớm — trang có thể có CP + các câu hỏi RIÊNG trong column
  // (vd Lăng kính trang 0: CP + 2 MultiChoice là 2 .h5p-column-content riêng).
  const cpEl = elements.find((e) => e.kind === 'cp');
  if (cpEl && await frame.locator('.h5p-course-presentation:visible').count().catch(() => 0)) {
    try {
      const sub = parseBook(cpEl.params) || { kind: 'coursepresentation', pages: [] };
      const cpRes = await solveCoursePresentation(frame.page(), frame, sub, (m) => logger && logger(`  ${m}`));
      details.push({ kind: 'cp', solved: cpRes.solved, slides: cpRes.slides });
      filled += cpRes.solved; good += cpRes.solved;
      logger && logger(`  CP lồng: ${cpRes.solved}/${cpRes.slides}`);
    } catch (e) { logger && logger(`  CP lồng lỗi: ${String(e.message).slice(0, 60)}`); }
    // Nếu KHÔNG còn container câu hỏi nào khác -> xong trang.
    containers = await visibleQuestionContainers(frame);
    if (!containers.length) return { filled, good, wrong, details };
    // Ngược lại: tiếp tục giải các container còn lại (bên dưới).
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
  // Số câu hỏi thật trong json — nếu = 0 thì đây chỉ là trình chiếu (xem là xong).
  const totalQ = (model.pages || []).reduce((n, pg) => n + (((pg && pg.elements) || []).filter((e) => QUESTION_KINDS.has(e.kind)).length), 0);
  logger(`CP: ${total} phần (${model.pages.length} slide + Summary)${totalQ === 0 ? ' — không có câu hỏi (chỉ cần xem)' : ''}`);
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
  return { solved: solvedSlides, slides: total, details, finalScore, kind: model.kind, noQuestions: totalQ === 0 };
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
