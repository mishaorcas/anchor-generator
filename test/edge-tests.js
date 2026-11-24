'use strict';

// Дополнительные edge-case тесты для полной ревизии HTML Anchor Generator.
// Проверяют: неоднозначности, пустые/символьные ячейки, вложенные элементы,
// отсутствие таблиц, повторную обработку, статистику, безопасность,
// автоформатирование.

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

const { processInput, normalize, formatHTML } = window.HTMLAnchorCore;

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

// ---------------------------------------------------------------------------
console.log('\n=== E1. Нормализация: эмодзи + «Смартфон» + пунктуация ===');
{
  check('strip emoji + punctuation',
    normalize('🏆 Xiaomi, 17T'), 'xiaomi 17t');
  check('убирает Смартфон в начале',
    normalize('Смартфон Xiaomi, 17T'), 'xiaomi 17t');
  check('убирает телефон в конце',
    normalize('Xiaomi 17T Телефон'), 'xiaomi 17t');
  check('регистр не влияет',
    normalize('XIAOMI 17T'), normalize('xiaomi 17T'));
}

console.log('\n=== E2. Пустой вход — результат без изменений ===');
{
  const r = processInput('');
  check('matched = 0', r.stats.matched, 0);
  check('html = пустая строка', r.html, '');
  check('error = null', r.error, null);
}

console.log('\n=== E3. Нет таблиц — карточки не трогаются ===');
{
  const src = '<div><product-card><title>Xiaomi 17T</title></product-card></div>';
  const r = processInput(src);
  check('matched = 0', r.stats.matched, 0);
  checkTrue('карточка не получила ID (не сопоставлена)',
    !r.html.includes('id='), r.html);
}

console.log('\n=== E4. Пустая ячейка и ячейка-пробел не трогаются ===');
{
  const src = '<table><tbody><tr><td></td><td>   </td><td>Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title></product-card>';
  const r = processInput(src);
  const texts = extractTdTexts(r.html);
  checkTrue('пустая ячейка не тронута', texts[0] === '', texts.join('|'));
  checkTrue('ячейка-пробел не тронута', texts[1] === '   ', texts.join('|'));
  checkTrue('третья стала ссылкой', texts[2].indexOf('(#one)') !== -1, texts.join('|'));
  check('foundCells = 1 (только непустая)', r.stats.foundCells, 1);
}

console.log('\n=== E5. Ячейка с вложенными элементами, совпавшая с карточкой ===');
{
  const src = '<table><tbody><tr><td><strong>🏆 Xiaomi 17T</strong></td></tr></tbody></table>' +
    '<product-card><title>Смартфон Xiaomi, 17T</title></product-card>';
  const r = processInput(src);
  check('matched = 1', r.stats.matched, 1);
  checkTrue('textContent ячейки стал ссылкой',
    extractTdTexts(r.html)[0] === '{🏆 Xiaomi 17T}(#one)',
    extractTdTexts(r.html).join('|'));
}

console.log('\n=== E6. Статистика: несопоставленные и неоднозначные ===');
{
  const src = '<table><tbody>' +
    '<tr><td>Xiaomi 17T</td></tr>' +
    '<tr><td>Несуществующий товар</td></tr>' +
    '<tr><td>Ambiguous Phone</td></tr>' +
    '</tbody></table>' +
    '<product-card><title>Смартфон Xiaomi, 17T</title></product-card>' +
    '<product-card><title>Ambiguous Phone</title></product-card>' +
    '<product-card><title>Ambiguous Phone</title></product-card>';
  const r = processInput(src);
  check('matched = 1', r.stats.matched, 1);
  check('ambiguous = 2', r.stats.ambiguous, 2);
  check('foundCells = 3', r.stats.foundCells, 3);
}

console.log('\n=== E7. Добавление ID: пересчёт статистики added ===');
{
  const src = '<table><tbody><tr><td>Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title></product-card>';
  const r = processInput(src);
  check('added = 1', r.stats.added, 1);
  checkTrue('ID one', getCardIds(r.html).includes('one'));
}

console.log('\n=== E8. Повторная обработка: идемпотентность (много карточек) ===');
{
  const pairs = [
    ['Xiaomi 17T', 'Смартфон Xiaomi, 17T'],
    ['iQOO 15R', 'Смартфон iQOO, 15R'],
    ['Honor 600', 'Смартфон Honor, 600'],
  ];
  let rows = '';
  let cards = '';
  for (const [cell, title] of pairs) {
    rows += '<tr><td>' + cell + '</td></tr>';
    cards += '<product-card><title>' + title + '</title></product-card>';
  }
  const src = '<table><tbody>' + rows + '</tbody></table>' + cards;
  const once = processInput(src).html;
  const twice = processInput(once).html;
  const thrice = processInput(twice).html;
  checkTrue('второй прогон = первому', twice === once, '');
  checkTrue('третий прогон = первому', thrice === once, '');
  checkTrue('ID не задвоены',
    (getCards(twice).join('').match(/id="one"/g) || []).length === 1 &&
    (getCards(twice).join('').match(/id="two"/g) || []).length === 1);
}

console.log('\n=== E9. Нет карточек, есть таблица — не трогается ===');
{
  const src = '<table><tbody><tr><td>Xiaomi 17T</td><td>✅</td></tr></tbody></table>';
  const r = processInput(src);
  check('matched = 0', r.stats.matched, 0);
  check('cell без изменений', extractTdTexts(r.html).join('|'), 'Xiaomi 17T|✅');
}

console.log('\n=== E10. Существующий ID в другой карточке-нематч не переиспользуется ===');
{
  const src = '<product-card id="one"><title>Смартфон X, 1</title></product-card>' +
    '<table><tbody><tr><td>Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card><title>Смартфон Xiaomi, 17T</title></product-card>';
  const r = processInput(src);
  checkTrue('сопоставленная карточка получила two (one занят)',
    getCardIds(r.html).includes('two'), JSON.stringify(getCardIds(r.html)));
}

console.log('\n=== E11. Много одинаковых ячеек с одной карточкой ===');
{
  const src = '<table><tbody>' +
    '<tr><td>Xiaomi 17T</td></tr>' +
    '<tr><td>Xiaomi 17T</td></tr>' +
    '</tbody></table>' +
    '<product-card><title>Смартфон Xiaomi, 17T</title></product-card>';
  const r = processInput(src);
  const texts = extractTdTexts(r.html);
  checkTrue('обе ячейки на #one',
    texts[0].indexOf('(#one)') !== -1 && texts[1].indexOf('(#one)') !== -1,
    texts.join(' | '));
  check('matched = 2', r.stats.matched, 2);
}

console.log('\n=== E12. Карточка без <title> — пропускается ===');
{
  const src = '<table><tbody><tr><td>Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card><description>нет title</description></product-card>';
  const r = processInput(src);
  check('foundCards = 0', r.stats.foundCards, 0);
  check('matched = 0', r.stats.matched, 0);
}

console.log('\n=== E13. Карточка с пустым <title> — пропускается ===');
{
  const src = '<table><tbody><tr><td>Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card><title>   </title></product-card>';
  const r = processInput(src);
  check('foundCards = 0', r.stats.foundCards, 0);
}

console.log('\n=== E14. Ячейка уже с якорем, но карточка с другим ID ===');
{
  const src = '<table><tbody><tr><td>{Xiaomi 17T}(#zzz)</td></tr></tbody></table>' +
    '<product-card><title>Смартфон Xiaomi, 17T</title></product-card>';
  const r = processInput(src);
  checkTrue('якорь обновлён на #one',
    extractTdTexts(r.html)[0] === '{Xiaomi 17T}(#one)',
    extractTdTexts(r.html).join('|'));
}

console.log('\n=== E15. Защита: скрипты во входе не выполняются (parse-only) ===');
{
  const src = '<table><tbody><tr><td>Xiaomi 17T</td></tr></tbody></table>' +
    '<script>globalThis.__PWNED__ = true;</script>' +
    '<product-card><title>Смартфон Xiaomi, 17T</title></product-card>';
  const r = processInput(src);
  checkTrue('скрипт не выполнен (глобал не установлен)',
    globalThis.__PWNED__ === undefined);
  checkTrue('результат — строка', typeof r.html === 'string');
  delete globalThis.__PWNED__;
}

console.log('\n=== E16. Большой документ: 200 карточек не зависает ===');
{
  const N = 200;
  let rows = '';
  let cards = '';
  for (let i = 1; i <= N; i++) {
    const name = 'Model ' + i;
    rows += '<tr><td>' + name + '</td></tr>';
    cards += '<product-card><title>Смартфон ' + name + '</title></product-card>';
  }
  const src = '<table><tbody>' + rows + '</tbody></table>' + cards;
  const t0 = Date.now();
  const r = processInput(src);
  const elapsed = Date.now() - t0;
  check('matched = 200', r.stats.matched, 200);
  checkTrue('обработка быстрая (< 2000 мс)', elapsed < 2000, elapsed + ' мс');
  const texts = extractTdTexts(r.html);
  checkTrue('первый #one', texts[0].indexOf('(#one)') !== -1, texts[0]);
  checkTrue('последний #two-hundred', texts[N - 1].indexOf('(#two-hundred)') !== -1, texts[N - 1]);
}

console.log('\n=== E17. ID больше 99: numberToWords ===');
{
  const N = 120;
  let rows = '';
  let cards = '';
  for (let i = 1; i <= N; i++) {
    rows += '<tr><td>M' + i + '</td></tr>';
    cards += '<product-card><title>M' + i + '</title></product-card>';
  }
  const r = processInput('<table><tbody>' + rows + '</tbody></table>' + cards);
  const texts = extractTdTexts(r.html);
  checkTrue('120-й ID one-hundred-twenty',
    texts[119].indexOf('(#one-hundred-twenty)') !== -1, texts[119]);
}

console.log('\n=== E18. Обнаружение уже готового якоря с пробелами ===');
{
  const src = '<table><tbody><tr><td>  { Xiaomi 17T }  ( #one )  </td></tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title></product-card>';
  const r = processInput(src);
  checkTrue('не задваивается при пробелах внутри',
    extractTdTexts(r.html)[0].indexOf('({') === -1,
    extractTdTexts(r.html).join('|'));
}

console.log('\n=== E19. Автоформатирование: переносы и отступы ===');
{
  const src = '<table><tbody><tr><td>Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card><title>Смартфон Xiaomi, 17T</title></product-card>';
  const r = processInput(src);
  const fmt = formatHTML(r.html);
  checkTrue('есть переносы строк', fmt.indexOf('\n') !== -1);
  checkTrue('нет обёртки <html>', fmt.indexOf('<html') === -1);
  checkTrue('нет обёртки <head>', fmt.indexOf('<head') === -1);
  checkTrue('таблица на отдельной строке', fmt.indexOf('<table>') !== -1);
  checkTrue('каждый <tr> на своей строке', (fmt.match(/<tr>/g) || []).length === 1);
  // Якорь не повреждён форматированием.
  checkTrue('якорь сохранён', fmt.indexOf('{Xiaomi 17T}(#one)') !== -1, fmt);
  checkTrue('id сохранился', fmt.indexOf('id="one"') !== -1, fmt);
}

console.log('\n=== E20. Автоформатирование: идемпотентность ===');
{
  const src = '<table><tbody><tr><td>Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card><title>Смартфон Xiaomi, 17T</title></product-card>';
  const fmt1 = formatHTML(processInput(src).html);
  const fmt2 = formatHTML(fmt1);
  checkTrue('повторное форматирование не меняет результат', fmt1 === fmt2);
}

console.log('\n=== E21. Автоформатирование: строчные теги на одной строке ===');
{
  const src = '<p grade="primary">Para <strong>bold</strong> and <nobr>3D-графикой</nobr>.</p>';
  const fmt = formatHTML(src);
  checkTrue('p целиком на одной строке', fmt.indexOf('\n') === -1, fmt);
  checkTrue('inline-содержимое сохранено',
    fmt === '<p grade="primary">Para <strong>bold</strong> and <nobr>3D-графикой</nobr>.</p>',
    fmt);
}

console.log('\n=== E22. Автоформатирование: пустая строка между блоками ===');
{
  const src = '<author><description>за разумную экономию</description></author>' +
    '<lead>Тратить <nobr>60 000 ₽</nobr>.</lead>' +
    '<p grade="primary">Первый.</p><p grade="primary">Второй.</p>';
  const fmt = formatHTML(src);
  const expected = '<author>\n' +
    '  <description>за разумную экономию</description>\n' +
    '</author>\n' +
    '\n' +
    '<lead>Тратить <nobr>60 000 ₽</nobr>.</lead>\n' +
    '\n' +
    '<p grade="primary">Первый.</p>\n' +
    '\n' +
    '<p grade="primary">Второй.</p>';
  checkTrue('блоки разделены пустыми строками, author развёрнут', fmt === expected, fmt);
}

console.log('\n=== E23. Автоформатирование: details и product-card без пустых строк между внутр. блоками ===');
{
  const src = '<details><title>Как выбирал</title><p grade="primary">Первый.</p></details>' +
    '<product-card label="🏆"><image src="101"></image><title>X</title><description><p>desc</p></description></product-card>';
  const fmt = formatHTML(src);
  checkTrue('в details есть пустая строка между title и p',
    fmt.indexOf('<details>\n  <title>Как выбирал</title>\n\n  <p') !== -1, fmt);
  checkTrue('в product-card нет пустых строк между image/title/description',
    fmt.indexOf('<product-card label="🏆">\n  <image') !== -1 &&
    fmt.indexOf('</image>\n  <title>') !== -1 &&
    fmt.indexOf('</title>\n  <description>') !== -1, fmt);
}

console.log('\n=== E24. Поиск по вхождению: дополнительные слова в карточке ===');
{
  // «Премиум» — не стоп-слово, поэтому точного совпадения нет, работает containment.
  const src = '<table><tbody><tr><td>Xreal 1S</td></tr></tbody></table>' +
    '<product-card><title>Премиум AR-очки Xreal 1S</title></product-card>';
  const r = processInput(src);
  check('matched = 1', r.stats.matched, 1);
  checkTrue('якорь {Xreal 1S}(#one)',
    extractTdTexts(r.html)[0] === '{Xreal 1S}(#one)',
    extractTdTexts(r.html).join('|'));
  checkTrue('карточка id="one"', getCardIds(r.html).includes('one'));
}

console.log('\n=== E25. Вхождение: полный документ с 8 моделями AR-очков ===');
{
  const cells = [
    '🏆 <span comment-id="x">Xreal 1S</span>',
    'Xreal One',
    'Viture Luma Ultra',
    '👵 Xreal Air 2 Pro',
    'Viture Pro 2',
    '🔋Rokid Glasses',
    '💎 RayNeo X3 Pro',
    'Meta* Ray-Ban Display',
  ];
  const titles = [
    'AR-очки Xreal, 1S',
    'AR-очки Xreal, One',
    'AR-очки Viture, Luma Ultra',
    'AR-очки Xreal, Air 2  Pro',
    'AR-очки Viture, Pro 2',
    'AR-очки Rokid, Glasses',
    'AR-очки RayNeo, X3 Pro',
    'AR-очки Meta*, Ray-Ban Display',
  ];
  let rows = '';
  let cards = '';
  for (let i = 0; i < cells.length; i++) {
    rows += '<tr><td>' + cells[i] + '</td></tr>';
    cards += '<product-card><title>' + titles[i] + '</title></product-card>';
  }
  const r = processInput('<table><tbody>' + rows + '</tbody></table>' + cards);
  check('matched = 8', r.stats.matched, 8);
  check('ambiguous = 0', r.stats.ambiguous, 0);
  const ids = getCardIds(r.html);
  const words = ['one','two','three','four','five','six','seven','eight'];
  checkTrue('ID one..eight', JSON.stringify(ids) === JSON.stringify(words), JSON.stringify(ids));
  const texts = extractTdTexts(r.html);
  checkTrue('1-я ячейка → #one', texts[0].indexOf('(#one)') !== -1, texts[0]);
  checkTrue('8-я ячейка → #eight', texts[7].indexOf('(#eight)') !== -1, texts[7]);
}

console.log('\n=== E26. Вхождение не срабатывает на коротком токене (< 2 слов) ===');
{
  // Ячейка из одного значимого слова не должна сопоставляться по вхождению.
  const src = '<table><tbody><tr><td>Xreal</td></tr></tbody></table>' +
    '<product-card><title>AR-очки Xreal, 1S</title></product-card>';
  const r = processInput(src);
  check('matched = 0', r.stats.matched, 0);
}

console.log('\n=== E27. Неоднозначность при вхождении ===');
{
  // Две карточки содержат токены «Rokid Glasses» (слова «Premium» и «Plus»
  // не стоп-слова → точного совпадения нет, обе подходят по вхождению).
  const src = '<table><tbody><tr><td>Rokid Glasses</td></tr></tbody></table>' +
    '<product-card><title>Premium AR-очки Rokid Glasses</title></product-card>' +
    '<product-card><title>AR-очки Rokid Glasses Plus</title></product-card>';
  const r = processInput(src);
  check('matched = 0 (неоднозначно)', r.stats.matched, 0);
  check('ambiguous = 1', r.stats.ambiguous, 1);
}

console.log('\n=== E28. Точное совпадение имеет приоритет над вхождением ===');
{
  const src = '<table><tbody><tr><td>Xreal 1S</td></tr></tbody></table>' +
    '<product-card><title>Xreal 1S</title></product-card>' +
    '<product-card><title>Premium Xreal 1S</title></product-card>';
  const r = processInput(src);
  check('matched = 1 (точное совпадение)', r.stats.matched, 1);
  checkTrue('сопоставлена карточка с точным title',
    getCards(r.html).join('').includes('<title>Xreal 1S</title>'));
}

console.log('\n=== E29. Вхождение для готового якоря с изменённым текстом ===');
{
  const src = '<table><tbody><tr><td>{Xreal One}(#old)</td></tr></tbody></table>' +
    '<product-card><title>AR-очки Xreal, One</title></product-card>';
  const r = processInput(src);
  check('matched = 1', r.stats.matched, 1);
  checkTrue('якорь обновлён на #one',
    extractTdTexts(r.html)[0] === '{Xreal One}(#one)',
    extractTdTexts(r.html).join('|'));
}

// ---------------------------------------------------------------------------
console.log('\n=== E30. Сохранение вложенных тегов ячейки (comment-id) ===');
{
  // Реальный случай: span с атрибутом comment-id внутри ячейки.
  const src = '<table><tbody><tr><td>🏆 <span comment-id="ycI2">Xreal 1S</span></td></tr></tbody></table>' +
    '<product-card><title>AR-очки Xreal, 1S</title></product-card>';
  const r = processInput(src);
  const d = new window.DOMParser().parseFromString(r.html, 'text/html');
  const td = d.querySelector('td');
  check('matched = 1', r.stats.matched, 1);
  checkTrue('span сохранён', d.querySelector('td span') !== null);
  checkTrue('comment-id сохранён', r.html.includes('comment-id="ycI2"'), r.html);
  checkTrue('textContent ячейки — корректный якорь',
    td.textContent === '{🏆 Xreal 1S}(#one)', td.textContent);
}

console.log('\n=== E31. Идемпотентность сохраняет вложенные теги ячейки ===');
{
  const src = '<table><tbody><tr><td>🏆 <span comment-id="ycI2">Xreal 1S</span></td></tr></tbody></table>' +
    '<product-card><title>AR-очки Xreal, 1S</title></product-card>';
  const once = processInput(src).html;
  const twice = processInput(once).html;
  checkTrue('span сохранён после 2-го прогона',
    twice.includes('comment-id="ycI2"'), twice);
  checkTrue('якорь не задвоен', !twice.includes('(#{'), twice);
}

console.log('\n=== E32. Самозакрывающийся <image/> не ломает следующий <image></image> ===');
{
  const src = '<product-card><image src="a"/><title>X</title><image src="b"></image></product-card>';
  const r = processInput(src);
  checkTrue('оба image сохранены', r.html.includes('src="a"') && r.html.includes('src="b"'), r.html);
  checkTrue('нет обрывочного закрывающего тега', !/<image[^>]*\/><\/image>/.test(r.html), r.html);
}

console.log('\n=== E33. Ячейка с «сырыми» скобками {…} без якоря не задваивается ===');
{
  const src = '<table><tbody><tr><td>{Xiaomi 17T}</td></tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title></product-card>';
  const r = processInput(src);
  check('matched = 1', r.stats.matched, 1);
  const text = extractTdTexts(r.html)[0];
  checkTrue('якорь ровно один (нет {{)', !text.includes('{{') && text.includes('(#one)'), text);
  checkTrue('результат {Xiaomi 17T}(#one)',
    text === '{Xiaomi 17T}(#one)', text);
}

console.log('\n=== E34. Готовый якорь с вложенным тегом в {…} сохраняет разметку ===');
{
  const src = '<table><tbody><tr><td>{<span>Xreal 1S</span>}(#old)</td></tr></tbody></table>' +
    '<product-card><title>AR-очки Xreal, 1S</title></product-card>';
  const r = processInput(src);
  check('matched = 1', r.stats.matched, 1);
  checkTrue('span сохранён', r.html.includes('<span>'), r.html);
  checkTrue('ID обновлён на #one', extractTdTexts(r.html)[0] === '{Xreal 1S}(#one)', extractTdTexts(r.html)[0]);
  checkTrue('не задвоен', !r.html.includes('{{'), r.html);
}

console.log('\n=== E35. Санитизация: обработчики событий удаляются ===');
{
  const src = '<table><tbody><tr><td><img src="x" onerror="alert(1)"> Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title></product-card>';
  const r = processInput(src);
  check('matched = 1', r.stats.matched, 1);
  checkTrue('onerror удалён', !r.html.includes('onerror'), r.html);
  checkTrue('безопасный тег сохранён', r.html.includes('<img src="x">'), r.html);
}

console.log('\n=== E36. Санитизация: javascript: URL удаляется, обычные атрибуты остаются ===');
{
  const src = '<table><tbody><tr><td><a href="javascript:alert(1)" class="ok">Xiaomi 17T</a></td></tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title></product-card>';
  const r = processInput(src);
  check('matched = 1', r.stats.matched, 1);
  checkTrue('javascript: href удалён', !r.html.includes('javascript:'), r.html);
  checkTrue('class сохранён', r.html.includes('class="ok"'), r.html);
}

console.log('\n=== E37. Санитизация: безопасный href и comment-id сохраняются ===');
{
  const safe = '<table><tbody><tr><td><a href="https://example.com">Xiaomi 17T</a></td></tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title></product-card>';
  checkTrue('https href сохранён', processInput(safe).html.includes('https://example.com'));

  const cid = '<table><tbody><tr><td>🏆 <span comment-id="ycI2">Xreal 1S</span></td></tr></tbody></table>' +
    '<product-card><title>AR-очки Xreal, 1S</title></product-card>';
  checkTrue('comment-id сохранён', processInput(cid).html.includes('comment-id="ycI2"'));
}

console.log('\n=== E38. changedLinks: новые и изменённые якоря ===');
{
  // Новый якорь попадает в changedLinks.
  let r = processInput('<table><tbody><tr><td>Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title></product-card>');
  checkTrue('новый якорь в changedLinks',
    Array.isArray(r.changedLinks) && r.changedLinks.length === 1 &&
    r.changedLinks[0] === '{Xiaomi 17T}(#one)',
    JSON.stringify(r.changedLinks));

  // Изменённый ID (#zzz -> #one) попадает в changedLinks.
  r = processInput('<table><tbody><tr><td>{Xiaomi 17T}(#zzz)</td></tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title></product-card>');
  checkTrue('изменённый ID в changedLinks',
    Array.isArray(r.changedLinks) && r.changedLinks[0] === '{Xiaomi 17T}(#one)',
    JSON.stringify(r.changedLinks));

  // Уже правильный якорь — НЕ попадает в changedLinks (пусто).
  r = processInput('<table><tbody><tr><td>{Xiaomi 17T}(#one)</td></tr></tbody></table>' +
    '<product-card><title>Xiaomi 17T</title></product-card>');
  checkTrue('правильный якорь не помечен',
    Array.isArray(r.changedLinks) && r.changedLinks.length === 0,
    JSON.stringify(r.changedLinks));
}

// ---------------------------------------------------------------------------
console.log('\n==========================================');
console.log('Результат: ' + passed + ' PASS, ' + failed + ' FAIL');
if (failures.length) {
  console.log('\nПроваленные проверки:');
  failures.forEach((f) => console.log('  - ' + f.name));
}
process.exit(failed ? 1 : 0);