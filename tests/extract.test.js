'use strict';
/**
 * Test offline cho extract.js — dùng dữ liệu THẬT đã dump từ lms360.vn
 * (docs/sample-questionset-answers.json: 1 QuestionSet gồm 12 câu con).
 * Chạy: node tests/extract.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { extractAnswers } = require('../src/h5p/extract');

const SAMPLE = path.join(__dirname, '..', 'docs', 'sample-questionset-answers.json');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

// ── Test 1: parse QuestionSet thật, đếm sub-question theo library ──
check('QuestionSet sample: parse + 12 câu con', () => {
  const raw = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  assert.strictEqual(Array.isArray(raw), true, 'outer phải là array');
  const qs = JSON.parse(raw[0]); // jsonContent là string JSON
  assert.ok(qs.questions, 'phải có questions[]');
  assert.strictEqual(qs.questions.length, 12, 'phải có 12 câu con');
  assert.strictEqual(qs.passPercentage, 50);
});

check('MultiChoice: tìm đúng đáp án correct=true', () => {
  const raw = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  const qs = JSON.parse(raw[0]);
  const mc = qs.questions.find(q => /MultiChoice/.test(q.library));
  assert.ok(mc, 'phải có ít nhất 1 MultiChoice');
  const r = extractAnswers(mc.library, { params: mc.params });
  assert.strictEqual(r.kind, 'choice');
  assert.ok(r.correctIndexes.length >= 1, 'phải có ít nhất 1 đáp án đúng');
  // đáp án correct phải khớp với correctIndexes
  r.correctIndexes.forEach(i => assert.strictEqual(mc.params.answers[i].correct, true));
});

check('Blanks: trích được đáp án từ token *...*', () => {
  const raw = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  const qs = JSON.parse(raw[0]);
  const bl = qs.questions.find(q => /Blanks/.test(q.library));
  assert.ok(bl, 'phải có Blanks');
  const r = extractAnswers(bl.library, { params: bl.params });
  assert.strictEqual(r.kind, 'blanks');
  assert.ok(r.answers.length >= 1, 'phải trích được ít nhất 1 đáp án');
  // đáp án đầu phải là số (hệ số a) — dữ liệu thật có -3, 4, 2, 0...
  assert.ok(r.answers.every(a => a.length > 0), 'đáp án không rỗng');
});

check('DragQuestion: map dropZone -> element text', () => {
  const raw = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  const qs = JSON.parse(raw[0]);
  const dq = qs.questions.find(q => /DragQuestion/.test(q.library));
  assert.ok(dq, 'phải có DragQuestion');
  const r = extractAnswers(dq.library, { params: dq.params });
  assert.strictEqual(r.kind, 'dragquestion');
  assert.ok(r.elements.length >= 2, 'phải có >=2 elements');
  assert.ok(r.zones.length >= 1, 'phải có >=1 dropZone');
  assert.ok(r.zones.some(z => z.correctTexts.length >= 1), 'mỗi zone phải map được text đúng');
});

// ── Test đơn vị cho từng dạng (synthetic, để chắc chắn router đúng) ──
check('TrueFalse: answers[].correct', () => {
  const r = extractAnswers('H5P.TrueFalse 1.8', { params: { answers: [
    { text: 'Đúng', correct: false }, { text: 'Sai', correct: true }] } });
  assert.deepStrictEqual(r.correctIndexes, [1]);
  assert.deepStrictEqual(r.correctTexts, ['Sai']);
});

check('jsonContent dạng string cũng parse được', () => {
  const r = extractAnswers('H5P.MultiChoice 1.16', JSON.stringify({ params: { answers: [
    { text: 'A', correct: true }, { text: 'B', correct: false }] } }));
  assert.strictEqual(r.kind, 'choice');
  assert.deepStrictEqual(r.correctTexts, ['A']);
});

check('Library không hỗ trợ -> null', () => {
  const r = extractAnswers('H5P.UnknownLib 1.0', { params: {} });
  assert.strictEqual(r, null);
});

check('DragText: đáp án từ params.textField (token *...*)', () => {
  const r = extractAnswers('H5P.DragText 1.9', { params: { textField: 'Tôi *yêu* màu *xanh*.' } });
  assert.strictEqual(r.kind, 'blanks');
  assert.deepStrictEqual(r.answers, ['yêu', 'xanh']);
});

check('SingleChoiceSet: correctTexts từ choices[].answers[].correct', () => {
  const r = extractAnswers('H5P.SingleChoiceSet 1.11', { params: { choices: [
    { question: 'Q1', answers: [{ text: 'A', correct: false }, { text: 'B', correct: true }] },
    { question: 'Q2', answers: [{ text: 'C', correct: true }, { text: 'D', correct: false }] },
  ] } });
  assert.strictEqual(r.kind, 'choice');
  assert.deepStrictEqual(r.correctTexts, ['B', 'C']);
});

console.log(`\nKết quả: ${passed} pass, ${failed} fail`);
process.exit(failed ? 1 : 0);
