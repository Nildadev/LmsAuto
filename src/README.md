# LmsAuto v2 — Core Solver (đã verify chạy thật)

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
│                     (cờ --dry-run/--limit/--headless/--all/--complete-files/--complete-h5p)
├── _token.js         nguồn token dùng chung (env → file cũ → API login) cho script debug
└── debug-solve.js    test end-to-end trên 1 bài thật
tests/
├── extract.test.js   unit test extract trên dữ liệu dump thật (13 cases)
├── book.test.js      unit test schema/question của book
├── doc.test.js       unit test 2 API nút mắt + solveDoc (mock fetch, 8/8)
├── complete.test.js  unit test quét/phân loại/đánh dấu file (mock fetch, 10/10)
├── auth-scan.test.js unit test auth + scan (mock fetch, 20/20)
└── flow.test.js      unit test orchestrator (inject deps, 19/19)
```

## Cách chạy

```bash
# 1. Cài deps (đã dùng playwright 1.64.0 để khớp browser cache)
npm install

# 2. KHÔNG cần token thủ công: stealth.launch({username,password}) tự gọi
#    API hcm_login_v3 lấy JWT rồi inject vào localStorage['AccessToken'] + cookie.
#    (Nếu muốn tái dùng token cũ: truyền {token: '<JWT>'}.)

# 3. Unit test (không cần browser)
node tests/extract.test.js      # 13 cases
node tests/book.test.js         # schema/question book
node tests/doc.test.js          # 8/8 (2 API nút mắt + solveDoc)
node tests/complete.test.js     # 10/10 (quét/phân loại/đánh dấu file)
node tests/auth-scan.test.js    # 20/20
node tests/flow.test.js         # 19/19 (orchestrator + parts mode + markDone)
npm test                        # chạy tất cả (6 suite)

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

## Kết quả verify (chạy thật trên lms360.vn)

| Dạng | Kết quả | Cách đo |
|---|---|---|
| MultiChoice / SingleChoice / TrueFalse | ✅ đúng | score bar `100%`, endscreen `1/1` |
| Blanks | ✅ đúng | điền 10/10, `correct:10 wrong:0` |
| DragQuestion | ✅ đúng | kéo 4/4, `correct:4 wrong:0` |
| QuestionSet (12 câu) | ✅ 11/12 | `SCORE bar:100% txt:10` |
| InteractiveVideo (summary+2MC) | ✅ đúng 2/2 MC | endscreen `1/1`, submit "thành công" `2/4` |
| CoursePresentation (3 slide Blanks) | ✅ đúng 3/3 slide | mỗi slide `good>0 wrong=0`, bar `100%`; API `/h5p/scores` → `score:10 num_correct:18/18` |
| InteractiveBook "Bài 7. Lăng kính" (5 trang + IV lồng) | ✅ 5/5 trang đúng, IV 2/2 | bar `100%`, mỗi trang `good>0 wrong=0`; login→scan→solve→submit liền mạch |

> Ghi chú: một số bài IB/CP có breakdown xAPI nội bộ hiển thị "8/10", "0/2"
> (H5P tự chia sub-score) dù **thanh điểm tổng = 100%** và mọi feedback cục bộ
> đều đúng — coi là non-blocking (không ảnh hưởng điểm ghi nhận).

## Lộ trình tiếp theo

- [x] Blanks / DragQuestion solver (click)
- [x] InteractiveVideo (play → poll dialog → summary+MC → continue)
- [x] QuestionSet walker (lật từng câu → check → next)
- [x] Sách online CoursePresentation (walker lật slide → blanks/choice → check)
- [x] InteractiveBook (walker lật trang + IV lồng, delegate `solveVideo`)
- [x] Login qua API `hcm_login_v3` (`src/core/auth.js`) + inject token vào stealth
- [x] Quét bài được giao qua `my_assigned_pending` (`src/core/scan.js`) → URL xem-video
- [x] Unit test auth + scan (mock fetch) — 20/20 pass
- [x] Flow đầy đủ đa bài: login → scan → skip solved/doc-only → solve (CP/IB/IV) → submit (`src/core/flow.js`, `npm run auto`)
- [x] Unit test orchestrator (inject deps) — 19/19 pass
- [x] Bỏ hẳn `/tmp/token.txt` khỏi script debug (dùng `scripts/_token.js` → `auth.login`)
- [x] Đánh dấu hoàn thành FILE tài liệu qua 2 API "nút mắt" (`src/h5p/doc.js` +
      `src/core/complete.js`, `node scripts/cli.js --complete-files`)
- [x] Giải TOÀN BỘ phần H5P còn nợ + markDone server-side (`--complete-h5p` /
      parts mode trong `flow.js`) — verify thật: batch 10/11, parts 10+ mark 200 OK
- [ ] IV dùng **YouTube** (H5P.Video YouTube): không tua/dialog được trong automation
      → bỏ qua an toàn, báo FAIL để làm tay (vd "Làm mô hình nghệ thuật sắp đặt")
