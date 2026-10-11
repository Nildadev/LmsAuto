'use strict';
/**
 * cli.js — Điểm vào `npm run auto`.
 * Hỏi tài khoản/mật khẩu, tùy chọn, rồi chạy flow login → scan → solve.
 *
 * Cờ dòng lệnh:
 *   --debug      hiện log chi tiết (giữ để tương thích)
 *   --dry-run    chỉ liệt kê bài, không giải
 *   --limit=N    giới hạn số bài
 *   --headless   chạy ẩn (mặc định: hiện browser để dễ theo dõi)
 *   --all        không dùng blacklist mặc định
 */
const { prompt } = require('enquirer');
const { runFlow } = require('../src/core/flow');
const { InvalidCredentialsError } = require('../src/core/auth');

const arg = (name) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf('=');
  return eq >= 0 ? hit.slice(eq + 1) : true;
};

async function main() {
  const dryRun = !!arg('dry-run');
  const headless = !!arg('headless');
  const limit = arg('limit') ? Number(arg('limit')) : undefined;
  const useDefaultBlacklist = !arg('all');

  console.clear();
  console.log('=================================================');
  console.log('   LMS360 AUTO SOLVER Made With ❤️  By Nildadev');
  console.log('   (login API → scan → solve H5P)');
  if (dryRun) console.log('   🔎 DRY-RUN — chỉ liệt kê, không giải');
  console.log('=================================================\n');

  const response = await prompt([
    { type: 'input', name: 'username', message: '👤 Tài khoản:' },
    { type: 'password', name: 'password', message: '🔑 Mật khẩu:' },
  ]);

  if (!response.username || !response.password) {
    console.log('❌ Vui lòng nhập đầy đủ tài khoản và mật khẩu.');
    process.exit(1);
  }

  console.log('\n🚀 Bắt đầu quá trình tự động hóa...\n------------------------------------');

  try {
    const report = await runFlow({
      username: response.username,
      password: response.password,
      headless,
      dryRun,
      limit,
      blacklist: useDefaultBlacklist ? undefined : null,
      logger: console.log,
    });

    console.log('\n================ TỔNG KẾT ================');
    console.log(`👤 Học sinh: ${report.studentName || '(không rõ)'}`);
    console.log(`📊 ${report.solved}/${report.total} bài xác nhận xong, ${report.failed} lỗi.`);
    for (const it of report.items) {
      const mark = it.dryRun ? '·' : it.ok ? '✅' : '⚠️';
      console.log(`  ${mark} [${it.subject}] ${it.title} (${it.kind || '?'})`);
    }
    console.log('==========================================');
    process.exit(0);
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      console.log('\n❌ Tên đăng nhập hoặc mật khẩu không hợp lệ. Vui lòng thử lại!');
      process.exit(2);
    }
    console.error('\n❌ LỖI TRONG QUÁ TRÌNH CHẠY:');
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  }
}

main();
