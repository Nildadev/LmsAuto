'use strict';
/**
 * dom.js — primitives DOM dùng CHUNG cho mọi loại "sách online" (CP/IB).
 * Nhận `root` là Frame HOẶC Locator (cả hai đều có .locator/.evaluate/.page).
 *
 * BUG ĐÃ FIX (quan trọng): click phần tử ngoài viewport khiến humanClick()
 * di chuột tới toạ độ ngoài màn hình -> trượt -> không chọn được đáp án.
 * => LUÔN scrollIntoViewIfNeeded() trước khi click (xem clickEl).
 */
const { sleep, humanClick } = require('../../core/stealth');

/** Lấy Page từ Frame/Locator/Page để dùng mouse. */
function toPage(root) {
  if (root && typeof root.page === 'function') return root.page();
  return root;
}

/**
 * Click phần tử có scroll-into-view. Đây là fix cốt lõi cho lỗi "câu 2+ không chọn được".
 * @param {import('playwright').Frame|import('playwright').Locator} root
 * @param {import('playwright').Locator} locator
 */
async function clickEl(root, locator, logger) {
  try { await locator.scrollIntoViewIfNeeded({ timeout: 2500 }); } catch (_) {}
  await sleep(150);
  await humanClick(root, locator).catch(() => locator.click({ force: true }).catch(() => {}));
  await sleep(150);
}

/** Đếm phần tử visible trong scope (dùng :visible của Playwright, có scope). */
async function countVisible(root, sel) {
  return root.locator(`${sel}:visible`).count().catch(() => 0);
}

/** Đọc feedback (correct/wrong) trong scope. */
async function readFeedback(root) {
  // Lưu ý: H5P dùng 2 hệ class khác nhau:
  //   MultiChoice/Blanks/Summary: .h5p-correct / .h5p-wrong
  //   TrueFalse: .h5p-true-false-answer.correct / .incorrect (KHÔNG có h5p- prefix)
  // root có thể là Frame (el=undefined -> dùng document) hoặc Locator (el=element -> scope).
  const fb = await root.evaluate((el) => {
    const scope = el || document;
    const vis = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const cnt = (sel) => [...scope.querySelectorAll(sel)].filter(vis).length;
    const correct = cnt('.h5p-correct, .h5p-true-false-answer.correct, .h5p-question-plus-one');
    const wrong = cnt('.h5p-wrong, .h5p-true-false-answer.incorrect, .h5p-question-minus-one');
    const bar = scope.querySelector('.h5p-joubelui-score-bar-progress, .h5p-score-bar-progress');
    return { correct, wrong, bar: bar ? (bar.style.width || null) : null };
  }).catch(() => ({ correct: 0, wrong: 0, bar: null }));
  return fb;
}

/** Bấm nút "Kiểm tra" trong scope (ưu tiên nút nằm trong scope). */
async function pressCheckIn(root, logger) {
  const btn = root.locator('.h5p-question-check-answer:visible').first();
  if (await btn.count().catch(() => 0)) {
    await clickEl(root, btn);
    logger && logger('  pressed check (.h5p-question-check-answer)');
    return true;
  }
  for (const t of ['Kiểm tra', 'Check', 'Gửi trả lời', 'Submit']) {
    const b = root.locator(`button:has-text("${t}")`).first();
    if (await b.count().catch(() => 0)) {
      if (await b.isVisible().catch(() => false)) { await clickEl(root, b); logger && logger(`  pressed "${t}"`); return true; }
    }
  }
  return false;
}

/** Chuẩn hoá text để khớp đáp án (bỏ tag/entity, giữ chữ+số, lowercase). */
function norm(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

module.exports = { clickEl, countVisible, readFeedback, pressCheckIn, norm, toPage };
