const { chromium } = require('playwright');

async function solveLMS(username, password, onConfirm) {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('🚀 Bắt đầu tự động hóa...');

    try {

        console.log('🌐 Đang điều hướng đến lms360.vn...');
        await page.goto('https://lms360.vn/', { waitUntil: 'networkidle' });

        console.log('🔘 Nhấn nút "Đăng nhập"...');
        const loginLink = page.locator('a[href="/dang-nhap"]').first();
        if (await loginLink.isVisible()) {
            await loginLink.click();
            await page.waitForLoadState('networkidle');
        } else {

            await page.goto('https://lms360.vn/dang-nhap', { waitUntil: 'networkidle' }).catch(() => {});
        }

        console.log('🎓 Đang chọn vai trò: Học sinh...');
        const studentRadio = page.locator('input#student');
        if (await studentRadio.isVisible()) {
            await studentRadio.click({ force: true });

            const ssoLoginBtn = page.locator('button:has-text("Đăng nhập"), .btn-login').first();
            if (await ssoLoginBtn.isVisible()) {
                await ssoLoginBtn.click();
            }
        }

        console.log('🌐 Đang chờ chuyển hướng HCM SSO...');
        await page.waitForURL(/api\.hcm\.edu\.vn/, { timeout: 30000 });

        console.log('🔑 Đang nhập thông tin đăng nhập SSO...');
        await page.waitForSelector('input#UserName', { timeout: 10000 });
        await page.fill('input#UserName', username);
        await page.fill('input#Password', password);

        console.log('🚀 Đang gửi form đăng nhập SSO...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            page.click('button.login100-form-btn')
        ]);

        console.log('⏳ Đang chờ chuyển hướng về lms360.vn...');

        const errorLabel = page.locator('#AuthenResult');
        if (await errorLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
            await browser.close();
            throw new Error('INVALID_CREDENTIALS');
        }

        if (!page.url().includes('lms360.vn')) {
            await page.waitForURL(/lms360\.vn/, { timeout: 60000 });
        }

        await page.waitForLoadState('networkidle');
        console.log('✅ Đăng nhập thành công!');

        console.log('📚 Đang điều hướng đến danh sách khóa học...');
        await page.goto('https://lms360.vn/danh-sach-khoa-hoc-lop', { waitUntil: 'networkidle' });

        const dismissBtn = page.getByRole('button', { name: 'Để sau' });
        if (await dismissBtn.isVisible()) {
            console.log('🛡️ Đang đóng cửa sổ nhận diện khuôn mặt...');
            await dismissBtn.click();
            await page.waitForTimeout(1000);
        }

        let allCourseTitles = [];

        const filters = ['Chưa học', 'Đang học'];
        for (const filter of filters) {
            console.log(`🔍 Filtering by: ${filter}...`);

            const filterBtn = page.locator(`.sc-dJxPsU, div`).filter({ hasText: new RegExp(`^${filter}$`) }).first();
            if (await filterBtn.isVisible()) {
                await filterBtn.click();
                await page.waitForTimeout(2000);

                const titles = await page.evaluate(() => {
                    const cards = document.querySelectorAll('.sc-ObiBn, .course-card');
                    return Array.from(cards).map(card => {
                        const titleEl = card.querySelector('.title-text, [title]');
                        return titleEl ? titleEl.innerText.trim() : null;
                    }).filter(t => t);
                });

                allCourseTitles.push(...titles);

                await filterBtn.click();
                await page.waitForTimeout(1000);
            }
        }

        const uniqueTitles = [...new Set(allCourseTitles)];

        console.log(`\n📊 BÁO CÁO QUÉT KHÓA HỌC:`);
        console.log(`- Tổng số khóa học tìm thấy: ${uniqueTitles.length}`);
        uniqueTitles.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));

        if (uniqueTitles.length === 0) {
            console.log('✨ Không có khóa học nào cần xử lý.');
            return;
        }

        if (onConfirm) {
            const proceed = await onConfirm(`❓ Bạn có chắc chắn muốn học tất cả ${uniqueTitles.length} khóa học này không? (y/n): `);
            if (proceed.toLowerCase() !== 'y') {
                console.log('🛑 Đã hủy quá trình tự động hóa.');
                return;
            }
        }

        console.log('\n🚀 Bắt đầu xử lý từng khóa học...');

        for (const title of uniqueTitles) {
            console.log(`📖 Đang mở khóa học: ${title}`);

            await page.goto('https://lms360.vn/danh-sach-khoa-hoc-lop', { waitUntil: 'networkidle' });

            if (await dismissBtn.isVisible()) {
                await dismissBtn.click();
                await page.waitForTimeout(1000);
            }

            const courseCard = page.locator('.sc-ObiBn, .course-card').filter({ hasText: title }).first();
            if (await courseCard.isVisible()) {
                await courseCard.click();
                await page.waitForLoadState('networkidle');
            } else {
                console.log(`⚠️ Không tìm thấy thẻ khóa học cho: ${title}`);
                continue;
            }

            const studyTab = page.locator('[role="tab"]').filter({ hasText: /CHỦ ĐỀ HỌC TẬP/i }).first();
            if (await studyTab.isVisible({ timeout: 5000 }).catch(() => false)) {
                await studyTab.click();
                await page.waitForTimeout(2000);
            }

            const courseUrl = page.url();

            const validItems = await page.locator('.MuiPaper-root').filter({ has: page.locator('[data-testid="PlayArrowIcon"]') }).all();

            if (validItems.length > 0) {
                console.log(`🎯 Tìm thấy ${validItems.length} bài tập tương tác.`);

                for (let i = 0; i < validItems.length; i++) {

                    const currentItems = await page.locator('.MuiPaper-root').filter({ has: page.locator('[data-testid="PlayArrowIcon"]') }).all();
                    const item = currentItems[i];

                    if (!item) continue;

                    const isCompleted = await item.locator('.status-completed, .icon-check, :text("Hoàn thành")').isVisible().catch(() => false);
                    if (isCompleted) {
                        console.log(`⏭️ [${i + 1}/${validItems.length}] Đã hoàn thành, bỏ qua.`);
                        continue;
                    }

                        console.log(`⏳ [${i + 1}/${validItems.length}] Đang mở hoạt động...`);
                    await item.click();
                    await page.waitForLoadState('networkidle');
                    await page.waitForTimeout(1500);

                    await runSolver(page);
                    const submitBtn = page.getByRole('button', { name: /Nộp bài/i }).first();
                    if (await submitBtn.isVisible()) {
                                console.log('📤 Nhấn nút "Nộp bài"...');
                        await submitBtn.click();
                        await page.waitForTimeout(2000);
                    }

                    console.log(`✅ [${i + 1}/${validItems.length}] Hoạt động hoàn tất! Đang quay lại khóa học...`);

                    await page.goto(courseUrl, { waitUntil: 'networkidle' });
                    await page.waitForTimeout(1500);

                    const tabButtons = page.locator('[role="tab"]').filter({ hasText: /CHỦ ĐỀ HỌC TẬP/i });
                    if (await tabButtons.first().isVisible({ timeout: 2000 }).catch(() => false)) {
                        await tabButtons.first().click();
                        await page.waitForTimeout(1000);
                    }
                }
            } else {

                const sections = ['Phần 1', 'Phần 2', 'Phần 3'];
                for (const sectionName of sections) {
                    console.log(`🔍 Checking ${sectionName}...`);
                    const sectionHeader = page.locator('.MuiAccordionSummary-root, .section-header').filter({ hasText: sectionName }).first();

                    if (await sectionHeader.isVisible()) {
                        const isExpanded = await sectionHeader.getAttribute('aria-expanded') === 'true';
                        if (!isExpanded) {
                            await sectionHeader.click();
                            await page.waitForTimeout(1000);
                        }

                        const sectionContainer = sectionHeader.locator('..');
                        const items = await sectionContainer.locator('.MuiAccordionDetails-root > div, .MuiAccordionDetails-root li, .lesson-item, .activity-item, a[href*="/mod/"]').all();
                        console.log(`📝 Found ${items.length} items in ${sectionName}.`);

                        for (const item of items) {

                            if (await item.locator(':text("Chưa có học liệu nào")').isVisible().catch(() => false)) {
                                console.log('  -> Không có học liệu, bỏ qua.');
                                continue;
                            }

                            const isCompleted = await item.locator('.status-completed, .icon-check, :text("Hoàn thành")').isVisible().catch(() => false);
                            if (isCompleted) {
                                console.log('⏭️ Item đã hoàn thành, bỏ qua.');
                                continue;
                            }

                            console.log('⏳ Đang mở hoạt động...');
                            await item.click();
                            await page.waitForLoadState('networkidle');
                            await page.waitForTimeout(1500);

                            const subExercises = await page.locator('.MuiPaper-root:has-text("BÀI TẬP TƯƠNG TÁC") .MuiPaper-root').all();
                            if (subExercises.length > 0) {
                                console.log(`🧩 Tìm thấy ${subExercises.length} bài tập con trên trang.`);
                                const subValidItems = subExercises.slice(1);
                                for (const subEx of subValidItems) {
                                    const subStatus = await subEx.locator(':text("Hoàn thành")').isVisible().catch(() => false);
                                    if (subStatus) {
                                        console.log('⏭️ Bài tập con đã hoàn thành, bỏ qua.');
                                        continue;
                                    }
                                    console.log('🖱️ Đang nhấn vào bài tập con...');
                                    await subEx.click();
                                    await page.waitForTimeout(1000);
                                    await runSolver(page);

                                    const subSubmitBtn = page.getByRole('button', { name: /Nộp bài/i }).first();
                                    if (await subSubmitBtn.isVisible()) {
                                        await subSubmitBtn.click();
                                        await page.waitForTimeout(1000);
                                    }
                                }
                            } else {

                                await runSolver(page);
                                const submitBtn = page.getByRole('button', { name: /Nộp bài/i }).first();
                                if (await submitBtn.isVisible()) {
                    console.log('📤 Nhấn nút "Nộp bài"...');
                                    await submitBtn.click();
                                    await page.waitForTimeout(2000);
                                }
                            }

                            console.log('✅ Hoạt động hoàn tất!');

                            await page.goto(courseUrl, { waitUntil: 'networkidle' });
                            await page.waitForTimeout(1500);

                            if (await studyTab.isVisible({ timeout: 2000 }).catch(() => false)) {
                                await studyTab.click();
                                await page.waitForTimeout(1000);
                            }

                            if (await sectionHeader.isVisible() && await sectionHeader.getAttribute('aria-expanded') !== 'true') {
                                await sectionHeader.click();
                                await page.waitForTimeout(1000);
                            }
                        }
                    } else {
                        console.log(`⚠️ Không tìm thấy phần ${sectionName}.`);
                    }
                }
            }
        }

    } catch (error) {
        console.error('❌ Lỗi trong quá trình tự động hóa:', error.message);
    } finally {
        console.log('🏁 Tự động hóa hoàn tất.');

    }
}

async function runSolver(page) {

    await page.evaluate(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));

        const getCleanText = (el) => {
            const target = el.querySelector('.h5p-alternative-inner') || el;
            return target.innerText.split('\n')[0].trim();
        };

        const forceClick = async el => {
            if (!el) return;
            el.scrollIntoView({ block: 'center', behavior: 'instant' });
            ['mousedown', 'mouseup', 'click'].forEach(e =>
                el.dispatchEvent(new MouseEvent(e, { bubbles: true, cancelable: true, view: window }))
            );
            await sleep(100);
        };

        const getBtn = (p, d, sel) => p.querySelector(sel) || d.querySelector(sel);

        const solveMultichoice = async (panel, d) => {
            const getAnswers = () => [...panel.querySelectorAll('.h5p-answer')];
            let answers = getAnswers();
            if (answers.length === 0) return;

            const revealedCorrect = answers.filter(ans =>
                ans.classList.contains('h5p-correct') ||
                ans.querySelector('.h5p-question-plus-one')
            );

            if (revealedCorrect.length > 0) {
                for (let ans of revealedCorrect) {
                    if (!(ans.classList.contains('h5p-selected') || ans.getAttribute('aria-checked') === 'true')) {
                        await forceClick(ans);
                    }
                }
                let checkBtn = getBtn(panel, d, '.h5p-question-check-answer:not([disabled])');
                if (checkBtn) { await forceClick(checkBtn); await sleep(800); }
                if (panel.querySelector('.h5p-joubelui-score-bar-full-score')) return;
            }

            for (const ans of answers) {
                if (!(ans.classList.contains('h5p-selected') || ans.getAttribute('aria-checked') === 'true')) {
                    await forceClick(ans);
                }
            }

            let checkBtn = getBtn(panel, d, '.h5p-question-check-answer:not([disabled])');
            if (checkBtn) {
                await forceClick(checkBtn);
                await sleep(1000);
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
                await sleep(800);

                const freshAnswers = getAnswers();
                for (let ans of freshAnswers) {
                    if (correctTexts.includes(getCleanText(ans))) {
                        await forceClick(ans);
                        await sleep(50);
                    }
                }

                let newCheck = getBtn(panel, d, '.h5p-question-check-answer:not([disabled])');
                if (newCheck) { await forceClick(newCheck); await sleep(800); }
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
                await sleep(800);
                if (!panel.querySelector('.h5p-wrong')) return;
                let retry = getBtn(panel, d, '.h5p-question-try-again:not([disabled])');
                if (retry) { await forceClick(retry); await sleep(500); }
            }
        };

        const solveSingleChoice = async (panel) => {
            let loop = 15;
            while (loop-- > 0) {
                const slide = panel.querySelector('.h5p-sc-slide.h5p-sc-current-slide');
                if (!slide) break;
                const revealed = slide.querySelector('.h5p-sc-alternative.h5p-sc-is-correct');
                if (revealed) {
                    await forceClick(revealed);
                    await sleep(600);
                    continue;
                }
                const alts = [...slide.querySelectorAll('.h5p-sc-alternative')];
                for (let alt of alts) {
                    await forceClick(alt);
                    await sleep(600);
                    if (!slide.classList.contains('h5p-sc-current-slide')) break;
                }
            }
        };

        const solveAll = async (d) => {
            const items = [...d.querySelectorAll('.h5p-interaction, .h5p-question-content')].filter(p =>
                p.querySelector('.h5p-answer, .h5p-sc-alternative, .h5p-true-false-answer')
            );
            for (let item of items) {
                if (item.querySelector('.h5p-multichoice, .h5p-answers')) await solveMultichoice(item, d);
                else if (item.querySelector('.h5p-single-choice-set')) await solveSingleChoice(item);
                else if (item.querySelector('.h5p-true-false')) await solveTrueFalse(item, d);
                await sleep(400);
            }
            const next = d.querySelector('.h5p-question-iv-continue, .h5p-question-next');
            if (next) await forceClick(next);
        };

        const main = async d => {
            const markers = [...d.querySelectorAll('.h5p-seekbar-interaction')];
            if (markers.length > 0) {
                for (let m of markers) {
                    await forceClick(m);
                    await sleep(1000);
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
