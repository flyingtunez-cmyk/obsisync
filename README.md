# ObsiSync

Сервис синхронизации заметок Obsidian: свой сервер, сайт, CLI и десктоп-приложение.
В репозитории — рабочая версия от 27.09.2026: аккаунты, 2FA, профиль, файлы с историей версий и live-обновления по WebSocket.

---

## Что внутри

| Часть | Каталог | Что делает |
|---|---|---|
| Сайт | `index.html`, `src/`, `vite.config.js` | Лендинг + дашборд: регистрация/вход, 2FA, профиль, активность |
| Сервер (API) | `server/` | Express + SQLite: аккаунты, сессии, файлы, версии, WebSocket-push |
| CLI | `cli/obsisync.js` | Работа с аккаунтом и файлами vault из терминала, двухсторонний синк |
| Десктоп-приложение | `app/` | Electron-клиент: вход, профиль, файлы и live-уведомления об изменениях |
| Сборка/деплой | `server/Dockerfile`, `docker-compose.yml` | Контейнеризация API |

### Возможности

- **Аккаунты**: регистрация, вход, пароль `scrypt`, сессии на сервере, отзыв устройств, удаление аккаунта
- **2FA по TOTP** (RFC 6238): `2fa setup` → QR/otpauth-ссылка → `2fa enable <код>`
- **Профиль**: bio, тема баннера, аватар и баннер (загрузка картинок до 3 МБ)
- **Файлы vault**: запись/чтение/удаление, список, история версий, чтение любой старой версии
- **Версии**: каждое изменение — ревизия (`created/updated/deleted`), одинаковое содержимое не плодит дубли
- **WebSocket-push**: правка на сервере мгновенно приходит всем открытым клиентам
- **Активность**: статистика правок по типам и файлам
- **CLI-синк**: `obsisync sync` — двухстороннее сравнение с распознаванием конфликтов

---

## Требования

- **Node.js 22.12+** — это не формальность: сервер импортирует встроенный `node:sqlite` (нужен с 22.5), а `vite@8` и `electron` требуют 22.12. Проверено на Node 26. Если у тебя Node 18/20 — `npm install` пройдёт, а сервер упадёт при старте. Проверь: `node -v`
- npm 10+
- Для десктоп-приложения — Linux с X11/Wayland (Electron ставится через `npm install`)

---

## Как скачать с GitHub

```bash
git clone https://github.com/flyingtunez-cmyk/obsisync.git
cd obsisync
```

Без Git: **Code → Download ZIP**. Учти, что распакуется папка **`obsisync-main`**, а не `obsisync` — поэтому `cd obsisync` не сработает, нужно `cd obsisync-main`.

---

## Установка — одна команда

```bash
npm run setup
```

Эта команда сама найдёт корень проекта, проверит версию Node и поставит зависимости сайта и сервера. Она не зависит от того, из какой папки её вызвали, и работает в bash, zsh, fish, PowerShell и cmd — поэтому её невозможно запустить не из того каталога.

С десктопным приложением (Electron, тяжёлый):

```bash
npm run setup -- --with-app
```

### Если хочется по-старому, вручную

```bash
npm install                        # сайт и тесты
cd server && npm install && cd ..  # сервер
cd app && npm install && cd ..     # десктоп (по желанию)
```

> Три строки с `cd` ломаются в PowerShell 5.1 (там нет `&&`) и в cmd. Если видишь `directory not found` — скорее всего, команда выполнена не из корня проекта. Проверь: `ls package.json` должен найти файл, и `pwd` должен указывать на корень ObsiSync. Проще просто выполнить `npm run setup`.

### Тесты API

```bash
node scripts/test-api.mjs   # 7 проверок: версии, старые ревизии, дубли, WebSocket
```

Тест самодостаточен: он **сам регистрирует временный аккаунт** и удаляет его за собой — вход в CLI тебе не нужен, чужие заметки не страдают. Прогон можно повторять сколько угодно.

### Docker

```bash
docker compose up --build   # API на 127.0.0.1:3000, данные в именных томах
```
> Локально сборка требует прав на docker-сокет; на VPS отрабатывает штатно.

---

## CLI

### Установка (из корня репозитория)

```bash
npm link                     # после этого команда obsisync доступна отовсюду
# или: npx obsisync          # без необходимости предварительной установки
# или без установки: node cli/obsisync.js
```

### Регистрация и вход

CLI поддерживает интерактивный ввод пароля и автоматический через переменную окружения:

```bash
# Регистрация (интерактивный пароль)
obsisync register <email> <username>

# Регистрация (пароль через переменную — для скриптов)
OBSISYNC_PASSWORD="MyStr0ngPass1" obsisync register <email> <username>

# Вход (интерактивный пароль)
obsisync login [email]

# Вход (пароль через переменной)
OBSISYNC_PASSWORD="MyStr0ngPass1" obsisync login [email]
```
> Пароль можно также передать через `OBSISYNC_PASSWORD` при `login`, `2fa enable`, `password change` и `account delete`.
> Для 2FA-кода используйте `OBSISYNC_CODE`.

### Основные команды

```bash
obsisync status                       # сервер + сессия + привязанная папка
obsisync register <email> <user>    # создать аккаунт (интерактивно или через OBSISYNC_PASSWORD)
obsisync login [email]              # войти (при 2FA попросит код или OBSISYNC_CODE)
obsisync logout                       # выйти (локальный токен чистится)
obsisync config set vault ~/Мои\ заметки   # привязать папку vault
obsisync config get server              # показать сервер

obsisync files [префикс]            # список файлов на сервере
obsisync cat <путь>                 # показать файл
obsisync history <путь> [номер]     # история версий / содержимое версии
obsisync push [папка]               # загрузить локальное на сервер
obsisync pull                       # скачать всё в привязанную папку
obsisync sync [--dry-run] [--force] # двухсторонний синк, конфликты
obsisync rm <путь>                  # удалить файл
obsisync activity                   # статистика правок
obsisync activity --json            # статистика в JSON

obsisync profile set --bio "текст" --theme 0..3
obsisync avatar <файл.png> | avatar --clear
obsisync banner <файл.png> | banner --clear
obsisync sessions                   # список устройств
obsisync revoke <id>                # отозвать сессию

obsisync 2fa setup                  # секрет + otpauth-ссылка
obsisync 2fa enable <код>           # включить 2FA
obsisync 2fa disable <код>          # выключить 2FA

obsisync obsidian status            # установлен ли Obsidian
obsisync obsidian vaults            # vault'ы из конфига Obsidian
obsisync obsidian link <папка>      # привязать папку для push/pull/sync
obsisync obsidian open              # открыть папку в Obsidian
obsisync obsidian install [--appimage] # установить Obsidian

obsisync help                       # полный список
```

### Конфиг CLI

Файл `~/.config/obsisync/config.json` (сервер, токен, привязанная папка).

### Переменные окружения

| Переменная | Назначение |
|---|---|
| `OBSISYNC_PASSWORD` | Пароль для register/login/password/account delete без интерактивного ввода |
| `OBSISYNC_CODE` | TOTP-код для 2FA без интерактивного ввода |
| `OBSISYNC_SERVER` | URL сервера (по умолчанию `http://127.0.0.1:3000`) |
| `OBSISYNC_CONFIG_DIR` | Путь к директории конфига |

---

## Структура репозитория

```
obsisync/
├── index.html, src/          сайт (Vite + vanilla JS)
├── vite.config.js            прокси /api → 127.0.0.1:3000 (с поддержкой WebSocket)
├── server/
│   ├── src/index.js          маршруты API + WebSocket-канал
│   ├── src/db.js             схема SQLite, миграции, папки данных
│   ├── src/auth.js           хеши паролей, токены, TOTP
│   ├── Dockerfile, .env.example
├── cli/obsisync.js           терминальный клиент
├── app/                      Electron-приложение (main/preload/renderer)
├── scripts/test-api.mjs      автотесты API
├── docker-compose.yml
└── README.md
```

База (`server/data/`), приватные ключи (`.env`) и артефакты сборки в git не попадают — они в `.gitignore`.

---

## Статус

- **Готово:** сайт, API, CLI, версии файлов, WebSocket-push, десктоп-приложение, Docker-файлы, тесты.
- **Дальше:** E2E-шифрование на клиенте (Фаза 3), плагин для Obsidian (Фаза 2), VPS + домен/HTTPS.

Материалы по ходу работы (план, лог, разбор кода) — в Obsidian-вазе проекта, отдельной веткой в этом репозитории не дублируются.
