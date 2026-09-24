import express from 'express'
import cors from 'cors'
import { db } from './db.js'
import { hashPassword, verifyPassword, newToken, newCode } from './auth.js'

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODE_TTL_MS = 5 * 60 * 1000

// Ожидающие вторые шаги входа (2FA). На настоящем деплое код уходил бы на почту.
const pendingLogins = new Map()

function publicUser (row) {
  return { id: row.id, username: row.username, email: row.email, twoFa: !!row.two_fa, createdAt: row.created_at }
}

function createSession (userId) {
  const token = newToken()
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId)
  return token
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'obsisync-api' })
})

app.post('/api/register', (req, res) => {
  const { username, email, password, twoFactor } = req.body ?? {}

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'нужны username, email и password' })
  }
  if (username.length < 3 || username.length > 24) {
    return res.status(400).json({ error: 'username должен быть от 3 до 24 символов' })
  }
  if (!/^[a-zA-Zа-яА-ЯёЁ0-9_.-]+$/.test(username)) {
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

  const info = db
    .prepare('INSERT INTO users (username, email, password_hash, two_fa) VALUES (?, ?, ?, ?)')
    .run(username, email, hashPassword(password), twoFactor ? 1 : 0)

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
  const token = createSession(user.id)

  res.status(201).json({ token, user: publicUser(user) })
})

app.post('/api/login', (req, res) => {
  const { email, password } = req.body ?? {}

  if (!email || !password) {
    return res.status(400).json({ error: 'нужны email и password' })
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'неверный email или пароль' })
  }

  if (user.two_fa) {
    const verifyToken = newToken()
    const code = newCode()
    pendingLogins.set(verifyToken, { userId: user.id, code, expiresAt: Date.now() + CODE_TTL_MS })
    // demo: на настоящем деплое код уходит на почту, а не в ответ
    return res.json({ step: 'verify', verifyToken, demo: true, demoCode: code })
  }

  res.json({ token: createSession(user.id), user: publicUser(user) })
})

app.post('/api/login/verify', (req, res) => {
  const { verifyToken, code } = req.body ?? {}
  const pending = pendingLogins.get(verifyToken)

  if (!pending || Date.now() > pending.expiresAt) {
    pendingLogins.delete(verifyToken)
    return res.status(400).json({ error: 'сессия входа истекла — попробуйте ещё раз' })
  }
  if (pending.code !== String(code ?? '')) {
    return res.status(401).json({ error: 'код неверный' })
  }

  pendingLogins.delete(verifyToken)
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(pending.userId)
  res.json({ token: createSession(user.id), user: publicUser(user) })
})

function auth (req, res, next) {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'нужен токен: Authorization: Bearer <token>' })

  const session = db
    .prepare(`
      SELECT s.token, s.user_id, u.username, u.email, u.created_at, u.two_fa
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
    `)
    .get(token)

  if (!session) return res.status(401).json({ error: 'токен недействителен' })

  req.userId = session.user_id
  req.token = session.token
  next()
}

app.get('/api/me', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId)
  res.json({ user: publicUser(user) })
})

app.post('/api/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token)
  res.status(204).end()
})

app.use((_req, res) => {
  res.status(404).json({ error: 'не найдено' })
})

app.listen(PORT, () => {
  console.log(`ObsiSync API слушает http://localhost:${PORT}`)
})