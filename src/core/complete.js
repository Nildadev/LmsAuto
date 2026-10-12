'use strict';
/**
 * complete.js — Quét TOÀN BỘ khóa học của lớp, tìm phần CHƯA hoàn thành,
 * phân loại file tài liệu (pptx/doc/pdf/mp4...) vs H5P, rồi đánh dấu hoàn
 * thành cho phần file qua API — mô phỏng đúng luồng "bấm nút mắt" trên web.
 *
 * Đã reverse (xem src/h5p/doc.js):
 *   POST /h5p/view_h5p_content   {h5p_content_id, content_id:""}   -> tăng lượt xem
 *   POST /h5p/contents/learn_status {h5p_content_id, status:3, h5p_course_id}
 *        -> đánh dấu HOÀN THÀNH (status 0/2 -> 3)
 *
 * Phân loại (verify thật qua /h5p/contents/detail):
 *   type: 0  -> H5P (uri rỗng)        -> KHÔNG đụng (solver lo)
 *   type: 1  -> file tài liệu (uri có đuôi .pptx/.pdf/...) -> đánh dấu xong
 *
 * Không cần mở browser — chỉ gọi REST API (nhanh, không tốn băng thông).
 */
const { API_BASE, authHeaders } = require('./scan');
const { viewH5pContent, markComplete } = require('../h5p/doc');

/** GET JSON, throw nếu HTTP lỗi. */
async function getJson(fetchImpl, url, token, timeoutMs = 20000) {
  const ac = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, { headers: authHeaders(token), signal: ac.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url} :: ${text.slice(0, 200)}`);
    let body; try { body = JSON.parse(text); } catch (_) { body = { _raw: text.slice(0, 300) }; }
    return body;
  } finally { if (timer) clearTimeout(timer); }
}

/** POST JSON, trả {ok,status,body}. KHÔNG throw khi HTTP lỗi. */
async function postJson(fetchImpl, url, token, payload, timeoutMs = 20000) {
  const ac = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    const text = await res.text().catch(() => '');
    let body; try { body = JSON.parse(text); } catch (_) { body = text; }
    return { ok: res.ok, status: res.status, body };
  } finally { if (timer) clearTimeout(timer); }
}

/** Lấy TOÀN BỘ khóa của lớp (phân trang tới khi trang < perPage). */
async function listAllClassCourses(token, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const apiBase = opts.apiBase || API_BASE;
  const perPage = opts.perPage || 100;
  const maxPages = opts.maxPages || 30;
  const courses = [];
  for (let pg = 1; pg <= maxPages; pg++) {
    const body = await getJson(fetchImpl, `${apiBase}/h5p/courses/class?page_id=${pg}&per_page=${perPage}`, token, opts.timeoutMs);
    const arr = (body && body.data && body.data.h5p_courses) || [];
    courses.push(...arr);
    if (arr.length < perPage) break;
  }
  return courses;
}

/** learn_status của 1 khóa -> mảng h5p_content_views (rỗng nếu lỗi/không có). */
async function fetchLearnStatus(token, courseId, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const apiBase = opts.apiBase || API_BASE;
  try {
    const body = await getJson(fetchImpl, `${apiBase}/h5p/contents/learn_status?page_id=1&per_page=-1&h5p_course_id=${courseId}`, token, opts.timeoutMs);
    return (body && body.data && body.data.h5p_content_views) || [];
  } catch (_) { return []; }
}

/** Chi tiết 1 content -> h5p_content hoặc null. */
async function fetchContentDetail(token, h5pContentId, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const apiBase = opts.apiBase || API_BASE;
  try {
    const r = await postJson(fetchImpl, `${apiBase}/h5p/contents/detail`, token, { h5p_content_id: h5pContentId }, opts.timeoutMs);
    return (r.ok && r.body && r.body.data && r.body.data.h5p_content) || null;
  } catch (_) { return null; }
}

/**
 * Phân loại 1 phần: file (type=1) vs H5P (type=0).
 * detail null (API lỗi) -> fallback theo đuôi uri/title; không chắc -> isFile:false (an toàn).
 */
function classify(detail, title) {
  if (detail && typeof detail.type === 'number') return detail.type === 1;
  const t = String((detail && detail.uri) || title || '');
  return /\.(pptx?|pdf|docx?|xlsx?|mp4|avi|mov|mkv|zip|rar)$/i.test(t);
}

/**
 * Quét toàn bộ: danh sách phần CHƯA hoàn thành (status!==3) kèm phân loại.
 * @returns {Promise<{courses:number, parts:Array, doneParts:number}>}
 */
async function scanIncomplete(token, opts = {}) {
  const logger = opts.logger || (() => {});
  const courses = await listAllClassCourses(token, opts);
  const parts = [];
  let doneParts = 0;
  for (const c of courses) {
    const views = await fetchLearnStatus(token, c.id, opts);
    if (!views.length) continue;
    doneParts += views.filter((v) => v.status === 3).length;
    for (const v of views) {
      if (v.status === 3) continue;
      const detail = opts.detailImpl
        ? await opts.detailImpl(token, v.h5p_content_id, opts)
        : await fetchContentDetail(token, v.h5p_content_id, opts);
      parts.push({
        cs: c.id, courseTitle: c.title, p: v.h5p_content_id, status: v.status,
        title: (detail && detail.title) || '', isFile: classify(detail, v.title),
      });
    }
  }
  logger(`📚 Khóa: ${courses.length} | chưa xong: ${parts.length} phần | đã xong sẵn: ${doneParts}`);
  return { courses: courses.length, parts, doneParts };
}

/**
 * Đánh dấu hoàn thành các phần là FILE (isFile && status!==3).
 * Gọi view_h5p_content (tăng lượt xem, giống bấm nút mắt) rồi learn_status(status=3).
 *
 * @param {string} token
 * @param {object} opts { fetchImpl, apiBase, logger, sleep, delayMs, view, only(RegExp), dryRun, detailImpl }
 * @returns {Promise<{total, files, marked, failed, skippedH5p, items}>}
 */
async function completeFiles(token, opts = {}) {
  const logger = opts.logger || (() => {});
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const delayMs = opts.delayMs == null ? 500 : opts.delayMs;

  const { parts } = await scanIncomplete(token, opts);
  const fileParts = parts.filter((x) => x.isFile);
  const files = fileParts.filter((f) => !opts.only || opts.only.test(f.title + ' ' + f.courseTitle));
  const skippedH5p = parts.length - fileParts.length;
  logger(`📄 Phần là file cần đánh dấu: ${files.length} | bỏ qua (H5P để solver): ${skippedH5p}`);
  if (opts.dryRun) {
    files.forEach((f, i) => logger(`  ${i + 1}. [${f.courseTitle}] ${f.title} (status=${f.status})`));
    return { total: parts.length, files: files.length, marked: 0, failed: 0, skippedH5p, dryRun: true, items: files.map((f) => ({ ...f, ok: false, dryRun: true })) };
  }

  let marked = 0, failed = 0;
  const items = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    logger(`\n━━━ [${i + 1}/${files.length}] ${f.title} ━━━`);
    // 1) "Bấm nút mắt": tăng lượt xem (giống hành vi người dùng thật).
    if (opts.view !== false) await viewH5pContent(token, f.p, '', logger, opts);
    // 2) Đánh dấu hoàn thành — endpoint quyết định.
    const r = await markComplete(token, f.p, f.cs, logger, opts);
    if (r.ok) marked++; else failed++;
    items.push({ ...f, ok: r.ok, httpStatus: r.status });
    if (i < files.length - 1) await sleep(delayMs + Math.floor(Math.random() * 400));
  }
  logger(`\n✅ Đánh dấu xong: ${marked}/${files.length} file` + (failed ? ` (${failed} lỗi)` : ''));
  return { total: parts.length, files: files.length, marked, failed, skippedH5p, items };
}

module.exports = {
  getJson, postJson, listAllClassCourses, fetchLearnStatus, fetchContentDetail,
  classify, scanIncomplete, completeFiles,
};

