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
const { viewH5pContent, markComplete, listCourseDocs } = require('../h5p/doc');

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
  const logger = opts.logger || (() => {});
  const courses = [];
  for (let pg = 1; pg <= maxPages; pg++) {
    let body;
    try {
      body = await getJson(fetchImpl, `${apiBase}/h5p/courses/class?page_id=${pg}&per_page=${perPage}`, token, opts.timeoutMs);
    } catch (e) {
      // 1 trang lỗi KHÔNG được làm sập cả quét: trước đây throw -> scanIncomplete
      // văng -> runFlow báo "không quét được khóa" -> MẤT TOÀN BỘ danh sách.
      logger(`  ⚠️ courses/class trang ${pg} lỗi: ${String(e && e.message).slice(0, 80)} — giữ ${courses.length} khóa đã lấy được`);
      break;
    }
    const arr = (body && body.data && body.data.h5p_courses) || [];
    courses.push(...arr);
    if (arr.length < perPage) break;
  }
  return courses;
}

/**
 * learn_status của 1 khóa -> mảng h5p_content_views, hoặc `null` nếu LỖI.
 * PHÂN BIỆT rõ: `[]` = khóa thật sự rỗng; `null` = đọc lỗi. Caller KHÔNG được coi
 * null là "không có bài" — nếu không sẽ âm thầm bỏ sót toàn bộ bài của khóa đó.
 */
async function fetchLearnStatus(token, courseId, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const apiBase = opts.apiBase || API_BASE;
  try {
    const body = await getJson(fetchImpl, `${apiBase}/h5p/contents/learn_status?page_id=1&per_page=-1&h5p_course_id=${courseId}`, token, opts.timeoutMs);
    return (body && body.data && body.data.h5p_content_views) || [];
  } catch (e) {
    opts.logger && opts.logger(`  ⚠️ learn_status lỗi (khóa ${courseId}): ${String(e && e.message).slice(0, 80)}`);
    return null; // null = LỖI (khác [] = rỗng)
  }
}

/** Chi tiết 1 content -> h5p_content, hoặc {__denied} nếu không có quyền, hoặc null. */
async function fetchContentDetail(token, h5pContentId, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const apiBase = opts.apiBase || API_BASE;
  try {
    const r = await postJson(fetchImpl, `${apiBase}/h5p/contents/detail`, token, { h5p_content_id: h5pContentId }, opts.timeoutMs);
    const body = r.body;
    if (body && Array.isArray(body.errors) && body.errors.length) {
      return { __denied: true, __error: (body.errors[0] && body.errors[0].message) || 'access denied' };
    }
    return (body && body.data && body.data.h5p_content) || null;
  } catch (_) { return null; }
}

/**
 * Phân loại 1 phần: file (type=1) vs H5P (type=0).
 * detail null (API lỗi) -> fallback theo đuôi uri/title; không chắc -> isFile:false (an toàn).
 */
function classify(detail, title) {
  // `type` có thể là number HOẶC string ("1") -> luôn ép Number trước khi so.
  if (detail && detail.type != null && Number.isFinite(Number(detail.type))) return Number(detail.type) === 1;
  const t = String((detail && detail.uri) || title || '');
  return /\.(pptx?|pdf|docx?|xlsx?|mp4|avi|mov|mkv|zip|rar)$/i.test(t);
}

/** Chạy fn trên từng phần tử với tối đa `limit` việc song song (giữ nguyên thứ tự). */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const n = Math.max(1, Math.min(limit || 1, items.length));
  await Promise.all(Array.from({ length: n }, async () => {
    while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/**
 * Quét toàn bộ: danh sách phần CHƯA hoàn thành (status!==3) kèm phân loại.
 * @returns {Promise<{courses:number, parts:Array, doneParts:number}>}
 */
async function scanIncomplete(token, opts = {}) {
  const logger = opts.logger || (() => {});
  const courses = await listAllClassCourses(token, opts);
  // Xử lý từng khóa SONG SONG (giới hạn) — trước đây for-tuần-tự nên lớp có 10-20
  // khóa phải chờ lần lượt từng HTTP (learn_status + listCourseDocs) -> vài chục giây
  // mỗi lần quét (và bị quét 2 lần: đầu phiên + vòng quét lại). mapLimit giữ NGUYÊN
  // thứ tự kết quả -> danh sách parts/báo cáo vẫn ổn định như trước.
  const perCourse = await mapLimit(courses, opts.courseConcurrency || 5, async (c) => {
   // Bọc try/catch TỪNG khóa: 1 khóa lỗi (learn_status/listCourseDocs) không được
   // làm sập Promise.all -> mất TOÀN BỘ kết quả quét. Khóa lỗi -> out rỗng + error.
   try {
    const views = await fetchLearnStatus(token, c.id, opts);
    // null = LỖI đọc learn_status -> KHÔNG coi là khóa rỗng (bỏ sót hết bài của khóa).
    if (!views) return { done: 0, out: [], error: true };
    const done = views.filter((v) => v.status === 3).length;
    const seen = new Set();
    const pending = views.filter((v) => v.status !== 3);
    for (const v of views) seen.add(v.h5p_content_id);
    // Lấy detail của các phần chưa xong SONG SONG (trước đây tuần tự -> chậm khi
    // khóa có nhiều phần). Giữ nguyên thứ tự để báo cáo ổn định.
    const details = await mapLimit(pending, opts.detailConcurrency || 6, (v) => (
      opts.detailImpl
        ? opts.detailImpl(token, v.h5p_content_id, opts)
        : fetchContentDetail(token, v.h5p_content_id, opts)
    ));
    const out = [];
    pending.forEach((v, i) => {
      const detail = details[i];
      out.push({
        cs: c.id, courseTitle: c.title, p: v.h5p_content_id, status: v.status,
        title: (detail && detail.title) || '', isFile: classify(detail, v.title),
        denied: !!(detail && detail.__denied), deniedMsg: (detail && detail.__error) || '',
      });
    });
    // TÀI LIỆU (type=1): không phải H5P. Với khóa CHỈ có tài liệu, learn_status
    // trả RỖNG (chưa từng mở) nên vòng lặp trên bỏ sót hoàn toàn. Lấy danh sách
    // tài liệu của khóa và thêm những cái CHƯA xem (total_view==0) vào parts.
    if (c.total_doc > 0) {
      const docs = await listCourseDocs(token, c.id, opts);
      for (const doc of docs) {
        const id = doc.id || doc.h5p_content_id;
        if (!id || seen.has(id)) continue;
        const v = views.find((x) => x.h5p_content_id === id);
        if (v && v.total_view > 0) continue; // đã mở (bấm nút mắt) -> coi như xong
        out.push({
          cs: c.id, courseTitle: c.title, p: id, status: v ? v.status : 0,
          title: doc.title || '', isFile: true,
        });
      }
    }
    return { done, out };
   } catch (e) {
    logger(`  ⚠️ khóa "${c.title || c.id}" lỗi khi quét: ${String(e && e.message).slice(0, 80)}`);
    return { done: 0, out: [], error: true };
   }
  });
  const parts = perCourse.flatMap((r) => r.out);
  const doneParts = perCourse.reduce((a, r) => a + r.done, 0);
  const failedCourses = perCourse.filter((r) => r.error).length;
  logger(`📚 Khóa: ${courses.length} | chưa xong: ${parts.length} phần | đã xong sẵn: ${doneParts}`
    + (failedCourses ? ` | ⚠️ ${failedCourses} khóa đọc lỗi (tạm bỏ qua)` : ''));
  return { courses: courses.length, parts, doneParts, failedCourses };
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
  const delayMs = opts.delayMs == null ? 300 : opts.delayMs;

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
    if (i < files.length - 1) await sleep(delayMs + Math.floor(Math.random() * 250));
  }
  logger(`\n✅ Đánh dấu xong: ${marked}/${files.length} file` + (failed ? ` (${failed} lỗi)` : ''));
  return { total: parts.length, files: files.length, marked, failed, skippedH5p, items };
}

module.exports = {
  getJson, postJson, listAllClassCourses, fetchLearnStatus, fetchContentDetail,
  classify, scanIncomplete, completeFiles,
};

