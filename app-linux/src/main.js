const { app, BrowserWindow, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

let win = null

/* ── Локальный сайт (временно) ──
   Пока сервер локальный, приложение умеет само поднять Vite-сайт из корня
   репозитория и открыть его в браузере. Когда появится нормальный сервер,
   этот блок убирается. */

const SITE_PORT = 5173
let siteProc = null

function repoRoot () {
  // приложение лежит в <корень>/app-linux → сайт в корне репозитория
  return path.join(__dirname, '..', '..')
}

async function siteStatus () {
  try {
    const res = await fetch(`http://localhost:${SITE_PORT}/`, { signal: AbortSignal.timeout(1500) })
    return { running: res.ok, port: SITE_PORT }
  } catch {
    return { running: false, port: SITE_PORT }
  }
}

async function siteStart () {
  const already = await siteStatus()
  if (already.running) return { ...already, started: false }

  const root = repoRoot()
  const pkg = path.join(root, 'package.json')
  let hasVite = false
  try { hasVite = !!JSON.parse(fs.readFileSync(pkg, 'utf8'))?.scripts?.dev } catch {}
  if (!hasVite) {
    return { running: false, port: SITE_PORT, error: `в ${root} нет проекта с npm run dev` }
  }

  // detached + своя группа процессов: vite убивается вместе с приложением,
  // а не остаётся сиротой в фоне
  siteProc = spawn('npm', ['run', 'dev'], {
    cwd: root,
    detached: true,
    stdio: 'ignore'
  })
  siteProc.on('exit', () => { siteProc = null })
  siteProc.unref()

  // ждём, пока vite поднимется (обычно 1–3 секунды)
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 700))
    const s = await siteStatus()
    if (s.running) return { ...s, started: true }
    if (!siteProc) return { running: false, port: SITE_PORT, error: 'vite завершился сразу после старта' }
  }
  return { running: false, port: SITE_PORT, error: 'сайт не поднялся за 30 с' }
}

function siteStop () {
  if (!siteProc) return { running: false, stopped: false }
  try { process.kill(-siteProc.pid, 'SIGTERM') } catch {}
  siteProc = null
  return { running: false, stopped: true }
}

function siteKillOnQuit () {
  if (!siteProc) return
  try { process.kill(-siteProc.pid, 'SIGTERM') } catch {}
}

// системный прокси (ставит VPN) Chromium тянет и в рендерер, а нам нужен
// прямой доступ к локальному API — иначе умирает WebSocket /api/ws
app.commandLine.appendSwitch('no-proxy-server')

const DEFAULTS = () => ({
  server: 'http://127.0.0.1:3000',
  token: null,
  user: null
})

function cfgFile () {
  return path.join(app.getPath('userData'), 'config.json')
}

function readSettings () {
  try {
    return { ...DEFAULTS(), ...JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) }
  } catch {
    return DEFAULTS()
  }
}

function writeSettings (patch) {
  const next = { ...readSettings(), ...patch }
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true })
  fs.writeFileSync(cfgFile(), JSON.stringify(next, null, 2), { mode: 0o600 })
  return next
}

/* ── HTTP к API ─────────────────────────── */

async function request ({ path: p, method = 'GET', body, raw, auth = true }) {
  const cfg = readSettings()
  const headers = {}
  if (auth && cfg.token) headers.Authorization = `Bearer ${cfg.token}`

  let data = null
  if (raw !== undefined) {
    data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'base64')
    headers['Content-Type'] = 'application/octet-stream'
  } else if (body !== undefined) {
    data = Buffer.from(JSON.stringify(body))
    headers['Content-Type'] = 'application/json'
  }

  let res
  try {
    res = await fetch(cfg.server + p, { method, headers, body: data })
  } catch {
    return { ok: false, status: 0, json: null, error: `сервер недоступен: ${cfg.server}` }
  }

  const buf = Buffer.from(await res.arrayBuffer())
  const ct = res.headers.get('content-type') || ''
  let json = null
  if (ct.includes('json')) {
    try { json = JSON.parse(buf.toString('utf8')) } catch {}
  }
  return {
    ok: res.ok,
    status: res.status,
    json,
    error: res.ok ? null : (json && json.error) || buf.toString('utf8').slice(0, 300) || `HTTP ${res.status}`
  }
}

// ping с замером задержки — рендерер показывает реальный latency
async function ping () {
  const started = Date.now()
  const r = await request({ path: '/health', auth: false })
  return { ...r, ms: Date.now() - started }
}

/* ── Реальная системная информация Linux ──
   Всё читается из настоящих источников: os, /etc/os-release, /proc, /sys,
   statfs. Ничего не выдумывается: если данных нет (нет батареи, нет сети) —
   поле вернётся null и рендерер покажет прочерк. */

const readTry = p => {
  try { return fs.readFileSync(p, 'utf8') } catch { return null }
}

//PRETTY_NAME="Arch Linux" и т.п.
function osRelease () {
  const txt = readTry('/etc/os-release')
  if (!txt) return null
  const fields = {}
  for (const line of txt.split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (m) fields[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
  }
  return fields.PRETTY_NAME || fields.NAME || null
}

// загрузка CPU за интервал — меряем два снимка /proc/stat
function cpuSnapshot () {
  const txt = readTry('/proc/stat')
  if (!txt) return null
  const out = {}
  for (const line of txt.split('\n')) {
    const m = /^cpu(\d*)\s+(.*)$/.exec(line)
    if (!m) continue
    const nums = m[2].split(/\s+/).map(Number)
    // user nice system idle iowait irq softirq steal ...
    const idle = (nums[3] || 0) + (nums[4] || 0)
    const total = nums.reduce((s, n) => s + (n || 0), 0)
    out[m[1]] = { idle, total }
  }
  return out
}

function cpuUsageBetween (a, b) {
  if (!a || !b) return null
  const usage = {}
  for (const key of Object.keys(b)) {
    const dTotal = b[key].total - (a[key]?.total ?? b[key].total)
    const dIdle = b[key].idle - (a[key]?.idle ?? b[key].idle)
    usage[key] = dTotal > 0 ? Math.round(((dTotal - dIdle) / dTotal) * 100) : 0
  }
  return usage
}

// диск через statfs — реально занято/свободно на точке монтирования
function diskUsage (mount = '/') {
  try {
    const st = fs.statfsSync(mount)
    const total = st.blocks * st.bsize
    const free = st.bavail * st.bsize
    return { mount, total, free, used: total - free }
  } catch {
    return null
  }
}

// батарея из /sys/class/power_supply — только если она физически есть
function battery () {
  let base = ''
  try { base = fs.readdirSync('/sys/class/power_supply').find(d => {
    const t = readTry(`/sys/class/power_supply/${d}/type`)
    return t && t.trim() === 'Battery'
  }) } catch { return null }
  if (!base) return null
  const cap = Number(readTry(`/sys/class/power_supply/${base}/capacity`))
  const status = (readTry(`/sys/class/power_supply/${base}/status`) || '').trim()
  if (!Number.isFinite(cap)) return null
  return { capacity: cap, status: status || null }
}

// wi-fi ssid из /proc/net/wireless — реальная текущая сеть, если подключены
function wireless () {
  const txt = readTry('/proc/net/wireless')
  if (!txt) return null
  const lines = txt.split('\n').slice(2).map(l => l.trim())
  const iface = lines[0]?.split('.')[0]
  return iface || null
}

// таблица маршрутов: шлюз по умолчанию из /proc/net/route
function defaultGateway () {
  const txt = readTry('/proc/net/route')
  if (!txt) return null
  for (const line of txt.split('\n').slice(1)) {
    const [iface, dest, gateway] = line.trim().split(/\s+/)
    if (dest === '00000000' && gateway) {
      const ip = gateway.match(/../g).reverse().map(h => parseInt(h, 16)).join('.')
      return { iface, ip }
    }
  }
  return null
}

// DNS из /etc/resolv.conf
function dnsServers () {
  const txt = readTry('/etc/resolv.conf')
  if (!txt) return []
  return txt.split('\n')
    .map(l => /^nameserver\s+(\S+)/.exec(l.trim())?.[1])
    .filter(Boolean)
}

function systemInfo (cpuUsage) {
  const cpus = os.cpus()
  const totalMem = os.totalmem()
  const freeMem = os.freemem()

  const memInfo = readTry('/proc/meminfo')
  const memField = name => {
    const m = new RegExp(`^${name}:\\s+(\\d+) kB`).exec(memInfo || '')
    return m ? Number(m[1]) * 1024 : null
  }

  const netIfaces = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.internal) continue
      netIfaces.push({ name, address: a.address, family: a.family, mac: a.mac })
    }
  }

  const gw = defaultGateway()
  const bat = battery()

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    kernel: os.release(),
    distro: osRelease(),
    user: os.userInfo().username,
    homedir: os.homedir(),
    uptimeSec: os.uptime(),

    cpu: {
      model: cpus[0]?.model?.trim() || null,
      speedMHz: cpus[0]?.speed || null,
      count: cpus.length,
      load1: os.loadavg()[0],
      usage: cpuUsage
    },

    mem: {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem,
      available: memField('MemAvailable'),
      swapTotal: memField('SwapTotal'),
      swapFree: memField('SwapFree')
    },

    disks: [diskUsage('/'), diskUsage(os.homedir())].filter(Boolean),

    net: {
      interfaces: netIfaces,
      gateway: gw,
      dns: dnsServers(),
      wirelessIface: wireless()
    },

    battery: bat
  }
}

// снимок сразу, а через 700 мс — второй, чтобы посчитать реальную загрузку CPU
let cpuFirst = null
async function collectSystem () {
  const first = cpuSnapshot() || cpuFirst
  cpuFirst = first
  await new Promise(r => setTimeout(r, 700))
  const usage = cpuUsageBetween(first, cpuSnapshot())
  return systemInfo(usage)
}

/* ── Окно ── */

function createWindow () {
  win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 880,
    minHeight: 580,
    backgroundColor: '#0a0a0a',
    title: 'ObsiSync Linux',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.loadFile(path.join(__dirname, 'index.html'))

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
}

/* ── IPC ── */

ipcMain.handle('settings:get', () => readSettings())

ipcMain.handle('settings:set', (_e, patch) => {
  const clean = { ...patch }
  delete clean.user
  return writeSettings(clean)
})

ipcMain.handle('api', (_e, opts) => request(opts))
ipcMain.handle('ping', () => ping())
ipcMain.handle('sysinfo', () => collectSystem())

ipcMain.handle('site:status', () => siteStatus())
ipcMain.handle('site:start', () => siteStart())
ipcMain.handle('site:stop', () => siteStop())
ipcMain.handle('site:open', () => {
  shell.openExternal(`http://localhost:${SITE_PORT}`)
  return true
})

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  platform: process.platform,
  userData: app.getPath('userData'),
  configPath: cfgFile()
}))

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  siteKillOnQuit()
  app.quit()
})

app.on('before-quit', siteKillOnQuit)
