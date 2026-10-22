# LmsAuto v2.1 — Core Solver (đã verify chạy thật)

Đây là **lõi automation mới**, viết lại hoàn toàn từ dữ liệu đã reverse-engineer
từ `lms360.vn` (xem `docs/H5P-ANSWER-MAP.md`). Khác bản cũ trước đây:

- Đọc **đáp án thật** từ `window.H5PIntegration.contents[].jsonContent` (không brute-force mù).
- Chọn đúng **frame** chứa H5P player + đóng **modal Face ID**.
- Click **theo text** (DOM bị xáo trộn so với JSON).
- Tương tác **giống người** (di chuột, delay ngẫu nhiên, fingerprint `vi-VN`).
- Mỗi dạng H5P **1 module riêng**, dễ mở rộng.

## Kiến trúc

```
src/
├── core/
│   ├── auth.js       đăng nhập API hcm_login_v3 → JWT (không cần DOM/SSO)
│   ├── scan.js       quét bài được giao (my_assigned_pending) → URL xem-video
│   ├── complete.js   quét learn_status TOÀN BỘ khóa → phân loại file vs H5P →
│   │                 completeFiles(): đánh dấu file (pptx/pdf/doc...) hoàn thành
│   ├── census.js     khảo sát CHỈ-ĐỌC: đọc H5PIntegration → ma trận library,
│   │                 cờ ảnh/YouTube/library lạ/randomQuestions/shuffleAnswers
│   ├── flow.js       orchestrator: login → scan → solve từng bài → report
│   │                 (+ parts mode: giải mọi phần H5P còn nợ + markDone)
│   ├── stealth.js    launch browser + human click/type/scroll + inject token
│   └── dismiss.js    đóng modal "Chưa đăng ký khuôn mặt"...
├── h5p/
│   ├── extract.js    đọc đáp án từ jsonContent (11 dạng) — thuần logic
│   ├── answers.js    tìm frame player + readAnswers (xử lý lồng QuestionSet/Book)
│   ├── solver.js     auto-click đáp án đúng cho từng dạng
│   ├── doc.js        2 API "bấm nút mắt": view_h5p_content (tăng view) +
│   │                 learn_status POST status=3 (hoàn thành) + solveDoc
│   ├── interactiveVideo.js  giải InteractiveVideo (play → poll dialog → submit)
│   └── book/         điều phối sách online (CoursePresentation/InteractiveBook)
│       ├── index.js  solveBook/solveCoursePresentation/solveInteractiveBook
│       ├── read.js   tìm frame + đọc jsonContent (readBook)
│       ├── schema.js chuẩn hoá model (pages/elements)
│       ├── navigate.js điều hướng slide/trang
│       ├── question.js giải 1 element (delegate sang solver/IV)
│       └── dom.js    helper DOM (visible containers, đọc điểm)
scripts/
├── cli.js            `npm run auto` — hỏi tài khoản → runFlow
│                     (cờ --dry-run/--limit/--headless/--all/--complete-files/--complete-h5p
│                      /--do-assigned/--retry-rounds=N/--no-retry)
├── debug-live.js     `npm run debug:live` — debug KHÔNG tương tác bàn phím: tự đọc
│                     file secrets (mặc định usersecret.txt, 2 dòng user/pass, đã
│                     .gitignore), KHÔNG bao giờ in credentials. 4 stage:
│                       scan    login + quét (chỉ đọc, không mở browser)
│                       census  mở từng bài CHỈ ĐỌC H5PIntegration -> ma trận
│                               coverage + docs/census-YYYY-MM-DD.json (--limit, --raw)
│                       solve   runFlow giải thật (--do-assigned --limit=N --only=...)
│                       files   completeFiles (chỉ gọi API)
├── _token.js         nguồn token dùng chung (env → file cũ → API login) cho script debug
└── debug-solve.js    test end-to-end trên 1 bài thật
tests/
├── extract.test.js     unit test extract trên dữ liệu dump thật (+ stripHtml tag inline)
├── book.test.js        unit test schema/question của book
├── book-honesty.test.js cổng trung thực khi giải sách (không mark khi còn câu sai)
├── doc.test.js         unit test 2 API nút mắt + solveDoc (mock fetch)
├── complete.test.js    unit test quét/phân loại/đánh dấu file (mock fetch)
├── auth-scan.test.js   unit test auth + scan (mock fetch)
├── flow.test.js        unit test orchestrator (inject deps)
├── questionset.test.js unit test H5P.QuestionSet ĐỨNG RIÊNG (routing + xáo câu + ảnh)
├── census.test.js      unit test probe coverage (ảnh/YouTube/library lạ/random)
├── solver-retry.test.js / solver-dom.test.js   retry loop + gộp truy vấn DOM
├── interactiveVideo.test.js                    gom mốc / verdict / SCS / popup
└── preview.test.js                             dedup / latest-only / backpressure
```

## Cách chạy

```bash
# 1. Cài deps (đã dùng playwright 1.64.0 để khớp browser cache)
npm install

# 2. KHÔNG cần token thủ công: stealth.launch({username,password}) tự gọi
#    API hcm_login_v3 lấy JWT rồi inject vào localStorage['AccessToken'] + cookie.
#    (Nếu muốn tái dùng token cũ: truyền {token: '<JWT>'}.)

# 3. Unit test (không cần browser, không gọi mạng) — 259 test / 13 suite
node tests/extract.test.js        # 26 (dữ liệu dump thật + stripHtml tag inline)
node tests/book.test.js           # 26 (schema/question + MC ảnh + SCS reveal/done + solvePage)
node tests/book-honesty.test.js   # 5  (cổng trung thực: còn sai/chưa xác minh -> không mark)
node tests/doc.test.js            # 13 (2 API nút mắt + solveDoc)
node tests/complete.test.js       # 15 (quét/phân loại/đánh dấu file)
node tests/auth-scan.test.js      # 20 (login + scan, mock fetch)
node tests/solver-retry.test.js   # 6  (vòng "Làm lại")
node tests/solver-dom.test.js     # 22 (gộp truy vấn DOM + khớp đáp án sub/sup + không đoán)
node tests/interactiveVideo.test.js # 47 (gom mốc, verdict, SCS scope, popup TF/MathML/ảnh, Blanks rỗng)
node tests/flow.test.js           # 35 (orchestrator + parts mode + markDone + honesty gate)
node tests/questionset.test.js    # 15 (QuestionSet đứng riêng — xem mục Bug 15–18)
node tests/census.test.js         # 25 (probe coverage: ảnh/YouTube/library lạ/random/unreadable)
node tests/preview.test.js        # 4  (dedup / latest-only / backpressure)
npm test                          # chạy tất cả (13 suite) — exit khác 0 nếu có fail

# 3b. Khảo sát CHỈ-ĐỌC toàn bộ bài đang nợ (không giải, không ghi server)
node scripts/debug-live.js census --limit=20     # thêm --raw để lưu jsonContent
# Kết quả: ma trận library + cờ ảnh/YouTube/random + docs/census-YYYY-MM-DD.json

# 4. Chạy flow đầy đủ (login → scan → giải từng bài → submit)
npm run auto                    # hỏi tài khoản/mật khẩu, hiện browser
npm run auto -- --dry-run       # chỉ liệt kê bài sẽ giải
npm run auto -- --limit=3       # giới hạn 3 bài
npm run auto -- --headless      # chạy ẩn
npm run auto -- --all           # bỏ blacklist mặc định (thể dục/âm nhạc...)

# 5. Test giải 1 bài thật (tự chọn 1 bài MultiChoice đơn giản)
npm run debug:solve
# hoặc chỉ định bài: node scripts/debug-solve.js <content_id> <h5p_id> <course_id>
```

Script debug lấy token qua `scripts/_token.js` (ưu tiên env `LMS_TOKEN`, rồi file
`/tmp/token.txt` cũ, cuối cùng tự login bằng `LMS_USERNAME`/`LMS_PASSWORD`).
Không cần tạo `/tmp/token.txt` nữa.

Kết quả debug thành công sẽ hiện: `KẾT QUẢ: {"bar":"100%","correct":1,"wrong":0}`.

## Các dạng H5P đã hỗ trợ đọc đáp án (extract.js)

| Library | kind | Nguồn đáp án |
|---|---|---|
| `H5P.MultiChoice` / `SingleChoiceSet` / `TrueFalse` | choice | `params.answers[].correct` |
| `H5P.Blanks` / `DragText` / `MarkTheWords` | blanks | token `*đáp án*` trong text |
| `H5P.DragQuestion` | dragquestion | `dropZones[].correctElements` → `elements[].text` |
| `H5P.Summary` | summary | `summaries[].subContents[].correctText` |
| `H5P.SpeakTheWordsSet` / `GuessTheAnswer` | speakguess | `answers[].solution` |

Các dạng lồng (`QuestionSet`, `CoursePresentation`, `InteractiveBook`,
`BranchingScenario`) được xử lý trong `answers.js` (đệ quy sang sub-content);
riêng sách online có walker điều hướng ở `book.js`.

## Các bug đã tự debug & fix (quan trọng, đừng tái phạm)

1. **Token bị `undefined`**: `addInitScript(closure)` KHÔNG serialize biến closure.
   Phải truyền token qua **arg**: `addInitScript(fn, token)`. (stealth.js)
2. **H5P không render với `launchPersistentContext`**: lms360 chỉ render player
   khi dùng `browser.launch()` + `newContext()`. Không dùng persistent context.
3. **DOM bị xáo trộn**: thứ tự đáp án trong DOM ≠ JSON → PHẢI khớp theo **text**.
4. **"unfortunately" chứa "fortunately"**: `includes()` match nhầm → phải
   khớp **exact** trước, loose (chênh lệch độ dài ≤ 2) sau.
5. **2 frame cùng origin**: frame main có `H5PIntegration` nhưng DOM câu hỏi
   nằm ở frame 2 → `findPlayerFrame` ưu tiên frame có `.h5p-answer` visible.
6. **Modal Face ID chặn click**: phải `dismissAll` (bấm "Để sau") trước khi solve.
7. **InteractiveVideo KHÔNG trigger bằng `seek`**: H5P chỉ bật dialog khi video **play qua**
   timestamp. Seek thẳng tới marker → dialog không hiện. Phải `video.play()` với
   `playbackRate` cao rồi poll dialog.
8. **Nhiều interaction cùng 1 mốc `from`**: H5P gom summary + nhiều MC vào **CÙNG 1 dialog**.
   Gom theo `from`, xử lý cả nhóm, rồi `seek` qua mốc để không re-pause.
9. **Lazy-load params**: `assets.interactions[].action.params` chỉ đầy đủ khi video tới gần
   marker → đọc lại params **tại mỗi mốc**, KHÔNG prefetch 1 lần (nếu không sẽ `idxs=[]`).
10. **Nút "Tiếp tục" của IV là `.h5p-question-iv-continue`** (KHÔNG có text "Tiếp tục").
    Bấm nút này sau check để H5P submit câu trả lời (fire xAPI `answered`).
11. **Click theo INDEX cho 0 điểm**: DOM H5P đảo thứ tự đáp án so với `params.answers`
    → phải khớp theo **TEXT** (`correctTexts`), không dùng `correctIndexes`. (Đã verify:
    index → `0/1`, text-matching → `1/1`, submit "thành công".)
12. **CoursePresentation lưu slides ở `jsonContent.presentation.slides`**, KHÔNG phải
    `jsonContent.slides`. `answers.js` từng đọc sai path → `sub=[]`. Đã fix (`j.presentation || j`).
13. **Điều hướng CP bằng `.h5p-progressbar-part`**: index của part **KHỚP THẲNG**
    `presentation.slides` (part cuối là Summary). Click `force:true` rồi đợi ~1.4s.
14. **CP/Book KHÔNG có nút "Nộp bài"** (khác IV) — điểm ghi qua xAPI khi hoàn thành slide.
    `submitAndClose` tự bỏ qua an toàn.

### Phát hiện khi debug live 22/10/2026 (H5P.QuestionSet đứng riêng)

15. **`H5P.QuestionSet` ở mức top-level bị báo `unknown`**: `extract.js` không có
    router cho QuestionSet (chỉ xử lý khi LỒNG nhau trong `answers.js`/`book/`), còn
    `solver.solveQuestionSet` thì **không nơi nào gọi** (dead code). → `flow.solveSingle`
    phải nhận diện `libBase == H5P.QuestionSet` rồi tự build `sub[]` từ
    `json.questions[]` và gọi `solveQuestionSet`.
16. **QuestionSet phải bấm nút "Bắt đầu"** (`.h5p-question-start` /
    `.h5p-single-choice-set-start-button`): câu hỏi đầu tiên CHƯA tồn tại trong DOM
    cho tới khi bấm → thiếu `pressStart()` thì `countVisible()` = 0, vòng giải dừng
    ngay ở step 0 (`attempted=0`).
17. **`stripHtml()` không được chèn dấu cách cho tag NỘI DÒNG**: JSON
    `u = u<sub>1</sub> = u<sub>2</sub>` từng bị biến thành `u = u 1 = u 2` trong khi
    `innerText` của DOM là `u = u1 = u 2`/`u = u1 = u2` → khớp text trượt cả exact lẫn
    loose → click 0 đáp án, sai cả bài. Chỉ tag CẤP KHỐI (p/div/br/li/tr/h1…) mới thay
    bằng dấu cách; sub/sup/span/b/i… xoá sát.
18. **QuestionSet có `randomQuestions` → thứ tự DOM ≠ `json.questions`**: lấy
    `subs[step]` theo index là giải NHẦM câu (click đáp án của câu khác = H5P ghi nhận
    câu SAI). Phải khớp câu đang hiện bằng `pickSubIndex()` (ưu tiên lời dẫn câu hỏi,
    phụ nhãn đáp án). Tương tự, câu có **đáp án là ảnh** (text rỗng) KHÔNG được đoán
    mò: `correctTexts` lọc bỏ rỗng → solver báo `no-answers` và bỏ qua câu đó.

### Phát hiện khi debug live 22/10/2026 (InteractiveVideo 1.26/1.27)

19. **SingleChoiceSet lồng IV: mỗi slide tốn 2 vòng lặp** (click + chờ autoContinue
    ~2s) và **trong lúc chuyển slide KHÔNG slide nào có `.h5p-sc-current-slide`**.
    `maxSteps = choices + 3` cũ quá nhỏ → chỉ trả lời được 5/6 slide. Phải
    `maxSteps = max(12, max(slideCount, choices)*3 + 3)` và khi mất current-slide
    thì đọc lại DOM tới 3s (không dừng sớm).
20. **Màn kết quả SCS không nhận `.h5p-sc-current-slide`** → vòng lặp tưởng chưa
    xong. Kết thúc bằng `counted.size >= số slide câu hỏi` (bỏ slide results).
21. **Feedback SCS: `.h5p-sc-reveal-wrong` gắn cho MỌI đáp án sai** (kể cả không
    chọn), còn `.h5p-sc-is-correct/wrong` là metadata nội dung có sẵn từ đầu.
    Đếm chúng ở feedback toàn cục → 5/5 đúng vẫn báo `bad=1`. Kết quả SCS phải lấy
    từ `answerSingleChoiceSet` (reveal trên alternative ĐÃ CHỌN).
22. **MathML: `innerText` trả ký tự toán học** (`f` → `𝑓` U+1D453) trong khi
    `textContent` trả `f`. Khớp đáp án phải ưu tiên **textContent**, chỉ fallback
    innerText; nếu không sẽ click nhầm đáp án nhiễu (bug sách "Kính lúp" trang 3).
23. **Popup TrueFalse không có `.h5p-answer`** mà dùng `.h5p-true-false-answer`
    → inventory và `answerChoiceInPopup` phải fallback selector này, nếu không mốc
    bị bỏ trắng hoàn toàn.
24. **Nút "Kiểm tra" của TrueFalse nằm ngoài viewport** → `humanClick` theo toạ độ
    bấm trượt, không có feedback dù đã chọn đáp án. `pressCheckIn` phải dùng
    Playwright `locator.click()` (tự cuộn + hit-test), fallback `el.click()`.
25. **`waitDialog` chỉ thấy vỏ `.h5p-question` là trả về** — vỏ TrueFalse hiện
    trước khi answers render → inventory đọc 0 đáp án. Phải chờ node NỘI DUNG
    visible (`.h5p-answer`, `.h5p-true-false-answer`, input, summary row…) và
    chỉ đếm node visible (H5P giữ DOM dialog đã đóng ở trạng thái ẩn). KHÔNG tính
    nút "Kiểm tra"/"Tiếp tục": nút có thể hiện trước đáp án → trả về sớm.
26. **Blanks lỗi 0 ô trống** (params không có dấu `*`) không có gì để trả lời và
    KHÔNG có nút "Tiếp tục"; bấm "Thử lại" còn làm nút biến mất → kẹt dialog,
    mốc kế bị nhận nhầm là mốc cũ. Mở ngắn 1.5s để xác nhận DOM thật sự không có
    input, đóng bằng `Escape`/`.h5p-dialog-close`, bỏ qua và KHÔNG tính vào total.
27. **Seek chưa áp dụng + nút tương tác của mốc cũ** — live Tin B3 mốc 1086s:
    nút `.h5p-interaction-button` của Blanks mốc 0s còn hiện; bấm ngay sau khi
    set `currentTime` (seek chưa áp dụng) mở nhầm dialog Blanks, bỏ trắng câu
    TrueFalse. Mốc chỉ có `choice` phải seek+play để H5P tự mở theo marker, chỉ
    fallback bấm marker; không bấm nút trên video. Mọi timeout phải đóng dialog
    trước khi sang mốc kế.
28. **Blanks rỗng "xác nhận" nhầm khi dialog không mở** (review 2) — hết 1.5s
    không thấy nội dung từng bị coi là mốc rỗng và trừ khỏi tổng, dù nút/marker
    chưa mở được dialog. Nay phải thấy VỎ dialog visible (`.h5p-question`/
    `.h5p-dialog`) + chờ thêm 2.5s cho nội dung; không mở được → xử lý thường và
    mốc thành `unverified`.
29. **DragText không có node nội dung trong `DIALOG_CONTENT_SELECTOR`** (review 2)
    — dialog DragText chỉ có `.ui-draggable`/`.ui-droppable`; thiếu selector thì
    `waitDialog` timeout và mốc bị bỏ trắng. Đã thêm 2 selector scoped
    `.h5p-drag-text`.
30. **SCS đọc slide toàn frame + sách chấm SCS bằng feedback sai nguồn** (review 2)
    — H5P giữ DOM dialog SCS đã đóng, nên locator phải scope
    `.h5p-single-choice-set:visible`; trong sách, SCS không có nút Kiểm tra/Làm
    lại và không có `.h5p-correct` → `answerWithRetry` luôn 0/0. Sách route SCS
    sang `solveSingleChoiceSet`, solver chờ `reveal-correct|wrong` của đáp án đã
    chọn và chỉ báo solved khi tới màn kết quả, không câu sai, mọi click được
    xác nhận đúng.
31. **Đếm trùng unverified + đoán đáp án + `--only` mất tác dụng ở vòng 2**
    (review 2) — nhánh IV trong sách cộng `qElements.length` dù popup đã giải
    (nay trừ `popupDoneEls`); solver bỏ fallback chọn "đại" node MathML/đáp án
    trùng text; vòng quét lại áp LẠI bộ lọc `--only` trước khi xếp lịch.

## Kết quả verify (chạy thật trên lms360.vn)

| Dạng | Kết quả | Cách đo |
|---|---|---|
| MultiChoice / SingleChoice / TrueFalse | ✅ đúng | score bar `100%`, endscreen `1/1` |
| Blanks | ✅ đúng | điền 10/10, `correct:10 wrong:0` |
| DragQuestion | ✅ đúng | kéo 4/4, `correct:4 wrong:0` |
| QuestionSet LỒNG trong sách | ✅ 11/12 | `SCORE bar:100% txt:10` |
| QuestionSet ĐỨNG RIÊNG (8 câu KHTN) | ✅ 8/8 câu, 37.7s | câu đáp án ẢNH khớp theo src ảnh; mỗi câu `correct:1 wrong:0` |
| QuestionSet ĐỨNG RIÊNG (7 câu KHTN) | ✅ xong, `mark_complete -> 200 success` | đi bộ 5 câu `correct=1`, thanh điểm 100% |
| InteractiveVideo (summary+2MC) | ✅ đúng 2/2 MC | endscreen `1/1`, submit "thành công" `2/4` |
| CoursePresentation (3 slide Blanks) | ✅ đúng 3/3 slide | mỗi slide `good>0 wrong=0`, bar `100%`; API `/h5p/scores` → `score:10 num_correct:18/18` |
| InteractiveBook "Bài 7. Lăng kính" (5 trang + IV lồng) | ✅ 5/5 trang đúng, IV 2/2 | bar `100%`, mỗi trang `good>0 wrong=0`; login→scan→solve→submit liền mạch |
| InteractiveBook "Kính lúp" (8 trang) | ✅ 8/8 trang đúng, 32.9s, mark 200 | mỗi trang `good=1 wrong=0 unverified=0` (MathML khớp textContent) |
| IV 1.27 SingleChoiceSet (ANH 8) | ✅ 6/6 câu, 70.2s (re-verify review 2), mark 200 | `clicked 6, correct 6, wrong 0, done true`, bar `100%`; SCS scope `.h5p-single-choice-set:visible` |
| IV 1.26 TrueFalse + Blanks rỗng (Tin B3) | ✅ TF 1/1, 53.7s (re-verify review 2), mark 200 | feedback `ok=1 bad=0 handled=1`; Blanks chỉ bỏ qua sau khi xác nhận VỎ dialog mở + 0 nội dung |
| Census chỉ-đọc (toàn tài khoản) | ✅ 624 khóa / 755 phần đã xong / 1 phần dở | ~8–9s/bài, ghi `docs/census-2026-10-22.json` |

> Ghi chú: một số bài IB/CP có breakdown xAPI nội bộ hiển thị "8/10", "0/2"
> (H5P tự chia sub-score) dù **thanh điểm tổng = 100%** và mọi feedback cục bộ
> đều đúng — coi là non-blocking (không ảnh hưởng điểm ghi nhận).

## Lộ trình tiếp theo

- [x] Blanks / DragQuestion solver (click)
- [x] InteractiveVideo (play → poll dialog → summary+MC → continue)
- [x] QuestionSet walker (lật từng câu → check → next)
- [x] QuestionSet đứng RIÊNG (không lồng trong sách): route trong `flow.js` +
      `pressStart()` + khớp câu bằng nội dung (`pickSubIndex`), không theo index
- [x] Sách online CoursePresentation (walker lật slide → blanks/choice → check)
- [x] InteractiveBook (walker lật trang + IV lồng, delegate `solveVideo`)
- [x] Login qua API `hcm_login_v3` (`src/core/auth.js`) + inject token vào stealth
- [x] Quét bài được giao qua `my_assigned_pending` (`src/core/scan.js`) → URL xem-video
- [x] Unit test auth + scan (mock fetch) — 20/20 pass
- [x] Flow đầy đủ đa bài: login → scan → skip solved/doc-only → solve (CP/IB/IV) → submit (`src/core/flow.js`, `npm run auto`)
- [x] Unit test orchestrator (inject deps) — 35/35 pass
- [x] Debug live có kiểm soát (`scripts/debug-live.js`, 4 mức scan/census/solve/files —
      script tự đọc file secret, log chỉ in username đã che)
- [x] Bỏ hẳn `/tmp/token.txt` khỏi script debug (dùng `scripts/_token.js` → `auth.login`)
- [x] Đánh dấu hoàn thành FILE tài liệu qua 2 API "nút mắt" (`src/h5p/doc.js` +
      `src/core/complete.js`, `node scripts/cli.js --complete-files`)
- [x] Giải TOÀN BỘ phần H5P còn nợ + markDone server-side (`--complete-h5p` /
      parts mode trong `flow.js`) — verify thật: batch 10/11, parts 10+ mark 200 OK
- [x] Câu có **đáp án là ảnh** (text rỗng): khớp theo **tên file src ảnh**
      (`imgKey`) + unit test; verify live QuestionSet 8 câu KHTN 8/8, 37.7s
- [x] IV lồng `SingleChoiceSet`: chờ autoContinue, đọc đủ slide, không đếm
      reveal-wrong của đáp án không chọn — verify live 6/6, mark 200
- [x] IV popup `TrueFalse` (`.h5p-true-false-answer`) + nút Kiểm tra ngoài viewport
      (Playwright click thay humanClick) — verify live `ok=1 bad=0`, mark 200
- [x] Blanks lỗi 0 ô trống: đóng dialog bằng Escape/X, bỏ qua mốc an toàn
- [x] Cổng trung thực: chỉ mark khi `wrong=0` **và** `unverified=0`; còn câu
      sai/chưa xác minh → CLI báo "Chưa xác nhận hoàn thành" (exit khác 0)
- [ ] IV dùng **YouTube** (H5P.Video YouTube): không tua/dialog được trong automation
      → bỏ qua an toàn, báo FAIL để làm tay (vd "Làm mô hình nghệ thuật sắp đặt")
- [ ] `studentName` trả về rỗng từ API `hcm_login_v3` (không chặn flow, chỉ ảnh
      hưởng log/HTML hiển thị) — cần xác nhận field trả về thật của LMS360

## 📈 Số liệu cải thiện (22/10/2026)

Đo trên tài khoản thật, headless, cùng máy; thời gian là `solveItem` trọn bài
(không tính cold start của browser).

| Bài / hạng mục | Trước | Sau | Ghi chú |
|---|---|---|---|
| Sách "Kính lúp" (8 trang) | 52.9s, trang 3 click NHẦM đáp án | **32.9s, 8/8 đúng**, mark 200 | MathML: khớp `textContent` thay vì `innerText` |
| IV 1.27 SCS "ANH 8 – Unit 1 – Lesson 2" | kẹt, `ok=0 bad=3`, không mark | **70.2s, 6/6 đúng**, mark 200 | chờ autoContinue + maxSteps theo số slide + scope SCS đang mở |
| IV 1.26 "Tin học – Chủ đề B – Bài 3" | 43s, `unverified=2`, không mark | **53.7s, TF 1/1** (`ok=1 bad=0`), mark 200 | TrueFalse popup + xác nhận vỏ dialog Blanks rỗng + chờ seek trước khi bấm |
| QuestionSet đứng riêng (8 câu KHTN) | 7/8 (1 câu đáp án ảnh bỏ qua) | **8/8, 37.7s** | khớp đáp án ảnh theo src |
| Census toàn tài khoản (chỉ đọc) | chưa có | **624 khóa / 755 phần**, ~8–9s/bài | `debug-live.js census`, không ghi server |
| Unit test offline | 223 | **259 / 13 suite, 0 fail** | thêm test SCS/TF/ảnh/`waitDialog`/honesty/census + review 2 |

> Thời gian IV phụ thuộc độ dài video và vị trí mốc (bài Tin B3 có mốc ở 1086s);
> phần tối ưu chính là bỏ các `sleep` cứng, gộp truy vấn DOM và chờ feedback
> theo sự kiện. Không có bài nào bị đánh dấu hoàn thành khi còn câu chưa xác minh.
