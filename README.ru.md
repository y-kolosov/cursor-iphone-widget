# Виджет Cursor Usage (Scriptable)

Виджет для домашнего экрана iPhone: расход Cursor — Cursor Models %, Other Models %, дата сброса и on-demand доллары, если они есть.

[<img src="docs/iphone-medium-widget.png" width="240" alt="Средний виджет Cursor Usage на iPhone">](docs/iphone-medium-widget.png)

Официального личного API по использованию нет. Виджет ходит на тот же неофициальный эндпоинт `https://cursor.com/api/usage-summary`, что и веб-дашборд. Он может сломаться, если Cursor изменит формат ответа.

## Установка

1. iPhone: установите [Scriptable](https://scriptable.app), включите для него iCloud Drive, один раз откройте приложение, чтобы появилась папка `iCloud Drive/Scriptable`.
2. Скопируйте `scriptable/CursorUsage.js` в новый скрипт Scriptable с именем **CursorUsage**.
3. Mac: выполните `python3 scripts/sync-cursor-token` (на этом Mac должен быть использован десктопный Cursor).
4. Убедитесь, что файл `iCloud Drive/Scriptable/CursorUsage/token.txt` существует и содержит одну строку. Дождитесь синхронизации iCloud на телефон.
5. Домашний экран iPhone → Изменить → Добавить виджет → Scriptable → Small и/или Medium → выберите скрипт **CursorUsage**.

## Ручной запасной вариант с cookie

Если хелпер пишет, что не удалось обновить токен:

1. Браузер на компьютере → https://cursor.com/dashboard/spending → DevTools → Application → Cookies → `WorkosCursorSessionToken`.
2. Вставьте это значение единственной строкой в `iCloud Drive/Scriptable/CursorUsage/token.txt`.
3. Нажмите на виджет (или запустите скрипт в Scriptable), чтобы обновить данные.

Хелпер никогда не перезаписывает `token.txt` токеном, который получил HTTP 401/403.

## Обновление (не настоящий realtime)

iOS сама решает, когда перерисовывать виджеты. Скрипт просит обновление через 5 минут; система часто ждёт 15–60 минут.

Быстрее:

- Нажмите на виджет (откроется Scriptable и скрипт выполнится заново).
- Команды: Автоматизация → Личная → Время суток / Повторять каждые 15 минут → Запустить скрипт → CursorUsage. Либо добавьте команду «Refresh Cursor Usage», которая запускает этот скрипт, и закрепите её на экране блокировки / в Пункте управления.

## Тесты

```bash
node --test tests/parse-usage.test.js
python3 -m unittest tests.test_sync_cursor_token -v
```

## Ручной чеклист

- [ ] Small: две полоски, %, дата сброса, без строки on-demand
- [ ] Medium: две полоски, сброс + время, on-demand только если Spending показывает доп. расход
- [ ] Светлый и тёмный домашний экран
- [ ] Пустой/отсутствующий токен → Add token
- [ ] Плохой токен → Token expired
- [ ] Авиарежим после успешной загрузки → серые устаревшие цифры, старое время на medium
- [ ] Нажатие обновляет данные
- [ ] Проценты совпадают с https://cursor.com/dashboard/spending
