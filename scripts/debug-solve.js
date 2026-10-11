'use strict';
/**
 * debug-solve.js — End-to-end test trên 1 bài H5P THẬT.
 * Dùng: node scripts/debug-solve.js <content_id> <h5p_content_id(UUID)> <course_id(UUID)>
 * Nếu không truyền args, tự lấy 1 bài MultiChoice từ docs/all-contents-700.json.
 *
 * Flow: launch -> vào /xem-video -> đọc đáp án (readAnswers) -> solveOne -> check -> báo cáo.
 * KHÔNG bấm "Nộp bài" (chỉ debug giải trong player) để an toàn.
 */
const fs = require('fs');
const path = require('path');
const { launch, sleep, rand } = require('../src/core/stealth');
const { readAnswers, findPlayerFrame } = require('../src/h5p/answers');
const { solveOne, pressCheck } = require('../src/h5p/solver');
const { dismissAll } = require('../src/core/dismiss');
const { resolveToken } = require('./_token');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function pickContent() {
  const allc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'all-contents-700.json'), 'utf8'));
  // ưu tiên MultiChoice đơn giản
  const mc = allc.find(x => (x.total_multi_choice || 0) > 0 && (x.total_question || 0) <= 3 && !(x.total_embed_content || 0));
  return mc || allc.find(x => (x.total_single_choice || 0) > 0);
}

(async () => {
  const [, , cid, h5pId, courseId] = process.argv;
  let content = { content_id: cid, id: h5pId, course_id: courseId };
  if (!cid) {
    const pick = pickContent();
    content = pick;
    log('Auto-picked content:', pick.title, '| MC', pick.total_multi_choice, 'SC', pick.total_single_choice);
  }
  if (!token) { console.error('NO TOKEN at', TOKEN_FILE); process.exit(2); }

  const url = `https://lms360.vn/xem-video?p=${content.id}&c=${content.content_id}&cs=${content.course_id || ''}`;
  log('OPEN', url);

  const token = await resolveToken();
  const { browser, context, page } = await launch({ headless: true, token });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await sleep(5000);

    // Đóng modal Face ID nếu có
    const closed = await dismissAll(page);
    if (closed) log('Đã đóng', closed, 'modal/popup');
    await sleep(1000);

    log('Đọc đáp án từ H5PIntegration...');
    const answers = await readAnswers(page, 25000);
    if (!answers.length) {
      log('❌ Không đọc được H5PIntegration. Có thể player chưa load hoặc cần bấm play.');
      await page.screenshot({ path: '/tmp/debug-solve-fail.png' });
      process.exitCode = 3;
      return;
    }
    log('Đã đọc', answers.length, 'content(s):');
    answers.forEach(a => log('  -', a.library, '=>', a.kind, JSON.stringify(a.data || (a.sub || []).map(s => s.extracted)).slice(0, 200)));

    // Tìm frame có DOM câu hỏi thật
    const frame = await findPlayerFrame(page, 8000);
    if (!frame) { log('❌ Không tìm thấy frame có DOM câu hỏi'); return; }
    log('Player frame OK, có', await frame.locator('.h5p-answer, .h5p-alternative-container').count(), 'đáp án nodes');

    // Nếu là InteractiveVideo -> bấm play để hiện marker
    const isVideo = answers.some(a => /InteractiveVideo/.test(a.library));
    if (isVideo) {
      log('InteractiveVideo: thử bấm play...');
      const play = await frame.locator('.h5p-splash-play, .h5p-video, .h5p-big-play-button').first().boundingBox().catch(() => null);
      if (play) { await frame.mouse.click(play.x + 10, play.y + 10); await sleep(1500); }
      await page.keyboard.press('End').catch(() => {});
      await sleep(2000);
    }

    // Solve từng dạng hỗ trợ
    for (const a of answers) {
      if (a.kind === 'questionset' || a.kind === 'book') {
        log('Dạng', a.kind, 'có', (a.sub || []).length, 'câu con (sẽ xử lý sau)');
        continue;
      }
      if (['choice', 'blanks', 'dragquestion'].includes(a.kind)) {
        log('Solve', a.kind, '...');
        const r = await solveOne(frame, a, log);
        log('  =>', JSON.stringify(r));
        await sleep(500);
        await pressCheck(frame, log);
        await sleep(1500);
        // đọc kết quả
        const score = await frame.evaluate(() => {
          const bar = document.querySelector('.h5p-score-bar-progress, .h5p-joubelui-score-bar-progress');
          const fb = document.querySelector('.h5p-question-feedback-container, .h5p-feedback');
          const correct = document.querySelectorAll('.h5p-correct').length;
          const wrong = document.querySelectorAll('.h5p-wrong').length;
          return { bar: bar ? bar.style.width : null, correct, wrong, fb: fb ? fb.innerText.slice(0, 80) : null };
        }).catch(() => ({}));
        log('  KẾT QUẢ:', JSON.stringify(score));
      } else {
        log('  (skip kind:', a.kind + ')');
      }
    }
    await page.screenshot({ path: '/tmp/debug-solve-result.png' });
    log('DONE. Screenshot: /tmp/debug-solve-result.png');
  } catch (e) {
    log('FATAL', e.message);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
})();
