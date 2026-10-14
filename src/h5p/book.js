'use strict';
/**
 * book.js — Điểm vào (entry) cho solver "sách online" H5P.
 *
 * ⚠️ ĐÃ TÁI CẤU TRÚC THÀNH MODULE (xem src/h5p/book/). File này chỉ re-export
 * để giữ tương thích `require('../src/h5p/book')` cho code cũ.
 *
 * Các module con:
 *   book/index.js      điều phối chung (solveBook)
 *   book/read.js       tìm frame + đọc jsonContent
 *   book/schema.js     parse jsonContent -> model (thuần logic, có unit test)
 *   book/navigate.js   điều hướng slide (CP) / trang (IB)
 *   book/question.js   giải 1 container câu hỏi (choice/blanks/summary)
 *   book/dom.js        primitives click/scroll/feedback
 *
 * Đã verify thực tế lms360.vn:
 *   - CP "UNIT 6": 3/3 slide, 18/18 blanks, bar 100%.
 *   - IB "Bài 7. Lăng kính": 7 trang, 8/10 điểm (MC+TrueFalse+CP đúng hết).
 */
module.exports = require('./book/index.js');

