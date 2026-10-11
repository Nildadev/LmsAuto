/**
 * dump-authenticated.js — Tự dump cấu trúc mới của lms360.vn SAU LOGIN.
 *
 * Cách dùng:
 *   node scripts/dump-authenticated.js <username> <password>
 *   node scripts/dump-authenticated.js <username> <password> --browser
 *
 * Chế độ mặc định (API-only): login qua POST /api/gd/v3/hcm_login_v3,
 * rồi thử quét các endpoint khóa học / H5P, lưu vào ./dump/.
 *
 * Chế độ --browser: bơm token vào localStorage rồi mở browser thật để
 * dump DOM + H5PIntegration + screenshot từng trang quan trọng.
 *
 * Reverse-engineered từ bundle main.86a690b8.js ngày 08/10/2026:
 *   POST https://lms360.vn/api/gd/v3/hcm_login_v3 {username, password, loai:"hoc_sinh"}
 *   Token: localStorage["AccessToken"] + cookie access_token + localStorage["user_store"]
 */
const fs = require('fs');
const path = require('path');

const BASE = 'https://lms360.vn';
const API = `${BASE}/api/gd/v3`;

const [username, password] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const useBrowser = process.argv.includes('--browser');
const OUT = path.join(__dirname, '..', 'dump');
fs.mkdirSync(OUT, { recursive: true });

const save = (name, data) => {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  console.log('💾', p, `(${(fs.statSync(p).size / 1024).toFixed(1)} KB)`);
};

async function apiDump() {
  if (!username || !password) {
    console.error('❌ Thiếu username/password.\nDùng: node scripts/dump-authenticated.js <username> <password> [--browser]');
    process.exit(1);
  }
  console.log('🔑 Login qua', `${API}/hcm_login_v3 ...`);
  const res = await fetch(`${API}/hcm_login_v3`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, loai: 'hoc_sinh' }),
  });
  const body = await res.json().catch(() => ({}));
  save('01-login-response.json', { status: res.status, body });
  if (res.status !== 200 || !body?.data) {
    console.error('❌ Login thất bại. Kiểm tra lại tài khoản. Message:', body?.errors || body?.message || res.status);
    process.exit(1);
  }
  // token nằm ở nhiều chỗ tùy version: data.token / data.access_token / data.data
  const token =
    body.data?.token || body.data?.access_token || body.data?.data?.token || body.token || '';
  console.log('✅ Login OK. Token length:', String(token).length);
  save('02-token.txt', String(token));

  const auth = { 'Content-Type': 'application/json', authorization: token, Authorization: token };
  const probes = [
    ['GET', '/user_infos'],
    ['POST', '/edu_classes', { page_id: 1, per_page: 5 }],
    ['GET', '/public/h5p_courses?page_id=1&per_page=3&province_id=1&user_id=0&type=0&title='],
    ['GET', '/public/h5p_contents?page_id=1&per_page=3'],
  ];
  for (const [method, ep, payload] of probes) {
    const name = ep.split('?')[0].replace(/\//g, '_');
    try {
      const r = await fetch(API + ep, {
        method, headers: auth, body: payload ? JSON.stringify(payload) : undefined,
      });
      const j = await r.json().catch(async () => ({ _raw: (await r.text()).slice(0, 2000) }));
      save(`api-${method}-${name}.json`, { status: r.status, data: JSON.stringify(j).slice(0, 8000) });
      console.log(`${r.status} ${method} ${ep}`);
    } catch (e) { console.log('ERR', ep, e.message); }
  }
  return token;
}

async function browserDump(token) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ locale: 'vi-VN' });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('AccessToken', t);
      document.cookie = `access_token=${t}; path=/`;
    } catch {}
  }, token);
  const page = await ctx.newPage();
  for (const target of [
    `${BASE}/danh-sach-khoa-hoc-lop?per_page=5`,
    `${BASE}/danh-sach-hoc-tap`,
  ]) {
    console.log('🌐', target);
    await page.goto(target, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);
    const slug = target.includes('hoc-tap') ? 'hoc-tap' : 'khoa-hoc-lop';
    save(`${slug}.html`, await page.content());
    await page.screenshot({ path: path.join(OUT, `${slug}.png`) });
    const dump = await page.evaluate(() => ({
      url: location.href,
      h5pLibs: [...document.querySelectorAll('[class*="h5p-"]')].slice(0, 5).map((e) => e.className.toString().slice(0, 100)),
      hasH5PIntegration: typeof window.H5PIntegration !== 'undefined',
      h5pContents: window.H5PIntegration ? Object.keys(window.H5PIntegration.contents || {}) : [],
      links: [...document.querySelectorAll('a[href*="khoa-hoc"], a[href*="chi-tiet"]')].slice(0, 20).map((a) => a.href),
    }));
    save(`${slug}.dom.json`, dump);
    console.log(JSON.stringify(dump, null, 2).slice(0, 1500));
  }
  await browser.close();
}

(async () => {
  const token = await apiDump();
  if (useBrowser) await browserDump(token);
  else console.log('\n💡 Chạy thêm --browser để dump DOM + screenshot sau login.');
})();
