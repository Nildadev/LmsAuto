import { solveLMS } from '../../../lib/automation';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { username, password, debugMode, headlessMode, autoConfirm, blacklistSubjects } = await request.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const logger = (message) => {
        controller.enqueue(encoder.encode(JSON.stringify({ message }) + '\n'));
      };

      try {
        await solveLMS(username, password, null, logger, autoConfirm, debugMode, headlessMode, blacklistSubjects);
        controller.enqueue(encoder.encode(JSON.stringify({ done: true }) + '\n'));
      } catch (error) {
        controller.enqueue(encoder.encode(JSON.stringify({ error: error.message }) + '\n'));
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
