'use strict';
/**
 * interactiveVideo.js — Điều phối InteractiveVideo: seek tới từng interaction,
 * chọn đáp án đúng (MC/SC/Blanks), cố gắng Summary, hoàn thành video.
 * Đọc đáp án từ H5PIntegration (không brute-force mù).
 */
const { sleep, humanDelay, humanClick } = require('../core/stealth');
const { extractAnswers } = require('./extract');
const { browserMathSigs } = require('./mathSig');
const { solveBlanks, solveDragText, pressAllRetries, waitFeedback, imgKey } = require('./solver');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ── Phán quyết 1 mốc có được tính "đã giải" không ──────────────────────────
 * Selector feedback ĐỌC ĐƯỢC SAU khi bấm Kiểm tra.
 * LƯU Ý QUAN TRỌNG (verify live 22/10/2026):
 *   • KHÔNG đưa `.h5p-sc-is-correct` / `.h5p-sc-is-wrong` vào đây. H5P.
 *     SingleChoiceSet gắn 2 class đó cho MỌI đáp án NGAY TỪ ĐẦU (metadata nội
 *     dung, không phải kết quả). Đếm chúng sẽ báo sai oan.
 *   • Cũng KHÔNG đưa `.h5p-sc-reveal-correct|wrong`: sau khi trả lời, H5P gắn
 *     reveal-wrong cho MỌI đáp án sai của slide (kể cả đáp án không chọn) ->
 *     5/5 câu đúng vẫn bị đếm thành bad=1. Kết quả SCS lấy từ
 *     answerSingleChoiceSet (chỉ xét đáp án ĐÃ CHỌN, cộng vào scsWrong).
 * `.h5p-correct/.h5p-wrong` là feedback thật của MultiChoice/TrueFalse. */
const FB_CORRECT_SEL = '.h5p-correct, .multichoice-tip.h5p-correct, .h5p-question-plus-one, .h5p-true-false-answer.correct';
const FB_WRONG_SEL = '.h5p-wrong, .multichoice-tip.h5p-wrong, .h5p-question-minus-one, .h5p-true-false-answer.incorrect';
// Node NỘI DUNG trả lời thật của dialog. KHÔNG đưa nút "Kiểm tra"/"Tiếp tục" vào:
// live Tin B3 mốc 1086s render nút trước 2 đáp án TrueFalse -> waitDialog trả về
// sớm, inventory thấy 0 đáp án, bỏ trắng mốc dù dialog đã mở.
const DIALOG_CONTENT_SELECTOR = '.h5p-answer, .h5p-true-false-answer, .h5p-sc-alternative,'
  + ' input.h5p-text-input, .h5p-summary li[data-bit],'
  + ' .h5p-mark-the-words span[role=option], .h5p-draggable,'
  // DragText: đáp án nằm ở từ kéo (.ui-draggable) và ô thả (.ui-droppable),
  // KHÔNG có .h5p-draggable/.h5p-answer -> thiếu 2 selector này thì dialog
  // DragText bị coi là "không có nội dung" và mốc bị bỏ trắng.
  + ' .h5p-drag-text .ui-draggable, .h5p-drag-text .ui-droppable';

/**
 * Quyết định kết quả 1 mốc từ số liệu feedback (thuần logic -> test được offline).
 *   bad > 0                  -> 'wrong'      (có câu SAI: KHÔNG tính là đã giải)
 *   ok > 0 | handled > 0     -> 'solved'     (đã trả lời & không có câu sai)
 *   còn lại                  -> 'unverified' (dialog mở nhưng KHÔNG thao tác được
 *                                            câu nào -> chưa xác minh, không tính)
 * Trước đây rơi vào nhánh else -> solvedCount++ nên mốc bỏ trắng vẫn được tính xong.
 */
function verdictOf(fb) {
  const bad = (fb && fb.bad) || 0;
  const ok = (fb && fb.ok) || 0;
  const handled = (fb && fb.handled) || 0;
  const unverified = (fb && fb.unverified) || 0;
  const checkFailed = (fb && fb.checkFailed) || 0;
  if (bad > 0) return 'wrong';
  // Có phần chưa xác định (vd dòng Summary không có data-bit/không khớp text).
  if (unverified > 0) return 'unverified';
  // Feedback dương tính là bằng chứng mạnh nhất.
  if (ok > 0) return 'solved';
  // Đã thao tác nhưng KHÔNG bấm được Kiểm tra -> chưa có gì xác nhận đúng.
  if (handled > 0 && !checkFailed) return 'solved';
  return 'unverified';
}

/**
 * Chốt số liệu cuối bài IV. Mốc không xử lý được (không mở dialog, hết deadline,
 * chưa load kịp đáp án) KHÔNG được bỏ qua âm thầm: cộng vào `unverified` để
 * flow.js không markComplete khi còn câu chưa xác minh.
 * `skippedEmpty` (Blanks 0 ô trống) không phải câu hỏi -> chỉ giảm `total`.
 */
function settleVideoCounts({ jobCount, doneCount, skippedEmpty, solved, wrong, unverified }) {
  const missed = Math.max(0, jobCount - doneCount - (skippedEmpty || 0));
  return {
    solved: solved || 0,
    total: Math.max(0, jobCount - (skippedEmpty || 0)),
    wrong: wrong || 0,
    unverified: (unverified || 0) + missed,
  };
}

/** Đọc danh sách interactions từ H5PIntegration trong frame (hoặc từ jsonContent truyền vào). */
async function readInteractions(frame, jsonOverride) {
  let jc = jsonOverride;
  if (!jc) {
    jc = await frame.evaluate(() => {
      try {
        const c = window.H5PIntegration && window.H5PIntegration.contents;
        const k = c && Object.keys(c)[0];
        let j = c && c[k] && c[k].jsonContent;
        if (typeof j === 'string') { try { j = JSON.parse(j); } catch (_) {} }
        return j || null;
      } catch (_) { return null; }
    }).catch(() => null);
  }
  // H5P InteractiveVideo có 2 cách lồng nhau:
  //  - Đứng riêng: jsonContent = { interactiveVideo:{...}, override:{...}, l10n:{...} }
  //  - Lồng trong IB/CP: caller truyền { params: <IV params> } -> override nằm ở
  //    jc.params.override (NGANG HÀNG với jc.params.interactiveVideo).
  let iv = jc && jc.interactiveVideo;
  let root = jc || {};
  if (!iv && jc && jc.params && jc.params.interactiveVideo) { iv = jc.params.interactiveVideo; root = jc.params; }
  // `readable`: phân biệt RÕ "video không có câu hỏi" vs "KHÔNG đọc được H5PIntegration"
  // (nếu không đọc được thì không biết bài có câu hỏi hay không -> log cảnh báo, không
  // âm thầm coi như video-chỉ-xem).
  const readable = !!(iv);
  iv = iv || {};
  const assets = iv.assets || {};
  // QUAN TRỌNG: preventSkippingMode nằm ở `override` NGANG HÀNG với `interactiveVideo`
  // (KHÔNG lồng trong nó). Trước đây đọc iv.override -> luôn undefined -> seekLocked
  // luôn false -> bài khoá tua bị xử như bài cho tua (seek không ăn -> kẹt/mất câu).
  // Hỗ trợ cả 2 vị trí để chắc chắn nhận diện đúng bài khoá tua vs bài cho tua.
  const ov = (iv.override && iv.override.preventSkippingMode != null)
    ? iv.override
    : (root.override || iv.override || {});
  const sm = String(ov.preventSkippingMode || 'none').toLowerCase();
  const locked = sm === 'forward' || sm === 'both';
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
      from: Number(iv.summary.displayAt) || 0,
      to: 0,
      isSummary: true,
      library: sum.library,
      params: sum.params,
    });
  }
  return { items: out, seekLocked: locked, preventSkippingMode: sm, readable, summaryDisplayAt: Number(iv.summary && iv.summary.displayAt) || 0 };
}

function kindOf(library) {
  const l = library || '';
  if (/MultiChoice|SingleChoice|TrueFalse/.test(l)) return 'choice';
  if (/Blanks|DragText|MarkTheWords/.test(l)) return 'blanks';
  if (/Summary/.test(l)) return 'summary';
  return 'other';
}

/**
 * Mốc chỉ có MỘT interaction Blanks nhưng nội dung KHÔNG có ô trống nào
 * (0 input, 0 đáp án trích được) — nội dung lỗi, không có gì để trả lời.
 * Live 22/10/2026 (Tin B3): params.questions chỉ có "Sóng điện từ." không có
 * dấu * -> H5P render 0 input, chỉ có nút Kiểm tra; đếm là "chưa xác minh"
 * sẽ chặn hoàn thành oan.
 */
function isEmptyBlanksOnly(group, inputCount) {
  if (!group || group.length !== 1) return false;
  const g = group[0];
  if (!g || g.kind !== 'blanks') return false;
  if (Number(inputCount) > 0) return false;
  const answers = (g.extracted && (g.extracted.answers
    || (g.extracted.data && g.extracted.data.answers))) || [];
  return !answers.length;
}

/** Mốc chỉ có 1 Blanks rỗng -> mở ngắn xác nhận DOM rồi bỏ qua (không tính câu hỏi). */
function isEmptyBlanksStop(items, from) {
  const group = (items || []).filter((it) => !it.isSummary && it.from === from);
  return isEmptyBlanksOnly(group, 0);
}

/**
 * Phân loại kết quả dò mốc Blanks rỗng (JSON 0 đáp án):
 *   'content' — dialog có node nội dung -> xử lý bình thường.
 *   'empty'   — dialog ĐÃ mở nhưng không có node nội dung -> đúng là mốc rỗng,
 *               bỏ qua và KHÔNG tính vào tổng số câu.
 *   'missed'  — dialog KHÔNG mở -> chưa chứng minh được là rỗng; phải xử lý
 *               như mốc bị bỏ (unverified), KHÔNG được trừ khỏi tổng.
 * Trước đây "hết 1.5s không thấy nội dung" bị coi là rỗng kể cả khi nút/marker
 * không mở được dialog -> bài còn câu chưa làm vẫn có thể mark_complete oan.
 */
function classifyBlanksProbe(snap) {
  if (snap && snap.hasQ) return 'content';
  if (snap && snap.hasDialog) return 'empty';
  return 'missed';
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
async function answerChoiceInPopup(frame, qc, extracted, logger, library) {
  // MultiChoice dùng .h5p-answer; TrueFalse dùng .h5p-true-false-answer (live
  // Tin B3 22/10/2026: popup TrueFalse không có .h5p-answer -> bị bỏ qua hoàn toàn).
  let answers = qc.locator('.h5p-answer');
  let count = await answers.count().catch(() => 0);
  if (!count) {
    answers = qc.locator('.h5p-true-false-answer');
    count = await answers.count().catch(() => 0);
  }
  if (!count) return { solved: false, reason: 'no-answer-node', count: 0 };

  // Chuẩn hoá text để khớp robust (bỏ dấu, gộp space, bỏ mọi ký tự lạ).
  const norm = (s) => String(s || '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[^\p{L}\p{N}]/gu, '')  // bỏ space/dấu câu, giữ chữ+số (mọi script)
    .toLowerCase();

  // Thu thập answer visible + text trong 1 lượt (trước đây isVisible + innerText
  // cho TỪNG đáp án = 2 round-trip/đáp án). KHỚP bằng textContent: innerText của
  // MathML trả ký tự toán học ("𝑓" U+1D453) còn textContent trả "f" — dùng
  // innerText sẽ không khớp đáp án phân số và click nhầm nhiễu (bug live 22/10/2026).
  const info = await answers.evaluateAll((els) => els.map((el) => ({
    vis: !!(el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length)),
    inner: el.innerText || '',
    text: el.textContent || '',
    // Đáp án là ẢNH: text rỗng -> phải khớp theo src (cùng chuẩn với solver sách).
    imgs: (el.querySelectorAll ? [...el.querySelectorAll('img')] : [])
      .map((im) => im.getAttribute('src') || im.src || ''),
  }))).catch(() => []);
  const visible = [];
  info.forEach((a, i) => {
    if (a.vis) visible.push({ i, raw: a.text || a.inner, t: norm(a.text || a.inner), inner: norm(a.inner), imgs: a.imgs || [] });
  });
  if (!visible.length) return { solved: false, reason: 'no-visible-answer' };

  const texts = (extracted && extracted.correctTexts) || [];
  const maths = (extracted && extracted.correctMath) || [];
  const wantImgs = ((extracted && extracted.correctImages) || []).map(imgKey).filter(Boolean);
  // KHÔNG đoán khi không có căn cứ: H5P chấm ngay khi click -> bấm bừa = ghi SAI.
  if (!texts.length && !wantImgs.length) {
    logger && logger('    choice: không có đáp án text/ảnh trích được -> KHÔNG click');
    return { solved: false, reason: 'no-answers', clicked: 0, total: count };
  }
  let clicked = 0;
  const picked = new Set();
  let mathSigs = null;
  // Chỉ đọc chữ ký MathML 1 lần và chỉ khi text trùng nhau (randomAnswers
  // khiến "G = 25f" và phân số 25/f cùng normalize thành "g25f").
  const getMathSigs = async () => {
    if (!mathSigs) mathSigs = await answers.evaluateAll(browserMathSigs).catch(() => []);
    return mathSigs;
  };
  if (texts.length) {
    for (let ti = 0; ti < texts.length; ti++) {
      const w = norm(texts[ti]);
      if (!w) continue;
      const sig = maths[ti] || '';
      // exact -> contains (cả 2 chiều) để chịu được MathML render khác JSON.
      // Giới hạn chênh lệch độ dài <=2 để tránh khớp siêu chuỗi ("cat" ~ "category").
      // Khớp CHÍNH XÁC theo textContent trước; chỉ khi không có mới dùng innerText.
      const hitsOf = (key) => {
        const byText = visible.filter(v => v.t === key);
        return byText.length ? byText : visible.filter(v => v.inner === key);
      };
      const hits = hitsOf(w);
      let hit = null;
      if (hits.length === 1) hit = hits[0];
      else if (hits.length > 1 && sig) {
        // Chỉ nhận khi đúng chữ ký cấu trúc MathML. Không khớp -> để trống
        // (KHÔNG chọn "đại một đáp án có MathML" — đó là đoán).
        const sigs = await getMathSigs();
        hit = hits.find(v => (sigs[v.i] || '') === sig) || null;
      }
      if (!hit) {
        // Khớp gần CHỈ khi cả hai chuỗi đủ dài (>=4): "5" chứa trong "15" là sai.
        // Nhiều ứng viên = nhập nhằng -> không chọn.
        const near = (key) => visible
          .filter(v => v[key].length >= 4 && w.length >= 4 && Math.abs(v[key].length - w.length) <= 2
            && (v[key].includes(w) || w.includes(v[key])));
        const nh = near('t');
        const cand = nh.length ? nh : near('inner');
        hit = cand.length === 1 ? cand[0] : null;
      }
      if (hit && !picked.has(hit.i)) {
        await selectAt(answers, hit.i);
        if (await isSelected(answers.nth(hit.i))) clicked++;
        picked.add(hit.i);
      }
    }
  }
  // Đáp án ẢNH (kể cả câu trộn text + ảnh): khớp basename src.
  if (wantImgs.length) {
    for (const v of visible) {
      if (picked.has(v.i)) continue;
      if ((v.imgs || []).some((src) => wantImgs.includes(imgKey(src)))) {
        await selectAt(answers, v.i);
        if (await isSelected(answers.nth(v.i))) clicked++;
        picked.add(v.i);
      }
    }
  }
  logger && logger(`    choice matched ${clicked} want=${JSON.stringify(texts)} imgs=${JSON.stringify(wantImgs)} visible=${JSON.stringify(visible.map(v => v.raw))}`);
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
 * Chọn slide (`choices[k]`) đang hiện theo câu hỏi đọc từ DOM.
 * Khớp đúng > khớp lỏng; question rỗng -> slide chưa dùng đầu tiên.
 * Trả -1 khi có qText mà không slide nào khớp (caller dùng danh sách đáp án gộp).
 */
function pickScSlide(choices, used, qText, norm) {
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < choices.length; i++) {
    if (used.has(i)) continue;
    const q = norm((choices[i] && choices[i].question) || '');
    let score = 0;
    if (qText && q) {
      if (q === qText) score = 100;
      else if (q.includes(qText) || qText.includes(q)) score = 50;
      else score = -1;
    }
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

/**
 * Giải SingleChoiceSet (IV lồng). ĐẶC ĐIỂM DOM đã verify live 22/10/2026:
 *   • Mỗi câu là 1 `.h5p-sc-slide`; slide hiện tại có `.h5p-sc-current-slide`,
 *     màn kết quả có `.h5p-sc-set-results` (không còn alternative).
 *   • MỌI alternative mang sẵn class NỘI DUNG `h5p-sc-is-correct` /
 *     `h5p-sc-is-wrong` NGAY TỪ ĐẦU — đây KHÔNG phải feedback. Vì vậy chọn đúng
 *     bằng class `h5p-sc-is-correct` của slide hiện tại, không đoán theo text.
 *   • Click xong H5P gắn `h5p-sc-selected` + `h5p-sc-reveal-correct|wrong`, rồi
 *     autoContinue ~2s mới sang slide kế. Phải CHỜ slide đổi thay vì sleep ngắn:
 *     bản cũ sleep 350ms nên đọc lại vẫn thấy slide cũ -> tưởng hết bài, chỉ trả
 *     lời được câu đầu (bug live "clicked 1 / ok=0 bad=3").
 * KHÔNG có nút "Kiểm tra" — click là tính điểm ngay.
 * Trả {solved, clicked, correct, wrong, done}: solved chỉ true khi đã tới màn
 * kết quả, không có câu bị chấm sai và có ít nhất 1 câu đúng được xác nhận.
 */
async function answerSingleChoiceSet(frame, extracted, logger) {
  const norm = (s) => String(s || '')
    .replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ')
    .replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  // Đáp án đúng dự phòng (chỉ dùng khi DOM không có class nội dung).
  const texts = [];
  const pushT = (t) => { const n = norm(t); if (n) texts.push(n); };
  if (extracted && extracted.correctTexts) extracted.correctTexts.forEach(pushT);
  if (extracted && extracted.data && extracted.data.correctTexts) extracted.data.correctTexts.forEach(pushT);
  const choices = (extracted && extracted.choices) || (extracted && extracted.data && extracted.data.choices) || [];
  choices.forEach((ch) => (ch.answers || []).forEach((a) => { if (a && a.correct) pushT(a.text); }));

  // CHỈ slide của SCS đang mở. H5P giữ DOM các dialog SCS đã đóng -> locator
  // toàn frame sẽ đọc/click cả slide ẩn của mốc trước (sai câu, sai điểm).
  const slidesLoc = frame.locator('.h5p-single-choice-set:visible .h5p-sc-slide');
  // Đọc TOÀN BỘ slide trong 1 round-trip (text + class của từng alternative).
  const readState = async () => slidesLoc.evaluateAll((els) => els.map((el) => ({
    cls: String(el.className || ''),
    q: String((el.querySelector('.h5p-sc-question') || {}).innerText || ''),
    alts: [...el.querySelectorAll('.h5p-sc-alternative')].map((a) => ({
      txt: String(a.innerText || a.textContent || ''),
      cls: String(a.className || ''),
    })),
  }))).catch(() => []);

  let clicked = 0;
  let correct = 0;
  let wrong = 0;
  let done = false;
  const counted = new Set(); // mỗi slide chỉ tính kết quả 1 lần
  const usedChoices = new Set();

  // Đếm kết quả của slide đã được trả lời sẵn (retry mở lại) hoặc vừa click.
  const countSlide = (st, idx) => {
    if (counted.has(idx) || !st[idx]) return;
    const sel = st[idx].alts.findIndex((a) => /h5p-sc-selected/.test(a.cls));
    if (sel < 0) return;
    counted.add(idx);
    if (/h5p-sc-reveal-wrong/.test(st[idx].alts[sel].cls)) wrong++;
    else if (/h5p-sc-reveal-correct/.test(st[idx].alts[sel].cls)) correct++;
  };
  // Chờ H5P chấm + gắn class reveal cho đáp án vừa bấm.
  const waitOutcome = async (slideIdx, altIdx, timeoutMs) => {
    const end = Date.now() + timeoutMs;
    let sawSelected = false;
    while (Date.now() < end) {
      const st = await readState();
      const a = st[slideIdx] && st[slideIdx].alts[altIdx];
      if (a) {
        if (/h5p-sc-reveal-wrong/.test(a.cls)) return 'wrong';
        if (/h5p-sc-reveal-correct/.test(a.cls)) return 'correct';
        if (/h5p-sc-selected/.test(a.cls)) sawSelected = true;
      }
      await sleep(120);
    }
    return sawSelected ? 'selected' : 'unknown';
  };
  // Chờ slide hiện tại đổi (autoContinue) hoặc màn kết quả hiện.
  const waitAdvance = async (curIdx, timeoutMs) => {
    const end = Date.now() + timeoutMs;
    let triedNext = false;
    while (Date.now() < end) {
      const st = await readState();
      const ci = st.findIndex((s) => /h5p-sc-current-slide/.test(s.cls));
      if (ci >= 0 && ci !== curIdx) { countSlide(st, curIdx); return true; }
      // autoContinue=false: phải tự bấm "Câu hỏi tiếp theo".
      if (!triedNext && Date.now() > end - timeoutMs + 1000) {
        triedNext = true;
        const nxt = frame.locator('.h5p-sc-next:visible').first();
        if (await nxt.count().catch(() => 0)) await humanClick(frame, nxt).catch(() => {});
      }
      await sleep(200);
    }
    return false;
  };

  // Mỗi slide có thể tốn 2 vòng (click + chờ autoContinue), cộng vòng màn kết
  // quả -> nếu chỉ choices+3 thì task 6 câu bị cắt sau câu 5 (bug live 22/10/2026).
  const initialSt = await readState();
  const slideCount = initialSt.filter((s) => !/h5p-sc-set-results/.test(s.cls)).length;
  const maxSteps = Math.max(12, Math.max(slideCount, choices.length) * 3 + 3);
  for (let step = 0; step < maxSteps; step++) {
    let st = await readState();
    let curIdx = st.findIndex((s) => /h5p-sc-current-slide/.test(s.cls));
    if (curIdx < 0) {
      // Đã trả lời đủ slide -> xong (màn kết quả không nhận current-slide).
      const qCount = st.filter((s) => !/h5p-sc-set-results/.test(s.cls)).length;
      if (qCount > 0 && counted.size >= qCount) { done = true; break; }
      // Live 22/10/2026: H5P GỠ `h5p-sc-current-slide` khỏi mọi slide trong lúc
      // animate chuyển slide (autoContinue ~2s) -> đọc lại tối đa 3s, không dừng
      // sớm (bug bỏ slide cuối: clicked 5/6).
      for (let r = 0; r < 20 && curIdx < 0; r++) {
        await sleep(150);
        st = await readState();
        curIdx = st.findIndex((s) => /h5p-sc-current-slide/.test(s.cls));
      }
    }
    if (curIdx < 0) break;
    const cur = st[curIdx];
    if (/h5p-sc-set-results/.test(cur.cls)) {
      // Quét lại các slide trước khi kết luận (trường hợp đã trả lời sẵn).
      st.forEach((_, i) => countSlide(st, i));
      done = true;
      break;
    }
    if (!cur.alts.length) {
      logger && logger(`  ⚠️ single-choice-set: slide ${curIdx} không có đáp án -> dừng`);
      break;
    }

    // Slide đã được trả lời -> chờ H5P tự sang slide kế, KHÔNG bấm lại.
    if (cur.alts.some((a) => /h5p-sc-selected/.test(a.cls))) {
      countSlide(st, curIdx);
      if (!(await waitAdvance(curIdx, 5000))) {
        logger && logger(`  ⚠️ single-choice-set: kẹt ở slide ${curIdx} (không tự chuyển) -> dừng`);
        break;
      }
      continue;
    }

    // Nguồn sự thật: class nội dung của slide ĐANG hiện.
    let target = cur.alts.findIndex((a) => /h5p-sc-is-correct/.test(a.cls));
    if (target < 0) {
      // Fallback text — khớp theo đúng slide; bỏ mọi chuỗi rỗng để không bấm
      // vào alternative trống của slide trống.
      const qText = norm(cur.q);
      const slideIdx = pickScSlide(choices, usedChoices, qText, norm);
      if (slideIdx >= 0) usedChoices.add(slideIdx);
      const slideCorrect = slideIdx >= 0
        ? (choices[slideIdx].answers || []).filter((a) => a.correct).map((a) => norm(a.text)).filter(Boolean)
        : [];
      const want = (slideCorrect.length ? slideCorrect : texts).filter(Boolean);
      const altTexts = cur.alts.map((a) => norm(a.txt));
      target = altTexts.findIndex((t) => t && want.includes(t));
      if (target < 0) target = altTexts.findIndex((t) => t && want.some((w) => t.includes(w) || w.includes(t)));
    }
    // Không xác định được đáp án -> DỪNG (H5P chấm ngay khi click, bấm bừa = SAI).
    if (target < 0) {
      logger && logger(`  ⚠️ single-choice-set: slide ${curIdx} không khớp đáp án -> dừng`);
      break;
    }

    const alt = slidesLoc.nth(curIdx).locator('.h5p-sc-alternative').nth(target);
    await humanClick(frame, alt).catch(() => {});
    clicked++;
    let out = await waitOutcome(curIdx, target, 2000);
    if (out === 'unknown') {
      // Click chuột có thể bị overlay chặn -> bắn click DOM 1 lần rồi chờ lại.
      try { await alt.evaluate((el) => el.click()); } catch (_) {}
      out = await waitOutcome(curIdx, target, 1500);
    }
    if (out === 'correct') { correct++; counted.add(curIdx); }
    else if (out === 'wrong') { wrong++; counted.add(curIdx); }
    else if (out === 'unknown') {
      logger && logger(`  ⚠️ single-choice-set: click slide ${curIdx} không được H5P ghi nhận -> dừng`);
      break;
    }
    // 'selected' (chưa kịp reveal) -> vòng lặp sau thấy selected sẽ chờ chuyển slide.
  }

  // Live IV 1.27 / SCS 1.11: sau slide CUỐI, màn `.h5p-sc-set-results` không nhận
  // class `h5p-sc-current-slide` -> vòng lặp dừng với done=false dù đã trả lời đủ.
  // H5P cũng GỠ `h5p-sc-selected` khỏi các slide cũ, nên không thể kiểm tra bằng
  // class hiện tại: dùng số slide đã được chấm (counted, bền qua các lần đọc).
  if (!done) {
    const st = await readState();
    const qCount = st.filter((s) => !/h5p-sc-set-results/.test(s.cls)).length;
    done = qCount > 0 && counted.size >= qCount;
  }

  const solved = done && wrong === 0 && correct > 0;
  logger && logger(`    single-choice-set clicked ${clicked}, correct ${correct}, wrong ${wrong}, done ${done}`);
  return { solved, clicked, correct, wrong, done };
}

/**
 * Giải MarkTheWords (IV lồng): mỗi từ là `span[role="option"]` bên trong
 * `.h5p-word-selectable-words`; click để bật/tắt `aria-selected`. Đáp án đúng
 * lấy từ extractBlanks (`params.text` có các từ bọc `*...*`).
 *
 * QUAN TRỌNG: MarkTheWords KHÔNG có `.h5p-answer` (khác MultiChoice) nên nhánh
 * choice cũ bỏ qua hoàn toàn -> H5P không ghi nhận câu trả lời -> nội dung
 * không bao giờ "hoàn thành" (bài video + tài liệu kẹt 50%).
 */
async function answerMarkTheWords(frame, extracted, logger) {
  const norm = (s) => String(s || '')
    .replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ')
    .replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const words = frame.locator('.h5p-word-selectable-words span[role="option"]');
  // Đọc text + aria-selected của TẤT CẢ từ trong 1 lượt (trước đây 2 round-trip/từ).
  const info = await words.evaluateAll((els) => els.map((el) => ({
    txt: el.innerText || el.textContent || '',
    sel: el.getAttribute('aria-selected') === 'true',
  }))).catch(() => []);
  const n = info.length;
  if (!n) return { solved: false, reason: 'no-words', count: 0 };
  const want = (((extracted && extracted.answers) || [])).map(norm).filter(Boolean);
  let clicked = 0;
  for (let i = 0; i < n; i++) {
    const txt = norm(info[i].txt);
    if (!txt) continue;
    const shouldMark = want.some((w) => w === txt || txt.includes(w) || w.includes(txt));
    if (shouldMark !== info[i].sel) {
      await humanClick(frame, words.nth(i)).catch(() => {});
      await sleep(140);
      clicked++;
    }
  }
  logger && logger(`    mark-the-words marked ${clicked}/${n} want=${JSON.stringify(want)}`);
  return { solved: clicked > 0 || want.length > 0, clicked, total: n };
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

/**
 * Click một nút chắc chắn: Playwright click (tự cuộn vào viewport + hit-test)
 * trước, fallback DOM click. KHÔNG dùng humanClick theo toạ độ: live 22/10/2026
 * (Tin B3, TrueFalse 1.8) nút "Kiểm tra" nằm ngoài viewport -> humanClick bấm
 * trượt, không có feedback, mốc bị coi là "chưa xác minh" dù đã chọn đáp án.
 */
async function robustClick(locator) {
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
    await locator.click({ timeout: 2500 });
    return true;
  } catch (_) {
    return await locator.evaluate((el) => el.click()).then(() => true).catch(() => false);
  }
}

/** Bấm nút Kiểm tra/Gửi trả lời TRONG 1 question container (chờ enabled). */
async function pressCheckIn(qc, logger) {
  const sel = qc.locator('.h5p-question-check-answer, .h5p-question-submit, button.h5p-question-visible').first();
  if (!(await sel.count().catch(() => 0))) return false;
  // H5P disable nút cho tới khi có lựa chọn -> chờ enabled (đọc trạng thái 1 lượt/vòng
  // thay vì 2 lượt getAttribute).
  for (let i = 0; i < 8; i++) {
    const st = await sel.evaluate((el) => ({ d: el.hasAttribute('disabled'), a: el.getAttribute('aria-disabled') })).catch(() => null);
    if (!st || (!st.d && st.a !== 'true')) break;
    await sleep(200);
  }
  const ok = await robustClick(sel);
  logger && logger(ok ? '    pressed check-in' : '    ⚠️ không bấm được nút Kiểm tra');
  return ok;
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
  await sleep(800);
}

/** Giải Summary trong khung .h5p-summary (qc). */
async function answerSummaryInPopup(frame, qc, extracted, logger) {
  const rows = qc.locator('li[data-bit], .h5p-summary-row, li');
  // Đọc text + data-bit của TẤT CẢ dòng trong 1 lượt (trước đây textContent +
  // getAttribute cho TỪNG dòng = 2 round-trip/dòng).
  const info = await qc.evaluate((el) => [...el.querySelectorAll('li[data-bit], .h5p-summary-row, li')]
    .map((r) => ({ txt: (r.innerText || r.textContent || '').trim(), bit: r.getAttribute('data-bit') }))
  ).catch(() => []);
  const n = info.length;
  if (!n) return { solved: false, reason: 'no-summary-row' };
  const data = (extracted && extracted.rows) || [];
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  let clicked = 0;
  let unverified = 0;
  for (let i = 0; i < n; i++) {
    const { txt, bit } = info[i];
    // Ưu tiên data-bit trong DOM (H5P ghi sẵn 1=đúng/0=sai — đáng tin hơn so khớp
    // text). Chỉ khi không có mới dò theo JSON. KHÔNG mặc định "đúng" khi cả hai
    // đều không có: toggle bừa sẽ ghi trạng thái sai và không thể xác minh.
    let isCorrect;
    if (bit === '1') isCorrect = true;
    else if (bit === '0') isCorrect = false;
    else {
      // rows phẳng {text, correct} (extractSummary): khớp CHÍNH XÁC text câu.
      const r = data.find(d => norm(d.text) === norm(txt));
      if (!r) {
        unverified++;
        logger && logger(`    summary: dòng "${String(txt).slice(0, 60)}" không xác định đúng/sai -> bỏ trống`);
        continue;
      }
      isCorrect = !!r.correct;
    }
    // H5P Summary toggle 3 trạng thái: unselected -> correct(đúng) -> incorrect(sai) -> unselected.
    // Muốn đúng: click 1 lần. Muốn sai: click 2 lần. Bắt đầu từ unselected.
    await humanClick(frame, rows.nth(i));
    await sleep(150);
    if (!isCorrect) { await humanClick(frame, rows.nth(i)); await sleep(150); }
    clicked++;
  }
  logger && logger(`    summary clicked ${clicked}/${n}${unverified ? ` (${unverified} dòng chưa xác định)` : ''}`);
  return { solved: clicked > 0, clicked, total: n, unverified };
}

/**
 * Chạy toàn bộ video: PLAY (không seek) để H5P tự pause ở mỗi interaction,
 * poll dialog -> giải -> submit -> tiếp tục. Đã verify: play playbackRate cao
 * thì H5P trigger dialog đúng, seek thì không.
 * @returns {Promise<{solved:number,total:number}>}
 */
async function solveVideo(frame, logger = log, jsonOverride) {
  const ri = await readInteractions(frame, jsonOverride);
  const interactions = ri.items || ri;
  const mode = (ri && ri.preventSkippingMode) || 'none';
  const seekLocked = !!(ri && ri.seekLocked);

  // Video KHÔNG có câu hỏi (chỉ cần xem): không cần tua/play -> chỉ đánh dấu hoàn
  // thành. Kiểm tra TRƯỚC cờ khoá tua để video-khoá-tua-không-câu-hỏi vẫn được tính
  // hoàn thành (thay vì bị bỏ qua oan).
  if (!interactions.length) {
    if (ri && ri.readable === false) {
      logger('  ⚠️ Không đọc được H5PIntegration — không xác định được bài có câu hỏi hay không; coi như video chỉ cần xem');
    } else {
      logger(`IV: không có interactions (video chỉ cần xem)${seekLocked ? ` — khoá tua (${mode}) nhưng không cần tua` : ''}`);
    }
    return { solved: 0, total: 0, noQuestions: true };
  }
  // BÀI KHÓA TUA (preventSkipping = forward|both): có câu hỏi nhưng KHÔNG thể tua tới
  // mốc -> chỉ còn cách play xuyên suốt theo THỜI GIAN THỰC (rất chậm, dễ treo phiên
  // hàng chục phút/bài). Theo yêu cầu: BỎ QUA (không tính lỗi, không markComplete).
  if (seekLocked) {
    logger(`  ⏭️ Bỏ qua bài khoá tua (preventSkipping=${mode}) — không thể seek tới mốc câu hỏi`);
    return { solved: 0, total: 0, skippedLocked: true };
  }
  logger(`  🔓 Bài cho tua (preventSkipping=${mode}) — giải bằng seek`);
  const list = await extractList(interactions);
  logger(`IV: ${list.length} interactions [${list.map(l => `${l.i}@${l.from}s:${l.kind}`).join(' ')}]`);

  let solvedCount = 0;
  let wrongCount = 0;      // số mốc có câu SAI -> bài KHÔNG được coi là hoàn thành
  let unverifiedCount = 0; // số mốc mở dialog nhưng KHÔNG thao tác được câu nào
  let skippedEmpty = 0;    // mốc Blanks lỗi 0 ô trống -> không tính vào total
  let doneCount = 0;       // số job đã có phán quyết (solved/wrong/unverified)
  // Gom interaction theo mốc thời gian (from). Tại 1 mốc, H5P hiện TẤT CẢ
  // interaction cùng from trong CÙNG 1 dialog (summary + nhiều MC cùng lúc).
  // LOẠI summary khỏi stops: nó là nút "Mở tóm tắt" ở CUỐI video, xử lý riêng.
  const stops = [...new Set(list.filter(l => !l.isSummary).map(l => l.from))].sort((a, b) => a - b);
  // Chỉ mở dialog Tóm tắt khi có phát biểu để trả lời. Nhiều bài IV có task
  // Summary rỗng (summaries[].summary không có câu nào) — mở dialog khi đó chỉ
  // tốn ~18s chờ vô ích rồi bỏ qua (bug hiệu năng gặp ở bài Ngữ Văn 9).
  const sumItem = list.find(l => l.isSummary);
  const hasSummary = !!sumItem && ((sumItem.extracted && sumItem.extracted.rows) || []).length > 0;
  if (sumItem && !hasSummary) logger('IV: Tóm tắt rỗng (không có phát biểu) -> bỏ qua, không mở dialog');
  const deadline = Date.now() + 300000; // tối đa 5 phút
  logger(`IV: ${stops.length} mốc dừng tại [${stops.join(', ')}]s${hasSummary ? ` + Tóm tắt(cuối, displayAt=${ri.summaryDisplayAt}s)` : ''}`);

  // Đọc current time: với video native là <video>.currentTime; với YouTube
  // (cross-origin iframe, không có <video> trong frame) phải đọc qua H5P
  // instance (H5P.instances[].video.getCurrentTime()). Dùng chung cho mọi loại.
  const getCurrentTime = () => frame.evaluate(() => {
    try {
      const inst = (window.H5P && H5P.instances) || [];
      const iv = inst.find(i => i && i.video && typeof i.video.getCurrentTime === 'function');
      if (iv) return +iv.video.getCurrentTime().toFixed(1);
    } catch (_) {}
    const v = document.querySelector('video');
    return v ? +v.currentTime.toFixed(1) : null;
  }).catch(() => null);

  const snapVideo = () => frame.evaluate((contentSel) => {
    const v = document.querySelector('video');
    const isVis = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    // Dialog interaction đang MỞ: phải có NỘI DUNG trả lời được đang hiện, không
    // chỉ vỏ `.h5p-question`. Live 22/10/2026 (Tin B3 mốc 1086s): vỏ TrueFalse
    // hiện trước khi answers render -> waitDialog trả về sớm, inventory thấy 0
    // đáp án, bỏ trắng mốc dù dialog đã mở. Chỉ đếm node VISIBLE vì H5P giữ DOM
    // của các dialog đã đóng (ẩn) -> đếm toàn cục sẽ báo nhầm dialog đang mở.
    let hasQ = 0;
    for (const el of document.querySelectorAll(contentSel)) if (isVis(el)) { hasQ = 1; break; }
    // Vỏ dialog đã mở hay chưa (kể cả khi nội dung bên trong rỗng/chưa render).
    // Dùng để phân biệt "dialog rỗng thật" với "dialog không mở được".
    let hasDialog = 0;
    for (const el of document.querySelectorAll('.h5p-question, .h5p-dialog')) {
      if (isVis(el)) { hasDialog = 1; break; }
    }
    let t = v ? +v.currentTime.toFixed(1) : null;
    if (t == null) {
      try {
        const inst = (window.H5P && H5P.instances) || [];
        const iv = inst.find(i => i && i.video && typeof i.video.getCurrentTime === 'function');
        if (iv) t = +iv.video.getCurrentTime().toFixed(1);
      } catch (_) {}
    }
    return {
      t,
      dur: v ? v.duration : 0,
      paused: v ? v.paused : null,
      hasQ,
      hasDialog,
    };
  }, DIALOG_CONTENT_SELECTOR).catch(() => ({ t: 0, dur: 0, paused: null, hasQ: 0, hasDialog: 0 }));

  // Chờ dialog xuất hiện trong tối đa timeoutMs. Trả snap cuối.
  const waitDialog = async (timeoutMs) => {
    const end = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < end) {
      last = await snapVideo();
      if (last.hasQ) return last;
      await sleep(150); // dialog thường hiện <1s: poll dày để bắt sớm
    }
    return last;
  };

  // Đóng dialog đang mở để mốc sau không bị chặn (Escape đã verify live).
  const closeDialog = async () => {
    await frame.page().keyboard.press('Escape').catch(() => {});
    await sleep(200);
    const closeBtn = frame.locator('.h5p-dialog-close:visible').first();
    if (await closeBtn.count().catch(() => 0)) {
      await closeBtn.evaluate((el) => el.click()).catch(() => {});
      await sleep(200);
    }
  };

  // Phát hiện video YouTube: nằm trong iframe cross-origin nên KHÔNG có thẻ
  // <video> trong frame này -> KHÔNG thể seek bằng .currentTime. Tuy nhiên việc
  // "tua" vẫn có thể thực hiện qua marker tương tác trên seekbar (H5P tự map
  // sang YouTube seek). (Bài khoá tua đã bị bỏ qua từ sớm -> không tới đây.)
  const isYoutube = await frame.evaluate(() => {
    const hasNative = !!document.querySelector('video');
    const yt = [...document.querySelectorAll('iframe')].some(f => /youtube\.com|youtu\.be|youtube-nocookie/.test(f.src || ''));
    return yt && !hasNative;
  }).catch(() => false);

  // Click marker tương tác trên seekbar -> H5P TỰ tua tới mốc và mở dialog.
  // Dùng cho bài CHO TUA (kể cả YouTube, vì H5P map marker sang YouTube seek) —
  // tức là bấm "nút chỗ hiện câu hỏi" mà H5P cung cấp sẵn.
  // `preferIdx`: gợi ý marker thứ i (theo DOM order = thứ tự thời gian). Ta NHỚ các
  // marker đã bấm (key phân biệt summary/stop để không đụng index) để không bấm lại.
  const clickedMarkers = new Set();
  const clickSeekbarMarker = async (preferIdx, summaryOnly) => {
    const key = (i) => (summaryOnly ? `s${i}` : `m${i}`);
    const markers = frame.locator(summaryOnly
      ? '.h5p-end-summary, .h5p-summary-interaction'
      : '.h5p-seekbar-interaction:not(.h5p-end-summary):not(.h5p-summary-interaction):visible');
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

  // Seek sát mốc + play rồi CHỜ seek áp dụng. Tách riêng để mốc choice có thể
  // để H5P tự mở dialog khi video chạm mốc (không bấm nút trên video).
  const seekPlayTo = async (stop) => {
    if (isYoutube || stop == null) return;
    await frame.evaluate((s) => {
      const v = document.querySelector('video');
      // Đã seek sát mốc (s-0.4) -> phát 1x là đủ để H5P kịp trigger; 0.5x chỉ
      // làm chậm gấp đôi mà không thêm lợi ích.
      if (v) { try { v.muted = true; v.currentTime = Math.max(0, s - 0.4); v.playbackRate = 1; v.play().catch(() => {}); } catch (_) {} }
    }, stop);
    const seekEnd = Date.now() + 3000;
    while (Date.now() < seekEnd) {
      const t = await frame.evaluate(() => {
        const v = document.querySelector('video');
        return v ? +v.currentTime.toFixed(2) : null;
      }).catch(() => null);
      if (t == null || t >= stop - 1.5) break;
      await sleep(100);
    }
  };

  // Bấm "nút tương tác" H5P hiện TRÊN VIDEO (.h5p-interaction-button — nút màu,
  // vd blanks/tóm tắt) hoặc marker trên seekbar. Đưa video về sát mốc trước để
  // nút của mốc đó xuất hiện, phát chậm để không vượt qua. Đây là cách H5P thực
  // sự mở dialog (seek thẳng currentTime KHÔNG làm H5P bật dialog — verify qua DOM).
  // `si`: chỉ số marker (theo thứ tự thời gian) để bấm ĐÚNG marker của mốc này.
  const clickInteractionButton = async (stop, si, summaryOnly) => {
    await seekPlayTo(stop);
    // (1) Nút tương tác TRÊN VIDEO (blanks/other) — chỉ hiện quanh mốc.
    const end = Date.now() + 3000;
    while (Date.now() < end) {
      const btn = frame.locator('.h5p-interaction-button:visible').first();
      if (await btn.count().catch(() => 0)) {
        const box = await btn.boundingBox().catch(() => null);
        if (box && box.width) {
          await frame.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
          return { sel: '.h5p-interaction-button' };
        }
      }
      await sleep(150);
    }
    // (2) Marker trên seekbar (choice...) — chọn theo đúng thứ tự mốc.
    return await clickSeekbarMarker(summaryOnly ? null : si, !!summaryOnly);
  };

  // Đưa video native tới HẾT (để H5P dựng màn kết thúc + nút tóm tắt). Bấm nút
  // tóm tắt khi video CHƯA chạy hết thì H5P không mở dialog — đây là bug gặp ở
  // bài IV CHỈ có Tóm tắt (không có mốc dừng nào). Seek sát cuối + play cho hết,
  // poll `ended`; duration có thể chưa sẵn nên thử lại nhiều lần. Trả true nếu tới cuối.
  const driveToEnd = async (timeoutMs) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const st = await frame.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return null;
        const d = v.duration;
        if (isFinite(d) && d > 0 && !v.ended) { try { v.currentTime = Math.max(0, d - 0.4); } catch (_) {} }
        try { v.muted = true; v.playbackRate = 1; v.play().catch(() => {}); } catch (_) {}
        return { t: v.currentTime, d, ended: v.ended };
      }).catch(() => null);
      if (!st) return false;
      if (st.ended || (isFinite(st.d) && st.d > 0 && st.t >= st.d - 0.6)) return true;
      await sleep(250);
    }
    return false;
  };

  // Chẩn đoán: dump trạng thái DOM liên quan tới tóm tắt/marker để biết vì sao
  // dialog không mở (chỉ in khi gặp lỗi, gọn để không làm nhiễu log).
  const dumpSummaryDom = async (tag) => {
    const info = await frame.evaluate((contentSel) => {
      const cnt = (sel) => document.querySelectorAll(sel).length;
      const vis = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
      const vcnt = (sel) => [...document.querySelectorAll(sel)].filter(vis).length;
      const v = document.querySelector('video');
      // Marker trên seekbar (điểm tương tác) — tìm nút tương tác của tóm tắt.
      const markers = [...document.querySelectorAll('.h5p-seekbar-interaction')].slice(0, 20).map((m) => ({
        c: String(m.className).replace('h5p-seekbar-interaction', '').trim() || '(plain)',
        title: m.getAttribute('title'),
      }));
      return {
        t: v ? +v.currentTime.toFixed(1) : null, d: v ? v.duration : null, paused: v ? v.paused : null, ended: v ? v.ended : null,
        seekbar: cnt('.h5p-seekbar-interaction'),
        intButton: cnt('.h5p-interaction-button'),
        interaction: cnt('.h5p-interaction'),
        question: cnt('.h5p-question'),
        qCls: [...document.querySelectorAll('.h5p-question')].filter(vis).map((q) => String(q.className).slice(0, 120)),
        content: vcnt(contentSel),
        tf: vcnt('.h5p-true-false-answer'),
        answer: vcnt('.h5p-answer'),
        check: vcnt('.h5p-question-check-answer'),
        continue: cnt('.h5p-question-iv-continue'),
        summaryRows: cnt('.h5p-summary li'),
        markers,
      };
    }, DIALOG_CONTENT_SELECTOR).catch(() => null);
    logger(`  🐞 DOM(${tag}): ${JSON.stringify(info)}`);
  };


  // QUAN TRỌNG: KHÔNG đua theo video (playbackRate cao làm vụt qua mốc sớm 0s/3s
  // khi H5P chưa kịp trigger). Thay vào đó ĐIỀU KHIỂN từng mốc: seek tới ngay
  // trước mốc -> play rate 1 -> chờ dialog. Xác định & không phụ thuộc tốc độ.
  // "job": hoặc một mốc thời gian (from) hoặc tóm tắt cuối (isSummary).
  const jobs = stops.map(s => ({ stop: s, summary: false }));
  if (hasSummary) jobs.push({ stop: null, summary: true });
  // jsonContent KHÔNG đổi trong suốt bài -> đọc 1 lần rồi CACHE (trước đây đọc lại
  // mỗi mốc = 1 evaluate thừa/mốc). Nếu lần đọc đầu chưa trích được đáp án nào
  // (H5P lazy-load params) thì KHÔNG cache để lần sau đọc lại.
  let liveListCache = null;
  const getLiveList = async () => {
    if (liveListCache) return liveListCache;
    const ex = jsonOverride ? list : await extractList((await readInteractions(frame, jsonOverride)).items || []);
    const hasData = ex.some((l) => l.extracted && (l.extracted.correctTexts || l.extracted.answers || l.extracted.rows || l.extracted.elements || l.extracted.choices));
    if (jsonOverride || hasData) liveListCache = ex;
    return ex;
  };

  let dumpedStop = false; // chỉ dump DOM 1 lần/ bài khi mốc không hiện dialog
  for (let si = 0; si < jobs.length && Date.now() < deadline; si++) {
    const { stop, summary: isSumJob } = jobs[si];
    let snap;
    if (isSumJob) {
      // Tóm tắt cũng là 1 interaction có "NÚT MÀU trên video" (.h5p-interaction-button),
      // hiện ở mốc displayAt (hoặc ở màn kết thúc). Đưa video tới đúng mốc rồi BẤM nút.
      const sumAt = (ri.summaryDisplayAt && ri.summaryDisplayAt > 0) ? ri.summaryDisplayAt : null;
      let opened = null;
      if (sumAt != null) opened = await clickInteractionButton(sumAt, null, true);
      if (!opened) {
        // Không rõ mốc -> cho video chạy hết rồi thử nút ở màn kết thúc.
        if (!isYoutube) {
          const reached = await driveToEnd(9000);
          logger(reached ? '  ▶ video đã tới cuối -> mở tóm tắt' : '  ⚠ video chưa tới cuối, vẫn thử mở tóm tắt');
          await sleep(400);
        }
        // Tóm tắt có thể đã hiện inline trên màn kết thúc -> không bấm nếu đã có rows.
        snap = await snapVideo();
        if (!snap || !snap.hasQ) {
          opened = await clickInteractionButton(null, null, true);
          if (!opened) {
            const endBtn = frame.locator('.h5p-end-summary, .h5p-summary-interaction').first();
            if (await endBtn.count().catch(() => 0)) {
              await endBtn.click({ timeout: 2500 }).catch(() => {});
              opened = { sel: '.h5p-end-summary' };
            }
          }
        }
      }
      if (opened) logger(`  ▶ bấm nút tóm tắt ${opened.sel || opened.title || ''}`);
      snap = await waitDialog(12000);
      // Vẫn chưa mở -> thử bấm nút tóm tắt đang hiển thị lần cuối.
      if (!snap || !snap.hasQ) {
        const endBtn2 = frame.locator('.h5p-interaction-button:visible, .h5p-end-summary:visible, .h5p-summary-interaction:visible').first();
        if (await endBtn2.count().catch(() => 0)) {
          await endBtn2.click({ timeout: 2500 }).catch(() => {});
          snap = await waitDialog(8000);
        }
      }
      if (!snap || !snap.hasQ) { await dumpSummaryDom('sum-fail'); logger('  ⚠ tóm tắt không hiện dialog -> đóng dialog (nếu có) và bỏ qua'); await closeDialog(); continue; }
    } else {
      // Blanks rỗng (0 đáp án trích được) không render nội dung trong dialog ->
      // waitDialog 10s sẽ timeout và để dialog treo. Mở NGẮN để xác nhận DOM
      // thật sự không có input (tránh bỏ sót khi JSON rỗng do extract lỗi).
      let alreadyOpen = false;
      if (isEmptyBlanksStop(list, stop)) {
        logger(`  mốc ${stop}s: Blanks rỗng (0 đáp án) -> mở ngắn để xác nhận`);
        await clickInteractionButton(stop, si);
        snap = await waitDialog(1500);
        // Vỏ dialog có thể hiện trước nội dung -> chờ thêm trước khi kết luận rỗng.
        if (snap && !snap.hasQ && snap.hasDialog) snap = await waitDialog(2500);
        const probe = classifyBlanksProbe(snap);
        if (probe === 'empty') {
          logger(`  mốc ${stop}s: dialog mở nhưng 0 nội dung -> bỏ qua, không tính là câu hỏi`);
          await closeDialog();
          skippedEmpty++;
          continue;
        }
        if (probe === 'missed') {
          // Không mở được dialog -> KHÔNG được coi là rỗng; rơi xuống nhánh thường
          // (thử lại), cuối cùng mốc vẫn bị tính unverified nếu không mở được.
          logger(`  mốc ${stop}s: không mở được dialog để xác nhận -> xử lý thường`);
        } else {
          logger(`  mốc ${stop}s: DOM có nội dung dù JSON rỗng -> xử lý bình thường`);
          alreadyOpen = true;
        }
      }
      const expected = list.filter((it) => !it.isSummary && it.from === stop);
      const choiceOnly = expected.length > 0 && expected.every((it) => it.kind === 'choice');
      if (alreadyOpen) {
        // Dialog đã mở ở bước xác nhận Blanks rỗng -> không bấm lại.
      } else if (choiceOnly) {
        // Choice mở bằng marker khi video chạm mốc. KHÔNG bấm
        // .h5p-interaction-button: nút của interaction KHÁC chưa xem có thể đang
        // hiện (live Tin B3 mốc 1086s: bấm nhầm nút Blanks 0s -> mở dialog
        // Blanks, bỏ trắng câu TrueFalse).
        logger(`  ▶ mốc ${stop}s (choice): seek+play chờ H5P tự mở`);
        await seekPlayTo(stop);
        snap = await waitDialog(8000);
        if (!snap || !snap.hasQ) {
          const mk = await clickSeekbarMarker(si, false);
          if (mk) logger(`  ▶ bấm marker ${mk.title || ''} (mốc ${stop}s)`);
          snap = await waitDialog(6000);
        }
      } else {
        // BÀI CHO TUA: BẤM "nút tương tác" H5P hiện trên video (nút màu) hoặc
        // marker seekbar để H5P tự mở dialog. Seek thẳng <video>.currentTime KHÔNG
        // làm H5P bật dialog (đã verify qua DOM: video chạy qua mốc không pause).
        const mk = await clickInteractionButton(stop, si);
        if (mk) logger(`  ▶ bấm ${mk.sel || mk.title || 'marker'} (mốc ${stop}s)`);
        else logger(`  ⚠ không thấy nút tương tác cho mốc ${stop}s`);
        snap = await waitDialog(10000);
      }
      if (!snap || !snap.hasQ) {
        if (!dumpedStop) { dumpedStop = true; await dumpSummaryDom('stop-fail'); }
        logger(`  ⚠ mốc ${stop}s không hiện dialog -> đóng dialog (nếu có) và bỏ qua`);
        await closeDialog();
        continue;
      }
      if (Date.now() > deadline) break;
    }

    // H5P tự pause tại mốc; đảm bảo pause để đọc DOM (chỉ khi có video native).
    await frame.evaluate(() => { const v = document.querySelector('video'); if (v) v.pause(); });
    await sleep(150);

    // Đáp án đã có sẵn (cache) -> không tốn evaluate lại mỗi mốc.
    const liveList = await getLiveList();
    // Dialog hiện đúng mốc đã seek -> dùng luôn stop (isSumJob không có mốc).
    const activeFrom = isSumJob ? null : stop;
    const group = isSumJob
      ? liveList.filter(l => l.isSummary)
      : liveList.filter(l => !l.isSummary && l.from === activeFrom);
    if (!group.length) {
      // Dialog đã mở nhưng chưa đọc được đáp án (lazy-load/chậm). Đóng dialog để
      // video không bị kẹt (trước đây chỉ 'continue' -> dialog treo, video đứng).
      logger(`  ⚠ ${isSumJob ? 'tóm tắt' : `mốc ${activeFrom}s`} chưa load kịp đáp án -> đóng dialog cho video chạy tiếp`);
      await pressContinue(frame, logger).catch(() => {});
      await sleep(250);
      continue;
    }
    logger(`  ▶ ${isSumJob ? 'Tóm tắt' : `mốc ${activeFrom}s`} (${group.map(g => g.kind).join('+')}) @${snap.t}s`);
    // Blanks rỗng (0 ô trống, 0 đáp án): không có gì để trả lời -> đóng dialog
    // để video chạy tiếp, KHÔNG tính là câu hỏi (không solved/wrong/unverified).
    let blankInputs = 0;
    if (group.length === 1 && group[0].kind === 'blanks') {
      blankInputs = await frame.locator('input.h5p-text-input:visible').count().catch(() => 0);
    }
    if (isEmptyBlanksOnly(group, blankInputs)) {
      logger(`  mốc ${activeFrom}s: Blanks rỗng (0 ô trống) -> bỏ qua, không tính là câu hỏi`);
      // Live 22/10/2026: dialog Blanks 0 input KHÔNG có nút "Tiếp tục"; bấm
      // "Thử lại" còn làm nút biến mất -> kẹt dialog và mốc kế bị nhận nhầm.
      // Escape đóng được (đã verify), fallback nút X của dialog.
      await closeDialog();
      skippedEmpty++;
      continue;
    }
    {
      // Giải TẤT CẢ interaction trong dialog tại mốc này. Gói thành 1 hàm để có thể
      // TRẢ LỜI LẠI khi phát hiện câu SAI mà H5P cho phép "Làm lại".
      const answerOnce = async () => {
        // GỘP các phép dò DOM của dialog vào MỘT evaluate. Trước đây mỗi mốc tốn
        // ~8 lượt locator.count() (mỗi lượt = 1 round-trip + 1 lần quét selector
        // toàn DOM). Chỉ snapshot phần TĨNH (summary/SC/question/MTW/blanks);
        // nút "Kiểm tra" vẫn đọc SAU khi trả lời vì có thể chỉ enable sau khi chọn.
        const inv = await frame.evaluate(() => {
          const vis = (el) => !!(el && (el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length)));
          const qv = (s) => [...document.querySelectorAll(s)].filter(vis);
          const qcs = qv('.h5p-question');
          return {
            sumRows: document.querySelectorAll('.h5p-summary li[data-bit]').length,
            sc: qv('.h5p-single-choice-set').length,
            qcWithAnswers: qcs.map((el, i) => (
              (el.querySelector('.h5p-answer') || el.querySelector('.h5p-true-false-answer')) ? i : -1
            )).filter((i) => i >= 0),
            mtw: qv('.h5p-mark-the-words').length,
            blanksBox: qv('.h5p-blanks, .h5p-drag-text').length,
            textInputs: qv('input.h5p-text-input').length,
          };
        }).catch(() => ({}));

        // `handled`: có THAO TÁC trả lời thật không (click/điền/kéo). Dùng để phân
        // biệt "đã trả lời & không sai" với "dialog mở nhưng bỏ trắng" — nếu bỏ
        // trắng thì KHÔNG được tính là đã giải (chính sách trung thực).
        let handled = false;
        let scsWrong = 0;
        let unverifiedExtra = 0;
        let checkFailed = false;

        // (1) SUMMARY — nằm ở cấp dialog (.h5p-summary), KHÔNG nằm trong .h5p-question con.
        if (inv.sumRows) {
          const ex = group.find(g => g.kind === 'summary');
          if (ex && ex.extracted) {
            logger(`  summary: ${inv.sumRows} rows`);
            const rs = await answerSummaryInPopup(frame, frame.locator('.h5p-summary').first(), ex.extracted, logger);
            if (rs && rs.solved) handled = true;
            if (rs && rs.unverified) unverifiedExtra += rs.unverified;
            await sleep(200);
          }
        }

        // (2) CHOICE — gán đáp án THEO VỊ TRÍ cho từng MC container (tránh dùng chung).
        // (2a) SingleChoiceSet: dạng .h5p-single-choice-set, click là chấm điểm ngay.
        // Cộng số câu bị H5P chấm sai vào feedback để verdict không bỏ qua lỗi.
        if (inv.sc) {
          const scEx = (group.find(g => g.kind === 'choice') || {}).extracted;
          const rsc = await answerSingleChoiceSet(frame, scEx, logger);
          if (rsc) {
            scsWrong += rsc.wrong || 0;
            if (rsc.solved) handled = true;
            else logger(`  ⚠️ single-choice-set chưa xong (done=${rsc.done}, wrong=${rsc.wrong})`);
          }
          await sleep(150);
        }
        // (2b) MultiChoice/TrueFalse trong dialog IV: có .h5p-answer.
        // Chỉ lấy kind 'choice' (blanks/dragtext xử lý riêng ở (2b-2)) để index
        // không lệch khi dialog trộn nhiều loại.
        const choices = group.filter(g => g.kind === 'choice');
        if (inv.qcWithAnswers && inv.qcWithAnswers.length) {
          const qcs = frame.locator('.h5p-question:visible');
          let mcIndex = 0;
          for (const q of inv.qcWithAnswers) {
            if (mcIndex >= choices.length) break;
            const qc = qcs.nth(q);
            const r = await answerChoiceInPopup(frame, qc, choices[mcIndex].extracted, logger, choices[mcIndex].library);
            mcIndex++;
            // Bấm Kiểm tra NGAY trong container này (nút enabled sau khi có lựa chọn).
            if (r.solved) {
              handled = true;
              if (!(await pressCheckIn(qc, logger))) checkFailed = true;
            }
          }
        }
        await sleep(200);

        // (2b-2) Blanks / DragText lồng trong IV: KHÔNG có .h5p-answer nên (2b) bỏ qua.
        // Phải điền ô trống (input) hoặc kéo-thả từ; nếu không H5P không ghi nhận câu trả lời.
        const blanksEls = group.filter(g => g.kind === 'blanks');
        if (blanksEls.length && !inv.mtw && inv.blanksBox) {
          const b = blanksEls[0];
          const rb = await solveBlanks(frame, { data: b.extracted, library: b.library }, logger).catch(() => ({ solved: false }));
          if (rb && rb.solved) handled = true;
          else {
            const rd = await solveDragText(frame, { data: b.extracted, library: b.library }, logger).catch(() => null);
            if (rd && rd.solved) handled = true;
          }
        }

        // (2c) MarkTheWords (IV lồng): KHÔNG có .h5p-answer (khác MultiChoice) nên
        //      nhánh (2b) bỏ qua. Phải bấm từng từ `span[role=option]` khớp đáp án
        //      rồi Kiểm tra — nếu không H5P không ghi nhận câu trả lời và nội dung
        //      không bao giờ hoàn thành (bài video + tài liệu kẹt 50%).
        if (inv.mtw) {
          const mtwEx = (group.find(g => g.kind === 'blanks') || {}).extracted;
          const rMtw = await answerMarkTheWords(frame, mtwEx, logger);
          if (rMtw.solved) {
            handled = true;
            if (!(await pressCheckIn(frame.locator('.h5p-mark-the-words:visible').first(), logger))) checkFailed = true;
          }
        }
        await sleep(200);

        // Bấm nốt các nút Kiểm tra/Gửi còn đang visible (fallback, vd summary-submit).
        const checks = frame.locator('.h5p-question-check-answer:visible, .h5p-question-submit:visible, button.h5p-question-visible:visible');
        const nChk = await checks.count().catch(() => 0);
        for (let k = 0; k < nChk; k++) { await robustClick(checks.nth(k)); await sleep(120); }
        logger(`  đã bấm ${nChk} nút kiểm tra @${stop}s`);
        // Chờ feedback xuất hiện (trả về sớm) thay vì sleep cứng 900ms.
        await waitFeedback(frame, 1200);

        // Đọc feedback NGAY (trước khi seek) để verify đúng/sai tại chỗ.
        // QUAN TRỌNG: chỉ đếm node ĐANG HIỆN — H5P GIỮ DOM của các dialog đã đóng
        // (ẩn bằng CSS), nếu đếm toàn cục không lọc visible thì feedback của các
        // mốc TRƯỚC sẽ làm mọi mốc sau bị tính là "wrong" (bad cũ còn sót) hoặc
        // "solved oan" (ok cũ còn sót -> vô hiệu hoá cờ handled).
        const fb = await frame.evaluate((sel) => {
          const vis = (el) => !!(el && (el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length)));
          const countIn = (root, s) => [...root.querySelectorAll(s)].filter(vis).length;
          const qs = [...document.querySelectorAll('.h5p-question')];
          const det = qs.map((q) => `g${countIn(q, sel.correct)}/w${countIn(q, sel.wrong)}`);
          const ok = countIn(document, sel.correct);
          const bad = countIn(document, sel.wrong);
          const bar = document.querySelector('.h5p-joubelui-score-bar-progress, .h5p-score-bar-progress');
          return { ok, bad, bar: bar ? (bar.style.width || bar.getAttribute('style')) : null, det: det.join(' ') };
        }, { correct: FB_CORRECT_SEL, wrong: FB_WRONG_SEL }).catch(() => ({}));
        // `handled` (1/0) gắn từ ngoài: đã thao tác trả lời thật hay chưa.
        fb.handled = handled ? 1 : 0;
        fb.unverified = unverifiedExtra;
        fb.checkFailed = checkFailed ? 1 : 0;
        // SCS tự chấm ngay khi click; class reveal nằm trên alternative (có thể đã
        // ẩn khi sang slide khác) nên cộng trực tiếp từ kết quả answerSingleChoiceSet.
        if (scsWrong) fb.bad = (fb.bad || 0) + scsWrong;
        logger(`  feedback @${stop}s: ok=${fb.ok} bad=${fb.bad} handled=${fb.handled} bar=${fb.bar} [${fb.det}]`);
        return fb;
      };

      let fb = await answerOnce();
      // Có câu SAI + H5P cho "Làm lại" -> bấm làm lại rồi trả lời lại (tối đa 3 lần).
      // Dừng sớm khi số câu sai KHÔNG giảm (tránh lặp vô ích).
      for (let attempt = 2; attempt <= 3 && fb.bad > 0; attempt++) {
        const nRetry = await pressAllRetries(frame, logger);
        if (!nRetry) { logger(`  retry: không có nút "Làm lại" -> chấp nhận ${fb.bad} câu sai`); break; }
        await sleep(500);
        const fb2 = await answerOnce();
        if (fb2.bad >= fb.bad) { fb = fb2; logger('  retry: số câu sai không giảm -> dừng'); break; }
        fb = fb2;
      }
      // CHỈ tính "đã giải" khi KHÔNG có câu SAI và CÓ thao tác trả lời thật.
      // Trước đây tăng vô điều kiện khi fb.bad===0 nên mốc bỏ trắng (dialog mở mà
      // không trả lời được câu nào) vẫn được tính là xong -> bài báo hoàn thành sai.
      const verdict = verdictOf(fb);
      doneCount++;
      if (verdict === 'wrong') {
        wrongCount++;
        logger(`  ⚠️ mốc ${stop}s có ${fb.bad} câu SAI — không tính là đã giải`);
      } else if (verdict === 'unverified') {
        unverifiedCount++;
        logger(`  ⚠️ mốc ${stop}s KHÔNG trả lời được câu nào (chưa xác minh) — không tính là đã giải`);
      } else {
        solvedCount++;
      }

      // Bấm "Tiếp tục/Continue" để H5P submit câu trả lời (xAPI 'answered' chỉ
      // fire sau khi đóng dialog qua nút này, KHÔNG fire khi seek đi đột ngột).
      await pressContinue(frame, logger);
      await sleep(250);
    }
  }
  await finishVideo(frame);
  // wrong/unverified > 0 => bài có mốc chưa chắc đúng -> flow.js KHÔNG coi là ok
  // (chính sách trung thực: thà báo "chưa xác nhận" còn hơn báo xong sai).
  const counts = settleVideoCounts({
    jobCount: jobs.length, doneCount, skippedEmpty,
    solved: solvedCount, wrong: wrongCount, unverified: unverifiedCount,
  });
  const missed = counts.unverified - unverifiedCount;
  if (missed > 0) logger(`  ⚠️ ${missed} mốc chưa xử lý được (không mở dialog/hết thời gian) -> tính CHƯA XÁC MINH`);
  return counts;
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

module.exports = {
  settleVideoCounts, solveVideo, readInteractions, extractList, answerChoiceInPopup, answerSummaryInPopup, answerMarkTheWords, answerSingleChoiceSet, isEmptyBlanksOnly, isEmptyBlanksStop, classifyBlanksProbe, pressCheckIn, pressContinue, seekVideo, finishVideo, kindOf, log, verdictOf, DIALOG_CONTENT_SELECTOR, FB_CORRECT_SEL, FB_WRONG_SEL };
