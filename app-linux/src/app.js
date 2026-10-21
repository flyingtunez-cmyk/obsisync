const root = document.getElementById('root')
const toastEl = document.getElementById('toast')

const state = {
  settings: null,
  screen: 'overview',
  user: null,
  sessions: [],
  activity: null,
  feed: [],
  sys: null,
  ping: null,
  site: null,
  siteBusy: false,
  appInfo: null,
  busy: false,
  authMode: 'login',
  verifyToken: null,
  codeRequired: false,
  form: {}
}

/* ── утилиты ─────────────────────────────── */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]))

function human (n) {
  if (n == null) return '—'
  if (n < 1024) return `${n} Б`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} КБ`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} МБ`
  return `${(n / 1024 ** 3).toFixed(1)} ГБ`
}

function pct (used, total) {
  if (!total) return '—'
  return `${Math.round((used / total) * 100)}%`
}

function uptimeShort (sec) {
  if (sec == null) return '—'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d} д ${h} ч`
  if (h > 0) return `${h} ч ${m} мин`
  return `${m} мин`
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
          <button class="btn danger" data-yes>Отозвать</button>
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
    <h1>ObsiSync Linux</h1>
    <p class="sub">устройства, активность и системная информация этой машины</p>

    <div class="tabs">
      <button class="${mode === 'login' ? 'on' : ''}" data-mode="login">Вход</button>
      <button class="${mode === 'register' ? 'on' : ''}" data-mode="register">Регистрация</button>
    </div>

    <form id="auth-form">
      <input class="field" type="email" name="email" placeholder="почта" required
             value="${esc(state.form.email || '')}" />
      ${mode === 'register' ? `<input class="field" name="username" placeholder="юзернейм" required value="${esc(state.form.username || '')}" />` : ''}
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
  state.screen = 'overview'
  render()
  await Promise.all([loadMe(), refreshPing(), refreshSys()])
  await loadScreen()
}

async function loadMe () {
  try {
    const me = await api('/api/me')
    state.user = me.user
  } catch (e) {
    if (e.status === 401) {
      state.settings = await window.obsi.settings.set({ token: null })
      state.user = null
      render()
    } else throw e
  }
}

/* ── каркас ─────────────────────────────── */

const NAV = [
  ['overview', 'Обзор'],
  ['devices', 'Устройства'],
  ['activity', 'Активность'],
  ['system', 'Система'],
  ['settings', 'Настройки']
]

function shellHtml () {
  const host = state.sys?.hostname || '…'
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
          <span>${esc(host)}</span>
        </div>
        <button class="btn sm ghost" data-action="logout" title="Выйти">выход</button>
      </div>
    </aside>
    <main class="content" id="content">${screenHtml()}</main>
  </div>`
}

function screenHtml () {
  if (state.screen === 'devices') return devicesHtml()
  if (state.screen === 'activity') return activityHtml()
  if (state.screen === 'system') return systemHtml()
  if (state.screen === 'settings') return settingsHtml()
  return overviewHtml()
}

/* ── обзор ─────────────────────────────── */

function overviewHtml () {
  const s = state.sys
  const p = state.ping
  const a = state.activity
  const online = p?.ok

  if (!s) return `<h2>Обзор</h2><p class="lead">собираю реальные данные этой машины…</p>`

  return `
  <h2>Обзор</h2>
  <p class="lead">что происходит прямо сейчас: сервер и эта машина</p>

  <div class="stats" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
    <div class="stat">
      <div class="v">${online ? `${p.ms} мс` : 'нет связи'}</div>
      <div class="k">сервер ${online ? 'отвечает' : 'не отвечает'}</div>
    </div>
    <div class="stat">
      <div class="v">${state.sessions.length}</div>
      <div class="k">устройств в аккаунте</div>
    </div>
    <div class="stat">
      <div class="v">${a ? a.week : '—'}</div>
      <div class="k">операций за неделю</div>
    </div>
    <div class="stat">
      <div class="v">${esc(s.cpu.usage?.[''] != null ? s.cpu.usage[''] + '%' : '—')}</div>
      <div class="k">загрузка CPU этой машины</div>
    </div>
  </div>

  <div class="grid2">
    <div class="card">
      <h3>Эта машина</h3>
      <div class="kv">
        <div><span>Имя хоста</span><b>${esc(s.hostname)}</b></div>
        <div><span>Система</span><b>${esc(s.distro || `${s.platform} ${s.arch}`)}</b></div>
        <div><span>Ядро</span><b>${esc(s.kernel)}</b></div>
        <div><span>Аптайм</span><b>${uptimeShort(s.uptimeSec)}</b></div>
        <div><span>CPU</span><b>${esc(s.cpu.model || '—')} · ${s.cpu.count} пот.</b></div>
        <div><span>Память</span><b>${human(s.mem.used)} из ${human(s.mem.total)}</b></div>
      </div>
    </div>

    <div class="card">
      <h3>Аккаунт</h3>
      <div class="kv">
        <div><span>Юзер</span><b>@${esc(state.user?.username || '—')}</b></div>
        <div><span>Почта</span><b>${esc(state.user?.email || '—')}</b></div>
        <div><span>2FA</span><b>${state.user?.twoFa ? 'включена' : 'выключена'}</b></div>
        <div><span>Сервер</span><b>${esc(state.settings?.server || '')}</b></div>
        <div><span>Задержка</span><b>${p?.ok ? `${p.ms} мс` : 'нет связи'}</b></div>
        <div><span>Последняя правка</span><b>${state.feed.length ? fmtWhen(state.feed[0].at) : 'нет данных'}</b></div>
      </div>
    </div>
  </div>

  <div class="card">
    <h3>Последние события</h3>
    ${state.feed.length
      ? state.feed.slice(0, 6).map(f => `
        <div class="topf">
          <span class="path">${KIND_LABEL[f.op] || f.op} · ${esc(f.path)}</span>
          <span class="muted">${esc(f.device || '—')} · ${fmtWhen(f.at)}</span>
        </div>`).join('')
      : '<p class="note">событий пока нет — они появятся после первых операций с файлами</p>'}
  </div>`
}

/* ── устройства ─────────────────────────── */

function devicesHtml () {
  const s = state.sys
  const currentIp = state.sessions.find(x => x.current)?.ip

  return `
  <h2>Устройства</h2>
  <p class="lead">реальные сессии на сервере и эта машина</p>

  ${s ? `
  <div class="card this-pc">
    <div class="row">
      <span class="dot on"></span>
      <div class="meta">
        <b>${esc(s.hostname)} · ${esc(s.distro || s.platform)}</b>
        <div>${esc(currentIp || 'IP не определён')} · ${esc(s.user)}@${esc(s.hostname)} · ядро ${esc(s.kernel)}</div>
      </div>
      <span class="badge">эта машина</span>
    </div>
  </div>` : ''}

  ${state.sessions.length ? state.sessions.map(x => `
    <div class="session">
      <span class="dot ${x.current ? 'on' : ''}"></span>
      <div class="meta">
        <b>${esc(x.label || 'устройство')}</b>
        <div>${esc(x.ip || '—')} · вход ${fmtWhen(x.createdAt)} · был ${fmtWhen(x.lastSeen)}</div>
        ${x.ua ? `<div class="ua" title="${esc(x.ua)}">${esc(x.ua.slice(0, 110))}${x.ua.length > 110 ? '…' : ''}</div>` : ''}
      </div>
      ${x.current
        ? '<span class="badge">текущая</span>'
        : `<button class="btn sm danger" data-revoke="${x.id}">Отозвать</button>`}
    </div>`).join('')
    : '<div class="empty"><b>Сессий нет</b>вход на сервере создаст сессию</div>'}

  <p class="note" style="margin-top:12px">
    Сессии — из <code>/api/sessions</code>. Отзыв удаляет токен на сервере:
    устройство сразу выкинет на экран входа.
  </p>`
}

/* ── активность ─────────────────────────── */

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const KIND_LABEL = { created: 'создано', updated: 'изменено', deleted: 'удалено', conflict: 'конфликт' }
const KIND_COLOR = { created: 'var(--good)', updated: 'var(--accent)', deleted: 'var(--bad)', conflict: 'var(--warn)' }

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
      col.push({ lvl, date, count })
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
  </div>

  <div class="card">
    <h3>Лента последних операций</h3>
    ${state.feed.length
      ? state.feed.slice(0, 20).map(f => `
        <div class="topf">
          <span class="path">${KIND_LABEL[f.op] || f.op} · ${esc(f.path)}</span>
          <span class="muted">${esc(f.device || '—')} · ${fmtWhen(f.at)}</span>
        </div>`).join('')
      : '<p class="note">нет данных</p>'}
  </div>`
}

/* ── система ─────────────────────────────── */

function systemHtml () {
  const s = state.sys
  if (!s) return `<h2>Система</h2><p class="lead">собираю данные из /proc, /sys и statfs…</p>`

  const memPctVal = Math.round((s.mem.used / s.mem.total) * 100)

  return `
  <h2>Система</h2>
  <p class="lead">реальные данные этой машины: os, /etc/os-release, /proc, /sys, statfs — без выдумок</p>

  <div class="grid2">
    <div class="card">
      <h3>Система</h3>
      <div class="kv">
        <div><span>Хост</span><b>${esc(s.hostname)}</b></div>
        <div><span>Пользователь</span><b>${esc(s.user)}</b></div>
        <div><span>Дистрибутив</span><b>${esc(s.distro || 'нет /etc/os-release')}</b></div>
        <div><span>Ядро</span><b>${esc(s.kernel)}</b></div>
        <div><span>Архитектура</span><b>${esc(s.arch)}</b></div>
        <div><span>Аптайм</span><b>${uptimeShort(s.uptimeSec)}</b></div>
        <div><span>Домашняя папка</span><b class="mono">${esc(s.homedir)}</b></div>
      </div>
    </div>

    <div class="card">
      <h3>CPU</h3>
      <div class="kv">
        <div><span>Модель</span><b>${esc(s.cpu.model || '—')}</b></div>
        <div><span>Ядра / потоки</span><b>${s.cpu.count}</b></div>
        <div><span>Частота</span><b>${s.cpu.speedMHz ? `${s.cpu.speedMHz} МГц` : '—'}</b></div>
        <div><span>Средняя нагрузка (1 мин)</span><b>${s.cpu.load1 != null ? s.cpu.load1.toFixed(2) : '—'}</b></div>
        <div><span>Загрузка (замер 700 мс)</span><b>${s.cpu.usage?.[''] != null ? `${s.cpu.usage['']}%` : '—'}</b></div>
      </div>
      <p class="note" style="margin-top:10px">Потоки: ${Object.entries(s.cpu.usage || {})
        .filter(([k]) => k !== '')
        .map(([k, v]) => `<span class="core">cpu${k}: ${v}%</span>`).join(' ') || '—'}</p>
    </div>
  </div>

  <div class="grid2">
    <div class="card">
      <h3>Память</h3>
      <div class="meter"><i style="width:${memPctVal}%"></i></div>
      <div class="kv">
        <div><span>Использовано</span><b>${human(s.mem.used)} (${memPctVal}%)</b></div>
        <div><span>Всего</span><b>${human(s.mem.total)}</b></div>
        <div><span>Доступно (MemAvailable)</span><b>${human(s.mem.available)}</b></div>
        <div><span>Swap всего</span><b>${human(s.mem.swapTotal)}</b></div>
        <div><span>Swap свободно</span><b>${human(s.mem.swapFree)}</b></div>
      </div>
    </div>

    <div class="card">
      <h3>Диск (statfs)</h3>
      ${s.disks.map(d => `
        <div style="margin-bottom:12px">
          <div class="row" style="margin-bottom:6px">
            <b class="mono">${esc(d.mount)}</b>
            <span class="spacer"></span>
            <span class="muted">${human(d.used)} из ${human(d.total)} · ${pct(d.used, d.total)}</span>
          </div>
          <div class="meter"><i style="width:${d.total ? Math.round((d.used / d.total) * 100) : 0}%"></i></div>
        </div>`).join('')}
    </div>
  </div>

  <div class="grid2">
    <div class="card">
      <h3>Сеть</h3>
      ${s.net.interfaces.length
        ? s.net.interfaces.map(i => `
          <div class="kv">
            <div><span>${esc(i.name)} (${i.family})</span><b class="mono">${esc(i.address)}</b></div>
          </div>`).join('')
        : '<p class="note">внешних интерфейсов нет (или нет сети)</p>'}
      <div class="kv" style="margin-top:8px">
        <div><span>Шлюз по умолчанию</span><b class="mono">${s.net.gateway ? `${esc(s.net.gateway.ip)} (${esc(s.net.gateway.iface)})` : '—'}</b></div>
        <div><span>DNS</span><b class="mono">${s.net.dns.length ? s.net.dns.map(esc).join(', ') : '—'}</b></div>
        ${s.net.wirelessIface ? `<div><span>Wi-Fi интерфейс</span><b class="mono">${esc(s.net.wirelessIface)}</b></div>` : ''}
      </div>
    </div>

    <div class="card">
      <h3>Питание</h3>
      ${s.battery ? `
        <div class="meter"><i style="width:${s.battery.capacity}%"></i></div>
        <div class="kv">
          <div><span>Заряд</span><b>${s.battery.capacity}%</b></div>
          <div><span>Статус</span><b>${esc(s.battery.status || '—')}</b></div>
        </div>`
      : '<p class="note">батареи нет — это настольный ПК или данные недоступны в /sys/class/power_supply</p>'}
    </div>
  </div>`
}

/* ── настройки ─────────────────────────────── */

function siteCardHtml () {
  const s = state.site
  const running = s?.running
  return `
  <div class="card">
    <h3>Локальный сайт</h3>
    <p class="note" style="margin-bottom:12px">
      Временная кнопка: поднимает Vite из корня репозитория и открывает
      <code>http://localhost:${s?.port || 5173}</code> в браузере.
      Когда появится настоящий сервер — этот блок уберут.
    </p>
    <div class="row">
      <button class="btn ${running ? 'danger' : 'primary'} sm" data-action="site-toggle" ${state.siteBusy ? 'disabled' : ''}>
        ${state.siteBusy ? '…' : (running ? 'Остановить сайт' : 'Запустить сайт')}
      </button>
      <button class="btn sm" data-action="site-open" ${running ? '' : 'disabled'}>Открыть в браузере</button>
      <span class="badge ${running ? '' : 'off'}">${running ? `запущен · :${s.port}` : (s?.error ? esc(s.error) : 'остановлен')}</span>
    </div>
  </div>`
}

function settingsHtml () {
  const info = state.appInfo || {}
  const p = state.ping
  return `
  <h2>Настройки</h2>
  <p class="lead">адрес сервера, локальный сайт и локальные данные</p>

  ${siteCardHtml()}

  <div class="card">
    <h3>Сервер</h3>
    <label class="label">Адрес API</label>
    <input class="field" id="server" value="${esc(state.settings?.server || '')}" />
    <div class="row" style="margin-top:12px">
      <button class="btn primary sm" data-action="save-server">Сохранить адрес</button>
      <button class="btn sm" data-action="ping">Проверить связь</button>
      <span class="badge ${p?.ok ? '' : 'off'}">${p?.ok ? `живой · ${p.ms} мс` : (p ? 'не отвечает' : 'не проверено')}</span>
    </div>
  </div>

  <div class="card">
    <h3>Приложение</h3>
    <p class="note">
      версия ${esc(info.version || '—')} · Electron ${esc(info.electron || '—')} · Node ${esc(info.node || '—')}<br />
      платформа ${esc(info.platform || '')}<br />
      конфиг: <code>${esc(info.configPath || '')}</code>
    </p>
    <div class="row" style="margin-top:12px">
      <button class="btn" data-action="logout">Выйти из аккаунта</button>
    </div>
  </div>`
}

/* ── загрузка данных ─────────────────────── */

async function refreshPing () {
  state.ping = await window.obsi.ping()
}

async function refreshSite () {
  state.site = await window.obsi.site.status()
}

async function refreshSys () {
  state.sys = await window.obsi.sysinfo()
}

async function loadScreen () {
  try {
    if (state.screen === 'devices') {
      const ses = await api('/api/sessions')
      state.sessions = ses.sessions || []
    } else if (state.screen === 'activity') {
      const [act, feed] = await Promise.all([
        api('/api/activity'),
        api('/api/activity/feed?limit=30').catch(() => ({ feed: [] }))
      ])
      state.activity = act
      state.feed = feed.feed || []
    } else if (state.screen === 'overview') {
      const [, ses, feed] = await Promise.all([
        api('/api/activity').catch(() => null),
        api('/api/sessions').catch(() => ({ sessions: [] })),
        api('/api/activity/feed?limit=10').catch(() => ({ feed: [] }))
      ])
      if (ses.sessions) state.sessions = ses.sessions
      state.feed = feed.feed || []
    } else if (state.screen === 'settings') {
      state.appInfo = await window.obsi.info()
      await Promise.all([refreshPing(), refreshSite()])
    }
    render()
  } catch (e) {
    toast(e.message, true)
    if (e.status === 401) await logout()
  }
}

/* ── действия ─────────────────────────────── */

async function logout () {
  try { await api('/api/logout', { method: 'POST' }) } catch {}
  state.settings = await window.obsi.settings.set({ token: null })
  state.user = null
  state.sessions = []
  state.activity = null
  state.feed = []
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

  root.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => {
    const yes = await confirmBox('Отозвать сессию?', 'Устройство будет выкинуто из аккаунта — токен удаляется на сервере.')
    if (!yes) return
    try {
      await api('/api/sessions/' + b.dataset.revoke, { method: 'DELETE' })
      toast('Сессия отозвана')
      const ses = await api('/api/sessions')
      state.sessions = ses.sessions || []
      render()
    } catch (e) { toast(e.message, true) }
  }))

  root.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', async () => {
    const a = el.dataset.action

    if (a === 'logout') return logout()

    if (a === 'edit-server' || a === 'save-server') {
      const input = document.getElementById('server')
      const current = input ? input.value : state.settings?.server
      const clean = String(current || '').trim().replace(/\/+$/, '')
      if (!clean) return toast('пустой адрес', true)
      state.settings = await window.obsi.settings.set({ server: clean })
      toast('Адрес сохранён')
      await refreshPing()
      render()
      return
    }

    if (a === 'ping') {
      await refreshPing()
      toast(state.ping?.ok ? `Сервер отвечает: ${state.ping.ms} мс` : 'Сервер не отвечает', !state.ping?.ok)
      render()
      return
    }

    if (a === 'site-toggle') {
      state.siteBusy = true
      render()
      try {
        if (state.site?.running) {
          state.site = await window.obsi.site.stop()
          toast('Сайт остановлен')
        } else {
          state.site = await window.obsi.site.start()
          if (state.site.error) toast(state.site.error, true)
          else {
            toast(`Сайт запущен: http://localhost:${state.site.port}`)
            await window.obsi.site.open()
          }
        }
      } catch (e) {
        toast(e.message, true)
      } finally {
        state.siteBusy = false
        render()
      }
      return
    }

    if (a === 'site-open') {
      await window.obsi.site.open()
      return
    }
  }))
}

/* ── старт ─────────────────────────────── */

function render () {
  root.innerHTML = state.user ? shellHtml() : authHtml()
  bind()
}

async function boot () {
  state.settings = await window.obsi.settings.get()
  state.appInfo = await window.obsi.info().catch(() => null)
  render()
  if (state.settings.token) await enterApp()
}

boot()
