# Аудит UI — js/app.js

> **Дата:** 2026-06-06  
> **Аудитор:** Kimi Code  
> **Коммит:** `b3a761b`  
> **Секция:** UI (строки 1202–1655)

---

## Найденные проблемы (ДО патча)

| # | Проблема | Severity | Строка | Тип |
|---|----------|----------|--------|-----|
| 1 | **Утечка памяти `_debouncers`** — debounce-функции для textarea никогда не очищались | **HIGH** | 1484, 1533 | performance |
| 2 | **`container.innerHTML = ''` не очищает `_debouncers`** — при rerender routing/collector старые таймеры остаются висять | **HIGH** | 1389, 1501 | performance |
| 3 | **`querySelectorAll('.v-section')` при каждом переключении экрана** — лишний DOM-запрос | **MEDIUM** | 1246 | performance |
| 4 | **Drop zone не доступна с клавиатуры** — нет `tabindex`, `role`, обработки Enter/Space | **MEDIUM** | 1288 | a11y |
| 5 | **`innerHTML` в `renderSettings`** — архитектурный риск, нарушает CSP-safe подход | **LOW** | 1273, 1276 | security |
| 6 | **Нет `aria-label` у textarea** — скринридеры не понимают назначение полей | **LOW** | 1441, 1468, 1526 | a11y |
| 7 | **`classList.toggle` с boolean** — не поддерживается IE11 и очень старыми Safari | **LOW** | 1569 | bug |
| 8 | **`_ui.bottomBar` может быть null** — `renderBottomBar` не проверяет наличие элемента | **LOW** | 1582 | bug |
| 9 | **`window.scrollTo(0, 0)` без `behavior: 'smooth'`** — резкий скачок, особенно на мобильных | **LOW** | 1249 | architecture |
| 10 | **Event listeners на dropZone создаются каждый rerender** — накопление слушателей в памяти | **MEDIUM** | 1288 | performance |

---

## Исправления (ПОСЛЕ патча)

| # | Исправление | Где |
|---|-------------|-----|
| 1 | **`clearDebouncers()`** — отмена всех pending таймеров и сброс `_debouncers = {}` перед rerender | `renderRouting`, `renderCollector` |
| 2 | **Кэширование `_sectionEls`** — `Array.from(document.querySelectorAll('.v-section'))` один раз в `initUI` | `initUI` |
| 3 | **Keyboard accessibility для dropZone** — `role="button"`, `tabindex="0"`, `aria-label`, обработчики `keydown` (Enter/Space) | `renderProject` |
| 4 | **`innerHTML` заменён на `domCreate`** в `renderSettings` — полностью XSS-safe рендеринг | `renderSettings` |
| 5 | **`aria-label` и `aria-readonly` для textarea** — скринридеры корректно озвучивают поля | `renderRouting`, `renderCollector` |
| 6 | **Замена `classList.toggle(bool)` на `classList.add/remove`** — совместимость со старыми браузерами | `renderFinal` |
| 7 | **Проверка `_ui.bottomBar`** — `if (!_ui.bottomBar) return;` в начале `renderBottomBar` | `renderBottomBar` |
| 8 | **`window.scrollTo({ top: 0, behavior: 'smooth' })`** — плавная прокрутка при смене экрана | `renderScreen` |
| 9 | **Event delegation для file input** — `fileInput.addEventListener('change', handleZipSelect)` вместо inline `change` в `domCreate` | `renderProject` |

---

## Что изменилось

- **Memory safety:** добавлена функция `clearDebouncers()`, которая вызывается в начале `renderRouting()` и `renderCollector()`. Она отменяет все pending `setTimeout` через `debounce.cancel()` и очищает `_debouncers`. Это устраняет накопление мёртвых таймеров при переключении между экранами.
- **Performance:** `_sectionEls` кэшируется один раз в `initUI()` вместо `querySelectorAll('.v-section')` при каждом `renderScreen`. Это снижает нагрузку на DOM API.
- **Accessibility:** dropZone теперь имеет `role="button"`, `tabindex="0"` и обрабатывает `keydown` (Enter/Space). Все textarea получили `aria-label` с описанием роли.
- **XSS safety:** `renderSettings` больше не использует `innerHTML` — весь контент создаётся через `domCreate` с `textContent`.
- **Mobile UX:** `window.scrollTo` теперь с `behavior: 'smooth'`, что устраняет резкие скачки на тач-устройствах.
- **Browser compat:** убран `classList.toggle` с boolean-аргументом, заменён на явные `add/remove`.

---

## Рекомендации

- [ ] Протестировать навигацию с клавиатуры (Tab, Enter, Space) — dropZone должна открывать диалог выбора файла
- [ ] Протестировать VoiceOver/TalkBack — textarea должны озвучиваться с именем роли
- [ ] Проверить плавность scroll на iOS Safari — `behavior: 'smooth'` может не работать без полифила
- [ ] Проверить отсутствие утечек памяти — переключиться между ROUTING и COLLECTOR 20+ раз, убедиться что `_debouncers` пуст
- [ ] Проверить работу dropZone на Android Chrome — drag-n-drop может не работать, но click должен открывать файл-chooser
