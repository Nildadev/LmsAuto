'use strict';
/**
 * question.js — Giải MỘT container câu hỏi (.h5p-question) trong sách online.
 * Scoped theo container để KHÔNG click nhầm sang câu khác trong cùng Column.
 *
 * BUG ĐÃ FIX: click phần tử câu 2+ trượt vì ngoài viewport -> dùng clickEl
 * (scrollIntoViewIfNeeded trước). Đã verify: MC câu 2 chọn được đúng.
 */
const { sleep, humanDelay } = require('../../core/stealth');
const { clickEl, norm } = require('./dom');
const { solveDragText, solveDrag, imgKey } = require('../solver');
const { browserMathSigs } = require('../mathSig');

/** Chọn đáp án Choice (MultiChoice/SingleChoice/TrueFalse/SingleChoiceSet) trong container. */
async function solveChoice(root, container, extracted, logger) {
  // SingleChoiceSet: nhiều slide, mỗi slide 1 câu, click đáp án đúng -> tự sang slide kế.
  if (await container.locator('.h5p-sc-alternative').count().catch(() => 0)) {
    return solveSingleChoiceSet(root, container, extracted, logger);
  }
  // TrueFalse dùng .h5p-true-false-answer, còn lại .h5p-answer.
  let answers = container.locator('.h5p-answer');
  let count = await answers.count().catch(() => 0);
  if (!count) { answers = container.locator('.h5p-true-false-answer'); count = await answers.count().catch(() => 0); }
  if (!count) { answers = container.locator('.h5p-alternative-container'); count = await answers.count().catch(() => 0); }
  if (!count) return { solved: false, reason: 'no-answer-nodes' };

  // Gom visible + text trong MỘT lượt evaluateAll. KHỚP bằng textContent:
  // innerText của MathML trả "𝑓" (U+1D453) còn textContent trả "f" — chỉ
  // textContent mới khớp correctTexts (bug live 22/10/2026, sách "Kính lúp").
  const info = await answers.evaluateAll((els) => els.map((el) => ({
    vis: !!(el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length)),
    inner: el.innerText || '',
    text: el.textContent || '',
    imgs: (el.querySelectorAll ? [...el.querySelectorAll('img')] : [])
      .map((im) => im.getAttribute('src') || im.src || ''),
  }))).catch(() => []);
  const visible = [];
  info.forEach((a, i) => {
    if (a.vis) visible.push({ i, t: norm(a.text || a.inner), inner: norm(a.inner), imgs: a.imgs || [] });
  });
  if (!visible.length) return { solved: false, reason: 'no-visible-answer' };

  const data = extracted.data || extracted;
  const pairs = (data.correctTexts || [])
    .map((t, i) => ({ w: norm(t), sig: (data.correctMath || [])[i] || '' }))
    .filter((p) => p.w);
  const want = pairs.map((p) => p.w);
  const wantImgs = (data.correctImages || []).map(imgKey).filter(Boolean);

  const toClick = [];
  if (want.length) {
    let mathSigs = null;
    const getMathSigs = async () => {
      if (!mathSigs) mathSigs = await answers.evaluateAll(browserMathSigs).catch(() => []);
      return mathSigs;
    };
    for (const { w, sig } of pairs) {
      // Khớp CHÍNH XÁC theo textContent trước; chỉ khi không có mới dùng innerText
      // (nội dung thường 2 nguồn như nhau, MathML thì textContent mới đúng).
      const byText = visible.filter((v) => v.t === w);
      const hits = byText.length ? byText : visible.filter((v) => v.inner === w);
      let hit = null;
      if (hits.length === 1) hit = hits[0];
      else if (hits.length > 1) {
        // randomAnswers=true -> không dùng index; phân biệt bằng cấu trúc MathML
        // (đáp án đúng 25/f và nhiễu "25f" cùng text sau stripHtml).
        // Không khớp đúng chữ ký thì KHÔNG chọn "đại" đáp án có MathML.
        if (sig) {
          const sigs = await getMathSigs();
          hit = hits.find((v) => (sigs[v.i] || '') === sig) || null;
        }
      }
      if (!hit) {
        // Khớp gần CHỈ khi cả hai chuỗi đủ dài (>=4): "5" chứa trong "15" là sai,
        // không phải khớp gần. Nhiều ứng viên = nhập nhằng -> không chọn.
        const near = (key) => visible
          .filter((v) => v[key].length >= 4 && w.length >= 4 && Math.abs(v[key].length - w.length) <= 2
            && (v[key].includes(w) || w.includes(v[key])));
        const nh = near('t');
        const cand = nh.length ? nh : near('inner');
        hit = cand.length === 1 ? cand[0] : null;
      }
      if (hit && !toClick.includes(hit.i)) toClick.push(hit.i);
    }
  }
  // Câu có THỂ trộn đáp án chữ và ảnh -> xét ảnh ĐỘC LẬP, không `else if`
  // (trước đây có chữ là bỏ qua toàn bộ đáp án ảnh -> thiếu lựa chọn).
  if (wantImgs.length) {
    for (const v of visible) {
      if (toClick.includes(v.i)) continue;
      if ((v.imgs || []).some((src) => wantImgs.includes(imgKey(src)))) toClick.push(v.i);
    }
    if (!toClick.length) {
      logger && logger('  choice: đáp án ảnh không khớp src nào -> bỏ qua');
      return { solved: false, reason: 'no-image-match', visible: visible.length };
    }
  }
  if (!want.length && !wantImgs.length) {
    // Không trích được đáp án -> KHÔNG đoán (trước đây chọn hết/cái đầu -> trả lời
    // sai nhưng vẫn báo solved, khiến bài "hoàn thành" oan).
    logger && logger('  choice: không có đáp án trích được -> bỏ qua');
    return { solved: false, reason: 'no-answers', visible: visible.length };
  }

  let clicked = 0;
  for (const i of toClick) {
    await clickEl(root, answers.nth(i), logger);
    await humanDelay();
    clicked++;
  }
  logger && logger(`  choice: clicked ${clicked} (want=${JSON.stringify(want)} visible=${visible.length})`);
  return { solved: clicked > 0, clicked, want };
}

/**
 * Chờ H5P tự chuyển sang slide SCS kế (autoContinue ~2s). Trả:
 * 'advanced' (đã sang slide mới), 'results', 'empty', 'timeout'.
 */
async function waitSlideChange(container, inCur, prevQ, timeoutMs = 4000) {
  const t0 = Date.now();
  // Live 22/10/2026: trong lúc animate autoContinue, H5P GỠ `h5p-sc-current-slide`
  // khỏi mọi slide ~1-2s. Thấy count=0 mà kết luận 'empty' ngay sẽ dừng giữa set
  // (bug mất slide). Chỉ coi là empty khi tình trạng đó kéo dài quá grace.
  let missingSince = 0;
  while (Date.now() - t0 < timeoutMs) {
    if (await container.locator('.h5p-sc-set-results:visible, .h5p-sc-finished:visible').count().catch(() => 0)) return 'results';
    const n = await container.locator('.h5p-sc-current-slide .h5p-sc-alternative').count().catch(() => 0);
    if (!n) {
      if (!missingSince) missingSince = Date.now();
      else if (Date.now() - missingSince > 1200) return 'empty';
    } else {
      missingSince = 0;
      const q = norm(await inCur.locator('.h5p-sc-question').first().innerText().catch(() => ''));
      if (prevQ && q && q !== prevQ) return 'advanced';
    }
    await sleep(150);
  }
  return 'timeout';
}

/**
 * Giải SingleChoiceSet: nhiều slide (.h5p-sc-slide), MỖI LẦN 1 slide hiện.
 * H5P ĐÁNH DẤU sẵn đáp án đúng bằng class `.h5p-sc-is-correct` (không cần
 * extract). Click đáp án đúng -> H5P tự chuyển slide kế. Lặp tới hết slide.
 */
async function solveSingleChoiceSet(root, container, extracted, logger) {
  const data = extracted.data || extracted;
  const texts = (data.correctTexts || []).map(norm).filter(Boolean);
  const wantImgs = (data.correctImages || []).map(imgKey).filter(Boolean);
  let clicks = 0;
  let correct = 0;
  let wrong = 0;
  let done = false;
  let prevQ = null;
  let repeat = 0;

  // H5P chấm NGAY khi click và gắn class reveal lên alternative vừa chọn
  // (`.h5p-sc-is-correct` có sẵn chỉ là metadata nội dung, không phải kết quả).
  const waitOutcome = async (alts, idx, timeoutMs = 2500) => {
    // GIỮ element handle của đáp án vừa bấm: locator `nth()` tự resolve lại theo
    // DOM, nên sau autoContinue nó trỏ sang alternative của slide KẾ (sai kết quả).
    let handle = null;
    try { handle = await alts.nth(idx).elementHandle(); } catch (_) {}
    const readCls = async () => {
      if (handle) return handle.evaluate((el) => String(el.className || '')).catch(() => '');
      return alts.nth(idx).evaluate((el) => String(el.className || '')).catch(() => '');
    };
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const cls = await readCls();
      if (/h5p-sc-reveal-wrong/.test(cls)) return 'wrong';
      if (/h5p-sc-reveal-correct/.test(cls)) return 'correct';
      await sleep(120);
    }
    return 'unknown';
  };

  for (let slide = 0; slide < 20; slide++) {
    // Màn kết quả (đã hết slide) -> dừng. Chỉ coi là "xong" khi ta vừa trả lời
    // ít nhất 1 câu; set đã hoàn thành sẵn từ trước không xác minh được gì.
    if (await container.locator('.h5p-sc-set-results:visible, .h5p-sc-finished:visible').count().catch(() => 0)) {
      done = clicks > 0;
      break;
    }
    // Chỉ xét alternative trong slide ĐANG hiện.
    const cur = container.locator('.h5p-sc-current-slide');
    const inCur = (await cur.count().catch(() => 0)) ? cur : container;
    const alts = inCur.locator('.h5p-sc-alternative');
    const n = await alts.count().catch(() => 0);
    if (!n) break;
    // Chống lặp vô hạn: cùng 1 câu hỏi sau click mà không tiến -> dừng.
    const qText = norm(await inCur.locator('.h5p-sc-question').first().innerText().catch(() => ''));
    if (qText && qText === prevQ) { if (++repeat >= 2) break; }
    else { repeat = 0; prevQ = qText || prevQ; }

    // Ưu tiên class .h5p-sc-is-correct do H5P cung cấp sẵn.
    let target = -1;
    for (let i = 0; i < n; i++) {
      const isCorrect = await alts.nth(i).evaluate((el) => /h5p-sc-is-correct/.test(el.className || '')).catch(() => false);
      if (isCorrect) { target = i; break; }
    }
    // Fallback: khớp text correctTexts.
    if (target < 0 && texts.length) {
      const altTexts = [];
      for (let i = 0; i < n; i++) altTexts.push(norm(await alts.nth(i).innerText().catch(() => '')));
      target = altTexts.findIndex((t) => texts.includes(t));
      if (target < 0) target = altTexts.findIndex((t) => texts.some((w) => t && (t.includes(w) || w.includes(t))));
    }
    // Fallback: đáp án là ẢNH -> khớp theo tên file ảnh (stripHtml làm text rỗng).
    if (target < 0 && wantImgs.length) {
      const imgs = await alts.evaluateAll((els) => els.map((el) => (
        [...el.querySelectorAll('img')].map((im) => im.getAttribute('src') || im.src || '')
      ))).catch(() => []);
      target = imgs.findIndex((list) => (list || []).some((src) => wantImgs.includes(imgKey(src))));
    }
    // Không khớp được đáp án -> DỪNG (KHÔNG click bừa cái đầu: H5P chấm điểm NGAY
    // khi click nên sẽ ghi nhận câu SAI, làm hỏng cả set và báo hoàn thành oan).
    if (target < 0) { logger && logger(`  single-choice-set: slide ${slide} không khớp đáp án -> dừng`); break; }

    await clickEl(root, alts.nth(target), logger).catch(() => {});
    clicks++;
    const outcome = await waitOutcome(alts, target);
    if (outcome === 'correct') correct++;
    else if (outcome === 'wrong') wrong++;
    // KHÔNG sleep cứng 1s: autoContinue của H5P ~2s, ngắn hơn sẽ thấy slide CŨ
    // còn đó -> click LẶP đáp án vừa chọn. Chờ tới khi slide thật sự đổi.
    const moved = await waitSlideChange(container, inCur, qText);
    if (moved === 'results') { done = true; break; }
    if (moved !== 'advanced') break;
  }
  // Chỉ báo solved khi đã tới màn kết quả, không câu nào bị chấm sai và MỌI câu
  // đã click đều được H5P xác nhận đúng (không đoán câu chưa có reveal).
  const solved = done && wrong === 0 && correct > 0 && correct === clicks;
  logger && logger(`  single-choice-set: clicked ${clicks}, correct ${correct}, wrong ${wrong}, done ${done}`);
  return { solved, clicked: clicks, correct, wrong, done };
}


async function solveBlanks(root, container, extracted, logger) {
  const inputs = container.locator('input.h5p-text-input');
  const count = await inputs.count().catch(() => 0);
  // DragText KHÔNG có input text (kéo từ vào ô trống) -> delegate sang solver.
  // (container là Locator, vẫn có .locator()/.page() như Frame.)
  if (!count) {
    if (await container.locator('.h5p-drag-text, .ui-droppable').count().catch(() => 0)) {
      return solveDragText(container, extracted, logger);
    }
    return { solved: false, reason: 'no-input' };
  }
  const answers = (extracted.data || extracted).answers || [];
  let filled = 0;
  for (let i = 0; i < count; i++) {
    const inp = inputs.nth(i);
    if (!(await inp.isVisible().catch(() => false))) continue;
    const val = answers[i] !== undefined ? answers[i] : (answers[0] || '');
    try {
      await inp.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
      await inp.click({ timeout: 3000 });
      await sleep(60);
      await inp.fill('');
      await inp.type(String(val), { delay: 55 });
      filled++;
      await humanDelay();
    } catch (_) {}
  }
  logger && logger(`  blanks: filled ${filled}/${answers.length}`);
  return { solved: filled > 0, filled };
}

/** Giải Summary trong container: li[data-bit=1] là đúng. */
async function solveSummary(root, container, extracted, logger) {
  const claims = container.locator('li[data-name], .summary-claim');
  const count = await claims.count().catch(() => 0);
  if (!count) return { solved: false, reason: 'no-claim' };
  const bits = await container.evaluate((el) =>
    [...el.querySelectorAll('li[data-name]')].map((li) => li.getAttribute('data-bit'))).catch(() => []);
  let clicked = 0;
  const hasBits = bits.length === count && bits.some((b) => b !== null);
  for (let i = 0; i < count; i++) {
    if (hasBits && bits[i] !== '1') continue;
    await clickEl(root, claims.nth(i), logger);
    clicked++;
    await humanDelay();
  }
  logger && logger(`  summary: clicked ${clicked}/${count}`);
  return { solved: clicked > 0, clicked };
}

/** Giải 1 element trong container theo kind. */
async function solveElement(root, container, el, logger) {
  const extracted = { data: el.extracted, library: el.library };
  if (!el.extracted) return { solved: false, reason: 'no-extract:' + el.base };
  switch (el.kind) {
    case 'choice': return solveChoice(root, container, extracted, logger);
    case 'blanks': return solveBlanks(root, container, extracted, logger);
    case 'summary': return solveSummary(root, container, extracted, logger);
    case 'dragquestion': return solveDrag(container, extracted, logger);
    default: return { solved: false, reason: 'unsupported:' + el.kind };
  }
}

module.exports = { solveElement, solveChoice, solveBlanks, solveSummary, solveSingleChoiceSet };
