import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { db, DATA_DIR } from './db.js'
import { hashPassword, verifyPassword, newToken, newTotpSecret, verifyTotp, deviceLabel } from './auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

// файлы vault: <VAULT_DIR>/<userId>/<path внутри vault>
const VAULT_DIR = path.join(__dirname, '..', 'vaults')
fs.mkdirSync(VAULT_DIR, { recursive: true })

// содержимое всех версий файлов — по хешу, одинаковые байты хранятся один раз
const BLOB_DIR = process.env.BLOB_DIR || path.join(DATA_DIR, 'blobs')
fs.mkdirSync(BLOB_DIR, { recursive: true })

const app = express()
const PORT = process.env.PORT || 3000
// временный бэкенд живёт только на localhost — наружу его пускает прокси Vite
const HOST = process.env.HOST || '127.0.0.1'

app.use(cors())
app.use(express.json({ limit: '6mb' }))
app.use('/uploads', (req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff')
  next()
}, express.static(UPLOAD_DIR, { maxAge: '7d' }))

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const usernameRe = /^[a-zA-Zа-яА-ЯёЁ0-9_.-]+$/
const dataUrlRe = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=\s]+)$/
const CODE_TTL_MS = 5 * 60 * 1000
const MAX_IMAGE_BYTES = 3 * 1024 * 1024

// Ожидающие вторые шаги входа (TOTP)
const pendingLogins = new Map()
// Секреты 2FA, которые ждут подтверждения кодом из аутентификатора
const pendingSetup = new Map()

function publicUser (row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    twoFa: !!row.two_fa,
    createdAt: row.created_at
  }
}

function getProfile (userId) {
  const row = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId)
  if (row) return row
  db.prepare('INSERT INTO profiles (user_id) VALUES (?)').run(userId)
  return db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId)
}

function publicProfile (row) {
  return { bio: row.bio, avatar: row.avatar, banner: row.banner, theme: row.theme }
}

function createSession (userId, req) {
  const token = newToken()
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 300)
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').slice(0, 64)
  db.prepare(
    "INSERT INTO sessions (token, user_id, label, ip, user_agent, last_seen) VALUES (?, ?, ?, ?, ?, datetime('now'))"
  ).run(token, userId, deviceLabel(ua), ip, ua)
  return token
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'obsisync-api' })
})

/* ── Регистрация и вход ───────────────────── */

function normEmail (email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : ''
}

function sweepExpired (map) {
  const now = Date.now()
  for (const [key, value] of map) {
    if (!value || now > value.expiresAt) map.delete(key)
  }
}

app.post('/api/register', (req, res) => {
  const body = req.body ?? {}
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const email = normEmail(body.email)
  const password = body.password

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'нужны username, email и password' })
  }
  if (username.length < 3 || username.length > 24) {
    return res.status(400).json({ error: 'username должен быть от 3 до 24 символов' })
  }
  if (!usernameRe.test(username)) {
    return res.status(400).json({ error: 'username может содержать только буквы, цифры, точку, дефис и подчёркивание' })
  }
  if (!emailRe.test(email)) {
    return res.status(400).json({ error: 'email не похож на email' })
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password должен быть не короче 8 символов' })
  }

  const existing = db
    .prepare('SELECT id FROM users WHERE email = ? OR username = ?')
    .get(email, username)
  if (existing) {
    return res.status(409).json({ error: 'email или username уже заняты' })
  }

  let info
  try {
    info = db
      .prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
      .run(username, email, hashPassword(password))
  } catch (e) {
    if (/UNIQUE/i.test(e?.message || '')) {
      return res.status(409).json({ error: 'email или username уже заняты' })
    }
    throw e
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
  const token = createSession(user.id, req)

  res.status(201).json({ token, user: publicUser(user), profile: publicProfile(getProfile(user.id)) })
})

app.post('/api/login', (req, res) => {
  const email = normEmail(req.body?.email)
  const password = req.body?.password
  sweepExpired(pendingLogins)

  if (!email || !password) {
    return res.status(400).json({ error: 'нужны email и password' })
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'неверный email или пароль' })
  }

  if (user.two_fa && user.two_fa_secret) {
    const verifyToken = newToken()
    pendingLogins.set(verifyToken, { userId: user.id, expiresAt: Date.now() + CODE_TTL_MS, attempts: 0 })
    return res.json({ step: 'verify', verifyToken })
  }

  res.json({ token: createSession(user.id, req), user: publicUser(user) })
})

app.post('/api/login/verify', (req, res) => {
  const { verifyToken, code } = req.body ?? {}
  const pending = pendingLogins.get(verifyToken)

  if (!pending || Date.now() > pending.expiresAt) {
    pendingLogins.delete(verifyToken)
    return res.status(400).json({ error: 'сессия входа истекла — попробуйте ещё раз' })
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(pending.userId)
  if (!user || !user.two_fa_secret || !verifyTotp(user.two_fa_secret, code)) {
    pending.attempts = (pending.attempts || 0) + 1
    if (pending.attempts >= 5) {
      pendingLogins.delete(verifyToken)
      return res.status(401).json({ error: 'слишком много неверных кодов — войдите заново' })
    }
    return res.status(401).json({ error: 'код неверный' })
  }

  pendingLogins.delete(verifyToken)
  res.json({ token: createSession(user.id, req), user: publicUser(user) })
})

/* ── Auth-мидлварь ────────────────────────── */

function auth (req, res, next) {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'нужен токен: Authorization: Bearer <token>' })

  const session = db
    .prepare('SELECT * FROM sessions WHERE token = ?')
    .get(token)
  if (!session) return res.status(401).json({ error: 'токен недействителен' })

  req.userId = session.user_id
  req.sessionId = session.id
  req.token = session.token

  const seenMs = Date.parse(String(session.last_seen ?? '').replace(' ', 'T') + 'Z')
  if (!Number.isFinite(seenMs) || Date.now() - seenMs > 60_000) {
    db.prepare("UPDATE sessions SET last_seen = datetime('now') WHERE id = ?").run(session.id)
  }

  req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId)
  if (!req.user) return res.status(401).json({ error: 'пользователь не найден' })
  next()
}

app.post('/api/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId)
  res.status(204).end()
})

app.get('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user), profile: publicProfile(getProfile(req.userId)) })
})

/* ── Профиль ─────────────────────────────── */

app.put('/api/profile', auth, (req, res) => {
  const { bio, theme } = req.body ?? {}

  if (bio !== undefined) {
    if (typeof bio !== 'string') return res.status(400).json({ error: 'bio должен быть строкой' })
    if (bio.length > 200) return res.status(400).json({ error: 'bio — максимум 200 символов' })
  }
  if (theme !== undefined) {
    const t = Number(theme)
    if (!Number.isInteger(t) || t < 0 || t > 3) {
      return res.status(400).json({ error: 'theme должен быть от 0 до 3' })
    }
  }

  getProfile(req.userId)
  if (bio !== undefined) db.prepare('UPDATE profiles SET bio = ? WHERE user_id = ?').run(bio.trim(), req.userId)
  if (theme !== undefined) db.prepare('UPDATE profiles SET theme = ? WHERE user_id = ?').run(Number(theme), req.userId)

  res.json({ profile: publicProfile(getProfile(req.userId)) })
})

function unlinkUpload (urlPath) {
  if (!urlPath) return
  const root = path.resolve(UPLOAD_DIR)
  const abs = path.resolve(root, path.basename(urlPath))
  if (abs === root || !abs.startsWith(root + path.sep)) return
  fs.rmSync(abs, { force: true })
}

function saveImage (req, res, field) {
  if (field !== 'avatar' && field !== 'banner') {
    return res.status(400).json({ error: 'неизвестное поле картинки' })
  }
  const image = req.body?.image
  if (typeof image !== 'string') return res.status(400).json({ error: 'нужен image — data:image/png;base64,...' })

  const match = dataUrlRe.exec(image)
  if (!match) return res.status(400).json({ error: 'ожидается картинка png / jpg / gif / webp в base64' })

  const base64 = match[2].replace(/\s/g, '')
  const buf = Buffer.from(base64, 'base64')
  if (buf.length === 0) return res.status(400).json({ error: 'пустая картинка' })
  if (buf.length > MAX_IMAGE_BYTES) return res.status(400).json({ error: 'картинка больше 3 МБ' })

  const ext = match[1].replace('jpg', 'jpeg')
  const name = `${req.userId}-${field}-${Date.now()}.${ext}`
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf)

  const profile = getProfile(req.userId)
  unlinkUpload(profile[field])

  const url = `/uploads/${name}`
  db.prepare(`UPDATE profiles SET ${field} = ? WHERE user_id = ?`).run(url, req.userId)
  res.json({ profile: publicProfile(getProfile(req.userId)) })
}

app.post('/api/profile/avatar', auth, (req, res) => saveImage(req, res, 'avatar'))
app.post('/api/profile/banner', auth, (req, res) => saveImage(req, res, 'banner'))

function clearImage (req, res, field) {
  if (field !== 'avatar' && field !== 'banner') {
    return res.status(400).json({ error: 'неизвестное поле картинки' })
  }
  const profile = getProfile(req.userId)
  unlinkUpload(profile[field])
  db.prepare(`UPDATE profiles SET ${field} = NULL WHERE user_id = ?`).run(req.userId)
  res.json({ profile: publicProfile(getProfile(req.userId)) })
}

app.delete('/api/profile/avatar', auth, (req, res) => clearImage(req, res, 'avatar'))
app.delete('/api/profile/banner', auth, (req, res) => clearImage(req, res, 'banner'))

/* ── Пароль ───────────────────────────────── */

app.post('/api/profile/password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {}
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'нужны currentPassword и newPassword' })
  }
  if (!verifyPassword(currentPassword, req.user.password_hash)) {
    return res.status(401).json({ error: 'текущий пароль неверный' })
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'новый пароль — минимум 8 символов' })
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.userId)
  // остальные сессии отзываем — пароль сменился
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.userId, req.sessionId)
  res.status(204).end()
})

/* ── Устройства (сессии) ─────────────────── */

app.get('/api/sessions', auth, (req, res) => {
  const rows = db
    .prepare('SELECT id, label, ip, created_at, last_seen FROM sessions WHERE user_id = ? ORDER BY last_seen DESC')
    .all(req.userId)
  res.json({
    sessions: rows.map(r => ({
      id: r.id,
      label: r.label,
      ip: r.ip,
      createdAt: r.created_at,
      lastSeen: r.last_seen,
      current: r.id === req.sessionId
    }))
  })
})

app.delete('/api/sessions/:id', auth, (req, res) => {
  const id = Number(req.params.id)
  const info = db
    .prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
    .run(id, req.userId)
  if (info.changes === 0) return res.status(404).json({ error: 'сессия не найдена' })
  res.status(204).end()
})

/* ── 2FA (TOTP) ──────────────────────────── */

app.post('/api/2fa/setup', auth, (req, res) => {
  if (req.user.two_fa) return res.status(409).json({ error: '2FA уже включена — сначала отключите' })
  const secret = newTotpSecret()
  pendingSetup.set(req.token, { secret, expiresAt: Date.now() + 10 * 60 * 1000 })
  res.json({ secret, issuer: 'ObsiSync', account: req.user.email })
})

app.post('/api/2fa/enable', auth, (req, res) => {
  const pending = pendingSetup.get(req.token)
  if (!pending || Date.now() > pending.expiresAt) {
    pendingSetup.delete(req.token)
    return res.status(400).json({ error: 'срок установки истёк — запросите секрет заново' })
  }
  if (!verifyTotp(pending.secret, req.body?.code)) {
    return res.status(401).json({ error: 'код неверный — проверьте аутентификатор' })
  }
  db.prepare("UPDATE users SET two_fa = 1, two_fa_secret = ? WHERE id = ?").run(pending.secret, req.userId)
  pendingSetup.delete(req.token)
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId)) })
})

app.post('/api/2fa/disable', auth, (req, res) => {
  if (!req.user.two_fa_secret) return res.status(409).json({ error: '2FA не включена' })
  if (!verifyTotp(req.user.two_fa_secret, req.body?.code)) {
    return res.status(401).json({ error: 'код неверный' })
  }
  db.prepare("UPDATE users SET two_fa = 0, two_fa_secret = NULL WHERE id = ?").run(req.userId)
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId)) })
})

/* ── Активность (заполняется синком) ─────── */

app.get('/api/activity', auth, (req, res) => {
  const rows = db
    .prepare(`
      SELECT kind, path, date(at) AS day, COUNT(*) AS n
      FROM activity
      WHERE user_id = ? AND at >= date('now', '-364 days')
      GROUP BY kind, path, day
    `)
    .all(req.userId)

  const byDay = new Map()
  const byKind = new Map()
  const byPath = new Map()
  let total = 0

  for (const r of rows) {
    total += r.n
    byDay.set(r.day, (byDay.get(r.day) || 0) + r.n)
    byKind.set(r.kind, (byKind.get(r.kind) || 0) + r.n)
    byPath.set(r.path, (byPath.get(r.path) || 0) + r.n)
  }

  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  let best = 0
  let streak = 0
  let active = 0
  let week = 0
  const weekAgo = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10)

  let prev = null
  for (const [day, n] of days) {
    active++
    if (day >= weekAgo) week += n
    if (prev && (new Date(day) - new Date(prev)) === 864e5) streak++
    else streak = 1
    if (streak > best) best = streak
    prev = day
  }

  res.json({
    total,
    activeDays: active,
    bestStreak: best,
    week,
    heatmap: [...byDay.entries()].map(([date, count]) => ({ date, count })),
    breakdown: [...byKind.entries()].map(([kind, count]) => ({ kind, count })),
    topFiles: [...byPath.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([path, count]) => ({ path, count }))
  })
})

/* ── Удаление аккаунта ───────────────────── */

app.delete('/api/account', auth, (req, res) => {
  const { password } = req.body ?? {}
  if (!password) return res.status(400).json({ error: 'нужен password' })
  if (!verifyPassword(password, req.user.password_hash)) {
    return res.status(401).json({ error: 'пароль неверный' })
  }

  const profile = getProfile(req.userId)
  for (const field of ['avatar', 'banner']) unlinkUpload(profile[field])

  const userId = req.userId
  db.prepare('DELETE FROM users WHERE id = ?').run(userId)
  fs.rmSync(path.join(VAULT_DIR, String(userId)), { recursive: true, force: true })
  res.status(204).end()
})

/* ── Файлы vault (CLI: push / pull / rm / list) ── */

const MIME = {
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.css': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip'
}

function resolveVault (rawPath, userId) {
  let rel = String(rawPath ?? '')
  try { rel = decodeURIComponent(rel) } catch {}
  rel = rel.replace(/^\/+/, '').trim()
  if (!rel) return { error: 'пустой путь' }
  if (rel.length > 500) return { error: 'путь длиннее 500 символов' }
  if (rel.includes('\0') || rel.split('/').includes('..')) return { error: 'недопустимый путь' }

  const root = path.resolve(VAULT_DIR, String(userId))
  const abs = path.resolve(root, rel)
  if (abs !== root && !abs.startsWith(root + path.sep)) return { error: 'путь вне vault' }
  return { rel, abs, root }
}

function blobPath (hash) {
  return path.join(BLOB_DIR, hash.slice(0, 2), hash)
}

function saveBlob (hash, buf) {
  if (!hash || !buf) return
  const abs = blobPath(hash)
  if (fs.existsSync(abs)) return
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const tmp = `${abs}.part-${process.pid}`
  fs.writeFileSync(tmp, buf)
  fs.renameSync(tmp, abs)
}

function readBlob (hash) {
  if (!hash) return null
  const abs = blobPath(hash)
  try { return fs.readFileSync(abs) } catch { return null }
}

function deviceOf (req) {
  if (!req.sessionId) return ''
  if (req._device === undefined) {
    req._device = db.prepare('SELECT label FROM sessions WHERE id = ?').get(req.sessionId)?.label || ''
  }
  return req._device
}

// Одна операция пользователя = строка в ленте активности + строка в истории
// версий (+ блоб с содержимым, если он новый) + пуш тем, кто подключён по WS.
function recordChange (req, kind, rel, { buf, hash = '', size = 0, prevHash = '' } = {}) {
  const userId = req.userId
  if (buf && hash) saveBlob(hash, buf)

  db.prepare('INSERT INTO activity (user_id, kind, path) VALUES (?, ?, ?)').run(userId, kind, rel)
  db.prepare(
    'INSERT INTO revisions (user_id, path, op, size, hash, prev_hash, device) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(userId, rel, kind, size, hash, prevHash, deviceOf(req))

  broadcast(userId, { type: 'change', path: rel, op: kind, hash, size })
}

// при старте добираем блобы для файлов, загруженных до появления истории
function hydrateBlobs () {
  let n = 0
  for (const row of db.prepare('SELECT user_id, path, size, hash FROM files').all()) {
    if (!row.hash || fs.existsSync(blobPath(row.hash))) continue
    const abs = path.resolve(VAULT_DIR, String(row.user_id), row.path)
    try {
      const buf = fs.readFileSync(abs)
      saveBlob(row.hash, buf)
      n++
    } catch {
      // файла нет на диске — история останется без содержимого
    }
  }
  if (n) console.log(`восстановлено блобов для истории: ${n}`)
}

// CLI при sync сообщил, что файл разошёлся локально и на сервере
app.post('/api/vault/conflict', auth, (req, res) => {
  const rel = String(req.query.path || '').replace(/^\/+/, '')
  if (!rel) return res.status(400).json({ error: 'нет path' })
  const v = resolveVault(rel, req.userId)
  if (v.error) return res.status(400).json({ error: v.error })

  recordChange(req, 'conflict', v.rel)
  res.json({ path: v.rel, kind: 'conflict' })
})

app.get('/api/vault', auth, (req, res) => {
  const rows = db
    .prepare(`
      SELECT f.path, f.size, f.hash, f.updated_at,
             (SELECT COUNT(*) FROM revisions r WHERE r.user_id = f.user_id AND r.path = f.path) AS versions
      FROM files f
      WHERE f.user_id = ?
      ORDER BY f.path
    `)
    .all(req.userId)
  res.json({
    files: rows.map(r => ({
      path: r.path,
      size: r.size,
      hash: r.hash,
      updatedAt: r.updated_at,
      versions: r.versions
    }))
  })
})

// история версий одного файла: GET /api/vault/<путь>?history=1
// содержимое конкретной версии: GET /api/vault/<путь>?version=<id>
app.get('/api/vault/*', auth, (req, res) => {
  const v = resolveVault(req.params[0], req.userId)
  if (v.error) return res.status(400).json({ error: v.error })

  if (req.query.history !== undefined) {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
    const rows = db
      .prepare(`
        SELECT id, op, size, hash, prev_hash, device, at
        FROM revisions
        WHERE user_id = ? AND path = ?
        ORDER BY at DESC, id DESC
        LIMIT ?
      `)
      .all(req.userId, v.rel, limit)
    return res.json({
      path: v.rel,
      history: rows.map(r => ({
        id: r.id,
        op: r.op,
        size: r.size,
        hash: r.hash,
        prevHash: r.prev_hash,
        device: r.device,
        at: r.at
      }))
    })
  }

  if (req.query.version !== undefined) {
    const rev = db
      .prepare('SELECT * FROM revisions WHERE user_id = ? AND path = ? AND id = ?')
      .get(req.userId, v.rel, Number(req.query.version))
    if (!rev) return res.status(404).json({ error: 'такой версии нет' })
    const buf = readBlob(rev.hash)
    if (!buf) return res.status(404).json({ error: 'содержимое версии не найдено на диске' })
    return res
      .set('Content-Type', MIME[path.extname(v.rel).toLowerCase()] || 'application/octet-stream')
      .set('X-ObsiSync-Hash', rev.hash)
      .set('X-ObsiSync-Version', String(rev.id))
      .set('X-ObsiSync-Updated', rev.at)
      .send(buf)
  }

  const meta = db.prepare('SELECT * FROM files WHERE user_id = ? AND path = ?').get(req.userId, v.rel)
  if (!meta) return res.status(404).json({ error: `файла нет: ${v.rel}` })
  if (!fs.existsSync(v.abs)) return res.status(404).json({ error: 'файл пропал с диска' })

  const buf = fs.readFileSync(v.abs)
  res
    .set('Content-Type', MIME[path.extname(v.rel).toLowerCase()] || 'application/octet-stream')
    .set('X-ObsiSync-Hash', meta.hash)
    .set('X-ObsiSync-Updated', meta.updated_at)
    .send(buf)
})

app.put('/api/vault/*', auth, express.raw({ type: () => true, limit: '50mb' }), (req, res) => {
  const v = resolveVault(req.params[0], req.userId)
  if (v.error) return res.status(400).json({ error: v.error })
  if (!Buffer.isBuffer(req.body)) {
    return res.status(415).json({ error: 'тело — сырые байты, Content-Type: application/octet-stream' })
  }

  const buf = req.body
  if (buf.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'файл больше 10 МБ' })

  const existed = db
    .prepare('SELECT id, hash, size FROM files WHERE user_id = ? AND path = ?')
    .get(req.userId, v.rel)
  const hash = createHash('sha256').update(buf).digest('hex')

  // содержимое не изменилось — новую версию не заводим
  if (existed && existed.hash === hash) {
    return res.json({ path: v.rel, size: buf.length, hash, created: false, changed: false })
  }

  fs.mkdirSync(path.dirname(v.abs), { recursive: true })
  const tmp = `${v.abs}.part-${process.pid}`
  fs.writeFileSync(tmp, buf)

  try {
    if (existed) {
      db.prepare("UPDATE files SET size = ?, hash = ?, updated_at = datetime('now') WHERE id = ?")
        .run(buf.length, hash, existed.id)
    } else {
      db.prepare('INSERT INTO files (user_id, path, size, hash) VALUES (?, ?, ?, ?)')
        .run(req.userId, v.rel, buf.length, hash)
    }
    fs.renameSync(tmp, v.abs)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }

  recordChange(req, existed ? 'updated' : 'created', v.rel, {
    buf,
    hash,
    size: buf.length,
    prevHash: existed?.hash || ''
  })

  res.json({ path: v.rel, size: buf.length, hash, created: !existed, changed: true })
})

app.delete('/api/vault/*', auth, (req, res) => {
  const v = resolveVault(req.params[0], req.userId)
  if (v.error) return res.status(400).json({ error: v.error })

  const meta = db
    .prepare('SELECT hash, size FROM files WHERE user_id = ? AND path = ?')
    .get(req.userId, v.rel)
  const info = db.prepare('DELETE FROM files WHERE user_id = ? AND path = ?').run(req.userId, v.rel)
  if (info.changes === 0) return res.status(404).json({ error: `файла нет: ${v.rel}` })

  fs.rmSync(v.abs, { force: true })
  // само содержимое остаётся в блобах — прошлые версии по-прежнему читаются
  recordChange(req, 'deleted', v.rel, { prevHash: meta?.hash || '' })

  // подчищаем опустевшие папки снизу вверх, но не выше корня vault
  let dir = path.dirname(v.abs)
  while (dir.startsWith(v.root + path.sep)) {
    try {
      if (fs.readdirSync(dir).length > 0) break
      fs.rmdirSync(dir)
    } catch {
      break
    }
    dir = path.dirname(dir)
  }

  res.status(204).end()
})

app.use((_req, res) => {
  res.status(404).json({ error: 'не найдено' })
})

app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'некорректный JSON' })
  }
  if (err?.status === 413 || err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'запрос слишком большой' })
  }
  console.error(err)
  if (res.headersSent) return
  res.status(err?.status && err.status < 500 ? err.status : 500).json({ error: 'внутренняя ошибка сервера' })
})

/* ── WebSocket: сервер пушит изменения тем, кто подключён ── */

const wss = new WebSocketServer({ noServer: true })
const wsClients = new Map() // userId -> Set<ws>

function broadcast (userId, payload) {
  const set = wsClients.get(userId)
  if (!set || !set.size) return
  const data = JSON.stringify(payload)
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(data)
  }
}

const server = app.listen(PORT, HOST, () => {
  hydrateBlobs()
  console.log(`ObsiSync API слушает http://${HOST}:${PORT}`)
  console.log(`WebSocket-канал: ws://${HOST}:${PORT}/api/ws`)
})

server.on('upgrade', (req, socket, head) => {
  let url
  try {
    url = new URL(req.url, 'http://localhost')
  } catch {
    return socket.destroy()
  }

  if (url.pathname !== '/api/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
    return socket.destroy()
  }

  // токен сессии — в query: у WebSocket нет своих заголовков
  const token = url.searchParams.get('token')
  const session = token ? db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token) : null
  if (!session) {
    console.log('ws: отклонено (нет валидного токена)')
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    return socket.destroy()
  }

  wss.handleUpgrade(req, socket, head, ws => {
    ws.userId = session.user_id
    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })

    let set = wsClients.get(ws.userId)
    if (!set) wsClients.set(ws.userId, (set = new Set()))
    set.add(ws)
    console.log(`ws: подключился user ${ws.userId} · всего клиентов ${[...wsClients.values()].reduce((n, s) => n + s.size, 0)}`)

    ws.send(JSON.stringify({ type: 'hello', userId: ws.userId }))
    ws.on('close', () => {
      set.delete(ws)
      if (!set.size) wsClients.delete(ws.userId)
      console.log(`ws: отключился user ${ws.userId}`)
    })
    ws.on('error', () => ws.terminate())
  })
})

// мёртвые соединения подчищаем: пинг раз в 30 с, без ответа — рвём
const heartbeat = setInterval(() => {
  for (const [userId, set] of wsClients) {
    for (const ws of set) {
      if (ws.readyState !== ws.OPEN || ws.isAlive === false) {
        ws.terminate()
        set.delete(ws)
        continue
      }
      ws.isAlive = false
      ws.ping()
    }
    if (!set.size) wsClients.delete(userId)
  }
}, 30_000)
heartbeat.unref()
