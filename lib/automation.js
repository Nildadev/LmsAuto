const { chromium } = require('playwright');

async function solveLMS(username, password, onConfirm, logger = console.log, autoConfirm = false, debugMode = false, headlessMode = false, blacklistSubjects = []) {
    const browser = await chromium.launch({ headless: headlessMode });
    const context = await browser.newContext();
    const page = await context.newPage();

    logger('🚀 Bắt đầu tự động hóa...');

    try {
        logger('🌐 Điều hướng đến lms360.vn...');
        await page.goto('https:lms360.vn/', { waitUntil: 'networkidle' });
        const loginLink = page.locator('a[href="/dang-nhap"]').first();
        if (await loginLink.isVisible()) {
            await loginLink.click();
            await page.waitForLoadState('networkidle');
        } else {
            await page.goto('https:lms360.vn/dang-nhap', { waitUntil: 'networkidle' }).catch(() => { });
        }

        logger('🎓 Chọn vai trò: Học sinh...');
        const studentRadio = page.locator('input#student');
        if (await studentRadio.isVisible()) {
            await studentRadio.click({ force: true });
            const ssoLoginBtn = page.locator('button:has-text("Đăng nhập"), .btn-login').first();
            if (await ssoLoginBtn.isVisible()) await ssoLoginBtn.click();
        }

        logger('🌐 Chờ chuyển hướng HCM SSO...');
        await page.waitForURL(/api\.hcm\.edu\.vn/, { timeout: 30000 });

        logger('🔑 Nhập thông tin đăng nhập SSO...');
        await page.waitForSelector('input#UserName', { timeout: 10000 });
        await page.fill('input#UserName', username);
        await page.fill('input#Password', password);

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            page.click('button.login100-form-btn')
        ]);

        const errorLabel = page.locator('#AuthenResult');
        if (await errorLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
            await browser.close();
            throw new Error('INVALID_CREDENTIALS');
        }

        if (!page.url().includes('lms360.vn')) {
            await page.waitForURL(/lms360\.vn/, { timeout: 60000 });
        }
        await page.waitForLoadState('networkidle');
        logger('✅ Đăng nhập thành công!');

        logger('📚 Điều hướng đến danh sách khóa học...');
        await page.goto('https:lms360.vn/danh-sach-khoa-hoc-lop?per_page=100', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(666);

        const dismissFaceId = async () => {
            const btn = page.getByRole('button', { name: 'Để sau' });
            if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
                logger('🛡️ Đóng cửa sổ nhận diện khuôn mặt...');
                await btn.click();
                await page.waitForTimeout(266);
            }
        };
        await dismissFaceId();

        const scrollDown = async (times = 12) => {
            for (let s = 0; s < times; s++) {
                await page.mouse.wheel(0, 800).catch(() => { });
                await page.waitForTimeout(66);
            }
            await page.waitForTimeout(200);
        };

        const blacklist = blacklistSubjects.length > 0 
            ? new RegExp(blacklistSubjects.join('|'), 'i')
            : / võ nhạc|thể dục|xuất phát|nhịp điệu|âm nhạc|bốn mùa hòa ca|đá cầu|quan họ|giai điệu/i;

        const collectCourseTitles = async () => {
            return page.evaluate(() => {
                const results = [];
                const docs = [document, ...Array.from(document.querySelectorAll('iframe')).map(f => {
                    try { return f.contentDocument; } catch (e) { return null; }
                }).filter(Boolean)];

                for (const doc of docs) {
                    doc.querySelectorAll('.sc-ObiBn, .course-card, div[class*="course"], div:has(> .MuiLinearProgress-root)').forEach(el => {
                        const titleEl = el.querySelector('.title-text, [title], h2, h3, h4');
                        let title = (titleEl?.getAttribute('title') || titleEl?.innerText || el.innerText || '').trim().split('\n')[0];
                        if (!title && el.hasAttribute('title')) title = el.getAttribute('title');
                        if (title && title.length > 2 && !/Tiến độ:|Hoàn thành|Đã học/i.test(title)) {
                            results.push(title);
                        }
                    });
                }
                return results;
            });
        };

        const seen = new Set();
        const allCourseTitles = [];

        let totalSkipped = 0;
        const applyFilterAndCollect = async (filterName) => {
            logger(`🔍 Lọc theo: "${filterName}"...`);
            const filterLoc = page.getByText(filterName, { exact: true }).first();

            if (!await filterLoc.isVisible({ timeout: 5000 }).catch(() => false)) {
                logger(`⚠️ Không thấy text "${filterName}" trên màn hình.`);
            } else {
                try {
                    const filterBtn = filterLoc.locator('..');
                    await filterBtn.click({ timeout: 5000 });
                    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
                    await page.waitForTimeout(666);
                } catch (e) {
                    logger(`⚠️ Lỗi click filter "${filterName}": ${e.message}`);
                }
            }

            await scrollDown(15);
            const titles = await collectCourseTitles();
            let filterSkipped = 0;
            let filterAdded = 0;

            titles.forEach(t => {
                const isBlacklisted = blacklist.test(t);
                if (isBlacklisted) {
                    filterSkipped++;
                    totalSkipped++;
                } else if (!seen.has(t)) {
                    seen.add(t);
                    allCourseTitles.push(t);
                    filterAdded++;
                }
            });
            logger(`  → Quét thấy ${titles.length} bài. Nhận: ${filterAdded}, Bỏ qua (TD/AN): ${filterSkipped}`);
        };

        if (debugMode) {
            logger('🐛 [DEBUG] Bỏ qua bộ lọc, scroll và quét tất cả...');
            await scrollDown(20);
            (await collectCourseTitles()).forEach(t => {
                if (!seen.has(t)) { seen.add(t); allCourseTitles.push(t); }
            });
        } else {
            await applyFilterAndCollect('Đang học');
            await applyFilterAndCollect('Chưa học');
        }

        const uniqueTitles = allCourseTitles;

        logger(`\n📊 BÁO CÁO QUÉT KHÓA HỌC:`);
        logger(`- Tổng số bài quét thấy: ${allCourseTitles.length + totalSkipped}`);
        logger(`- Số bài sẽ học: ${allCourseTitles.length}`);
        logger(`- Số bài bỏ qua (Thể dục/Âm nhạc): ${totalSkipped}`);

        if (allCourseTitles.length > 0) {
            logger(`\n📋 DANH SÁCH BÀI HỌC:`);
            allCourseTitles.forEach((t, i) => logger(`  ${i + 1}. ${t}`));
        }

        if (allCourseTitles.length === 0) {
            logger('✨ Không có khóa học nào cần xử lý (hoặc tất cả đã bị lọc bỏ).');
            return;
        }

        if (autoConfirm) {
            logger(`\n🚀 Chạy tự động ${allCourseTitles.length} khóa học...`);
        } else if (onConfirm) {
            const proceed = await onConfirm(`❓ Bắt đầu học ${allCourseTitles.length} khóa học? (y/n): `);
            if (!proceed || proceed.toLowerCase() !== 'y') {
                logger('🛑 Đã hủy.');
                return;
            }
        }

        const titleOccurrences = {};

        logger('\n🚀 Bắt đầu xử lý từng khóa học...');

        const courseList = allCourseTitles;
        for (let ci = 0; ci < courseList.length; ci++) {
            const title = courseList[ci];
            logger(`\n📖 [${ci + 1}/${courseList.length}] ${title}`);

            titleOccurrences[title] = (titleOccurrences[title] || 0) + 1;
            const occurrenceIndex = titleOccurrences[title] - 1;

            try {
                await page.goto('https:lms360.vn/danh-sach-khoa-hoc-lop?per_page=100', { waitUntil: 'domcontentloaded', timeout: 25000 });
                await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
            } catch {
                logger('⚠️ Timeout khi mở danh sách, thử lại...');
                await page.goto('https:lms360.vn/danh-sach-khoa-hoc-lop?per_page=100', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => { });
                await page.waitForTimeout(666);
            }

            await dismissFaceId();

            const tryFindCourse = async () => {
                try {
                    const searchInput = page.locator('input[placeholder="Tìm kiếm..."]').first();
                    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
                        logger(`🔍 Tìm kiếm khóa học: ${title}`);
                        await searchInput.clear();
                        await searchInput.fill(title);
                        await page.waitForTimeout(500);
                    } else {
                        await scrollDown(5);
                    }
                } catch (e) {
                    await scrollDown(5);
                }

                const card = page.locator('.sc-ObiBn, .course-card, div[class*="course"]').filter({ hasText: title }).nth(occurrenceIndex);
                if (await card.isVisible({ timeout: 3000 }).catch(() => false)) return card;
                return null;
            };

            let courseCard = await tryFindCourse();

            if (!courseCard) {
                logger('⚠️ Không thấy qua Search, thử bộ lọc truyền thống...');
                const chuaHoc = page.getByText('Chưa học', { exact: true }).first();
                if (await chuaHoc.isVisible().catch(() => false)) {
                    await chuaHoc.locator('..').click({ force: true }).catch(() => { });
                    await page.waitForTimeout(500);
                    await scrollDown(10);
                    courseCard = page.locator('.sc-ObiBn, .course-card, div[class*="course"]').filter({ hasText: title }).nth(occurrenceIndex);
                    if (!await courseCard.isVisible().catch(() => false)) courseCard = null;
                }
            }

            if (courseCard) {
                logger(`🖱️ Click vào khóa học: ${title}`);
                await courseCard.click({ force: true });
                await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
                await page.waitForTimeout(666);
            } else {
                logger(`⚠️ Không tìm thấy thẻ khóa học trên màn hình cho: ${title}`);
                continue;
            }

            const studyTab = page.locator('[role="tab"]').filter({ hasText: /CHỦ ĐỀ HỌC TẬP/i }).first();
            if (await studyTab.isVisible({ timeout: 5000 }).catch(() => false)) {
                logger('📂 Mở tab "CHỦ ĐỀ HỌC TẬP"...');
                await studyTab.click();
                await page.waitForTimeout(666);
            }

            const courseUrl = page.url();

            logger('📥 Scroll để tải đủ nội dung...');
            await scrollDown(10);

            logger('🔄 Mở rộng tất cả các phần bài học bị thu gọn...');
            const expandButtons = await page.locator('button[aria-label="Mở rộng"], svg[data-testid="ExpandMoreIcon"]').all();
            for (const btn of expandButtons) {
                if (await btn.isVisible().catch(() => false)) {
                    await btn.click().catch(() => { });
                    await page.waitForTimeout(100);
                }
            }

            const itemSelector = '.MuiGrid2-container, div[class*="MuiGrid2-container"], div[class*="MuiStack-root"], .MuiPaper-root';

            let playItems = [];
            const candidateItems = await page.locator(itemSelector).all();

            for (const item of candidateItems) {
                const text = await item.innerText().catch(() => '');
                const hasStatus = /Đang mở|Hoàn thành|Chưa xem|Chưa học/.test(text);
                const hasDate = /\d{2}\/\d{2}\/\d{4}/.test(text);

                if (hasStatus && hasDate) {
                    playItems.push(item);
                }
            }

            const uniquePlayItems = [];
            for (let i = 0; i < playItems.length; i++) {
                let isParent = false;
                for (let j = 0; j < playItems.length; j++) {
                    if (i !== j) {
                        const childHtml = await playItems[j].innerHTML().catch(() => '');
                        const parentHtml = await playItems[i].innerHTML().catch(() => '');
                        if (parentHtml.length > childHtml.length && parentHtml.includes(childHtml)) {
                            isParent = true;
                            break;
                        }
                    }
                }
                if (!isParent) uniquePlayItems.push(playItems[i]);
            }
            playItems = uniquePlayItems;

            logger(`🎯 Tìm thấy ${playItems.length} bài tập hợp lệ trong khóa học.`);

            if (playItems.length === 0) {
                logger('⚠️ Không tìm thấy bài tập nào. Khóa học có thể trống hoặc có cấu trúc khác.');
            }

            for (let i = 0; i < playItems.length; i++) {
                const freshCandidates = await page.locator(itemSelector).all();
                let validFreshItems = [];
                for (const item of freshCandidates) {
                    const text = await item.innerText().catch(() => '');
                    if (/Đang mở|Hoàn thành|Chưa xem|Chưa học/.test(text) && /\d{2}\/\d{2}\/\d{4}/.test(text)) {
                        validFreshItems.push(item);
                    }
                }

                const uniqueFreshItems = [];
                for (let k = 0; k < validFreshItems.length; k++) {
                    let isParent = false;
                    for (let j = 0; j < validFreshItems.length; j++) {
                        if (k !== j) {
                            const childHtml = await validFreshItems[j].innerHTML().catch(() => '');
                            const parentHtml = await validFreshItems[k].innerHTML().catch(() => '');
                            if (parentHtml.length > childHtml.length && parentHtml.includes(childHtml)) isParent = true;
                        }
                    }
                    if (!isParent) uniqueFreshItems.push(validFreshItems[k]);
                }

                const lessonItem = uniqueFreshItems[i];
                if (!lessonItem) continue;

                logger(`⏳ [${i + 1}/${playItems.length}] Mở bài tập...`);
                await lessonItem.scrollIntoViewIfNeeded().catch(() => { });
                const lessonTitle = lessonItem.locator('.MuiTypography-noWrap').first();
                await lessonTitle.click({ force: true, timeout: 5000 }).catch(async () => {
                    await lessonItem.click({ force: true });
                });
                await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
                await page.waitForTimeout(333);

                await runSolver(page, logger);
                await submitAndClose(page, logger);

                logger(`✅ [${i + 1}/${playItems.length}] Xong! Quay lại khóa học...`);
                await page.goto(courseUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
                await page.waitForTimeout(266);
                if (await studyTab.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await studyTab.click();
                    await page.waitForTimeout(266);
                    const reExpandButtons = await page.locator('button[aria-label="Mở rộng"]').all();
                    for (const btn of reExpandButtons) {
                        if (await btn.isVisible().catch(() => false)) {
                            await btn.click().catch(() => { });
                        }
                    }
                    await page.waitForTimeout(166);
                }
                await scrollDown(8);
            }

            logger(`🏆 Hoàn tất khóa học: ${title}`);
        }

    } catch (error) {
        logger(`❌ Lỗi: ${error.message}`);
    } finally {
        logger('\n🏁 Tự động hóa hoàn tất.');
        await browser.close().catch(() => { });
    }
}

async function submitAndClose(page, logger) {
    const submitBtn = page.getByRole('button', { name: /Nộp bài/i }).first();
    if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        logger('📤 Nộp bài...');
        await submitBtn.click();
        await page.waitForTimeout(500);
        const closeBtns = await page.getByRole('button', { name: 'Đóng', exact: true }).all();
        for (const btn of closeBtns) {
            if (await btn.isVisible().catch(() => false)) {
                logger('✅ Đóng popup điểm...');
                await btn.click({ force: true }).catch(() => { });
                await page.waitForTimeout(266);
            }
        }
    }
}

async function runSolver(page, logger) {
    await page.exposeFunction('browserLog', (msg) => logger(`  🧩 ${msg}`)).catch(() => { });

    await page.evaluate(async () => {
        const log = window.browserLog || (() => { });
        const sleep = ms => new Promise(r => setTimeout(r, ms));

        const getCleanText = (el) => {
            const target = el.querySelector('.h5p-alternative-inner') || el;
            return target.innerText.split('\n')[0].trim();
        };

        const forceClick = async el => {
            if (!el) return;
            el.scrollIntoView({ block: 'center', behavior: 'instant' });
            await sleep(33);
            ['mousedown', 'mouseup', 'click'].forEach(e =>
                el.dispatchEvent(new MouseEvent(e, { bubbles: true, cancelable: true, view: window }))
            );
            await sleep(66);
        };

        const getBtn = (p, d, sel) => p.querySelector(sel) || d.querySelector(sel);

        const solveMultichoice = async (panel, d) => {
            log('Đang giải bài tập Trắc nghiệm...');
            const getAnswers = () => [...panel.querySelectorAll('.h5p-answer')];
            let answers = getAnswers();
            if (answers.length === 0) return;

            const revealedCorrect = answers.filter(ans =>
                ans.classList.contains('h5p-correct') ||
                ans.querySelector('.h5p-question-plus-one')
            );

            if (revealedCorrect.length > 0) {
                log(`Tìm thấy ${revealedCorrect.length} câu trả lời đúng bị lộ, đang chọn...`);
                for (let ans of revealedCorrect) {
                    if (!(ans.classList.contains('h5p-selected') || ans.getAttribute('aria-checked') === 'true')) {
                        await forceClick(ans);
                    }
                }
                let checkBtn = getBtn(panel, d, '.h5p-question-check-answer:not([disabled])');
                if (checkBtn) { await forceClick(checkBtn); await sleep(266); }
                return;
            }

            for (const ans of answers) {
                if (!(ans.classList.contains('h5p-selected') || ans.getAttribute('aria-checked') === 'true')) {
                    await forceClick(ans);
                }
            }

            let checkBtn = getBtn(panel, d, '.h5p-question-check-answer:not([disabled])');
            if (checkBtn) {
                await forceClick(checkBtn);
                await sleep(333);
            }

            let correctTexts = [];
            getAnswers().forEach(ans => {
                if (ans.querySelector('.h5p-question-plus-one') || ans.classList.contains('h5p-correct')) {
                    correctTexts.push(getCleanText(ans));
                }
            });

            const retryBtn = getBtn(panel, d, '.h5p-question-try-again:not([disabled])');
            if (retryBtn && (panel.querySelector('.h5p-question-minus-one') || !panel.querySelector('.h5p-joubelui-score-bar-full-score'))) {
                await forceClick(retryBtn);
                await sleep(266);

                const freshAnswers = getAnswers();
                for (let ans of freshAnswers) {
                    if (correctTexts.includes(getCleanText(ans))) {
                        await forceClick(ans);
                        await sleep(30);
                    }
                }

                let newCheck = getBtn(panel, d, '.h5p-question-check-answer:not([disabled])');
                if (newCheck) { await forceClick(newCheck); await sleep(266); }
            }
        };

        const solveTrueFalse = async (panel, d) => {
            const opts = [...panel.querySelectorAll('.h5p-true-false-answer')];
            const revealed = opts.find(o => o.classList.contains('correct'));
            if (revealed) {
                await forceClick(revealed);
                let check = getBtn(panel, d, '.h5p-question-check-answer:not([disabled])');
                if (check) await forceClick(check);
                return;
            }
            for (let opt of opts) {
                await forceClick(opt);
                let check = getBtn(panel, d, '.h5p-question-check-answer:not([disabled])');
                if (check) await forceClick(check);
                await sleep(266);
                if (!panel.querySelector('.h5p-wrong')) return;
                let retry = getBtn(panel, d, '.h5p-question-try-again:not([disabled])');
                if (retry) { await forceClick(retry); await sleep(166); }
            }
        };

        const solveSingleChoice = async (panel) => {
            log('Đang giải Single Choice (nhiều slide)...');
            let loop = 15;
            while (loop-- > 0) {
                const slide = panel.querySelector('.h5p-sc-slide.h5p-sc-current-slide');
                if (!slide) break;
                const revealed = slide.querySelector('.h5p-sc-alternative.h5p-sc-is-correct');
                if (revealed) {
                    await forceClick(revealed);
                    await sleep(200);
                    continue;
                }
                const alts = [...slide.querySelectorAll('.h5p-sc-alternative')];
                for (let alt of alts) {
                    await forceClick(alt);
                    await sleep(200);
                    if (!slide.classList.contains('h5p-sc-current-slide')) break;
                }
            }
        };

        const solveSummary = async (panel) => {
            log('Đang giải bài tập Summary...');
            let loop = 30;
            while (loop-- > 0) {
                const evalContent = panel.querySelector('.summary-evaluation-content');
                if (evalContent && evalContent.innerText.trim().includes('Kết quả của bạn') && evalContent.offsetHeight > 0) {
                    log('Đã xong bài Summary (Bảng kết quả).');
                    break;
                }

                const opt = panel.querySelector('.summary-claim-unclicked');
                if (!opt) {
                    await sleep(333);
                    if (!panel.querySelector('.summary-claim-unclicked')) break;
                    continue;
                }

                await forceClick(opt);
                await sleep(500);
            }
        };

        const solveAll = async (d) => {
            const items = [...d.querySelectorAll('.h5p-interaction, .h5p-question-content, .summary-content, .h5p-container, [class*="h5p-"]')].filter((p, index, self) => {
                if (self.indexOf(p) !== index) return false;
                return p.querySelector('.h5p-answer, .h5p-sc-alternative, .h5p-true-false-answer, .summary-claim-unclicked, .h5p-correct, .h5p-question-plus-one, .h5p-choice');
            });

            if (items.length > 0) log(`Đã nhận diện ${items.length} phần bài tập.`);

            for (let item of items) {
                if (item.querySelector('.h5p-multichoice, .h5p-answers, .h5p-answer, .h5p-choice')) {
                    await solveMultichoice(item, d);
                }
                else if (item.querySelector('.h5p-single-choice-set, .h5p-sc-alternative')) {
                    await solveSingleChoice(item);
                }
                else if (item.querySelector('.h5p-true-false')) {
                    await solveTrueFalse(item, d);
                }
                else if (item.classList.contains('summary-content') || item.querySelector('.summary-options, .summary-claim-unclicked')) {
                    await solveSummary(item);
                }
                await sleep(133);
            }
            const next = d.querySelector('.h5p-question-iv-continue, .h5p-question-next');
            if (next) await forceClick(next);
        };

        const main = async d => {
            const markers = [...d.querySelectorAll('.h5p-seekbar-interaction')];
            if (markers.length > 0) {
                for (let m of markers) {
                    await forceClick(m);
                    await sleep(333);
                    await solveAll(d);
                    const close = d.querySelector('.h5p-close-popup');
                    if (close) await forceClick(close);
                }
            } else await solveAll(d);
            const submit = d.querySelector('.h5p-interactive-video-endscreen-submit-button');
            if (submit) await forceClick(submit);
        };

        const docs = [document, ...[...document.querySelectorAll('iframe')].map(f => {
            try { return f.contentDocument; } catch (e) { return null; }
        }).filter(Boolean)];

        for (const doc of docs) {
            await main(doc);
        }
    });
}

module.exports = { solveLMS };
