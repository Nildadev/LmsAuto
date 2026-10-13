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
 *   --complete-files  MODE file tài liệu: quét learn_status toàn khóa,
 *                     đánh dấu hoàn thành phần pptx/pdf/doc... (chỉ gọi API)
 *   --complete-h5p    MODE H5P toàn phần: giải MỌI phần H5P chưa xong (learn_status)
 *                     rồi đánh dấu hoàn thành (markDone mặc định bật)
 *   --do-assigned     Làm THÊM bài trong “việc cần làm” (mặc định: chỉ khóa của lớp)
 *   --retry-rounds=N  Số vòng giải (quét lại learn_status cuối mỗi vòng). Mặc định 2.
 *   --no-retry        Tương đương --retry-rounds=1 (không quét lại)
 */
const { prompt } = require('enquirer');
const { runFlow } = require('../src/core/flow');
const { completeFiles } = require('../src/core/complete');
const { InvalidCredentialsError } = require('../src/core/auth');

const arg = (name) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf('=');
  return eq >= 0 ? hit.slice(eq + 1) : true;
};

/** Đọc cờ số nguyên >= 1; giá trị thiếu/không hợp lệ -> báo lỗi rõ + thoát (exit 2)
 *  thay vì Number() âm thầm ra NaN rồi hành xử khó đoán ở sâu trong engine. */
function numArg(name) {
  const raw = arg(name);
  if (raw === undefined) return undefined;
  if (raw === true) {
    console.error(`❌ Thiếu giá trị cho --${name} (dùng --${name}=N).`);
    process.exit(2);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    console.error(`❌ Giá trị --${name}=${raw === true ? '(thiếu)' : raw} không hợp lệ (cần số nguyên >= 1).`);
    process.exit(2);
  }
  return Math.floor(n);
}

async function main() {
  const dryRun = !!arg('dry-run');
  const headless = !!arg('headless');
  const limit = numArg('limit');
  const useDefaultBlacklist = !arg('all');
  const completeFilesMode = !!arg('complete-files');
  const completeH5pMode = !!arg('complete-h5p');
  const doAssigned = !!arg('do-assigned');
  const retryRounds = arg('no-retry') ? 1 : numArg('retry-rounds');

  console.clear();
  console.log('=================================================');
  console.log('   LMS360 AUTO SOLVER Made With ❤️  By Nildadev');
  console.log('   (login API → scan → solve H5P)');
  if (dryRun) console.log('   🔎 DRY-RUN — chỉ liệt kê, không giải');
  if (completeFilesMode) console.log('   📄 MODE: đánh dấu hoàn thành FILE tài liệu (không mở browser)');
  if (completeH5pMode) console.log('   🧩 MODE: giải TOÀN BỘ phần H5P chưa xong + đánh dấu hoàn thành');
  if (doAssigned) console.log('   📌 Làm THÊM bài trong “việc cần làm” (mặc định chỉ khóa của lớp)');
  if (retryRounds !== undefined) console.log(`   🔁 Số vòng giải: ${retryRounds}${retryRounds === 1 ? ' (không quét lại)' : ' (quét lại learn_status cuối mỗi vòng)'}`);
  console.log('=================================================\n');

  let response;
  try {
    response = await prompt([
      { type: 'input', name: 'username', message: '👤 Tài khoản:' },
      { type: 'password', name: 'password', message: '🔑 Mật khẩu:' },
    ]);
  } catch (err) {
    console.error(`\n⏹️ Đã hủy nhập thông tin đăng nhập${err && err.message ? `: ${err.message}` : '.'}`);
    process.exit(130);
  }

  if (!response.username || !response.password) {
    console.log('❌ Vui lòng nhập đầy đủ tài khoản và mật khẩu.');
    process.exit(1);
  }

  console.log('\n🚀 Bắt đầu quá trình tự động hóa...\n------------------------------------');

  try {
    // ── MODE: hoàn thành file tài liệu (chỉ gọi API, không mở browser) ──
    if (completeFilesMode) {
      const { login } = require('../src/core/auth');
      const token = await login(response.username, response.password, { logger: console.log });
      const rep = await completeFiles(token, { logger: console.log, dryRun });

      console.log('\n================ TỔNG KẾT FILE ================');
      console.log(`📄 File cần đánh dấu: ${rep.files} | ✅ xong: ${rep.marked} | ❌ lỗi: ${rep.failed}`);
      console.log(`🧩 Bỏ qua (H5P, dùng solver): ${rep.skippedH5p} phần`);
      for (const it of rep.items) {
        const mark = it.dryRun ? '·' : it.ok ? '✅' : '⚠️';
        console.log(`  ${mark} ${it.title} (${it.courseTitle})`);
      }
      console.log('==========================================');
      process.exit(rep.failed > 0 ? 1 : 0);
    }

    const report = await runFlow({
      username: response.username,
      password: response.password,
      headless,
      dryRun,
      limit,
      parts: completeH5pMode,
      doAssigned,
      retryRounds,
      blacklist: useDefaultBlacklist ? undefined : null,
      logger: console.log,
    });

    console.log('\n================ TỔNG KẾT ================');
    console.log(`👤 Học sinh: ${report.studentName || '(không rõ)'}`);
    console.log(`📊 ${report.solved}/${report.total} bài xác nhận xong, ${report.failed} lỗi.`);
    if (report.skipped > 0) console.log(`   ⏭️ Bỏ qua ${report.skipped} bài khoá tua (không tính lỗi).`);
    for (const it of report.items) {
      const mark = it.dryRun ? '·' : it.ok ? '✅' : '⚠️';
      console.log(`  ${mark} [${it.subject}] ${it.title} (${it.kind || '?'})`);
    }
    console.log('==========================================');
    // Thoát KHÁC 0 khi còn bài lỗi để CI/script bọc ngoài biết phiên chưa xong
    // (trước đây luôn exit(0) dù report.failed > 0).
    process.exit(report.failed > 0 ? 1 : 0);
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
