'use strict';
/**
 * scan.js — Quét danh sách bài tập H5P được giao cho học sinh qua REST API.
 *
 * Reverse-engineered (docs/H5P-ANSWER-MAP.md + /tmp/lmsdump-auth):
 *
 *   GET /api/gd/v3/h5p/my_assigned_pending
 *     -> { data: { studentName, items: [...], summary: {new,dueSoon,overdue,upcoming} } }
 *     Mỗi item: { subject, title, courseId(HEX32), courseTitle, contentId(HEX24),
 *                 h5pContentId(UUID), partId, status, isEssay, dueInDays, isOverdue,
 *                 isDueSoon, group, effectiveDueAt }
 *
 *   GET /api/gd/v3/h5p/courses/class?page_id=&per_page=  (fallback: khóa của lớp)
 *   GET /api/gd/v3/h5p/contents?...&course_id=<UUID>&... (fallback: bài của 1 khóa)
 *
 * URL xem bài: /xem-video?p=<h5pContentId>&c=<contentId>&cs=<courseId dạng UUID>
 *   courseId từ API là 32 hex không dấu gạch -> cần chuyển sang UUID chuẩn.
 *
 * Trạng thái item: 'not_started' | 'in_progress' | 'completed' (chuỗi).
 */
const API_BASE = 'https://lms360.vn/api/gd/v3';
const WEB_BASE = 'https://lms360.vn';

/** Trạng thái cần làm (chưa xong). */
const TODO_STATUSES = new Set(['not_started', 'in_progress']);

/** Blacklist môn/bài mặc định (thể dục, âm nhạc... thường không có H5P để giải). */
const DEFAULT_BLACKLIST = /võ nhạc|thể dục|xuất phát|nhịp điệu|âm nhạc|bốn mùa hòa ca|đá cầu|quan họ|giai điệu|chạy ngắn|chạy lao/i;

/** Chuyển 32 hex -> UUID chuẩn (8-4-4-4-12). Trả nguyên nếu đã là UUID. */
function hexToUuid(h) {
  const s = String(h || '').replace(/-/g, '');
  if (s.length !== 32) return h;
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`.toLowerCase();
}

/** Header Authorization. LƯU Ý: chỉ gửi 1 header 'authorization' (gửi trùng -> 401). */
function authHeaders(token, withJson = false) {
  const h = { authorization: token };
  if (withJson) h['Content-Type'] = 'application/json';
  return h;
}

/** GET JSON có kiểm tra lỗi HTTP. */
async function getJson(fetchImpl, url, token, timeoutMs = 20000) {
  const ac = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, { headers: authHeaders(token), signal: ac.signal });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch (_) { body = { _raw: text.slice(0, 300) }; }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url} :: ${text.slice(0, 200)}`);
    return body;
  } finally { if (timer) clearTimeout(timer); }
}

/** Chuẩn hóa 1 item từ my_assigned_pending -> shape dùng chung. */
function normalizeItem(it) {
  return {
    raw: it,
    subject: it.subject || '',
    title: it.title || it.courseTitle || '',
    courseTitle: it.courseTitle || '',
    status: it.status || 'not_started',
    isEssay: !!it.isEssay,
    group: it.group || '',
    dueInDays: it.dueInDays,
    isOverdue: !!it.isOverdue,
    isDueSoon: !!it.isDueSoon,
    // ID để dựng URL
    p: it.h5pContentId,               // h5p_content UUID
    c: it.contentId,                  // content_id hex24
    cs: hexToUuid(it.courseId),       // h5p_course UUID
  };
}

/** URL xem bài. */
function videoUrl(item) {
  const n = item.raw ? item : normalizeItem(item);
  return `${WEB_BASE}/xem-video?p=${n.p}&c=${n.c}&cs=${n.cs}`;
}

/** Lấy danh sách bài được giao (toàn bộ, kèm summary). */
async function listAssigned(token, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const apiBase = opts.apiBase || API_BASE;
  const body = await getJson(fetchImpl, `${apiBase}/h5p/my_assigned_pending`, token, opts.timeoutMs);
  const data = (body && body.data) || {};
  return { items: (data.items || []).map(normalizeItem), summary: data.summary || {}, studentName: data.studentName || '' };
}

/** Lọc các bài cần làm (bỏ bài đã xong; tùy chọn bỏ essay/blacklist môn). */
function filterTodo(items, opts = {}) {
  const blacklist = opts.blacklist || null; // ví dụ: /thể chất|âm nhạc|mĩ thuật/i
  const statuses = opts.statuses || TODO_STATUSES;
  return items.filter((it) => {
    if (!statuses.has(it.status)) return false;
    if (opts.skipEssay && it.isEssay) return false;
    if (blacklist && blacklist.test(it.subject + ' ' + it.title)) return false;
    return true;
  });
}

/** Fallback: danh sách khóa của lớp học sinh. */
async function listClassCourses(token, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const apiBase = opts.apiBase || API_BASE;
  const perPage = opts.perPage || 100;
  const body = await getJson(fetchImpl, `${apiBase}/h5p/courses/class?page_id=1&per_page=${perPage}`, token, opts.timeoutMs);
  return (body && body.data && body.data.h5p_courses) || [];
}

/** Fallback: bài của 1 khóa (theo UUID). */
async function listContents(token, courseUuid, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const apiBase = opts.apiBase || API_BASE;
  const url = `${apiBase}/h5p/contents?page_id=1&per_page=-1&class_id=0&subject_id=0&chapter_id=0&lesson_id=0&course_id=${encodeURIComponent(courseUuid)}&title=&mode=-1&part_id=-1&user_id=0`;
  const body = await getJson(fetchImpl, url, token, opts.timeoutMs);
  return (body && body.data && body.data.h5p_contents) || [];
}

/** Quét toàn bộ bài được giao. Trả { items, todo, summary, studentName }. */
async function scanAll(token, opts = {}) {
  const logger = opts.logger || (() => {});
  const { items, summary, studentName } = await listAssigned(token, opts);
  const todo = filterTodo(items, opts);
  logger(`👤 Học sinh: ${studentName || '(không rõ)'}`);
  logger(`📋 Được giao: ${items.length} bài — cần làm: ${todo.length}`);
  if (summary && summary.overdue) logger(`   ⏰ Quá hạn: ${summary.overdue.total} | Sắp hạn: ${(summary.dueSoon || {}).total || 0} | Mới: ${(summary.new || {}).total || 0}`);
  return { items, todo, summary, studentName };
}

module.exports = {
  API_BASE, WEB_BASE, TODO_STATUSES, DEFAULT_BLACKLIST,
  hexToUuid, authHeaders, normalizeItem, videoUrl,
  listAssigned, filterTodo, listClassCourses, listContents, scanAll,
};
