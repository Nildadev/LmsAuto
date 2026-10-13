import { runFlow } from '../../../src/core/flow';

export const dynamic = 'force-dynamic';
export const maxDuration = 3600; // cho phép phiên chạy dài (giây) trên host có hỗ trợ

// ── Nhiều người dùng cùng lúc ───────────────────────────────────────────────
// MỖI request = 1 phiên riêng: runFlow() tự launch() một browser Playwright
// riêng biệt (context độc lập), nên nhiều người dùng chạy song song không đụng
// nhau. Ở đây chỉ chặn trần số phiên đồng thời để không làm sập máy chủ; phần
// dư sẽ xếp hàng chờ (có thông báo vị trí) thay vì bị từ chối ngay.
const MAX_CONCURRENT = Math.max(1, Number(process.env.LMS_MAX_CONCURRENT) || 3);
const MAX_QUEUE = Math.max(1, Number(process.env.LMS_MAX_QUEUE) || 20);

let running = 0;
const waiters = [];

/**
 * Xin 1 slot chạy. resolve(0) nếu chạy ngay, reject nếu hàng đợi đầy hoặc client ngắt.
 * `signal` = request.signal: client ngắt -> GỠ khỏi hàng đợi + reject, tránh để người
 * đã rời đi chiếm slot rồi launch browser vô ích (trước đây waiters không bao giờ bị gỡ).
 */
function acquire(signal) {
  if (signal && signal.aborted) return Promise.reject(new Error('client-aborted'));
  if (running < MAX_CONCURRENT) { running++; return Promise.resolve(0); }
  if (waiters.length >= MAX_QUEUE) return Promise.reject(new Error('Máy chủ đang bận (hàng đợi đầy). Vui lòng thử lại sau ít phút.'));
  return new Promise((resolve, reject) => {
    const w = { resolve, reject, cleanup: null };
    const onAbort = () => {
      const i = waiters.indexOf(w);
      if (i >= 0) waiters.splice(i, 1);
      reject(new Error('client-aborted'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    w.cleanup = () => { if (signal) signal.removeEventListener('abort', onAbort); };
    waiters.push(w);
  });
}

/** Trả slot; nếu có người chờ thì nhường luôn cho người kế tiếp. */
function release() {
  const next = waiters.shift();
  if (next) { if (next.cleanup) next.cleanup(); next.resolve(0); } // nhường slot (running không đổi)
  else running = Math.max(0, running - 1);
}

export async function POST(request) {
  const { username, password, headlessMode, blacklistSubjects, scanClass, doAssigned } = await request.json();
  const signal = request.signal;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch (_) { closed = true; }
      };
      const logger = (message) => send({ message });

      // Client ngắt (đóng tab / điều hướng) -> ngừng gửi + yêu cầu runFlow dừng.
      const onAbort = () => { closed = true; };
      if (signal) { if (signal.aborted) closed = true; else signal.addEventListener('abort', onAbort, { once: true }); }

      let slot = false;
      try {
        // Dùng chung engine mới (src/core/flow.js) với CLI — thay vì lib/automation.js
        // cũ đã lỗi thời. Map params từ web sang runFlow:
        //   headlessMode -> headless (true=ẩn, false=hiện browser)
        //   blacklistSubjects (mảng) -> RegExp tuỳ chỉnh; rỗng -> undefined (dùng mặc định)
        const subjects = Array.isArray(blacklistSubjects) ? blacklistSubjects : [];
        const blacklist = subjects.length
          ? new RegExp(subjects.map((s) => String(s).trim()).filter(Boolean).join('|'), 'i')
          : undefined;

        // Xin slot chạy (nhiều người dùng -> mỗi người 1 browser riêng).
        if (running >= MAX_CONCURRENT) logger(`⏳ Máy chủ đang chạy ${running}/${MAX_CONCURRENT} phiên — bạn vào hàng đợi chờ tới lượt…`);
        await acquire(signal);
        slot = true;
        if (closed) return; // client đã ngắt khi đang chờ -> KHÔNG launch browser vô ích
        logger(`🖥️ Bắt đầu phiên (đang chạy ${running}/${MAX_CONCURRENT} phiên song song)`);

        await runFlow({
          username,
          password,
          headless: headlessMode,
          blacklist,
          scanClass: scanClass !== false, // mặc định quét cả khóa học của lớp
          doAssigned: doAssigned === true, // mặc định TẮT: chỉ làm bài theo khóa học của lớp
          logger,
          // Client ngắt -> runFlow dừng giữa các bài + đóng browser (tránh rò rỉ).
          shouldStop: () => closed,
          // Preview: stream ảnh trình duyệt ~30fps qua CDP screencast (browser headless trên host).
          capturePreview: true,
          onScreenshot: (dataUrl) => {
            // Backpressure: client đọc chậm -> bỏ frame để không phình bộ đệm.
            if (controller.desiredSize !== null && controller.desiredSize < 0) return;
            send({ screenshot: dataUrl });
          },
        });

        send({ done: true });
      } catch (error) {
        if (!closed) send({ error: error && error.message ? error.message : String(error) });
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
        if (slot) release();
        closed = true;
        try { controller.close(); } catch (_) {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
