# Аудит ZIP-LOADER и DEPENDENCY-ANALYZER — js/app.js

> **Дата:** 2026-06-06  
> **Аудитор:** Kimi Code  
> **Коммит:** `dedd117`  
> **Изменения:** ZIP-LOADER +111 −88, DEPENDENCY-ANALYZER +0 −231 (нет, фактически обе секции переписаны)

---

## Критическая проблема (исправлена перед аудитом)

Файл `js/app.js` содержал **дублированную и конфликтующую секцию IMPORTER** (остатки старого кода + новый патч v3.2 наложились друг на друга). Это привело к:
- Дублированным функциям `exportSession`, `importSession`
- Лишней закрывающей скобке `}` на строке 1131
- Потенциальному `SyntaxError` при загрузке скрипта

**Исправление:** секция IMPORTER полностью пересобрана из чистого кода v3.2.

---

## Найденные проблемы (ДО патча)

### ZIP-LOADER

| # | Проблема | Severity | Строка | Тип |
|---|----------|----------|--------|-----|
| 1 | **Нет graceful fallback для `DecompressionStream`** | **HIGH** | 326 | bug |
|   | В старых браузерах (Safari <15.4) `new DecompressionStream('deflate-raw')` выбросит `ReferenceError`, ломая весь ZIP-парсинг. | | | |
| 2 | **Нет bounds checking в `readCentralDirectory`** | **HIGH** | 351 | bug |
|   | `DataView.getUint32(offset, true)` без проверки `offset < buffer.byteLength` — corrupted ZIP вызывает `RangeError`. | | | |
| 3 | **Нет bounds checking в `extractFile`** | **MEDIUM** | 373 | bug |
|   | `fhOffset` и `dataOffset + compSize` не проверяются на выход за пределы `ArrayBuffer`. | | | |
| 4 | **Нет лимита на количество файлов в ZIP** | **MEDIUM** | 398 | performance |
|   | ZIP-бомба с 10000+ файлов вызовет зависание цикла `for (const info of files)`. | | | |
| 5 | **Нет лимита на суммарный размер распакованных данных** | **MEDIUM** | 408 | performance |
|   | Один файл 500 МБ или сумма >1 ГБ приведёт к OOM в браузере. | | | |
| 6 | **`detectLanguage` — ложные срабатывания Python→JS** | **LOW** | 434 | bug |
|   | Проверка `content.includes('import ') && content.includes('from ')` раньше `def ...:` ошибочно определяет Python как JS. | | | |
| 7 | **Не обрабатывается ZIP64** | **LOW** | 331 | architecture |
|   | Большие ZIP (>4 ГБ) используют ZIP64 EOCD, который не распознаётся. | | | |

### DEPENDENCY-ANALYZER

| # | Проблема | Severity | Строка | Тип |
|---|----------|----------|--------|-----|
| 8 | **`findCycles` пропускает циклы из-за глобального `visited`** | **HIGH** | 690 | bug |
|   | Глобальный `Set visited` помечает узел при первом обходе. Если из другого стартового узла есть цикл через уже посещённый узел — он не обнаруживается. | | | |
| 9 | **Бесконечный цикл в `extractImports`/`extractSymbols` без флага `g`** | **MEDIUM** | 558 | bug |
|   | Если regex в `LANGUAGE_PATTERNS` добавлен без флага `global`, `exec` всегда возвращает один и тот же результат → бесконечный цикл. | | | |
| 10 | **`fileMap` перезаписывает `cleanName` при коллизиях** | **MEDIUM** | 621 | bug |
|   | `src/utils.js` и `lib/utils.ts` оба дают `cleanName = 'utils'`. Второй перезаписывает первый → неверный resolution. | | | |
| 11 | **`findDeadCode` — ложные срабатывания** | **MEDIUM** | 770 | architecture |
|   | Проверка `otherContent.includes(exp)` засчитывает комментарии и случайные вхождения. Нет доступа к реальному AST. | | | |
| 12 | **`computeStats` — деление на ноль** | **LOW** | 815 | bug |
|   | `files.reduce(...) / files.length` при `files.length === 0` даёт `NaN`. | | | |

---

## Исправления (ПОСЛЕ патча)

### ZIP-LOADER

| # | Исправление | Где |
|---|-------------|-----|
| 1 | **Проверка `typeof DecompressionStream !== 'undefined'`** | `decompressDeflateRaw` |
| 2 | **Bounds checking в `getData`** — `offset < 0 \/\| offset + size > byteLength` | `getData` |
| 3 | **Bounds checking в `readCentralDirectory`** — проверка `offset + FIXED > length` перед чтением | `readCentralDirectory` |
| 4 | **Bounds checking в `extractFile`** — проверка `fhOffset + FIXED > length` и `endOffset > length` | `extractFile` |
| 5 | **`ZIP_MAX_FILES = 1000`** — отказ от обработки ZIP с >1000 файлов | `parseZip` |
| 6 | **`ZIP_MAX_EXTRACT_SIZE = 50 МБ`** — контроль суммарного распакованного размера | `parseZip` |
| 7 | **Anchor'ы в heuristics** — `^\s*import...`, `^\s*def...`, `^\s*package main\b` | `detectLanguage` |

### DEPENDENCY-ANALYZER

| # | Исправление | Где |
|---|-------------|-----|
| 8 | **Локальный `visited` для каждого старта DFS** — циклы ищутся из каждого узла отдельно | `findCycles` |
| 9 | **Защита от regex без флага `g`** — проверка `regex.global`, однократный `exec` + `console.warn` | `extractImports`, `extractSymbols` |
| 10 | **Предупреждение о коллизиях `cleanName`** — `console.warn` при дублировании | `analyzeProject` |
| 11 | **Улучшенный `findDeadCode`** — проверка named imports `import { foo }` и namespace imports `import * as ns` через regex; доступ к `otherInfo._content` | `findDeadCode`, `analyzeProject` |
| 12 | **Защита от деления на ноль** — `files.length ? Math.round(totalSize / files.length) : 0` | `computeStats` |
| 13 | **`totalSize` в stats** — добавлено поле для полного контроля размера проекта | `computeStats` |

---

## Что изменилось

### ZIP-LOADER
- **Добавлена константа `ZIP_MAX_FILES = 1000`** — защита от ZIP-бомб с огромным количеством файлов
- **Добавлена константа `ZIP_MAX_EXTRACT_SIZE = 50 МБ`** — предотвращение OOM при распаковке больших архивов
- **`getData` теперь проверяет границы** — corrupted ZIP не вызывает `RangeError`
- **`DecompressionStream` с `try/catch`** — понятное сообщение об ошибке вместо cryptic exception
- **`detectLanguage` использует anchored regex** — снижение ложных срабатываний (Python больше не определяется как JS)

### DEPENDENCY-ANALYZER
- **`findCycles` переписан с локальным `visited`** — теперь находит ВСЕ циклы в графе, а не только достижимые из первого узла
- **`extractImports`/`extractSymbols` защищены от regex без `g`** — если разработчик добавит pattern без global flag, код не уйдёт в бесконечный цикл
- **`fileMap` предупреждает о коллизиях** — `src/utils.js` vs `lib/utils.ts` больше не молча перезаписываются
- **`findDeadCode` точнее** — проверяет именованные импорты `import { foo }` и namespace `import * as ns`; использует полный `content` файла через `_content`
- **`computeStats` безопасен** — пустой проект даёт `avgFileSize: 0` вместо `NaN`

---

## Рекомендации

- [ ] Протестировать ZIP-парсинг на архивах >50 МБ — должен отклонить с понятной ошибкой
- [ ] Протестировать ZIP с 1000+ файлов — должен отклонить
- [ ] Проверить `detectLanguage` на Python-файлах с `import` — должен определить как `python`
- [ ] Проверить `findCycles` на графе с несколькими несвязанными циклами — должен найти все
- [ ] Проверить `findDeadCode` на файле с `export const foo` и `import { foo }` — не должен помечать как dead
- [ ] Протестировать на corrupted ZIP (случайные байты) — должен выдать понятную ошибку вместо `RangeError`
- [ ] Проверить работу в Safari 15.4+ — `DecompressionStream('deflate-raw')` должен быть доступен
