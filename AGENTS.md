# AGENTS.md — Voyage Orchestrator v3

> Файл для AI-агентов. Описывает архитектуру, соглашения и особенности проекта.
> Основной язык проекта — русский (UI, комментарии, документация).

---

## Обзор проекта

**Voyage Orchestrator v3** — клиентское одностраничное веб-приложение (SPA) для оркестрации мультиролевого AI-аудита кода. Приложение работает полностью в браузере, не требует сервера (кроме статического хостинга) и не имеет внешних зависимостей.

Приложение загружает ZIP-архив проекта, парсит его в памяти, строит граф зависимостей между файлами, распределяет задачи по 16 ролям-экспертам, собирает их ответы и генерирует финальный consolidated-отчёт с обнаружением конфликтов между ролями.

---

## Технологический стек

- **HTML5** — семантическая разметка, `data-*` не используются
- **CSS3** — нативные CSS Variables, методология БЭМ, адаптивная вёрстка, `prefers-color-scheme: dark`
- **JavaScript (ES2020+)** — ванильный JS, IIFE-бандл, без фреймворков
- **Zero dependencies** — нет `package.json`, `node_modules`, сборщиков и транспайлеров
- **Zero backend** — логика выполняется в браузере, данные хранятся в `localStorage`

### Браузерные API
- `fetch` / `FileReader` — загрузка ролей
- `DecompressionStream('deflate-raw')` — нативный распаковщик ZIP без сторонних библиотек
- `localStorage` — персистентность состояния (лимит ~4 МБ)
- `navigator.clipboard` — копирование в буфер обмена
- `requestIdleCallback` — отложенное сохранение состояния

---

## Структура проекта

```
.
├── index.html              # Точка входа, разметка 6 экранов wizard'а
├── css/
│   └── main.css            # БЭМ + CSS Variables + Dark Mode (~200 строк)
├── js/
│   └── app.js              # Единый IIFE-бандл, ~1750 строк
└── prompts/
    ├── roles.json          # Манифест 16 ролей (id, name, file, description)
    ├── ROLE-001-security.md
    ├── ROLE-002-qa.md
    ├── ROLE-003-performance.md
    ├── ROLE-004-reviewer.md
    ├── ROLE-005-architect.md
    ├── ROLE-006-frontend.md
    ├── ROLE-007-ux.md
    ├── ROLE-008-prompt-engineer.md
    ├── ROLE-009-integration.md
    ├── ROLE-010-code-auditor.md
    ├── ROLE-011-dependency-analyst.md
    ├── ROLE-012-project-loader.md
    ├── ROLE-013-regression-analyst.md
    ├── ROLE-014-documentation-auditor.md
    ├── ROLE-015-test-engineer.md
    └── ROLE-016-repository-builder.md
```

> **Важно:** В `WORKFLOW.md` упоминаются файлы `js/state.js`, `js/ui.js`, `js/utils.js`, `js/importer.js`, `js/zip-loader.js`, `js/dependency-analyzer.js`, но в фактической кодовой базе **весь JavaScript объединён в один файл `js/app.js`**. Это сознательное решение для работы по протоколу `file://` без необходимости в модульном бандлере.

---

## Архитектура приложения

### 1. Единый IIFE-бандл (`js/app.js`)

Весь JS-код обёрнут в `(function() { 'use strict'; ... })();`. Внутри логически разделён на секции:

| Секция | Строки | Назначение |
|--------|--------|------------|
| `UTILS` | ~10–90 | `debounce`, `escapeHtml`, `escapeRegExp`, `isValidBaseUrl`, `validateImportedState`, `domCreate`, `copyToClipboard` |
| `STATE` | ~93–197 | Immutable store (`StateManager`) с selective subscriptions и `localStorage`-персистентностью |
| `ZIP LOADER` | ~200–327 | Ручной парсинг ZIP-формата через `DataView` + `DecompressionStream` |
| `DEPENDENCY ANALYZER` | ~352–793 | Мультиязычный анализ импортов, DFS-поиск циклов, impact map, dead code, orphans |
| `IMPORTER` | ~796–956 | Загрузка ролей через `fetch` или File API (fallback для `file://`) |
| `UI` | ~1007–1430 | XSS-safe рендеринг через `domCreate`, 6 экранов, bottom bar, toast-уведомления |
| `APP ENTRY` | ~1683–1750 | Глобальный объект `window.app`, парсинг `[ORCHESTRATOR_PLAN]`, инициализация |

### 2. State Management

```javascript
class StateManager {
  // Immutable: setState создаёт новый объект и вызывает Object.freeze()
  // Selective subscriptions: listener получает либо весь state, либо slice через selector
  // Автосохранение в localStorage через requestIdleCallback
}
```

**Поля состояния:**
- `baseUrl` — путь к директории с ролями
- `roles` — загруженные markdown-промпты
- `manifest` — распарсенный `roles.json`
- `task`, `masterResponse` — входные данные пользователя
- `plan` — распарсенный JSON из `[ORCHESTRATOR_PLAN]`
- `feedbacks` — ответы ролей
- `activeScreen` — текущий экран wizard'а
- `projectFiles` — файлы из ZIP (`{ name, content, language }`)
- `dependencyGraph` — результат анализа зависимостей
- `lastAction` — строка для статус-бара

### 3. ZIP-парсер

Реализован с нуля: ищет EOCD (End of Central Directory), читает Central Directory, извлекает файлы. Поддерживает:
- Сжатие `STORE` (0) и `DEFLATE` (8)
- Фильтрацию директорий, `__MACOSX/`, скрытых файлов
- Автоопределение языка по расширению и эвристике

### 4. Анализатор зависимостей

Поддерживаемые языки и паттерны:
- **JavaScript/TypeScript** — `import ... from`, `require()`, `export ... from`
- **Python** — `import`, `from ... import`
- **Go** — `import (...)`, `import "..."`
- **Java** — `import ...;`
- **HTML** — `<script src>`, `<link href>`, `url()`
- **CSS** — `@import`
- **Dockerfile** — `FROM`, `COPY`, `ADD`
- **YAML** — `depends_on`, `include`, `extends`

**Возможности анализатора:**
- Построение графа зависимостей (forward + reverse)
- Поиск циклов любой длины через DFS
- Impact Map: при изменении файла X какие файлы сломаются
- Dead Code: экспортированные символы без импортов
- Orphans: файлы без связей
- Статистика по языкам и размерам

### 5. Wizard (6 экранов)

1. **⚙️ Настройки** — загрузка ролей (fetch или File API)
2. **📦 Проект** — drag-n-drop ZIP, просмотр структуры, запуск анализа
3. **📝 Ввод** — задача + ответ Мастера с `[ORCHESTRATOR_PLAN]`
4. **🎯 Роли** — генерация промптов для каждой роли, копирование, вставка ответов
5. **📥 Сбор** — агрегированное поле для ввода ответов всех ролей
6. **🏁 Финал** — consolidated report + conflict detection

---

## Соглашения по коду

### Стиль и организация
- **Табуляция:** 2 пробела
- **Кавычки:** одинарные в JS, двойные в HTML
- **Кодировка:** UTF-8
- **Язык комментариев:** русский (иногда английский в технических терминах)
- **Префиксы CSS-классов:** `v-` (voyage), БЭМ-нотация: `.v-block__element--modifier`

### Безопасность (CSP + XSS)
- В `index.html` задан заголовок `Content-Security-Policy: default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self';`
- **Запрещено** использовать `'unsafe-inline'` в CSP
- Все пользовательские данные проходят через `escapeHtml()`
- Для пользовательского ввода используется `textContent`, не `innerHTML`
- `domCreate()` с параметром `html` используется **только** для доверенного контента
- Импорт JSON валидируется на prototype pollution (`validateImportedState`)
- Размер импортируемой сессии ограничен 5 МБ

### DOM-рендеринг
- Предпочтительный способ создания элементов — `domCreate(tag, attrs, children)`
- `innerHTML` допустим только для статической разметки в `index.html`
- Динамический контент всегда через `textContent` или `domCreate(..., { text: ... })`

---

## Процесс сборки и запуска

### Сборка
**Сборка не требуется.** Проект — статические файлы.

### Локальный сервер (рекомендуется)
```bash
# Python 3
python -m http.server 8000

# Node.js
npx serve .

# VS Code: расширение "Live Server" → Go Live
```
Открыть `http://localhost:8000`

### Локальный файл (без сервера)
Двойной клик по `index.html`. В этом режиме `fetch()` заблокирован браузером, поэтому роли загружаются через кнопку **«📂 Выбрать roles.json»** и последующий выбор `.md`-файлов.

---

## Тестирование

**В проекте отсутствуют автоматизированные тесты.** Тестирование выполняется вручную через чеклист из `WORKFLOW.md`:

1. Загрузка ролей (fetch + File API fallback)
2. Загрузка ZIP и анализ зависимостей
3. Парсинг плана Мастера
4. Распределение ролей и сбор ответов
5. Генерация финального отчёта и проверка конфликтов

При внесении изменений в `js/app.js` рекомендуется проверять:
- Работу в обоих режимах (`http://` и `file://`)
- Корректность парсинга ZIP-файлов
- Отсутствие XSS-уязвимостей (проверить ввод спецсимволов в текстовые поля)
- Сохранение/восстановление сессии через Export/Import
- Поведение при превышении лимита `localStorage` (4 МБ)

---

## Расширение системы

### Добавление новой роли
1. Создать `prompts/ROLE-017-myrole.md` с секциями `Identity`, `Task`, `Output Format (STRICT)`, `Rules`
2. Добавить запись в `prompts/roles.json`
3. Перезагрузить страницу

### Добавление языка анализа
1. Открыть `js/app.js`, найти объект `LANGUAGE_PATTERNS`
2. Добавить паттерны `imports`, `functions`, `classes`, `exports`
3. Добавить расширение в `detectLanguage()`
4. При необходимости расширить `resolveDependency()`

---

## Важные ограничения

- **localStorage limit:** ~4 МБ. Большие сессии нужно экспортировать в файл через кнопку 💾.
- **ZIP limit:** Зависит от оперативной памяти браузера. Для проектов >50 МБ или >1000 файлов рекомендуется постепенная загрузка.
- **File API на `file://`:** `fetch()` заблокирован CORS. Используется ручной выбор файлов.
- **DecompressionStream:** Требуется современный браузер (Chrome 80+, Firefox 90+, Safari 15.4+).

---

## Связанные файлы

- `WORKFLOW.md` — пользовательская инструкция по тестированию больших проектов
- `index.html` — разметка 6 экранов, inline-обработчики `onclick` (безопасны, т.к. вызывают `window.app.*`)
- `css/main.css` — полный дизайн-система на CSS Variables
- `js/app.js` — единственный файл с бизнес-логикой
