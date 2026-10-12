import { runFlow } from '../../../src/core/flow';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { username, password, debugMode, headlessMode, autoConfirm, blacklistSubjects, scanClass } = await request.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const logger = (message) => {
        controller.enqueue(encoder.encode(JSON.stringify({ message }) + '\n'));
      };

      try {
        // Dùng chung engine mới (src/core/flow.js) với CLI — thay vì lib/automation.js
        // cũ đã lỗi thời. Map params từ web sang runFlow:
        //   headlessMode -> headless (true=ẩn, false=hiện browser)
        //   blacklistSubjects (mảng) -> RegExp tuỳ chỉnh; rỗng -> undefined (dùng mặc định)
        const subjects = Array.isArray(blacklistSubjects) ? blacklistSubjects : [];
        const blacklist = subjects.length
          ? new RegExp(subjects.map((s) => String(s).trim()).filter(Boolean).join('|'), 'i')
          : undefined;

        await runFlow({
          username,
          password,
          headless: headlessMode,
          blacklist,
          scanClass: scanClass !== false, // mặc định quét cả khóa học của lớp
          logger,
          // debugMode/autoConfirm không áp dụng: runFlow không prompt và scan qua API.
          // Preview: stream ảnh trình duyệt ~30fps qua CDP screencast (browser headless trên host).
          capturePreview: true,
          onScreenshot: (dataUrl) => {
            try {
              // Backpressure: client đọc chậm -> bỏ frame để không phình bộ đệm.
              if (controller.desiredSize !== null && controller.desiredSize < 0) return;
              controller.enqueue(encoder.encode(JSON.stringify({ screenshot: dataUrl }) + '\n'));
            } catch (_) { /* stream đã đóng */ }
          },
        });

        controller.enqueue(encoder.encode(JSON.stringify({ done: true }) + '\n'));
      } catch (error) {
        controller.enqueue(encoder.encode(JSON.stringify({ error: error && error.message ? error.message : String(error) }) + '\n'));
      } finally {
        controller.close();
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
