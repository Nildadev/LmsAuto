(function () {
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
        await sleep(30);
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
            console.log('✨ Found revealed answers, selecting...');
            for (let ans of revealedCorrect) {
                if (!(ans.classList.contains('h5p-selected') || ans.getAttribute('aria-checked') === 'true')) {
                    await forceClick(ans);
                }
            }
            let checkBtn = getBtn(panel, d, '.h5p-question-check-answer:not([disabled])');
            if (checkBtn) { await forceClick(checkBtn); await sleep(600); }
            if (panel.querySelector('.h5p-joubelui-score-bar-full-score')) return;
        }

        console.log('🔍 No revealed answers, probing...');
        for (const ans of answers) {
            if (!(ans.classList.contains('h5p-selected') || ans.getAttribute('aria-checked') === 'true')) {
                await forceClick(ans);
            }
        }

        let checkBtn = getBtn(panel, d, '.h5p-question-check-answer:not([disabled])');
        if (checkBtn) {
            await forceClick(checkBtn);
            await sleep(700);
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
            await sleep(600);

            const freshAnswers = getAnswers();
            for (let ans of freshAnswers) {
                if (correctTexts.includes(getCleanText(ans))) {
                    await forceClick(ans);
                    await sleep(30);
                }
            }

            let newCheck = getBtn(panel, d, '.h5p-question-check-answer:not([disabled])');
            if (newCheck) { await forceClick(newCheck); await sleep(600); }
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
            await sleep(600);
            if (!panel.querySelector('.h5p-wrong')) return;
            let retry = getBtn(panel, d, '.h5p-question-try-again:not([disabled])');
            if (retry) { await forceClick(retry); await sleep(400); }
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
                await sleep(500);
                continue;
            }
            const alts = [...slide.querySelectorAll('.h5p-sc-alternative')];
            for (let alt of alts) {
                await forceClick(alt);
                await sleep(500);
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
            await sleep(300);
        }
        const next = d.querySelector('.h5p-question-iv-continue, .h5p-question-next');
        if (next) await forceClick(next);
    };

    const main = async d => {
        const markers = [...d.querySelectorAll('.h5p-seekbar-interaction')];
        if (markers.length > 0) {
            for (let m of markers) {
                await forceClick(m);
                await sleep(800);
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
    docs.forEach(main);
})();
