<div align="center">

# 🎓 LMS360 Auto Solver

**Tự động hóa việc học trên [lms360.vn](https://lms360.vn) — Đăng nhập SSO, quét khóa học và giải bài tập H5P tương tác hoàn toàn tự động.**

[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Playwright](https://img.shields.io/badge/Playwright-1.59+-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)](https://playwright.dev)
[![Next.js](https://img.shields.io/badge/Next.js-16+-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg?style=for-the-badge)](LICENSE)

</div>

---

## ✨ Tính năng

- 🔐 **Đăng nhập SSO tự động** — Hỗ trợ hệ thống SSO của Sở Giáo dục & Đào tạo TP.HCM (`api.hcm.edu.vn`)
- 📋 **Quét khóa học thông minh** — Lọc và thu thập chỉ các khóa học **Chưa học** & **Đang học**
- 🛡️ **Bỏ qua popup** — Tự động đóng popup quét khuôn mặt (Face ID) khi xuất hiện
- 🤖 **Giải bài tập H5P** — Hỗ trợ 3 loại bài tập:
  - ✅ Trắc nghiệm nhiều lựa chọn (Multi-choice)
  - ✅ Trắc nghiệm một lựa chọn (Single-choice)
  - ✅ Đúng / Sai (True/False)
- 🎬 **Hỗ trợ Video tương tác** — Tự động xử lý các điểm tương tác trên video H5P
- 🔄 **Xác minh thông tin đăng nhập** — Phát hiện tài khoản sai và yêu cầu nhập lại ngay lập tức
- 💻 **CLI tương tác** — Giao diện dòng lệnh đẹp với input ẩn mật khẩu và xác nhận trực quan

---

## 📁 Cấu trúc dự án

```
LMSAutoNew/
├── lib/
│   └── automation.js      # Logic tự động hóa cốt lõi (Playwright)
├── scripts/
│   └── cli.js             # Giao diện dòng lệnh (CLI)
├── app/
│   └── page.js            # Entry point Next.js (không bắt buộc)
├── package.json
├── LICENSE
└── README.md
```

---

## 🚀 Cài đặt

### Yêu cầu hệ thống

- [Node.js](https://nodejs.org) **v22+**
- npm **v9+**

### Các bước cài đặt

```bash
# 1. Clone repository
git clone https://github.com/yourusername/lms360-auto-solver.git
cd lms360-auto-solver

# 2. Cài đặt dependencies
npm install

# 3. Cài đặt trình duyệt Playwright (chỉ cần làm 1 lần)
npx playwright install chromium
```

---

## 🖥️ Sử dụng

```bash
npm run auto
```

Sau khi chạy, giao diện CLI sẽ xuất hiện:

```
=================================================
   LMS360 AUTO SOLVER Made With ❤️ By Nildadev
=================================================
? 👤 Tài khoản: › 12345678910
? 🔑 Mật khẩu: › ************

🚀 Bắt đầu quá trình tự động hóa...
------------------------------------
✅ Login successful!
📚 Navigating to course list...

📊 BÁO CÁO QUÉT KHÓA HỌC:
- Tổng số khóa học tìm thấy: 3
  1. Văn 8 - Tuần 13
  2. Toán 8 - Tuần 12
  3. Anh 8 - Tuần 11

? ❓ Bạn có chắc chắn muốn bắt đầu học hết 3 khóa học này không? › Yes
```

---

## ⚙️ Cấu hình

Bạn có thể chỉnh sửa các tham số trong `lib/automation.js`:

| Tham số | Mặc định | Mô tả |
|---------|----------|-------|
| `headless` | `false` | Chạy trình duyệt ẩn (`true`) hoặc hiện (`false`) |
| `timeout` SSO | `30000ms` | Thời gian chờ redirect về SSO |
| `timeout` redirect | `60000ms` | Thời gian chờ redirect về lms360.vn |

Để chạy ở chế độ ẩn (không hiện trình duyệt), sửa dòng 4 trong `lib/automation.js`:

```js
// Đổi từ:
const browser = await chromium.launch({ headless: false });
// Sang:
const browser = await chromium.launch({ headless: true });
```

---

## 🧠 Cách hoạt động

```
1. Mở trình duyệt Chromium
       │
2. Điều hướng đến lms360.vn → Chọn vai trò "Học sinh"
       │
3. Redirect đến SSO Sở GD&ĐT TP.HCM → Nhập tài khoản/mật khẩu
       │
       ├─ Sai thông tin → Thông báo lỗi → Nhập lại
       └─ Đúng → Redirect về lms360.vn
       │
4. Điều hướng đến Danh sách Khóa học
       │
5. Áp dụng lần lượt bộ lọc "Chưa học" và "Đang học" → Thu thập tiêu đề
       │
6. Xác nhận từ người dùng
       │
7. Với mỗi khóa học:
   ├─ Mở khóa học → Chuyển tab "CHỦ ĐỀ HỌC TẬP"
   ├─ Tìm bài tập qua biểu tượng PlayArrow
   └─ Với mỗi bài tập: Click → Giải H5P → Nộp bài → Quay lại
```

---

## ⚠️ Lưu ý & Giới hạn

- Công cụ được xây dựng cho mục đích **cá nhân và học thuật**.
- Không lưu trữ thông tin đăng nhập. Mọi credential chỉ tồn tại trong phiên chạy hiện tại.
- Hiệu quả phụ thuộc vào cấu trúc HTML của `lms360.vn`. Nếu trang web cập nhật giao diện, có thể cần điều chỉnh các CSS selector.
- Popup **Face ID** sẽ bị tự động bỏ qua (bấm "Để sau") mỗi khi xuất hiện.

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

Dự án được phân phối theo giấy phép **Apache License 2.0**. Điều này có nghĩa là bạn có quyền sử dụng, sửa đổi và phân phối mã nguồn, nhưng **bắt buộc phải ghi nguồn (attribution)** và giữ nguyên các thông báo bản quyền của tác giả gốc.

Xem chi tiết tại [LICENSE](LICENSE).

```text
Copyright 2026 Nildadev

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

<div align="center">
  Made with ❤️ by <strong>Nildadev</strong>
</div>
