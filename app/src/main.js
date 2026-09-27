const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

let win = null

// Системный прокси (его ставит VPN) Chromium тянет и в рендерер — а нам надо
// ходить на свой локальный API напрямую: WebSocket /api/ws иначе умирает.
app.commandLine.appendSwitch('no-proxy-server')

const DEFAULTS = () => ({
  server: 'http://127.0.0.1:3000',
  token: null,
  user: null,
  downloadDir: path.join(app.getPath('downloads'), 'ObsiSync')
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

function progress (data) {
  if (win && !win.isDestroyed()) win.webContents.send('vault:progress', data)
}

const enc = p => p.split('/').map(encodeURIComponent).join('/')
const posix = (...parts) => parts.filter(Boolean).join('/')

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
    error: res.ok ? null : (json && json.error) || buf.toString('utf8').slice(0, 300) || `HTTP ${res.status}`,
    hash: res.headers.get('x-obsisync-hash'),
    bytes: buf
  }
}

function walkFiles (root, base = root, out = []) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue
    const abs = path.join(root, e.name)
    if (e.isDirectory()) walkFiles(abs, base, out)
    else if (e.isFile()) out.push({ abs, rel: path.relative(base, abs) })
  }
  return out
}

const MAX_FILE = 50 * 1024 * 1024

async function vaultPush ({ sources, prefix = '' }) {
  const jobs = []
  for (const src of sources) {
    let st
    try { st = fs.statSync(src) } catch { continue }
    if (st.isFile()) {
      jobs.push({ abs: src, remote: posix(prefix, path.basename(src)) })
    } else if (st.isDirectory()) {
      for (const f of walkFiles(src)) jobs.push({ abs: f.abs, remote: posix(prefix, f.rel) })
    }
  }
  if (!jobs.length) return { uploaded: 0, skipped: 0, failed: [], total: 0 }

  const listing = await request({ path: '/api/vault' })
  if (!listing.ok) return { uploaded: 0, skipped: 0, failed: [{ path: '', error: listing.error }], total: jobs.length }
  const known = new Map((listing.json.files || []).map(f => [f.path, f.hash]))

  let uploaded = 0
  let skipped = 0
  const failed = []

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]
    progress({ phase: 'push', index: i + 1, total: jobs.length, file: job.remote })

    let buf
    try { buf = fs.readFileSync(job.abs) } catch (e) { failed.push({ path: job.remote, error: String(e.message || e) }); continue }

    if (buf.length > MAX_FILE) {
      failed.push({ path: job.remote, error: 'файл больше 50 МБ — предел API' })
      continue
    }
    const hash = crypto.createHash('sha256').update(buf).digest('hex')
    if (known.get(job.remote) === hash) { skipped++; continue }

    const r = await request({ path: '/api/vault/' + enc(job.remote), method: 'PUT', raw: buf })
    if (r.ok) uploaded++
    else failed.push({ path: job.remote, error: r.error })
  }

  return { uploaded, skipped, failed, total: jobs.length }
}

async function vaultPull ({ paths: remotePaths, destDir }) {
  if (!remotePaths.length) return { pulled: 0, failed: [] }
  fs.mkdirSync(destDir, { recursive: true })

  let pulled = 0
  const failed = []
  for (let i = 0; i < remotePaths.length; i++) {
    const remote = remotePaths[i]
    progress({ phase: 'pull', index: i + 1, total: remotePaths.length, file: remote })

    const r = await request({ path: '/api/vault/' + enc(remote) })
    if (!r.ok) { failed.push({ path: remote, error: r.error }); continue }

    const dest = path.join(destDir, ...remote.split('/'))
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, r.bytes)
      pulled++
    } catch (e) {
      failed.push({ path: remote, error: String(e.message || e) })
    }
  }
  return { pulled, failed, destDir }
}

async function vaultDelete ({ paths: remotePaths }) {
  let deleted = 0
  const failed = []
  for (const remote of remotePaths) {
    const r = await request({ path: '/api/vault/' + enc(remote), method: 'DELETE' })
    if (r.ok || r.status === 404) deleted++
    else failed.push({ path: remote, error: r.error })
  }
  return { deleted, failed }
}

function createWindow () {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    title: 'ObsiSync',
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

ipcMain.handle('vault:push', (_e, opts) => vaultPush(opts))
ipcMain.handle('vault:pull', (_e, opts) => vaultPull(opts))
ipcMain.handle('vault:delete', (_e, opts) => vaultDelete(opts))

ipcMain.handle('dialog:sources', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Выбери файлы или папку',
    properties: ['openFile', 'openDirectory', 'multiSelections']
  })
  return r.canceled ? [] : r.filePaths
})

ipcMain.handle('dialog:saveDir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Куда скачать',
    properties: ['openDirectory', 'createDirectory']
  })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('image:data', (_e, p) => {
  const ext = path.extname(p).toLowerCase().replace('.', '').replace('jpg', 'jpeg')
  const mime = ['png', 'jpeg', 'gif', 'webp'].includes(ext) ? ext : 'png'
  const buf = fs.readFileSync(p)
  if (buf.length > 3 * 1024 * 1024) throw new Error('картинка больше 3 МБ')
  return `data:image/${mime};base64,${buf.toString('base64')}`
})

ipcMain.handle('shell:reveal', (_e, p) => {
  shell.showItemInFolder(p)
  return true
})

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  electron: process.versions.electron,
  userData: app.getPath('userData')
}))

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
