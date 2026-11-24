'use strict';
// Комплексный прогон разных вариантов сопоставления (без подтверждений).
// Проверяет: точное совпадение, containment, порог токенов, неоднозначность,
// приоритеты, стоп-слова в разных позициях, идемпотентность.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const scriptPath = path.resolve(__dirname, '..', 'script.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'outside-only' });
const { window } = dom;
new Function('window','document','DOMParser','module', scriptSource)(window, undefined, window.DOMParser, undefined);
const { processInput } = window.HTMLAnchorCore;

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name); console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}

// Прогоняет один сценарий: таблица из ячеек + карточки. Возвращает stats.
function run(cells, titles) {
  const rows = cells.map((c) => '<tr><td>' + c + '</td></tr>').join('');
  const cards = titles.map((t) => '<product-card><title>' + t + '</title></product-card>').join('');
  return processInput('<table><tbody>' + rows + '</tbody></table>' + cards);
}

function extract(html) {
  const d = new window.DOMParser().parseFromString(html, 'text/html');
  return Array.from(d.querySelectorAll('td')).map((td) => td.textContent);
}

// ===========================================================================
// A. Разные префиксы в карточке (точное совпадение должно давать приоритет,
//    но если префикс не стоп-слово — работает containment).
// ===========================================================================
console.log('=== A. Префиксы в названии карточки ===');
{
  const prefixes = ['AR-очки', 'Премиум', 'Умные', 'Фирменные', 'Новые', 'Топ', 'Ревью', 'Доступные', 'Профессиональные', 'Портативные'];
  for (const p of prefixes) {
    const r = run(['Xreal 1S'], [p + ' Xreal 1S']);
    check('префикс «' + p + '»: matched=1', r.stats.matched === 1, JSON.stringify(r.stats));
  }
}

// ===========================================================================
// B. Стоп-слова в разных позициях.
// ===========================================================================
console.log('\n=== B. Стоп-слова в разных позициях ===');
{
  const cases = [
    ['Смартфон Xreal 1S', 'в начале'],
    ['Xreal Смартфон 1S', 'в середине'],
    ['Xreal 1S Телефон', 'в конце'],
    ['Телефон Xreal 1S Телефон', 'с двух сторон'],
    ['Xreal Smartphone 1S', 'английское в середине'],
  ];
  for (const [title, label] of cases) {
    const r = run(['Xreal 1S'], [title]);
    check('стоп-слово ' + label + ': matched=1', r.stats.matched === 1, title + ' -> ' + JSON.stringify(r.stats));
  }
}

// ===========================================================================
// C. Containment с разным числом значимых токенов в ячейке.
// ===========================================================================
console.log('\n=== C. Порог токенов в ячейке ===');
{
  // 2 токена в ячейке, в карточке больше слов — должно совпасть.
  let r = run(['Xreal 1S'], ['Premium AR-очки Xreal 1S Edition']);
  check('2 токена -> containment matched=1', r.stats.matched === 1, JSON.stringify(r.stats));

  // 1 токен в ячейке — должно НЕ совпасть (порог 2).
  r = run(['Xreal'], ['Premium Xreal 1S Edition']);
  check('1 токен -> matched=0 (порог)', r.stats.matched === 0, JSON.stringify(r.stats));

  // 3 токена, лишние слова в карточке спереди и сзади.
  r = run(['Viture Luma Ultra'], ['Super Premium Viture Luma Ultra Glasses 2026']);
  check('3 токена, лишние слова -> matched=1', r.stats.matched === 1, JSON.stringify(r.stats));
}

// ===========================================================================
// D. Неоднозначности.
// ===========================================================================
console.log('\n=== D. Неоднозначность ===');
{
  // Точное совпадение неоднозначно (2 одинаковых title) — matched 0.
  let r = run(['Xreal 1S'], ['Xreal 1S', 'Xreal 1S']);
  check('2 одинаковых title (точное): matched=0, ambiguous=1', r.stats.matched === 0 && r.stats.ambiguous === 1, JSON.stringify(r.stats));

  // Containment неоднозначен (обе карточки содержат токены ячейки).
  r = run(['Rokid Glasses'], ['Premium Rokid Glasses', 'Rokid Glasses Plus']);
  check('2 карточки по вхождению: matched=0, ambiguous=1', r.stats.matched === 0 && r.stats.ambiguous === 1, JSON.stringify(r.stats));

  // Точное совпадение есть И containment тоже — приоритет точному (matched=1).
  r = run(['Xreal 1S'], ['Xreal 1S', 'Premium Xreal 1S']);
  check('точное + вхождение -> точное побеждает (matched=1)', r.stats.matched === 1, JSON.stringify(r.stats));
}

// ===========================================================================
// E. Разный порядок слов и пунктуация/эмодзи.
// ===========================================================================
console.log('\n=== E. Порядок слов, пунктуация, эмодзи ===');
{
  // Точное совпадение устойчиво к пунктуации и эмодзи в ячейке.
  let r = run(['🏆 Xreal, 1S!'], ['Xreal 1S']);
  check('пунктуация+эмодзи (точное): matched=1', r.stats.matched === 1, JSON.stringify(r.stats));

  // Containment: эмодзи в ячейке, префикс в карточке.
  r = run(['🏆 Xreal 1S'], ['Premium Xreal 1S']);
  check('эмодзи+containment: matched=1', r.stats.matched === 1, JSON.stringify(r.stats));

  // Перестановка слов в карточке (1S Xreal) — containment НЕ должен совпасть,
  // т.к. порядок важен для вхождения? Нет: containment смотрит на множества,
  // поэтому 1S Xreal всё равно содержит {xreal, 1s}. Проверим фактическое поведение.
  r = run(['Xreal 1S'], ['Premium 1S Xreal']);
  check('перестановка в карточке (множество): matched=1', r.stats.matched === 1, JSON.stringify(r.stats));
}

// ===========================================================================
// F. Множественные ячейки на одну карточку.
// ===========================================================================
console.log('\n=== F. Несколько ячеек -> одна карточка ===');
{
  const r = run(['Xreal 1S', 'Xreal 1S'], ['Premium Xreal 1S']);
  check('2 ячейки -> одна карточка, matched=2', r.stats.matched === 2, JSON.stringify(r.stats));
  const t = extract(r.html);
  check('обе ячейки -> #one', t[0].indexOf('(#one)') !== -1 && t[1].indexOf('(#one)') !== -1, t.join('|'));
}

// ===========================================================================
// G. Числа-слова и длинные ID.
// ===========================================================================
console.log('\n=== G. Много карточек и ID ===');
{
  const N = 25;
  const cells = [], titles = [];
  for (let i = 1; i <= N; i++) { cells.push('Model ' + i); titles.push('Premium Model ' + i); }
  const r = run(cells, titles);
  check('25 моделей через containment: matched=25', r.stats.matched === 25, JSON.stringify(r.stats));
  const t = extract(r.html);
  check('первый #one', t[0].indexOf('(#one)') !== -1, t[0]);
  check('25-й #twenty-five', t[24].indexOf('(#twenty-five)') !== -1, t[24]);
}

// ===========================================================================
// H. Идемпотентность при разных префиксах.
// ===========================================================================
console.log('\n=== H. Идемпотентность (повторная обработка) ===');
{
  const cells = ['Xreal 1S', 'Viture Luma Ultra', 'Rokid Glasses'];
  const titles = ['Premium AR-очки Xreal 1S', 'Премиум Viture Luma Ultra', 'Новые Rokid Glasses'];
  const once = run(cells, titles).html;
  const twice = processInput(once).html;
  check('повторный прогон идентичен', once === twice);
  const t = extract(once);
  check('якоря ровно по одному', t.every((s) => (s.match(/\(#/g) || []).length === 1), t.join('|'));
}

// ===========================================================================
// I. Смешанные случаи из реальных документов.
// ===========================================================================
console.log('\n=== I. Реальные/смешанные сценарии ===');
{
  // Смартфоны (стоп-слово) + премиум.
  let r = run(['Xiaomi 17T'], ['Смартфон Premium Xiaomi, 17T']);
  check('смартфон + премиум: matched=1', r.stats.matched === 1, JSON.stringify(r.stats));

  // Модель целиком в названии с обёрткой.
  r = run(['RayNeo X3 Pro'], ['Флагманские AR-очки RayNeo X3 Pro, цветной дисплей']);
  check('длинный префикс+суффикс: matched=1', r.stats.matched === 1, JSON.stringify(r.stats));

  // Ячейка с вложенным span (как в документе).
  r = processInput('<table><tbody><tr><td>🏆 <span comment-id="x">Xreal 1S</span></td></tr></tbody></table>' +
    '<product-card><title>AR-очки Xreal, 1S</title></product-card>');
  check('span внутри ячейки (документ): matched=1', r.stats.matched === 1, JSON.stringify(r.stats));
}

// ===========================================================================
// Итог
// ===========================================================================
console.log('\n==========================================');
console.log('Результат: ' + pass + ' PASS, ' + fail + ' FAIL');
if (fails.length) {
  console.log('\nПроваленные:');
  fails.forEach((f) => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);