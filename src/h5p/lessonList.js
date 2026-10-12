'use strict';
/**
 * lessonList.js — Bài có NHIỀU bài tập tương tác.
 *
 * Một số bài học không phải 1 H5P đơn mà chứa khối "BÀI TẬP TƯƠNG TÁC: ..." với
 * DANH SÁCH nhiều bài tập con (mỗi dòng có tiêu đề + trạng thái Hoàn thành/Đang xem).
 * Solver mở từng bài con, giải, rồi quay lại danh sách.
 *
 * LƯU Ý: cấu trúc DOM dùng class CSS-modules hash (css-xxxx) nên KHÔNG bám class;
 * thay vào đó dò theo: tiêu đề khối -> phần tử cuộn (overflow auto) -> các item con
 * có `p[aria-label]` (tiêu đề). Duyệt theo CHỈ SỐ để không nhầm khi trùng tên.
 */
const { sleep } = require('../core/stealth');

const HEADER_RE = 'BÀI TẬP TƯƠNG TÁC';

/** Đọc danh sách bài tập con trong frame -> [{i,title,status,done}] hoặc null. */
async function readList(frame) {
  return frame.evaluate((headerText) => {
    const re = new RegExp(headerText, 'i');
    const nodes = [...document.querySelectorAll('div,p,span,h1,h2,h3,h4')];
    const header = nodes.find((el) => el.children.length === 0 && re.test(el.textContent || ''));
    if (!header) return null;
    let box = header;
    for (let k = 0; k < 4 && box.parentElement; k++) box = box.parentElement;
    const scroller = [...box.querySelectorAll('*')].find((el) => /auto/.test(getComputedStyle(el).overflowY)) || box;
    const items = [...scroller.children].filter((el) => el.querySelector && el.querySelector('p[aria-label]'));
    return items.map((el, i) => {
      const t = el.querySelector('p[aria-label]');
      const txt = el.textContent || '';
      return {
        i,
        title: (t && t.getAttribute('aria-label')) || '',
        status: (txt.match(/Hoàn thành|Đang xem|Đang học|Chưa học|Chưa xem/) || [''])[0],
        done: /Hoàn thành/i.test(txt),
      };
    });
  }, HEADER_RE).catch(() => null);
}

/** Click bài con thứ idx (duyệt theo chỉ số). */
async function clickItem(frame, idx) {
  return frame.evaluate(({ headerText, idx }) => {
    const re = new RegExp(headerText, 'i');
    const nodes = [...document.querySelectorAll('div,p,span,h1,h2,h3,h4')];
    const header = nodes.find((el) => el.children.length === 0 && re.test(el.textContent || ''));
    if (!header) return false;
    let box = header;
    for (let k = 0; k < 4 && box.parentElement; k++) box = box.parentElement;
    const scroller = [...box.querySelectorAll('*')].find((el) => /auto/.test(getComputedStyle(el).overflowY)) || box;
    const items = [...scroller.children].filter((el) => el.querySelector && el.querySelector('p[aria-label]'));
    const it = items[idx];
    if (!it) return false;
    it.scrollIntoView({ block: 'center' });
    it.click();
    return true;
  }, { headerText: HEADER_RE, idx }).catch(() => false);
}

/**
 * Giải toàn bộ bài con trong danh sách "BÀI TẬP TƯƠNG TÁC".
 * @returns {Promise<{solved:number,total:number}>}
 */
async function solveExerciseList(tab, frame, logger, opts = {}, d) {
  const log = (m) => logger && logger(m);
  const lessonUrl = tab.url();

  const list = await readList(frame);
  if (!list || !list.length) return { solved: 0, total: 0 };
  log(`  ▶ Bài có ${list.length} bài tập tương tác: ${list.map((x) => x.title || '(?)').join(' | ')}`);

  let solved = 0;
  for (let i = 0; i < list.length; i++) {
    // Quay lại danh sách cho sạch (bài trước có thể đã điều hướng khỏi list)
    if (i > 0) {
      await tab.goto(lessonUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await sleep(2000);
      await d.dismissAll(tab).catch(() => {});
    }
    const clicked = await clickItem(frame, i);
    if (!clicked) { log(`  (list) không mở được bài ${i + 1}`); continue; }
    await sleep(3000);

    const sub = await d.findPlayerFrame(tab, 12000).catch(() => null);
    if (!sub) { log(`  (list) bài ${i + 1} không thấy player`); continue; }
    const { kind, library } = await d.detectKind(sub);
    log(`  (list) bài ${i + 1}/${list.length} "${list[i].title}" -> ${kind} (${library || '?'})`);

    let res = { solved: 0 };
    if (kind === 'book') res = await d.solveBook(tab, sub, logger).catch(() => ({ solved: 0 }));
    else if (kind === 'iv') res = await d.solveVideo(tab, sub, logger).catch(() => ({ solved: 0 }));
    else if (kind === 'single') res = await d.solveSingle(tab, sub, library, logger, d).catch(() => ({ solved: 0 }));
    if (res && res.solved > 0) { solved++; log(`  ✅ (list) xong bài ${i + 1}`); }
    await sleep(1200);
  }
  return { solved, total: list.length };
}

module.exports = { solveExerciseList, readList };
