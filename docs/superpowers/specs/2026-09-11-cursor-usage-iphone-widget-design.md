# Cursor Usage — iPhone виджет (Scriptable)

Дата: 2026-09-11  
Статус: draft, ждёт ревью

## Проблема

На iPhone нет взгляда на usage Cursor, как в веб-консоли Spending: два пула в процентах, дата сброса, on-demand если он есть. Официального personal usage API нет.

## Цель

Личный Home Screen виджет на iPhone (Scriptable):

- **small** и **medium**
- процент **Cursor Models** и **Other Models**
- дата сброса биллинг-цикла
- сумма on-demand, только если перерасход включён и `used > 0` (на medium всегда снизу; на small — вместо даты, см. [спеку small](./2026-09-12-small-widget-layout-design.md))
- обновление настолько часто, насколько iOS позволяет (не секундный realtime)

## Вне скоупа

- Native WidgetKit / App Store / Xcode
- used / limit / remaining лимита подписки (цифры «$12 из $20»)
- Lock Screen виджет
- свой сервер, team Admin API
- посекундный realtime (iOS так виджеты не обновляет)

## Подход

Телефон сам ходит в Cursor. В iCloud лежит токен. Scriptable при refresh читает файл и вызывает тот же endpoint, что веб-консоль. Хелпер на маке обновляет токен из локальной базы Cursor; если не вышло — ручная вставка cookie в тот же файл.

## Архитектура

Три части, без бэкенда:

1. `scripts/sync-cursor-token` (macOS) — читает access token из Cursor `state.vscdb`, пишет в iCloud.
2. `scriptable/CursorUsage.js` — читает токен, `GET usage-summary`, рисует small/medium.
3. Shortcut «Refresh Cursor Usage» — запускает тот же скрипт (Lock Screen / Control Center / автоматизация каждые 15 минут).

## Компоненты

| Путь | Роль |
|---|---|
| `scripts/sync-cursor-token` | Python 3, stdlib. Ищет `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`. Пишет одну строку токена. Не печатает секрет в stdout. |
| `lib/parse-usage.js` | Канонический парсер ответа `usage-summary`. Без API Scriptable. Его покрывают тесты. |
| `scriptable/CursorUsage.js` | Сеть, кэш, вёрстка. Правила разбора — копия функций из `lib/parse-usage.js` (держать в синхроне, без сборщика). |
| `shortcuts/Refresh Cursor Usage` | Инструкция + экспорт Shortcut, если получится выгрузить. Минимум — шаги в README. |
| `README.md` | Установка Scriptable, путь токена, ручной cookie, лимиты refresh iOS. |
| `tests/` | Фикстуры JSON + тесты парсера и хелпера. |

## Токен и пути

Канонический файл (чтобы Scriptable читал через `FileManager.iCloud()` без bookmark):

- в Finder: `iCloud Drive/Scriptable/CursorUsage/token.txt`
- на маке: `~/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents/CursorUsage/token.txt`

Одна строка, trim. Формат как у cookie `WorkosCursorSessionToken` (часто `userId::jwt`).

Хелпер создаёт каталог `CursorUsage`, если его нет. Если Scriptable на маке ни разу не открывали и контейнера iCloud нет — exit 1 и инструкция: открыть Scriptable с включённым iCloud **или** вставить cookie руками в этот путь после появления папки.

Поиск в `state.vscdb` (ItemTable), первый подходящий ключ:

1. значения, похожие на session cookie / `userId::jwt`
2. известные ключи вроде `cursorAuth/accessToken`

Если вытащить новый токен нельзя — **не затирать** существующий `token.txt`. Exit 1, текст про ручной fallback: DevTools на `cursor.com` → Cookies → `WorkosCursorSessionToken` → вставить в файл.

Перед записью хелпер проверяет токен: `GET usage-summary` с этой cookie. 401/403 → файл не трогать, exit 1 (IDE-токен из `state.vscdb` не всегда принимается как web-cookie). Сеть недоступна: если `token.txt` уже есть — оставить его; если файла нет — записать извлечённый токен и предупредить, что проверить не удалось.

Токен не коммитить, не логировать, не печатать.

## Поток данных

1. Хелпер пишет `token.txt` в iCloud. Телефон видит тот же файл.
2. Scriptable читает первую непустую строку. Пусто / нет файла → виджет «Add token», без сети.
3. `GET https://cursor.com/api/usage-summary`  
   заголовок: `Cookie: WorkosCursorSessionToken=<token>`
4. Парсер строит модель:

   | Поле | Источник |
   |---|---|
   | `cursorModelsPct` | `individualUsage.plan.autoPercentUsed` |
   | `otherModelsPct` | `individualUsage.plan.apiPercentUsed` |
   | `resetAt` | `billingCycleEnd` |
   | `onDemandUsd` | `individualUsage.onDemand.used / 100`, только если `enabled === true` и `used > 0` |
   | `unlimited` | `isUnlimited` |
   | `fetchedAt` | локальное время съёмки |

5. Если `plan` нет — вытащить проценты из `autoModelSelectedDisplayMessage` и `namedModelSelectedDisplayMessage`. Нужны **оба**. Иначе ошибка разбора, без нулей.
6. Проценты на экране — целые, как в дашборде (округление). Могут быть `> 100`.
7. `isUnlimited` → вместо % показать `∞`. On-demand и дата сброса по тем же правилам.
8. Small и medium получают одну модель, разная только вёрстка.

Endpoint неофициальный, как у самого дашборда. Смена схемы = «Can't parse», не тихий ноль.

## Вёрстка (вариант A — стековые бары)

Тёмная/светлая тема через `Color.dynamic`. Подписи на английском, как в Spending: `Cursor Models`, `Other Models`.

**Small** — состав и футер задаёт [2026-09-12-small-widget-layout-design.md](./2026-09-12-small-widget-layout-design.md): заголовок `Usage`, бары `Cursor` / `Others`, в футере on-demand **или** дата сброса.

**Medium**

- заголовок `Cursor usage`
- справа: `reset <дата>` и время съёмки (`HH:mm`)
- два бара с полными подписями и `%`
- снизу on-demand `On-demand $X.XX`, если поле не `null`

Бары: заливка клипается на 100%, цифра справа — фактический процент (в т.ч. > 100).

Цвет бара и цифры пула:

- `< 80` — обычный акцент (зелёный / system green)
- `80–99` — предупреждение (оранжевый)
- `≥ 100` — критичный (красный)

On-demand цветом пулов не красится.

## Обновление

Настоящий realtime на Home Screen недоступен. Выжимаем iOS:

1. `refreshAfterDate` ≈ сейчас + 5 минут. Система может сдвинуть дальше.
2. Тап по виджету запускает скрипт и сразу перерисовывает.
3. Shortcut «Refresh Cursor Usage» — на Lock Screen / Control Center и/или персональная автоматизация раз в 15 минут.

В README честно: тихий timeline часто 15–60 минут; принудительный пульс — тап и Shortcut.

## Ошибки

| Ситуация | Виджет |
|---|---|
| Нет файла / пустой токен | `Add token`, без сети |
| 401 / 403 | `Token expired`; на medium: обнови `token.txt` хелпером или cookie |
| 5xx / таймаут / нет сети, есть кэш | рисуем кэш, stale (приглушённые %); на medium старое `HH:mm` |
| сеть, кэша нет | `Offline` |
| 200, схема не та / нет обоих fallback-сообщений | `Can't parse` |
| On-demand выключен или `used === 0` | строки нет, не `$0.00` |
| Хелпер: нет Cursor / нет ключа | exit 1, файл не затёрт, инструкция cookie |

Кэш: последний успешный JSON модели в Scriptable (`Scriptable` local file, не iCloud). Пишем только после успешного разбора.

## Тестирование

Автоматом — парсер и хелпер, не UI Scriptable.

Фикстуры `tests/fixtures/`:

- обычный аккаунт с двумя процентами
- on-demand > 0
- on-demand enabled, но `used === 0`
- `isUnlimited`
- нет `plan`, оба display-сообщения валидны
- нет `plan`, сообщения битые
- проценты > 100
- полностью битый payload

Проверки парсера: % / `resetAt` / `onDemandUsd` / fallback / ошибка без выдуманных нулей.

Хелпер:

- нет DB → exit 1, существующий `token.txt` на месте
- mock DB с токеном + успешная проверка → файл из одной строки
- извлечённый токен не проходит 401 → файл не затёрт
- stdout не содержит токен

Ручной чеклист в README: small и medium, светлая/тёмная тема, протухший токен, офлайн с кэшем, тап-рефреш, Shortcut.

## Риски

- `usage-summary` могут поменять без предупреждения.
- Cookie/IDE-токен протухает — виджет сам об этом скажет.
- iOS режет частоту refresh; 5 минут — просьба, не гарантия.
- Путь iCloud Scriptable появляется после первого запуска Scriptable с iCloud.

## Критерий готовности

- Скрипт ставится в Scriptable, виджет small и medium показывают те же два процента и дату сброса, что Spending.
- On-demand виден только при ненулевом перерасходе: на medium снизу, на small в футере вместо даты.
- Протухший токен и офлайн ведут себя как в таблице ошибок.
- Хелпер на маке обновляет `token.txt` или оставляет старый и объясняет cookie.
- Тесты парсера и хелпера зелёные.
