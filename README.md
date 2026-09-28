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

- **Node.js 22+** (сервер использует встроенный `node:sqlite`; проверено на Node 26)
- npm 10+
- Для десктоп-приложения — Linux с X11/Wayland (Electron ставится через `npm install`)

---

## Как скачать с GitHub

```bash
git clone https://github.com/flyingtunez-cmyk/obsisync.git
cd obsisync
```

Если Git не установлен или не настроен: клонирование доступно и через веб-интерфейс
(repo → кнопка **Code** → **HTTPS** → ссылка), а архивом — **Code → Download ZIP**.

---

## Полная пошаговая инструкция

### Шаг 1. Установка зависимостей (один раз)

```bash
npm install                        # сайт (Vite) + ws для тестов
cd server && npm install && cd ..  # сервер (Express + SQLite)
cd app && npm install && cd ..     # десктоп-приложение (опционально)
```

### Шаг 2. Запуск трёх терминалов

**Терминал 1 — API-сервер:**
```bash
npm run api
```
Сервер стартует на `http://127.0.0.1:3000` с WebSocket-каналом `ws://127.0.0.1:3000/api/ws`.
> Команда `npm run api` использует `node --watch server/src/index.js` (Node 18.15+).
> Если `--watch` недоступен, запустите вручную: `node server/src/index.js`.
> Для доступа с других устройств в сети: `HOST=0.0.0.0 npm run api`.

**Терминал 2 — Сайт (Vite dev):**
```bash
npm run dev
```
Сайт доступен на `http://localhost:5173`.
> Для доступа с других устройств сети: `http://<IP_устройства>:5173`.
> Vite автоматически проксирует `/api`, `/health`, `/uploads` на API-сервер.

**Терминал 3 — Десктоп-приложение (опционально):**
```bash
cd app && npm start
```

### Шаг 3. Проверка

```bash
curl http://127.0.0.1:3000/health
# → {"status":"ok","service":"obsisync-api"}
```
Откройте `http://localhost:5173` в браузере — лендинг, кнопка «Войти» → регистрация работает.

### Тесты API

```bash
node scripts/test-api.mjs   # 7 проверок: версии, старые ревизии, дубли, WebSocket
```
Тест герметичен: прогон можно повторять, за собой он убирает.

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
