'use strict';
// Полный end-to-end прогон на реальных данных пользователя (10 товаров),
// включая перенумерацию при удалении и повторную обработку.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const scriptPath = path.resolve(__dirname, '..', 'script.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'outside-only' });
const { window } = dom;
const wrapper = new Function('window','document','DOMParser','module', scriptSource);
wrapper(window, undefined, window.DOMParser, undefined);
const { processInput } = window.HTMLAnchorCore;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}

const pairs = [
  ['🏆 Xiaomi 17T', 'Смартфон Xiaomi, 17T'],
  ['🎮 Poco X8 Pro Max', 'Смартфон Poco, X8 Pro Max'],
  ['iQOO 15R', 'Смартфон iQOO, 15R'],
  ['🔋 Honor Power 2', 'Смартфон Honor, Power 2'],
  ['Redmi Note 17 Pro Max', 'Смартфон Redmi, Note 17 Pro Max'],
  ['📷 Huawei Pura 80', 'Смартфон Huawei, Pura 80'],
  ['Honor 600', 'Смартфон Honor, 600'],
  ['Honor X9e Pro', 'Смартфон Honor, X9e Pro'],
  ['🔨 Blackview Xplore1', 'Смартфон Blackview, Xplore1'],
  ['Apple iPhone 16e', 'Смартфон Apple, iPhone 16e'],
];

function buildFull(pairs) {
  let rows = '';
  let cards = '';
  for (const [cell, title] of pairs) {
    rows += '      <tr><td>' + cell + '</td><td>✅</td><td>❌</td></tr>\n';
    cards += '<product-card>\n  <title>' + title + '</title>\n  <description>Описание</description>\n</product-card>\n';
  }
  return '<table>\n  <tbody>\n' + rows + '  </tbody>\n</table>\n' + cards;
}

const words = ['one','two','three','four','five','six','seven','eight','nine','ten'];

console.log('=== End-to-end: 10 товаров ===');
const full = buildFull(pairs);
const r1 = processInput(full);
check('matched = 10', r1.stats.matched === 10);
check('added = 10', r1.stats.added === 10);
check('ambiguous = 0', r1.stats.ambiguous === 0);

const d1 = new window.DOMParser().parseFromString(r1.html, 'text/html');
const tds = Array.from(d1.querySelectorAll('td'));
const names = tds.filter((_, i) => i % 3 === 0);
let orderOk = true;
for (let i = 0; i < 10; i++) {
  if (names[i].textContent.indexOf('(#' + words[i] + ')') === -1) orderOk = false;
}
check('ID идут one..ten по порядку', orderOk, names.map(n=>n.textContent).join(' | '));

const cards1 = Array.from(d1.querySelectorAll('product-card')).map(c=>c.getAttribute('id'));
check('карточки ID one..ten', JSON.stringify(cards1) === JSON.stringify(words), JSON.stringify(cards1));

console.log('\n=== Удаляем Poco X8 Pro Max (второй): строку и карточку ===');
const removedIdx = 1; // Poco
const d2 = new window.DOMParser().parseFromString(r1.html, 'text/html');
const doc2 = d2.documentElement;

// Удаляем строку таблицы, чья первая ячейка — ссылка на #two.
for (const tr of Array.from(doc2.querySelectorAll('tbody tr'))) {
  const first = tr.querySelector('td');
  if (first && first.textContent.indexOf('(#two)') !== -1) { tr.parentNode.removeChild(tr); break; }
}
// Удаляем карточку с id="two".
for (const card of Array.from(doc2.querySelectorAll('product-card'))) {
  if (card.getAttribute('id') === 'two') { card.parentNode.removeChild(card); break; }
}
const src3 = doc2.innerHTML;
const r2 = processInput(src3);
check('matched = 9', r2.stats.matched === 9, r2.stats.matched);
const d3 = new window.DOMParser().parseFromString(r2.html, 'text/html');
const cards3 = Array.from(d3.querySelectorAll('product-card')).map(c=>c.getAttribute('id'));
check('карточки теперь one..nine', JSON.stringify(cards3) === JSON.stringify(words.slice(0,9)), JSON.stringify(cards3));
const names3 = Array.from(d3.querySelectorAll('td')).filter((_,i)=>i%3===0);
const order3 = ['one','two','three','four','five','six','seven','eight','nine'].every((w,i)=>names3[i].textContent.indexOf('(#'+w+')')!==-1);
check('ссылки перенумерованы one..nine', order3, names3.map(n=>n.textContent).join(' | '));

console.log('\n=== Повторная обработка (идемпотентность) ===');
const r3 = processInput(r2.html);
check('повторный прогон идентичен', r3.html === r2.html);

console.log('\n==========================================');
console.log('Результат: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);