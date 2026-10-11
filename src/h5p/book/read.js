'use strict';
/**
 * read.js — Tìm frame render sách + đọc jsonContent, parse thành model.
 * Tách phần "đọc" khỏi phần "điều hướng/giải" để dễ test và tái dùng.
 */
const { sleep } = require('../../core/stealth');
const { parseBook } = require('./schema');

const BOOK_SELECTOR = '.h5p-course-presentation, .h5p-interactive-book, .h5p-branching-scenario';

/** Tìm frame chứa DOM sách (CP/IB/Branching). */
async function findBookFrame(page, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        if (await frame.evaluate((sel) => !!document.querySelector(sel), BOOK_SELECTOR)) return frame;
      } catch (_) {}
    }
    await sleep(600);
  }
  return null;
}

/** Đọc jsonContent của content sách trong frame (raw, chưa parse model). */
async function readRawContent(frame) {
  return frame.evaluate(() => {
    const cs = window.H5PIntegration && window.H5PIntegration.contents;
    if (!cs) return null;
    for (const k in cs) {
      const lib = cs[k].library || '';
      if (/CoursePresentation|InteractiveBook|BranchingScenario/.test(lib)) {
        let jc = cs[k].jsonContent;
        if (typeof jc === 'string') { try { jc = JSON.parse(jc); } catch (_) {} }
        return { library: lib, json: jc };
      }
    }
    return null;
  });
}

/**
 * Đọc sách trong frame -> { library, kind, pages } (model từ schema.js).
 * @returns {Promise<object|null>}
 */
async function readBook(frame) {
  const raw = await readRawContent(frame);
  if (!raw || !raw.json) return null;
  const model = parseBook(raw.json);
  if (!model) return null;
  model.library = raw.library;
  return model;
}

module.exports = { findBookFrame, readRawContent, readBook, BOOK_SELECTOR };
