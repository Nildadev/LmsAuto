'use strict';
/**
 * test-drag.js — Verify DragQuestion solver trên bài QuestionSet THẬT (0180b630).
 * Flow: đọc answers -> điều hướng tới câu có draggable -> kéo đáp án -> Check -> đọc điểm.
 * Chạy: node scripts/test-drag.js
 */
const { launch, sleep } = require('../src/core/stealth');
const { readAnswers, findPlayerFrame } = require('../src/h5p/answers');
const { solveDrag, pressCheck } = require('../src/h5p/solver');
const { dismissAll } = require('../src/core/dismiss');
const { resolveToken } = require('./_token');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const CID = '0180b630-ab8e-4e1d-9e36-ad762df7189d';
const CS = '6a92f77e-796c-48e2-9e25-6a24f972061c';
const url = `https://lms360.vn/xem-video?p=${CID}&c=${CID}&cs=${CS}`;

(async () => {
  const token = await resolveToken();
  const { browser, context, page } = await launch({ headless: true, token });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await sleep(5000); await dismissAll(page); await sleep(800);

    const answers = await readAnswers(page, 25000);
    log('Libs:', answers.map(a => a.kind).join(','));
    // Tìm DragQuestion trong QuestionSet/book sub
    let dragExtracted = null;
    for (const a of answers) {
      const subs = a.sub || [];
      const d = subs.find(s => s.extracted && s.extracted.kind === 'dragquestion');
      if (d) { dragExtracted = { kind: 'dragquestion', library: d.library, data: d.extracted }; break; }
    }
    if (!dragExtracted) { log('❌ Không thấy DragQuestion trong answers'); process.exitCode = 3; return; }
    log('DragQuestion đáp án zones:', JSON.stringify(dragExtracted.data.zones.map(z => z.correctTexts)));

    const frame = await findPlayerFrame(page, 12000);
    if (!frame) { log('❌ Không tìm frame'); process.exitCode = 3; return; }

    // Điều hướng tới câu có draggable (check/next liên tục)
    for (let i = 0; i < 8; i++) {
      const dc = await frame.locator('.h5p-draggable:visible').count().catch(() => 0);
      if (dc > 0) { log('Gặp DragQuestion sau', i, 'lần điều hướng, draggable=', dc); break; }
      // bấm Check nếu có (một số câu cần check mới next)
      const ck = await frame.locator('.h5p-question-check-answer:visible').count().catch(() => 0);
      if (ck) { await frame.locator('.h5p-question-check-answer:visible').first().click().catch(() => {}); await sleep(600); }
      for (const sel of ['.h5p-question-next:visible', '.h5p-question-try-again:visible', '.h5p-question-buttons button:visible']) {
        const b = await frame.locator(sel).first().count().catch(() => 0);
        if (b) { await frame.locator(sel).first().click().catch(() => {}); break; }
      }
      await sleep(900);
    }

    // Kéo
    const res = await solveDrag(frame, dragExtracted, log);
    log('Kết quả kéo:', JSON.stringify(res));
    if (!res.solved) { await page.screenshot({ path: '/tmp/test-drag-fail.png' }); process.exitCode = 4; return; }

    // Check
    await sleep(500);
    const checked = await pressCheck(frame, log);
    log('Đã Check:', checked);
    await sleep(1500);

    // Đọc điểm RIÊNG của câu Drag. H5P gắn class đúng/sai trên DRAGGABLE
    // (multiple:true -> nhân bản). Đếm .h5p-correct vs .h5p-wrong.
    const score = await frame.evaluate(() => {
      const dq = document.querySelector('.h5p-dragquestion') || document;
      const correct = dq.querySelectorAll('.h5p-draggable.h5p-correct, .h5p-correct').length;
      const wrong = dq.querySelectorAll('.h5p-draggable.h5p-wrong, .h5p-wrong').length;
      const dropped = dq.querySelectorAll('.h5p-draggable.h5p-dropped').length;
      return { correct, wrong, dropped };
    }).catch(() => ({}));
    log('ĐIỂM (riêng câu Drag):', JSON.stringify(score));
    const ok = score.correct > 0 && score.wrong === 0;
    log(ok ? '✅ DRAG SOLVER ĐÚNG' : '⚠️ Còn wrong, cần xem lại');
    if (!ok) process.exitCode = 4;
    await page.screenshot({ path: '/tmp/test-drag-result.png' });
    log('DONE');
  } catch (e) {
    log('FATAL', e.message); process.exitCode = 1;
  } finally {
    await context.close().catch(() => {}); await browser.close().catch(() => {});
  }
})();
