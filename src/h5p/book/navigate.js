'use strict';
/**
 * navigate.js — Điều hướng sách online.
 *
 * CoursePresentation: click .h5p-progressbar-part (index KHỚP presentation.slides,
 *   part cuối = Summary). Đã verify thực tế.
 * InteractiveBook: bấm nút "Đọc" ở splash để mở sách, rồi điều hướng bằng nút
 *   aria-label "Trang tiếp theo"/"Trang trước". Counter dạng "n / N" ở header.
 *   Mỗi "trang" IB = 1 chapter (H5P.Column). Đã verify 7 trang.
 *
 * LƯU Ý lồng (nested): CP nhúng trong InteractiveBook có progressbar RIÊNG; nếu
 * đếm .h5p-progressbar-part toàn cục sẽ trúng progressbar của SÁCH (1 part) ->
 * sai. Luôn scope vào .h5p-course-presentation đang HIỆN.
 */
const { sleep, humanClick } = require('../../core/stealth');
const { clickEl } = require('./dom');

/** Đếm số phần điều hướng CP (scope vào CP đang hiện). */
async function cpPartCount(frame) {
  const visN = await frame.locator('.h5p-course-presentation:visible').count().catch(() => 0);
  if (visN) return frame.locator('.h5p-course-presentation:visible').last().locator('.h5p-progressbar-part').count().catch(() => 0);
  return frame.locator('.h5p-progressbar-part').count().catch(() => 0);
}

/** Đi tới slide CP thứ i bằng progressbar-part (scope vào CP đang hiện). */
async function cpGoto(frame, i, logger) {
  const visN = await frame.locator('.h5p-course-presentation:visible').count().catch(() => 0);
  const scope = visN ? frame.locator('.h5p-course-presentation:visible').last() : frame;
  const parts = scope.locator('.h5p-progressbar-part');
  const n = await parts.count().catch(() => 0);
  if (n > i) {
    await parts.nth(i).click({ force: true }).catch(async () => { await humanClick(frame, parts.nth(i)).catch(() => {}); });
    await sleep(1400);
    logger && logger(`  goto slide ${i} (part ${i + 1}/${n})`);
    return true;
  }
  return false;
}

/** Bấm nút "Đọc" của InteractiveBook (splash). Trả về true nếu đã mở. */
async function openInteractiveBook(frame, logger) {
  // CHÚ Ý: phải dùng :visible — node .h5p-column-content tồn tại nhưng ẩn ở splash,
  // nếu đếm không :visible sẽ tưởng đã mở và KHÔNG bấm "Đọc" (bug đã gặp).
  const already = await frame.locator('.h5p-column-content:visible, .h5p-question:visible').count().catch(() => 0);
  if (already) { logger && logger('  sách đã mở sẵn'); return false; }
  const read = frame.locator('button:has-text("Đọc"), .h5p-interactive-book-read-button, button.h5p-read').first();
  if (await read.count().catch(() => 0)) {
    await read.click({ force: true }).catch(() => {});
    await sleep(3000);
    logger && logger('  pressed "Đọc" (mở sách)');
    return true;
  }
  logger && logger('  KHÔNG tìm thấy nút "Đọc"');
  return false;
}

/** Lấy số trang hiện tại của IB từ counter "n / N". */
async function ibPageState(frame) {
  return frame.evaluate(() => {
    const nodes = [...document.querySelectorAll('.h5p-interactive-book-status-progress, .h5p-interactive-book-status-progress-number, [class*="progress-number"]')];
    let txt = '';
    for (const n of nodes) { const t = (n.innerText || '').trim(); if (/^\d+\s*\/\s*\d+/.test(t)) { txt = t; break; } }
    const m = txt.match(/(\d+)\s*\/\s*(\d+)/);
    return m ? { page: +m[1], total: +m[2] } : null;
  }).catch(() => null);
}

/** Bấm "Trang tiếp theo" của IB. */
async function ibNext(frame, logger) {
  const ok = await frame.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === 'Trang tiếp theo');
    if (b) { b.click(); return true; }
    return false;
  }).catch(() => false);
  if (ok) { await sleep(1800); logger && logger('  IB next page'); }
  return ok;
}

/** Bấm "Trang trước" của IB. */
async function ibPrev(frame, logger) {
  const ok = await frame.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === 'Trang trước');
    if (b) { b.click(); return true; }
    return false;
  }).catch(() => false);
  if (ok) { await sleep(1800); logger && logger('  IB prev page'); }
  return ok;
}

/** Bấm "Tóm tắt & gửi" của IB để nộp. */
async function ibSubmit(frame, logger) {
  const btn = frame.locator('.h5p-interactive-book-summary-menu-button, button:has-text("Tóm tắt")').first();
  if (await btn.count().catch(() => 0)) {
    await clickEl(frame, btn, logger);
    await sleep(2500);
    logger && logger('  pressed "Tóm tắt & gửi"');
    return true;
  }
  return false;
}

module.exports = {
  cpPartCount, cpGoto,
  openInteractiveBook, ibPageState, ibNext, ibPrev, ibSubmit,
};
