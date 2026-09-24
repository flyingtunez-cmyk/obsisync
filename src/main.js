import './style.css'

const API_BASE = 'http://localhost:3000'
const CHUD = '/chud.png'

const state = {
  view: 'home',
  token: localStorage.getItem('obsisync:token') || null,
  user: JSON.parse(localStorage.getItem('obsisync:user') || 'null'),
  overlay: null,
  verify: null,
  editing: false,
  profile: JSON.parse(localStorage.getItem('obsisync:profile') || '{"avatar":null,"banner":null,"theme":0}'),
  flash: null
}

const APP_NAME = 'ObsiSync'
const COPY = '© 2026 ObsiSync · приватная синхронизация Obsidian · интерфейс-демо'

/* ── Хелперы хранилища ────────────────── */

function persistProfile () {
  localStorage.setItem('obsisync:profile', JSON.stringify(state.profile))
}
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

/* ── Контент ──────────────────────────── */

const navLinks = [
  { id: 'features', label: 'Возможности' },
  { id: 'how', label: 'Как это работает' },
  { id: 'faq', label: 'FAQ' }
]

const features = [
  { icon: 'lock', title: 'E2E шифрование', text: 'Заметки шифруются на устройстве. Сервер хранит только шифротекст и не может прочитать их даже при желании.' },
  { icon: 'server', title: 'Доступно 24/7', text: 'Сервис живёт на нашем сервере. Открыл Obsidian в любой точке мира — заметки на месте.' },
  { icon: 'clock', title: 'История версий', text: 'Каждое изменение сохраняется. Любой файл можно откатить на любую прошлую версию.' },
  { icon: 'conflict', title: 'Без потерь', text: 'Правки с разных устройств объединяются, конфликты не затираются — обе версии остаются.' },
  { icon: 'rss', title: 'Синк в реальном времени', text: 'Изменил заметку на ноутбуке — она уже на телефоне. Push, а не «подожди 10 минут».' },
  { icon: 'free', title: 'Бесплатно', text: 'Бесплатная альтернатива Obsidian Sync: без подписок и тарифов.' }
]

const steps = [
  { num: '01', title: 'Создай vault', text: 'В приложении создаётся хранилище и генерируется пара ключей шифрования — ключи остаются на устройстве.' },
  { num: '02', title: 'Подключи клиент', text: 'Obsidian-плагин или CLI: адрес сервера и ключ — и всё. Никакой настройки железа.' },
  { num: '03', title: 'Синхронизируй', text: 'Заметки, вложения и настройки доезжают на все устройства в реальном времени, с историей и откатом.' }
]

const faq = [
  { q: 'Как начать?', a: 'Кнопка «Регистрация» в шапке: нужны только почта, юзернейм и пароль. Пароль никто не хранит (хешируется), при желании можно включить двухфакторную проверку — тогда при входе придётся ввести код.' },
  { q: 'Что такое ObsiSync?', a: 'Это приватный сервис синхронизации для Obsidian — бесплатная альтернатива платной подписке Obsidian Sync. Заметки шифруются на устройстве и попадают на сервер только в виде шифротекста.' },
  { q: 'Чем отличается от оригинального Obsidian Sync?', a: 'Тем же, чем студент отличается от корпорации: бесплатно, без тарифов, и весь код можно посмотреть и разобрать. Функционально цели те же — Е2Е-шифрование, версии, синк в реальном времени.' },
  { q: 'Это правда бесплатно?', a: 'Да. Проект делается для шараги и для опыта, платных тарифов не планируется. Сервер берём в аренду и обслуживаем сами — это тоже часть учёбы.' },
  { q: 'Где хранятся данные?', a: 'На сервере, которым мы управляем (арендованный VPS). Но читать их не может никто: данные шифруются на вашем устройстве, до сервера доезжает только шифротекст и метаданные.' },
  { q: 'Как решаются конфликты, если отредактировать файл с двух устройств?', a: 'Обе версии сохраняются и помечаются. Синк не перезатирает данные вслепую — вы сами решаете, что оставить.' },
  { q: 'Что уже готово?', a: 'Сайт (лендинг + профиль), сервер с регистрацией, входом и двухфакторкой. Впереди: полноценный синк, клиент-плагин для Obsidian (TypeScript), шифрование и тесты.' },
  { q: 'На чём написано?', a: 'Стек: JavaScript, Node.js, SQLite, Docker. Фронтенд — Vite + ванильный JS/CSS. Клиент для Obsidian планируется на TypeScript. Всё разбирается в обучающих заметках.' },
  { q: 'Когда будет релиз?', a: 'Жёсткого дедлайна нет — это учебный проект, который делается аккуратно. Следующий шаг — накатить работающий сервер и подключить к нему синхронизацию.' },
  { q: 'Почему не Dropbox или Google Drive для заметок?', a: 'Они не понимают Obsidian: не отслеживают переименования, не делают версии заметок, не шифруют локально и хранят всё у себя. ObsiSync сделан именно под то, как Obsidian работает.' }
]

const fixtures = {
  name: 'frisk',
  handle: '@frisk',
  bio: 'Студент, пишет шараговый проект и свой первый настоящий сервис. Заметки — Obsidian.',
  joined: 'Присоединился в сентябре 2026',
  devices: [
    { name: 'Ноутбук — Linux (Hyprland)', last: 'только что', os: 'linux' },
    { name: 'Смартфон — Android', last: '9 минут назад', os: 'android' }
  ],
  topFiles: [
    { file: 'notes/project.md', n: 86 },
    { file: 'journal/2026-dnevnik.md', n: 64 },
    { file: 'ideas/features.md', n: 41 },
    { file: 'docs/architecture.md', n: 30 },
    { file: 'maps/dorozhnaya-karta.md', n: 24 }
  ]
}

/* ── Трекер активности (демо) ─────────── */

const WEEKS = 52

function mulberry32 (seed) {
  let a = seed | 0
  return function () {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildContrib () {
  const rnd = mulberry32(20260924)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - (WEEKS * 7 - 1))
  while (start.getDay() !== 1) start.setDate(start.getDate() + 1)

  const weeks = []
  for (let w = 0; w < WEEKS; w++) {
    const col = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(start)
      date.setDate(start.getDate() + w * 7 + d)
      let lvl = 0
      if (date <= today) {
        const r = rnd()
        lvl = r < 0.42 ? 0 : r < 0.68 ? 1 : r < 0.85 ? 2 : r < 0.95 ? 3 : 4
      }
      col.push({ lvl, date })
    }
    weeks.push(col)
  }

  const monthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
  const labels = []
  let lastM = -1
  weeks.forEach((col, i) => {
    const m = col[6].date.getMonth()
    if (m !== lastM) { lastM = m; labels.push({ i, name: monthNames[m] }) }
  })

  return { weeks, labels }
}

const contrib = buildContrib()

function activityStats () {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = []
  contrib.weeks.forEach(col => col.forEach(c => { if (c.date <= today) days.push(c) }))
  days.sort((a, b) => a.date - b.date)

  let total = 0
  let week = 0
  let active = 0
  let streak = 0
  let best = 0
  days.forEach(c => {
    const diff = (today - c.date) / 864e5
    if (diff < 7) week += c.lvl
    if (c.lvl > 0) {
      total += c.lvl
      active++
      streak++
      if (streak > best) best = streak
    } else {
      streak = 0
    }
  })

  const share = n => Math.max(1, Math.round(total * n))
  return {
    total,
    week,
    active,
    best,
    breakdown: [
      { label: 'изменено', n: share(0.66), color: 'upd' },
      { label: 'создано', n: share(0.18), color: 'new' },
      { label: 'удалено', n: share(0.09), color: 'del' },
      { label: 'конфликтов', n: share(0.07), color: 'conf' }
    ]
  }
}

const stats = activityStats()

function contribHtml (mini = false) {
  const cells = contrib.weeks.map((col, w) =>
    col.map(c => `<div class="gcell lvl${c.lvl}" style="--i:${w}" title="${c.date.toLocaleDateString('ru-RU')} · уровень ${c.lvl} · демо"></div>`).join('')
  ).join('')
  const months = contrib.labels.map(l => `<b style="left:${l.i * 15}px">${l.name}</b>`).join('')
  return `
    <div class="ct-wrap ${mini ? 'ct-mini' : ''} reveal" data-reveal>
      <div class="ct-grid">
        <div class="ct-days"><i></i><i>пн</i><i></i><i>ср</i><i></i><i>пт</i><i></i></div>
        <div class="ct-cols">${cells}</div>
      </div>
      ${mini ? '' : `<div class="ct-months">${months}</div>`}
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
  free: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.8 6.7 19.1l1-5.8L3.5 9.2l5.9-.9z"/></svg>`,
  device: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/></svg>`
}

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
      <div class="badge reveal" data-reveal>[ бесплатная альтернатива obsidian sync · open source ]</div>
      <h1 class="reveal" data-reveal style="--d:70ms">Твои заметки.<br/>Только твои.<br/>Навсегда.</h1>
      <p class="lead reveal" data-reveal style="--d:130ms">ObsiSync — приватная синхронизация Obsidian: E2E-шифрование, история версий и синк в реальном времени. Без подписки.</p>
      <div class="hero-actions reveal" data-reveal style="--d:190ms">
        <button class="btn btn-primary btn-lg" data-nav-to="profile">Открыть профиль</button>
        <a class="btn btn-ghost btn-lg" href="#faq">Вопросы и ответы</a>
      </div>
      ${state.user ? '' : `<button class="hero-auth reveal" data-reveal style="--d:230ms" data-open-auth="register">[ создать аккаунт ]</button>`}
      <div class="hero-window reveal" data-reveal style="--d:300ms">
        <div class="win-bar">
          <span class="win-dot r"></span><span class="win-dot y"></span><span class="win-dot g"></span>
          <span class="win-title">obsisync · ${state.user ? '@' + state.user.username : 'профиль frisk'} · активность</span>
        </div>
        <div class="win-body">${contribHtml(true)}</div>
      </div>
    </div>
  </section>
`
}

const featuresHtml = `
  <section class="section" id="features">
    <div class="container">
      <div class="sec-head reveal" data-reveal>
        <div class="sec-eyebrow">[ 01 · возможности ]</div>
        <h2>Почему ObsiSync</h2>
        <p>Всё, за что Obsidian берёт деньги, здесь бесплатно — и железо можно не настраивать.</p>
      </div>
      <div class="grid-features">
        ${features.map((f, i) => `
          <div class="card feature bevel reveal" data-reveal style="--d:${i * 70}ms">
            <div class="feature-icon">${icons[f.icon]}</div>
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
        <h2>Три шага до синка</h2>
        <p>Никакой настройки железа и облаков — всё внутри приложения.</p>
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
        <div class="sec-eyebrow">[ 03 · вопросы ]</div>
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
          <span class="sec-foot-note mono">почта · юзернейм · пароль · опционально 2FA</span>
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
      <p class="footer-copy">${COPY} · демо-данные</p>
    </div>
  </footer>
`

/* ── Профиль ──────────────────────────── */

function fmtJoined (createdAt) {
  const d = new Date((createdAt || '').replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return 'Присоединился недавно'
  return `Присоединился ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`
}

function who () {
  if (state.user) {
    return {
      name: state.user.username,
      handle: '@' + state.user.username,
      email: state.user.email,
      joined: fmtJoined(state.user.createdAt),
      bio: 'Синхронизирует заметки через ObsiSync.',
      twoFa: state.user.twoFa
    }
  }
  return {
    name: fixtures.name,
    handle: fixtures.handle,
    email: 'frisk@obsisync.dev',
    joined: fixtures.joined,
    bio: fixtures.bio,
    twoFa: false
  }
}

function bannerHtml () {
  const img = state.profile.banner ? `<img class="banner-img" src="${state.profile.banner}" alt="" />` : ''
  return `<div class="banner banner-theme${state.profile.theme}">${img}<span class="banner-shade"></span></div>`
}

function avatarImg (extra = '') {
  const src = state.profile.avatar || CHUD
  return `<img class="avatar-img ${extra}" src="${src}" alt="аватар" />`
}

const editorHtml = `
  <section class="editor bevel" id="pf-editor">
    <div class="editor-head">
      <h2>Настройки профиля</h2>
      <span class="badge-sm">сохраняется локально</span>
    </div>
    <div class="editor-grid">
      <div class="editor-block">
        <div class="editor-label">Аватар</div>
        <div class="editor-row">
          <div class="avatar avatar-md">${avatarImg()}</div>
          <div class="editor-actions">
            <button class="btn btn-ghost btn-sm" data-file="avatar">Загрузить</button>
            ${state.profile.avatar ? '<button class="btn btn-ghost btn-sm" data-clear="avatar">По умолчанию</button>' : ''}
            <span class="editor-hint mono">png / jpg, до 3 МБ</span>
          </div>
        </div>
      </div>
      <div class="editor-block">
        <div class="editor-label">Баннер</div>
        <div class="editor-row">
          <div class="banner-editor banner-theme${state.profile.theme}">${state.profile.banner ? `<img class="banner-img" src="${state.profile.banner}" alt="" />` : ''}<span class="banner-shade"></span></div>
          <div class="editor-actions">
            <button class="btn btn-ghost btn-sm" data-file="banner">Загрузить изображение</button>
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

const breakdownHtml = stats.breakdown.map(b => `
  <div class="br-row">
    <span class="br-label">${b.label}</span>
    <div class="br-track"><div class="br-fill ${b.color}" style="--w:${Math.round((b.n / stats.total) * 100)}%"></div></div>
    <span class="br-num">${b.n}</span>
  </div>`).join('')

const topFilesHtml = fixtures.topFiles.map(t => `
  <li class="tf-item">
    <span class="tf-name mono">${t.file}</span>
    <div class="tf-track"><div class="tf-fill" style="--w:${Math.round((t.n / fixtures.topFiles[0].n) * 100)}%"></div></div>
    <span class="tf-num">${t.n}</span>
  </li>`).join('')

const devicesHtml = fixtures.devices.map(d => `
  <li class="device">
    <span class="device-icon">${icons.device}</span>
    <div>
      <div class="device-name">${d.name}</div>
      <div class="device-last">последний синк: ${d.last}</div>
    </div>
    <span class="dot dot-ok"></span>
  </li>`).join('')

function profileHtml () {
  const me = who()
  return `
  <header class="nav">
    <div class="container nav-inner">
      <a class="brand" href="#top" data-nav="home">
        <img class="brand-img" src="${CHUD}" alt="ObsiSync" />
        <span>${APP_NAME}</span>
      </a>
      <span class="nav-tag">профиль · ${state.user ? 'аккаунт' : 'демо'}</span>
      ${state.user
        ? '<div class="pf-nav-btns"><button class="btn btn-ghost btn-sm" data-nav-to="home">← на главную</button><button class="btn btn-ghost btn-sm" data-logout>Выйти</button></div>'
        : '<button class="btn btn-ghost btn-sm" data-open-login>← вход</button>'}
    </div>
  </header>
  <div class="demo-banner">
    ${state.user
      ? 'Аккаунт подключён к API. График активности — демо: подтянется после запуска синка.'
      : 'Демо-профиль: данные активности вымышлены. Зарегистрируйся, чтобы профиль стал настоящим.'}
  </div>
  ${bannerHtml()}
  <div class="profile-wrap">
    <div class="pf-head container">
      <div class="avatar">${avatarImg()}</div>
      <div class="pf-main">
        <h1>${me.name}</h1>
        <div class="pf-handle">${me.handle} · пользователь ObsiSync</div>
        <div class="pf-bio">${me.bio}</div>
        <div class="pf-meta">
          ${icons.clock}<span>${me.joined}</span>
          <span class="pf-sep">·</span>
          ${icons.shield}<span>тариф: бесплатно</span>
          ${me.twoFa ? `<span class="pf-sep">·</span><span>2FA: включено</span>` : ''}
        </div>
      </div>
      <div class="pf-buttons">
        ${state.user ? '<button class="btn btn-ghost btn-sm" data-logout>Выйти</button>' : ''}
        <button class="btn btn-primary btn-sm" data-toggle-edit>${state.editing ? 'Готово' : 'Настроить профиль'}</button>
      </div>
    </div>

    <div class="container">
      ${state.editing ? editorHtml : ''}

      <div class="pf-stats reveal" data-reveal>
        <div class="stat-card bevel"><strong data-count="${stats.total}">0</strong><span>изменений за год</span></div>
        <div class="stat-card bevel"><strong data-count="${stats.active}">0</strong><span>активных дней</span></div>
        <div class="stat-card bevel"><strong data-count="${stats.best}">0</strong><span>лучшая серия, дней</span></div>
        <div class="stat-card bevel"><strong data-count="${stats.week}">0</strong><span>изменений на этой неделе</span></div>
      </div>

      <div class="two-col">
        <section class="panel bevel reveal" data-reveal>
          <div class="panel-head">
            <h2>Активность синхронизации</h2>
            <span class="badge-sm">демо</span>
          </div>
          <div class="ct-count"><strong data-count="${stats.total}">0</strong> операций за период</div>
          ${contribHtml()}
        </section>
        <section class="panel bevel reveal" data-reveal style="--d:80ms">
          <div class="panel-head"><h2>По типам действий</h2></div>
          <div class="br-list">${breakdownHtml}</div>
          <div class="panel-head top-head"><h2>Чаще всего правили</h2></div>
          <ul class="tf-list">${topFilesHtml}</ul>
        </section>
      </div>

      <div class="two-col">
        <section class="panel bevel reveal" data-reveal>
          <div class="panel-head"><h2>Устройства</h2><span class="badge-sm">демо</span></div>
          <ul class="devices">${devicesHtml}</ul>
          <p class="panel-note">Push-синк разбудит другие устройства, когда в этом vault что-то изменится.</p>
        </section>
        <section class="panel bevel reveal" data-reveal style="--d:80ms">
          <div class="panel-head"><h2>Про профиль</h2></div>
          <div class="about-grid">
            <div><span>Имя</span>${me.name}</div>
            <div><span>Email</span>${me.email} ${state.user ? '' : '<i class="muted">(демо)</i>'}</div>
            <div><span>Тариф</span>бесплатно <i class="muted">(демо)</i></div>
            <div><span>Устройств</span>${fixtures.devices.length}</div>
            <div><span>Баннер</span>${state.profile.banner ? 'картинка' : 'тема ' + (state.profile.theme + 1)}</div>
          </div>
          <p class="panel-note">Аватар и баннер пока живут в браузере — после запуска синка переедут на сервер.</p>
        </section>
      </div>
    </div>
  </div>

  <input type="file" id="pf-file-avatar" accept="image/*" hidden />
  <input type="file" id="pf-file-banner" accept="image/*" hidden />
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
      <label class="auth-check">
        <input type="checkbox" name="twofa" />
        <span>Включить двухфакторную проверку — код из почты при каждом входе</span>
      </label>
      <button class="btn btn-primary btn-lg btn-block" data-auth-submit>Создать аккаунт</button>
      <p class="auth-swap">Уже есть аккаунт? <button data-mode="login">Войти</button></p>
      <p class="auth-profile-note mono">профиль ещё без картинок — добавишь после входа</p>`
  }
  if (state.verify) {
    return `
      <div class="auth-2fa">
        <div class="mono auth-2fa-label">шаг 2 из 2 · код из почты</div>
        <div class="field">
          <label for="auth-code">Код</label>
          <input id="auth-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" required />
        </div>
        <div class="auth-demo">
          Демо без почты: код ровно такой — <b>${state.verify.demoCode}</b>
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
          : (state.verify ? 'Подтверди, что это ты.' : 'Войти в ObsiSync.')}</p>
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
      const twoFa = form.querySelector('[name="twofa"]')?.checked
      if (!emailRe.test(email)) return setErr('почта не похожа на почту')
      if (username.length < 3 || username.length > 24) return setErr('юзернейм — от 3 до 24 символов')
      if (password.length < 8) return setErr('пароль — минимум 8 символов')

      const { status, data } = await api('/api/register', { method: 'POST', body: { username, email, password, twoFactor: !!twoFa } })
      if (status !== 201) return setErr(data?.error || 'не удалось зарегистрироваться')
      setAuth(data.token, data.user)
      closeAuth()
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
        state.verify = { verifyToken: data.verifyToken, demoCode: data.demoCode }
        render()
        flash('Код отправлен — введи его (демо: показан в карточке)')
        return
      }
      setAuth(data.token, data.user)
      closeAuth()
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
    go('profile')
    flash('Вход подтверждён!')
  } catch (e) {
    setErr(e.message)
  }
}

/* ── Рендер и события ─────────────────── */

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
    if (!file) return
    if (!file.type.startsWith('image/')) return flash('нужен файл-картинка', 'bad')
    if (file.size > 3 * 1024 * 1024) return flash('картинка больше 3 МБ — возьми меньше', 'bad')
    const r = new FileReader()
    r.onload = () => {
      state.profile[target] = r.result
      persistProfile()
      render()
      flash(target === 'avatar' ? 'Аватар обновлён' : 'Баннер обновлён')
    }
    r.readAsDataURL(file)
  })
}

function render () {
  const appEl = document.querySelector('#app')
  const home = heroHtml() + featuresHtml + howHtml + faqHtml() + footer
  appEl.innerHTML = (state.view === 'home' ? home : profileHtml())
    + (state.overlay ? authOverlayHtml() : '')

  appEl.querySelectorAll('[data-nav-to]').forEach(b => {
    b.addEventListener('click', () => {
      if (b.dataset.closeAuth) closeAuth()
      go(b.dataset.navTo)
    })
  })
  appEl.querySelectorAll('[data-nav]').forEach(a => {
    a.addEventListener('click', e => {
      if (a.dataset.nav === 'home') { state.view = 'home'; render(); }
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
  appEl.querySelectorAll('[data-open-login]').forEach(b => {
    b.addEventListener('click', () => {
      state.overlay = { type: 'auth', mode: 'login' }
      state.verify = null
      render()
    })
  })

  if (state.view === 'profile') {
    const editBtn = appEl.querySelector('[data-toggle-edit]')
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        state.editing = !state.editing
        render()
      })
    }
    bindFile(appEl, 'avatar')
    bindFile(appEl, 'banner')
    appEl.querySelectorAll('[data-clear]').forEach(b => {
      b.addEventListener('click', () => {
        state.profile[b.dataset.clear] = null
        persistProfile()
        render()
        flash('Сброшено')
      })
    })
    appEl.querySelectorAll('[data-theme]').forEach(b => {
      b.addEventListener('click', () => {
        state.profile.theme = +b.dataset.theme
        persistProfile()
        render()
      })
    })
  }

  if (state.overlay) {
    const overlay = appEl.querySelector('[data-auth-overlay]')
    if (overlay) {
      const close = () => closeAuth()
      overlay.querySelectorAll('[data-close-auth]').forEach(b => b.addEventListener('click', close))
      overlay.addEventListener('click', e => { if (e.target === overlay) close() })
      overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close() })
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
    appEl.querySelector('#auth-email')?.focus()
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

/* ── Старт: проверить сохранённый токен ─── */

async function boot () {
  if (!state.token) return
  const { status, data } = await api('/api/me', { token: state.token })
  if (status !== 200 || !data?.user) {
    state.token = null
    state.user = null
    persistAuth()
  } else {
    state.user = data.user
    persistAuth()
  }
}

boot().finally(render)