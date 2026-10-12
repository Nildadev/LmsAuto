# H5P Answer Map — reverse-engineered từ lms360.vn (11/10/2026)

## Cách lấy đáp án (then chốt)
Đáp án KHÔNG có qua REST API. Chỉ nằm trong `window.H5PIntegration.contents[<key>].jsonContent`
sau khi H5P player khởi chạy trong iframe. Phải dùng Playwright + evaluate trong frame H5P.

```js
// trong frame H5P (page.frames() tìm frame có url lms360/xem-video hoặc H5PIntegration)
const contents = window.H5PIntegration.contents;
for (const k in contents) {
  let jc = contents[k].jsonContent;          // thường là STRING JSON
  const data = typeof jc === 'string' ? JSON.parse(jc) : jc;
  // data = jsonContent params, đọc theo dạng bên dưới
}
```

## URL xem nội dung
`/xem-video?p=<h5p_content_id(UUID)>&c=<content_id(24hex)>&cs=<course_id(UUID)>`

## API stack
```
POST /api/gd/v3/hcm_login_v3 {username,password,loai:"hoc_sinh"} -> AccessToken (JWT)
GET  /api/gd/v3/student_courses              (62 courses; status: 0/1/2 = chưa/đang/xong)
GET  /api/gd/v3/h5p/contents?course_id=2026&part_id=-1&mode=-1  (700 contents, phân trang)
POST /api/gd/v3/h5p/contents/detail {h5p_content_id, content_id} -> metadata (KHÔNG có đáp án)
```

## 11 dạng H5P được hỗ trợ (main.js) + cách đọc đáp án từ jsonContent

| Library | Tên | Đọc đáp án |
|---------|-----|-----------|
| H5P.MultiChoice 1.16 | Trắc nghiệm nhiều đáp án | `params.answers[].correct === true` |
| H5P.SingleChoiceSet | 1 đáp án đúng | `params.answers[].correct === true` |
| H5P.TrueFalse | Đúng/Sai | `params.answers[].correct` |
| H5P.Blanks 1.14 | Điền vào chỗ trống | `params.text` chứa token `*đáp án*`; hoặc `params.questions[]` |
| H5P.DragText | Kéo từ | `params.text` chứa `*từ*` + `params.Behaviour...` |
| H5P.DragQuestion 1.14 | Kéo thả | `params.question.task.dropZones[].correctElements` = index vào `elements[]` (đọc text ở `elements[].type.params.text`) |
| H5P.MarkTheWords | Đánh dấu từ | `params.text` chứa `*từ*` |
| H5P.Summary | Chọn câu đúng/sai | `params.overallFeedback` + `params.summaries[].subContents[].correctText` |
| H5P.SpeakTheWords | Phát âm | `params.answers[].correct` |
| H5P.GuessTheAnswer | Đoán đáp án | `params.answers[].solution` |
| H5P.InteractiveVideo 1.24-1.27 | Video + marker | `params.interactiveVideo.assets.interactions[].action` (library con bên trong) |
| H5P.QuestionSet 1.20 | Bộ câu hỏi | `params.questions[]` = mảng sub-question (mỗi cái có `.library` + `.params` như trên); `params.passPercentage`, `params.introPage` |
| H5P.InteractiveBook | Sách lật trang | `params.chaptersData`/`params.chapters[].params.content` (sub-content từng trang) |
| H5P.CoursePresentation | Trình chiếu | `params.slides[].elements[].action` (sub-content) |
| H5P.BranchingScenario | Kịch bản nhánh | `params.scoringQuestion...` / `params.content[].action` |

## Phân bố loại câu hỏi thực tế (700 contents mẫu, 513 có câu hỏi)
```
SingleChoice : 404   (đa số)
MultiChoice  : 259
Blanks       : 90
Other        : 89    (DragText/MarkWords/Summary/Guess...)
TrueFalse    : 40
```
→ Ưu tiên solver: SingleChoice > MultiChoice > Blanks > TrueFalse > Other

## Dạng UI player (3 dạng bạn mô tả)
1. **InteractiveVideo**: splash-play → video chạy → marker popup (`Gửi trả lời`) → cuối video `h5p-star`/Nộp bài
2. **QuestionSet/InteractiveBook/CoursePresentation**: nhiều câu liên tiếp → trang/câu cuối có `Kiểm tra`/`Nộp bài`
3. **Video thuần**: xem hết tự hoàn thành

## Mode bits (course sharing)
`1=Ngân hàng HL số  4=Trong lớp  8=Trong trường  16=Cộng đồng GV  64=Trường đang dạy  128=Nộp bài tập huấn hè  512=Ngân hàng HLS PGD`

## Stealth notes
- CDN: `cdnc.lms360.vn/elearning/p52/h5p/...` (403 nếu direct-fetch, phải qua browser)
- React SPA + JWT trong localStorage `AccessToken` + cookie `access_token`
- Dùng `patchright` + `channel:chrome` + fingerprint `vi-VN`/`Asia/Ho_Chi_Minh`
