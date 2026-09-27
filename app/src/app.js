const root = document.getElementById('root')
const toastEl = document.getElementById('toast')

const state = {
  settings: null,
  screen: 'profile',
  user: null,
  profile: null,
  files: [],
  sessions: [],
  activity: null,
  busy: false,
  progress: null,
  selected: new Set(),
  prefix: '',
  authMode: 'login',
  verifyToken: null,
  codeRequired: false
}

/* ── утилиты ─────────────────────────────── */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]))

function human (n) {
  if (n < 1024) return `${n} Б`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} КБ`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} МБ`
  return `${(n / 1024 ** 3).toFixed(1)} ГБ`
}

let toastTimer
function toast (msg, isErr = false) {
  toastEl.textContent = msg
  toastEl.classList.toggle('err', isErr)
  toastEl.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastEl.hidden = true }, 3800)
}

async function api (path, opts = {}) {
  const r = await window.obsi.request({ path, ...opts })
  if (!r.ok) {
    const err = new Error(r.error || `HTTP ${r.status}`)
    err.status = r.status
    throw err
  }
  return r.json
}

function promptBox (title, text, initial = '') {
  return new Promise(resolve => {
    const ov = document.createElement('div')
    ov.className = 'overlay'
    ov.innerHTML = `
      <div class="modal">
        <h4>${esc(title)}</h4>
        <p>${esc(text)}</p>
        <input class="field" id="prompt-value" value="${esc(initial)}" />
        <div class="row" style="margin-top:16px">
          <button class="btn ghost" data-no>Отмена</button>
          <button class="btn primary" data-yes>Сохранить</button>
        </div>
      </div>`
    const input = ov.querySelector('#prompt-value')
    const done = v => { ov.remove(); resolve(v) }
    ov.addEventListener('click', e => {
      if (e.target === ov) done(null)
      if (e.target.dataset.yes !== undefined) done(input.value)
      if (e.target.dataset.no !== undefined) done(null)
    })
    ov.addEventListener('keydown', e => { if (e.key === 'Enter') done(input.value) })
    document.body.appendChild(ov)
    input.focus()
    input.select()
  })
}

function confirmBox (title, text) {
  return new Promise(resolve => {
    const ov = document.createElement('div')
    ov.className = 'overlay'
    ov.innerHTML = `
      <div class="modal">
        <h4>${esc(title)}</h4>
        <p>${esc(text)}</p>
        <div class="row">
          <button class="btn ghost" data-no>Отмена</button>
          <button class="btn danger" data-yes>Удалить</button>
        </div>
      </div>`
    ov.addEventListener('click', e => {
      if (e.target === ov) { ov.remove(); resolve(false) }
      if (e.target.dataset.yes !== undefined) { ov.remove(); resolve(true) }
      if (e.target.dataset.no !== undefined) { ov.remove(); resolve(false) }
    })
    document.body.appendChild(ov)
  })
}

/* ── вход ─────────────────────────────── */

function authHtml () {
  const mode = state.authMode
  return `
  <div class="auth">
    <img class="logo" src="icon.png" alt="" />
    <h1>ObsiSync</h1>
    <p class="sub">аккаунт, профиль и файлы vault — из одного окна</p>

    <div class="tabs">
      <button class="${mode === 'login' ? 'on' : ''}" data-mode="login">Вход</button>
      <button class="${mode === 'register' ? 'on' : ''}" data-mode="register">Регистрация</button>
    </div>

    <form id="auth-form">
      <input class="field" type="email" name="email" placeholder="почта" required
             value="${esc(state.form?.email || '')}" />
      ${mode === 'register' ? `<input class="field" name="username" placeholder="юзернейм" required value="${esc(state.form?.username || '')}" />` : ''}
      <input class="field" type="password" name="password" placeholder="пароль" required minlength="8" />
      ${state.codeRequired
        ? '<input class="field" name="code" placeholder="код из аутентификатора (6 цифр)" inputmode="numeric" maxlength="6" required />'
        : ''}
      <button class="btn primary" type="submit" ${state.busy ? 'disabled' : ''}>
        ${state.busy ? '…' : (state.codeRequired ? 'Подтвердить код' : (mode === 'login' ? 'Войти' : 'Создать аккаунт'))}
      </button>
    </form>

    <div class="error" id="auth-error"></div>
    <div class="hint">сервер: <a data-action="edit-server">${esc(state.settings?.server || '')}</a></div>
  </div>`
}

async function handleAuth (form) {
  const data = Object.fromEntries(new FormData(form))
  state.form = { email: data.email, username: data.username }
  state.busy = true
  render()
  try {
    if (state.codeRequired) {
      const res = await api('/api/login/verify', {
        method: 'POST',
        body: { verifyToken: state.verifyToken, code: data.code }
      })
      await acceptToken(res)
    } else if (state.authMode === 'register') {
      const res = await api('/api/register', {
        method: 'POST',
        body: { email: data.email, username: data.username, password: data.password }
      })
      await acceptToken(res)
      toast('Аккаунт создан')
    } else {
      const res = await api('/api/login', {
        method: 'POST',
        body: { email: data.email, password: data.password }
      })
      if (res.step === 'verify') {
        state.verifyToken = res.verifyToken
        state.codeRequired = true
        state.busy = false
        render()
        toast('Нужен код 2FA')
        return
      }
      await acceptToken(res)
    }
    await enterApp()
  } catch (e) {
    state.busy = false
    state.codeRequired = false
    render()
    const box = document.getElementById('auth-error')
    if (box) box.textContent = e.message
    else toast(e.message, true)
  }
}

async function acceptToken (res) {
  state.settings = await window.obsi.settings.set({ token: res.token })
  state.user = res.user
}

async function enterApp () {
  state.busy = false
  state.codeRequired = false
  state.verifyToken = null
  state.screen = 'profile'
  render()
  await loadMe()
  await loadScreen()
  if (state.user) liveStart()
}

async function loadMe () {
  try {
    const me = await api('/api/me')
    state.user = me.user
    state.profile = me.profile
  } catch (e) {
    if (e.status === 401) {
      state.settings = await window.obsi.settings.set({ token: null })
      state.user = null
      state.profile = null
      render()
    } else throw e
  }
}

/* ── каркас ─────────────────────────────── */

const NAV = [
  ['profile', 'Профиль'],
  ['files', 'Файлы'],
  ['activity', 'Активность'],
  ['devices', 'Устройства'],
  ['settings', 'Настройки']
]

function shellHtml () {
  return `
  <div class="app">
    <aside class="side">
      <div class="brand">
        <img src="icon.png" alt="" /> ObsiSync
      </div>
      <nav class="nav">
        ${NAV.map(([id, label]) => `
          <button class="${state.screen === id ? 'on' : ''}" data-nav="${id}">${label}</button>`).join('')}
      </nav>
      <div class="who">
        <div class="name">
          <b>@${esc(state.user?.username || '')}</b>
          <span>${esc(state.settings?.server || '')}</span>
        </div>
        <button class="btn sm ghost" data-action="logout" title="Выйти">выход</button>
      </div>
    </aside>
    <main class="content" id="content">${screenHtml()}</main>
  </div>`
}

function screenHtml () {
  if (state.screen === 'files') return filesHtml()
  if (state.screen === 'activity') return activityHtml()
  if (state.screen === 'devices') return devicesHtml()
  if (state.screen === 'settings') return settingsHtml()
  return profileHtml()
}

/* ── профиль ─────────────────────────────── */

function profileHtml () {
  const p = state.profile || {}
  const files = state.files || []
  const total = files.reduce((s, f) => s + f.size, 0)
  const act = state.activity
  const initial = (state.user?.username || '?').slice(0, 1).toUpperCase()

  return `
  <h2>Профиль</h2>
  <p class="lead">всё хранится на сервере — то же самое, что на сайте</p>

  <div class="banner banner-theme${p.theme ?? 0}">
    ${p.banner ? `<img class="banner-img" src="${esc(p.banner)}" alt="" />` : ''}
    <span class="banner-shade"></span>
  </div>
  <div class="avatar-wrap">
    <div class="avatar">${p.avatar ? `<img src="${esc(p.avatar)}" alt="" />` : initial}</div>
    <div class="row" style="padding-bottom:4px">
      <button class="btn sm" data-action="avatar">Загрузить аватар</button>
      <button class="btn sm" data-action="banner">Загрузить баннер</button>
      <span class="badge">${state.user?.twoFa ? '2FA включена' : '2FA выключена'}</span>
    </div>
  </div>

  <div class="grid2" style="margin-top:18px">
    <div class="card">
      <h3>Био</h3>
      <textarea class="field" id="bio" maxlength="280" placeholder="пару слов о себе">${esc(p.bio || '')}</textarea>
      <div class="row" style="margin-top:12px">
        <span class="label" style="margin:0">Тема баннера</span>
        <div class="themes">
          ${[0, 1, 2, 3].map(t => `
            <button class="swatch theme${t} ${(p.theme ?? 0) === t ? 'on' : ''}" data-theme="${t}" title="тема ${t + 1}"></button>`).join('')}
        </div>
        <span class="spacer"></span>
        <button class="btn primary sm" data-action="save-bio" ${state.busy ? 'disabled' : ''}>Сохранить</button>
      </div>
    </div>

    <div class="card">
      <h3>Статус</h3>
      <div class="stats">
        <div class="stat"><div class="v">${files.length}</div><div class="k">файлов на сервере</div></div>
        <div class="stat"><div class="v">${human(total)}</div><div class="k">вес vault</div></div>
        <div class="stat"><div class="v">${act ? act.total : '—'}</div><div class="k">операций всего</div></div>
      </div>
      <p class="note" style="margin-top:14px">
        Файлы двигаются во вкладке <b>Файлы</b>: загрузка папки, скачивание, удаление.
        Плагин для Obsidian и автосинк — в разработке.
      </p>
    </div>
  </div>`
}

/* ── файлы ─────────────────────────────── */

function filesHtml () {
  const all = state.files
  const prefix = state.prefix.replace(/^\/+|\/+$/g, '')
  const list = all.filter(f => !prefix || f.path === prefix || f.path.startsWith(prefix + '/'))
  const total = list.reduce((s, f) => s + f.size, 0)

  return `
  <h2>Файлы</h2>
  <p class="lead">хранилище на сервере: что положил тут — то и лежит в vault</p>

  <div class="toolbar">
    <button class="btn primary" data-action="push" ${state.busy ? 'disabled' : ''}>Загрузить…</button>
    <button class="btn" data-action="pull" ${state.busy || !state.selected.size ? 'disabled' : ''}>Скачать выбранные${state.selected.size ? ` (${state.selected.size})` : ''}</button>
    <button class="btn danger" data-action="delete" ${state.busy || !state.selected.size ? 'disabled' : ''}>Удалить выбранные</button>
    <span class="spacer"></span>
    <input class="field" id="prefix" style="width:220px" placeholder="папка, напр. notes/" value="${esc(state.prefix)}" />
    <button class="btn" data-action="refresh" ${state.busy ? 'disabled' : ''}>Обновить</button>
  </div>

  <div class="drop" id="drop">
    Перетащи сюда файлы или папку — загрузится ${prefix ? `в <code>${esc(prefix)}</code>` : 'в корень vault'}
  </div>

  ${list.length ? `
  <table class="files">
    <thead>
      <tr>
        <th style="width:34px"><input type="checkbox" id="all" ${list.every(f => state.selected.has(f.path)) ? 'checked' : ''} /></th>
        <th>путь</th><th style="text-align:right">размер</th><th>обновлён</th>
      </tr>
    </thead>
    <tbody>
      ${list.map(f => `
        <tr>
          <td><input type="checkbox" data-pick="${esc(f.path)}" ${state.selected.has(f.path) ? 'checked' : ''} /></td>
          <td class="path" data-open="${esc(f.path)}" title="скачать и показать в папке">${esc(f.path)}</td>
          <td class="size" style="text-align:right">${human(f.size)}</td>
          <td class="date">${esc(f.updatedAt || '')}</td>
        </tr>`).join('')}
    </tbody>
  </table>
  <p class="note" style="margin-top:12px">всего: ${list.length} файл(ов), ${human(total)}</p>
  ` : `
  <div class="empty">
    <b>${prefix ? 'В этой папке пусто' : 'Пока ничего не загружено'}</b>
    Нажми «Загрузить…» или перетащи файлы сюда.<br />
    <span>Твой vault обычно лежит в <code>~/Documents/Obsidian Vault</code> — папку целиком, вместе с <code>.obsidian</code>, можно просто перетащить.</span>
  </div>`}

  <div class="progress" id="progress" ${state.progress ? '' : 'hidden'}>
    <span id="progress-text">${state.progress ? `${state.progress.phase === 'push' ? 'загрузка' : 'скачивание'} ${state.progress.index}/${state.progress.total} — ${esc(state.progress.file)}` : ''}</span>
    <div class="bar"><i id="progress-bar" style="width:${state.progress ? Math.round((state.progress.index / Math.max(state.progress.total, 1)) * 100) : 0}%"></i></div>
  </div>`
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const KIND_LABEL = { created: 'создано', updated: 'изменено', deleted: 'удалено' }
const KIND_COLOR = { created: 'var(--good)', updated: 'var(--accent)', deleted: 'var(--bad)' }

function buildHeat (rows) {
  const counts = new Map((rows || []).map(r => [r.date, r.count]))
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

function activityHtml () {
  const a = state.activity
  const head = `
    <h2>Активность</h2>
    <p class="lead">что происходило с файлами vault — пишется само при каждой операции</p>`

  if (!a) return `${head}<div class="empty"><b>Загружаем…</b></div>`

  const heat = buildHeat(a.heatmap)
  const totalMax = Math.max(1, ...a.breakdown.map(b => b.count))

  return `
  ${head}

  <div class="stats" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
    <div class="stat"><div class="v">${a.total}</div><div class="k">операций всего</div></div>
    <div class="stat"><div class="v">${a.week}</div><div class="k">за неделю</div></div>
    <div class="stat"><div class="v">${a.activeDays}</div><div class="k">активных дней</div></div>
    <div class="stat"><div class="v">${a.bestStreak}</div><div class="k">лучшая серия (дней)</div></div>
  </div>

  <div class="card">
    <h3>Календарь за год</h3>
    <div class="heat-scroll">
      <div class="heat-months">
        ${heat.labels.map(l => `<b style="left:${l.i * 14}px">${l.name}</b>`).join('')}
      </div>
      <div class="heat-grid">
        ${heat.weeks.map(col => col.map(c => `
          <div class="hcell lvl${c.lvl}"
               title="${c.date.toLocaleDateString('ru-RU')} · операций: ${c.count}"></div>`).join('')).join('')}
      </div>
    </div>
    <div class="legend"><span>меньше</span>${[0, 1, 2, 3, 4].map(l => `<div class="hcell lvl${l}"></div>`).join('')}<span>больше</span></div>
  </div>

  <div class="grid2">
    <div class="card">
      <h3>По типу операций</h3>
      ${a.breakdown.length ? a.breakdown.map(b => `
        <div class="brk">
          <div class="brk-top">
            <span class="dotc" style="background:${KIND_COLOR[b.kind] || 'var(--muted)'}"></span>
            ${KIND_LABEL[b.kind] || b.kind}
            <span class="spacer"></span>
            <b>${b.count}</b>
          </div>
          <div class="brk-bar"><i style="width:${Math.round((b.count / totalMax) * 100)}%;background:${KIND_COLOR[b.kind] || 'var(--muted)'}"></i></div>
        </div>`).join('')
      : '<p class="note">пока пусто — загрузи файлы, и тут появится история</p>'}
    </div>

    <div class="card">
      <h3>Чаще всего менялись</h3>
      ${a.topFiles.length ? a.topFiles.map(f => `
        <div class="topf"><span class="path">${esc(f.path)}</span><b>${f.count}</b></div>`).join('')
      : '<p class="note">нет данных</p>'}
    </div>
  </div>`
}

/* ── устройства ─────────────────────────────── */

function devicesHtml () {
  return `
  <h2>Устройства</h2>
  <p class="lead">реальные сессии на сервере — сюда же попадает и это приложение</p>
  ${state.sessions.length ? state.sessions.map(s => `
    <div class="session">
      <span class="dot ${s.current ? '' : 'old'}"></span>
      <div class="meta">
        <b>${esc(s.label || 'устройство')}</b>
        <div>${esc(s.ip || '—')} · вход ${esc(s.createdAt)} · активность ${esc(s.lastSeen)}</div>
      </div>
      ${s.current
        ? '<span class="badge">текущая</span>'
        : `<button class="btn sm danger" data-revoke="${s.id}">Отозвать</button>`}
    </div>`).join('')
    : '<div class="empty"><b>Сессий нет</b></div>'}`
}

/* ── настройки ─────────────────────────────── */

function settingsHtml () {
  const info = state.info || {}
  return `
  <h2>Настройки</h2>
  <p class="lead">адрес сервера и локальные данные</p>

  <div class="card">
    <h3>Сервер</h3>
    <label class="label">Адрес API</label>
    <input class="field" id="server" value="${esc(state.settings?.server || '')}" />
    <p class="note" style="margin-top:10px">
      Пока это локальный сервер (<code>127.0.0.1:3000</code>). Публичный адрес появится позже —
      сюда его и вписывают.
    </p>
    <div class="row" style="margin-top:12px">
      <button class="btn primary sm" data-action="save-server">Сохранить адрес</button>
      <span class="badge ${state.settings?.token ? '' : 'off'}">${state.settings?.token ? 'авторизован' : 'нет входа'}</span>
    </div>
  </div>

  <div class="card">
    <h3>Приложение</h3>
    <p class="note">
      версия ${esc(info.version || '—')} · Electron ${esc(info.electron || '—')} · ${esc(info.platform || '')}<br />
      данные: <code>${esc(info.userData || '')}</code>
    </p>
    <div class="row" style="margin-top:12px">
      <button class="btn" data-action="logout">Выйти из аккаунта</button>
    </div>
  </div>`
}

/* ── загрузка данных ─────────────────────────────── */

async function loadScreen () {
  try {
    if (state.screen === 'profile') {
      const [act, files] = await Promise.all([
        api('/api/activity').catch(() => null),
        api('/api/vault').catch(() => ({ files: [] }))
      ])
      state.activity = act
      state.files = files.files || []
    } else if (state.screen === 'files') {
      const files = await api('/api/vault')
      state.files = files.files || []
    } else if (state.screen === 'activity') {
      state.activity = await api('/api/activity')
    } else if (state.screen === 'devices') {
      const ses = await api('/api/sessions')
      state.sessions = ses.sessions || []
    } else if (state.screen === 'settings') {
      state.info = await window.obsi.info()
    }
    render()
  } catch (e) {
    toast(e.message, true)
    if (e.status === 401) await logout()
  }
}

async function reloadFiles () {
  const files = await api('/api/vault')
  state.files = files.files || []
}

/* ── live: сервер пушит чужие изменения по WebSocket ── */

let liveSocket = null
let liveTimer = 0
let liveBatch = 0

const plural = (n, one, few, many) => {
  const m10 = n % 10
  const m100 = n % 100
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many
}

function liveStop () {
  clearTimeout(liveTimer)
  liveBatch = 0
  if (!liveSocket) return
  liveSocket.onmessage = null
  liveSocket.onclose = null
  try { liveSocket.close() } catch {}
  liveSocket = null
}

function liveStart () {
  liveStop()
  const { token, server } = state.settings || {}
  if (!token || !server) return

  let ws
  try {
    ws = new WebSocket(`${String(server).replace(/^http/, 'ws')}/api/ws?token=${encodeURIComponent(token)}`)
  } catch {
    return
  }
  liveSocket = ws

  ws.onmessage = e => {
    let msg
    try { msg = JSON.parse(e.data) } catch { return }
    if (msg.type !== 'change') return
    liveBatch++
    // всплеск (например, чужой push пачки файлов) схлопываем в одно обновление
    clearTimeout(liveTimer)
    liveTimer = setTimeout(() => {
      if (!liveBatch) return
      const n = liveBatch
      liveBatch = 0
      toast(`с сервера: ${n} ${plural(n, 'изменение', 'изменения', 'изменений')}`)
      loadScreen().catch(() => {})
    }, 500)
  }

  ws.onclose = () => {
    if (liveSocket !== ws) return
    liveSocket = null
    clearTimeout(liveTimer)
    liveTimer = setTimeout(() => { if (state.user) liveStart() }, 3000)
  }
}

/* ── действия ─────────────────────────────── */

async function doPush (sources) {
  if (!sources || !sources.length) return
  state.busy = true
  state.progress = { phase: 'push', index: 0, total: 1, file: '' }
  render()
  try {
    const res = await window.obsi.vault.push({ sources, prefix: state.prefix.replace(/^\/+|\/+$/g, '') })
    const fail = res.failed.length
      ? `, не загрузилось: ${res.failed.length} (${res.failed[0].path}: ${res.failed[0].error})`
      : ''
    toast(`Загружено: ${res.uploaded}, без изменений: ${res.skipped}${fail}`, fail.length > 0)
    state.selected.clear()
    await reloadFiles()
  } catch (e) {
    toast(e.message, true)
  } finally {
    state.busy = false
    state.progress = null
    render()
  }
}

async function doPull (paths, destDir) {
  state.busy = true
  state.progress = { phase: 'pull', index: 0, total: 1, file: '' }
  render()
  try {
    const res = await window.obsi.vault.pull({ paths, destDir })
    toast(res.failed.length
      ? `Скачано ${res.pulled}, ошибок: ${res.failed.length}`
      : `Скачано файлов: ${res.pulled} → ${res.destDir}`, res.failed.length > 0)
  } catch (e) {
    toast(e.message, true)
  } finally {
    state.busy = false
    state.progress = null
    render()
  }
}

async function doDelete (paths) {
  const yes = await confirmBox(
    'Удалить с сервера?',
    paths.length === 1 ? `Файл «${paths[0]}» будет удалён безвозвратно.` : `Файлов: ${paths.length}. Удаление безвозвратное.`
  )
  if (!yes) return

  state.busy = true
  render()
  try {
    const res = await window.obsi.vault.remove({ paths })
    toast(`Удалено: ${res.deleted}`)
    state.selected.clear()
    await reloadFiles()
  } catch (e) {
    toast(e.message, true)
  } finally {
    state.busy = false
    render()
  }
}

async function logout () {
  try { await api('/api/logout', { method: 'POST' }) } catch {}
  liveStop()
  state.settings = await window.obsi.settings.set({ token: null })
  state.user = null
  state.profile = null
  state.files = []
  state.sessions = []
  state.activity = null
  state.selected.clear()
  state.authMode = 'login'
  render()
}

/* ── события ─────────────────────────────── */

function bind () {
  root.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    state.authMode = b.dataset.mode
    state.codeRequired = false
    render()
  }))

  const form = document.getElementById('auth-form')
  if (form) form.addEventListener('submit', e => { e.preventDefault(); handleAuth(form) })

  root.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', async () => {
    state.screen = b.dataset.nav
    render()
    await loadScreen()
  }))

  root.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', async () => {
    try {
      state.profile = (await api('/api/profile', { method: 'PUT', body: { theme: +b.dataset.theme } })).profile
      render()
    } catch (e) { toast(e.message, true) }
  }))

  root.querySelectorAll('[data-pick]').forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) state.selected.add(cb.dataset.pick)
    else state.selected.delete(cb.dataset.pick)
    render()
  }))

  const all = document.getElementById('all')
  if (all) all.addEventListener('change', () => {
    const prefix = state.prefix.replace(/^\/+|\/+$/g, '')
    const list = state.files.filter(f => !prefix || f.path === prefix || f.path.startsWith(prefix + '/'))
    state.selected = all.checked ? new Set(list.map(f => f.path)) : new Set()
    render()
  })

  root.querySelectorAll('[data-open]').forEach(td => td.addEventListener('click', async () => {
    const path = td.dataset.open
    try {
      const dir = state.settings.downloadDir
      const res = await window.obsi.vault.pull({ paths: [path], destDir: dir })
      if (res.pulled) window.obsi.shell.reveal(res.destDir + '/' + path)
      else toast(res.failed[0]?.error || 'не скачалось', true)
    } catch (e) { toast(e.message, true) }
  }))

  root.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => {
    try {
      await api('/api/sessions/' + b.dataset.revoke, { method: 'DELETE' })
      toast('Сессия отозвана')
      const ses = await api('/api/sessions')
      state.sessions = ses.sessions
      render()
    } catch (e) { toast(e.message, true) }
  }))

  const prefixInput = document.getElementById('prefix')
  if (prefixInput) prefixInput.addEventListener('change', () => {
    state.prefix = prefixInput.value
    render()
  })

  root.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', async () => {
    const a = el.dataset.action

    if (a === 'logout') return logout()

    if (a === 'edit-server') {
      const value = await promptBox('Адрес сервера', 'Например http://127.0.0.1:3000', state.settings?.server || '')
      if (value === null) return
      const clean = value.trim().replace(/\/+$/, '')
      if (!clean) return toast('пустой адрес', true)
      state.settings = await window.obsi.settings.set({ server: clean })
      toast('Адрес сохранён')
      render()
      return
    }

    if (a === 'refresh') { await loadScreen(); toast('Обновлено'); return }

    if (a === 'push') {
      const sources = await window.obsi.dialog.sources()
      await doPush(sources)
      return
    }

    if (a === 'pull') {
      if (!state.selected.size) return
      const dir = await window.obsi.dialog.saveDir()
      if (!dir) return
      await doPull([...state.selected], dir)
      return
    }

    if (a === 'delete') {
      if (!state.selected.size) return
      await doDelete([...state.selected])
      return
    }

    if (a === 'save-bio') {
      const bio = document.getElementById('bio')?.value ?? ''
      state.busy = true
      render()
      try {
        state.profile = (await api('/api/profile', { method: 'PUT', body: { bio } })).profile
        toast('Био сохранено')
      } catch (e) { toast(e.message, true) } finally {
        state.busy = false
        render()
      }
      return
    }

    if (a === 'avatar' || a === 'banner') { pickProfileImage(a); return }

    if (a === 'save-server') {
      const value = document.getElementById('server')?.value?.trim().replace(/\/+$/, '')
      if (!value) return toast('пустой адрес', true)
      state.settings = await window.obsi.settings.set({ server: value })
      toast('Адрес сохранён')
      render()
      if (state.user) {
        try { await loadMe() } catch (e) { toast(e.message, true) }
      }
      return
    }
  }))

  bindDrop()
}

async function pickProfileImage (kind) {
  const sources = await window.obsi.dialog.sources()
  if (!sources.length) return
  try {
    const r = await window.obsi.request({
      path: `/api/profile/${kind}`,
      method: 'POST',
      body: { image: await window.obsi.readImage(sources[0]) }
    })
    if (!r.ok) throw new Error(r.error)
    state.profile = r.json.profile
    toast(kind === 'avatar' ? 'Аватар обновлён' : 'Баннер обновлён')
    render()
  } catch (e) {
    toast(e.message, true)
  }
}

function bindDrop () {
  const zone = document.getElementById('drop')
  if (!zone) return
  ;['dragenter', 'dragover'].forEach(t => zone.addEventListener(t, e => {
    e.preventDefault()
    zone.classList.add('over')
  }))
  ;['dragleave', 'drop'].forEach(t => zone.addEventListener(t, e => {
    e.preventDefault()
    zone.classList.remove('over')
  }))
  zone.addEventListener('drop', async e => {
    const paths = []
    for (const file of e.dataTransfer.files) {
      const p = window.obsi.pathForFile?.(file)
      if (p) paths.push(p)
    }
    if (paths.length) await doPush(paths)
    else toast('не удалось определить путь файла', true)
  })
}

/* ── прогресс ─────────────────────────────── */

window.obsi.onProgress(data => {
  state.progress = data
  const box = document.getElementById('progress')
  const text = document.getElementById('progress-text')
  const bar = document.getElementById('progress-bar')
  if (!box || !text || !bar) return
  box.hidden = false
  const label = data.phase === 'push' ? 'загрузка' : 'скачивание'
  text.textContent = `${label} ${data.index}/${data.total} — ${data.file}`
  bar.style.width = `${Math.round((data.index / Math.max(data.total, 1)) * 100)}%`
})

/* ── старт ─────────────────────────────── */

function render () {
  root.innerHTML = state.user ? shellHtml() : authHtml()
  bind()
}

async function boot () {
  state.settings = await window.obsi.settings.get()
  render()
  if (state.settings.token) {
    await enterApp()
  }
}

boot()
