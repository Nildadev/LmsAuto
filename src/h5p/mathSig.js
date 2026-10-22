'use strict';
/**
 * mathSig.js — Chữ ký MathML để phân biệt đáp án có CÙNG text sau stripHtml.
 *
 * Vì sao cần: đáp án đúng "G = <mfrac>25/f</mfrac>" và đáp án nhiễu "G = 25f."
 * đều stripHtml thành "G = 25f". MultiChoice có randomAnswers=true nên không thể
 * dùng index; nếu khớp text đơn thuần sẽ click nhầm nhiễu -> H5P chấm 0 điểm dù
 * solver báo "clicked 1" (bug live 22/10/2026, sách KHTN "Bài 10. Kính lúp").
 */

/** Text thuần (bỏ tag/entity, bỏ MỌI khoảng trắng) — chỉ dùng trong công thức. */
function plainMath(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCharCode(parseInt(h, 16)); } catch (_) { return ''; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCharCode(+d); } catch (_) { return ''; } })
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, '');
}

/**
 * Chữ ký MathML từ HTML jsonContent. Ví dụ:
 *   <mfrac><mrow><mn>25</mn></mrow><mrow><mi>f</mi></mrow></mfrac> -> "25/f"
 * Không có <math> -> '' (đáp án text thường). Nhiều phân số -> ngăn bằng '|'.
 */
function mathSig(html) {
  const s = String(html == null ? '' : html);
  if (!/<math\b/i.test(s)) return '';
  const fracs = [];
  const re = /<mfrac\b[^>]*>([\s\S]*?)<\/mfrac>/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const rows = [];
    const rowRe = /<mrow\b[^>]*>([\s\S]*?)<\/mrow>/gi;
    let r;
    while ((r = rowRe.exec(m[1])) !== null) rows.push(plainMath(r[1]));
    fracs.push(rows.length >= 2 ? rows.slice(0, 2).join('/') : plainMath(m[1]));
  }
  if (fracs.length) return fracs.join('|');
  // MathML không có phân số: dùng text bên trong <math>.
  const mm = /<math\b[^>]*>([\s\S]*?)<\/math>/i.exec(s);
  return mm ? plainMath(mm[1]) : '';
}

/**
 * Chữ ký MathML của các node DOM — chạy TRONG browser qua locator.evaluateAll.
 * PHẢI tự chứa (không tham chiếu biến ngoài) để Playwright serialize được.
 */
const browserMathSigs = (els) => els.map((el) => {
  const m = el.querySelector && el.querySelector('math');
  if (!m) return '';
  const txt = (n) => (n.textContent || '').replace(/\s+/g, '');
  const fracs = [...m.querySelectorAll('mfrac')];
  if (fracs.length) return fracs.map((f) => [...f.children].map(txt).join('/')).join('|');
  return txt(m);
});

module.exports = { mathSig, browserMathSigs };
