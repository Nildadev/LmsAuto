'use strict';
/**
 * debug-qs.js — Test walker QuestionSet trên đề THẬT (12 câu: SC+MC+Blanks+Drag).
 * Dùng: node scripts/debug-qs.js [content_id] [course_id]
 * Mục tiêu: xem giải đúng được bao nhiêu câu -> ước tính điểm.
 */
const { launch, sleep } = require('../src/core/stealth');
const { readAnswers, findPlayerFrame } = require('../src/h5p/answers');
const { solveQuestionSet } = require('../src/h5p/solver');
const { dismissAll } = require('../src/core/dismiss');
const { resolveToken } = require('./_token');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// Mặc định: đề "TUẦN 5 - HK2 - T8" (12 câu)
const CID = process.argv[2] || '0180b630-ab8e-4e1d-9e36-ad762df7189d';
const CS = process.argv[3] || '6a92f77e-796c-48e2-9e25-6a24f972061c';

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
    await sleep(1000);

    const answers = await readAnswers(page, 25000);
    if (!answers.length) { log('❌ Không đọc được H5PIntegration'); process.exit(3); }
    log('libs:', answers.map(a => a.library + ':' + a.kind).join(' | '));
    answers.forEach(a => {
      if (a.kind === 'questionset') log('  sub types:', (a.sub || []).map(s => s.library.replace('H5P.', '').split(' ')[0]).join(','));
    });

    const frame = await findPlayerFrame(page, 10000);
    if (!frame) { log('❌ Không tìm thấy frame'); return; }

    const qs = answers.find(a => a.kind === 'questionset');
    if (!qs) {
      log('❌ Không phải QuestionSet — bài này cần flow khác. libs:', answers.map(a => a.library));
      return;
    }

    // Nếu có nút "Bắt đầu"/"Làm bài" thì bấm
    const start = frame.locator('button:has-text("Bắt đầu"), button:has-text("Start"), button:has-text("Làm bài")').first();
    if ((await start.count().catch(() => 0)) && (await start.isVisible().catch(() => false))) {
      await start.click().catch(() => {}); await sleep(1500);
    }

    log('=== BẮT ĐẦU GIẢI ===');
    const result = await solveQuestionSet(frame, qs, { logger: log, maxQuestions: 15 });
    log('=== KẾT QUẢ ===', JSON.stringify(result));
    const pct = result.total ? Math.round((result.correctCount / result.total) * 100) : 0;
    log(`Ước tính điểm: ${result.correctCount}/${result.total} đúng = ${pct}%`);
    if (result.finalScore) log('Điểm hiển thị trên H5P:', JSON.stringify(result.finalScore));

    // Thử điều hướng tới màn kết quả cuối để đọc điểm chính xác
    const { pressNext } = require('../src/h5p/solver');
    for (let i = 0; i < 4; i++) {
      const finish = frame.locator('button:has-text("Hoàn thành"), button:has-text("Nộp bài"), button:has-text("Kết thúc"), button:has-text("Finish")').first();
      if ((await finish.count().catch(() => 0)) && (await finish.isVisible().catch(() => false))) {
        log('Bấm Hoàn thành/Nộp bài'); await finish.click().catch(() => {}); await sleep(2000); break;
      }
      if (!(await pressNext(frame, log))) break;
      await sleep(1200);
    }
    const screen = await frame.evaluate(() => (document.body.innerText || '').match(/.*(\d+\s*\/\s*\d+|Kết quả|Điểm|hoàn thành).*/i)?.[0] || '').catch(() => '');
    log('Màn cuối:', screen.slice(0, 80));

    await page.screenshot({ path: '/tmp/debug-qs-result.png' });
  } catch (e) {
    log('FATAL', e.message);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
})();
