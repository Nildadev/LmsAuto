'use strict';
/**
 * solver.js — Tự động click/chọn đáp án đúng cho từng dạng H5P trong frame.
 * Chiến lược: ưu tiên chọn theo đáp án đã extract; có fallback brute-force
 * (chọn hết -> Check -> đọc .h5p-correct -> bỏ sai) cho dạng chưa hỗ trợ.
 *
 * DOM selector dựa trên H5P core chuẩn (lms360 dùng H5P 1.27).
 */
const { humanClick, humanDelay, sleep } = require('../core/stealth');
const { deburr } = require('./extract');

/** Chuẩn hoá text để khớp: bỏ tag/entity, gộp khoảng trắng, bỏ dấu cách lạ, lowercase. */
function normalizeText(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // gộp mọi khoảng trắng (kể cả newline) thành 1 space
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Đợi selector trong frame, trả về locator hoặc null. */
async function waitSel(frame, sel, ms = 4000) {
  try {
    const loc = frame.locator(sel).first();
    await loc.waitFor({ state: 'attached', timeout: ms });
    return loc;
  } catch (_) { return null; }
}

/** Giải MultiChoice/SingleChoiceSet/TrueFalse: click đáp án có correct=true. */
async function solveChoice(frame, extracted, logger) {
  // Chọn bộ selector GIỐNG trước: ưu tiên .h5p-answer nếu TỒN TẠI (kể cả đang ẩn),
  // chỉ khi không có mới dùng fallback. Tránh click nhầm node ẩn duplicate.
  const hasAnswer = await frame.locator('.h5p-answer').count().catch(() => 0);
  const baseSel = hasAnswer ? '.h5p-answer' : ':is(.h5p-alternative-container, .h5p-true-false-answer)';
  if (!hasAnswer && !(await frame.locator(baseSel).count().catch(() => 0))) {
    return { solved: false, reason: 'no-answer-nodes' };
  }
  // Lấy text của các đáp án ĐANG HIỆN trong MỘT lượt (allInnerTexts) thay vì
  // isVisible()+innerText() cho TỪNG đáp án (trước đây 2 round-trip/đáp án).
  const visLoc = frame.locator(`${baseSel}:visible`);
  const rawTexts = await visLoc.allInnerTexts().catch(() => []);
  if (!rawTexts.length) return { solved: false, reason: 'no-visible-answer' };
  const visible = rawTexts.map((t, i) => ({ i, t: normalizeText(t) }));

  const want = (extracted.data && extracted.data.correctTexts || []).map(normalizeText);

  const toClick = [];
  if (want.length) {
    // QUAN TRỌNG: khớp CHÍNH XÁC trước (tránh "unfortunately" chứa "fortunately").
    // Nếu không có exact match, mới xét đến khớp gần (khoảng trắng lạ).
    const exactHit = (w) => visible.find(v => v.t === w);
    const looseHit = (w) => {
      // chỉ chấp nhận khi độ dài gần nhau (tránh superstring)
      const cand = visible.filter(v => Math.abs(v.t.length - w.length) <= 2);
      return cand.find(v => v.t.includes(w) || w.includes(v.t));
    };
    want.forEach(w => {
      const found = exactHit(w) || looseHit(w);
      if (found) toClick.push(found.i);
    });
  } else {
    // Không trích được đáp án -> KHÔNG đoán (trước đây click hết/cái đầu rồi báo
    // solved -> bài được tính xong dù trả lời sai).
    logger && logger(`choice: không có đáp án trích được -> bỏ qua (visible=${JSON.stringify(visible.map(v => v.t))})`);
    return { solved: false, reason: 'no-answers', visible: visible.map(v => v.t) };
  }

  const clicked = [];
  for (const i of toClick) {
    if (!clicked.includes(i)) {
      await humanClick(frame, visLoc.nth(i));
      await humanDelay();
      clicked.push(i);
    }
  }
  logger && logger(`choice: clicked ${clicked.length} (want=${JSON.stringify(want)} visible=${JSON.stringify(visible.map(v => v.t))})`);
  return { solved: clicked.length > 0, clicked, want };
}

/** Giải Blanks: điền text đáp án vào input theo thứ tự. */
async function solveBlanks(frame, extracted, logger) {
  // CHỈ lấy input VISIBLE (H5P có input ẩn duplicate cho a11y/screen reader).
  // Nếu lấy cả input ẩn sẽ click nhầm node không tác dụng và timeout.
  const inputs = frame.locator('input.h5p-text-input:visible');
  const count = await inputs.count();
  if (!count) {
    // Không có input text nhưng là DragText (H5P.DragText) -> kéo thả từ vào ô trống.
    const isDragText = await frame.locator('.h5p-drag-text').count().catch(() => 0);
    if (isDragText) return solveDragText(frame, extracted, logger);
    return { solved: false, reason: 'no-visible-input' };
  }
  const answers = (extracted.data && extracted.data.answers) || [];
  if (!answers.length) {
    // Không có đáp án -> KHÔNG điền bừa 'a' rồi báo solved.
    logger && logger('blanks: không có đáp án trích được -> bỏ qua');
    return { solved: false, reason: 'no-answers', count };
  }
  for (let i = 0; i < count; i++) {
    const val = answers[i] !== undefined ? answers[i] : answers[0];
    const inp = inputs.nth(i);
    await inp.click({ timeout: 4000 });
    await sleep(60);
    await inp.fill('');
    await inp.type(val, { delay: 25 });
    await humanDelay();
  }
  logger && logger(`blanks: filled ${count}/${answers.length} answers`);
  return { solved: true, filled: count };
}

/**
 * Giải H5P.DragText: kéo từ (draggable) vào "Vùng thả" (ui-droppable) theo thứ tự text.
 * DOM lms360: .h5p-drag-text > .h5p-drag-inner > .h5p-drag-task >
 *   .h5p-drag-droppable-words chứa (.h5p-drag-dropzone-container > .ui-droppable) xen kẽ text;
 *   các từ nằm trong .h5p-drag-draggables > .h5p-drag-draggable.
 * Đáp án đúng lấy từ params.textField (token *từ*) theo thứ tự.
 * @param {import('playwright').Frame|import('playwright').Locator} frame Frame hoặc container Locator (book delegate: có .locator()/.page()).
 */
async function solveDragText(frame, extracted, logger) {
  const answers = ((extracted.data && extracted.data.answers) || []).filter(Boolean);
  const zones = frame.locator('.h5p-drag-text .h5p-drag-dropzone-container > .ui-droppable:visible');
  const words = frame.locator('.h5p-drag-text .h5p-drag-draggables-container > .ui-draggable:visible');
  let zN = await zones.count().catch(() => 0);
  let wN = await words.count().catch(() => 0);
  if (!zN || !wN) return { solved: false, reason: 'no-dragtext-dom', zN, wN };
  logger && logger(`  dragtext: ${zN} ô trống, ${wN} từ, ${answers.length} đáp án`);

  const mouse = frame.page().mouse;
  const center = async (loc) => { const b = await loc.boundingBox().catch(() => null); return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; };

  let placed = 0;
  const usedText = new Set();
  for (let i = 0; i < zN; i++) {
    const want = answers[i];
    if (!want) { logger && logger(`  ô ${i}: không có đáp án (bỏ qua)`); continue; }
    // Đọc text CẢ bank trong 1 lượt (allInnerTexts) — trước đây gọi innerText()
    // cho TỪNG từ × TỪNG ô (O(số_ô × số_từ) round-trip). Phải đọc lại mỗi ô vì
    // sau mỗi lần thả H5P re-render bank -> index thay đổi.
    const texts = (await words.allInnerTexts().catch(() => [])).map((t) => (t || '').trim());
    const nWords = texts.length;
    const nWant = normalizeText(want);
    let target = -1;
    for (let w = 0; w < nWords; w++) {
      const nt = normalizeText(texts[w]);
      if (!nt || usedText.has(nt)) continue;
      if (nt === nWant || nt.includes(nWant) || nWant.includes(nt)) { target = w; break; }
    }
    if (target < 0) {
      // Fallback: thử khớp theo thứ tự (bank giữ đúng thứ tự đáp án).
      for (let w = 0; w < nWords; w++) { const t = normalizeText(texts[w]); if (t && !usedText.has(t)) { target = w; break; } }
      if (target >= 0) logger && logger(`  ô ${i}: fallback theo thứ tự -> "${texts[target]}" (muốn "${want}")`);
    }
    if (target < 0) { logger && logger(`  ô ${i}: không thấy từ "${want}"`); continue; }
    usedText.add(normalizeText(texts[target]));
    const from = await center(words.nth(target));
    let to = await center(zones.nth(i));
    if (!from || !to) continue;
    await mouse.move(from.x, from.y, { steps: 8 });
    await mouse.down();
    await sleep(90);
    await mouse.move(to.x, to.y, { steps: 16 });
    await sleep(90);
    await mouse.up();
    await sleep(160);
    placed++;
    await humanDelay();
  }
  logger && logger(`  dragtext: đã thả ${placed}/${zN}`);
  return { solved: placed > 0, placed, zones: zN };
}

/** Giải DragQuestion: kéo element đúng vào dropzone (theo correctElements + sort y).
 * @param {import('playwright').Frame|import('playwright').Locator} frame Frame hoặc container Locator (book delegate).
 */
async function solveDrag(frame, extracted, logger) {
  const drags = frame.locator('.h5p-draggable:visible');
  const dzs = frame.locator('.h5p-dropzone:visible');
  const dragCount = await drags.count();
  const dzCount = await dzs.count();
  if (!dragCount || !dzCount) return { solved: false, reason: 'no-drag-dom', dragCount, dzCount };

  const elText = (extracted.data && extracted.data.elements) || [];
  const zones = (extracted.data && extracted.data.zones) || [];

  // Thu thập text của draggable trong 1 lượt (trước đây innerText() từng node),
  // còn box vẫn lấy riêng (boundingBox trả toạ độ trang — cần cho mouse.move).
  const dragTexts = await drags.allInnerTexts().catch(() => []);
  const dragInfo = [];
  for (let i = 0; i < dragCount; i++) {
    const box = await drags.nth(i).boundingBox();
    if (box) dragInfo.push({ box, txt: (dragTexts[i] || '').trim() });
  }
  // Playwright: Frame không có .mouse, chỉ Page có. Dùng page.mouse (tọa độ boundingBox là page coords).
  const mouse = frame.page().mouse;

  // Thu thập box dropzone, sắp theo (y, x) tăng dần — khớp thứ tự json zones.
  // Thêm tie-break theo x: 2 zone CÙNG hàng (cùng y, khác cột) trước đây đứng
  // tuỳ ý -> ghép index lệch -> kéo nhầm đáp án sang zone bên cạnh.
  const dzInfo = [];
  for (let i = 0; i < dzCount; i++) {
    const box = await dzs.nth(i).boundingBox();
    if (box) dzInfo.push({ box });
  }
  dzInfo.sort((a, b) => (a.box.y - b.box.y) || (a.box.x - b.box.x));

  // Sort zones json theo (y, x) để khớp DOM (y phần trăm, monotonic).
  const sortedZones = zones.slice().sort((a, b) => ((a.y || 0) - (b.y || 0)) || ((a.x || 0) - (b.x || 0)));

  const usedDrags = new Set(); // 1 draggable chỉ kéo vào 1 zone (tránh trùng text con)
  let dragged = 0;
  for (let i = 0; i < dzInfo.length; i++) {
    const zone = sortedZones[i];
    if (!zone || !zone.correctElements || !zone.correctElements.length) continue;
    const elIdx = Number(zone.correctElements[0]);
    const wantText = elText[elIdx];
    if (!wantText) continue;
    // Tìm draggable có text chứa đáp án (DOM có prefix "có thể lấy X trong Y.")
    const norm = s => String(s || '').replace(/có thể lấy\s*\d+\s*trong\s*\d+\.?/gi, '').trim();
    const want = deburr(wantText).toLowerCase();
    const free = (d) => !usedDrags.has(d);
    const drag = dragInfo.find(d => free(d) && deburr(d.txt).toLowerCase().includes(want)) ||
                 dragInfo.find(d => { if (!free(d)) return false; const nd = deburr(norm(d.txt)).toLowerCase(); return nd.includes(want) || want.includes(nd); });
    if (!drag) { logger && logger(`  zone${i}: không tìm thấy draggable cho "${wantText}"`); continue; }
    usedDrags.add(drag);
    const dz = dzInfo[i].box;
    await mouse.move(drag.box.x + drag.box.width / 2, drag.box.y + drag.box.height / 2, { steps: 8 });
    await mouse.down();
    await sleep(120);
    await mouse.move(dz.x + dz.width / 2, dz.y + dz.height / 2, { steps: 20 });
    await sleep(120);
    await mouse.up();
    dragged++;
    logger && logger(`  zone${i} <= "${wantText}"`);
    await humanDelay();
  }
  logger && logger(`drag: dragged ${dragged}/${dzInfo.length}`);
  return { solved: dragged > 0, dragged, zones: dzInfo.length };
}

/** Giải Summary: mỗi <li data-bit="1"> là đáp án đúng -> click. (Đã verify DOM thật lms360) */
async function solveSummary(frame, extracted, logger) {
  const claims = frame.locator('.h5p-summary li[data-name], .summary-claim');
  const count = await claims.count();
  if (!count) return { solved: false, reason: 'no-claim' };

  // data-bit trên mỗi <li>: "1" = đúng, "0" = sai (thuộc tính sẵn trong DOM).
  const bits = await frame.evaluate(() => {
    const lis = [...document.querySelectorAll('.h5p-summary li[data-name]')];
    return lis.map(li => li.getAttribute('data-bit'));
  }).catch(() => []);
  const hasBits = bits.length === count && bits.some(b => b !== null);

  let clicked = 0;
  if (hasBits) {
    for (let i = 0; i < count; i++) {
      if (bits[i] === '1') { await humanClick(frame, claims.nth(i)); clicked++; await humanDelay(); }
    }
    logger && logger(`summary: clicked ${clicked} đáp án đúng (data-bit=1) / ${count}`);
  } else {
    // Không có data-bit -> KHÔNG đoán (click hết sẽ bấm cả đáp án SAI rồi báo solved).
    logger && logger('summary: không có data-bit -> bỏ qua (không đoán)');
    return { solved: false, reason: 'no-data-bit', total: count };
  }
  return { solved: clicked > 0, clicked, total: count };
}

/** Nhãn nút "làm lại" của mọi dạng H5P (dùng chung cho retryAvailable/pressRetry). */
const RETRY_TEXTS = ['Làm lại', 'Thử lại', 'Làm lại lần nữa', 'Try again', 'Retry'];

/**
 * Bấm nút ĐẦU TIÊN có nhãn chứa 1 trong `texts` (ưu tiên theo thứ tự texts) trong
 * số button ĐANG HIỆN của `root`. Chỉ ~2 lượt (allInnerTexts + click) thay vì tối đa
 * 2×len(texts) lượt locator round-trip. `root` là Frame HOẶC Locator (book).
 */
async function pressFirstVisibleText(root, texts, logger, label) {
  const btns = root.locator('button:visible');
  const labels = await btns.allInnerTexts().catch(() => []);
  for (const t of texts) {
    const idx = labels.findIndex((s) => (s || '').includes(t));
    if (idx >= 0) { await humanClick(root, btns.nth(idx)); logger && logger(`${label} "${t}"`); return true; }
  }
  return false;
}

/** Bấm nút Check/Kiểm tra/Gửi trả lời trong frame. */
async function pressCheck(frame, logger) {
  if (await pressFirstVisibleText(frame, ['Kiểm tra', 'Check', 'Gửi trả lời', 'Submit', 'Kiểm tra lại'], logger, 'pressed')) return true;
  const sel = frame.locator('.h5p-question-check-answer:visible').first();
  if ((await sel.count().catch(() => 0))) { await humanClick(frame, sel); return true; }
  return false;
}

/** Bấm "Câu tiếp theo"/"Next". Trả về true nếu bấm được (chứng tỏ câu trước ĐÚNG). */
async function pressNext(frame, logger) {
  if (await pressFirstVisibleText(frame, ['Câu tiếp theo', 'Tiếp theo', 'Câu hỏi tiếp theo', 'Next'], logger, 'next')) return true;
  const sel = frame.locator('.h5p-question-next:visible, .h5p-question-try-again:visible').first();
  if ((await sel.count().catch(() => 0))) { await humanClick(frame, sel); return true; }
  return false;
}

/** Đếm phần tử visible trong frame theo selector. */
async function countVisible(frame, sel) {
  return frame.evaluate((s) => [...document.querySelectorAll(s)].filter(e => e && e.offsetParent !== null).length, sel);
}

/** Các selector feedback đúng/sai (mọi dạng H5P). */
const FEEDBACK_SEL = '.h5p-correct, .h5p-wrong, .h5p-true-false-answer.correct, .h5p-true-false-answer.incorrect, .multichoice-tip.h5p-correct, .multichoice-tip.h5p-wrong, .h5p-question-plus-one, .h5p-question-minus-one, .h5p-sc-is-correct, .h5p-sc-is-wrong';

/**
 * Chờ tối đa `ms` cho feedback đúng/sai xuất hiện, TRẢ VỀ SỚM ngay khi có.
 * Dùng thay cho sleep cứng sau khi bấm "Kiểm tra" -> nhanh hơn mà không đổi hành vi
 * (nếu không có feedback thì cũng chỉ chờ tối đa ms, tương đương sleep cũ).
 */
async function waitFeedback(root, ms = 2000) {
  await root.locator(FEEDBACK_SEL).first().waitFor({ state: 'visible', timeout: ms }).catch(() => {});
}

/* ── Retry khi câu SAI ──────────────────────────────────────────────────────
 * H5P chỉ cho "Làm lại/Thử lại" khi behaviour.enableRetry = true. Khi đó, sau
 * khi trả lời sai sẽ hiện nút .h5p-question-try-again (hoặc nhãn "Làm lại"/
 * "Thử lại"). Ta bấm nút đó để reset câu hỏi rồi trả lời lại — thay vì bỏ luôn
 * câu sai và báo bài "chưa hoàn thành". */

const RETRY_SEL = '.h5p-question-try-again:visible, .h5p-question-retry:visible, .h5p-question-try-again-button:visible';

/** Có nút "Làm lại/Thử lại" trong scope không. */
async function retryAvailable(root) {
  // Gộp 3 selector vào 1 lượt count (trước đây 3 lượt) rồi 1 lượt đọc nhãn button.
  if (await root.locator(RETRY_SEL).count().catch(() => 0)) return true;
  const labels = await root.locator('button:visible').allInnerTexts().catch(() => []);
  return labels.some((s) => RETRY_TEXTS.some((t) => (s || '').includes(t)));
}

/** Bấm nút "Làm lại/Thử lại" (reset câu hỏi để trả lời lại). Trả true nếu bấm được. */
async function pressRetry(root, logger) {
  const direct = root.locator(RETRY_SEL).first();
  if (await direct.count().catch(() => 0)) { await humanClick(root, direct).catch(() => {}); logger && logger('  retry: bấm "Làm lại"'); return true; }
  if (await pressFirstVisibleText(root, RETRY_TEXTS, logger, '  retry: bấm')) return true;
  return false;
}

/** Bấm TẤT CẢ nút "Làm lại" đang hiện trong scope (dialog có thể có nhiều câu sai). */
async function pressAllRetries(root, logger) {
  let n = await root.locator(RETRY_SEL).count().catch(() => 0);
  for (let i = 0; i < n; i++) { await humanClick(root, root.locator(RETRY_SEL).nth(i)).catch(() => {}); await sleep(120); }
  if (!n) {
    const btns = root.locator('button:visible');
    const labels = await btns.allInnerTexts().catch(() => []);
    const idx = labels.findIndex((s) => RETRY_TEXTS.some((t) => (s || '').includes(t)));
    if (idx >= 0) { await humanClick(root, btns.nth(idx)).catch(() => {}); n = 1; }
  }
  if (n) logger && logger(`  retry: bấm ${n} nút "Làm lại"`);
  return n;
}

/**
 * Trả lời 1 câu CÓ cơ chế thử lại khi sai (nếu H5P cho phép).
 * @param {object} o
 * @param {function} o.attempt   (n) => áp đáp án
 * @param {function} [o.check]   (n) => bấm "Kiểm tra"
 * @param {function} o.feedback  () => { correct, wrong, ... }
 * @param {function} [o.retry]   (n) => bấm "Làm lại" (reset); trả true nếu được
 * @param {number}   [o.maxAttempts=3]
 * @returns {Promise<{solved:boolean, attempts:number, correct:number, wrong:number}>}
 * Chỉ solved=true khi wrong===0 && correct>0. Dừng sớm khi số câu sai KHÔNG giảm
 * (tránh lặp vô ích) hoặc hết maxAttempts / không còn nút làm lại.
 */
async function answerWithRetry({ attempt, check, feedback, retry, maxAttempts = 3, logger = () => {} }) {
  let prevWrong = Infinity;
  let last = { correct: 0, wrong: 0 };
  let n = 0;
  for (n = 1; n <= maxAttempts; n++) {
    await attempt(n);
    if (check) await check(n);
    const fb = (await feedback()) || {};
    const correct = fb.correct || 0;
    const wrong = fb.wrong || 0;
    last = { ...fb, correct, wrong };
    logger(`  retry ${n}/${maxAttempts}: correct=${correct} wrong=${wrong}`);
    if (wrong === 0 && correct > 0) return { solved: true, attempts: n, ...last };
    if (n > 1 && wrong >= prevWrong) { logger('  retry: số câu sai không giảm -> dừng'); break; }
    prevWrong = wrong;
    if (n < maxAttempts) {
      const ok = retry ? await retry(n) : false;
      if (!ok) { logger('  retry: không có nút "Làm lại" -> dừng'); break; }
    }
  }
  return { solved: false, reason: 'wrong', attempts: n, ...last };
}

/**
 * Giải 1 QuestionSet: duyệt từng câu, giải ĐÚNG để "Câu tiếp theo" xuất hiện.
 * Trả về thống kê để ước tính điểm.
 * @param {import('playwright').Frame} frame
 * @param {object} qsItem  phần tử readAnswers có kind='questionset' (chứa .sub[])
 * @param {object} opts    { maxQuestions, logger }
 */
async function solveQuestionSet(frame, qsItem, opts = {}) {
  const logger = opts.logger || (() => {});
  const maxQ = opts.maxQuestions || 30;
  const subs = qsItem.sub || [];
  logger(`QuestionSet: ${subs.length} câu trong json`);

  let attempted = 0, correctCount = 0;
  for (let step = 0; step < maxQ; step++) {
    const hasChoice = await countVisible(frame, '.h5p-alternative-container');
    const hasInput = await countVisible(frame, 'input.h5p-text-input');
    const hasDrag = await countVisible(frame, '.h5p-draggable');
    if (!hasChoice && !hasInput && !hasDrag) { logger(`step ${step}: hết câu hỏi`); break; }

    const sub = subs[step];
    const item = { library: sub?.library, kind: sub?.extracted?.kind, data: sub?.extracted };
    attempted++;
    logger(`step ${step}: ${sub?.library || '?'} (choice=${hasChoice} input=${hasInput} drag=${hasDrag})`);

    const attemptFn = async () => {
      if (hasChoice > 0) return solveChoice(frame, item, logger);
      if (hasInput > 0) return solveBlanks(frame, item, logger);
      if (hasDrag > 0) return solveDrag(frame, item, logger);
      return { solved: false };
    };
    const checkFn = async () => { await sleep(250); await pressCheck(frame, logger); await waitFeedback(frame, 1500); };
    const fbFn = async () => frame.evaluate(() => {
      const vis = (sel) => [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null).length;
      return { wrong: vis('.h5p-wrong'), correct: vis('.h5p-correct') };
    }).catch(() => ({}));
    const retryFn = async () => { const ok = await pressRetry(frame, logger); if (ok) await sleep(500); return ok; };

    let rr = { solved: false, correct: 0, wrong: 0 };
    try {
      rr = await answerWithRetry({ attempt: attemptFn, check: checkFn, feedback: fbFn, retry: retryFn, maxAttempts: 3, logger });
    } catch (e) { logger('  solve lỗi:', e.message.slice(0, 40)); }

    const isCorrect = !!rr.solved;
    if (isCorrect) correctCount++;
    const hasNext = await pressNext(frame, logger);
    logger(`  result=${JSON.stringify({ correct: rr.correct, wrong: rr.wrong, attempts: rr.attempts })} correct=${isCorrect} next=${hasNext}`);
    if (hasNext) { await sleep(600); }
    else {
      // Sai -> thử "Đáp án" rồi Next (sang câu sau nhưng không tính điểm)
      const showSol = frame.locator('button:has-text("Đáp án")').first();
      if ((await showSol.count().catch(() => 0)) && (await showSol.isVisible().catch(() => false))) {
        await humanClick(frame, showSol); await sleep(500);
        if (await pressNext(frame, logger)) { await sleep(600); continue; }
      }
      logger('  dừng (không Next được)'); break;
    }
  }

  // Đọc điểm tổng cuối cùng (nếu có màn kết quả)
  const finalScore = await frame.evaluate(() => {
    const txt = (document.body.innerText || '').match(/(\d+)\s*\/\s*(\d+)/);
    const bar = document.querySelector('.h5p-score-bar-progress, .h5p-joubelui-score-bar-progress');
    const summary = (document.querySelector('.h5p-question-score, .h5p-score-bar-text') || {}).innerText || '';
    return { ratio: txt ? { got: +txt[1], total: +txt[2] } : null, barWidth: bar ? bar.style.width : null, summary: summary.slice(0, 60) };
  }).catch(() => ({}));

  return { attempted, correctCount, total: subs.length, finalScore };
}

/**
 * Giải 1 dạng theo extracted. Trả về {solved, ...}
 * @param {import('playwright').Frame} frame
 * @param {object} extracted  một phần tử của readAnswers()
 * @param {function} logger
 */
async function solveOne(frame, item, logger) {
  if (!item) return { solved: false, reason: 'null' };
  // Chuẩn hoá: nhận cả 2 dạng đầu vào
  //  (a) phần tử readAnswers(): { kind, data, library }
  //  (b) sub-item QuestionSet/Book: { index, library, extracted:{kind,...} }
  let kind = item.kind;
  let data = item.data;
  if (!kind && item.extracted) {
    kind = item.extracted.kind;
    data = item.extracted;
  }
  const normalized = { kind, data, library: item.library };
  if (kind === 'choice') return solveChoice(frame, normalized, logger);
  if (kind === 'blanks') return solveBlanks(frame, normalized, logger);
  if (kind === 'dragquestion') return solveDrag(frame, normalized, logger);
  if (kind === 'summary') return solveSummary(frame, normalized, logger);
  return { solved: false, reason: 'unsupported:' + kind };
}

module.exports = { solveOne, solveChoice, solveBlanks, solveDragText, solveDrag, solveSummary, pressCheck, pressNext, pressRetry, pressAllRetries, retryAvailable, answerWithRetry, waitFeedback, FEEDBACK_SEL, solveQuestionSet, countVisible, waitSel, normalizeText };
