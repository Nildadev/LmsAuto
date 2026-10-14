<div align="center">

# LMS360 Auto Solver

**Tự động học trên [lms360.vn](https://lms360.vn) — đăng nhập, làm bài và hoàn thành khóa học thay bạn, hoàn toàn tự động.**

[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Playwright](https://img.shields.io/badge/Playwright-1.59+-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)](https://playwright.dev)
[![Next.js](https://img.shields.io/badge/Next.js-16+-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg?style=for-the-badge)](LICENSE)

</div>

---

## ✨ Tính năng

- 🔐 **Đăng nhập tự động** — Dùng tài khoản nhà trường, lấy phiên đăng nhập rồi tự động
  điền vào trình duyệt, không cần bạn tự đăng nhập bằng tay
- 📋 **Tự quét bài cần làm** — Lấy danh sách bài được giao, lọc bớt môn phụ (thể dục,
  âm nhạc…) và các bài tự luận không làm được
- 📝 **Làm đủ các dạng bài** trên trang:
  - ✅ Trắc nghiệm một / nhiều đáp án
  - ✅ Đúng / Sai
  - ✅ Điền từ, kéo‑thả, chọn từ
  - ✅ Tóm tắt, bộ câu hỏi
  - ✅ Bài học dạng sách / slide
  - ✅ Video bài giảng có câu hỏi xen giữa (tự dừng, trả lời, tiếp tục)
- 📄 **Tự đánh dấu hoàn thành tài liệu đính kèm** — file pptx / pdf / doc / mp4… chỉ cần
  "xem" là xong, không cần mở từng cái
- 🎓 **Làm lại các bài còn dở** — quét toàn bộ bài chưa xong trong khóa và hoàn thành nốt
- 🛡️ **Tự bỏ qua popup** — Tự động đóng cửa sổ nhận diện khuôn mặt mỗi khi hiện ra
- 💻 **Hai cách dùng** — Giao diện dòng lệnh (CLI) hoặc Giao diện web có **xem trước
  trình duyệt trực tiếp** (trình duyệt chạy ẩn trên máy chủ, web chỉ hiển thị hình ảnh)

---

## 📁 Cấu trúc dự án

```
LmsAuto/
├── scripts/
│   └── cli.js          # Giao diện dòng lệnh (CLI)
├── src/
│   ├── core/           # Lõi: đăng nhập, quét bài, chạy luồng chính
│   └── h5p/            # Các bộ giải bài tập, video, sách, tài liệu
├── app/                # Giao diện web (Next.js): page.js + api/solve
├── Dockerfile          # Đóng gói để deploy (Render/Docker)
├── render.yaml         # Blueprint deploy Render
├── package.json
├── LICENSE
└── README.md
```

---

## 🚀 Cài đặt

### Yêu cầu

- [Node.js](https://nodejs.org) **22 trở lên**
- npm **9 trở lên**

### Các bước

```bash
# 1. Clone repository
git clone https://github.com/Nildadev/LmsAuto
cd LmsAuto

# 2. Cài đặt thư viện
npm install

# 3. Cài trình duyệt chromium (chỉ làm 1 lần)
npx playwright install chromium
```

---

## 🖥️ Sử dụng

### Cách 1 — Dòng lệnh (CLI)

```bash
npm run auto
```

Chương trình sẽ hỏi tài khoản và mật khẩu (mật khẩu được ẩn), sau đó tự chạy.
Các tuỳ chọn thêm:

```bash
npm run auto -- --dry-run     # Chỉ liệt kê bài, không làm
npm run auto -- --limit=5     # Chỉ làm 5 bài đầu
npm run auto -- --all         # Không lọc bớt môn phụ
npm run auto -- --headless    # Chạy ẩn trình duyệt
```

### Cách 2 — Giao diện web

```bash
npm run dev
```

Mở trình duyệt vào địa chỉ hiện ra (thường là http://localhost:3000). Nhập tài
khoản, mật khẩu, bấm **START AUTOMATION**. Bạn sẽ thấy:

- **Bảng điều khiển** hiện số bài tổng / đã xong / lỗi / bỏ qua
- **Hình ảnh trực tiếp** của trình duyệt đang chạy (trình duyệt chạy ẩn trên máy
  chủ, web chỉ hiển thị ảnh xem trước — không bật cửa sổ thật)
- **Nhật ký** từng bước đang làm

> Trình duyệt luôn chạy ở chế độ ẩn (headless) trên máy chủ. Nếu bạn mở web trên
> chính máy chủ và muốn thấy cửa sổ thật, tắt "Headless Mode" trong giao diện.

### Hoàn thành tài liệu / làm lại bài dở (CLI)

```bash
npm run auto -- --complete-files   # Đánh dấu hoàn thành mọi file tài liệu đính kèm
npm run auto -- --complete-h5p     # Làm lại & hoàn thành mọi bài tập còn dở
```

---

## ⚙️ Cấu hình

- **Chế độ ẩn / hiện trình duyệt**: bật/tắt "Headless Mode" trên web, hoặc dùng
  cờ `--headless` với CLI. Mặc định trình duyệt chạy ẩn.
- **Môn bỏ qua**: trên web nhập danh sách môn cách nhau bởi dấu phẩy (vd:
  `thể dục, âm nhạc, mĩ thuật`); với CLI dùng cờ `--all` để không lọc.

---

## ☁️ Triển khai (Deploy) — Render free

Cách rẻ nhất để có URL công khai (dùng được từ điện thoại) mà **không cần thẻ
tín dụng** là deploy bằng Docker lên [Render](https://render.com) gói Free.

### Cách 1 — Blueprint (nhanh nhất)

Repo đã có sẵn `Dockerfile` và `render.yaml`. Vào Render → **New → Blueprint**,
chọn repo này, Render tự đọc `render.yaml` và deploy.

### Cách 2 — Thủ công

Render → **New → Web Service** → chọn repo → **Runtime: Docker** → **Plan: Free**
→ **Region: Singapore** (gần Việt Nam nhất) → Deploy. Render tự dùng `Dockerfile`.

### Lưu ý quan trọng với gói Free

- **RAM chỉ 512MB.** Chromium rất ngốn RAM, nên image đã bật sẵn biến
  `LMS_CHROMIUM_LOW_MEMORY=1` để thêm cờ tiết kiệm RAM (không dùng
  `--single-process` vì gây trắng/crash preview). Nếu Chromium chạy bất ổn,
  đặt biến này thành `0` trong tab **Environment** — đổi lại sẽ tốn RAM hơn.
- **Ngủ sau 15 phút rảnh** → lần truy cập đầu sẽ chậm ~30–60 giây (cold start).
- **750 giờ/tháng** — với 1 service thì gần như không đụng trần.
- Nên **giải từng lượt, ít bài một** để tránh OOM; tránh chạy nhiều người cùng lúc.

### Tự host bằng Docker

```bash
docker build -t lmsauto .
docker run -p 10000:10000 lmsauto   # mở http://localhost:10000
```

> Máy tự host có nhiều RAM hơn → đặt `LMS_CHROMIUM_LOW_MEMORY=0` cho ổn định nhất.

---

## ⚠️ Lưu ý & Giới hạn

- Công cụ phục vụ **mục đích cá nhân, học tập**. Tác giả không chịu trách nhiệm với
  các cách sử dụng sai mục đích.
- Không lưu tài khoản: thông tin chỉ tồn tại trong lúc chương trình chạy.
- Hoạt động phụ thuộc vào giao diện của lms360.vn. Nếu trang thay đổi, có thể cần
  chỉnh lại một số thao tác.
- Popup nhận diện khuôn mặt sẽ tự động bỏ qua (bấm "Để sau").

---

## 🤝 Đóng góp

Pull request và issue đều được chào đón! Trước khi đóng góp, vui lòng:

1. Fork repository
2. Tạo nhánh mới: `git checkout -b feature/ten-tinh-nang`
3. Commit: `git commit -m 'feat: mô tả thay đổi'`
4. Push: `git push origin feature/ten-tinh-nang`
5. Tạo Pull Request

---

## 📄 Giấy phép

Dự án được phân phối theo giấy phép **Apache License 2.0** — bạn được dùng, sửa và
chia sẻ mã nguồn, nhưng **phải ghi nguồn** và giữ nguyên thông báo bản quyền gốc.

Xem chi tiết tại [LICENSE](LICENSE).

---

<div align="center">
  Made with ❤️ by <strong>Nildadev</strong>
</div>
