'use strict';
/**
 * doc.js — Xử lý bài "TÀI LIỆU ĐÍNH KÈM" dạng file (.pptx/.pdf/.doc/.docx...).
 *
 * Đây KHÔNG phải H5P (không có .h5p-* container, không có câu hỏi/đáp án).
 * Trên web, mỗi file có nút "mắt" (xem). Bấm nút đó mở viewer và đánh dấu hoàn
 * thành -> bài chuyển trạng thái "đã học" (status:3 trong learn_status).
 *
 * Đã reverse trực tiếp (bắt network + grep JS bundle 3469/8071/6841):
 *
 *   POST /api/gd/v3/h5p/view_h5p_content   { h5p_content_id, content_id:"" }
 *     -> CHỈ tăng lượt xem (total_view), KHÔNG đổi trạng thái hoàn thành.
 *
 *   POST /api/gd/v3/h5p/contents/learn_status
 *        { h5p_content_id, status:3, h5p_course_id }
 *     -> GHI NHẬN HOÀN THÀNH (status 0->3). Đây là endpoint đánh dấu hoàn thành.
 *
 * Header bắt buộc: authorization: <JWT> (raw, KHÔNG kèm "Bearer ").
 * Chỉ cần gọi learn_status(status=3) là đủ để "hoàn thành" — không cần tải/đọc
 * nội dung file, không cần mở viewer. Nhanh và không tốn băng thông.
 */
const { sleep } = require('../core/stealth');

/** Đánh dấu đã xem 1 phần tài liệu (chỉ tăng view, không đổi status). Dùng khi cần "lượt xem". */
async function viewH5pContent(token, h5pContentId, contentId, logger, opts = {}) {
  const url = `${opts.apiBase || 'https://lms360.vn/api/gd/v3'}/h5p/view_h5p_content`;
  const body = JSON.stringify({ h5p_content_id: h5pContentId, content_id: contentId || '' });
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: token, 'Content-Type': 'application/json' },
      body,
      signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    });
    const text = await res.text().catch(() => '');
    logger && logger(`  👁️  view_h5p_content -> ${res.status} ${text.slice(0, 60)}`);
    return { ok: res.ok, status: res.status, body: text };
  } catch (e) {
    logger && logger(`  👁️  view_h5p_content lỗi: ${String(e && e.message).slice(0, 80)}`);
    return { ok: false, status: 0, body: String(e && e.message || e) };
  }
}

/**
 * Đánh dấu HOÀN THÀNH 1 nội dung (status=3) trong learn_status.
 * @returns {Promise<{ok:boolean, status:number, body:string}>}
 */
async function markComplete(token, h5pContentId, h5pCourseId, logger, opts = {}) {
  const url = `${opts.apiBase || 'https://lms360.vn/api/gd/v3'}/h5p/contents/learn_status`;
  const body = JSON.stringify({ h5p_content_id: h5pContentId, status: 3, h5p_course_id: h5pCourseId });
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: token, 'Content-Type': 'application/json' },
      body,
      signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    });
    const text = await res.text().catch(() => '');
    logger && logger(`  ✅ mark_complete(status=3) -> ${res.status} ${text.slice(0, 60)}`);
    return { ok: res.ok, status: res.status, body: text };
  } catch (e) {
    logger && logger(`  ✅ mark_complete lỗi: ${String(e && e.message).slice(0, 80)}`);
    return { ok: false, status: 0, body: String(e && e.message || e) };
  }
}

/**
 * Liệt kê TÀI LIỆU (type=1) của 1 khóa. Đây là danh sách hiển thị ở panel
 * "TÀI LIỆU ĐÍNH KÈM" trên trang /xem-video và ở trang /danh-sach-tai-lieu-hs.
 *   GET /h5p/contents?...&course_id=<CS>&mode=2&part_id=-1&...&type=1
 * Mỗi phần tử: { id (=h5p_content_id), type:1, title, uri, content_id:"" }.
 * @returns {Promise<Array>} mảng tài liệu (rỗng nếu lỗi/không có).
 */
async function listCourseDocs(token, courseId, opts = {}) {
  if (!courseId) return [];
  const apiBase = opts.apiBase || 'https://lms360.vn/api/gd/v3';
  const url = `${apiBase}/h5p/contents?page_id=1&per_page=-1&class_id=0&subject_id=0&chapter_id=0`
    + `&lesson_id=0&course_id=${encodeURIComponent(courseId)}&title=&mode=2&part_id=-1&user_id=0&type=1`;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  try {
    const res = await fetchImpl(url, {
      headers: { authorization: token },
      signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    });
    const text = await res.text().catch(() => '');
    let body; try { body = JSON.parse(text); } catch (_) { return []; }
    return (body && body.data && body.data.h5p_contents) || [];
  } catch (_) { return []; }
}

/**
 * Xử lý 1 bài dạng file tài liệu: gọi view (tăng lượt xem) rồi mark hoàn thành.
 * @param {object}   item  bài đã normalize từ scan.js (.p=h5pContentId, .c=contentId, .cs=courseId)
 * @param {string}   token JWT
 * @param {function} logger
 */
async function solveDoc(item, token, logger, opts = {}) {
  const p = item.p || (item.raw && item.raw.h5pContentId);
  const c = item.c || (item.raw && item.raw.contentId) || '';
  const cs = item.cs || (item.raw && item.raw.h5pCourseId) || '';
  const sleepFn = opts.sleep || sleep;
  if (!p) return { solved: false, reason: 'doc-missing-id', kind: 'doc' };

  // 1) "Bấm nút mắt" — tăng lượt xem. Với tài liệu, ĐÂY là hành động được tính
  //    "đã xem" (giống hệt nút Xem tài liệu trên web).
  const v = opts.view !== false
    ? await viewH5pContent(token, p, c, logger, opts)
    : { ok: true, status: 0 };
  // 2) Đánh dấu hoàn thành qua learn_status (best-effort): một số tài liệu API trả
  //    400 (invalid_parameter/rate-limit) dù đã "xem" — không vì thế mà báo lỗi.
  let r = await markComplete(token, p, cs, logger, opts);
  if (!r.ok && r.status === 400 && v && v.ok) {
    await sleepFn(900 + Math.floor(Math.random() * 600)); // backoff nhẹ rồi thử lại 1 lần
    r = await markComplete(token, p, cs, logger, opts);
  }

  await sleepFn(opts.dwellMs || 600); // nghỉ nhỏ cho tự nhiên
  const solved = !!(r.ok || (v && v.ok)); // view OK cũng coi như xong (tài liệu)
  return { solved, viewed: !!(v && v.ok), marked: !!r.ok, status: r.status, kind: 'doc', p, c, cs };
}

module.exports = { viewH5pContent, markComplete, listCourseDocs, solveDoc };
