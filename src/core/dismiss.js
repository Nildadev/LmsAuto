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
  // 1. Thử bấm nút theo text trong page chính
  for (const t of CLOSE_TEXTS) {
    const btn = page.locator(`button:has-text("${t}"), .ant-modal-footer button:has-text("${t}"), a:has-text("${t}")`).first();
    try {
      if (await btn.count()) { await btn.click({ timeout: 2000, force: true }); closed++; await sleep(400); }
    } catch (_) {}
  }
  // 2. Nút X của ant-modal
  try {
    const xs = page.locator('.ant-modal-close, .ant-modal-wrap .anticon-close, button.ant-modal-close');
    const n = await xs.count();
    for (let i = 0; i < n; i++) { await xs.nth(i).click({ timeout: 1500, force: true }).catch(() => {}); closed++; }
  } catch (_) {}
  await sleep(500);
  return closed;
}

/**
 * Đóng modal nếu có, không throw. An toàn gọi nhiều lần.
 */
async function dismissAll(page) {
  try { return await dismissModals(page); } catch (_) { return 0; }
}

module.exports = { dismissAll, dismissModals, CLOSE_TEXTS };
