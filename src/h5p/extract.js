'use strict';
/**
 * extract.js — Trích xuất đáp án đúng từ H5PIntegration jsonContent.
 * Thuần logic (không cần browser). Đã reverse-engineer từ lms360.vn.
 * Xem docs/H5P-ANSWER-MAP.md để biết nguồn gốc từng field.
 */

/** Parse an toàn: chấp nhận string JSON hoặc object. */
function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (_) { return null; } }
  return null;
}

/** Bảng named entity Latin-1 + ký tự đặc biệt hay gặp (tiếng Việt, toán, dấu câu). */
const NAMED_ENTITIES = {
  quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ',
  iexcl: '\u00A1', cent: '\u00A2', pound: '\u00A3', curren: '\u00A4', yen: '\u00A5',
  brvbar: '\u00A6', sect: '\u00A7', uml: '\u00A8', copy: '\u00A9', ordf: '\u00AA',
  laquo: '\u00AB', not: '\u00AC', shy: '\u00AD', reg: '\u00AE', macr: '\u00AF',
  deg: '\u00B0', plusmn: '\u00B1', sup2: '\u00B2', sup3: '\u00B3', acute: '\u00B4',
  micro: '\u00B5', para: '\u00B6', middot: '\u00B7', cedil: '\u00B8', sup1: '\u00B9',
  ordm: '\u00BA', raquo: '\u00BB', frac14: '\u00BC', frac12: '\u00BD', frac34: '\u00BE',
  iquest: '\u00BF', times: '\u00D7', divide: '\u00F7',
  Agrave: '\u00C0', Aacute: '\u00C1', Acirc: '\u00C2', Atilde: '\u00C3', Auml: '\u00C4',
  Aring: '\u00C5', AElig: '\u00C6', Ccedil: '\u00C7', Egrave: '\u00C8', Eacute: '\u00C9',
  Ecirc: '\u00CA', Euml: '\u00CB', Igrave: '\u00CC', Iacute: '\u00CD', Icirc: '\u00CE',
  Iuml: '\u00CF', ETH: '\u00D0', Ntilde: '\u00D1', Ograve: '\u00D2', Oacute: '\u00D3',
  Ocirc: '\u00D4', Otilde: '\u00D5', Ouml: '\u00D6', Oslash: '\u00D8', Ugrave: '\u00D9',
  Uacute: '\u00DA', Ucirc: '\u00DB', Uuml: '\u00DC', Yacute: '\u00DD', THORN: '\u00DE',
  szlig: '\u00DF', agrave: '\u00E0', aacute: '\u00E1', acirc: '\u00E2', atilde: '\u00E3',
  auml: '\u00E4', aring: '\u00E5', aelig: '\u00E6', ccedil: '\u00E7', egrave: '\u00E8',
  eacute: '\u00E9', ecirc: '\u00EA', euml: '\u00EB', igrave: '\u00EC', iacute: '\u00ED',
  icirc: '\u00EE', iuml: '\u00EF', eth: '\u00F0', ntilde: '\u00F1', ograve: '\u00F2',
  oacute: '\u00F3', ocirc: '\u00F4', otilde: '\u00F5', ouml: '\u00F6', oslash: '\u00F8',
  ugrave: '\u00F9', uacute: '\u00FA', ucirc: '\u00FB', uuml: '\u00FC', yacute: '\u00FD',
  thorn: '\u00FE', yuml: '\u00FF',
  ldquo: '\u201C', rdquo: '\u201D', lsquo: '\u2018', rsquo: '\u2019',
  hellip: '\u2026', mdash: '\u2014', ndash: '\u2013', trade: '\u2122',
};

/** Giải mã HTML entities (numeric hex/dec + named Latin-1 + đặc biệt). */
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch (_) { return _; }
    })
    .replace(/&#(\d+);/g, (_, d) => {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch (_) { return _; }
    })
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => (NAMED_ENTITIES[name] !== undefined ? NAMED_ENTITIES[name] : m));
}

/** Bỏ dấu tiếng Việt + ký tự Latin có dấu, để so khớp đáp án robust hơn. */
function deburr(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '') // dấu kết hợp
    .replace(/\u0111/g, 'd').replace(/\u0110/g, 'D'); // đ/Đ
}

/** Bỏ tag HTML, giải entity, gộp khoảng trắng. */
function stripHtml(s) {
  if (s == null) return '';
  return decodeEntities(
    String(s).replace(/<[^>]*>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

// ── MultiChoice / SingleChoiceSet / TrueFalse ────────────────────────────
function extractChoice(params) {
  const answers = params.answers || [];
  const correctIdx = [];
  answers.forEach((a, i) => { if (a && a.correct) correctIdx.push(i); });
  return {
    kind: 'choice',
    options: answers.map(a => stripHtml(a && a.text)),
    correctIndexes: correctIdx,
    correctTexts: correctIdx.map(i => stripHtml(answers[i] && answers[i].text)),
  };
}

// ── TrueFalse (params.correct = "true"/"false", KHÔNG phải answers[]) ──────
function extractTrueFalse(params) {
  // Dạng cũ (một số bản) có answers[] -> tái dùng extractChoice.
  if (Array.isArray(params.answers) && params.answers.length) return extractChoice(params);
  const l10n = params.l10n || {};
  const trueText = stripHtml(l10n.trueText || 'Đúng');
  const falseText = stripHtml(l10n.falseText || 'Sai');
  const correct = String(params.correct) === 'true';
  return {
    kind: 'choice',
    options: [trueText, falseText],
    correctIndexes: [correct ? 0 : 1],
    correctTexts: [correct ? trueText : falseText],
    trueFalse: true,
  };
}

// ── Blanks / DragText / MarkTheWords ─────────────────────────────────────
function extractStarAnswers(text) {
  const matches = []; const re = /\*([^*]+)\*/g; let m;
  while ((m = re.exec(text)) !== null) matches.push(m[1].trim());
  return matches;
}
function extractBlanks(params) {
  let answers = extractStarAnswers(params.text || '');
  if ((!answers || !answers.length) && Array.isArray(params.questions)) {
    for (const seg of params.questions) {
      if (typeof seg === 'string') {
        const s = extractStarAnswers(seg); if (s.length) answers.push(...s);
      } else if (seg && typeof seg === 'object') {
        const acc = seg.acceptedAnswers || seg.answers || seg.alternatives;
        if (Array.isArray(acc)) acc.forEach(a => {
          const t = typeof a === 'string' ? a : (a && (a.answer || a.text));
          if (t) answers.push(stripHtml(t));
        });
      }
    }
  }
  return { kind: 'blanks', answers };
}

// ── DragQuestion (kéo thả) ───────────────────────────────────────────────
function extractDragQuestion(params) {
  const task = (params.question || {}).task || {};
  const norm = (arr) => {
    if (!arr) return [];
    if (typeof arr === 'string') { const p = parseJson(arr); return Array.isArray(p) ? p : []; }
    if (Array.isArray(arr)) return arr.map(e => parseJson(e) || e);
    return [];
  };
  const els = norm(task.elements);
  const dzs = norm(task.dropZones);
  const elText = els.map(e => stripHtml(e && e.type && e.type.params && e.type.params.text));
  const zones = dzs.map(dz => ({
    correctElements: (dz && dz.correctElements) || [],
    x: dz && dz.x, y: dz && dz.y,
    correctTexts: ((dz && dz.correctElements) || []).map(idx => elText[Number(idx)]).filter(Boolean),
  }));
  return { kind: 'dragquestion', elements: elText, zones };
}

// ── Summary ──────────────────────────────────────────────────────────────
function extractSummary(params) {
  const out = [];
  (params.summaries || []).forEach((sum) => {
    (sum.subContents || []).forEach((sc) => {
      out.push({
        subContentId: sc.subContentId,
        correctText: stripHtml(sc.correctText || ''),
        incorrectText: stripHtml(sc.incorrectText || ''),
      });
    });
  });
  return { kind: 'summary', rows: out };
}

// ── SpeakTheWords / GuessTheAnswer ───────────────────────────────────────
function extractSpeakGuess(params) {
  const correct = [];
  (params.answers || []).forEach((a) => {
    if (a && (a.correct || a.solution)) correct.push(stripHtml(a.solution || a.text || a.answer));
  });
  return { kind: 'speakguess', answers: correct };
}

// ── SingleChoiceSet (params.choices[].answers[].correct) ─────────────────
function extractSingleChoiceSet(params) {
  const choices = params.choices || [];
  const out = choices.map((ch) => {
    const answers = ch.answers || ch.alternatives || [];
    return {
      question: stripHtml(ch.question || ''),
      answers: answers.map((a) => ({ text: stripHtml(a && a.text), correct: !!(a && a.correct) })),
    };
  });
  const correctTexts = [];
  out.forEach((ch) => ch.answers.forEach((a) => { if (a.correct) correctTexts.push(a.text); }));
  // Fallback: nếu vì lý do nào đó không có correct, lấy text các đáp án.
  if (!correctTexts.length) out.forEach((ch) => ch.answers.slice(0, 1).forEach((a) => correctTexts.push(a.text)));
  return { kind: 'choice', choices: out, correctTexts, options: out.flatMap((ch) => ch.answers.map((a) => a.text)) };
}

// ── Router theo library ──────────────────────────────────────────────────
const ROUTER = {
  'H5P.MultiChoice': extractChoice,
  'H5P.SingleChoiceSet': extractSingleChoiceSet,
  'H5P.TrueFalse': extractTrueFalse,
  'H5P.Blanks': extractBlanks,
  'H5P.DragText': extractBlanks,
  'H5P.MarkTheWords': extractBlanks,
  'H5P.DragQuestion': extractDragQuestion,
  'H5P.Summary': extractSummary,
  'H5P.SpeakTheWordsSet': extractSpeakGuess,
  'H5P.GuessTheAnswer': extractSpeakGuess,
};

function extractAnswers(library, jsonContent) {
  const data = parseJson(jsonContent);
  if (!data) return null;
  const params = data.params || data;
  const base = (library || '').replace(/\s+\d+\.\d+.*$/, '').trim();
  const fn = ROUTER[base];
  if (fn) { try { return fn(params); } catch (e) { return { kind: 'error', error: String(e && e.message) }; } }
  return null;
}

module.exports = {
  extractAnswers, extractChoice, extractTrueFalse, extractBlanks, extractDragQuestion,
  extractSummary, extractSpeakGuess, stripHtml, decodeEntities, deburr, parseJson,
};
