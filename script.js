'use strict';

// ===========================================================================
// ЯДРО (чистые функции, без зависимостей от DOM браузера).
// Используется и в браузере, и в тестах (Node + эмуляция DOM).
// ===========================================================================

// Удаляем только эмодзи и символы-пиктограммы. Для сравнения.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{2B50}\u{FE0F}\u{200D}\u{20E3}]/gu;

function stripEmoji(text) {
  return text.replace(EMOJI_RE, '');
}

// Родовые слова, которые не несут смысла при сопоставлении и удаляются
// из нормализованной строки в любом положении (в начале, середине, конце).
const STOPWORDS = new Set([
  'смартфон', 'смартфоны', 'телефон', 'телефоны',
  'smartphone', 'smartphones', 'phone', 'phones',
  'аппарат', 'устройство', 'гаджет', 'модель',
  'очки', 'ar', 'vr', 'mr',
]);

// Оптимальное сопоставление. Только для сравнения: исходный текст ячейки
// и <title> не изменяются. Убираем эмодзи, регистр, пунктуацию и родовые
// слова-приставки, чтобы «🏆 Xiaomi 17T» и «Смартфон Xiaomi, 17T» считались
// совпадающими.
function normalize(text) {
  const cleaned = stripEmoji(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')  // пунктуация -> пробел
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return '';

  return cleaned
    .split(' ')
    .filter(function (w) { return w !== '' && !STOPWORDS.has(w); })
    .join(' ');
}

// Минимальное число значимых токенов в ячейке для поиска по вхождению.
// Защищает от ложных срабатываний: одна короткая метка (например, «Xreal»)
// не должна сопоставляться сразу со всеми карточками, где она встречается.
const MIN_CONTAIN_TOKENS = 2;

// Множество токенов нормализованной строки. Нормализованная строка уже
// приведена к регистру и очищена, токены разделены пробелами.
function tokenSet(normalized) {
  if (normalized === '') return new Set();
  return new Set(normalized.split(' '));
}

// Входит ли каждое подмножество токенов в надмножество.
function tokensContain(sub, sup) {
  for (const t of sub) {
    if (!sup.has(t)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Генерация последовательных ID словами: one, two, three, ...
// ---------------------------------------------------------------------------
const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numberToWords(n) {
  if (n < 20) return NUMBER_WORDS[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    return TENS[t] + (r ? '-' + NUMBER_WORDS[r] : '');
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    return NUMBER_WORDS[h] + '-hundred' + (rest ? '-' + numberToWords(rest) : '');
  }
  return 'number-' + n; // запасной вариант для очень больших чисел
}

// Распознавание уже готовой Markdown-ссылки {текст}(#id) по текстовому
// содержимому ячейки. label — текст внутри фигурных скобок (без тегов),
// используется только для сопоставления с карточкой.
function parseMarkdownLink(text) {
  const m = /^\s*\{([\s\S]*?)\}\s*\(\s*#([A-Za-z0-9_-]+)\s*\)\s*$/.exec(text);
  if (!m) return null;
  return { label: m[1].trim(), id: m[2] };
}

// Сканирует разметку, игнорируя содержимое HTML-тегов (атрибуты могут
// содержать { }), и возвращает позиции первой '{' и соответствующей ей '}'.
function findBraceBounds(innerHTML) {
  const s = String(innerHTML).trim();
  let braceOpen = null;
  let braceClose = null;
  let inTag = false;
  let inQuote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inTag) {
      if (inQuote) {
        if (ch === inQuote) inQuote = null;
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === '>') {
        inTag = false;
      }
      continue;
    }
    if (ch === '<') { inTag = true; continue; }
    if (ch === '{' && braceOpen === null) { braceOpen = i; continue; }
    if (ch === '}' && braceOpen !== null) { braceClose = i; break; }
    // Любой текст вне тегов до '{' — не якорь и не скобочная метка.
    if (braceOpen === null) return null;
  }
  if (braceOpen === null || braceClose === null) return null;
  return { braceOpen: braceOpen, braceClose: braceClose };
}

// Является ли ВСЯ разметка ячейки уже готовым якорем {…}(#id)?
function isExistingAnchor(innerHTML) {
  const bounds = findBraceBounds(innerHTML);
  if (!bounds) return false;
  const s = String(innerHTML).trim();
  const tail = s.slice(bounds.braceClose + 1);
  return /^\s*\(\s*#[A-Za-z0-9_-]+\s*\)\s*$/.test(tail);
}

// Обёрнута ли вся разметка ячейки в «сырые» скобки {…} без якоря (нет "(#id)")?
// Такое встречается при ручном вводе / старых данных. Чтобы не получить
// двойную обёртку {{…}}(#id), скобки при записи не дублируем.
function looksLikeBracedLabel(innerHTML) {
  const bounds = findBraceBounds(innerHTML);
  if (!bounds) return false;
  const s = String(innerHTML).trim();
  // { находится в самом начале (до него — только пробелы), '}' — в самом конце.
  if (s.slice(0, bounds.braceOpen).trim() !== '') return false;
  if (bounds.braceClose !== s.length - 1) return false;
  // Это не готовый якорь (нет хвоста "(#id)").
  return true;
}

// Санитизация разметки ячейки перед записью якоря: убирает опасные
// атрибуты-обработчики событий (onclick, onerror, ...) и опасные URL-схемы
// (javascript:, vbscript:, data:) в атрибутах href/src. Безопасное содержимое
// (текст, вложенные span/strong и их обычные атрибуты) сохраняется.
const DANGEROUS_ATTR_RE = /^on[a-z0-9_-]+$/i;
const DANGEROUS_URL_RE = /^\s*(?:javascript|vbscript|data)\s*:/i;
const SAFE_URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'background']);

function sanitizeMarkup(html) {
  if (typeof html !== 'string' || html === '') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (doc.querySelector('parsererror')) return html; // не трогаем неразбираемое

  const all = Array.from(doc.body.querySelectorAll('*'));
  for (const el of all) {
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      const name = attr.name;
      const value = attr.value;
      // 1) Обработчики событий — удаляем целиком.
      if (DANGEROUS_ATTR_RE.test(name)) {
        el.removeAttribute(name);
        continue;
      }
      // 2) Опасные URL-схемы в href/src и т.п. — удаляем атрибут.
      if (SAFE_URL_ATTRS.has(name.toLowerCase()) && DANGEROUS_URL_RE.test(value)) {
        el.removeAttribute(name);
      }
    }
  }
  return doc.body.innerHTML;
}

// ---------------------------------------------------------------------------
// Автоформатирование HTML: расставляет переносы и отступы, чтобы результат
// было удобно читать. Не меняет содержимое текстовых узлов (якоря, описания).
// ---------------------------------------------------------------------------
const VOID_TAGS = new Set([
  'br', 'hr', 'img', 'input', 'meta', 'link', 'source',
]);

// Блочные теги: разбиваются на строки, ЕСЛИ содержат вложенный блочный
// элемент. Тег с только строчным содержимым (текст + strong/nobr/tooltip)
// выводится одной строкой. Это позволяет, например, <description> с <p>
// развернуть в несколько строк, а сам <p> оставить в одну строку.
const BLOCK_TAGS = new Set([
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'caption',
  'product-card', 'description', 'price', 'image',
  'author', 'div', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'section', 'article', 'aside', 'header', 'footer', 'nav', 'main',
  'details', 'summary', 'panel',
  'feature', 'blockquote', 'pre', 'hr', 'figure', 'figcaption',
  'p', 'lead', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th',
]);

// Контейнеры, внутри которых блочные элементы НЕ разделяются пустой строкой:
// табличная структура и карточка товара. В остальных блочных контейнерах
// (details, author, верхний уровень и т.д.) между блоками — пустая строка.
const NO_BLANK_SET = new Set([
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'product-card',
]);

function elementToString(el) {
  const name = el.tagName.toLowerCase();
  let attrs = '';
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    attrs += ' ' + a.name + '="' + a.value + '"';
  }
  return '<' + name + attrs + '>';
}

// Сериализует строчное (inline) содержимое элемента в одну строку:
// текст и вложенные строчные теги (strong, nobr, tooltip, ...).
// Возвращает пустую строку, если элемента нет.
function inlineContent(el) {
  let out = '';
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i];
    if (c.nodeType === 3) {
      out += c.nodeValue;
    } else if (c.nodeType === 1) {
      const cname = c.tagName.toLowerCase();
      out += elementToString(c);
      if (!VOID_TAGS.has(cname)) {
        out += inlineContent(c) + '</' + cname + '>';
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Защита тегов <image> от переписывания парсером в <img>.
// По HTML-спецификации <image> считается псевдонимом <img>, поэтому парсер
// (DOMParser/jsdom) молча превращает <image …></image> в <img …>. Чтобы
// сохранить исходные <image>, на время разбора подменяем их на безопасные
// текстовые плейсхолдеры, а после сериализации восстанавливаем — всегда в
// парном виде <image …></image>.
// ---------------------------------------------------------------------------
const IMAGE_TOKEN = '\uE000IMG\uE000';
const IMAGE_OPEN_RE = /<image\b([^>]*)>/gi;

function collectImages(html) {
  const saved = [];
  const parts = [];
  let last = 0;
  let seq = 0;
  let m;
  IMAGE_OPEN_RE.lastIndex = 0;
  while ((m = IMAGE_OPEN_RE.exec(html)) !== null) {
    let attrs = m[1];
    let end = m.index + m[0].length;

    // Самозакрывающийся <image …/> — не ищем парный </image> (иначе можем
    // «проглотить» следующий <image …></image>), просто убираем косую черту.
    if (/\/\s*$/.test(attrs)) {
      attrs = attrs.replace(/\/\s*$/, '');
    } else {
      // Парный <image …></image> — пропускаем содержимое до </image>.
      const closing = html.indexOf('</image>', end);
      if (closing !== -1) {
        end = closing + '</image>'.length;
      }
    }

    parts.push(html.slice(last, m.index));
    saved.push('<image' + attrs + '></image>');
    parts.push(IMAGE_TOKEN + seq + IMAGE_TOKEN);
    seq++;
    last = end;
    IMAGE_OPEN_RE.lastIndex = end;
  }
  parts.push(html.slice(last));
  return { text: parts.join(''), saved: saved };
}

function restoreImages(html, saved) {
  return html.replace(
    new RegExp(IMAGE_TOKEN + '(\\d+)' + IMAGE_TOKEN, 'g'),
    function (_, i) { return saved[Number(i)]; }
  );
}

// Форматирует элемент:
//  - строчные (не BLOCK) теги и элементы без блочных потомков выводятся
//    одной строкой вместе с inline-содержимым;
//  - блочные элементы разбиваются на строки с отступами.
// Возвращает массив строк, занимаемых блоком (обычно несколько строк).
function formatNode(el, level) {
  const name = el.tagName.toLowerCase();
  const open = elementToString(el);

  if (VOID_TAGS.has(name)) {
    return [pad(level) + open];
  }

  // Элементы без блочных потомков — компактная строчная строка.
  if (!BLOCK_TAGS.has(name) || !hasBlockChild(el)) {
    return [pad(level) + open + inlineContent(el) + '</' + name + '>'];
  }

  // Блочный элемент: собираем вложенные строки.
  const lines = [pad(level) + open];
  const blank = NO_BLANK_SET.has(name) ? false : true;
  let prev = null; // предыдущий добавленный значимый блок (для пустых строк)

  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i];
    let blockLines;
    if (c.nodeType === 1) {
      blockLines = formatNode(c, level + 1);
    } else if (c.nodeType === 3) {
      const t = c.nodeValue.trim();
      if (t === '') continue;
      blockLines = [pad(level + 1) + t];
    } else {
      continue;
    }

    // Между значимыми блоками — пустая строка (если не запрещена).
    if (blank && prev !== null) lines.push('');
    for (const l of blockLines) lines.push(l);
    prev = blockLines;
  }

  lines.push(pad(level) + '</' + name + '>');
  return lines;
}

function pad(level) {
  return '  '.repeat(level);
}

// Есть ли среди дочерних узлов элемент с блочной разметкой?
function hasBlockChild(el) {
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i];
    if (c.nodeType !== 1) continue;
    const cn = c.tagName.toLowerCase();
    if (BLOCK_TAGS.has(cn)) return true;
  }
  return false;
}

// Вход: строка HTML. Возвращает отформатированную строку (без обёрток
// <html>/<head>/<body> — только содержимое документа).
function formatHTML(source) {
  const guarded = collectImages(source);
  let doc;
  try {
    doc = new DOMParser().parseFromString(guarded.text, 'text/html');
  } catch (err) {
    return source;
  }
  if (doc.querySelector('parsererror')) return source;

  const body = doc.body;
  const lines = [];
  let prev = null;
  for (let i = 0; i < body.childNodes.length; i++) {
    const n = body.childNodes[i];
    let blockLines;
    if (n.nodeType === 1) {
      blockLines = formatNode(n, 0);
    } else if (n.nodeType === 3) {
      const t = n.nodeValue.trim();
      if (t === '') continue;
      blockLines = [t];
    } else {
      continue;
    }

    // Пустая строка между блочными элементами верхнего уровня.
    if (prev !== null) lines.push('');
    for (const l of blockLines) lines.push(l);
    prev = blockLines;
  }
  return restoreImages(lines.join('\n'), guarded.saved);
}

// Основной алгоритм обработки HTML.
function processInput(source) {
  source = String(source);

  // Сохраняем теги <image>, чтобы парсер не превращал их в <img>.
  const guarded = collectImages(source);
  let parseSrc = guarded.text;
  let doc;
  try {
    doc = new DOMParser().parseFromString(parseSrc, 'text/html');
  } catch (err) {
    return { html: source, error: 'Не удалось разобрать HTML.' };
  }

  if (doc.querySelector('parsererror')) {
    return { html: source, error: 'Некорректный HTML: не удалось разобрать документ.' };
  }

  const cards = Array.from(doc.querySelectorAll('product-card'));
  const cells = Array.from(doc.querySelectorAll('td'));

  // Сопоставление: точное совпадение -> нормализованный текст -> массив карточек;
  // плюс список всех карточек (для поиска по вхождению).
  const cardMap = new Map();   // norm -> [cards] (точное совпадение)
  const allCards = [];         // { card, norm, tokens } для containment
  let foundCards = 0;
  for (const card of cards) {
    const titleEl = card.querySelector('title');
    if (!titleEl) continue;
    const titleText = titleEl.textContent;
    if (titleText.trim() === '') continue;
    const norm = normalize(titleText);
    if (norm === '') continue;
    foundCards++;
    if (!cardMap.has(norm)) cardMap.set(norm, []);
    cardMap.get(norm).push(card);
    allCards.push({ card: card, norm: norm, tokens: tokenSet(norm) });
  }

  // Поиск карточки по вхождению: значимые токены ячейки полностью входят
  // в значимые токены title карточки. Возвращает карточку только при
  // однозначном совпадении (ровно одна подходящая карточка).
  function findContainedCard(cellTokens) {
    if (cellTokens.size < MIN_CONTAIN_TOKENS) return null;
    const matches = [];
    for (const entry of allCards) {
      if (tokensContain(cellTokens, entry.tokens)) matches.push(entry.card);
      if (matches.length > 1) return null; // неоднозначно
    }
    return matches.length === 1 ? matches[0] : null;
  }

  let foundCells = 0;   // потенциальные названия (непустые после нормализации)
  let matched = 0;      // успешно сопоставленные ячейки
  let unmatched = 0;    // несопоставленные или неоднозначные ячейки

  // Проход 1: сопоставляем ячейки с карточками.
  const cellCard = new Map();     // ячейка -> карточка
  const cellHTML = new Map();     // ячейка -> исходный innerHTML (для оборачивания)
  const existingCells = new Set(); // ячейки, где якорь уже был готов
  for (const cell of cells) {
    const rawText = cell.textContent;
    const rawHTML = cell.innerHTML;

    let card = null;
    // Определяем готовый якорь по разметке (учитывает вложенные теги в {…}).
    if (isExistingAnchor(rawHTML)) {
      const existing = parseMarkdownLink(rawText);
      const normLabel = existing ? normalize(existing.label) : '';
      const cand = normLabel === '' ? [] : (cardMap.get(normLabel) || []);
      if (cand.length === 1) {
        card = cand[0];
        cellHTML.set(cell, rawHTML);
        existingCells.add(cell);
      } else {
        // Точного совпадения нет — пробуем вхождение (например, якорь уже
        // отредактирован или текст чуть отличается).
        card = findContainedCard(tokenSet(normLabel));
        if (card) {
          cellHTML.set(cell, rawHTML);
          existingCells.add(cell);
        }
      }
    } else {
      const norm = normalize(rawText);
      if (norm === '') continue; // пустые и символьные (✅/❌) ячейки
      foundCells++;
      const cand = cardMap.get(norm);
      if (cand && cand.length === 1) {
        card = cand[0];
        cellHTML.set(cell, rawHTML);
      } else {
        // Точного совпадения нет — пробуем вхождение.
        card = findContainedCard(tokenSet(norm));
        if (card) cellHTML.set(cell, rawHTML);
      }
    }

    if (card) {
      cellCard.set(cell, card);
      matched++;
    } else {
      unmatched++;
    }
  }

  // Карточки, сопоставленные хотя бы с одной ячейкой (будут перенумерованы).
  const renumbered = [];
  for (const card of cards) {
    let isMatched = false;
    for (const c of cellCard.values()) {
      if (c === card) { isMatched = true; break; }
    }
    if (isMatched) renumbered.push(card);
  }

  // Все существующие ID в документе, КРОМЕ собственных ID перенумеруемых
  // карточек (их текущие ID будут перезаписаны новыми последовательными).
  const existingIds = new Set();
  doc.querySelectorAll('[id]').forEach((el) => {
    if (el.id) existingIds.add(el.id);
  });
  for (const card of renumbered) {
    const own = card.getAttribute('id');
    if (own) existingIds.delete(own);
  }

  // Проход 2: перенумеровываем ВСЕ сопоставленные карточки последовательно
  // (one, two, three, ...) по порядку их появления в документе.
  const cardId = new Map();  // карточка -> новый ID
  const changedIds = new Set(); // ID, которые были изменены или добавлены
  let n = 1;

  for (const card of renumbered) {
    const prevId = card.getAttribute('id');
    let id;
    do {
      id = numberToWords(n);
      n++;
    } while (existingIds.has(id));
    existingIds.add(id);
    cardId.set(card, id);

    if (!prevId || prevId !== id) changedIds.add(id);
  }

  // Обновляем содержимое сопоставленных ячеек и ID карточек.
  // Сохраняем исходную разметку ячейки (вложенные теги, атрибуты, эмодзи),
  // оборачивая её в {…}(#id), а не перезаписывая textContent.
  const changedCells = new Set(); // ячейки, чей якорь добавлен или ID изменён
  for (const [cell, card] of cellCard) {
    const id = cardId.get(card);
    // Санитизируем разметку ячейки (убираем on* и опасные URL), сохраняя
    // безопасное содержимое и обычные атрибуты.
    const inner = sanitizeMarkup(cellHTML.get(cell));
    if (existingCells.has(cell)) {
      // Якорь уже был готов: заменяем только ID, сохраняя разметку
      // (вложенные теги/атрибуты внутри {…} не трогаем).
      const oldIdMatch = /\}\s*\(\s*#[A-Za-z0-9_-]+\s*\)\s*$/.exec(inner);
      const oldTail = oldIdMatch ? oldIdMatch[0] : null;
      cell.innerHTML = inner.replace(/\}\s*\(\s*#[A-Za-z0-9_-]+\s*\)\s*$/, '}(#' + id + ')');
      if (!oldTail || oldTail !== '}(#' + id + ')') changedCells.add(cell);
    } else if (looksLikeBracedLabel(inner)) {
      // Ячейка уже в «сырых» скобках {…} (без якоря) — не дублируем скобки.
      cell.innerHTML = inner + '(#' + id + ')';
      changedCells.add(cell);
    } else {
      cell.innerHTML = '{' + inner + '}(#' + id + ')';
      changedCells.add(cell);
    }
  }

  for (const card of cardId.keys()) {
    card.setAttribute('id', cardId.get(card));
  }

  let html = source;
  if (matched > 0) {
    html = restoreImages(doc.documentElement.innerHTML, guarded.saved);
  }

  // Полная разметка изменённых ячеек (новый/изменённый якорь) — для
  // подсветки в интерфейсе. Берём cell.innerHTML, чтобы совпадать с тем,
  // что реально попадает в результат: вложенные теги (<span comment-id>,
  // <strong> и т.п.) сохраняются, и подсветка находится по точному виду.
  const changedLinks = [];
  for (const cell of changedCells) {
    changedLinks.push(cell.innerHTML);
  }

  // Полные атрибуты id="…", добавленные или изменённые на карточках —
  // тоже часть нового кода и подсвечиваются в интерфейсе.
  const changedIdAttrs = [];
  for (const id of changedIds) {
    changedIdAttrs.push('id="' + id + '"');
  }

  return {
    html: html,
    error: null,
    stats: {
      foundCards: foundCards,
      foundCells: foundCells,
      matched: matched,
      added: changedIds.size,
      ambiguous: unmatched,
    },
    changedLinks: changedLinks,
    changedIdAttrs: changedIdAttrs,
  };
}

// Экспорт ядра: в браузере на window, в Node через module.exports.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { processInput, normalize, parseMarkdownLink, formatHTML, sanitizeMarkup };
} else if (typeof window !== 'undefined') {
  window.HTMLAnchorCore = { processInput, normalize, parseMarkdownLink, formatHTML, sanitizeMarkup };
}

// ===========================================================================
// ИНТЕРФЕЙС (запускается только в браузере).
// ===========================================================================
if (typeof document !== 'undefined') {
  (function () {
    const inputEl = document.getElementById('input');
    const outputEl = document.getElementById('output');
    const statsEl = document.getElementById('stats');
    const inputStatusEl = document.getElementById('inputStatus');
    const copyBtn = document.getElementById('copyBtn');
    const clearBtn = document.getElementById('clearBtn');

    const DEBOUNCE_MS = 300;
    let debounceTimer = null;
    let lastProcessedInput = null;

    const outputHighlightEl = document.getElementById('outputHighlight');

    function escapeHtml(text) {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function regexEscape(s) {
      return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Подсветка нового кода, добавленного генератором: якоря {…}(#id)
    // в ячейках и атрибуты id="…" на карточках. Всё, что мы сами добавили
    // или изменили, оборачивается в <span class="hl-changed"> (янтарный).
    function highlightNewCode(text, changedLinks, changedIdAttrs) {
      let highlighted = escapeHtml(text);
      const pieces = [];
      for (const link of changedLinks) pieces.push(escapeHtml(link));
      for (const attr of changedIdAttrs) pieces.push(escapeHtml(attr));
      // Сортируем по длине, чтобы сначала заменять более длинные куски
      // (границы якорей и id-атрибутов не пересекаются).
      pieces.sort(function (a, b) { return b.length - a.length; });
      for (const piece of pieces) {
        const re = new RegExp(regexEscape(piece), 'g');
        highlighted = highlighted.replace(re, '<span class="hl-changed">$&</span>');
      }
      return highlighted;
    }

    function renderResult(result) {
      if (result.error) {
        statsEl.textContent = result.error;
        statsEl.classList.add('error');
        outputEl.value = result.html;
        // Очищаем подсветку: старый overlay больше не соответствует тексту.
        if (outputHighlightEl) outputHighlightEl.innerHTML = '';
        return;
      }

      statsEl.classList.remove('error');

      const s = result.stats;
      statsEl.textContent =
        'Карточки: ' + s.foundCards +
        ' · Названия в таблице: ' + s.foundCells +
        ' · Сопоставлено: ' + s.matched +
        ' · Добавлено ID: ' + s.added +
        ' · Не сопоставлено/неоднозначно: ' + s.ambiguous;

      // Автоматическое форматирование результата для читаемости.
      const formatted = window.HTMLAnchorCore.formatHTML(result.html);
      outputEl.value = formatted;
      renderOutputHighlight(formatted, result.changedLinks || [], result.changedIdAttrs || []);
    }

    // Рисует текст результата в overlay правого поля и подсвечивает весь
    // новый код, добавленный генератором (янтарный). Текст рисует overlay,
    // поэтому сам textarea остаётся прозрачным (см. CSS .code-wrap .code-area).
    function renderOutputHighlight(text, changedLinks, changedIdAttrs) {
      if (!outputHighlightEl) return;
      if (!text) {
        outputHighlightEl.innerHTML = '';
        return;
      }
      outputHighlightEl.innerHTML = highlightNewCode(text, changedLinks, changedIdAttrs);
    }

    function processAndRender() {
      const raw = inputEl.value;
      if (raw === lastProcessedInput) return;
      lastProcessedInput = raw;

      if (raw.trim() === '') {
        outputEl.value = '';
        if (outputHighlightEl) outputHighlightEl.innerHTML = '';
        statsEl.textContent = 'Вставьте HTML-код, чтобы увидеть результат.';
        inputStatusEl.textContent = '';
        return;
      }

      inputStatusEl.textContent = 'Обработка…';
      renderResult(window.HTMLAnchorCore.processInput(raw));
      inputStatusEl.textContent = '';
    }

    inputEl.addEventListener('input', function () {
      if (debounceTimer) clearTimeout(debounceTimer);
      // Если левое поле пустое — очищаем правое мгновенно, без debounce.
      if (inputEl.value.trim() === '') {
        lastProcessedInput = inputEl.value;
        outputEl.value = '';
        if (outputHighlightEl) outputHighlightEl.innerHTML = '';
        statsEl.textContent = 'Вставьте HTML-код, чтобы увидеть результат.';
        inputStatusEl.textContent = '';
        return;
      }
      debounceTimer = setTimeout(processAndRender, DEBOUNCE_MS);
    });

    // Синхронизация прокрутки overlay с textarea (правое поле).
    outputEl.addEventListener('scroll', function () {
      if (!outputHighlightEl) return;
      outputHighlightEl.scrollTop = outputEl.scrollTop;
      outputHighlightEl.scrollLeft = outputEl.scrollLeft;
    });

    copyBtn.addEventListener('click', function () {
      if (!outputEl.value) return;
      const label = copyBtn.textContent;
      const done = function () {
        copyBtn.textContent = 'Скопировано ✓';
        setTimeout(function () { copyBtn.textContent = label; }, 1600);
      };

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(outputEl.value).then(done, function () {
          fallbackCopy(done);
        });
      } else {
        fallbackCopy(done);
      }
    });

    function fallbackCopy(done) {
      outputEl.select();
      outputEl.setSelectionRange(0, outputEl.value.length);
      try {
        document.execCommand('copy');
        done();
      } catch (err) {
        copyBtn.textContent = 'Ошибка копирования';
        setTimeout(function () { copyBtn.textContent = 'Копировать результат'; }, 2000);
      }
    }

    clearBtn.addEventListener('click', function () {
      inputEl.value = '';
      lastProcessedInput = null;
      outputEl.value = '';
      if (outputHighlightEl) outputHighlightEl.innerHTML = '';
      statsEl.textContent = 'Вставьте HTML-код, чтобы увидеть результат.';
      inputStatusEl.textContent = '';
      inputEl.focus();
    });
  })();
}