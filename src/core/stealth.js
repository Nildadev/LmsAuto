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

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const humanDelay = () => sleep(rand(120, 520));

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
 * @param {object} opts { headless, token, username, password, logger }
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
  // env LMS_CHROMIUM_LOW_MEMORY=1 (Dockerfile đặt sẵn). Tắt đi nếu Chromium
  // bất ổn (single-process đôi khi làm hỏng newContext/screencast).
  const lowMemory = process.env.LMS_CHROMIUM_LOW_MEMORY === '1';
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-extensions',
    '--mute-audio',
    '--hide-scrollbars',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=Translate,BackForwardCache,MediaRouter,OptimizationHints,AcceptCHFrame',
  ];
  if (lowMemory) {
    args.push(
      '--single-process',
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
  return { browser, context, page, token };
}

/** Lấy Page object từ frame hoặc page (Frame có .page(), Page thì không). */
function toPage(pageOrFrame) {
  return (pageOrFrame && typeof pageOrFrame.page === 'function') ? pageOrFrame.page() : pageOrFrame;
}

/** Click kiểu người: di chuột cong -> xuống -> lên (trusted event). */
async function humanClick(page, locator) {
  const pg = toPage(page);
  try {
    const box = await locator.boundingBox();
    if (!box) return locator.click({ timeout: 4000 });
    const x = box.x + box.width * (0.3 + Math.random() * 0.4);
    const y = box.y + box.height * (0.3 + Math.random() * 0.4);
    await pg.mouse.move(rand(200, 500), rand(150, 400), { steps: rand(4, 9) });
    await pg.mouse.move(x, y, { steps: rand(10, 22) });
    await sleep(rand(60, 180));
    await pg.mouse.down();
    await sleep(rand(35, 120));
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

module.exports = { launch, resolveToken, humanClick, humanType, humanScroll, rand, sleep, humanDelay, PROFILE_DIR };
