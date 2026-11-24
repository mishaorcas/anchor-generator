'use strict';
// Воспроизведение на реальных данных пользователя (все 10 товаров).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const scriptPath = path.resolve(__dirname, '..', 'script.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'outside-only' });
const { window } = dom;
const wrapper = new Function('window','document','DOMParser','module', scriptSource);
wrapper(window, undefined, window.DOMParser, undefined);
const { processInput, normalize } = window.HTMLAnchorCore;

// Пары: [ячейка, title]
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

function buildHtml() {
  let rows = '';
  let cards = '';
  for (const [cell, title] of pairs) {
    rows += '        <tr><td>' + cell + '</td><td>✅</td><td>❌</td></tr>\n';
    cards += '<product-card><title>' + title + '</title></product-card>\n';
  }
  return '<table><tbody>\n' + rows + '    </tbody></table>\n' + cards;
}

console.log('=== processInput на полном наборе ===');
const html = buildHtml();
const r = processInput(html);
console.log('stats:', JSON.stringify(r.stats));

const tds = Array.from(new window.DOMParser().parseFromString(r.html,'text/html').querySelectorAll('td'));
const nameTds = tds.filter((td, idx) => idx % 3 === 0);
console.log('\nНазвания в результате:');
nameTds.forEach((td) => console.log('  ' + td.textContent));

const cardsOut = Array.from(new window.DOMParser().parseFromString(r.html,'text/html').querySelectorAll('product-card'));
console.log('\nКарточки в результате (id):');
cardsOut.forEach((c) => console.log('  id="' + (c.getAttribute('id')||'') + '"  title=' + c.querySelector('title').textContent));