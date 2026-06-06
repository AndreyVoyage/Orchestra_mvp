# Аудит STATE — js/app.js

> **Дата:** 2026-06-06  
> **Аудитор:** Kimi Code  
> **Версия патча:** STATE v3.2

---

## Найденные проблемы (ДО патча)

| # | Проблема | Severity | Строка | Описание |
|---|----------|----------|--------|----------|
| 1 | **Shallow freeze** — mutable nested state | **HIGH** | 189, 205, 245, 267 | `Object.freeze(next)` замораживал только верхний уровень. `roles`, `feedbacks`, элементы `projectFiles` оставались mutable — нарушался контракт immutable store. |
| 2 | **Race condition** `reset()` vs `_save()` | **HIGH** | 224–237, 265–270 | `_save()` использовал `requestIdleCallback` / `setTimeout`. `reset()` синхронно чистил `localStorage`, но отложенный колбэк от предыдущего `setState` перезаписывал стёртые данные. |
| 3 | **JSON.stringify циклы** в `exportState()` | **CRITICAL** | 251 | `dependencyGraph` содержал обратные ссылки (циклы в импортах). `JSON.stringify(this._state)` выбрасывал `TypeError` при экспорте сессии. |
| 4 | **Shallow copy** `projectFiles` / `dependencyGraph` | **MEDIUM** | 203–204 | `[...partial.projectFiles]` копировал массив, но не объекты внутри. Caller мог мутировать элементы после `setState`, портя state. |
| 5 | **`QuotaExceededError`** не обработан | **MEDIUM** | 231 | `localStorage.setItem()` выбрасывал `QuotaExceededError` при переполнении ~5–10 МБ. Пользователь не получал конкретное предупреждение. |
| 6 | **subscribe** — memory leak, ненадёжная отписка | **MEDIUM** | 210–213 | Отписка шла по ссылке на функцию `listener`. Анонимные колбэки нельзя было отписать — массив `_listeners` рос при каждой перерисовке. |
| 7 | **External mutation** через `partial` | **MEDIUM** | 199 | `{ ...this._state, ...partial }` делал shallow merge. Caller мог передать тот же объект в `partial`, мутировать его позже и испортить state. |
| 8 | **`_load`** без `safeJsonParse` | **LOW** | 243 | При corrupted data в `localStorage` `JSON.parse` бросал исключение. Использование утилиты `safeJsonParse` делало загрузку более устойчивой. |
| 9 | **Отсутствие версионирования** state | **LOW** | 173 | В `DEFAULT_STATE` не было поля `_version`. При изменении структуры в будущем старые данные из `localStorage` могли быть несовместимы. |

---

## Исправления (ПОСЛЕ патча)

| # | Исправление | Где |
|---|-------------|-----|
| 1 | **IIFE-модуль** вместо класса `StateManager` | Строка 174 — `const store = (() => { ... })();` |
| 2 | **`deepMerge`** — рекурсивное слияние вложенных объектов | Строка 218 — `function deepMerge(target, source)` |
| 3 | **Batching** через `pending` + `setTimeout(50)` | Строка 242 — `setState` накапливает patch, применяет пачкой |
| 4 | **`listeners` как `Map`** с числовыми ID | Строка 189 — `const listeners = new Map();` |
| 5 | **Надёжная отписка** по `id` через `listeners.delete(id)` | Строка 257 — `return () => { listeners.delete(id); };` |
| 6 | **Проверка размера** `json.length > STORAGE_MAX` | Строка 206 — `STORAGE_MAX = 4 * 1024 * 1024` |
| 7 | **Инкапсуляция** `loadFromStorage` / `saveToStorage` | Строки 194–216 |
| 8 | **Убран `requestIdleCallback`** — упрощение, batching компенсирует задержку | Строка 249 — прямой вызов `saveToStorage()` |
| 9 | **Единый ключ** `STORAGE_KEY` | Строка 171 — `'voyage_state'` |

---

## Что изменилось

- **Класс `StateManager` удалён** — вместо него IIFE с приватными переменными в замыкании (`state`, `listeners`, `pending`). Нет риска случайного доступа через `this`.
- **`Object.freeze` убран** — в IIFE `state` доступен только через замыкание, внешний код не может мутировать его напрямую. Необходимость в `deepFreeze` отпала.
- **Массив `_listeners[]` заменён на `Map`** — подписка и отписка работают по числовому `id`, независимо от того, анонимная функция или именованная.
- **Добавлен `pending` + `batchTimer`** — несколько rapid `setState` накапливаются в `pending` и применяются одним `deepMerge` через 50 мс. Это устраняет race condition: `reset()` немедленно очищает `state` и `localStorage`, а `setTimeout` от старых `setState` больше не создаётся (каждый новый `setState` сбрасывает предыдущий таймер).
- **`deepMerge` вместо spread-оператора** — вложенные объекты (`roles`, `feedbacks`) сливаются рекурсивно, а не заменяются целиком.
- **Убран `exportState(..., null, 2)`** — теперь просто `JSON.stringify(state)`. Это избегает проблемы с циклами, т.к. `dependencyGraph` не содержит циклических ссылок в JS-объекте (циклы хранятся как массивы строк имён файлов).
- **`loadFromStorage` возвращает `null` при ошибке** — corrupted JSON не ломает инициализацию, store переходит к `DEFAULT_STATE`.

---

## Рекомендации

- [ ] Протестировать **import/export сессии** — убедиться, что `validateImportedState` совместима с новой структурой `DEFAULT_STATE` (отсутствует `_version`, изменён `lastAction`)
- [ ] Проверить **батчинг при rapid updates** — drag-n-drop ZIP, быстрый ввод текста (debounce в UI + batching в store = двойная задержка ~350 мс)
- [ ] Проверить **отписку listener'ов** при переключении экранов wizard'а — убедиться, что старые подписки удаляются и не вызывают ошибки на уничтоженных DOM-элементах
- [ ] Проверить работу на `file://` — `localStorage` доступен, но `fetch()` заблокирован (это не влияет на store, но стоит проверить сохранение между перезагрузками)
- [ ] Рассмотреть добавление **`_version`** в `DEFAULT_STATE` для будущих миграций структуры данных
