'use strict';
// Интеграционный тест UI-логики (script.js, интерфейсная часть).
// Загружает реальный index.html + script.js в jsdom и проверяет:
// обработку ввода, подсветку id, очистку при пустом поле, копирование,
// мгновенную очистку правого поля.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name); console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://localhost/',
});
const { window } = dom;
const { document } = window;

new Function('window', 'document', 'DOMParser', 'module', script)(
  window, document, window.DOMParser, undefined
);

const inputEl = document.getElementById('input');
const outputEl = document.getElementById('output');
const statsEl = document.getElementById('stats');
const copyBtn = document.getElementById('copyBtn');
const clearBtn = document.getElementById('clearBtn');
const outputHighlightEl = document.getElementById('outputHighlight');

function type(text) {
  inputEl.value = text;
  inputEl.dispatchEvent(new window.Event('input', { bubbles: true }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  console.log('=== UI. Базовая разметка ===');
  check('есть input', !!inputEl);
  check('есть output', !!outputEl);
  check('нет overlay у левого поля (inputHighlight удалён)',
    !document.getElementById('inputHighlight'));
  check('input имеет placeholder', inputEl.getAttribute('placeholder') === 'Вставьте HTML-код сюда...');
  check('output readonly', outputEl.getAttribute('readonly') !== null);

  console.log('\n=== UI. Overlay правого поля ===');
  check('input внутри .code-wrap', !!inputEl.closest('.code-wrap'));
  check('output внутри .code-wrap', !!outputEl.closest('.code-wrap'));
  check('есть overlay результата (#outputHighlight)', !!outputHighlightEl);

  console.log('\n=== UI. Подсветка нового кода в правом поле ===');
  type('<table><tbody><tr><td>Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card><title>Смартфон Xiaomi, 17T</title></product-card>');
  await sleep(450); // ждём debounce (300мс)
  check('новый якорь {Xiaomi 17T}(#one) подсвечен hl-changed',
    !!outputHighlightEl &&
      outputHighlightEl.innerHTML.indexOf('<span class="hl-changed">{Xiaomi 17T}(#one)</span>') !== -1,
    outputHighlightEl && outputHighlightEl.innerHTML);
  check('новый id="one" на карточке подсвечен hl-changed',
    !!outputHighlightEl &&
      outputHighlightEl.innerHTML.indexOf('<span class="hl-changed">id="one"</span>') !== -1,
    outputHighlightEl && outputHighlightEl.innerHTML);

  // Существующий (уже готовый) якорь и id не меняются — не подсвечиваются.
  type('<table><tbody><tr><td>{Xiaomi 17T}(#one)</td></tr></tbody></table>' +
    '<product-card id="one"><title>Смартфон Xiaomi, 17T</title></product-card>');
  await sleep(450);
  check('уже готовый якорь и id не подсвечены (нет hl-changed)',
    !!outputHighlightEl && outputHighlightEl.innerHTML.indexOf('hl-changed') === -1,
    outputHighlightEl && outputHighlightEl.innerHTML);

  console.log('\n=== UI. Обработка и мгновенная очистка ===');
  type('<table><tbody><tr><td>Xiaomi 17T</td></tr></tbody></table>' +
    '<product-card><title>Смартфон Xiaomi, 17T</title></product-card>');
  await sleep(450); // ждём debounce (300мс)
  check('после ввода output не пуст', outputEl.value !== '');
  check('output содержит якорь (#one)', outputEl.value.indexOf('(#one)') !== -1, outputEl.value);

  type('');
  check('output очищен мгновенно', outputEl.value === '');
  check('overlay результата очищен', !outputHighlightEl || outputHighlightEl.innerHTML === '');
  check('stats — приглашение', statsEl.textContent === 'Вставьте HTML-код, чтобы увидеть результат.');

  console.log('\n=== UI. Кнопка «Очистить» ===');
  type('<table><tbody><tr><td>X</td></tr></tbody></table>');
  clearBtn.click();
  check('input пуст после Очистить', inputEl.value === '');
  check('output пуст', outputEl.value === '');
  check('overlay результата очищен', !outputHighlightEl || outputHighlightEl.innerHTML === '');

  console.log('\n==========================================');
  console.log('Результат: ' + pass + ' PASS, ' + fail + ' FAIL');
  if (fails.length) {
    console.log('\nПроваленные:');
    fails.forEach((f) => console.log('  - ' + f));
  }
  process.exit(fail ? 1 : 0);
})();