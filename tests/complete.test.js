'use strict';
/**
 * Test offline cho complete.js — KHÔNG gọi mạng. Dùng fetch giả có "router":
 *   GET  /h5p/courses/class        -> danh sách khóa (kiểm tra phân trang)
 *   GET  /h5p/contents/learn_status -> views theo khóa
 *   POST /h5p/contents/detail       -> detail theo id (type 0=H5P, 1=file)
 *   POST /h5p/view_h5p_content      -> tăng view
 *   POST /h5p/contents/learn_status -> mark hoàn thành (status=3)
 * Chạy: node tests/complete.test.js
 */
const assert = require('assert');
const {
  listAllClassCourses, fetchLearnStatus, classify, scanIncomplete, completeFiles,
} = require('../src/core/complete');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

/** Tạo fetch giả theo kịch bản. Ghi lại các call vào `calls`. */
function makeFetch(scene) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
    const json = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });
    if (method === 'GET' && /\/h5p\/courses\/class/.test(u)) {
      const pg = Number((u.match(/page_id=(\d+)/) || [])[1] || 1);
      return json({ data: { h5p_courses: (scene.courses[pg - 1] || []) } });
    }
    if (method === 'GET' && /learn_status/.test(u)) {
      const cs = (u.match(/h5p_course_id=([^&]+)/) || [])[1];
      return json({ data: { h5p_content_views: (scene.views[cs] || []) } });
    }
    if (method === 'POST' && /contents\/detail$/.test(u)) {
      const id = JSON.parse(opts.body).h5p_content_id;
      return json({ data: { h5p_content: scene.details[id] || null } });
    }
    if (method === 'POST' && /view_h5p_content$/.test(u)) return json({ data: { detail: {} } });
    if (method === 'POST' && /learn_status$/.test(u)) return json({ data: { status: 'success' } });
    return { ok: false, status: 404, text: async () => 'not found' };
  };
  return { fetchImpl, calls };
}

(async () => {
  console.log('complete.js');

  await check('classify: type=1 -> file, type=0 -> H5P', () => {
    assert.strictEqual(classify({ type: 1 }, 'x'), true);
    assert.strictEqual(classify({ type: 0 }, 'x'), false);
  });

  await check('classify: detail null -> fallback đuôi uri/title', () => {
    assert.strictEqual(classify(null, 'bai.docx'), true);
    assert.strictEqual(classify({ uri: 'a/b.pdf' }, ''), true);
    assert.strictEqual(classify({ uri: 'a/b.mp4' }, ''), true);
    assert.strictEqual(classify(null, 'Bài tập trắc nghiệm'), false);
    assert.strictEqual(classify(null, ''), false, 'không chắc chắn -> false (an toàn)');
  });

  await check('listAllClassCourses: phân trang, dừng khi trang < perPage', async () => {
    const scene = { courses: [[{ id: 'c1', title: 'A' }, { id: 'c2', title: 'B' }], [{ id: 'c3', title: 'C' }]] };
    const { fetchImpl, calls } = makeFetch(scene);
    const list = await listAllClassCourses('T', { fetchImpl, perPage: 2 });
    assert.strictEqual(list.length, 3);
    assert.strictEqual(calls.filter((c) => /courses\/class/.test(c.url)).length, 2, 'đủ 2 trang');
  });

  await check('fetchLearnStatus: parse views, lỗi -> []', async () => {
    const scene = { views: { CS1: [{ h5p_content_id: 'p1', status: 3 }] } };
    const { fetchImpl } = makeFetch(scene);
    const v = await fetchLearnStatus('T', 'CS1', { fetchImpl });
    assert.strictEqual(v.length, 1);
    const bad = { fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'err' }) };
    assert.deepStrictEqual(await fetchLearnStatus('T', 'CS1', { fetchImpl: bad }), []);
  });

  await check('scanIncomplete: bỏ status=3, phân loại file vs H5P', async () => {
    const scene = {
      courses: [[{ id: 'CS1', title: 'K1' }]],
      views: { CS1: [
        { h5p_content_id: 'pFile', status: 0 },
        { h5p_content_id: 'pH5p', status: 2 },
        { h5p_content_id: 'pDone', status: 3 },
      ] },
      details: { pFile: { type: 1, title: 'Tài liệu.pptx' }, pH5p: { type: 0, title: 'Trắc nghiệm' } },
    };
    const { fetchImpl } = makeFetch(scene);
    const r = await scanIncomplete('T', { fetchImpl });
    assert.strictEqual(r.parts.length, 2, 'chỉ phần CHƯA xong');
    assert.ok(r.parts.every((x) => x.status !== 3));
    const f = r.parts.find((x) => x.p === 'pFile');
    const h = r.parts.find((x) => x.p === 'pH5p');
    assert.strictEqual(f.isFile, true);
    assert.strictEqual(f.cs, 'CS1');
    assert.strictEqual(h.isFile, false);
    assert.strictEqual(r.doneParts, 1);
  });

  await check('completeFiles: dryRun chỉ liệt kê, KHÔNG mark', async () => {
    const scene = {
      courses: [[{ id: 'CS1', title: 'K1' }]],
      views: { CS1: [{ h5p_content_id: 'pFile', status: 0 }] },
      details: { pFile: { type: 1, title: 'Tài liệu.pdf' } },
    };
    const { fetchImpl, calls } = makeFetch(scene);
    const r = await completeFiles('T', { fetchImpl, dryRun: true, sleep: async () => {} });
    assert.strictEqual(r.dryRun, true);
    assert.strictEqual(r.files, 1);
    assert.strictEqual(r.marked, 0);
    assert.strictEqual(calls.filter((c) => c.method === 'POST' && /learn_status$/.test(c.url)).length, 0, 'không POST mark');
  });

  await check('completeFiles: file -> view + mark(status=3); H5P bị bỏ qua', async () => {
    const scene = {
      courses: [[{ id: 'CS1', title: 'K1' }]],
      views: { CS1: [
        { h5p_content_id: 'pFile', status: 0 },
        { h5p_content_id: 'pH5p', status: 2 },
      ] },
      details: { pFile: { type: 1, title: 'Tài liệu.pptx' }, pH5p: { type: 0, title: 'Trắc nghiệm' } },
    };
    const { fetchImpl, calls } = makeFetch(scene);
    const r = await completeFiles('T', { fetchImpl, sleep: async () => {}, delayMs: 0 });
    assert.strictEqual(r.files, 1);
    assert.strictEqual(r.marked, 1);
    assert.strictEqual(r.failed, 0);
    assert.strictEqual(r.skippedH5p, 1, 'H5P bị bỏ qua cho solver');
    const views = calls.filter((c) => c.method === 'POST' && /view_h5p_content$/.test(c.url));
    const marks = calls.filter((c) => c.method === 'POST' && /learn_status$/.test(c.url));
    assert.strictEqual(views.length, 1, 'view đúng 1 file');
    assert.strictEqual(marks.length, 1, 'mark đúng 1 file (H5P không bị đụng)');
    assert.deepStrictEqual(marks[0].body, { h5p_content_id: 'pFile', status: 3, h5p_course_id: 'CS1' });
    assert.strictEqual(r.items[0].ok, true);
  });

  await check('completeFiles: view=false -> bỏ bước view, chỉ mark', async () => {
    const scene = {
      courses: [[{ id: 'CS1', title: 'K1' }]],
      views: { CS1: [{ h5p_content_id: 'pFile', status: 0 }] },
      details: { pFile: { type: 1, title: 'a.docx' } },
    };
    const { fetchImpl, calls } = makeFetch(scene);
    await completeFiles('T', { fetchImpl, sleep: async () => {}, view: false });
    assert.strictEqual(calls.filter((c) => /view_h5p_content$/.test(c.url)).length, 0);
    assert.strictEqual(calls.filter((c) => c.method === 'POST' && /learn_status$/.test(c.url)).length, 1);
  });

  await check('completeFiles: only (RegExp) lọc theo title/khóa', async () => {
    const scene = {
      courses: [[{ id: 'CS1', title: 'TIN 9' }]],
      views: { CS1: [
        { h5p_content_id: 'p1', status: 0 },
        { h5p_content_id: 'p2', status: 0 },
      ] },
      details: { p1: { type: 1, title: 'Hóa học.pdf' }, p2: { type: 1, title: 'Toán.docx' } },
    };
    const { fetchImpl } = makeFetch(scene);
    const r = await completeFiles('T', { fetchImpl, sleep: async () => {}, only: /Toán/ });
    assert.strictEqual(r.files, 1);
    assert.strictEqual(r.marked, 1);
    assert.strictEqual(r.items[0].p, 'p2');
  });

  await check('completeFiles: mark lỗi HTTP -> failed++, không throw', async () => {
    const scene = {
      courses: [[{ id: 'CS1', title: 'K1' }]],
      views: { CS1: [{ h5p_content_id: 'pFile', status: 0 }] },
      details: { pFile: { type: 1, title: 'a.pptx' } },
    };
    const { fetchImpl } = makeFetch(scene);
    const failing = async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'POST' && /learn_status$/.test(String(url))) {
        return { ok: false, status: 500, text: async () => 'boom' };
      }
      return fetchImpl(url, opts);
    };
    const r = await completeFiles('T', { fetchImpl: failing, sleep: async () => {} });
    assert.strictEqual(r.marked, 0);
    assert.strictEqual(r.failed, 1);
    assert.strictEqual(r.items[0].ok, false);
  });

  console.log(`\n${failed === 0 ? '✅' : '❌'} complete: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
