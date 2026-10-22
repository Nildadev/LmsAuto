'use strict';
/**
 * debug-live.js — Debug end-to-end với tài khoản thật, KHÔNG tương tác bàn phím.
 *
 * Tài khoản/Mật khẩu được đọc từ file (mặc định usersecret.txt, 2 dòng:
 * username / password) hoặc biến môi trường LMS_USERNAME/LMS_PASSWORD.
 * Script không bao giờ in nội dung credentials ra log.
 *
 * Giai đoạn:
 *   stage=scan   login API + quét danh sách (CHỈ ĐỌC, không mở browser)
 *   stage=solve  chạy runFlow giải thật (mặc định 1 bài, giới hạn bằng --limit)
 *   stage=files  completeFiles (đánh dấu file tài liệu qua API)
 *
 * Cách dùng:
 *   node scripts/debug-live.js                       # scan
 *   node scripts/debug-live.js solve --limit=1
 *   node scripts/debug-live.js files
 */
const path = require('path');
const { runFlow } = require('../src/core/flow');
const { login, InvalidCredentialsError } = require('../src/core/auth');
const { scanAll, DEFAULT_BLACKLIST } = require('../src/core/scan');
const { scanIncomplete, completeFiles } = require('../src/core/complete');
const { readCreds, mask } = require('./_creds');

function arg(name) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf('=');
  return eq >= 0 ? hit.slice(eq + 1) : true;
}

async function main() {
  const stage = (process.argv[2] || 'scan').toLowerCase();
  const limit = Number(arg('limit')) || 0;
  const headless = arg('headless') !== 'false';
  const { username, password, from } = readCreds({ secretFile: typeof arg('secret') === 'string' ? arg('secret') : undefined });
  console.log(`🔐 Nguồn credentials: ${from} (user=${mask(username)})`);

  if (stage === 'scan') {
    const t0 = Date.now();
    const token = await login(username, password, { logger: console.log });
    console.log(`\n── scanAll (bài được giao) ──`);
    const r = await scanAll(token, { logger: console.log, blacklist: DEFAULT_BLACKLIST, skipEssay: true });
    console.log(`   todo=${r.todo.length}/${r.items.length}`);
    r.todo.slice(0, 10).forEach((it, i) => console.log(`   ${i + 1}. [${it.subject}] ${it.title} (${it.status})`));

    console.log(`\n── scanIncomplete (khóa học của lớp) ──`);
    const c = await scanIncomplete(token, { logger: console.log });
    const files = c.parts.filter((x) => x.isFile && !x.denied);
    const h5p = c.parts.filter((x) => !x.isFile && !x.denied);
    const denied = c.parts.filter((x) => x.denied);
    console.log(`   courses=${c.courses} parts=${c.parts.length} doneSẵn=${c.doneParts} | h5p=${h5p.length} file=${files.length} private=${denied.length}`);
    h5p.slice(0, 10).forEach((x, i) => console.log(`   ${i + 1}. [${x.courseTitle}] ${x.title} (status=${x.status})`));
    console.log(`\n⏱️  ${Date.now() - t0}ms — stage scan OK (không mở browser)`);
    return;
  }

  if (stage === 'census') {
    // CHỈ ĐỌC: mở từng bài để đọc window.H5PIntegration rồi đóng tab.
    // KHÔNG click đáp án, KHÔNG bấm "Kiểm tra", KHÔNG gọi API ghi tiến độ.
    const { launch } = require('../src/core/stealth');
    const { openItem, deps } = require('../src/core/flow');
    const { videoUrl } = require('../src/core/scan');
    const { probeIntegration, summarizeCensus, writeCensusFile } = require('../src/core/census');
    const t0 = Date.now();
    const { browser, page, token } = await launch({ username, password, headless, logger: console.log });
    const records = [];
    try {
      const c = await scanIncomplete(token, { logger: console.log });
      const rows = c.parts.filter((x) => !x.denied)
        .filter((x) => !DEFAULT_BLACKLIST.test(`${x.courseTitle || ''} ${x.title || ''}`));
      const list = limit > 0 ? rows.slice(0, limit) : rows;
      console.log(`\n🧮 Census ${list.length}/${rows.length} phần chưa hoàn thành (chỉ đọc, không giải)\n`);
      const waitMs = Number(arg('wait')) || 2500;

      for (let i = 0; i < list.length; i++) {
        const x = list[i];
        const title = x.title || x.courseTitle || `(p=${x.p})`;
        const label = `${i + 1}/${list.length} [${x.courseTitle || '-'}] ${title}`;
        if (x.isFile) {
          console.log(`📄 ${label} -> file tài liệu (không cần browser)`);
          records.push({ title, courseTitle: x.courseTitle, status: x.status, isFile: true, kind: 'doc', questionCount: 0, libs: {}, flags: {}, ms: 0 });
          continue;
        }
        const url = videoUrl({ p: x.p, c: '', cs: x.cs });
        const t1 = Date.now();
        let probe = null;
        let err = null;
        let rawJson = null;
        const { tab, frame } = await openItem(page, url, (m) => console.log(`   ${m}`), { waitMs });
        try {
          if (!frame) {
            err = 'no-frame';
          } else {
            const integ = await frame.evaluate(() => (
              window.H5PIntegration && window.H5PIntegration.contents
                ? { contents: window.H5PIntegration.contents } : null
            )).catch(() => null);
            if (!integ) err = 'no-integration';
            probe = probeIntegration(integ || {});
            if (arg('raw') === true) rawJson = integ ? integ.contents : null;
          }
        } finally {
          try { await tab.close(); } catch (_) {}
        }
        const ms = Date.now() - t1;
        const p = probe || { kind: 'unknown', contents: [], libs: {}, questionCount: 0, flags: {}, passPercentage: null };
        const f = p.flags || {};
        const tags = [
          f.imageOnlyCorrect ? 'ẢNH' : '', f.youtubeVideo ? 'YOUTUBE' : '',
          (f.unsupported || []).length ? 'THIẾU:' + f.unsupported.join('/') : '',
          f.randomQuestions ? 'randomQ' : '', f.randomAnswers ? 'randomA' : '',
        ].filter(Boolean).join(' ');
        console.log(`🔍 ${label} -> ${p.kind} q=${p.questionCount} ${ms}ms${err ? ` (${err})` : ''}${tags ? ` [${tags}]` : ''}`);
        records.push({
          title, courseTitle: x.courseTitle, status: x.status, url, kind: p.kind,
          questionCount: p.questionCount, libs: p.libs, flags: f,
          passPercentage: p.passPercentage, contents: p.contents.length, ms, error: err,
          ...(rawJson ? { raw: rawJson } : {}),
        });
      }
    } finally {
      try { await browser.close(); } catch (_) {}
    }

    const s = summarizeCensus(records);
    console.log('\n================ MA TRẬN COVERAGE ================');
    console.log(`📊 ${s.total} bài | ${s.questions} câu hỏi | kind: ${JSON.stringify(s.byKind)}`);
    const top = Object.entries(s.libs).sort((a, b) => b[1] - a[1]);
    console.log('📚 Library (số lần xuất hiện):');
    top.forEach(([k, v]) => console.log(`   ${String(v).padStart(3)}× ${k}`));
    console.log(`\n🖼️  Đáp án ẢNH — đã hỗ trợ khớp theo src (${s.imageAnswers.length}): ${s.imageAnswers.join(' | ') || '—'}`);
    console.log(`⛔ Bị chặn — video YouTube (${s.blocked.youtube.length}): ${s.blocked.youtube.join(' | ') || '—'}`);
    console.log(`⛔ Bị chặn — không đọc được H5P (${s.blocked.unreadable.length}): ${s.blocked.unreadable.map((b) => `${b.title} (${b.error})`).join(' | ') || '—'}`);
    console.log(`⛔ Bị chặn — library chưa hỗ trợ (${s.blocked.unsupported.length}):`);
    s.blocked.unsupported.forEach((b) => console.log(`   · ${b.title} -> ${b.libs.join(', ')}`));
    console.log(`\n✅ Giải được ngay (${s.solvable.length}): ${s.solvable.join(' | ') || '—'}`);
    console.log(`⏱️  mở 1 bài: min=${s.timing.minMs}ms median=${s.timing.medianMs}ms max=${s.timing.maxMs}ms tổng=${s.timing.totalMs}ms`);
    console.log(`⏱️  cả stage census: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    const out = writeCensusFile(path.join(__dirname, '..', 'docs'), {
      generatedAt: new Date().toISOString(), account: mask(username), summary: s, records,
    });
    console.log(`💾 Đã ghi: ${out}`);
    console.log('=================================================');
    return;
  }

  if (stage === 'files') {
    const token = await login(username, password, { logger: console.log });
    const rep = await completeFiles(token, { logger: console.log, dryRun: arg('dry-run') === true });
    console.log(`\n📄 files=${rep.files} marked=${rep.marked} failed=${rep.failed} skippedH5p=${rep.skippedH5p}`);
    process.exit(rep.failed > 0 ? 1 : 0);
    return;
  }

  // ── stage=solve ──
  const n = limit > 0 ? limit : 1;
  console.log(`\n🧪 solve thật ${n} bài (headless=${headless}) — có ghi nhận hoàn thành trên LMS\n`);
  const t0 = Date.now();
  const report = await runFlow({
    username, password, headless, limit: n, logger: console.log,
    dryRun: arg('dry-run') === true,
    doAssigned: arg('do-assigned') === true,
    only: typeof arg('only') === 'string' ? arg('only') : undefined,
    parts: arg('parts') === true,
    retryRounds: 1,
  });
  console.log('\n================ KẾT QUẢ DEBUG ================');
  console.log(`👤 ${report.studentName || '(không rõ)'} | ${report.solved}/${report.total} xong, ${report.failed} lỗi, ${report.skipped} bỏ qua`);
  for (const it of report.items) {
    console.log(`  ${it.dryRun ? '·' : it.ok ? '✅' : '⚠️'} [${it.subject || '-'}] ${it.title} (${it.kind || '?'})${it.error ? ' :: ' + it.error : ''}`);
  }
  console.log(`⏱️  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('=============================================');
  process.exit(report.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  if (err instanceof InvalidCredentialsError) {
    console.error('❌ Đăng nhập thất bại (sai tài khoản/mật khẩu).');
    process.exit(2);
  }
  console.error('❌ Lỗi:', err && err.message ? err.message : err);
  console.error(err && err.stack ? err.stack.split('\n').slice(1, 5).join('\n') : '');
  process.exit(1);
});
