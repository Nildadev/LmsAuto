'use strict';
/**
 * debug-blanks.js — Test BLANKS solver trên bài thật (QuestionSet TUẦN5 - Toán).
 * Điền đáp án vào input câu 0 -> bấm Check -> đọc kết quả correct/wrong.
 * Dùng: node scripts/debug-blanks.js
 */
const { launch, sleep } = require('../src/core/stealth');
const { readAnswers, findPlayerFrame } = require('../src/h5p/answers');
const { solveOne, pressCheck } = require('../src/h5p/solver');
const { dismissAll } = require('../src/core/dismiss');
const { resolveToken } = require('./_token');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// Bài QuestionSet Toán - có Blanks 1.14 (10 đáp án dạng *...*)
const CID = '0180b630-ab8e-4e1d-9e36-ad762df7189d';
const CS = '6a92f77e-796c-48e2-9e25-6a24f972061c';

(async () => {
  if (!token) { console.error('NO TOKEN'); process.exit(2); }
  const url = `https://lms360.vn/xem-video?p=${CID}&c=${CID}&cs=${CS}`;
  log('OPEN', url);

  const token = await resolveToken();
  const { browser, context, page } = await launch({ headless: true, token });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await sleep(5000);
    await dismissAll(page);
    await sleep(800);

    const answers = await readAnswers(page, 25000);
    const qs = answers.find(a => a.kind === 'questionset');
    if (!qs) { log('❌ Không phải QuestionSet'); return; }
    log('QuestionSet:', qs.sub.length, 'câu');

    // Tìm câu Blanks đầu tiên và đếm đáp án
    const blankIdx = qs.sub.findIndex(s => s.extracted && s.extracted.kind === 'blanks');
    log('Câu Blanks đầu tiên ở index:', blankIdx);
    const firstBlank = qs.sub[blankIdx];
    log('  đáp án:', JSON.stringify(firstBlank.extracted.answers));

    const frame = await findPlayerFrame(page, 10000);
    if (!frame) { log('❌ Không tìm thấy frame H5P'); return; }

    // QuestionSet: nếu câu Blanks không phải câu đang hiện, bấm Next tới đó
    const curInputs = await frame.locator('input.h5p-text-input:visible').count();
    log('Input visible hiện tại:', curInputs);

    // Điền + check câu đang hiện
    log('--- Solve câu hiện tại (kind =', firstBlank.extracted.kind, ') ---');
    const r = await solveOne(frame, firstBlank, log);
    log('  solveOne =>', JSON.stringify(r));

    // Verify các input đã điền
    const filled = await frame.evaluate(() =>
      [...document.querySelectorAll('input.h5p-text-input')]
        .filter(e => e.offsetParent !== null)
        .map(e => e.value));
    log('  giá trị input sau khi điền:', JSON.stringify(filled));

    await sleep(500);
    const pressed = await pressCheck(frame, log);
    log('  pressCheck =>', pressed);
    await sleep(1800);

    const score = await frame.evaluate(() => {
      const correct = document.querySelectorAll('.h5p-correct').length;
      const wrong = document.querySelectorAll('.h5p-wrong').length;
      const bar = document.querySelector('.h5p-score-bar-progress, .h5p-joubelui-score-bar-progress');
      const barW = bar ? (bar.style.width || '') : null;
      const scoreText = (document.querySelector('.h5p-score-number, .h5p-joubelui-score-number') || {}).innerText || '';
      return { correct, wrong, barW, scoreText };
    }).catch(() => ({}));
    log('  KẾT QUẢ:', JSON.stringify(score));

    await page.screenshot({ path: '/tmp/debug-blanks.png' });
    log('DONE. Screenshot: /tmp/debug-blanks.png');
    // Đánh dấu pass/fail cho automation
    const ok = score.correct >= 1 && score.wrong === 0;
    log(ok ? '✅ PASS' : '❌ FAIL/partial');
    process.exitCode = ok ? 0 : 1;
  } catch (e) {
    log('FATAL', e.message);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
})();
