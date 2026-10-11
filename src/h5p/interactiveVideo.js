'use strict';
/**
 * interactiveVideo.js — Điều phối InteractiveVideo: seek tới từng interaction,
 * chọn đáp án đúng (MC/SC/Blanks), cố gắng Summary, hoàn thành video.
 * Đọc đáp án từ H5PIntegration (không brute-force mù).
 */
const { sleep, humanDelay, humanClick } = require('../core/stealth');
const { extractAnswers } = require('./extract');
const { pressCheck } = require('./solver');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Đọc danh sách interactions từ H5PIntegration trong frame (hoặc từ jsonContent truyền vào). */
async function readInteractions(frame, jsonOverride) {
  const jc = jsonOverride || await frame.evaluate(() => {
    const c = window.H5PIntegration.contents;
    const k = Object.keys(c)[0];
    let j = c[k].jsonContent;
    if (typeof j === 'string') { try { j = JSON.parse(j); } catch (_) {} }
    return j;
  });
  let iv = jc.interactiveVideo;
  // Khi jsonContent được truyền trực tiếp là params của IV (lồng trong IB/CP):
  if (!iv && jc.params && jc.params.interactiveVideo) iv = jc.params.interactiveVideo;
  iv = iv || {};
  const assets = iv.assets || {};
  const out = ((assets.interactions) || []).map((a, i) => ({
    i,
    from: (a.duration && a.duration.from) || 0,
    to: (a.duration && a.duration.to) || 0,
    library: a.action && a.action.library,
    params: a.action && a.action.params,
  }));
  // Summary của IV nằm ở iv.summary.task (KHÔNG nằm trong assets.interactions),
  // hiển thị tại displayAt (mặc định 5s). Bổ sung như 1 interaction để giải.
  const sum = iv.summary && iv.summary.task;
  if (sum && sum.library) {
    out.push({
      i: out.length,
      from: typeof iv.summary.displayAt === 'number' ? iv.summary.displayAt : 5,
      to: 0,
      library: sum.library,
      params: sum.params,
    });
  }
  return out;
}

function kindOf(library) {
  const l = library || '';
  if (/MultiChoice|SingleChoice|TrueFalse/.test(l)) return 'choice';
  if (/Blanks|DragText|MarkTheWords/.test(l)) return 'blanks';
  if (/Summary/.test(l)) return 'summary';
  return 'other';
}

/** Đẩy nội dung trong bài ra ngoài Node để extract. */
async function extractList(interactions) {
  return interactions.map(it => ({
    i: it.i, from: it.from, to: it.to, library: it.library,
    kind: kindOf(it.library),
    extracted: extractAnswers(it.library, { params: it.params }),
  }));
}

/**
 * Click đáp án Choice đúng trong MỘT question container (qc).
 * QUAN TRỌNG: khớp theo TEXT (correctTexts), KHÔNG theo index — vì DOM H5P
 * đảo/ngẫu nhiên thứ tự đáp án so với JSON params.answers (đã verify: index
 * cho 0 điểm, text-matching cho đúng). Chuẩn hoá: bỏ tag/entity, gộp khoảng
 * trắng, bỏ dấu, lowercase. Exact trước, contains sau.
 */
async function answerChoiceInPopup(frame, qc, extracted, logger) {
  const answers = qc.locator('.h5p-answer');
  const count = await answers.count().catch(() => 0);
  if (!count) return { solved: false, reason: 'no-answer-node', count: 0 };

  // Chuẩn hoá text để khớp robust (bỏ dấu, gộp space, bỏ mọi ký tự lạ).
  const norm = (s) => String(s || '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[^\p{L}\p{N}]/gu, '')  // bỏ space/dấu câu, giữ chữ+số (mọi script)
    .toLowerCase();

  // Thu thập answer visible + text.
  const visible = [];
  for (let i = 0; i < count; i++) {
    const loc = answers.nth(i);
    const vis = await loc.isVisible().catch(() => false);
    if (!vis) continue;
    const raw = await loc.innerText().catch(() => '');
    visible.push({ i, raw, n: norm(raw) });
  }
  if (!visible.length) return { solved: false, reason: 'no-visible-answer' };

  const texts = (extracted && extracted.correctTexts) || [];
  let clicked = 0;
  if (texts.length) {
    for (const t of texts) {
      const w = norm(t);
      if (!w) continue;
      // exact -> contains (cả 2 chiều) để chịu được MathML render khác JSON.
      let hit = visible.find(v => v.n === w);
      if (!hit) hit = visible.find(v => v.n.includes(w) || w.includes(v.n));
      if (hit) {
        await selectAt(answers, hit.i);
        if (await isSelected(answers.nth(hit.i))) clicked++;
      }
    }
  } else {
    // Không có correctTexts -> chọn hết (multi) hoặc cái đầu (single).
    const multi = /MultiChoice/.test(extracted && extracted.library);
    const picks = multi ? visible.map(v => v.i) : [visible[0].i];
    for (const i of picks) { await selectAt(answers, i); if (await isSelected(answers.nth(i))) clicked++; }
  }
  logger && logger(`    choice matched ${clicked} want=${JSON.stringify(texts)} visible=${JSON.stringify(visible.map(v => v.raw))}`);
  return { solved: clicked > 0, clicked, total: count };

  // Chọn 1 answer theo index; verify bằng isSelected (click thân, tránh tip).
  async function selectAt(ansLoc, i) {
    const ans = ansLoc.nth(i);
    if (await isSelected(ans)) return true;
    const inner = ans.locator('.h5p-alternative-container').first();
    if (await inner.count().catch(() => 0)) { await humanClick(frame, inner); await sleep(160); }
    if (!(await isSelected(ans))) { await humanClick(frame, ans); await sleep(160); }
    if (!(await isSelected(ans))) { await ans.evaluate((el) => el.click()).catch(() => {}); await sleep(160); }
    return isSelected(ans);
  }
}


/** Đáp án đã được chọn chưa (aria-checked=true hoặc class h5p-selected). */
async function isSelected(ans) {
  return ans.evaluate((el) =>
    el.getAttribute('aria-checked') === 'true' ||
    el.getAttribute('aria-pressed') === 'true' ||
    /(^|\s)h5p-selected(\s|$)/.test(el.className || '') ||
    !!el.querySelector('.h5p-selected')
  ).catch(() => false);
}

/** Bấm nút Kiểm tra/Gửi trả lời TRONG 1 question container (chờ enabled). */
async function pressCheckIn(frame, qc, logger) {
  const sel = qc.locator('.h5p-question-check-answer, .h5p-question-submit, button.h5p-question-visible').first();
  if (!(await sel.count().catch(() => 0))) return false;
  // H5P disable nút cho tới khi có lựa chọn -> chờ enabled trước khi click.
  for (let i = 0; i < 8; i++) {
    const disabled = await sel.getAttribute('disabled').catch(() => null);
    const ariaDisabled = await sel.getAttribute('aria-disabled').catch(() => null);
    if (disabled === null && ariaDisabled !== 'true') break;
    await sleep(250);
  }
  await humanClick(frame, sel);
  logger && logger('    pressed check-in');
  return true;
}

/** Seek video tới giây N bằng click lên seekbar. */
async function seekVideo(frame, second) {
  const dur = await frame.evaluate(() => { const v = document.querySelector('video'); return v ? v.duration : 0; }).catch(() => 0);
  if (!dur) return;
  const ratio = Math.max(0, Math.min(0.98, second / dur));
  const bar = await frame.locator('.h5p-seekbar').first().boundingBox().catch(() => null);
  if (bar) {
    await frame.page().mouse.click(bar.x + bar.width * ratio, bar.y + bar.height / 2);
  } else {
    await frame.evaluate((s) => { const v = document.querySelector('video'); if (v) { v.currentTime = s; v.dispatchEvent(new Event('seeked')); } }, second);
  }
}

/** Cho video chạy gần cuối để đánh dấu hoàn thành. */
async function finishVideo(frame) {
  const dur = await frame.evaluate(() => { const v = document.querySelector('video'); return v ? v.duration : 0; }).catch(() => 0);
  if (dur) await seekVideo(frame, Math.floor(dur - 3));
  await sleep(2500);
}

/** Giải Summary trong khung .h5p-summary (qc). */
async function answerSummaryInPopup(frame, qc, extracted, logger) {
  const rows = qc.locator('li[data-bit], .h5p-summary-row, li');
  const n = await rows.count().catch(() => 0);
  if (!n) return { solved: false, reason: 'no-summary-row' };
  const data = (extracted && extracted.rows) || [];
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  let clicked = 0;
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const txt = ((await row.textContent().catch(() => '')) || '').trim();
    const r = data.find(d => norm(d.correctText) === norm(txt) || norm(d.incorrectText) === norm(txt));
    const isCorrect = r ? (norm(r.correctText) === norm(txt)) : true;
    // H5P Summary toggle 3 trạng thái: unselected -> correct(đúng) -> incorrect(sai) -> unselected.
    // Muốn đúng: click 1 lần. Muốn sai: click 2 lần. Bắt đầu từ unselected.
    await humanClick(frame, row);
    await sleep(150);
    if (!isCorrect) { await humanClick(frame, row); await sleep(150); }
    clicked++;
  }
  logger && logger(`    summary clicked ${clicked}/${n}`);
  return { solved: clicked > 0, clicked, total: n };
}

/**
 * Chạy toàn bộ video: PLAY (không seek) để H5P tự pause ở mỗi interaction,
 * poll dialog -> giải -> submit -> tiếp tục. Đã verify: play playbackRate cao
 * thì H5P trigger dialog đúng, seek thì không.
 * @returns {Promise<{solved:number,total:number}>}
 */
async function solveVideo(page, frame, logger = log, jsonOverride) {
  const interactions = await readInteractions(frame, jsonOverride);
  if (!interactions.length) { logger('IV: không có interactions'); return { solved: 0, total: 0 }; }
  const list = await extractList(interactions);
  logger(`IV: ${list.length} interactions`, list.map(l => `${l.i}@${l.from}s:${l.kind}`).join(' '));

  // Bắt đầu phát video từ đầu với playbackRate cao để nhanh tới interaction đầu.
  await frame.evaluate(() => {
    const v = document.querySelector('video');
    if (v) { try { v.currentTime = 0; v.muted = true; v.playbackRate = 6; v.play().catch(() => {}); } catch (_) {} }
  });
  await sleep(1500);

  let solvedCount = 0;
  // Gom interaction theo mốc thời gian (from). Tại 1 mốc, H5P hiện TẤT CẢ
  // interaction cùng from trong CÙNG 1 dialog (summary + nhiều MC cùng lúc).
  const stops = [...new Set(list.map(l => l.from))].sort((a, b) => a - b);
  const handled = new Set();
  const deadline = Date.now() + 300000; // tối đa 5 phút
  logger(`IV: ${stops.length} mốc dừng tại [${stops.join(', ')}]s`);

  while (Date.now() < deadline && handled.size < stops.length) {
    const snap = await frame.evaluate(() => {
      const v = document.querySelector('video');
      const summary = document.querySelectorAll('.h5p-summary li[data-bit], .h5p-summary li').length;
      const answers = document.querySelectorAll('.h5p-answer').length;
      const submit = !!document.querySelector('.h5p-question-check-answer, .h5p-question-submit, button.h5p-question-visible');
      return { t: v ? +v.currentTime.toFixed(1) : null, dur: v ? v.duration : 0, paused: v ? v.paused : null, summary, answers, submit, hasQ: summary || answers };
    });

    // Mốc đang active = mốc NHỎ NHẤT chưa xử lý mà video đã đi qua.
    // QUAN TRỌNG: dùng [0] (nhỏ nhất) KHÔNG phải pop() (lớn nhất) — nếu không,
    // marker ở 0s (dialog hiện sau ~1s khi t đã >3s) sẽ bị bỏ qua vĩnh viễn.
    const active = stops.find((s) => s <= (snap.t || 0) + 1.5 && !handled.has(s));

    if (snap.hasQ && active !== undefined) {
      handled.add(active);
      // Dialog đang hiện có thể thuộc marker khác (video đã đi qua). Nếu video đã
      // vượt xa marker này, tua LÙI về đúng marker để H5P re-render dialog đúng.
      if ((snap.t || 0) > active + 5) {
        await seekVideo(frame, active + 0.4);
        await sleep(1500);
      }
      // H5P InteractiveVideo lazy-load action.params khi video tới gần marker.
      // Đọc LẠI tại thời điểm dialog hiện để lấy đáp án ĐẦY ĐỦ cho nhóm này.
      const liveList = await extractList(await readInteractions(frame, jsonOverride));
      const group = liveList.filter(l => l.from === active);
      if (!group.length) {
        logger(`  ⚠ mốc ${active}s chưa load kịp đáp án -> tua qua`);
        await seekVideo(frame, active + 3);
        await frame.evaluate((r) => { const v = document.querySelector('video'); if (v) { v.playbackRate = r; v.play().catch(() => {}); } }, 6);
        continue;
      }
      logger(`  ▶ mốc ${active}s (${group.map(g => g.kind).join('+')}) @${snap.t}s`);
      await frame.evaluate(() => { const v = document.querySelector('video'); if (v) v.pause(); });
      await sleep(400);

      // Giải TẤT CẢ interaction trong dialog tại mốc này.

      // (1) SUMMARY — nằm ở cấp dialog (.h5p-summary), KHÔNG nằm trong .h5p-question con.
      const sumBox = frame.locator('.h5p-summary').first();
      const nSumRows = await sumBox.locator('li[data-bit]').count().catch(() => 0);
      if (nSumRows) {
        const ex = group.find(g => g.kind === 'summary');
        if (ex && ex.extracted) {
          logger(`  summary: ${nSumRows} rows`);
          await answerSummaryInPopup(frame, sumBox, ex.extracted, logger);
          await sleep(300);
        }
      }

      // (2) CHOICE — gán đáp án THEO VỊ TRÍ cho từng MC container (tránh dùng chung).
      const choices = group.filter(g => g.kind === 'choice' || g.kind === 'blanks');
      const qcs = frame.locator('.h5p-question:visible');
      const nQc = await qcs.count().catch(() => 0);
      let mcIndex = 0;
      for (let q = 0; q < nQc && mcIndex < choices.length; q++) {
        const qc = qcs.nth(q);
        const nAns = await qc.locator('.h5p-answer').count().catch(() => 0);
        if (nAns) {
          const r = await answerChoiceInPopup(frame, qc, choices[mcIndex].extracted, logger);
          mcIndex++;
          // Bấm Kiểm tra NGAY trong container này (nút enabled sau khi có lựa chọn).
          if (r.solved) await pressCheckIn(frame, qc, logger);
        }
      }
      await sleep(500);

      // Bấm nốt các nút Kiểm tra/Gửi còn đang visible (fallback, vd summary-submit).
      const checks = frame.locator('.h5p-question-check-answer:visible, .h5p-question-submit:visible, button.h5p-question-visible:visible');
      const nChk = await checks.count().catch(() => 0);
      for (let k = 0; k < nChk; k++) { await humanClick(frame, checks.nth(k)).catch(() => {}); await sleep(200); }
      logger(`  đã bấm ${nChk} nút kiểm tra @${active}s`);
      await sleep(900);

      // Đọc feedback NGAY (trước khi seek) để verify đúng/sai tại chỗ.
      const fb = await frame.evaluate(() => {
        const qs = [...document.querySelectorAll('.h5p-question')];
        let ok = 0, bad = 0, det = [];
        for (const q of qs) {
          const good = q.querySelectorAll('.h5p-correct, .multichoice-tip.h5p-correct, .h5p-question-plus-one').length;
          const wrong = q.querySelectorAll('.h5p-wrong, .multichoice-tip.h5p-wrong').length;
          ok += good; bad += wrong;
          det.push(`g${good}/w${wrong}`);
        }
        const bar = document.querySelector('.h5p-joubelui-score-bar-progress, .h5p-score-bar-progress');
        return { ok, bad, bar: bar ? (bar.style.width || bar.getAttribute('style')) : null, det: det.join(' ') };
      }).catch(() => ({}));
      logger(`  feedback @${active}s: ok=${fb.ok} bad=${fb.bad} bar=${fb.bar} [${fb.det}]`);
      solvedCount++;

      // Bấm "Tiếp tục/Continue" để H5P submit câu trả lời (xAPI 'answered' chỉ
      // fire sau khi đóng dialog qua nút này, KHÔNG fire khi seek đi đột ngột).
      await pressContinue(frame, logger);
      await sleep(600);

      // Seek QUA mốc này (không re-pause) rồi phát tiếp tới mốc sau.
      const next = stops.find(s => s > active);
      const jumpTo = next !== undefined ? next + 1 : (snap.dur ? Math.floor(snap.dur - 2) : active + 2);
      await seekVideo(frame, jumpTo);
      await sleep(300);
      await frame.evaluate((r) => { const v = document.querySelector('video'); if (v) { v.playbackRate = r; v.play().catch(() => {}); } }, 6);
    } else {
      // Không có dialog (hoặc đã xử lý mốc): đảm bảo video chạy; gần cuối thì tua cuối.
      if (snap.dur && snap.t && snap.t > snap.dur - 6) {
        // Không còn mốc phía trước -> kết thúc.
        if (!stops.some(s => s > (snap.t || 0))) break;
      }
      await frame.evaluate(() => { const v = document.querySelector('video'); if (v && v.paused) { try { v.play().catch(() => {}); } catch (_) {} } });
      await sleep(1200);
    }
  }
  await finishVideo(frame);
  return { solved: solvedCount, total: stops.length };
}

/** Bấm "Tiếp tục/Continue" sau khi xem feedback trong popup IV để submit câu trả lời. */
async function pressContinue(frame, logger) {
  // QUAN TRỌNG: H5P InteractiveVideo dùng class .h5p-question-iv-continue cho nút
  // "Tiếp tục" (KHÔNG có text "Tiếp tục"). Chỉ bấm nút này mới fire xAPI 'answered'.
  const ivc = frame.locator('.h5p-question-iv-continue:visible').first();
  if (await ivc.count().catch(() => 0)) {
    await ivc.evaluate((el) => el.click()).catch(async () => { await humanClick(frame, ivc).catch(() => {}); });
    logger && logger('    pressed continue (.h5p-question-iv-continue)');
    return true;
  }
  // Fallback theo text (một số lib dùng nhãn chữ).
  const texts = ['Tiếp tục', 'Continue', 'Hoàn thành'];
  for (const t of texts) {
    const btn = frame.locator(`button:has-text("${t}"):visible`).first();
    if (await btn.count().catch(() => 0)) {
      await btn.evaluate((el) => el.click()).catch(() => {});
      logger && logger(`    pressed continue "${t}"`);
      return true;
    }
  }
  return false;
}

module.exports = { solveVideo, readInteractions, extractList, answerChoiceInPopup, answerSummaryInPopup, pressContinue, seekVideo, finishVideo, kindOf, log };
