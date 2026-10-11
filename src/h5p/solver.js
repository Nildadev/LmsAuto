'use strict';
/**
 * solver.js — Tự động click/chọn đáp án đúng cho từng dạng H5P trong frame.
 * Chiến lược: ưu tiên chọn theo đáp án đã extract; có fallback brute-force
 * (chọn hết -> Check -> đọc .h5p-correct -> bỏ sai) cho dạng chưa hỗ trợ.
 *
 * DOM selector dựa trên H5P core chuẩn (lms360 dùng H5P 1.27).
 */
const { humanClick, humanDelay, sleep } = require('../core/stealth');
const { deburr } = require('./extract');

/** Chuẩn hoá text để khớp: bỏ tag/entity, gộp khoảng trắng, bỏ dấu cách lạ, lowercase. */
function normalizeText(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // gộp mọi khoảng trắng (kể cả newline) thành 1 space
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Đợi selector trong frame, trả về locator hoặc null. */
async function waitSel(frame, sel, ms = 4000) {
  try {
    const loc = frame.locator(sel).first();
    await loc.waitFor({ state: 'attached', timeout: ms });
    return loc;
  } catch (_) { return null; }
}

/** Giải MultiChoice/SingleChoiceSet/TrueFalse: click đáp án có correct=true. */
async function solveChoice(frame, extracted, logger) {
  // Chỉ dùng .h5p-answer (li role=radio VISIBLE). Tránh .h5p-alternative-container
  // (bản ẩn duplicate) để không click nhầm node không tác dụng.
  let answers = frame.locator('.h5p-answer');
  let count = await answers.count();
  if (!count) {
    answers = frame.locator('.h5p-alternative-container, .h5p-true-false-answer');
    count = await answers.count();
  }
  if (!count) return { solved: false, reason: 'no-answer-nodes' };

  // Lọc chỉ node đang VISIBLE + lấy text
  const visible = [];
  for (let i = 0; i < count; i++) {
    const loc = answers.nth(i);
    const vis = await loc.isVisible().catch(() => false);
    if (!vis) continue;
    const t = normalizeText(await loc.innerText().catch(() => ''));
    visible.push({ i, t });
  }
  if (!visible.length) return { solved: false, reason: 'no-visible-answer' };

  const want = (extracted.data && extracted.data.correctTexts || []).map(normalizeText);
  const wantMulti = /MultiChoice|Multi/.test(extracted.library || '');

  const toClick = [];
  if (want.length) {
    // QUAN TRỌNG: khớp CHÍNH XÁC trước (tránh "unfortunately" chứa "fortunately").
    // Nếu không có exact match, mới xét đến khớp gần (khoảng trắng lạ).
    const exactHit = (w) => visible.find(v => v.t === w);
    const looseHit = (w) => {
      // chỉ chấp nhận khi độ dài gần nhau (tránh superstring)
      const cand = visible.filter(v => Math.abs(v.t.length - w.length) <= 2);
      return cand.find(v => v.t.includes(w) || w.includes(v.t));
    };
    want.forEach(w => {
      const found = exactHit(w) || looseHit(w);
      if (found) toClick.push(found.i);
    });
  } else {
    // Không có đáp án -> chọn hết (multi) hoặc cái đầu visible (single)
    toClick.push(...(wantMulti ? visible.map(v => v.i) : [visible[0].i]));
  }

  const clicked = [];
  for (const i of toClick) {
    if (!clicked.includes(i)) {
      await humanClick(frame, answers.nth(i));
      await humanDelay();
      clicked.push(i);
    }
  }
  logger && logger(`choice: clicked ${clicked.length} (want=${JSON.stringify(want)} visible=${JSON.stringify(visible.map(v => v.t))})`);
  return { solved: clicked.length > 0, clicked, want };
}

/** Giải Blanks: điền text đáp án vào input theo thứ tự. */
async function solveBlanks(frame, extracted, logger) {
  // CHỈ lấy input VISIBLE (H5P có input ẩn duplicate cho a11y/screen reader).
  // Nếu lấy cả input ẩn sẽ click nhầm node không tác dụng và timeout.
  const inputs = frame.locator('input.h5p-text-input:visible');
  const count = await inputs.count();
  if (!count) return { solved: false, reason: 'no-visible-input' };
  const answers = (extracted.data && extracted.data.answers) || [];
  for (let i = 0; i < count; i++) {
    const val = answers[i] !== undefined ? answers[i] : (answers[0] || 'a');
    const inp = inputs.nth(i);
    await inp.click({ timeout: 4000 });
    await sleep(60);
    await inp.fill('');
    await inp.type(val, { delay: 55 });
    await humanDelay();
  }
  logger && logger(`blanks: filled ${count}/${answers.length} answers`);
  return { solved: true, filled: count };
}

/** Giải DragQuestion: kéo element đúng vào dropzone (theo correctElements + sort y). */
async function solveDrag(frame, extracted, logger) {
  const drags = frame.locator('.h5p-draggable:visible');
  const dzs = frame.locator('.h5p-dropzone:visible');
  const dragCount = await drags.count();
  const dzCount = await dzs.count();
  if (!dragCount || !dzCount) return { solved: false, reason: 'no-drag-dom', dragCount, dzCount };

  const elText = (extracted.data && extracted.data.elements) || [];
  const zones = (extracted.data && extracted.data.zones) || [];

  // Thu thập box + text của draggable
  const dragInfo = [];
  for (let i = 0; i < dragCount; i++) {
    const box = await drags.nth(i).boundingBox();
    let txt = '';
    try { txt = (await drags.nth(i).innerText()).trim(); } catch (_) {}
    if (box) dragInfo.push({ box, txt });
  }
  // Playwright: Frame không có .mouse, chỉ Page có. Dùng page.mouse (tọa độ boundingBox là page coords).
  const mouse = frame.page().mouse;

  // Thu thập box dropzone, sắp theo y tăng dần (khớp thứ tự json zones)
  const dzInfo = [];
  for (let i = 0; i < dzCount; i++) {
    const box = await dzs.nth(i).boundingBox();
    if (box) dzInfo.push({ box });
  }
  dzInfo.sort((a, b) => a.box.y - b.box.y);

  // Sort zones json theo y để khớp DOM (y phần trăm, monotonic)
  const sortedZones = zones.slice().sort((a, b) => (a.y || 0) - (b.y || 0));

  let dragged = 0;
  for (let i = 0; i < dzInfo.length; i++) {
    const zone = sortedZones[i];
    if (!zone || !zone.correctElements || !zone.correctElements.length) continue;
    const elIdx = Number(zone.correctElements[0]);
    const wantText = elText[elIdx];
    if (!wantText) continue;
    // Tìm draggable có text chứa đáp án (DOM có prefix "có thể lấy X trong Y.")
    const norm = s => String(s || '').replace(/có thể lấy\s*\d+\s*trong\s*\d+\.?/gi, '').trim();
    const want = deburr(wantText).toLowerCase();
    const drag = dragInfo.find(d => deburr(d.txt).toLowerCase().includes(want)) ||
                 dragInfo.find(d => { const nd = deburr(norm(d.txt)).toLowerCase(); return nd.includes(want) || want.includes(nd); });
    if (!drag) { logger && logger(`  zone${i}: không tìm thấy draggable cho "${wantText}"`); continue; }
    const dz = dzInfo[i].box;
    await mouse.move(drag.box.x + drag.box.width / 2, drag.box.y + drag.box.height / 2, { steps: 8 });
    await mouse.down();
    await sleep(120);
    await mouse.move(dz.x + dz.width / 2, dz.y + dz.height / 2, { steps: 20 });
    await sleep(120);
    await mouse.up();
    dragged++;
    logger && logger(`  zone${i} <= "${wantText}"`);
    await humanDelay();
  }
  logger && logger(`drag: dragged ${dragged}/${dzInfo.length}`);
  return { solved: dragged > 0, dragged, zones: dzInfo.length };
}

/** Giải Summary: mỗi <li data-bit="1"> là đáp án đúng -> click. (Đã verify DOM thật lms360) */
async function solveSummary(frame, extracted, logger) {
  const claims = frame.locator('.h5p-summary li[data-name], .summary-claim');
  const count = await claims.count();
  if (!count) return { solved: false, reason: 'no-claim' };

  // data-bit trên mỗi <li>: "1" = đúng, "0" = sai (thuộc tính sẵn trong DOM).
  const bits = await frame.evaluate(() => {
    const lis = [...document.querySelectorAll('.h5p-summary li[data-name]')];
    return lis.map(li => li.getAttribute('data-bit'));
  }).catch(() => []);
  const hasBits = bits.length === count && bits.some(b => b !== null);

  let clicked = 0;
  if (hasBits) {
    for (let i = 0; i < count; i++) {
      if (bits[i] === '1') { await humanClick(frame, claims.nth(i)); clicked++; await humanDelay(); }
    }
    logger && logger(`summary: clicked ${clicked} đáp án đúng (data-bit=1) / ${count}`);
  } else {
    // Fallback: click hết rồi Check, giữ correct bỏ wrong (thực hiện ở ngoài).
    for (let i = 0; i < count; i++) { await humanClick(frame, claims.nth(i)); await humanDelay(); }
    clicked = count;
    logger && logger(`summary: clicked all ${count} (fallback, no data-bit)`);
  }
  return { solved: clicked > 0, clicked, total: count };
}

/** Bấm nút Check/Kiểm tra/Gửi trả lời trong frame. */
async function pressCheck(frame, logger) {
  const texts = ['Kiểm tra', 'Check', 'Gửi trả lời', 'Submit', 'Kiểm tra lại'];
  for (const t of texts) {
    const btn = frame.locator(`button:has-text("${t}")`).first();
    if ((await btn.count().catch(() => 0)) && (await btn.isVisible().catch(() => false))) {
      await humanClick(frame, btn); logger && logger(`pressed "${t}"`); return true;
    }
  }
  const sel = frame.locator('.h5p-question-check-answer:visible').first();
  if ((await sel.count().catch(() => 0))) { await humanClick(frame, sel); return true; }
  return false;
}

/** Bấm "Câu tiếp theo"/"Next". Trả về true nếu bấm được (chứng tỏ câu trước ĐÚNG). */
async function pressNext(frame, logger) {
  const texts = ['Câu tiếp theo', 'Tiếp theo', 'Câu hỏi tiếp theo', 'Next'];
  for (const t of texts) {
    const btn = frame.locator(`button:has-text("${t}")`).first();
    if ((await btn.count().catch(() => 0)) && (await btn.isVisible().catch(() => false))) {
      await humanClick(frame, btn); logger && logger(`next "${t}"`); return true;
    }
  }
  const sel = frame.locator('.h5p-question-next:visible, .h5p-question-try-again:visible').first();
  if ((await sel.count().catch(() => 0))) { await humanClick(frame, sel); return true; }
  return false;
}

/** Đếm phần tử visible trong frame theo selector. */
async function countVisible(frame, sel) {
  return frame.evaluate((s) => [...document.querySelectorAll(s)].filter(e => e && e.offsetParent !== null).length, sel);
}

/**
 * Giải 1 QuestionSet: duyệt từng câu, giải ĐÚNG để "Câu tiếp theo" xuất hiện.
 * Trả về thống kê để ước tính điểm.
 * @param {import('playwright').Frame} frame
 * @param {object} qsItem  phần tử readAnswers có kind='questionset' (chứa .sub[])
 * @param {object} opts    { maxQuestions, logger }
 */
async function solveQuestionSet(frame, qsItem, opts = {}) {
  const logger = opts.logger || (() => {});
  const maxQ = opts.maxQuestions || 30;
  const subs = qsItem.sub || [];
  logger(`QuestionSet: ${subs.length} câu trong json`);

  let attempted = 0, correctCount = 0;
  for (let step = 0; step < maxQ; step++) {
    const hasChoice = await countVisible(frame, '.h5p-alternative-container');
    const hasInput = await countVisible(frame, 'input.h5p-text-input');
    const hasDrag = await countVisible(frame, '.h5p-draggable');
    if (!hasChoice && !hasInput && !hasDrag) { logger(`step ${step}: hết câu hỏi`); break; }

    const sub = subs[step];
    const item = { library: sub?.library, kind: sub?.extracted?.kind, data: sub?.extracted };
    attempted++;
    logger(`step ${step}: ${sub?.library || '?'} (choice=${hasChoice} input=${hasInput} drag=${hasDrag})`);

    let r = { solved: false };
    try {
      if (hasChoice > 0) r = await solveChoice(frame, item, logger);
      else if (hasInput > 0) r = await solveBlanks(frame, item, logger);
      else if (hasDrag > 0) r = await solveDrag(frame, item, logger);
    } catch (e) { logger('  solve lỗi:', e.message.slice(0, 40)); }

    await sleep(400);
    await pressCheck(frame, logger);
    await sleep(1200);

    // Đếm correct/wrong ĐÚNG cách: lọc offsetParent thủ công (KHÔNG dùng :visible — không phải CSS).
    const res = await frame.evaluate(() => {
      const vis = (sel) => [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null).length;
      return { wrong: vis('.h5p-wrong'), correct: vis('.h5p-correct') };
    }).catch(() => ({}));
    const isCorrect = (res.wrong === 0 && res.correct > 0);
    if (isCorrect) correctCount++;
    const hasNext = await pressNext(frame, logger);
    logger(`  result=${JSON.stringify(res)} correct=${isCorrect} next=${hasNext}`);
    if (hasNext) { await sleep(1000); }
    else {
      // Sai -> thử "Đáp án" rồi Next (sang câu sau nhưng không tính điểm)
      const showSol = frame.locator('button:has-text("Đáp án")').first();
      if ((await showSol.count().catch(() => 0)) && (await showSol.isVisible().catch(() => false))) {
        await humanClick(frame, showSol); await sleep(800);
        if (await pressNext(frame, logger)) { await sleep(1000); continue; }
      }
      logger('  dừng (không Next được)'); break;
    }
  }

  // Đọc điểm tổng cuối cùng (nếu có màn kết quả)
  const finalScore = await frame.evaluate(() => {
    const txt = (document.body.innerText || '').match(/(\d+)\s*\/\s*(\d+)/);
    const bar = document.querySelector('.h5p-score-bar-progress, .h5p-joubelui-score-bar-progress');
    const summary = (document.querySelector('.h5p-question-score, .h5p-score-bar-text') || {}).innerText || '';
    return { ratio: txt ? { got: +txt[1], total: +txt[2] } : null, barWidth: bar ? bar.style.width : null, summary: summary.slice(0, 60) };
  }).catch(() => ({}));

  return { attempted, correctCount, total: subs.length, finalScore };
}

/**
 * Giải 1 dạng theo extracted. Trả về {solved, ...}
 * @param {import('playwright').Frame} frame
 * @param {object} extracted  một phần tử của readAnswers()
 * @param {function} logger
 */
async function solveOne(frame, item, logger) {
  if (!item) return { solved: false, reason: 'null' };
  // Chuẩn hoá: nhận cả 2 dạng đầu vào
  //  (a) phần tử readAnswers(): { kind, data, library }
  //  (b) sub-item QuestionSet/Book: { index, library, extracted:{kind,...} }
  let kind = item.kind;
  let data = item.data;
  if (!kind && item.extracted) {
    kind = item.extracted.kind;
    data = item.extracted;
  }
  const normalized = { kind, data, library: item.library };
  if (kind === 'choice') return solveChoice(frame, normalized, logger);
  if (kind === 'blanks') return solveBlanks(frame, normalized, logger);
  if (kind === 'dragquestion') return solveDrag(frame, normalized, logger);
  if (kind === 'summary') return solveSummary(frame, normalized, logger);
  return { solved: false, reason: 'unsupported:' + kind };
}

module.exports = { solveOne, solveChoice, solveBlanks, solveDrag, solveSummary, pressCheck, pressNext, solveQuestionSet, countVisible, waitSel };
