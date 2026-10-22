'use strict';
/**
 * census.js — probe CHỈ ĐỌC `window.H5PIntegration` để lập ma trận coverage:
 * bài đang nợ dùng library nào, dạng nào solver chưa giải được, có cờ rủi ro gì.
 *
 * KHÔNG đụng DOM, KHÔNG click, KHÔNG gọi API ghi — chỉ đọc JSON đã nhúng trong trang.
 * Dùng bởi `node scripts/debug-live.js census` (sub-project khảo sát).
 */
const fs = require('fs');
const path = require('path');
const { parseJson, stripHtml } = require('../h5p/extract');

/** Library dạng CÂU HỎI (để đếm questionCount). Không tính library chứa/wrapper. */
const QUESTION_BASES = new Set([
  'MultiChoice', 'TrueFalse', 'Blanks', 'FillBlanks', 'DragText', 'MarkTheWords',
  'DragQuestion', 'Summary', 'GuessTheAnswer', 'SingleChoiceSet',
  'SpeakTheWords', 'SpeakTheWordsSet', 'Essay', 'Questionnaire', 'ImageHotspots', 'MemoryGame',
]);

/** Library solver KHÔNG làm được -> bài chứa chúng phải làm tay (hoặc cần viết thêm). */
const UNSUPPORTED_BASES = new Set([
  'SpeakTheWords', 'SpeakTheWordsSet', 'Dialogcards', 'Flashcards', 'BranchingScenario',
  'Essay', 'Questionnaire', 'MemoryGame', 'ImageHotspots', 'Agamotto', 'ImageSlider', 'Timeline',
]);

/** Bỏ số phiên bản: "H5P.MultiChoice 1.16" -> "H5P.MultiChoice". */
const baseName = (lib) => String(lib || '').replace(/\s+\d+\.\d+.*$/, '').trim();
const shortName = (lib) => baseName(lib).replace(/^H5P\./, '');

/**
 * Duyệt đệ quy 1 cây JSON H5P, gom library + cờ rủi ro vào ctx.
 * @returns {string[]} mọi library xuất hiện (giữ trùng để đếm histogram)
 */
function walkLibraries(json) {
  const ctx = newCtx();
  visit(json, ctx, 0);
  return ctx.libs;
}

function newCtx() {
  return {
    libs: [],
    imageOnlyAnswers: false, imageOnlyCorrect: false,
    youtubeVideo: false, hasVideo: false, hasAudio: false,
    randomQuestions: false, randomAnswers: false,
  };
}

const hasImage = (img) => !!(img && (typeof img === 'string' || img.path || img.file));

function visit(node, ctx, depth) {
  if (!node || typeof node !== 'object' || depth > 40) return;
  if (Array.isArray(node)) {
    for (const v of node) visit(v, ctx, depth + 1);
    return;
  }
  if (typeof node.library === 'string' && node.library) {
    ctx.libs.push(node.library);
  }
  if (node.randomQuestions || node.randomQuestion) ctx.randomQuestions = true;
  if (node.randomAnswers || node.shuffleAnswers) ctx.randomAnswers = true;

  const mime = typeof node.mime === 'string' ? node.mime : '';
  const p = typeof node.path === 'string' ? node.path : '';
  if (mime || p) {
    if (/youtube/i.test(mime) || /youtu\.be|youtube\.com/i.test(p)) ctx.youtubeVideo = true;
    if (/^video\//i.test(mime) || /\.(mp4|webm|m4v|mov)(\?|$)/i.test(p)) ctx.hasVideo = true;
    if (/^audio\//i.test(mime) || /\.(mp3|wav|m4a|ogg)(\?|$)/i.test(p)) ctx.hasAudio = true;
  }

  // Đáp án chỉ có ẢNH (chữ rỗng sau stripHtml): solver khớp theo chữ nên KHÔNG
  // xác nhận được. Ảnh có thể nằm ở field `image` HOẶC là thẻ <img> trong text.
  // `answers` của SingleChoiceSet là MẢNG CHUỖI và phần tử ĐẦU là đáp án đúng.
  const lists = [];
  if (Array.isArray(node.answers)) lists.push(node.answers);
  if (Array.isArray(node.choices)) {
    for (const ch of node.choices) if (ch && Array.isArray(ch.answers)) lists.push(ch.answers);
  }
  for (const list of lists) {
    list.forEach((a, idx) => {
      const isObj = !!(a && typeof a === 'object');
      const raw = isObj ? (a.text || '') : (typeof a === 'string' ? a : '');
      const hasImg = (isObj && hasImage(a.image)) || /<img\b/i.test(raw);
      if (stripHtml(raw) || !hasImg) return;
      ctx.imageOnlyAnswers = true;
      if (isObj ? a.correct : idx === 0) ctx.imageOnlyCorrect = true;
    });
  }

  for (const k of Object.keys(node)) if (k !== 'library') visit(node[k], ctx, depth + 1);
}

function kindOf(library, json, questions) {
  const s = shortName(library);
  if (/^(CoursePresentation|InteractiveBook|BranchingScenario)$/.test(s)) return 'book';
  if (s === 'InteractiveVideo') return 'iv';
  if (s === 'QuestionSet') return 'questionset';
  if (!json) return 'doc';
  return questions > 0 || QUESTION_BASES.has(s) ? 'single' : 'doc';
}

const KIND_PRIORITY = ['book', 'iv', 'questionset', 'single', 'doc'];

/**
 * Phân tích toàn bộ `window.H5PIntegration` của 1 trang bài học.
 * @param {object} integration  H5PIntegration (có .contents)
 * @returns {{kind:string, contents:Array, libs:object, questionCount:number,
 *            flags:object, passPercentage:number|null}}
 */
function probeIntegration(integration) {
  const contents = (integration && integration.contents) || {};
  const records = [];
  const libs = {};
  const flags = {
    imageOnlyAnswers: false, imageOnlyCorrect: false, youtubeVideo: false,
    hasVideo: false, hasAudio: false, randomQuestions: false, randomAnswers: false,
    unsupported: [],
  };
  let questionCount = 0;
  let passPercentage = null;

  for (const key of Object.keys(contents)) {
    const c = contents[key] || {};
    const library = String(c.library || '');
    const json = parseJson(c.jsonContent);
    const ctx = newCtx();
    if (json) visit(json, ctx, 0);

    // jsonContent thật chỉ là `params` (không có `library` ở gốc) nên library của
    // content phải được cộng riêng; trừ khi json đã tự khai đúng library đó.
    const rootLib = json && typeof json.library === 'string' ? json.library : '';
    const names = library && rootLib !== library ? [library].concat(ctx.libs) : ctx.libs.slice();
    const own = {};
    for (const n of names) {
      libs[n] = (libs[n] || 0) + 1;
      own[n] = (own[n] || 0) + 1;
    }
    const questions = names.filter((n) => QUESTION_BASES.has(shortName(n))).length;
    const unsupported = [...new Set(names.filter((n) => UNSUPPORTED_BASES.has(shortName(n))).map(baseName))];

    const pp = json && typeof json.passPercentage === 'number' ? json.passPercentage : null;
    if (pp != null) passPercentage = passPercentage == null ? pp : Math.max(passPercentage, pp);

    questionCount += questions;
    for (const f of ['imageOnlyAnswers', 'imageOnlyCorrect', 'youtubeVideo', 'hasVideo', 'hasAudio', 'randomQuestions', 'randomAnswers']) {
      if (ctx[f]) flags[f] = true;
    }
    for (const u of unsupported) if (!flags.unsupported.includes(u)) flags.unsupported.push(u);

    records.push({
      key, library, kind: kindOf(library, json, questions),
      questionCount: questions, libs: own, passPercentage: pp,
      flags: {
        imageOnlyAnswers: ctx.imageOnlyAnswers, imageOnlyCorrect: ctx.imageOnlyCorrect,
        youtubeVideo: ctx.youtubeVideo, hasVideo: ctx.hasVideo, hasAudio: ctx.hasAudio,
        randomQuestions: ctx.randomQuestions, randomAnswers: ctx.randomAnswers,
        unsupported,
      },
    });
  }

  flags.unsupported.sort();
  const kind = KIND_PRIORITY.find((k) => records.some((r) => r.kind === k)) || 'unknown';
  return { kind, contents: records, libs, questionCount, flags, passPercentage };
}

/**
 * Gộp kết quả probe của NHIỀU bài thành ma trận coverage + worklist.
 * `blocked` = những bài solver hiện KHÔNG thể xác nhận đúng, kèm lý do.
 * Đáp án ẢNH không còn nằm trong blocked: solver khớp theo src ảnh (`imgKey`);
 * danh sách `imageAnswers` chỉ để theo dõi coverage.
 * @param {Array<{title:string,kind:string,questionCount:number,libs:object,flags:object,ms:number}>} records
 */
function summarizeCensus(records) {
  const list = Array.isArray(records) ? records : [];
  const byKind = {};
  const libs = {};
  const blocked = { youtube: [], unsupported: [], unreadable: [] };
  const imageAnswers = [];
  const solvable = [];
  let questions = 0;

  for (const r of list) {
    if (r && r.kind) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    questions += (r && r.questionCount) || 0;
    for (const k of Object.keys((r && r.libs) || {})) libs[k] = (libs[k] || 0) + r.libs[k];

    const f = (r && r.flags) || {};
    let isBlocked = false;
    // Bài mở/đọc H5PIntegration thất bại (no-frame/no-integration) chưa biết có
    // giải được hay không -> KHÔNG được xếp vào solvable.
    if (r && r.error) { blocked.unreadable.push({ title: r.title, error: r.error }); isBlocked = true; }
    if (f.imageOnlyCorrect) imageAnswers.push(r.title);
    if (f.youtubeVideo) { blocked.youtube.push(r.title); isBlocked = true; }
    if (Array.isArray(f.unsupported) && f.unsupported.length) {
      blocked.unsupported.push({ title: r.title, libs: f.unsupported.slice() });
      isBlocked = true;
    }
    if (!isBlocked) solvable.push(r.title);
  }

  const ms = list.map((r) => Number(r && r.ms) || 0).sort((a, b) => a - b);
  const timing = {
    minMs: ms.length ? ms[0] : 0,
    medianMs: ms.length ? ms[Math.floor(ms.length / 2)] : 0,
    maxMs: ms.length ? ms[ms.length - 1] : 0,
    totalMs: ms.reduce((a, b) => a + b, 0),
  };

  return { total: list.length, byKind, libs, questions, blocked, imageAnswers, solvable, timing };
}

/**
 * Ghi kết quả census ra `<dir>/census-YYYY-MM-DD.json`.
 * Tách khỏi debug-live để test được offline (bug 22/10/2026: script dùng fs/path
 * mà không require -> ReferenceError ngay trước khi ghi file).
 */
function writeCensusFile(dir, payload, date = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `census-${date.toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(out, JSON.stringify(payload, null, 2));
  return out;
}

module.exports = { probeIntegration, summarizeCensus, walkLibraries, writeCensusFile, baseName, QUESTION_BASES, UNSUPPORTED_BASES };
