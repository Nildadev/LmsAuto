'use strict';
/**
 * stealth.js — Khởi tạo browser "giống người thật" + human interaction.
 * Dùng Playwright launch + newContext (KHÔNG dùng persistent context — xem lưu ý dưới),
 * fingerprint vi-VN, và click/type/scroll có độ trễ ngẫu nhiên. Tự đăng nhập qua
 * API (auth.js) và inject token trước khi mở trang.
 *
 * LƯU Ý: patchright/Camoufox cần Chrome thật (channel:'chrome') nên mạnh hơn,
 * nhưng môi trường này không có Chrome hệ thống. Playwright + persistent
 * context vẫn giảm mạnh dấu hiệu bot và luôn CHẠY ĐƯỢC để debug.
 */
const path = require('path');
const fs = require('fs');
const { login } = require('./auth');

const PROFILE_DIR = path.join(process.cwd(), '.profiles', 'lms360');

// Trang mở sẵn trên tab chính để cửa sổ browser KHÔNG trắng tinh (about:blank).
// Trước đây launch() chỉ newPage() mà không goto đâu cả -> chạy headed (CLI mặc
// định, hoặc headlessMode=false trên web) người dùng thấy cửa sổ trắng xóa suốt
// phiên (nhất là khi toàn bài file/doc không mở tab nào, hoặc lúc nghỉ giữa 2 bài).
const HOME_URL = 'https://lms360.vn/';

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Nghỉ ngắn giữa các hành động. Trước đây 120-520ms (trung bình ~320ms) cộng dồn
// rất nhiều vì mỗi câu hỏi có thể click 1-4 đáp án. Vẫn giữ độ trễ ngẫu nhiên để
// nhịp không đều, nhưng ngắn hơn nhiều.
const humanDelay = () => sleep(rand(40, 140));

/** Inject token HCM vào localStorage trước khi trang load (chạy trong page). */
function injectTokenScript(token) {
  // LƯU Ý: truyền token qua ARG của addInitScript để Playwright serialize đúng.
  // Nếu dùng closure kiểu `() => { ...token... }` thì token sẽ bị undefined.
  return function (t) {
    try {
      localStorage.setItem('AccessToken', t);
      document.cookie = `access_token=${t}; path=/`;
    } catch (_) {}
  };
}

/** Arg đi kèm injectTokenScript. */
const injectTokenArg = (token) => token || '';

/**
 * Giải token để inject: ưu tiên opts.token, nếu không có thì login bằng
 * opts.username/opts.password (API). Trả '' nếu không có gì.
 * @returns {Promise<string>}
 */
async function resolveToken(opts = {}) {
  if (opts.token) return opts.token;
  if (opts.username && opts.password) {
    return login(opts.username, opts.password, { logger: opts.logger, fetchImpl: opts.fetchImpl });
  }
  return '';
}

/**
 * Khởi tạo browser + context giống người dùng VN.
 * @param {object} opts { headless, token, username, password, logger,
 *                        homeUrl, homeTimeoutMs, skipHome }
 *   skipHome=true: bỏ qua goto trang chủ (dùng cho test offline/mock page).
 * @returns {Promise<{browser, context, page, token}>}
 */
async function launch(opts = {}) {
  // Playwright được cài trong project (dependency). Nếu thiếu -> báo lỗi rõ ràng.
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (_) {
    throw new Error(
      "Không tìm thấy Playwright. Chạy 'npm install' và 'npx playwright install chromium' trước."
    );
  }
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  // Token: nhận sẵn hoặc tự login qua API (thay thế phụ thuộc /tmp/token.txt).
  const token = await resolveToken(opts);

  // LƯU Ý (đã debug thực tế): launchPersistentContext khiến H5P player của
  // lms360 KHÔNG render (chỉ 1 frame, không có H5PIntegration). Nên dùng
  // launch + newContext — đã verify tạo đủ 2 frame và có đáp án.
  //
  // Bộ cờ tiết kiệm RAM cho host 512MB (Render free). Bật cờ "nặng" bằng
  // env LMS_CHROMIUM_LOW_MEMORY=1 (Dockerfile đặt sẵn).
  // LƯU Ý: KHÔNG thêm --single-process vào đây — nó làm Chromium trắng tinh /
  // crash với newContext + screencast (xem khối lowMemory bên dưới).
  const lowMemory = process.env.LMS_CHROMIUM_LOW_MEMORY === '1';
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--mute-audio',
    '--hide-scrollbars',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=Translate,BackForwardCache,MediaRouter,OptimizationHints,AcceptCHFrame',
  ];
  // KHÔNG dùng --disable-gpu/--disable-software-rasterizer nữa: để Chromium tận dụng
  // GPU/SwiftShader -> giảm tải CPU khi decode video + encode screencast. Nếu host
  // không có GPU mà render lỗi, đặt LMS_CHROMIUM_DISABLE_GPU=1 để bật lại.
  if (process.env.LMS_CHROMIUM_DISABLE_GPU === '1') {
    args.push('--disable-gpu', '--disable-software-rasterizer');
  }
  if (lowMemory) {
    // LƯU Ý: KHÔNG dùng --single-process — cờ này khiến Chromium render trắng
    // tinh / crash khi dùng newContext + CDP screencast (đã gặp thực tế: browser
    // mở lên chỉ trắng xóa, không nội dung). Chỉ giữ cờ nhẹ, an toàn.
    args.push(
      '--no-zygote',
      '--js-flags=--max-old-space-size=128',
    );
  }
  const browser = await chromium.launch({
    headless: opts.headless !== false,
    args,
  });
  const context = await browser.newContext({
    viewport: { width: 1366 + rand(-40, 40), height: 768 + rand(-30, 30) },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    geolocation: { latitude: 10.762622, longitude: 106.660172 },
    permissions: [],
    colorScheme: 'light',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  // Xoá dấu vết navigator.webdriver + giả plugin/languages cho giống Chrome thật.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
  });
  if (token) await context.addInitScript(injectTokenScript(token), injectTokenArg(token));

  const page = await context.newPage();
  // Mở sẵn trang LMS trên tab CHÍNH để cửa sổ headed không trắng (about:blank).
  // Token đã inject qua addInitScript nên trang này load ở trạng thái đăng nhập.
  // Không đợi networkidle (SPA lms360 treo request) — domcontentloaded là đủ.
  // Timeout mặc định 15s (không phải 30s) để máy offline không treo launch quá lâu.
  // skipHome: test offline dùng page mock không có goto/bringToFront -> bỏ qua.
  if (!opts.skipHome && page && typeof page.goto === 'function') {
    try {
      await page.goto(opts.homeUrl || HOME_URL, {
        waitUntil: 'domcontentloaded',
        timeout: opts.homeTimeoutMs || 15000,
      });
      // Cho SPA render khung trang rồi mới trả page về (không ngủ cứng khi test mock).
      await sleep(1200);
      if (typeof page.bringToFront === 'function') await page.bringToFront().catch(() => {});
    } catch (_) { /* mở trang chủ thất bại -> vẫn trả page, flow sẽ goto từng bài */ }
  }
  return { browser, context, page, token };
}

/** Lấy Page object từ frame hoặc page (Frame có .page(), Page thì không). */
function toPage(pageOrFrame) {
  return (pageOrFrame && typeof pageOrFrame.page === 'function') ? pageOrFrame.page() : pageOrFrame;
}

/** Click kiểu người: di chuột tới đích rồi nhấn/nhả (trusted event qua CDP). */
async function humanClick(page, locator) {
  const pg = toPage(page);
  try {
    const box = await locator.boundingBox();
    if (!box) return locator.click({ timeout: 4000 });
    const x = box.x + box.width * (0.3 + Math.random() * 0.4);
    const y = box.y + box.height * (0.3 + Math.random() * 0.4);
    // TỐI ƯU: 1 lần move ngắn (2-4 bước) + nhấn/nhả nhanh. Trước đây move 2 lần
    // (1 lần xa 4-9 bước + 1 lần 10-22 bước) = 14-31 event mousemove mà trang phải
    // xử lý, cộng 3 sleep (~200ms). Vẫn là trusted event thật, chỉ bớt "diễn".
    await pg.mouse.move(x, y, { steps: rand(2, 4) });
    await sleep(rand(15, 40));
    await pg.mouse.down();
    await pg.mouse.up();
    return true;
  } catch (_) {
    // Overlay aria-hidden (poster) đôi khi chặn hit-test của Playwright;
    // dùng force click để bắn real trusted event đúng toạ độ.
    return locator.click({ timeout: 4000, force: true }).catch(() => locator.click({ timeout: 4000 }));
  }
}

/** Gõ chữ kiểu người: từng ký tự, thỉnh thoảng khựng. */
async function humanType(locator, text) {
  await locator.click({ timeout: 4000 });
  await humanDelay();
  for (const ch of text) {
    await locator.pressSequentially(ch, { delay: rand(45, 160) });
    if (Math.random() < 0.03) await sleep(rand(300, 800));
  }
}

/** Cuộn trang từng đoạn như người. */
async function humanScroll(page, px) {
  let left = px;
  while (left > 0) {
    const step = Math.min(left, rand(120, 400));
    await page.mouse.wheel(0, step);
    await sleep(rand(60, 200));
    left -= step;
  }
}

module.exports = { launch, resolveToken, humanClick, humanType, humanScroll, rand, sleep, humanDelay, PROFILE_DIR, HOME_URL };
