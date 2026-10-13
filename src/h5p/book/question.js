'use strict';
/**
 * question.js — Giải MỘT container câu hỏi (.h5p-question) trong sách online.
 * Scoped theo container để KHÔNG click nhầm sang câu khác trong cùng Column.
 *
 * BUG ĐÃ FIX: click phần tử câu 2+ trượt vì ngoài viewport -> dùng clickEl
 * (scrollIntoViewIfNeeded trước). Đã verify: MC câu 2 chọn được đúng.
 */
const { sleep, humanDelay } = require('../../core/stealth');
const { clickEl, norm } = require('./dom');
const { solveDragText, solveDrag } = require('../solver');

/** Chọn đáp án Choice (MultiChoice/SingleChoice/TrueFalse/SingleChoiceSet) trong container. */
async function solveChoice(root, container, extracted, logger) {
  // SingleChoiceSet: nhiều slide, mỗi slide 1 câu, click đáp án đúng -> tự sang slide kế.
  if (await container.locator('.h5p-sc-alternative').count().catch(() => 0)) {
    return solveSingleChoiceSet(root, container, extracted, logger);
  }
  // TrueFalse dùng .h5p-true-false-answer, còn lại .h5p-answer.
  let answers = container.locator('.h5p-answer');
  let count = await answers.count().catch(() => 0);
  if (!count) { answers = container.locator('.h5p-true-false-answer'); count = await answers.count().catch(() => 0); }
  if (!count) { answers = container.locator('.h5p-alternative-container'); count = await answers.count().catch(() => 0); }
  if (!count) return { solved: false, reason: 'no-answer-nodes' };

  // Gom node visible + text.
  const visible = [];
  for (let i = 0; i < count; i++) {
    const loc = answers.nth(i);
    if (!(await loc.isVisible().catch(() => false))) continue;
    visible.push({ i, t: norm(await loc.innerText().catch(() => '')) });
  }
  if (!visible.length) return { solved: false, reason: 'no-visible-answer' };

  const want = ((extracted.data || extracted).correctTexts || []).map(norm).filter(Boolean);

  const toClick = [];
  if (want.length) {
    for (const w of want) {
      let hit = visible.find((v) => v.t === w);
      // Khớp gần CHỈ khi cả hai chuỗi đủ dài (>=4): "5" chứa trong "15" là sai,
      // không phải khớp gần.
      if (!hit) hit = visible.find((v) => v.t.length >= 4 && w.length >= 4 && Math.abs(v.t.length - w.length) <= 2 && (v.t.includes(w) || w.includes(v.t)));
      if (hit && !toClick.includes(hit.i)) toClick.push(hit.i);
    }
  } else {
    // Không trích được đáp án -> KHÔNG đoán (trước đây chọn hết/cái đầu -> trả lời
    // sai nhưng vẫn báo solved, khiến bài "hoàn thành" oan).
    logger && logger('  choice: không có đáp án trích được -> bỏ qua');
    return { solved: false, reason: 'no-answers', visible: visible.length };
  }

  let clicked = 0;
  for (const i of toClick) {
    await clickEl(root, answers.nth(i), logger);
    await humanDelay();
    clicked++;
  }
  logger && logger(`  choice: clicked ${clicked} (want=${JSON.stringify(want)} visible=${visible.length})`);
  return { solved: clicked > 0, clicked, want };
}

/**
 * Giải SingleChoiceSet: nhiều slide (.h5p-sc-slide), MỖI LẦN 1 slide hiện.
 * H5P ĐÁNH DẤU sẵn đáp án đúng bằng class `.h5p-sc-is-correct` (không cần
 * extract). Click đáp án đúng -> H5P tự chuyển slide kế. Lặp tới hết slide.
 */
async function solveSingleChoiceSet(root, container, extracted, logger) {
  const data = extracted.data || extracted;
  const texts = (data.correctTexts || []).map(norm).filter(Boolean);
  let clicks = 0;
  let prevQ = null;
  let repeat = 0;
  for (let slide = 0; slide < 20; slide++) {
    // Màn kết quả (đã hết slide) -> dừng, tính là xong.
    if (await container.locator('.h5p-sc-set-results:visible, .h5p-sc-finished:visible').count().catch(() => 0)) break;
    // Chỉ xét alternative trong slide ĐANG hiện.
    const cur = container.locator('.h5p-sc-current-slide');
    const inCur = (await cur.count().catch(() => 0)) ? cur : container;
    const alts = inCur.locator('.h5p-sc-alternative');
    const n = await alts.count().catch(() => 0);
    if (!n) break;
    // Chống lặp vô hạn: cùng 1 câu hỏi sau click mà không tiến -> dừng.
    const qText = norm(await inCur.locator('.h5p-sc-question').first().innerText().catch(() => ''));
    if (qText && qText === prevQ) { if (++repeat >= 2) break; }
    else { repeat = 0; prevQ = qText || prevQ; }

    // Ưu tiên class .h5p-sc-is-correct do H5P cung cấp sẵn.
    let target = -1;
    for (let i = 0; i < n; i++) {
      const isCorrect = await alts.nth(i).evaluate((el) => /h5p-sc-is-correct/.test(el.className || '')).catch(() => false);
      if (isCorrect) { target = i; break; }
    }
    // Fallback: khớp text correctTexts.
    if (target < 0 && texts.length) {
      const altTexts = [];
      for (let i = 0; i < n; i++) altTexts.push(norm(await alts.nth(i).innerText().catch(() => '')));
      target = altTexts.findIndex((t) => texts.includes(t));
      if (target < 0) target = altTexts.findIndex((t) => texts.some((w) => t && (t.includes(w) || w.includes(t))));
    }
    // Không khớp được đáp án -> DỪNG (KHÔNG click bừa cái đầu: H5P chấm điểm NGAY
    // khi click nên sẽ ghi nhận câu SAI, làm hỏng cả set và báo hoàn thành oan).
    if (target < 0) { logger && logger(`  single-choice-set: slide ${slide} không khớp đáp án -> dừng`); break; }

    await clickEl(root, alts.nth(target), logger).catch(() => {});
    clicks++;
    await sleep(1000);
    // Hết slide (không còn current-slide hoặc alternative) -> dừng.
    const stillN = await container.locator('.h5p-sc-current-slide .h5p-sc-alternative').count().catch(() => 0);
    if (!stillN) break;
  }
  logger && logger(`  single-choice-set: clicked ${clicks}`);
  return { solved: clicks > 0, clicked: clicks };
}


async function solveBlanks(root, container, extracted, logger) {
  const inputs = container.locator('input.h5p-text-input');
  const count = await inputs.count().catch(() => 0);
  // DragText KHÔNG có input text (kéo từ vào ô trống) -> delegate sang solver.
  // (container là Locator, vẫn có .locator()/.page() như Frame.)
  if (!count) {
    if (await container.locator('.h5p-drag-text, .ui-droppable').count().catch(() => 0)) {
      return solveDragText(container, extracted, logger);
    }
    return { solved: false, reason: 'no-input' };
  }
  const answers = (extracted.data || extracted).answers || [];
  let filled = 0;
  for (let i = 0; i < count; i++) {
    const inp = inputs.nth(i);
    if (!(await inp.isVisible().catch(() => false))) continue;
    const val = answers[i] !== undefined ? answers[i] : (answers[0] || '');
    try {
      await inp.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
      await inp.click({ timeout: 3000 });
      await sleep(60);
      await inp.fill('');
      await inp.type(String(val), { delay: 55 });
      filled++;
      await humanDelay();
    } catch (_) {}
  }
  logger && logger(`  blanks: filled ${filled}/${answers.length}`);
  return { solved: filled > 0, filled };
}

/** Giải Summary trong container: li[data-bit=1] là đúng. */
async function solveSummary(root, container, extracted, logger) {
  const claims = container.locator('li[data-name], .summary-claim');
  const count = await claims.count().catch(() => 0);
  if (!count) return { solved: false, reason: 'no-claim' };
  const bits = await container.evaluate((el) =>
    [...el.querySelectorAll('li[data-name]')].map((li) => li.getAttribute('data-bit'))).catch(() => []);
  let clicked = 0;
  const hasBits = bits.length === count && bits.some((b) => b !== null);
  for (let i = 0; i < count; i++) {
    if (hasBits && bits[i] !== '1') continue;
    await clickEl(root, claims.nth(i), logger);
    clicked++;
    await humanDelay();
  }
  logger && logger(`  summary: clicked ${clicked}/${count}`);
  return { solved: clicked > 0, clicked };
}

/** Giải 1 element trong container theo kind. */
async function solveElement(root, container, el, logger) {
  const extracted = { data: el.extracted, library: el.library };
  if (!el.extracted) return { solved: false, reason: 'no-extract:' + el.base };
  switch (el.kind) {
    case 'choice': return solveChoice(root, container, extracted, logger);
    case 'blanks': return solveBlanks(root, container, extracted, logger);
    case 'summary': return solveSummary(root, container, extracted, logger);
    case 'dragquestion': return solveDrag(container, extracted, logger);
    default: return { solved: false, reason: 'unsupported:' + el.kind };
  }
}

module.exports = { solveElement, solveChoice, solveBlanks, solveSummary, solveSingleChoiceSet };
