'use strict';
/**
 * schema.js — Parse jsonContent của sách online thành model thống nhất.
 * Thuần logic (không cần browser) -> dễ unit test bằng docs/sample-*.json.
 *
 * Model:
 *   { kind: 'coursepresentation'|'interactivebook',
 *     pages: [ { i, title, elements: [ {library, base, kind, params, extracted} ] } ] }
 *
 * Đã verify thực tế lms360:
 *  - CoursePresentation: slides ở jsonContent.presentation.slides[].elements[].action
 *  - InteractiveBook : chapters[].params.content[] (mỗi item bọc trong {content:{library,params}})
 */
const { extractAnswers } = require('../extract');

/** Bỏ version khỏi library: "H5P.MultiChoice 1.16" -> "H5P.MultiChoice". */
function libBase(lib) {
  return String(lib || '').replace(/\s+\d+\.\d+.*$/, '').trim();
}

/** Phân loại library -> kind nội bộ. */
function kindOf(library) {
  const b = libBase(library);
  if (/MultiChoice|SingleChoiceSet|TrueFalse/.test(b)) return 'choice';
  if (/Blanks|DragText|MarkTheWords/.test(b)) return 'blanks';
  if (/DragQuestion/.test(b)) return 'dragquestion';
  if (/Summary/.test(b)) return 'summary';
  if (/CoursePresentation/.test(b)) return 'cp';
  if (/InteractiveVideo/.test(b)) return 'iv';
  if (/Column/.test(b)) return 'column';
  if (/Image|Text|Video|Audio|AdvancedText/.test(b)) return 'media';
  return 'other';
}

/** Lấy danh sách element bên trong H5P.Column: params.content[] (bóc lớp {content:{...}}). */
function columnElements(node) {
  const arr = (node && node.params && node.params.content) || [];
  return arr.map((wrap) => {
    if (wrap && wrap.content && wrap.content.library) return wrap.content;
    return wrap;
  }).filter((x) => x && x.library);
}

/** Gắn kind + extracted vào 1 element thô. */
function annotate(el) {
  const base = libBase(el.library);
  const kind = kindOf(el.library);
  let extracted = null;
  try { extracted = extractAnswers(el.library, { params: el.params }); } catch (_) {}
  return { library: el.library, base, kind, params: el.params, extracted };
}

/** Expand 1 element: nếu là Column thì ĐỆ QUY trả về các element con (đã annotate).
 * Trước đây chỉ nới 1 cấp -> Column-lồng-Column bị bỏ câu hỏi ở cấp 2+ ÂM THẦM. */
function expand(el, depth = 0) {
  const a = annotate(el);
  if (a.kind === 'column' && depth < 4) return columnElements(el).flatMap((c) => expand(c, depth + 1));
  return [a];
}

/**
 * Parse jsonContent -> { kind, pages }.
 * @param {string|object} jsonContent
 */
function parseBook(jsonContent) {
  let j = jsonContent;
  if (typeof j === 'string') { try { j = JSON.parse(j); } catch (_) { return null; } }
  if (!j || typeof j !== 'object') return null;

  // ── CoursePresentation ──
  if (j.presentation && Array.isArray(j.presentation.slides)) {
    const pages = j.presentation.slides.map((s, i) => ({
      i,
      title: `Slide ${i + 1}`,
      // expand() (đệ quy): Column nằm TRÊN slide CP trước đây bị gộp thành 1
      // element 'column' với extracted=null -> câu hỏi bên trong bị bỏ.
      elements: (s.elements || []).map((e) => e.action).filter(Boolean).flatMap((el) => expand(el)),
    }));
    return { kind: 'coursepresentation', pages };
  }

  // ── InteractiveBook ──
  if (Array.isArray(j.chapters)) {
    const pages = j.chapters.map((ch, i) => ({
      i,
      title: (ch.metadata && ch.metadata.title) || `Chương ${i + 1}`,
      elements: columnElements(ch).flatMap(expand),
    }));
    return { kind: 'interactivebook', pages };
  }

  // ── QuestionSet (dùng cho nhánh khác) ──
  if (Array.isArray(j.questions)) {
    const pages = [{ i: 0, title: 'QuestionSet', elements: j.questions.map(annotate) }];
    return { kind: 'questionset', pages };
  }

  return null;
}

module.exports = { parseBook, libBase, kindOf, columnElements, annotate, expand };
