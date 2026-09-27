import './style.css'

// относительные пути: с любого устройства ходит через прокси Vite на 127.0.0.1:3000
const API_BASE = ''
const CHUD = '/chud.png'

const state = {
  view: 'home',
  manifest: null,
  token: localStorage.getItem('obsisync:token') || null,
  user: readStoredUser(),
  profile: { bio: '', avatar: null, banner: null, theme: 0 },
  activity: null,
  activityError: false,
  sessions: [],
  overlay: null,
  verify: null,
  twofaSetup: null,
  editing: false,
  flash: null
}

function readStoredUser () {
  try {
    return JSON.parse(localStorage.getItem('obsisync:user') || 'null')
  } catch {
    localStorage.removeItem('obsisync:user')
    return null
  }
}

const APP_NAME = 'ObsiSync'
const COPY = '© 2026 ObsiSync · приватная синхронизация Obsidian'

function persistAuth () {
  if (state.token) localStorage.setItem('obsisync:token', state.token)
  else localStorage.removeItem('obsisync:token')
  if (state.user) localStorage.setItem('obsisync:user', JSON.stringify(state.user))
  else localStorage.removeItem('obsisync:user')
}

/* ── API ──────────────────────────────── */

async function api (path, { method = 'GET', body, token } = {}) {
  let res
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    })
  } catch {
    throw new Error('сервер недоступен — запусти API (npm run dev в server/)')
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, data }
}

async function refreshAccount () {
  if (!state.token) return

  let res
  try {
    res = await api('/api/me', { token: state.token })
  } catch {
    // сервер недоступен — не выкидываем пользователя из аккаунта
    state.activityError = true
    return
  }

  if (res.status !== 200 || !res.data?.user) {
    state.token = null
    state.user = null
    state.activity = null
    state.sessions = []
    state.profile = { bio: '', avatar: null, banner: null, theme: 0 }
    persistAuth()
    return
  }

  state.user = res.data.user
  state.profile = res.data.profile
  state.activityError = false
  persistAuth()

  // сервер может быть недоступен — тогда профиль остаётся, а данные помечаем ошибкой
  try {
    const [act, ses] = await Promise.all([
      api('/api/activity', { token: state.token }),
      api('/api/sessions', { token: state.token })
    ])
    if (act.status === 200) { state.activity = act.data; state.activityError = false }
    else state.activityError = true
    if (ses.status === 200) state.sessions = ses.data.sessions
  } catch {
    state.activityError = true
  }
}

/* ── Контент ──────────────────────────── */

const navLinks = [
  { id: 'features', label: 'Возможности' },
  { id: 'how', label: 'Как это работает' },
  { id: 'download', label: 'Скачать' },
  { id: 'faq', label: 'FAQ' }
]

const features = [
  { icon: 'user', title: 'Аккаунт и вход', status: 'готово', text: 'Регистрация, вход, пароль хешируется scrypt, сессии живут на сервере и отозвываются в один клик.' },
  { icon: 'lock', title: '2FA по TOTP', status: 'готово', text: 'Двухфакторка на стандарте RFC 6238: секрет в аутентификаторе (Google Authenticator, Aegis), код при каждом входе.' },
  { icon: 'device', title: 'Устройства', status: 'готово', text: 'Список активных сессий: какой браузер, с какого адреса, когда был. Чужие — отзываются.' },
  { icon: 'server', title: 'Профиль на сервере', status: 'готово', text: 'Аватар, баннер, тема и био хранятся в базе и одинаковы на любом устройстве.' },
  { icon: 'window', title: 'Приложение для ПК', status: 'готово', text: 'Десктоп-клиент: вход и 2FA, профиль, загрузка и скачивание файлов vault, свой адрес сервера. Скачивается ниже — под Windows и Linux.' },
  { icon: 'clock', title: 'История операций', status: 'готово', text: 'Календарь активности и топ файлов на самом деле заполняются: каждая операция с файлами через API пишет запись.' },
  { icon: 'rss', title: 'Синк и шифрование', status: 'в разработке', text: 'E2E-шифрование, слияние правок и плагин для Obsidian — следующий этап проекта.' }
]

const steps = [
  { num: '01', title: 'Заведи аккаунт', text: 'Почта, юзернейм, пароль. Пароль хешируется на сервере, в базе лежит только хеш.' },
  { num: '02', title: 'Настрой профиль', text: 'Аватар, баннер и био — через API. Опционально включи 2FA и посмотри, какие устройства вошли.' },
  { num: '03', title: 'Скачай приложение', text: 'Windows или Linux — вход в аккаунт, и файлы vault двигаются кнопками, без терминала.' }
]

const downloads = [
  { kind: 'win', os: 'Windows', title: 'Windows 10 / 11', btn: 'Скачать .exe',
    text: 'Портативная сборка x64: один файл, запускается без установщика.',
    hint: 'двойной клик — и приложение открыто' },
  { kind: 'deb', os: 'Linux · Ubuntu / Debian', title: 'Ubuntu, Debian', btn: 'Скачать .deb',
    text: 'Пакет для apt: ставится в системное меню и создаёт ярлык.',
    cmd: 'sudo apt install ./ObsiSync-0.1.0-linux-amd64.deb' },
  { kind: 'appimage', os: 'Linux · любой дистрибутив', title: 'AppImage', btn: 'Скачать AppImage',
    text: 'Один исполняемый файл, работает почти на любом линуксе.',
    cmd: 'chmod +x ObsiSync-*.AppImage && ./ObsiSync-*.AppImage' }
]

function downloadHtml () {
  const m = state.manifest
  const byKind = Object.fromEntries((m?.files || []).map(f => [f.kind, f]))
  const mb = b => (b / 1024 / 1024).toFixed(1).replace('.', ',') + ' МБ'

  return `
  <section class="section section-alt" id="download">
    <div class="container">
      <div class="sec-head reveal" data-reveal>
        <div class="sec-eyebrow">[ 03 · скачивание ]</div>
        <h2>Приложение ObsiSync</h2>
        <p>Вход, профиль и файлы vault в обычном окне — без терминала.${m ? ` Сборка ${m.version}.` : ''}</p>
      </div>

      <div class="dl-grid">
        ${downloads.map((d, i) => {
          const f = byKind[d.kind]
          return `
          <div class="dl-card bevel reveal" data-reveal style="--d:${i * 90}ms">
            <div class="dl-os">${d.os}</div>
            <h3>${d.title}</h3>
            <p>${d.text}</p>
            ${f
              ? `<a class="btn btn-primary dl-btn" href="/downloads/${f.name}" download>${d.btn}</a>
                 <div class="dl-meta mono">${mb(f.size)} · ${f.name}</div>
                 ${d.cmd ? `<div class="dl-cmd mono">${d.cmd}</div>` : ''}
                 ${d.hint ? `<div class="dl-hint">${d.hint}</div>` : ''}`
              : `<div class="dl-empty mono">сборка не найдена — npm run downloads</div>`}
          </div>`
        }).join('')}
      </div>

      <p class="dl-foot reveal" data-reveal>
        Сервер пока локальный: <code class="mono">127.0.0.1:3000</code> — адрес меняется в Настройках приложения.
        macOS-сборки нет, Windows-версия пока не тестировалась на реальной машине.
      </p>
    </div>
  </section>
`
}

const faq = [
  { q: 'Что такое ObsiSync?', a: 'Учебный сервис синхронизации для Obsidian: свой сервер, свой клиент, никакой подписки. Сейчас работает аккаунтная часть — регистрация, вход, профиль, 2FA, устройства.' },
  { q: 'Что уже реально работает?', a: 'Бэкенд на Express + SQLite: регистрация и вход, профиль с аватаром и баннером, смена пароля, список и отзыв сессий, удаление аккаунта, 2FA по TOTP, история операций и файловое хранилище vault. Плюс десктоп-приложение (Windows/Linux) и CLI-обвязка для технарей. Всё это проверено тестами.' },
  { q: 'Как ставится приложение?', a: 'Windows — скачанный .exe запускается как есть (портативная сборка, без установщика). Ubuntu/Debian — файл .deb: sudo apt install ./ObsiSync-0.1.0-linux-amd64.deb. Остальные дистрибутивы — AppImage: chmod +x ObsiSync-*.AppImage && ./ObsiSync-*.AppImage, на новых Ubuntu может понадобиться libfuse2.' },
  { q: 'Есть CLI?', a: 'Да, для терминала: obsisync login, obsisync push папка, obsisync pull путь, obsisync files, obsisync profile set --bio "текст". Сервер задаётся obsisync config set server http://адрес или флагом --server. Но основной сценарий теперь — приложение.' },
  { q: 'Что с системными требованиями?', a: 'Windows 10/11 x64 и Linux x64. Сборки сделаны на Linux: Windows-версия — portable exe, на реальной Windows пока не тестировалась; macOS-сборки нет. Приложение на Electron весит около 95–120 МБ.' },
  { q: 'Чего ещё нет?', a: 'Автоматической синхронизации: нет плагина для Obsidian, слияния правок и E2E-шифрования — файлы переносятся вручную, кнопками в приложении. Никакого realtime-синка на сайте не обещается.' },
  { q: 'Как включить 2FA?', a: 'Профиль → Безопасность → «Включить 2FA». Сервер выдаёт секрет, ты вводишь его в аутентификатор (или сканируешь), подтверждаешь первым кодом. Дальше при входе потребуется код.' },
  { q: 'Какой адрес сервера?', a: 'Сейчас приложение, сайт и CLI ходят на локальный API: 127.0.0.1:3000 (для сайта — через прокси Vite). Адрес меняется в Настройках приложения и через obsisync config set server — публичный сервер появится, когда он будет куплен.' },
  { q: 'Где хранятся данные?', a: 'На сервере: SQLite-база (аккаунты, профили, сессии, история), картинки профиля в uploads/ и файлы vault в vaults/ — по папке на пользователя. Ничего наружу не уходит.' },
  { q: 'На чём написано?', a: 'Сервер: Node.js, Express, SQLite (node:sqlite), TOTP на node:crypto. Сайт: Vite + ванильный JS/CSS. CLI: чистый Node без зависимостей. Клиент для Obsidian будет на TypeScript через официальный API.' },
  { q: 'Почему не Dropbox или Google Drive?', a: 'Они не знают про переименования, связи и версии заметок в vault. Нужен клиент, который понимает структуру Obsidian, — для этого и пишется свой плагин.' },
  { q: 'Как запустить у себя?', a: 'В корне: npm run dev (сайт, http://localhost:5173). В server/: npm run dev (API, http://127.0.0.1:3000). Vite проксирует /api и /uploads на бэкенд.' }
]

const KIND_LABELS = { created: 'создано', updated: 'изменено', deleted: 'удалено', conflict: 'конфликты' }

/* ── Тепловая карта реальной активности ─── */

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

function buildHeat () {
  const rows = state.activity?.heatmap || []
  const counts = new Map(rows.map(r => [r.date, r.count]))
  const max = Math.max(1, ...counts.values())

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - (52 * 7 - 1))
  while (start.getDay() !== 1) start.setDate(start.getDate() + 1)

  const weeks = []
  for (let w = 0; w < 52; w++) {
    const col = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(start)
      date.setDate(start.getDate() + w * 7 + d)
      const key = date.toISOString().slice(0, 10)
      const count = date > today ? 0 : (counts.get(key) || 0)
      const lvl = count === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((count / max) * 4)))
      col.push({ lvl, date, count, key })
    }
    weeks.push(col)
  }

  const labels = []
  let lastM = -1
  weeks.forEach((col, i) => {
    const m = col[6].date.getMonth()
    if (m !== lastM) { lastM = m; labels.push({ i, name: MONTHS[m] }) }
  })

  return { weeks, labels }
}

function contribHtml (mini = false) {
  const heat = buildHeat()
  const cells = heat.weeks.map((col, w) =>
    col.map(c => `<div class="gcell lvl${c.lvl}" style="--i:${w}" title="${c.date.toLocaleDateString('ru-RU')} · операций: ${c.count}"></div>`).join('')
  ).join('')
  // подпись месяца лежит в том же скролле, что и колонки: колонка N ↔ grid-column N
  const months = heat.labels.map(l => `<b style="grid-column:${l.i + 1}">${l.name}</b>`).join('')
  return `
    <div class="ct-wrap ${mini ? 'ct-mini' : ''} reveal" data-reveal>
      <div class="ct-grid ${mini ? '' : 'ct-labeled'}">
        <div class="ct-days"><i></i><i>пн</i><i></i><i>ср</i><i></i><i>пт</i><i></i></div>
        <div class="ct-body">
          ${mini ? '' : `<div class="ct-months">${months}</div>`}
          <div class="ct-cols">${cells}</div>
        </div>
      </div>
      <div class="ct-legend">
        <span>меньше</span>
        ${[0, 1, 2, 3, 4].map(l => `<div class="gcell lvl${l}"></div>`).join('')}
        <span>больше</span>
      </div>
    </div>`
}

/* ── Иконки ───────────────────────────── */

const icons = {
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`,
  server: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  conflict: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3h8v18H8zM8 8l4 3 4-3M8 12l4 3 4-3"/></svg>`,
  rss: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.4"/></svg>`,
  device: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/></svg>`,
  terminal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9.5l3 2.5-3 2.5M13 15h4"/></svg>`,
  window: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><circle cx="6.5" cy="6.5" r=".8" fill="currentColor"/><circle cx="9.5" cy="6.5" r=".8" fill="currentColor"/></svg>`
}

const statusClass = { 'готово': 'ok', 'API готов': 'ok', 'в разработке': 'wip' }

/* ── Навигация ────────────────────────── */

function navRight () {
  if (state.user) {
    return `
      <span class="nav-user mono">@${state.user.username}</span>
      <button class="btn btn-ghost btn-sm" data-nav-to="profile">Профиль</button>
      <button class="btn btn-ghost btn-sm" data-logout>Выйти</button>`
  }
  return `
    <button class="btn btn-ghost btn-sm" data-open-auth="login">Войти</button>
    <button class="btn btn-primary btn-sm" data-open-auth="register">Регистрация</button>`
}

function heroHtml () {
return `
  <header class="nav">
    <div class="container nav-inner">
      <a class="brand" href="#top" data-nav="home">
        <img class="brand-img" src="${CHUD}" alt="ObsiSync" />
        <span>${APP_NAME}</span>
      </a>
      <nav class="nav-links">
        ${navLinks.map(l => `<a href="#${l.id}">${l.label}</a>`).join('')}
      </nav>
      ${navRight()}
    </div>
  </header>

  <section class="hero" id="top">
    <div class="grid-bg"></div>
    <div class="container hero-inner">
      <div class="badge reveal" data-reveal>[ аккаунт, профиль, 2FA, файлы и приложение работают · автосинк в разработке ]</div>
      <h1 class="reveal" data-reveal style="--d:70ms">Твои заметки.<br/>Только твои.<br/>Навсегда.</h1>
      <p class="lead reveal" data-reveal style="--d:130ms">ObsiSync — свой сервер и свой клиент для Obsidian. Сделано по частям: сначала аккаунты и API, потом синхронизация и шифрование.</p>
      <div class="hero-actions reveal" data-reveal style="--d:190ms">
        <a class="btn btn-primary btn-lg" href="#download">Скачать приложение</a>
        <button class="btn btn-ghost btn-lg" data-nav-to="profile">Открыть профиль</button>
        <a class="btn btn-ghost btn-lg" href="#faq">Вопросы и ответы</a>
      </div>
      ${state.user ? '' : `<button class="hero-auth reveal" data-reveal style="--d:230ms" data-open-auth="register">[ создать аккаунт ]</button>`}
      ${heroWindowHtml()}
    </div>
  </section>
`
}

function heroWindowHtml () {
  const title = state.user ? `obsisync · @${state.user.username} · активность` : 'obsisync · api'
  const body = (state.user && state.activity)
    ? contribHtml(true)
    : `
      <ul class="api-list">
        <li><b>POST</b> /api/register <span>создать аккаунт</span></li>
        <li><b>POST</b> /api/login <span>войти (+ TOTP)</span></li>
        <li><b>GET</b> /api/me <span>юзер и профиль</span></li>
        <li><b>PUT</b> /api/profile <span>био и тема</span></li>
        <li><b>GET</b> /api/sessions <span>устройства</span></li>
        <li><b>GET</b> /api/activity <span>календарь операций</span></li>
      </ul>`

  return `
    <div class="hero-window reveal" data-reveal style="--d:300ms">
      <div class="win-bar">
        <span class="win-dot r"></span><span class="win-dot y"></span><span class="win-dot g"></span>
        <span class="win-title">${title}</span>
      </div>
      <div class="win-body">${body}</div>
    </div>
  `
}

const featuresHtml = `
  <section class="section" id="features">
    <div class="container">
      <div class="sec-head reveal" data-reveal>
        <div class="sec-eyebrow">[ 01 · возможности ]</div>
        <h2>Что уже есть</h2>
        <p>Только то, что реально работает на сервере. Что не работает — помечено.</p>
      </div>
      <div class="grid-features">
        ${features.map((f, i) => `
          <div class="card feature bevel reveal" data-reveal style="--d:${i * 70}ms">
            <div class="feature-top">
              <div class="feature-icon">${icons[f.icon]}</div>
              <span class="status-badge status-${statusClass[f.status]}">${f.status}</span>
            </div>
            <h3>${f.title}</h3>
            <p>${f.text}</p>
          </div>`).join('')}
      </div>
    </div>
  </section>
`

const howHtml = `
  <section class="section section-alt" id="how">
    <div class="container">
      <div class="sec-head reveal" data-reveal>
        <div class="sec-eyebrow">[ 02 · как это работает ]</div>
        <h2>Три шага</h2>
        <p>Работают все три: аккаунт, профиль и приложение с файлами.</p>
      </div>
      <div class="grid-steps">
        ${steps.map((s, i) => `
          <div class="step bevel reveal" data-reveal style="--d:${i * 90}ms">
            <div class="step-num">${s.num}</div>
            <h3>${s.title}</h3>
            <p>${s.text}</p>
          </div>`).join('')}
      </div>
    </div>
  </section>
`

function faqHtml () {
return `
  <section class="section" id="faq">
    <div class="container">
      <div class="sec-head reveal" data-reveal>
        <div class="sec-eyebrow">[ 04 · вопросы ]</div>
        <h2>Всё о проекте</h2>
        <p>Частые вопросы — вся важная информация в одном месте.</p>
      </div>
      <div class="faq-list">
        ${faq.map((item, i) => `
          <details class="faq-item reveal" data-reveal style="--d:${i * 50}ms">
            <summary>${item.q}</summary>
            <p>${item.a}</p>
          </details>`).join('')}
      </div>
      ${state.user ? '' : `
        <div class="sec-foot reveal" data-reveal>
          <button class="btn btn-primary btn-lg" data-open-auth="register">Создать аккаунт</button>
          <span class="sec-foot-note mono">почта · юзернейм · пароль · 2FA опционально</span>
        </div>`}
    </div>
  </section>
`
}

const footer = `
  <footer class="footer">
    <div class="container">
      <div class="brand footer-brand">
        <img class="brand-img" src="${CHUD}" alt="ObsiSync" />
        <span>${APP_NAME}</span>
      </div>
      <div class="footer-word-container">
        <div class="footer-word">${APP_NAME}</div>
      </div>
      <div class="footer-links">
        ${navLinks.map(l => `<a href="#${l.id}">${l.label}</a>`).join('')}
        <button class="footer-link-btn" data-nav-to="profile">Профиль</button>
      </div>
      <p class="footer-copy">${COPY}</p>
    </div>
  </footer>
`

/* ── Профиль ──────────────────────────── */

function fmtJoined (createdAt) {
  const d = new Date((createdAt || '').replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return 'Присоединился недавно'
  return `Присоединился ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`
}

function fmtWhen (stamp) {
  const d = new Date((stamp || '').replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return '—'
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'только что'
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ', ' +
    d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function bannerHtml () {
  const img = state.profile.banner ? `<img class="banner-img" src="${state.profile.banner}" alt="" />` : ''
  return `<div class="banner banner-theme${state.profile.theme}">${img}<span class="banner-shade"></span></div>`
}

function avatarImg (extra = '') {
  const src = state.profile.avatar || CHUD
  return `<img class="avatar-img ${extra}" src="${src}" alt="аватар" />`
}

function editorHtml () {
  return `
  <section class="editor bevel" id="pf-editor">
    <div class="editor-head">
      <h2>Настройки профиля</h2>
      <span class="badge-sm">сохраняется на сервере</span>
    </div>
    <div class="editor-grid">
      <div class="editor-block">
        <div class="editor-label">О себе</div>
        <textarea class="bio-input" name="bio" maxlength="200" rows="3" placeholder="пару слов о себе">${escapeHtml(state.profile.bio || '')}</textarea>
        <div class="editor-row">
          <button class="btn btn-ghost btn-sm" data-save-bio>Сохранить био</button>
          <span class="editor-hint mono">до 200 символов</span>
        </div>
      </div>
      <div class="editor-block">
        <div class="editor-label">Аватар и баннер</div>
        <div class="editor-row">
          <div class="avatar avatar-md">${avatarImg()}</div>
          <div class="editor-actions">
            <button class="btn btn-ghost btn-sm" data-file="avatar">Загрузить аватар</button>
            ${state.profile.avatar ? '<button class="btn btn-ghost btn-sm" data-clear="avatar">По умолчанию</button>' : ''}
            <span class="editor-hint mono">png / jpg / webp, до 3 МБ</span>
          </div>
        </div>
        <div class="editor-row">
          <div class="banner-editor banner-theme${state.profile.theme}">${state.profile.banner ? `<img class="banner-img" src="${state.profile.banner}" alt="" />` : ''}<span class="banner-shade"></span></div>
          <div class="editor-actions">
            <button class="btn btn-ghost btn-sm" data-file="banner">Загрузить баннер</button>
            ${state.profile.banner ? '<button class="btn btn-ghost btn-sm" data-clear="banner">Без картинки</button>' : ''}
          </div>
        </div>
        <div class="editor-themes">
          ${[0, 1, 2, 3].map(t => `
            <button class="theme-swatch banner-theme${t} ${state.profile.theme === t ? 'on' : ''}" data-theme="${t}" title="тема ${t + 1}"></button>`).join('')}
        </div>
      </div>
    </div>
  </section>
`
}

function escapeHtml (s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function activityHtml () {
  const a = state.activity
  if (!a) {
    return state.activityError
      ? `<div class="empty-note">Сервер не ответил — активность не загрузилась. Обнови страницу, когда API поднимется.</div>`
      : `<p class="panel-note">Загружаю активность…</p>`
  }
  if (a.total === 0) {
    return `
      <div class="ct-count"><strong>0</strong> операций за период</div>
      <div class="empty-note">Пока пусто: синк ещё не подключён, поэтому операций нет. Здесь появится календарь, когда плагин начнёт отправлять изменения.</div>
      ${contribHtml()}`
  }
  return `
    <div class="ct-count"><strong>${a.total}</strong> операций за период</div>
    ${contribHtml()}`
}

function breakdownHtml () {
  const a = state.activity
  if (!a || a.breakdown.length === 0) return `<div class="empty-note">Данных пока нет.</div>`
  const colorFor = { created: 'new', updated: 'upd', deleted: 'del', conflict: 'conf' }
  return a.breakdown.map(b => `
    <div class="br-row">
      <span class="br-label">${KIND_LABELS[b.kind] || b.kind}</span>
      <div class="br-track"><div class="br-fill ${colorFor[b.kind] || 'upd'}" style="--w:${Math.round((b.count / a.total) * 100)}%"></div></div>
      <span class="br-num">${b.count}</span>
    </div>`).join('')
}

function topFilesHtml () {
  const a = state.activity
  if (!a || a.topFiles.length === 0) return `<div class="empty-note">Правок пока нет — список появится после первых синков.</div>`
  const max = a.topFiles[0].count
  return `<ul class="tf-list">${a.topFiles.map(t => `
    <li class="tf-item">
      <span class="tf-name mono">${escapeHtml(t.path)}</span>
      <div class="tf-track"><div class="tf-fill" style="--w:${Math.round((t.count / max) * 100)}%"></div></div>
      <span class="tf-num">${t.count}</span>
    </li>`).join('')}</ul>`
}

function devicesHtml () {
  if (!state.sessions.length) return `<div class="empty-note">Сессий нет.</div>`
  return `<ul class="devices">${state.sessions.map(s => `
    <li class="device">
      <span class="device-icon">${icons.device}</span>
      <div>
        <div class="device-name">${escapeHtml(s.label)}${s.current ? ' <span class="badge-sm">это устройство</span>' : ''}</div>
        <div class="device-last">${escapeHtml(s.ip || '—')} · вход ${fmtWhen(s.createdAt)} · был ${fmtWhen(s.lastSeen)}</div>
      </div>
      ${s.current ? '<span class="dot dot-ok"></span>' : `<button class="btn btn-ghost btn-sm" data-revoke="${s.id}">Отозвать</button>`}
    </li>`).join('')}</ul>`
}

function securityHtml () {
  return `
  <section class="panel bevel reveal" data-reveal id="pf-security">
    <div class="panel-head"><h2>Безопасность</h2></div>

    <div class="sec-block">
      <div class="sec-block-head">Смена пароля</div>
      <form class="stack-form" data-pw-form>
        <input name="currentPassword" type="password" autocomplete="current-password" placeholder="текущий пароль" required />
        <input name="newPassword" type="password" autocomplete="new-password" placeholder="новый пароль, минимум 8 символов" minlength="8" required />
        <button class="btn btn-ghost btn-sm" type="submit">Сменить пароль</button>
      </form>
      <p class="panel-note">После смены все остальные сессии отзываются.</p>
    </div>

    <div class="sec-block">
      <div class="sec-block-head">Двухфакторная защита (TOTP)</div>
      ${state.user.twoFa ? `
        <p class="panel-note">2FA включена. При входе потребуется код из аутентификатора.</p>
        <form class="stack-form" data-2fa-disable>
          <input name="code" inputmode="numeric" maxlength="6" placeholder="код из аутентификатора" required />
          <button class="btn btn-ghost btn-sm" type="submit">Отключить 2FA</button>
        </form>`
      : state.twofaSetup ? `
        <p class="panel-note">Введи этот секрет в аутентификатор, затем подтверди первым кодом:</p>
        <div class="secret-row mono">${state.twofaSetup.secret}</div>
        <form class="stack-form" data-2fa-enable>
          <input name="code" inputmode="numeric" maxlength="6" placeholder="код из аутентификатора" required />
          <button class="btn btn-primary btn-sm" type="submit">Подтвердить и включить</button>
        </form>
        <button class="btn btn-ghost btn-sm" data-2fa-cancel>Отмена</button>`
      : `
        <p class="panel-note">Сервер выдаст секрет — добавь его в Google Authenticator, Aegis или 1Password.</p>
        <button class="btn btn-ghost btn-sm" data-2fa-setup>Включить 2FA</button>`}
    </div>

    <div class="sec-block danger">
      <div class="sec-block-head">Удаление аккаунта</div>
      <form class="stack-form" data-delete-form>
        <input name="password" type="password" autocomplete="current-password" placeholder="пароль для подтверждения" required />
        <button class="btn btn-ghost btn-sm btn-danger" type="submit">Удалить аккаунт навсегда</button>
      </form>
    </div>
  </section>
`
}

function profileHtml () {
  const stats = state.activity || { total: 0, activeDays: 0, bestStreak: 0, week: 0 }
  return `
  <header class="nav">
    <div class="container nav-inner">
      <a class="brand" href="#top" data-nav="home">
        <img class="brand-img" src="${CHUD}" alt="ObsiSync" />
        <span>${APP_NAME}</span>
      </a>
      <span class="nav-tag">профиль · ${state.user.username}</span>
      <div class="pf-nav-btns">
        <button class="btn btn-ghost btn-sm" data-nav-to="home">← на главную</button>
        <button class="btn btn-ghost btn-sm" data-logout>Выйти</button>
      </div>
    </div>
  </header>
  ${bannerHtml()}
  <div class="profile-wrap">
    <div class="pf-head container">
      <div class="avatar">${avatarImg()}</div>
      <div class="pf-main">
        <h1>${escapeHtml(state.user.username)}</h1>
        <div class="pf-handle">@${escapeHtml(state.user.username)} · ${escapeHtml(state.user.email)}</div>
        <div class="pf-bio">${escapeHtml(state.profile.bio || 'Пока без описания — нажми «Настроить профиль».')}</div>
        <div class="pf-meta">
          <span class="pf-item">${icons.clock}<span>${fmtJoined(state.user.createdAt)}</span></span>
          <span class="pf-sep">·</span>
          <span class="pf-item">${icons.shield}<span>${state.user.twoFa ? '2FA включена' : '2FA выключена'}</span></span>
          <span class="pf-sep">·</span>
          <span class="pf-item">сессий: ${state.sessions.length}</span>
        </div>
      </div>
      <div class="pf-buttons">
        <button class="btn btn-ghost btn-sm" data-logout>Выйти</button>
        <button class="btn btn-primary btn-sm" data-toggle-edit>${state.editing ? 'Готово' : 'Настроить профиль'}</button>
      </div>
    </div>

    <div class="container">
      ${state.editing ? editorHtml() : ''}

      <div class="pf-stats reveal" data-reveal>
        <div class="stat-card bevel"><strong data-count="${stats.total}">0</strong><span>изменений за год</span></div>
        <div class="stat-card bevel"><strong data-count="${stats.activeDays}">0</strong><span>активных дней</span></div>
        <div class="stat-card bevel"><strong data-count="${stats.bestStreak}">0</strong><span>лучшая серия, дней</span></div>
        <div class="stat-card bevel"><strong data-count="${stats.week}">0</strong><span>изменений за 7 дней</span></div>
      </div>

      <div class="two-col">
        <section class="panel bevel reveal" data-reveal>
          <div class="panel-head">
            <h2>Активность</h2>
            <span class="badge-sm">из API</span>
          </div>
          ${activityHtml()}
        </section>
        <section class="panel bevel reveal" data-reveal style="--d:80ms">
          <div class="panel-head"><h2>По типам действий</h2></div>
          <div class="br-list">${breakdownHtml()}</div>
          <div class="panel-head top-head"><h2>Чаще всего правили</h2></div>
          ${topFilesHtml()}
        </section>
      </div>

      <div class="two-col">
        <section class="panel bevel reveal" data-reveal>
          <div class="panel-head"><h2>Устройства</h2><span class="badge-sm">реальные сессии</span></div>
          ${devicesHtml()}
          <p class="panel-note">Отзыв отзывает токен на сервере — устройство выкинет на экран входа.</p>
        </section>
        <section class="panel bevel reveal" data-reveal style="--d:80ms">
          <div class="panel-head"><h2>Про профиль</h2></div>
          <div class="about-grid">
            <div><span>Имя</span>${escapeHtml(state.user.username)}</div>
            <div><span>Email</span>${escapeHtml(state.user.email)}</div>
            <div><span>Био</span>${escapeHtml(state.profile.bio || '—')}</div>
            <div><span>Сессий</span>${state.sessions.length}</div>
            <div><span>Баннер</span>${state.profile.banner ? 'картинка с сервера' : 'тема ' + (state.profile.theme + 1)}</div>
          </div>
          <p class="panel-note">Аватар и баннер лежат на сервере в /uploads и доступны с любого устройства.</p>
        </section>
      </div>

      ${securityHtml()}
    </div>
  </div>

  <input type="file" id="pf-file-avatar" accept="image/*" hidden />
  <input type="file" id="pf-file-banner" accept="image/*" hidden />
  <div class="dash-foot">${COPY}</div>
`
}

function profileLockedHtml () {
  return `
  <header class="nav">
    <div class="container nav-inner">
      <a class="brand" href="#top" data-nav="home">
        <img class="brand-img" src="${CHUD}" alt="ObsiSync" />
        <span>${APP_NAME}</span>
      </a>
      <span class="nav-tag">профиль</span>
      <button class="btn btn-ghost btn-sm" data-nav-to="home">← на главную</button>
    </div>
  </header>
  <section class="section">
    <div class="container">
      <div class="sec-head reveal" data-reveal>
        <div class="sec-eyebrow">[ профиль ]</div>
        <h2>Нужен вход</h2>
        <p>Профиль, устройства и активность живут на сервере и привязаны к аккаунту. Демо-данных тут больше не будет.</p>
      </div>
      <div class="sec-foot reveal" data-reveal>
        <button class="btn btn-primary btn-lg" data-open-auth="login">Войти</button>
        <button class="btn btn-ghost btn-lg" data-open-auth="register">Создать аккаунт</button>
      </div>
    </div>
  </section>
  <div class="dash-foot">${COPY}</div>
`
}

/* ── Модалка входа/регистрации ─────────── */

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function authFormHtml (mode) {
  if (mode === 'register') {
    return `
      <div class="field">
        <label for="auth-email">Почта</label>
        <input id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@example.ru" required />
      </div>
      <div class="field">
        <label for="auth-username">Юзернейм</label>
        <input id="auth-username" name="username" type="text" autocomplete="username" placeholder="от 3 до 24 символов" minlength="3" maxlength="24" required />
      </div>
      <div class="field">
        <label for="auth-pass">Пароль</label>
        <input id="auth-pass" name="password" type="password" autocomplete="new-password" placeholder="минимум 8 символов" minlength="8" required />
      </div>
      <button class="btn btn-primary btn-lg btn-block" data-auth-submit>Создать аккаунт</button>
      <p class="auth-swap">Уже есть аккаунт? <button data-mode="login">Войти</button></p>
      <p class="auth-profile-note mono">2FA включается потом — в профиле, раздел «Безопасность»</p>`
  }
  if (state.verify) {
    return `
      <div class="auth-2fa">
        <div class="mono auth-2fa-label">шаг 2 из 2 · код из аутентификатора</div>
        <div class="field">
          <label for="auth-code">Код</label>
          <input id="auth-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" required />
        </div>
        <button class="btn btn-primary btn-lg btn-block" data-auth-submit>Подтвердить</button>
        <p class="auth-swap"><button data-back-login>← поменять почту / пароль</button></p>
      </div>`
  }
  return `
    <div class="field">
      <label for="auth-email">Почта</label>
      <input id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@example.ru" required />
    </div>
    <div class="field">
      <label for="auth-pass">Пароль</label>
      <input id="auth-pass" name="password" type="password" autocomplete="current-password" placeholder="пароль" required />
    </div>
    <button class="btn btn-primary btn-lg btn-block" data-auth-submit>Войти</button>
    <p class="auth-swap">Нет аккаунта? <button data-mode="register">Зарегистрироваться</button></p>`
}

function authOverlayHtml () {
  const mode = state.overlay.mode
  return `
    <div class="auth-overlay" data-auth-overlay>
      <div class="auth-card bevel">
        <button class="auth-close" data-close-auth title="закрыть">✕</button>
        <img class="auth-logo" src="${CHUD}" alt="" />
        <h2>${mode === 'register' ? 'Создать аккаунт' : (state.verify ? 'С двухфакторкой' : 'С возвращением')}</h2>
        <p class="auth-sub">${mode === 'register'
          ? 'Почта, юзернейм и пароль — хватит, чтобы начать.'
          : (state.verify ? 'Подтверди кодом из аутентификатора.' : 'Войти в ObsiSync.')}</p>
        <form class="auth-form" novalidate>${authFormHtml(mode)}</form>
        <p class="auth-error" data-auth-error></p>
      </div>
    </div>`
}

/* ── Действия ─────────────────────────── */

function go (view) {
  state.view = view
  render()
  window.scrollTo({ top: 0 })
}

function flash (text, tone = 'ok') {
  state.flash = { text, tone }
  const toast = document.createElement('div')
  toast.className = `toast toast-${tone}`
  toast.textContent = text
  document.body.appendChild(toast)
  setTimeout(() => {
    toast.classList.add('out')
    setTimeout(() => toast.remove(), 350)
  }, 2800)
}

function setAuth (token, user) {
  state.token = token
  state.user = user
  persistAuth()
}

async function doLogout () {
  try { await api('/api/logout', { method: 'POST', token: state.token }) } catch {}
  state.token = null
  state.user = null
  state.activity = null
  state.sessions = []
  state.profile = { bio: '', avatar: null, banner: null, theme: 0 }
  persistAuth()
  state.overlay = null
  state.verify = null
  go('home')
  flash('Вы вышли')
}

async function submitAuth (rootEl) {
  const errEl = rootEl.querySelector('[data-auth-error]')
  const setErr = msg => {
    errEl.textContent = msg || ''
    errEl.style.display = msg ? 'block' : 'none'
  }
  setErr('')
  const form = rootEl.querySelector('.auth-form')
  const value = n => (form.querySelector(`[name="${n}"]`) || {}).value?.trim() || ''

  try {
    if (state.overlay.mode === 'register') {
      const email = value('email')
      const username = value('username')
      const password = value('password')
      if (!emailRe.test(email)) return setErr('почта не похожа на почту')
      if (username.length < 3 || username.length > 24) return setErr('юзернейм — от 3 до 24 символов')
      if (password.length < 8) return setErr('пароль — минимум 8 символов')

      const { status, data } = await api('/api/register', { method: 'POST', body: { username, email, password } })
      if (status !== 201) return setErr(data?.error || 'не удалось зарегистрироваться')
      setAuth(data.token, data.user)
      state.profile = data.profile
      closeAuth()
      await refreshAccount()
      go('profile')
      flash('Аккаунт создан — добро пожаловать!')
      return
    }

    if (!state.verify) {
      const email = value('email')
      const password = value('password')
      if (!emailRe.test(email)) return setErr('почта не похожа на почту')
      if (!password) return setErr('введи пароль')

      const { status, data } = await api('/api/login', { method: 'POST', body: { email, password } })
      if (status !== 200) return setErr(data?.error || 'не удалось войти')
      if (data.step === 'verify') {
        state.verify = { verifyToken: data.verifyToken }
        render()
        flash('Нужен код из аутентификатора')
        return
      }
      setAuth(data.token, data.user)
      closeAuth()
      await refreshAccount()
      go('profile')
      flash('С возвращением!')
      return
    }

    const code = value('code')
    if (!/^\d{6}$/.test(code)) return setErr('код — 6 цифр')
    const { status, data } = await api('/api/login/verify', { method: 'POST', body: { verifyToken: state.verify.verifyToken, code } })
    if (status !== 200) return setErr(data?.error || 'код не принят')
    setAuth(data.token, data.user)
    closeAuth()
    await refreshAccount()
    go('profile')
    flash('Вход подтверждён!')
  } catch (e) {
    setErr(e.message)
  }
}

/* ── Работа с картинками и формами ─────── */

function readFileAsDataUrl (file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error('не удалось прочитать файл'))
    r.readAsDataURL(file)
  })
}

async function uploadImage (target, file) {
  if (!file.type.startsWith('image/')) return flash('нужен файл-картинка', 'bad')
  if (file.size > 3 * 1024 * 1024) return flash('картинка больше 3 МБ — возьми меньше', 'bad')

  let image
  try {
    image = await readFileAsDataUrl(file)
  } catch (e) {
    return flash(e.message, 'bad')
  }

  const { status, data } = await api(`/api/profile/${target}`, { method: 'POST', body: { image }, token: state.token })
  if (status !== 200) return flash(data?.error || 'не удалось загрузить', 'bad')
  state.profile = data.profile
  render()
  flash(target === 'avatar' ? 'Аватар загружен на сервер' : 'Баннер загружен на сервер')
}

async function patchProfile (patch, okText) {
  const { status, data } = await api('/api/profile', { method: 'PUT', body: patch, token: state.token })
  if (status !== 200) return flash(data?.error || 'не удалось сохранить', 'bad')
  state.profile = data.profile
  render()
  if (okText) flash(okText)
}

async function clearImage (target) {
  const { status, data } = await api(`/api/profile/${target}`, { method: 'DELETE', token: state.token })
  if (status !== 200) return flash(data?.error || 'не удалось удалить', 'bad')
  state.profile = data.profile
  render()
  flash('Сброшено')
}

function bindFile (rootEl, target) {
  const inp = rootEl.querySelector(`#pf-file-${target}`)
  const btn = rootEl.querySelector(`[data-file="${target}"]`)
  if (!inp || !btn) return
  btn.addEventListener('click', () => {
    inp.value = ''
    inp.click()
  })
  inp.addEventListener('change', () => {
    const file = inp.files && inp.files[0]
    if (file) uploadImage(target, file)
  })
}

/* ── Рендер и события ─────────────────── */

function render () {
  const appEl = document.querySelector('#app')
  const home = heroHtml() + featuresHtml + howHtml + downloadHtml() + faqHtml() + footer
  const body = state.view === 'home'
    ? home
    : (state.user ? profileHtml() : profileLockedHtml())
  appEl.innerHTML = body + (state.overlay ? authOverlayHtml() : '')

  appEl.querySelectorAll('[data-nav-to]').forEach(b => {
    b.addEventListener('click', () => go(b.dataset.navTo))
  })
  appEl.querySelectorAll('[data-nav]').forEach(a => {
    a.addEventListener('click', e => {
      if (a.dataset.nav !== 'home') return
      e.preventDefault()
      state.view = 'home'
      render()
      window.scrollTo({ top: 0 })
    })
  })
  appEl.querySelectorAll('[data-logout]').forEach(b => b.addEventListener('click', doLogout))
  appEl.querySelectorAll('[data-open-auth]').forEach(b => {
    b.addEventListener('click', () => {
      state.overlay = { type: 'auth', mode: b.dataset.openAuth || 'register' }
      state.verify = null
      render()
    })
  })

  if (state.view === 'profile' && state.user) {
    const editBtn = appEl.querySelector('[data-toggle-edit]')
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        state.editing = !state.editing
        render()
      })
    }

    if (state.editing) {
      bindFile(appEl, 'avatar')
      bindFile(appEl, 'banner')

      appEl.querySelectorAll('[data-clear]').forEach(b => {
        b.addEventListener('click', () => clearImage(b.dataset.clear))
      })
      appEl.querySelectorAll('[data-theme]').forEach(b => {
        b.addEventListener('click', () => patchProfile({ theme: +b.dataset.theme }))
      })
      appEl.querySelector('[data-save-bio]')?.addEventListener('click', () => {
        const bio = appEl.querySelector('.bio-input')?.value ?? ''
        patchProfile({ bio }, 'Био сохранено')
      })
    }

    appEl.querySelectorAll('[data-revoke]').forEach(b => {
      b.addEventListener('click', async () => {
        const { status, data } = await api(`/api/sessions/${b.dataset.revoke}`, { method: 'DELETE', token: state.token })
        if (status !== 204) return flash(data?.error || 'не удалось отозвать', 'bad')
        const s = await api('/api/sessions', { token: state.token })
        if (s.status === 200) state.sessions = s.data.sessions
        render()
        flash('Сессия отозвана')
      })
    })

    appEl.querySelector('[data-pw-form]')?.addEventListener('submit', async e => {
      e.preventDefault()
      const f = e.target
      const { status, data } = await api('/api/profile/password', {
        method: 'POST',
        body: { currentPassword: f.currentPassword.value, newPassword: f.newPassword.value },
        token: state.token
      })
      if (status !== 204) return flash(data?.error || 'не удалось сменить пароль', 'bad')
      const s = await api('/api/sessions', { token: state.token })
      if (s.status === 200) state.sessions = s.data.sessions
      render()
      flash('Пароль обновлён, остальные сессии отозваны')
    })

    appEl.querySelector('[data-2fa-setup]')?.addEventListener('click', async () => {
      const { status, data } = await api('/api/2fa/setup', { method: 'POST', body: {}, token: state.token })
      if (status !== 200) return flash(data?.error || 'не удалось получить секрет', 'bad')
      state.twofaSetup = data
      render()
    })

    appEl.querySelector('[data-2fa-cancel]')?.addEventListener('click', () => {
      state.twofaSetup = null
      render()
    })

    appEl.querySelector('[data-2fa-enable]')?.addEventListener('submit', async e => {
      e.preventDefault()
      const code = e.target.code.value
      const { status, data } = await api('/api/2fa/enable', { method: 'POST', body: { code }, token: state.token })
      if (status !== 200) return flash(data?.error || 'код не принят', 'bad')
      state.user = data.user
      state.twofaSetup = null
      persistAuth()
      render()
      flash('2FA включена')
    })

    appEl.querySelector('[data-2fa-disable]')?.addEventListener('submit', async e => {
      e.preventDefault()
      const code = e.target.code.value
      const { status, data } = await api('/api/2fa/disable', { method: 'POST', body: { code }, token: state.token })
      if (status !== 200) return flash(data?.error || 'код не принят', 'bad')
      state.user = data.user
      persistAuth()
      render()
      flash('2FA отключена')
    })

    appEl.querySelector('[data-delete-form]')?.addEventListener('submit', async e => {
      e.preventDefault()
      const password = e.target.password.value
      if (!confirm('Удалить аккаунт вместе с профилем? Это необратимо.')) return
      const { status, data } = await api('/api/account', { method: 'DELETE', body: { password }, token: state.token })
      if (status !== 204) return flash(data?.error || 'не удалось удалить', 'bad')
      state.token = null
      state.user = null
      state.activity = null
      state.sessions = []
      state.profile = { bio: '', avatar: null, banner: null, theme: 0 }
      persistAuth()
      go('home')
      flash('Аккаунт удалён')
    })
  }

  if (state.overlay) {
    const overlay = appEl.querySelector('[data-auth-overlay]')
    if (overlay) {
      const close = () => closeAuth()
      overlay.querySelectorAll('[data-close-auth]').forEach(b => b.addEventListener('click', close))
      overlay.addEventListener('click', e => { if (e.target === overlay) close() })
      overlay.querySelectorAll('[data-mode]').forEach(b =>
        b.addEventListener('click', () => {
          state.overlay.mode = b.dataset.mode
          state.verify = null
          render()
        }))
      overlay.querySelectorAll('[data-back-login]').forEach(b =>
        b.addEventListener('click', () => {
          state.verify = null
          render()
        }))
      const form = overlay.querySelector('.auth-form')
      if (form) form.addEventListener('submit', e => { e.preventDefault(); submitAuth(overlay) })
    }
    appEl.querySelector('#auth-email, #auth-code')?.focus()
  }

  initReveal(appEl)
}

function closeAuth () {
  state.overlay = null
  state.verify = null
  render()
}

function initReveal (root) {
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return
      const el = entry.target
      el.classList.add('in')
      io.unobserve(el)
      el.querySelectorAll('[data-count]').forEach(cnt => {
        if (cnt.dataset.done) return
        cnt.dataset.done = '1'
        animateCount(cnt, +cnt.dataset.count)
      })
    })
  }, { threshold: 0.15 })

  root.querySelectorAll('[data-reveal]').forEach(el => io.observe(el))
}

function animateCount (el, to, duration = 1000) {
  const start = performance.now()
  const step = now => {
    const p = Math.min(1, (now - start) / duration)
    const eased = 1 - Math.pow(1 - p, 3)
    el.textContent = Math.round(to * eased).toLocaleString('ru-RU')
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/* ── Старт ────────────────────────────── */

// Esc закрывает модалку входа, даже когда фокус не в её полях
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.overlay) closeAuth()
})

async function boot () {
  const [manifest] = await Promise.all([
    fetch('/downloads/manifest.json').then(r => (r.ok ? r.json() : null)).catch(() => null),
    refreshAccount()
  ])
  state.manifest = manifest
}

boot().finally(render)
