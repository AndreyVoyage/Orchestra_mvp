# Аудит секции UTILS — js/app.js (строки 10–90)

> **Проект:** Voyage Orchestrator v3  
> **Файл:** `js/app.js`  
> **Секция:** `UTILS` (строки 10–90)  
> **Дата аудита:** 2026-06-06  
> **Аудитор:** AI-агент (Kimi Code CLI)

---

## Сводка

В ходе статического анализа секции `UTILS` выявлено **7 проблем**, из которых:
- **1 critical** — DoS через бесконечную рекурсию
- **2 high** — ложный успех копирования, XSS через опасные URL-атрибуты
- **3 medium** — неполное экранирование HTML/RegExp, отсутствие валидации аргументов
- **1 low** — dead code (`escapeRegExp` не используется)

---

## 1. `debounce` (строка 15) — `bug / medium`

**Проблема:** нет валидации аргументов. Передача не-функции в `fn` приводит к отложенному `TypeError` внутри `setTimeout`. `ms`, если `NaN` или строка, ведёт себя непредсказуемо.

**Исправление:** проверить тип `fn`, нормализовать `ms` через `Number()` и `Math.max(0, ...)`.

---

## 2. `escapeHtml` (строка 22) — `security / medium`

**Проблема:** не экранирует обратный апостроф `` ` ``, что в устаревших движках (и при строгой политике экранирования) даёт вектор XSS через атрибуты вида `` <div attr=`...`> ``. Также пропускает объекты — `String({})` превращается в `"[object Object]"`.

**Исправление:** добавить замену `` ` `` на `&#x60;` и отбрасывать не-строки/не-числа.

---

## 3. `escapeRegExp` (строка 32) — `bug / medium`

**Проблема:** не экранирует `-` (спецсимвол внутри символьного класса `[]`) и `/` (разделитель регулярного литерала). Если экранированная строка используется внутри `new RegExp('['+s+']')`, `-` сломает выражение.

**Исправление:** добавить `-` и `/` в набор экранируемых символов.

---

## 4. `isValidBaseUrl` (строка 36) — `bug / high`

**Проблема:** принимает пустую строку (`new URL('', ...)` возвращает текущий URL) и не-строки. Для `baseUrl` это может привести к неожиданному `fetch` на текущую страницу.

**Исправление:** проверить тип аргумента (`typeof url !== 'string'`) и отвергать пустую строку после `trim()`.

---

## 5. `validateImportedState` (строка 46) — `security / critical`

**Проблемы:**
- **Циклические ссылки** (`obj.a = obj`) вызывают бесконечную рекурсию `hasBad` → `RangeError: Maximum call stack size exceeded` (DoS).
- `obj.__proto__ !== Object.prototype` ломается на объектах из других `window` / iframe и является ненадёжной защитой от prototype pollution.
- `obj.feedbacks` может быть `null`: `typeof null === 'object'` и `!Array.isArray(null)` дают `true`, пропуская `null` как валидное значение.

**Исправление:**
- Заменить проверку прототипа на `Object.prototype.toString.call(obj) !== '[object Object]'`.
- Добавить `WeakSet` для отслеживания посещённых объектов и предотвращения циклов.
- Явно отвергать `null` для поля `feedbacks`.

---

## 6. `domCreate` (строка 62) — `security / high`, `bug / medium`

**Проблемы:**
- `setAttribute(k, v)` позволяет установить `href="javascript:..."` или `src="data:text/html,..."` — XSS при работе с пользовательскими данными.
- Строковые inline-обработчики (`onclick: 'alert(1)'`) обходят ветку `typeof v === 'function'` и устанавливаются через `setAttribute`, что может обходить CSP при ослабленной политике.
- `children.forEach(...)` кидает `TypeError` на числах или `boolean`, т.к. `appendChild` принимает только `Node`.

**Исправление:**
- Блокировать опасные URL-протоколы (`javascript:`, `data:text/html`, `vbscript:`) для атрибутов `href/src/action/formaction`.
- Отбрасывать строковые `on*`-атрибуты.
- Приводить примитивы (`string`, `number`, `boolean`) к `TextNode`.

---

## 7. `copyToClipboard` (строка 75) — `bug / high`, `bug / medium`

**Проблемы:**
- `document.execCommand('copy')` возвращает `false` при неудаче, но код всегда вызывает `resolve()` — промис считает операцию успешной даже при сбое.
- Нет проверки `document.body` — fallback крашится, если скрипт выполняется в `<head>` до появления `<body>`.
- `position: fixed` + `opacity: 0` без смещения перекрывает клики мыши в координате `(0,0)`.

**Исправление:**
- Проверять булевый результат `execCommand` и вызывать `reject()` при `false`.
- Проверять наличие `document.body` перед созданием элемента.
- Уводить `<textarea>` за пределы экрана (`left: -9999px`) и удалять в блоке `finally`.

---

## Исправленная секция UTILS целиком

```javascript
// ===== UTILS =====
// ============================================
// VOYAGE UTILS — XSS-safe helpers, validators
// ============================================

function debounce(fn, ms) {
  if (typeof fn !== 'function') throw new TypeError('debounce: fn must be a function');
  ms = Math.max(0, Number(ms) || 0);
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

function escapeHtml(s) {
  if (s == null) return '';
  if (typeof s !== 'string' && typeof s !== 'number') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#x60;');
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

function isValidBaseUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  try {
    const p = new URL(url, window.location.href);
    if (p.protocol === 'file:' && window.location.protocol !== 'file:') return false;
    const f = ['javascript:', 'data:', 'vbscript:', 'about:'];
    if (f.some(x => p.protocol === x)) return false;
    return ['http:', 'https:', 'file:'].includes(p.protocol);
  } catch { return false; }
}

function validateImportedState(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (Object.prototype.toString.call(obj) !== '[object Object]') return false;
  const bad = ['__proto__', 'constructor', 'prototype'];
  const seen = new WeakSet();
  const hasBad = (o) => {
    if (!o || typeof o !== 'object') return false;
    if (seen.has(o)) return false;
    seen.add(o);
    const keys = Object.keys(o);
    for (let i = 0; i < keys.length; i++) {
      if (bad.includes(keys[i])) return true;
      const v = o[keys[i]];
      if (v && typeof v === 'object' && hasBad(v)) return true;
    }
    return false;
  };
  if (hasBad(obj)) return false;
  if (obj.baseUrl !== undefined && typeof obj.baseUrl !== 'string') return false;
  if (obj.task !== undefined && typeof obj.task !== 'string') return false;
  if (obj.masterResponse !== undefined && typeof obj.masterResponse !== 'string') return false;
  if (obj.feedbacks !== undefined && (typeof obj.feedbacks !== 'object' || Array.isArray(obj.feedbacks) || obj.feedbacks === null)) return false;
  return true;
}

function domCreate(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  const dangerousUrlAttrs = ['href', 'src', 'action', 'formaction'];
  const dangerousProto = /^\s*(javascript|data:text\/html|vbscript):/i;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') {
      el.textContent = v;
    } else if (k === 'html') {
      el.innerHTML = v; // use only with trusted content
    } else if (k === 'className') {
      el.className = v;
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k.startsWith('on') && typeof v === 'string') {
      continue; // block inline handlers passed as strings
    } else if (dangerousUrlAttrs.includes(k) && typeof v === 'string' && dangerousProto.test(v)) {
      continue; // skip dangerous URLs
    } else {
      el.setAttribute(k, v);
    }
  }
  children.forEach(c => {
    if (c == null) return;
    el.appendChild(typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean' ? document.createTextNode(String(c)) : c);
  });
  return el;
}

function copyToClipboard(text) {
  return new Promise((resolve, reject) => {
    const str = String(text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str).then(resolve).catch(reject);
    } else {
      if (!document.body) {
        reject(new Error('document.body is not available'));
        return;
      }
      const ta = document.createElement('textarea');
      ta.value = str;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      ta.setAttribute('aria-hidden', 'true');
      document.body.appendChild(ta);
      ta.select();
      try {
        const ok = document.execCommand('copy');
        if (ok) resolve();
        else reject(new Error('execCommand copy failed'));
      } catch (e) {
        reject(e);
      } finally {
        if (ta.parentNode) document.body.removeChild(ta);
      }
    }
  });
}
```

---

## Рекомендации

1. **Применить патч** к `js/app.js` перед следующим релизом.
2. **Провести регрессионное тестирование:**
   - Загрузка ролей через `fetch` и File API fallback.
   - Drag-n-drop ZIP и анализ зависимостей.
   - Экспорт/импорт сессии (проверить циклы и большие JSON).
   - Копирование промптов и отчётов в буфер обмена.
3. **Удалить `escapeRegExp`** или начать использовать (в настоящий момент — dead code).
4. **Добавить unit-тесты** для `validateImportedState` на циклические ссылки и prototype pollution.
