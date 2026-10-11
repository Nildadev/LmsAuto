'use strict';
/**
 * questionSet.js — Giải H5P.QuestionSet (và dạng composite): lặp từng câu con,
 * điền/chọn đáp án đúng (đã extract từ jsonContent), Check -> Next -> tới cuối.
 *
 * Đây là dạng phổ biến nhất (SingleChoice+MultiChoice+Blanks+Drag lồng nhau),
 * click chắc chắn từng câu nên là nguồn điểm ổn định.
 */
const { sleep } = require('../core/stealth');
const { extractAnswers } = require('./extract');
const { solveDrag } = require('./solver');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Đọc mảng câu con (questions[]) từ jsonContent trong frame. */
async function readQuestions(frame) {
  return frame.evaluate(() => {
    const c = window.H5PIntegration.contents;
    const k = Object.keys(c)[0];
    let jc = c[k].jsonContent;
    if (typeof jc === 'string') { try { jc = JSON.parse(jc); } catch (_) {} }
    return (jc.questions || []).map((q, i) => ({
      i, library: q.library, params: q.params,
      passPercentage: jc.passPercentage,
    }));
  });
}

function kindOf(library) {
  const l = library || '';
  if (/MultiChoice|SingleChoice|TrueFalse/.test(l)) return 'choice';
  if (/Blanks|DragText|MarkTheWords/.test(l)) return 'blanks';
  if (/DragQuestion/.test(l)) return 'drag';
  return 'other';
}

/** Click các đáp án choice đúng trong câu hiện tại (theo text). */
async function answerChoiceInView(frame, extracted) {
  const nodes = frame.locator('.h5p-alternative-container, .h5p-answer');
  const count = await nodes.count();
  if (!count) return { clicked: 0, total: 0 };
  const want = (extracted && extracted.correctTexts) || [];
  let clicked = 0;
  if (want.length) {
    for (const w of want) {
      const key = String(w).split(/\s+/).filter(Boolean)[0] || w;
      const node = nodes.filter({ hasText: key }).first();
      const has = await node.count().catch(() => 0);
      await (has ? node : nodes.nth(0)).click({ timeout: 3000 }).catch(() => {});
      clicked++;
    }
  } else {
    const multi = /MultiChoice/.test(extracted && extracted.library);
    const n = multi ? count : 1;
    for (let i = 0; i < n; i++) { await nodes.nth(i).click({ timeout: 3000 }).catch(() => {}); clicked++; }
  }
  return { clicked, total: count };
}

/** Điền đáp án blanks vào các input đang hiển thị. */
async function answerBlanksInView(frame, extracted) {
  const inputs = frame.locator('input.h5p-text-input:visible, .h5p-text-input');
  const n = await inputs.count();
  if (!n) return { filled: 0 };
  const answers = (extracted && extracted.answers) || [];
  for (let i = 0; i < n; i++) {
    const val = answers[i] !== undefined ? answers[i] : (answers[0] || '');
    try {
      await inputs.nth(i).click({ timeout: 2500 });
      await inputs.nth(i).fill('');
      await inputs.nth(i).type(String(val), { delay: 45 });
    } catch (_) {}
  }
  return { filled: n };
}

/** Bấm Check (nếu có) rồi Next/Show solution để sang câu kế. */
async function checkThenNext(frame) {
  // Nút kiểm tra
  const check = frame.locator('.h5p-question-check-answer:visible').first();
  if (await check.count().catch(() => 0)) { await check.click({ timeout: 2500 }).catch(() => {}); await sleep(700); }
  // Nút next (hiện sau khi check)
  const next = frame.locator('.h5p-question-next:visible, .h5p-question-show-solution:visible').first();
  if (await next.count().catch(() => 0)) { await next.click({ timeout: 2500 }).catch(() => {}); await sleep(700); return true; }
  return false;
}

/**
 * Giải toàn bộ QuestionSet: lặp từng câu -> trả lời -> check -> next.
 * @returns {Promise<{answered:number,total:number}>}
 */
async function solveQuestionSet(page, frame, logger = log) {
  const questions = await readQuestions(frame);
  if (!questions.length) { logger('QS: không đọc được câu hỏi'); return { answered: 0, total: 0 }; }
  const total = questions.length;
  logger(`QS: ${total} câu`, questions.map(q => `${q.i}:${kindOf(q.library)}`).join(' '));

  let answered = 0;
  for (let idx = 0; idx < total; idx++) {
    const q = questions[idx];
    const extracted = extractAnswers(q.library, { params: q.params });
    const kind = kindOf(q.library);

    if (kind === 'choice') {
      const r = await answerChoiceInView(frame, extracted);
      if (r.clicked) { await checkThenNext(frame); answered++; }
    } else if (kind === 'blanks') {
      const r = await answerBlanksInView(frame, extracted);
      if (r.filled) { await checkThenNext(frame); answered++; }
    } else if (kind === 'drag') {
      const full = { library: q.library, data: extracted };
      const r = await solveDrag(frame, full);
      if (r.solved) { await checkThenNext(frame); answered++; }
    } else {
      logger(`  câu ${idx + 1} (${q.library}) bỏ qua -> next`);
      const moved = await checkThenNext(frame);
      if (!moved) break;
    }
    logger(`  câu ${idx + 1}/${total} [${kind}] ok`);
  }
  return { answered, total };
}

module.exports = { solveQuestionSet, readQuestions, answerChoiceInView, answerBlanksInView, checkThenNext, kindOf };
