'use strict';

// Тесты для HTML Anchor Generator.
// Механика: оптимальное сопоставление + ВСЕГДА последовательная
// перенумерация ID (one, two, three, ...) по порядку появления в документе,
// с обновлением ссылок в таблице. При удалении карточки ссылки пересчитываются.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const scriptPath = path.resolve(__dirname, '..', 'script.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  runScripts: 'outside-only',
});
const { window } = dom;

const wrapper = new Function(
  'window', 'document', 'DOMParser', 'module', scriptSource
);
wrapper(window, undefined, window.DOMParser, undefined);

const { processInput } = window.HTMLAnchorCore;

// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    passed++;
    console.log('  PASS  ' + name);
  } else {
    failed++;
    failures.push({ name, actual, expected });
    console.log('  FAIL  ' + name);
    console.log('        expected: ' + JSON.stringify(expected));
    console.log('        actual  : ' + JSON.stringify(actual));
  }
}

function checkTrue(name, cond, detail) {
  const ok = !!cond;
  if (ok) {
    passed++;
    console.log('  PASS  ' + name);
  } else {
    failed++;
    failures.push({ name, actual: detail || 'false', expected: 'true' });
    console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : ''));
  }
}

function getCards(html) {
  const d = new window.DOMParser().parseFromString(html, 'text/html');
  return Array.from(d.querySelectorAll('product-card')).map((c) => c.outerHTML);
}

function getCardIds(html) {
  const d = new window.DOMParser().parseFromString(html, 'text/html');
  return Array.from(d.querySelectorAll('product-card')).map((c) => c.getAttribute('id'));
}

function extractTdTexts(html) {
  const d = new window.DOMParser().parseFromString(html, 'text/html');
  return Array.from(d.querySelectorAll('td')).map((td) => td.textContent);
}

// Нормализация для сопоставления в тестовом хелпере удаления:
// убираем пунктуацию, эмодзи, лишние пробелы, регистр.
function normKey(text) {
  return String(text)
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

// Удаляет из HTML-строки карточку и соответствующую строку таблицы,
// название которых содержит cellText (сопоставление по нормализованной подстроке).
function removeItem(html, cellText) {
  const d = new window.DOMParser().parseFromString(html, 'text/html');
  const doc = d.documentElement;
  const key = normKey(cellText);

  const rows = Array.from(doc.querySelectorAll('tbody tr'));
  for (const tr of rows) {
    const firstTd = tr.querySelector('td');
    if (firstTd && normKey(firstTd.textContent).indexOf(key) !== -1) {
      tr.parentNode.removeChild(tr);
      break;
    }
  }
  const cards = Array.from(doc.querySelectorAll('product-card'));
  for (const card of cards) {
    const t = card.querySelector('title');
    if (t && normKey(t.textContent).indexOf(key) !== -1) {
      card.parentNode.removeChild(card);
      break;
    }
  }
  return doc.innerHTML;
}

// ---------------------------------------------------------------------------
console.log('\n=== 1. Полное совпадение — ссылка создаётся, ID = one ===');
{
  const src = '<table><tbody><tr><td>Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title><description>Описание</description></product-card>';
  const r = processInput(src);
  check('matched = 1', r.stats.matched, 1);
  checkTrue('td содержит {Xiaomi 17T}(#one)',
    extractTdTexts(r.html).join('|').includes('{Xiaomi 17T}(#one)'),
    extractTdTexts(r.html).join('|'));
  checkTrue('карточка получила id="one"', getCards(r.html).join('').includes('id="one"'));
}

console.log('\n=== 2. Эмодзи в начале названия ===');
{
  const src = '<table><tbody><tr><td>🏆 Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title></product-card>';
  const r = processInput(src);
  check('matched = 1', r.stats.matched, 1);
  checkTrue('эмодзи сохранён в ссылке',
    extractTdTexts(r.html).join('').includes('{🏆 Xiaomi 17T}(#one)'),
    extractTdTexts(r.html).join(''));
}

console.log('\n=== 3. Отличие регистром — совпадение есть ===');
{
  const src = '<table><tbody><tr><td>XIAOMI 17T</td></tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title></product-card>';
  const r = processInput(src);
  check('matched = 1', r.stats.matched, 1);
}

console.log('\n=== 4. Отличие пунктуацией — совпадение есть ===');
{
  const src = '<table><tbody><tr><td>Xiaomi 17T,</td></tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title></product-card>';
  const r = processInput(src);
  check('matched = 1', r.stats.matched, 1);
}

console.log('\n=== 5. В title есть «Смартфон» — совпадение есть ===');
{
  const src = '<table><tbody><tr><td>Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card><title>Смартфон Xiaomi 17T</title></product-card>';
  const r = processInput(src);
  check('matched = 1', r.stats.matched, 1);
}

console.log('\n=== 6. Существующий ID переприсваивается по порядку ===');
{
  const src = '<table><tbody><tr><td>Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card id="one"><title>Смартфон Xiaomi, 17T</title></product-card>';
  const r = processInput(src);
  check('matched = 1', r.stats.matched, 1);
  checkTrue('ссылка #one',
    extractTdTexts(r.html).join('').includes('{Xiaomi 17T}(#one)'),
    extractTdTexts(r.html).join(''));
  checkTrue('id="one" сохранён', getCards(r.html).join('').includes('id="one"'));
}

console.log('\n=== 7. У карточки нет ID — создаётся уникальный (one) ===');
{
  const src = '<table><tbody><tr><td>iQOO 15R</td></tr></tbody></table>' +
    '<product-card><title>Смартфон iQOO, 15R</title></product-card>';
  const r = processInput(src);
  check('added = 1', r.stats.added, 1);
  checkTrue('id="one"', getCards(r.html).join('').includes('id="one"'));
  checkTrue('ссылка (#one)', extractTdTexts(r.html).join('').includes('{iQOO 15R}(#one)'));
}

console.log('\n=== 7b. Несколько ID — one, two, three последовательно ===');
{
  let rows = '';
  let cards = '';
  const items = ['iQOO 15R', 'Honor 600', 'Redmi Note 17 Pro Max'];
  for (const it of items) {
    rows += '<tr><td>' + it + '</td></tr>';
    cards += '<product-card><title>' + it + '</title></product-card>';
  }
  const src = '<table><tbody>' + rows + '</tbody></table>' + cards;
  const r = processInput(src);
  const texts = extractTdTexts(r.html);
  checkTrue('первый #one', texts[0].indexOf('(#one)') !== -1, texts.join(' | '));
  checkTrue('второй #two', texts[1].indexOf('(#two)') !== -1, texts.join(' | '));
  checkTrue('третий #three', texts[2].indexOf('(#three)') !== -1, texts.join(' | '));
}

console.log('\n=== 8. Две карточки с одинаковым <title> — неоднозначность ===');
{
  const src = '<table><tbody><tr><td>Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card><title>Смартфон Xiaomi, 17T</title></product-card>' +
    '<product-card><title>Смартфон Xiaomi, 17T</title></product-card>';
  const r = processInput(src);
  check('matched = 0', r.stats.matched, 0);
  check('ambiguous = 1', r.stats.ambiguous, 1);
  check('cell не изменена', extractTdTexts(r.html).join(''), 'Xiaomi 17T');
}

console.log('\n=== 9. Ячейка ✅/❌ — ссылка не создаётся ===');
{
  const src = '<table><tbody><tr><td>Xiaomi 17T</td><td>✅</td><td>❌</td></tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title></product-card>';
  const r = processInput(src);
  const texts = extractTdTexts(r.html);
  checkTrue('✅ сохранена без ссылки', texts[1] === '✅', texts.join('|'));
  checkTrue('❌ сохранена без ссылки', texts[2] === '❌', texts.join('|'));
}

console.log('\n=== 10. Уже готовый Markdown-якорь — повторно не оборачивается ===');
{
  const src = '<table><tbody><tr><td>{Xiaomi 17T}(#one)</td></tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title></product-card>';
  const r = processInput(src);
  const texts = extractTdTexts(r.html);
  checkTrue('якорь остался ровно один, без двойной скобки',
    texts[0] === '{Xiaomi 17T}(#one)',
    texts.join(' | '));
}

console.log('\n=== 10b. Идемпотентность — повторная обработка ===');
{
  const src = '<table><tbody><tr><td>🏆 Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card><title>Смартфон Xiaomi, 17T</title></product-card>';
  const once = processInput(src).html;
  const twice = processInput(once).html;
  checkTrue('якорь ровно один, без двойной скобки',
    extractTdTexts(twice)[0] === '{🏆 Xiaomi 17T}(#one)',
    extractTdTexts(twice).join(' | '));
  checkTrue('id="one" ровно один',
    (getCards(twice).join('').match(/id="one"/g) || []).length === 1);
}

console.log('\n=== 11. Нет карточек — результат без изменений ===');
{
  const src = '<table><tbody><tr><td>Xiaomi 17T</td></tr></tbody></table>';
  const r = processInput(src);
  check('matched = 0', r.stats.matched, 0);
  check('cell не изменена', extractTdTexts(r.html).join(''), 'Xiaomi 17T');
  check('error = null', r.error, null);
}

console.log('\n=== 12. Повреждённый HTML — интерфейс не падает ===');
{
  const src = '<table><tbody><tr><td>Xiaomi 17T</td></tr><product-card><title>Xiaomi 17T</title>';
  const r = processInput(src);
  checkTrue('не брошено исключение, возвращён объект', r && typeof r === 'object');
  checkTrue('html — строка', typeof r.html === 'string');
}

console.log('\n=== 13. Занятые ID в другом месте документа обходятся ===');
{
  const src = '<div id="one"></div><div id="two"></div>' +
    '<table><tbody><tr><td>iQOO 15R</td></tr></tbody></table>' +
    '<product-card><title>iQOO 15R</title></product-card>';
  const r = processInput(src);
  checkTrue('новый id = three (обходит one, two)',
    getCards(r.html).join('').includes('id="three"'), getCards(r.html).join(''));
}

console.log('\n=== 14. Несопоставленные ячейки сохраняют содержимое ===');
{
  const src = '<table><tbody><tr>' +
    '<td>Xiaomi 17T</td>' +
    '<td><span class="price">1000 руб</span> в наличии</td>' +
    '</tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title></product-card>';
  const r = processInput(src);
  checkTrue('вложенные элементы несопоставленной ячейки сохранены',
    r.html.includes('<span class="price">1000 руб</span> в наличии'),
    r.html);
  checkTrue('название сопоставлено и оформлено',
    extractTdTexts(r.html).join('').includes('{Xiaomi 17T}(#one)'));
}

console.log('\n=== 15. <th> не обрабатываются ===');
{
  const src = '<table><thead><tr><th>Xiaomi 17T</th></tr></thead><tbody><tr><td>Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title></product-card>';
  const r = processInput(src);
  const d = new window.DOMParser().parseFromString(r.html, 'text/html');
  const th = d.querySelector('th');
  checkTrue('<th> не стал ссылкой', th && th.textContent === 'Xiaomi 17T', th && th.textContent);
  checkTrue('<td> стал ссылкой', extractTdTexts(r.html).join('').includes('{Xiaomi 17T}(#one)'));
}

console.log('\n=== 16. Полный набор из 10 товаров — all matched, ID one..ten ===');
{
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
  const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  let rows = '';
  let cards = '';
  for (const [cell, title] of pairs) {
    rows += '<tr><td>' + cell + '</td></tr>';
    cards += '<product-card><title>' + title + '</title></product-card>';
  }
  const src = '<table><tbody>' + rows + '</tbody></table>' + cards;
  const r = processInput(src);
  check('matched = 10', r.stats.matched, 10);
  check('added = 10', r.stats.added, 10);
  check('ambiguous = 0', r.stats.ambiguous, 0);
  const texts = extractTdTexts(r.html);
  const wordsOk = words.every(function (w, i) {
    return texts[i].indexOf('(#' + w + ')') !== -1;
  });
  checkTrue('ID идут one..ten по порядку', wordsOk, texts.join(' | '));
}

console.log('\n=== 17. Удалена карточка — ссылки перенумерованы по порядку ===');
{
  const allPairs = [
    ['Xiaomi 17T', 'Смартфон Xiaomi, 17T'],
    ['Poco X8 Pro Max', 'Смартфон Poco, X8 Pro Max'],
    ['iQOO 15R', 'Смартфон iQOO, 15R'],
    ['Honor 600', 'Смартфон Honor, 600'],
  ];

  function build(pairs) {
    let rows = '';
    let cards = '';
    for (const [cell, title] of pairs) {
      rows += '<tr><td>' + cell + '</td></tr>';
      cards += '<product-card><title>' + title + '</title></product-card>';
    }
    return '<table><tbody>' + rows + '</tbody></table>' + cards;
  }

  const out4 = processInput(build(allPairs)).html;
  checkTrue('4 карточки: ID one..four',
    JSON.stringify(getCardIds(out4)) === JSON.stringify(['one', 'two', 'three', 'four']),
    JSON.stringify(getCardIds(out4)));

  const removedCell = 'Poco X8 Pro Max';
  const src3 = build(allPairs.filter((p) => p[0] !== removedCell));
  const out3 = processInput(src3).html;

  checkTrue('после удаления: ID one..three',
    JSON.stringify(getCardIds(out3)) === JSON.stringify(['one', 'two', 'three']),
    JSON.stringify(getCardIds(out3)));

  const texts3 = extractTdTexts(out3);
  checkTrue('первый #one', texts3[0].indexOf('(#one)') !== -1, texts3.join(' | '));
  checkTrue('второй(был третий iQOO) #two', texts3[1].indexOf('(#two)') !== -1, texts3.join(' | '));
  checkTrue('третий(был четвёртый Honor) #three', texts3[2].indexOf('(#three)') !== -1, texts3.join(' | '));

  checkTrue('iQOO карточка id="two"',
    getCards(out3).join('').match(/id="two"[^>]*>[\s\S]*?Смартфон iQOO/),
    getCards(out3).join(''));
}

console.log('\n=== 17b. Удалена карточка при существующих якорях — ссылки пересчитаны ===');
{
  const allPairs = [
    ['Xiaomi 17T', 'Смартфон Xiaomi, 17T'],
    ['Poco X8 Pro Max', 'Смартфон Poco, X8 Pro Max'],
    ['iQOO 15R', 'Смартфон iQOO, 15R'],
    ['Honor 600', 'Смартфон Honor, 600'],
  ];
  const words = ['one', 'two', 'three', 'four'];

  let rows = '';
  let cards = '';
  for (let i = 0; i < allPairs.length; i++) {
    rows += '<tr><td>{' + allPairs[i][0] + '}(#' + words[i] + ')</td></tr>';
    cards += '<product-card id="' + words[i] + '"><title>' + allPairs[i][1] + '</title></product-card>';
  }
  const src = '<table><tbody>' + rows + '</tbody></table>' + cards;

  const out4 = processInput(src).html;
  checkTrue('сначала ID one..four',
    JSON.stringify(getCardIds(out4)) === JSON.stringify(['one', 'two', 'three', 'four']),
    JSON.stringify(getCardIds(out4)));

  const removedCell = 'Poco X8 Pro Max';
  const src3 = removeItem(out4, removedCell);
  const out3 = processInput(src3).html;

  checkTrue('после удаления: ID one..three',
    JSON.stringify(getCardIds(out3)) === JSON.stringify(['one', 'two', 'three']),
    JSON.stringify(getCardIds(out3)));

  const texts3 = extractTdTexts(out3);
  checkTrue('первый #one', texts3[0].indexOf('(#one)') !== -1, texts3.join(' | '));
  checkTrue('второй(бывший #three) теперь #two', texts3[1].indexOf('(#two)') !== -1, texts3.join(' | '));
  checkTrue('третий(бывший #four) теперь #three', texts3[2].indexOf('(#three)') !== -1, texts3.join(' | '));
}

// ---------------------------------------------------------------------------
console.log('\n==========================================');
console.log('Результат: ' + passed + ' PASS, ' + failed + ' FAIL');
if (failures.length) {
  console.log('\nПроваленные проверки:');
  failures.forEach((f) => console.log('  - ' + f.name));
}
process.exit(failed ? 1 : 0);