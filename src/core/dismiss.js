'use strict';
/**
 * dismiss.js — Đóng các modal/popup của lms360 (chủ yếu "Chưa đăng ký khuôn mặt"
 * Face ID, "Để sau"/"Đăng ký ngay"). Dùng antd Modal nên selector theo text.
 */
const { sleep } = require('./stealth');

const CLOSE_TEXTS = ['Để sau', 'Bỏ qua', 'Đóng', 'Không, cảm ơn', 'Cancel', 'Skip', 'Close'];

/**
 * Thử đóng mọi modal đang hiện trên page (và các frame).
 * @param {import('playwright').Page} page
 */
async function dismissModals(page) {
  let closed = 0;
  // 1. Thử bấm nút theo text trong page chính.
  // Đọc nhãn của MỌI button/link đang hiện trong 1 lượt rồi dò theo text, thay vì
  // 7 lượt locator + 7 lượt count cho MỖI lần gọi (dismissAll chạy sau mỗi lần goto).
  try {
    const links = page.locator('button:visible, a:visible');
    const labels = await links.allInnerTexts().catch(() => []);
    const used = new Set();
    for (const t of CLOSE_TEXTS) {
      const lt = t.toLowerCase();
      const idx = labels.findIndex((s, i) => !used.has(i) && (s || '').toLowerCase().includes(lt));
      if (idx >= 0) {
        used.add(idx);
        await links.nth(idx).click({ timeout: 2000, force: true }).catch(() => {});
        closed++;
        await sleep(200);
      }
    }
  } catch (_) {}
  // 2. Nút X của ant-modal
  try {
    const xs = page.locator('.ant-modal-close, .ant-modal-wrap .anticon-close, button.ant-modal-close');
    const n = await xs.count();
    for (let i = 0; i < n; i++) { await xs.nth(i).click({ timeout: 1500, force: true }).catch(() => {}); closed++; }
  } catch (_) {}
  await sleep(250);
  return closed;
}

/**
 * Đóng modal nếu có, không throw. An toàn gọi nhiều lần.
 */
async function dismissAll(page) {
  try { return await dismissModals(page); } catch (_) { return 0; }
}

module.exports = { dismissAll, dismissModals, CLOSE_TEXTS };
