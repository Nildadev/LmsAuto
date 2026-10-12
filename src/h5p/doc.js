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
 * Xử lý 1 bài dạng file tài liệu: gọi view (tăng lượt xem) rồi mark hoàn thành.
 * @param {object}   item  bài đã normalize từ scan.js (.p=h5pContentId, .c=contentId, .cs=courseId)
 * @param {string}   token JWT
 * @param {function} logger
 */
async function solveDoc(item, token, logger, opts = {}) {
  const p = item.p || (item.raw && item.raw.h5pContentId);
  const c = item.c || (item.raw && item.raw.contentId) || '';
  const cs = item.cs || (item.raw && item.raw.h5pCourseId) || '';
  if (!p) return { solved: false, reason: 'doc-missing-id', kind: 'doc' };

  // 1) Tăng lượt xem (giống bấm nút mắt). Không bắt buộc để hoàn thành nhưng tự nhiên hơn.
  if (opts.view !== false) await viewH5pContent(token, p, c, logger, opts);
  // 2) Đánh dấu hoàn thành (đây mới là endpoint quyết định).
  const r = await markComplete(token, p, cs, logger, opts);

  await sleep(opts.dwellMs || 600); // nghỉ nhỏ cho tự nhiên
  return { solved: r.ok, status: r.status, kind: 'doc', p, c, cs };
}

module.exports = { viewH5pContent, markComplete, solveDoc };
