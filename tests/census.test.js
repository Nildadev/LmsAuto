'use strict';
/**
 * Test offline cho src/core/census.js — probe CHỈ ĐỌC window.H5PIntegration
 * để lập ma trận coverage (library nào đang nợ, dạng nào chưa giải được).
 * Dữ liệu mô phỏng theo shape thật của lms360.vn (jsonContent là CHUỖI).
 * Chạy: node tests/census.test.js
 */
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { probeIntegration, walkLibraries, summarizeCensus, writeCensusFile } = require('../src/core/census');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

/** Dựng H5PIntegration giả: jsonContent là CHUỖI (giống thật). */
function integ(...entries) {
  const contents = {};
  entries.forEach((e, i) => {
    contents[`cid-${i + 1}`] = {
      library: e.library,
      jsonContent: e.json === undefined ? undefined : JSON.stringify(e.json),
    };
  });
  return { contents };
}

const mc = (answers, extra) => ({
  library: 'H5P.MultiChoice 1.16',
  params: Object.assign({ question: '<p>câu hỏi</p>', answers }, extra || {}),
});
const textAns = (t, correct) => ({ text: `<p>${t}</p>`, correct: !!correct });
const imgAns = (correct) => ({ text: '', correct: !!correct, image: { path: 'images/image-abc123.png' } });

// ── walkLibraries: histogram library lồng (giữ số lần xuất hiện) ──
check('walkLibraries: Column chứa 2 MultiChoice -> đếm đủ 2, không sót library cha', () => {
  const json = {
    library: 'H5P.Column 1.18',
    content: [
      { action: mc([textAns('a', true)]) },
      { action: mc([textAns('b', true)]) },
    ],
  };
  const libs = walkLibraries(json);
  assert.equal(libs.filter((l) => l === 'H5P.MultiChoice 1.16').length, 2);
  assert.ok(libs.includes('H5P.Column 1.18'), 'phải có library gốc của node');
});

check('walkLibraries: không ném lỗi với json rỗng/không phải object', () => {
  assert.deepEqual(walkLibraries(null), []);
  assert.deepEqual(walkLibraries({}), []);
});

// ── probeIntegration: QuestionSet + câu đáp án chỉ có ẢNH ──
check('probeIntegration: QuestionSet 3 câu -> kind questionset, questionCount 3, passPercentage đọc đúng', () => {
  const r = probeIntegration(integ({
    library: 'H5P.QuestionSet 1.20',
    json: {
      passPercentage: 50,
      questions: [
        mc([textAns('a', true)]),
        mc([textAns('b', true)]),
        mc([textAns('c', true)]),
      ],
    },
  }));
  assert.equal(r.kind, 'questionset');
  assert.equal(r.questionCount, 3);
  assert.equal(r.passPercentage, 50);
  assert.equal(r.libs['H5P.QuestionSet 1.20'], 1);
  assert.equal(r.libs['H5P.MultiChoice 1.16'], 3);
});

check('probeIntegration: đáp án là ẢNH (text rỗng) -> cờ imageOnlyAnswers=true', () => {
  const r = probeIntegration(integ({
    library: 'H5P.MultiChoice 1.16',
    json: { question: '<p>chọn hình</p>', answers: [textAns('a', true), imgAns(false)] },
  }));
  assert.equal(r.flags.imageOnlyAnswers, true);
});

check('probeIntegration: câu ĐÚNG là ảnh -> cờ imageOnlyCorrect=true (dạng không thể xác nhận bằng chữ)', () => {
  const r = probeIntegration(integ({
    library: 'H5P.MultiChoice 1.16',
    json: { question: '<p>chọn hình</p>', answers: [imgAns(true), textAns('a', false)] },
  }));
  assert.equal(r.flags.imageOnlyCorrect, true);
});

check('probeIntegration: toàn bộ đáp án là chữ -> KHÔNG báo cờ ảnh', () => {
  const r = probeIntegration(integ({
    library: 'H5P.MultiChoice 1.16',
    json: { question: '<p>ok</p>', answers: [textAns('a', true), textAns('b', false)] },
  }));
  assert.equal(r.flags.imageOnlyAnswers, false);
  assert.equal(r.flags.imageOnlyCorrect, false);
});

// ── probeIntegration: video YouTube trong InteractiveVideo ──
check('probeIntegration: IV nguồn YouTube (mime video/YouTube) -> youtubeVideo=true, kind iv', () => {
  const r = probeIntegration(integ({
    library: 'H5P.InteractiveVideo 1.27',
    json: {
      interactiveVideo: {
        video: { videoFiles: [{ path: 'https://youtu.be/xyz', mime: 'video/YouTube' }] },
        assets: { interactions: [] },
      },
    },
  }));
  assert.equal(r.kind, 'iv');
  assert.equal(r.flags.youtubeVideo, true);
});

check('probeIntegration: IV nguồn mp4 nội bộ -> youtubeVideo=false nhưng hasVideo=true', () => {
  const r = probeIntegration(integ({
    library: 'H5P.InteractiveVideo 1.27',
    json: {
      interactiveVideo: {
        video: { videoFiles: [{ path: 'videos/video-xGYtA2MP.mp4', mime: 'video/mp4' }] },
        assets: { interactions: [] },
      },
    },
  }));
  assert.equal(r.flags.youtubeVideo, false);
  assert.equal(r.flags.hasVideo, true);
});

// ── probeIntegration: library chưa hỗ trợ ──
check('probeIntegration: liệt kê đúng library CHƯA hỗ trợ, không lẫn library đã hỗ trợ', () => {
  const r = probeIntegration(integ({
    library: 'H5P.CoursePresentation 1.26',
    json: {
      presentation: {
        slides: [
          { elements: [{ action: { library: 'H5P.SpeakTheWordsSet 1.6', params: {} } }] },
          { elements: [{ action: { library: 'H5P.Dialogcards 1.9', params: {} } }] },
          { elements: [{ action: mc([textAns('a', true)]) }] },
        ],
      },
    },
  }));
  assert.deepEqual(r.flags.unsupported.sort(), ['H5P.Dialogcards', 'H5P.SpeakTheWordsSet']);
});

check('probeIntegration: bài chỉ có dạng đã hỗ trợ -> unsupported rỗng', () => {
  const r = probeIntegration(integ({
    library: 'H5P.MultiChoice 1.16',
    json: { question: '<p>ok</p>', answers: [textAns('a', true)] },
  }));
  assert.deepEqual(r.flags.unsupported, []);
});

// ── probeIntegration: cờ xáo trộn (nguyên nhân bug khớp sai câu) ──
check('probeIntegration: randomQuestions + randomAnswers -> đọc đúng cả hai cờ', () => {
  const r = probeIntegration(integ({
    library: 'H5P.QuestionSet 1.20',
    json: {
      randomQuestions: true,
      questions: [mc([textAns('a', true)], { randomAnswers: true })],
    },
  }));
  assert.equal(r.flags.randomQuestions, true);
  assert.equal(r.flags.randomAnswers, true);
});

// ── probeIntegration: tài liệu/không có jsonContent ──
check('probeIntegration: content không có jsonContent -> kind doc, không ném lỗi', () => {
  const r = probeIntegration(integ({ library: 'H5P.Image 1.1' }));
  assert.equal(r.kind, 'doc');
  assert.equal(r.questionCount, 0);
});

check('probeIntegration: H5PIntegration rỗng/không có contents -> không ném lỗi', () => {
  const r = probeIntegration({});
  assert.equal(r.contents.length, 0);
  assert.equal(r.kind, 'unknown');
  assert.deepEqual(r.libs, {});
});

// ── probeIntegration: nhiều content trong 1 trang ──
check('probeIntegration: nhiều content -> gộp libs, cộng questionCount, OR các cờ', () => {
  const r = probeIntegration(
    integ(
      { library: 'H5P.QuestionSet 1.20', json: { questions: [mc([textAns('a', true)]), mc([textAns('b', true)])] } },
      { library: 'H5P.MultiChoice 1.16', json: { question: '<p>x</p>', answers: [imgAns(true)] } }
    )
  );
  assert.equal(r.contents.length, 2);
  assert.equal(r.libs['H5P.MultiChoice 1.16'], 3);
  assert.equal(r.questionCount, 3);
  assert.equal(r.flags.imageOnlyCorrect, true, 'cờ ảnh phải OR lên từ content thứ 2');
});

// ── probeIntegration: 2 dạng dữ liệu THẬT lấy từ census live 22/10/2026 ──
check('probeIntegration: đáp án là thẻ <img> TRONG text HTML -> imageOnlyAnswers + imageOnlyCorrect', () => {
  const r = probeIntegration(integ({
    library: 'H5P.MultiChoice 1.16',
    json: {
      question: '<p>Công thức nào?</p>',
      answers: [
        { text: '<p><img src="https://cdn.example/image_846.png"></p>', correct: true },
        { text: '<p><img src="https://cdn.example/image_847.png"></p>', correct: false },
      ],
    },
  }));
  assert.equal(r.flags.imageOnlyAnswers, true, 'ảnh nằm trong thẻ <img> vẫn phải bị phát hiện');
  assert.equal(r.flags.imageOnlyCorrect, true, 'câu ĐÚNG là ảnh -> không xác nhận được bằng chữ');
});

check('probeIntegration: SingleChoiceSet answers là MẢNG CHUỖI -> phần tử ĐẦU là đáp án đúng', () => {
  const scs = (answers) => ({
    library: 'H5P.SingleChoiceSet 1.11',
    json: { choices: [{ question: '<p>Câu 1?</p>', answers }] },
  });
  const imgFirst = probeIntegration(integ(scs(['<p><img src="a.png"></p>', '<p>chữ</p>'])));
  assert.equal(imgFirst.flags.imageOnlyCorrect, true, 'ảnh ở vị trí 0 = đáp án đúng là ảnh');

  const imgSecond = probeIntegration(integ(scs(['<p>chữ đúng</p>', '<p><img src="b.png"></p>'])));
  assert.equal(imgSecond.flags.imageOnlyAnswers, true);
  assert.equal(imgSecond.flags.imageOnlyCorrect, false, 'ảnh ở vị trí 1 = sai, không chặn bài');
});

check('probeIntegration: SingleChoiceSet chữ thuần -> đếm 1 câu, không có cờ chặn', () => {
  const r = probeIntegration(integ({
    library: 'H5P.SingleChoiceSet 1.11',
    json: { choices: [{ question: '<p>Câu 1?</p>', answers: ['<p>B. đúng</p>', '<p>A. sai</p>'] }] },
  }));
  assert.equal(r.kind, 'single');
  assert.equal(r.questionCount, 1);
  assert.equal(r.flags.imageOnlyAnswers, false);
  assert.deepEqual(r.flags.unsupported, []);
});

// ── summarizeCensus: gộp nhiều bài thành ma trận coverage + worklist ──
const rec = (o) => Object.assign({
  title: 'bài', kind: 'single', questionCount: 0, libs: {}, ms: 0,
  flags: {
    imageOnlyAnswers: false, imageOnlyCorrect: false, youtubeVideo: false,
    hasVideo: false, hasAudio: false, randomQuestions: false, randomAnswers: false,
    unsupported: [],
  },
}, o);

const CENSUS = [
  rec({ title: 'A - sách', kind: 'book', questionCount: 5, libs: { 'H5P.CoursePresentation 1.26': 1, 'H5P.Blanks 1.14': 5 }, ms: 3000 }),
  rec({ title: 'B - video YouTube', kind: 'iv', questionCount: 2, libs: { 'H5P.InteractiveVideo 1.27': 1 }, ms: 1000, flags: { youtubeVideo: true, hasVideo: true } }),
  rec({ title: 'C - câu ảnh', kind: 'questionset', questionCount: 8, libs: { 'H5P.MultiChoice 1.16': 8 }, ms: 2000, flags: { imageOnlyAnswers: true, imageOnlyCorrect: true } }),
  rec({ title: 'D - ổn', kind: 'single', questionCount: 3, libs: { 'H5P.MultiChoice 1.16': 3 }, ms: 4000 }),
  rec({ title: 'E - nói', kind: 'single', questionCount: 1, libs: { 'H5P.SpeakTheWordsSet 1.6': 1 }, ms: 500, flags: { unsupported: ['H5P.SpeakTheWordsSet'] } }),
];

check('summarizeCensus: đếm byKind + tổng questionCount', () => {
  const s = summarizeCensus(CENSUS);
  assert.equal(s.total, 5);
  assert.deepEqual(s.byKind, { book: 1, iv: 1, questionset: 1, single: 2 });
  assert.equal(s.questions, 19);
});

check('summarizeCensus: gộp histogram library từ mọi bài', () => {
  const s = summarizeCensus(CENSUS);
  assert.equal(s.libs['H5P.MultiChoice 1.16'], 11);
  assert.equal(s.libs['H5P.Blanks 1.14'], 5);
});

check('summarizeCensus: worklist bài bị CHẶN theo từng lý do (ảnh KHÔNG còn chặn)', () => {
  const s = summarizeCensus(CENSUS);
  // Đáp án ảnh đã khớp được theo src -> chỉ là thông tin, không chặn.
  assert.deepEqual(s.imageAnswers, ['C - câu ảnh']);
  assert.deepEqual(s.blocked.youtube, ['B - video YouTube']);
  assert.deepEqual(s.blocked.unsupported, [{ title: 'E - nói', libs: ['H5P.SpeakTheWordsSet'] }]);
});

check('summarizeCensus: solvable gồm cả bài có đáp án ảnh (đã hỗ trợ khớp src)', () => {
  const s = summarizeCensus(CENSUS);
  assert.deepEqual(s.solvable, ['A - sách', 'C - câu ảnh', 'D - ổn']);
});

check('summarizeCensus: thống kê thời gian (min/median/max/total) để tối ưu tốc độ', () => {
  const s = summarizeCensus(CENSUS);
  assert.deepEqual(s.timing, { minMs: 500, medianMs: 2000, maxMs: 4000, totalMs: 10500 });
});

check('summarizeCensus: danh sách rỗng -> không ném lỗi', () => {
  const s = summarizeCensus([]);
  assert.equal(s.total, 0);
  assert.deepEqual(s.libs, {});
  assert.deepEqual(s.solvable, []);
  assert.equal(s.timing.medianMs, 0);
});

check('summarizeCensus: bài lỗi đọc (error) -> blocked.unreadable, KHÔNG nằm trong solvable', () => {
  const s = summarizeCensus([...CENSUS, rec({ title: 'F - lỗi', error: 'no-frame' })]);
  assert.deepEqual(s.blocked.unreadable, [{ title: 'F - lỗi', error: 'no-frame' }]);
  assert.ok(!s.solvable.includes('F - lỗi'), 'bài chưa đọc được không được coi là giải được');
});

// ── writeCensusFile: đường ghi docs/census-*.json mà debug-live dùng ──
check('writeCensusFile: tạo đúng census-YYYY-MM-DD.json và đọc lại được', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-census-'));
  try {
    const payload = { generatedAt: 'x', account: 'abc***', summary: { total: 1 }, records: [] };
    const out = writeCensusFile(dir, payload, new Date('2026-10-22T12:00:00Z'));
    assert.equal(path.basename(out), 'census-2026-10-22.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), payload);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n${failed === 0 ? '✅' : '❌'} census: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
