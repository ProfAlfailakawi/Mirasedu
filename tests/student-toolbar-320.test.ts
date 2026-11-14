import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/*
 * شريط أدوات الطالب عند 320px: سبعة أزرار دائرية. قاعدة `width/min-width: 44px !important`
 * في miras-duo-layouts.css تغلب قاعدة 2.55rem، فكان الشريط يتّسع إلى ~319px ويُقصّ زر
 * «الرئيسية» عند حافة البطاقة. الحارس: قاعدة ≤350px تسمح للأزرار بالانكماش (flex-shrink)
 * والشريط لا يتجاوز عرض الترويسة.
 */
const css = fs.readFileSync(new URL('../src/design/miras-student-header.css', import.meta.url), 'utf8');
const idx = css.lastIndexOf('@media (max-width: 350px)');
const block = css.slice(idx);

test('student toolbar: <=350px rule lets the pill shrink inside the header', () => {
  assert.ok(idx > 0);
  assert.match(block, /\.miras-student-toolbar:not[^{]*\{[^}]*max-width:\s*100%\s*!important/);
});

test('student toolbar: <=350px buttons use a shrinkable flex-basis, not a fixed width', () => {
  assert.match(block, /\.miras-student-tool:not[^{]*\{[^}]*flex:\s*0 1 44px\s*!important/);
  const m = block.match(/\.miras-student-tool:not[^{]*\{[^}]*min-width:\s*(\d+)px/);
  assert.ok(m && Number(m[1]) < 44 && Number(m[1]) >= 34, 'min-width must be below 44 but not tiny');
});
