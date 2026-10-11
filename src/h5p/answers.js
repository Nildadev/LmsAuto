'use strict';
/**
 * answers.js — Chạy TRONG browser (page.frames) để đọc H5PIntegration.
 * Trả về mảng câu hỏi + đáp án đã extract bằng extract.js (chạy ngoài Node).
 */
const { extractAnswers } = require('./extract');

/**
 * Hàm này được page.evaluate thực thi trong context frame H5P.
 * Chỉ thu thập dữ liệu thô (serializable), KHÔNG require module Node.
 */
function collectInBrowser() {
  const out = [];
  const integ = window.H5PIntegration;
  if (!integ || !integ.contents) return out;
  const contents = integ.contents;
  for (const key in contents) {
    const c = contents[key];
    const lib = c.library || '';
    let jc = c.jsonContent;
    if (typeof jc === 'string') { try { jc = JSON.parse(jc); } catch (_) {} }
    out.push({ key, library: lib, json: jc });
  }
  return out;
}

/**
 * Tìm frame chứa H5PIntegration VÀ có DOM câu hỏi thực sự (.h5p-answer/.h5p-container).
 * lms360 render H5P trong frame thứ 2 (cùng origin, không phải cross-origin iframe).
 * @param {import('playwright').Page} page
 * @param {number} timeoutMs
 */
async function findPlayerFrame(page, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  let fallback = null;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        const stat = await frame.evaluate(() => {
          const hasH5P = !!(window.H5PIntegration && window.H5PIntegration.contents);
          const qNodes = document.querySelectorAll('.h5p-answer, .h5p-alternative-container, .h5p-container, .h5p-question-content').length;
          return { hasH5P, qNodes };
        });
        // Ưu tiên frame có DOM câu hỏi thật
        if (stat.qNodes > 0) return frame;
        // Lưu frame có H5PIntegration làm phương án dự phòng
        if (stat.hasH5P && !fallback) fallback = frame;
      } catch (_) { /* frame detach */ }
    }
    await new Promise(r => setTimeout(r, 700));
  }
  return fallback;
}

/**
 * Tìm frame có H5PIntegration, đợi tới khi xuất hiện.
 * @param {import('playwright').Page} page
 * @param {number} timeoutMs
 * @returns {Promise<Array<{key,library,json}>>} dữ liệu thô
 */
async function collectH5P(page, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        const has = await frame.evaluate(() => !!(window.H5PIntegration && window.H5PIntegration.contents));
        if (has) {
          const raw = await frame.evaluate(collectInBrowser);
          if (raw && raw.length) return { frame, raw };
        }
      } catch (_) { /* frame có thể bị detach */ }
    }
    await new Promise(r => setTimeout(r, 700));
  }
  return { frame: null, raw: [] };
}

/**
 * Đọc toàn bộ câu hỏi + đáp án đã extract.
 * Xử lý QuestionSet/CoursePresentation/InteractiveBook có sub-content lồng nhau.
 * @returns {Promise<Array<{library, kind, data, sub?:Array}>>}
 */
async function readAnswers(page, timeoutMs = 20000) {
  const { raw } = await collectH5P(page, timeoutMs);
  const results = [];
  for (const item of raw) {
    const lib = item.library;
    const base = lib.replace(/\s+\d+\.\d+.*$/, '').trim();

    // Dạng lồng sub-content (QuestionSet, CoursePresentation, InteractiveBook)
    if (/QuestionSet/.test(base)) {
      const subs = [];
      (item.json && item.json.questions || []).forEach((q, i) => {
        const r = extractAnswers(q.library, { params: q.params });
        subs.push({ index: i, library: q.library, extracted: r });
      });
      results.push({
        library: lib, kind: 'questionset',
        passPercentage: item.json && item.json.passPercentage,
        sub: subs,
      });
    } else if (/CoursePresentation|InteractiveBook|BranchingScenario/.test(base)) {
      // Duyệt content lồng trong slides/chapters/interactions.
      // LƯU Ý: CoursePresentation lưu slides ở j.presentation.slides (KHÔNG phải j.slides).
      const subs = [];
      const j = item.json || {};
      const pres = j.presentation || j;
      const pool = [];
      (pres.slides || []).forEach(s => (s.elements || []).forEach(e => pool.push(e.action)));
      (j.chapters || []).forEach(ch => pool.push(...(ch.params && ch.params.content ? ch.params.content : [])));
      (j.content || []).forEach(c => pool.push(c.action));
      pool.filter(Boolean).forEach((act, i) => {
        if (act.library) {
          const r = extractAnswers(act.library, { params: act.params });
          if (r) subs.push({ index: i, library: act.library, extracted: r });
        }
      });
      results.push({ library: lib, kind: 'book', sub: subs });
    } else {
      const r = extractAnswers(lib, { params: (item.json || {}).params || item.json });
      results.push({ library: lib, kind: r ? r.kind : 'unknown', data: r });
    }
  }
  return results;
}

module.exports = { collectH5P, findPlayerFrame, readAnswers, collectInBrowser };
