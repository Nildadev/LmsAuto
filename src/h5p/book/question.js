'use strict';
/**
 * question.js — Giải MỘT container câu hỏi (.h5p-question) trong sách online.
 * Scoped theo container để KHÔNG click nhầm sang câu khác trong cùng Column.
 *
 * BUG ĐÃ FIX: click phần tử câu 2+ trượt vì ngoài viewport -> dùng clickEl
 * (scrollIntoViewIfNeeded trước). Đã verify: MC câu 2 chọn được đúng.
 */
const { sleep, humanDelay } = require('../../core/stealth');
const { clickEl, countVisible, norm } = require('./dom');

/** Chọn đáp án Choice (MultiChoice/SingleChoice/TrueFalse) trong container. */
async function solveChoice(root, container, extracted, logger) {
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
  const isMulti = /MultiChoice/.test(extracted.library || '');

  const toClick = [];
  if (want.length) {
    for (const w of want) {
      let hit = visible.find((v) => v.t === w);
      if (!hit) hit = visible.find((v) => v.t.length && Math.abs(v.t.length - w.length) <= 2 && (v.t.includes(w) || w.includes(v.t)));
      if (hit && !toClick.includes(hit.i)) toClick.push(hit.i);
    }
  } else {
    // Không extract được -> brute-force: chọn hết (multi) hoặc cái đầu.
    toClick.push(...(isMulti ? visible.map((v) => v.i) : [visible[0].i]));
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

/** Điền Blanks trong container (theo thứ tự input). */
async function solveBlanks(root, container, extracted, logger) {
  const inputs = container.locator('input.h5p-text-input');
  const count = await inputs.count().catch(() => 0);
  if (!count) return { solved: false, reason: 'no-input' };
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
    default: return { solved: false, reason: 'unsupported:' + el.kind };
  }
}

module.exports = { solveElement, solveChoice, solveBlanks, solveSummary };
