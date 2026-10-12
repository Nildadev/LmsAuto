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
  // hiển thị dưới dạng nút/marker ở CUỐI video (.h5p-end-summary). displayAt chỉ
  // là mốc bắt đầu CHO PHÉP mở tóm tắt, KHÔNG phải mốc dialog -> đánh dấu isSummary.
  const sum = iv.summary && iv.summary.task;
  if (sum && sum.library) {
    out.push({
      i: out.length,
      from: 0,
      to: 0,
      isSummary: true,
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
    kind: kindOf(it.library), isSummary: !!it.isSummary,
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


/**
 * Giải SingleChoiceSet (IV lồng): mỗi slide có 1 câu + các `.h5p-sc-alternative`.
 * Click đáp án ĐÚNG -> H5P tự chuyển slide kế (3 slide). Lặp tới hết slide.
 * KHÔNG có nút "Kiểm tra" — click là tính điểm ngay.
 */
async function answerSingleChoiceSet(frame, extracted, logger) {
  const norm = (s) => String(s || '')
    .replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ')
    .replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  // Gộp tất cả đáp án đúng có thể có (SingleChoiceSet: params.choices[].answers[]).
  const texts = [];
  const pushT = (t) => { const n = norm(t); if (n) texts.push(n); };
  if (extracted && extracted.correctTexts) extracted.correctTexts.forEach(pushT);
  if (extracted && extracted.data && extracted.data.correctTexts) extracted.data.correctTexts.forEach(pushT);
  // Hỗ trợ cấu trúc choices[] (mỗi slide 1 câu).
  const choices = (extracted && extracted.choices) || (extracted && extracted.data && extracted.data.choices) || [];
  choices.forEach((ch) => (ch.answers || []).forEach((a) => { if (a && a.correct) pushT(a.text); }));

  let totalClicks = 0;
  const maxSlides = Math.max(1, choices.length || 3);
  let prevQ = '';
  for (let slide = 0; slide < maxSlides + 2; slide++) {
    const alts = frame.locator('.h5p-sc-alternative:visible');
    const n = await alts.count().catch(() => 0);
    if (!n) break;
    // Câu hỏi slide hiện tại — nếu không đổi sau click => đã hết slide -> dừng.
    const qText = norm(await frame.locator('.h5p-sc-current-slide .h5p-sc-question').first().innerText().catch(() => ''));
    if (qText && qText === prevQ && slide > 0) break;
    prevQ = qText;
    // Chọn đáp án khớp correctTexts; fallback cái đầu (chưa đánh dấu sai).
    // Ưu tiên class .h5p-sc-is-correct do H5P đánh dấu sẵn (giống book/question.js).
    const altTexts = [];
    for (let i = 0; i < n; i++) altTexts.push(norm(await alts.nth(i).innerText().catch(() => '')));
    let target = -1;
    for (let i = 0; i < n; i++) {
      const isCorrect = await alts.nth(i).evaluate((el) => /h5p-sc-is-correct/.test(el.className || '')).catch(() => false);
      if (isCorrect) { target = i; break; }
    }
    if (target < 0) {
      for (let i = 0; i < n; i++) { if (texts.includes(altTexts[i])) { target = i; break; } }
      if (target < 0) { for (let i = 0; i < n; i++) { if (texts.some((w) => altTexts[i].includes(w) || w.includes(altTexts[i]))) { target = i; break; } } }
    }
    if (target < 0) target = 0;
    await humanClick(frame, alts.nth(target)).catch(() => {});
    totalClicks++;
    await sleep(900);
    // Nếu H5P báo sai (is-wrong) thử đáp án khác.
    const wrong = await alts.nth(target).evaluate((el) => /h5p-sc-is-wrong/.test(el.className)).catch(() => false);
    if (wrong) {
      for (let i = 0; i < n; i++) {
        if (i === target) continue;
        await humanClick(frame, alts.nth(i)).catch(() => {});
        await sleep(700);
        const w2 = await alts.nth(i).evaluate((el) => /h5p-sc-is-wrong/.test(el.className)).catch(() => false);
        if (!w2) { totalClicks++; break; }
      }
    }
  }
  logger && logger(`    single-choice-set clicked ${totalClicks}`);
  return { solved: totalClicks > 0, clicked: totalClicks };
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

  let solvedCount = 0;
  // Gom interaction theo mốc thời gian (from). Tại 1 mốc, H5P hiện TẤT CẢ
  // interaction cùng from trong CÙNG 1 dialog (summary + nhiều MC cùng lúc).
  // LOẠI summary khỏi stops: nó là nút "Mở tóm tắt" ở CUỐI video, xử lý riêng.
  const stops = [...new Set(list.filter(l => !l.isSummary).map(l => l.from))].sort((a, b) => a - b);
  const hasSummary = list.some(l => l.isSummary);
  const deadline = Date.now() + 300000; // tối đa 5 phút
  logger(`IV: ${stops.length} mốc dừng tại [${stops.join(', ')}]s${hasSummary ? ' + Tóm tắt(cuối)' : ''}`);

  const snapVideo = () => frame.evaluate(() => {
    const v = document.querySelector('video');
    const summary = document.querySelectorAll('.h5p-summary li[data-bit], .h5p-summary li').length;
    const answers = document.querySelectorAll('.h5p-answer').length;
    // SingleChoiceSet dùng .h5p-sc-alternative (KHÔNG có .h5p-answer).
    const sc = document.querySelectorAll('.h5p-sc-alternative').length;
    return {
      t: v ? +v.currentTime.toFixed(1) : null,
      dur: v ? v.duration : 0,
      paused: v ? v.paused : null,
      hasQ: summary || answers || sc,
    };
  }).catch(() => ({ t: 0, dur: 0, paused: null, hasQ: 0 }));

  // Chờ dialog xuất hiện trong tối đa timeoutMs. Trả snap cuối.
  const waitDialog = async (timeoutMs) => {
    const end = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < end) {
      last = await snapVideo();
      if (last.hasQ) return last;
      await sleep(500);
    }
    return last;
  };

  // Phát hiện video KHÔNG tua được: video nằm trong iframe YouTube (cross-origin),
  // nên KHÔNG thể seek bằng document.querySelector('video'). Với dạng này ta chỉ
  // có thể bấm play và chờ dialog tự hiện theo thời gian phát thực.
  const isYoutube = await frame.evaluate(() => {
    const hasNative = !!document.querySelector('video');
    const yt = [...document.querySelectorAll('iframe')].some(f => /youtube\.com|youtu\.be|youtube-nocookie/.test(f.src || ''));
    return yt && !hasNative;
  }).catch(() => false);

  // Bấm splash play (nhiều biến thể) để bắt đầu video (đặc biệt cần cho YouTube).
  const clickSplash = async () => {
    const sels = ['.h5p-splash-play-icon', '.h5p-splash-play', '.h5p-splash-main', '.h5p-splash'];
    for (const s of sels) {
      const loc = frame.locator(s).first();
      if (await loc.count().catch(() => 0)) {
        const b = await loc.boundingBox().catch(() => null);
        if (b) { await frame.page().mouse.click(b.x + b.width / 2, b.y + b.height / 2).catch(() => {}); return true; }
      }
    }
    return false;
  };

  // Bắt đầu video YouTube: ưu tiên API nội bộ H5P (H5P.instances[].video.play()),
  // vì H5P tự đồng bộ đồng hồ qua YouTube iframe API để trigger dialog theo mốc.
  // (Click thẳng iframe YouTube sẽ làm H5P MẤT đồng bộ -> dialog không bao giờ hiện.)
  const startYoutube = async () => {
    return await frame.evaluate(() => {
      try {
        const inst = (window.H5P && H5P.instances) || [];
        const iv = inst.find(i => i && i.video && typeof i.video.play === 'function');
        if (iv) { iv.video.play(); return true; }
      } catch (_) {}
      return false;
    }).catch(() => false);
  };

  // Click marker tương tác trên seekbar -> H5P TỰ tua tới mốc và mở dialog.
  // Áp dụng cho MỌI loại video (kể cả YouTube không seek được). Đây là cách bấm
  // "nút chỗ hiện câu hỏi" mà H5P cung cấp sẵn.
  // `preferIdx`: gợi ý marker thứ i (theo DOM order = thứ tự thời gian). Ta NHỚ các
  // marker đã bấm (key phân biệt summary/stop để không đụng index) để không bấm lại.
  const clickedMarkers = new Set();
  const clickSeekbarMarker = async (preferIdx, summaryOnly) => {
    const key = (i) => (summaryOnly ? `s${i}` : `m${i}`);
    const markers = frame.locator(summaryOnly
      ? '.h5p-end-summary, .h5p-summary-interaction'
      : '.h5p-seekbar-interaction:not(.h5p-end-summary):visible');
    const n = await markers.count().catch(() => 0);
    if (!n) return false;
    const order = [];
    for (let i = 0; i < n; i++) order.push(i);
    // Ưu tiên marker chưa bấm; nếu preferIdx còn trống thì đặt lên đầu.
    order.sort((a, b) => {
      const ca = clickedMarkers.has(key(a)) ? 1 : 0, cb = clickedMarkers.has(key(b)) ? 1 : 0;
      if (ca !== cb) return ca - cb;
      if (a === preferIdx) return -1; if (b === preferIdx) return 1;
      return a - b;
    });
    for (const i of order) {
      if (clickedMarkers.has(key(i))) continue;
      const loc = markers.nth(i);
      const title = await loc.getAttribute('title').catch(() => '');
      // Ưu tiên click trực tiếp (tự cuộn tới); fallback toạ độ chuột.
      let ok = false;
      try { await loc.scrollIntoViewIfNeeded({ timeout: 1500 }); await loc.click({ timeout: 2000 }); ok = true; } catch (_) {}
      if (!ok) {
        const b = await loc.boundingBox().catch(() => null);
        if (!b) continue;
        await frame.page().mouse.click(b.x + b.width / 2, b.y + b.height / 2).catch(() => {});
      }
      clickedMarkers.add(key(i));
      return { clicked: i, title };
    }
    return false;
  };


  if (isYoutube) {
    logger('  ⓘ IV dùng YouTube (H5P.Video YouTube) — không thể tua & dialog theo mốc không kích hoạt được trong tự động hoá -> bỏ qua an toàn');
    await clickSplash();
    await sleep(800);
    const started = await startYoutube();
    logger(started ? '  ▶ đã gọi H5P API play()' : '  ⚠ không gọi được H5P API play()');
    await sleep(1500);
  }

  // QUAN TRỌNG: KHÔNG đua theo video (playbackRate cao làm vụt qua mốc sớm 0s/3s
  // khi H5P chưa kịp trigger). Thay vào đó ĐIỀU KHIỂN từng mốc: seek tới ngay
  // trước mốc -> play rate 1 -> chờ dialog. Xác định & không phụ thuộc tốc độ.
  // "job": hoặc một mốc thời gian (from) hoặc tóm tắt cuối (isSummary).
  const jobs = stops.map(s => ({ stop: s, summary: false }));
  if (hasSummary) jobs.push({ stop: null, summary: true });
  for (let si = 0; si < jobs.length && Date.now() < deadline; si++) {
    const { stop, summary: isSumJob } = jobs[si];
    let snap;
    if (isSumJob) {
      // Tóm tắt: bấm nút marker "Mở tóm tắt" ở CUỐI video (.h5p-end-summary).
      const endMk = await clickSeekbarMarker(null, true);
      if (endMk) logger(`  ▶ bấm marker tóm tắt "${endMk.title}"`);
      else logger('  ⚠ không thấy marker .h5p-end-summary -> thử play cuối video');
      if (!endMk && !isYoutube) {
        await frame.evaluate(() => { const v = document.querySelector('video'); if (v) v.currentTime = Math.max(0, v.duration - 0.5); });
        await startYoutube();
      }
      snap = await waitDialog(20000);
      if (!snap || !snap.hasQ) { logger('  ⚠ tóm tắt không hiện dialog -> bỏ qua'); continue; }
    } else if (isYoutube) {
      // Không (chắc chắn) tua được: dùng marker tương tác trên seekbar — H5P tự
      // tua tới đúng mốc và mở dialog (bấm "nút chỗ hiện câu hỏi"). Đây là cách
      // duy nhất hoạt động với YouTube, KHÔNG phụ thuộc seek của <video>.
      const mk = await clickSeekbarMarker(si);
      if (mk) logger(`  ▶ bấm marker seekbar #${mk.clicked} "${mk.title}" (mốc ${stop}s)`);
      else logger(`  ⚠ không thấy marker seekbar cho mốc ${stop}s -> thử play thường`);
      if (!mk) await startYoutube();
      const budget = 20000;
      const snapYt = await waitDialog(budget);
      if (!snapYt || !snapYt.hasQ) {
        logger(`  ⚠ mốc ${stop}s không hiện dialog trong ${Math.round(budget / 1000)}s -> bỏ qua`);
        continue;
      }
      snap = snapYt;
      if (Date.now() > deadline) break;
    } else {
      // Seek tới ngay TRƯỚC mốc (trừ mốc 0 -> để 0) rồi phát chậm cho H5P kịp bắt.
      const back = stop > 0.6 ? stop - 0.4 : 0;
      await frame.evaluate((s) => {
        const v = document.querySelector('video');
        if (v) { try { v.currentTime = s; v.muted = true; v.playbackRate = 1; v.play().catch(() => {}); } catch (_) {} }
      }, back);
      await sleep(600);

      // Nếu là mốc 0s: H5P có thể đã hiện dialog ngay khi play.
      snap = await waitDialog(si === 0 ? 8000 : 15000);
      if (!snap || !snap.hasQ) {
        // Thử seek về đúng mốc rồi phát lại (một số bản H5P cần vượt qua mốc).
        await frame.evaluate((s) => {
          const v = document.querySelector('video');
          if (v) { try { v.currentTime = s; v.playbackRate = 0.5; v.play().catch(() => {}); } catch (_) {} }
        }, Math.max(0, stop - 0.2));
        snap = await waitDialog(8000);
      }
      if (!snap || !snap.hasQ) {
        logger(`  ⚠ mốc ${stop}s không hiện dialog -> bỏ qua`);
        continue;
      }
    }

    // H5P tự pause tại mốc; đảm bảo pause để đọc DOM (chỉ khi có video native).
    await frame.evaluate(() => { const v = document.querySelector('video'); if (v) v.pause(); });
    await sleep(400);

    // Đọc LẠI đáp án tại thời điểm dialog hiện (lazy-load action.params).
    const liveList = await extractList(await readInteractions(frame, jsonOverride));
    const group = isSumJob
      ? liveList.filter(l => l.isSummary)
      : liveList.filter(l => !l.isSummary && l.from === stop);
    if (!group.length) {
      logger(`  ⚠ ${isSumJob ? 'tóm tắt' : `mốc ${stop}s`} chưa load kịp đáp án -> tua qua`);
      continue;
    }
    logger(`  ▶ ${isSumJob ? 'Tóm tắt' : `mốc ${stop}s`} (${group.map(g => g.kind).join('+')}) @${snap.t}s`);
    {
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
      // (2a) SingleChoiceSet: dạng .h5p-single-choice-set, click là chấm điểm ngay.
      const scBox = frame.locator('.h5p-single-choice-set:visible').first();
      if (await scBox.count().catch(() => 0)) {
        const scEx = (group.find(g => g.kind === 'choice') || {}).extracted;
        await answerSingleChoiceSet(frame, scEx, logger);
        await sleep(400);
      }
      // (2b) MultiChoice/TrueFalse trong dialog IV: có .h5p-answer.
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
      logger(`  đã bấm ${nChk} nút kiểm tra @${stop}s`);
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
      logger(`  feedback @${stop}s: ok=${fb.ok} bad=${fb.bad} bar=${fb.bar} [${fb.det}]`);
      solvedCount++;

      // Bấm "Tiếp tục/Continue" để H5P submit câu trả lời (xAPI 'answered' chỉ
      // fire sau khi đóng dialog qua nút này, KHÔNG fire khi seek đi đột ngột).
      await pressContinue(frame, logger);
      await sleep(600);
    }
  }
  await finishVideo(frame);
  return { solved: solvedCount, total: stops.length + (hasSummary ? 1 : 0) };
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
