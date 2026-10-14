'use strict';
/**
 * preview.js - Moonlight-style adaptive preview controller (khong them dependency).
 *
 * Van de cua ban cu (flow.js inline):
 *   - JPEG base64 +33% dung luong, goi trong JSON NDJSON chung voi log
 *     -> log bi head-of-line blocking sau frame ~100-200KB.
 *   - Gui theo timer co dinh 10fps, khong dedup frame trung (trang H5P dung yen
 *     van encode+gui lien tuc), khong thich ung mang yeu.
 *   - Client gan <img src=dataURL> moi frame -> decode tren main thread + GC
 *     dataURL cu, khong do fps/kbps/dropped.
 *
 * Huong Moonlight (ap dung trong gioi han CDP screencast + fetch NDJSON):
 *   1. Chi gui khi khung hinh DOI (dirty-frame dedup bang hash mau) - nhu
 *      Moonlight chi encode region doi.
 *   2. Latest-only queue + backpressure: client doc cham -> bo frame cu, giu
 *      frame moi nhat (thay vi phinh buffer gay delay tich luy).
 *   3. Adaptive bitrate: 4 muc chat luong, tu len/xuong theo ti le drop
 *      (giong Moonlight auto-bitrate).
 *   4. Metadata moi frame (seq/ts/q/fps/kbps) de client ve OSD Moonlight-style.
 */

const QUALITY_LEVELS = {
  high:     { maxWidth: 1280, maxHeight: 720, quality: 60, everyNthFrame: 1, minMs: 66  },
  balanced: { maxWidth: 960,  maxHeight: 540, quality: 40, everyNthFrame: 2, minMs: 100 },
  low:      { maxWidth: 640,  maxHeight: 360, quality: 30, everyNthFrame: 3, minMs: 150 },
  saver:    { maxWidth: 480,  maxHeight: 270, quality: 25, everyNthFrame: 4, minMs: 250 },
};

const LEVEL_ORDER = ['saver', 'low', 'balanced', 'high'];

/** Hash mau FNV-1a tren ~2KB mau cua chuoi base64 (du phat hien doi frame). */
function sampleHash(s) {
  let h = 0x811c9dc5;
  const n = s.length;
  const step = Math.max(1, Math.floor(n / 2048));
  for (let i = 0; i < n; i += step) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= n & 0xffff;
  h = Math.imul(h, 0x01000193);
  return (h >>> 0).toString(36);
}

class PreviewController {
  constructor(opts = {}) {
    this.getTarget = opts.getTarget || (() => null);
    this.newSession = opts.newSession; // async (page) -> CDP session
    // onFrame({ data, seq, ts, level, fps, kbps }) -> false = dropped
    this.onFrame = opts.onFrame || (() => true);
    this.logger = opts.logger || (() => {});
    this.level = opts.level && QUALITY_LEVELS[opts.level] ? opts.level : 'balanced';
    this.auto = opts.auto !== false && !opts.level;
    this.rebindMs = opts.rebindMs || 700;
    this.healthyWindow = 0;
    this.seq = 0;
    this.sent = 0;
    this.dropped = 0;
    this.dupSkipped = 0;
    this.bytes = 0;
    this.startedAt = Date.now();
    this.lastSent = 0;
    this.lastHash = '';
    this.lastSize = 0;
    this.client = null;
    this.boundPage = null;
    this.timer = null;
    this.stopped = false;
  }

  stats() {
    const dt = Math.max(1, (Date.now() - this.startedAt) / 1000);
    return {
      level: this.level,
      seq: this.seq,
      sent: this.sent,
      dropped: this.dropped,
      dupSkipped: this.dupSkipped,
      fps: +(this.sent / dt).toFixed(1),
      kbps: Math.round((this.bytes * 8) / dt / 1000),
    };
  }

  async setLevel(next) {
    if (!QUALITY_LEVELS[next] || next === this.level) return;
    this.level = next;
    try { this.logger('preview quality -> ' + next); } catch (_) {}
    const pg = this.boundPage;
    await this.bind(pg, true);
  }

  maybeAdapt() {
    if (!this.auto) return;
    const total = this.sent + this.dropped;
    if (total < 20 || total % 20 !== 0) return;
    const dropRate = this.dropped / Math.max(1, total);
    const idx = LEVEL_ORDER.indexOf(this.level);
    if (dropRate > 0.15 && idx > 0) {
      this.healthyWindow = 0;
      this.setLevel(LEVEL_ORDER[idx - 1]).catch(() => {});
    } else if (dropRate < 0.02) {
      this.healthyWindow++;
      if (this.healthyWindow >= 3 && idx < LEVEL_ORDER.length - 1) {
        this.healthyWindow = 0;
        this.setLevel(LEVEL_ORDER[idx + 1]).catch(() => {});
      }
    } else {
      this.healthyWindow = 0;
    }
  }

  async stop() {
    this.stopped = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.client) {
      try { await this.client.send('Page.stopScreencast'); } catch (_) {}
      try { await this.client.detach(); } catch (_) {}
      this.client = null;
    }
    this.boundPage = null;
  }
  async bind(pg, force) {
    if (!force && pg === this.boundPage) return;
    if (this.client) {
      try { await this.client.send('Page.stopScreencast'); } catch (_) {}
      try { await this.client.detach(); } catch (_) {}
      this.client = null;
    }
    this.boundPage = null;
    this.lastHash = '';
    if (!pg || this.stopped) return;
    try {
      const q = QUALITY_LEVELS[this.level];
      const client = await this.newSession(pg);
      const self = this;
      client.on('Page.screencastFrame', async (f) => {
        const now = Date.now();
        try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (_) {}
        if (self.stopped) return;
        if (now - self.lastSent < q.minMs) return;
        const data = f.data || '';
        if (!data) return;
        const h = sampleHash(data);
        if (h === self.lastHash && Math.abs(data.length - self.lastSize) < 512) {
          self.dupSkipped++;
          return;
        }
        self.lastHash = h;
        self.lastSize = data.length;
        self.lastSent = now;
        self.seq++;
        self.sent++;
        self.bytes += Math.floor(data.length * 0.75);
        const st = self.stats();
        let accepted = true;
        try {
          accepted = self.onFrame({
            data, seq: self.seq, ts: now, level: self.level,
            width: q.maxWidth, height: q.maxHeight,
            fps: st.fps, kbps: st.kbps,
          });
        } catch (_) { accepted = false; }
        if (accepted === false) self.dropped++;
        self.maybeAdapt();
      });
      await client.send('Page.startScreencast', {
        format: 'jpeg', quality: q.quality,
        maxWidth: q.maxWidth, maxHeight: q.maxHeight,
        everyNthFrame: q.everyNthFrame,
      });
      this.client = client;
      this.boundPage = pg;
    } catch (_) { this.client = null; this.boundPage = null; }
  }

  async start(initialPage) {
    await this.bind(initialPage);
    if (this.timer) clearInterval(this.timer);
    const self = this;
    this.timer = setInterval(() => {
      let target = null;
      try { target = self.getTarget(); } catch (_) { target = null; }
      if (target !== self.boundPage) self.bind(target).catch(() => {});
    }, this.rebindMs);
  }
}

module.exports = { PreviewController, QUALITY_LEVELS, LEVEL_ORDER, sampleHash };
