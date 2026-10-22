/**
 * Chẩn đoán SingleChoiceSet lồng trong InteractiveVideo.
 * Mặc định CHỈ ĐỌC: mở đúng mốc rồi dump cấu trúc slide/alternative, KHÔNG bấm
 * đáp án (không ghi điểm). `--answer=true` sẽ bấm đáp án đúng và GHI ĐIỂM lên
 * server — chỉ dùng khi chủ động điều tra. Dùng để điều tra lỗi "ok=0 bad=3".
 *
 *   node scripts/debug-scs.js --stop=66.287
 */
const os = require('os');
const path = require('path');
const { readCreds, mask } = require('./_creds');
const { login } = require('../src/core/auth');
const { launch, sleep } = require('../src/core/stealth');
const { findPlayerFrame } = require('../src/h5p/answers');
const { dismissAll } = require('../src/core/dismiss');

const arg = (name, def) => {
  const pre = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : def;
};
const P = arg('p', '6e2229d2-7254-41c4-9f01-5a16090c7bb9');
const CS = arg('cs', 'e8bbb285-761e-48d8-ae3d-58887941936c');
const STOP = Number(arg('stop', '66.287'));
const url = `https://lms360.vn/xem-video?p=${P}&c=&cs=${CS}`;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const dump = (frame) => frame.evaluate(() => {
  const style = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      d: s.display, v: s.visibility, o: s.opacity,
      r: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    };
  };
  const txt = (el) => String((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const slides = [...document.querySelectorAll('.h5p-sc-slide')].map((el, i) => ({
    i,
    cls: String(el.className),
    st: style(el),
    question: txt(el.querySelector('.h5p-sc-question')),
    alts: [...el.querySelectorAll('.h5p-sc-alternative')].map((a, j) => ({
      j,
      txt: txt(a),
      cls: String(a.className),
      st: style(a),
      checked: a.getAttribute('aria-checked'),
    })),
  }));
  const scs = document.querySelector('.h5p-single-choice-set');
  return {
    counts: {
      scs: document.querySelectorAll('.h5p-single-choice-set').length,
      slides: slides.length,
      current: document.querySelectorAll('.h5p-sc-current-slide').length,
      alts: document.querySelectorAll('.h5p-sc-alternative').length,
      visibleAlts: [...document.querySelectorAll('.h5p-sc-alternative')].filter((a) => {
        const r = a.getBoundingClientRect();
        const s = getComputedStyle(a);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden';
      }).length,
      dialogs: document.querySelectorAll('.h5p-dialog, .h5p-interaction').length,
    },
    scsStyle: scs ? style(scs) : null,
    // Chỉ in 1500 ký tự HTML để đủ thấy cấu trúc, tránh ngập log.
    html: scs ? String(scs.outerHTML).slice(0, 1500) : null,
    slides,
  };
});

(async () => {
  // Token cache có thể hết hạn -> đăng nhập mới. Không in credentials.
  let token = process.env.LMS_TOKEN || '';
  if (!token) {
    const { username, password } = readCreds();
    log(`đăng nhập user=${mask(username)}`);
    token = await login(username, password);
  }
  const { browser, context, page } = await launch({ headless: true, token });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await sleep(6000);
    await dismissAll(page);
    await sleep(800);
    const frame = await findPlayerFrame(page, 12000);
    if (!frame) {
      log('NO FRAME url=', page.url());
      log('frames=', JSON.stringify(page.frames().map((f) => f.url())));
      log('iframes=', await page.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => f.src)).catch(() => null));
      await page.screenshot({ path: '/tmp/debug-scs-noframe.png' });
      return;
    }
    const splash = await frame.locator('.h5p-splash-play,.h5p-splash-main').first().boundingBox().catch(() => null);
    if (splash) await page.mouse.click(splash.x + 20, splash.y + 20);
    await sleep(1500);

    const st = await frame.evaluate((s) => {
      const v = document.querySelector('video');
      if (!v) return null;
      v.muted = true;
      v.playbackRate = 1;
      v.currentTime = Math.max(0, s - 0.4);
      v.play().catch(() => {});
      return { t: v.currentTime, d: v.duration };
    }, STOP).catch(() => null);
    log('video seek:', JSON.stringify(st));

    // Poll cả nút tương tác lẫn dialog: có bản H5P tự mở dialog khi tới mốc,
    // bản khác chỉ hiện nút màu. Log trạng thái video mỗi giây để thấy kẹt ở đâu.
    const t0 = Date.now();
    let clicked = false;
    let ready = false;
    while (Date.now() - t0 < 14000) {
      const s = await frame.evaluate(() => {
        const vis = (el) => !!(el && (el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length)));
        const v = document.querySelector('video');
        const btn = [...document.querySelectorAll('.h5p-interaction-button')].filter(vis)[0];
        const scs = [...document.querySelectorAll('.h5p-single-choice-set')].filter(vis)[0];
        const iw = [...document.querySelectorAll('.h5p-interaction')].filter(vis);
        return {
          t: v ? +v.currentTime.toFixed(2) : null, paused: v ? v.paused : null, rate: v ? v.playbackRate : null,
          btn: btn ? { cls: String(btn.className), txt: (btn.innerText || '').slice(0, 40) } : null,
          scs: !!scs,
          iw: iw.map((x) => String(x.className).slice(0, 80)),
        };
      }).catch(() => null);
      log('poll:', JSON.stringify(s));
      if (s && s.scs) { ready = true; break; }
      if (s && s.btn && !clicked) {
        const btn = frame.locator('.h5p-interaction-button:visible').first();
        const box = await btn.boundingBox().catch(() => null);
        if (box && box.width) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          clicked = true;
          log('clicked interaction button @', s.t);
        }
      }
      await sleep(1000);
    }
    log('dialog SCS:', ready);
    if (!ready) { await page.screenshot({ path: '/tmp/debug-scs-nodialog.png' }); return; }
    await sleep(500);
    const info = await dump(frame);
    log('COUNTS:', JSON.stringify(info.counts));
    log('SCS STYLE:', JSON.stringify(info.scsStyle));
    info.slides.forEach((s) => {
      log(`SLIDE ${s.i} cls="${s.cls}" st=${JSON.stringify(s.st)} q="${s.question}" alts=${s.alts.length}`);
      s.alts.forEach((a) => log(`   ALT ${a.j} "${a.txt}" cls="${a.cls}" st=${JSON.stringify(a.st)} checked=${a.checked}`));
    });
    log('HTML:', info.html);
    const shot = path.join(os.tmpdir(), 'debug-scs.png');
    await page.screenshot({ path: shot });
    log(`screenshot ${shot}`);

    if (arg('answer', '') === 'true') {
      const snap = () => frame.evaluate(() => {
        const vis = (el) => !!(el && (el.offsetWidth || el.offsetHeight));
        const slides = [...document.querySelectorAll('.h5p-sc-slide')];
        const i = slides.findIndex((s) => s.classList.contains('h5p-sc-current-slide'));
        const el = slides[i];
        const txt = (n) => String((n && (n.innerText || n.textContent)) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        return {
          i, total: slides.length, cls: el ? String(el.className) : '',
          q: el ? txt(el.querySelector('.h5p-sc-question')) : '',
          st: el ? [...el.querySelectorAll('.h5p-sc-alternative')].map((a) => ({
            t: txt(a), c: String(a.className), s: txt(a.querySelector('.h5p-sc-status')),
          })) : [],
          prog: txt(document.querySelector('.h5p-joubelui-progressbar-slide-status-text')),
          result: slides.some((s) => s.classList.contains('h5p-sc-current-slide') && /results/.test(s.className)),
          visAlts: [...document.querySelectorAll('.h5p-sc-alternative')].filter(vis).length,
        };
      }).catch(() => null);
      for (let step = 0; step < 6; step++) {
        const s0 = await snap();
        log(`STEP ${step} BEFORE:`, JSON.stringify(s0));
        if (!s0 || s0.result) break;
        const target = s0.st.findIndex((a) => /h5p-sc-is-correct/.test(a.c));
        if (target < 0) { log('  không thấy alt đúng theo class -> dừng'); break; }
        const alt = frame.locator('.h5p-sc-slide').nth(s0.i).locator('.h5p-sc-alternative').nth(target);
        await alt.click({ timeout: 3000 }).catch((e) => log('  click lỗi:', e.message.slice(0, 80)));
        log(`  clicked slide ${s0.i} alt ${target}`);
        await sleep(2500);
        log(`STEP ${step} AFTER:`, JSON.stringify(await snap()));
      }
      await page.screenshot({ path: path.join(os.tmpdir(), 'debug-scs-answered.png') });
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
})();
