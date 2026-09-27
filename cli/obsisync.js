#!/usr/bin/env node
/* obsisync — CLI для ObsiSync: аккаунт, профиль, файлы vault, установка Obsidian */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

/* ────────────────────────── конфиг ────────────────────────── */

const CONFIG_DIR = process.env.OBSISYNC_CONFIG_DIR ||
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'obsisync')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

const DEFAULTS = {
  server: process.env.OBSISYNC_SERVER || 'http://127.0.0.1:3000',
  token: null,
  user: null,
  // привязанная локальная папка (vault Obsidian) — используется push/pull/sync без аргументов
  vault: null
}

function loadConfig () {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

function saveConfig (cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 })
}

/* последний известный хеш каждой локальной файлы — чтобы sync знал, что менялось */
const SYNC_STATE_PATH = path.join(CONFIG_DIR, 'sync-state.json')

function loadSyncState () {
  try { return JSON.parse(fs.readFileSync(SYNC_STATE_PATH, 'utf8')) } catch { return {} }
}

function saveSyncState (state) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(SYNC_STATE_PATH, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
}

/* ────────────────────────── вывод ────────────────────────── */

const isTTY = process.stdout.isTTY
const c = {
  dim: s => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  bold: s => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  green: s => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  red: s => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: s => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: s => (isTTY ? `\x1b[36m${s}\x1b[0m` : s)
}

// чтобы `obsisync files | head` не падал с EPIPE
process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0) })

const say = (...a) => console.log(...a)
const ok = (...a) => console.log(c.green('✓'), ...a)
const warn = (...a) => console.log(c.yellow('!'), ...a)
function die (msg, code = 1) {
  console.error(c.red('✗'), msg)
  process.exit(code)
}

function human (bytes) {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`
  return `${(bytes / 1024 ** 3).toFixed(1)} ГБ`
}

/* ────────────────────────── ввод ────────────────────────── */

function prompt (question, { hidden = false, env = true } = {}) {
  if (hidden && env && process.env.OBSISYNC_PASSWORD) return Promise.resolve(process.env.OBSISYNC_PASSWORD)

  if (!process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin })
    return new Promise(resolve => {
      rl.question(question, a => { rl.close(); resolve(a.trim()) })
    })
  }

  if (!hidden) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    return new Promise(resolve => rl.question(question, a => { rl.close(); resolve(a.trim()) }))
  }

  // маскированный ввод (пароль/код)
  return new Promise(resolve => {
    const stdin = process.stdin
    const stdout = process.stdout
    let value = ''
    stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', function onData (chunk) {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\n' || ch === '\r') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.removeListener('data', onData)
          stdout.write('\n')
          resolve(value.trim())
          return
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false)
          stdin.pause()
          stdout.write('\n')
          process.exit(130)
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1)
            stdout.write('\b \b')
          }
          continue
        }
        value += ch
        stdout.write('*')
      }
    })
  })
}

/* ────────────────────────── API ────────────────────────── */

async function api (p, { method = 'GET', body, raw, token = true, headers = {}, allowFail = false } = {}) {
  const cfg = loadConfig()
  const server = SERVER_OVERRIDE || cfg.server
  const h = { ...headers }
  const t = token === true ? cfg.token : token
  if (t) h.Authorization = `Bearer ${t}`

  let data = null
  if (raw !== undefined) {
    data = raw
    h['Content-Type'] = h['Content-Type'] || 'application/octet-stream'
  } else if (body !== undefined) {
    data = Buffer.from(JSON.stringify(body))
    h['Content-Type'] = 'application/json'
  }

  let res
  try {
    res = await fetch(server + p, { method, headers: h, body: data })
  } catch (e) {
    if (allowFail) return { status: 0, json: null, buf: Buffer.alloc(0), headers: null, error: e.message }
    die(`сервер недоступен: ${server}\n  (${e.message}) — запусти API или смени адрес: obsisync config set server <url>`)
  }

  const buf = Buffer.from(await res.arrayBuffer())
  const ct = res.headers.get('content-type') || ''
  let json = null
  if (ct.includes('json')) {
    try { json = JSON.parse(buf.toString('utf8')) } catch {}
  }

  if (!res.ok) {
    const msg = json?.error || buf.toString('utf8').slice(0, 200) || `HTTP ${res.status}`
    if (allowFail) return { status: res.status, json, buf, headers: res.headers, error: msg }
    if (res.status === 401) die(`нет доступа: ${msg}\n  попробуй: obsisync login`)
    die(msg)
  }
  return { status: res.status, json, buf, headers: res.headers, error: null }
}

function requireToken () {
  const cfg = loadConfig()
  if (!cfg.token) die('не авторизован — сначала: obsisync login')
  return cfg
}

/* ────────────────────────── команды: аккаунт ────────────────────────── */

async function cmdRegister (args) {
  const email = args[0]
  const username = args[1]
  if (!email || !username) die('использование: obsisync register <email> <username>')

  const password = process.env.OBSISYNC_PASSWORD ||
    await prompt('пароль (минимум 8 символов): ', { hidden: true })
  if (password.length < 8) die('пароль короче 8 символов')

  const cfg = loadConfig()
  const { json } = await api('/api/register', {
    method: 'POST',
    token: false,
    body: { email, username, password }
  })

  cfg.token = json.token
  cfg.user = json.user
  saveConfig(cfg)
  ok(`аккаунт создан: @${json.user.username}`)
  say(c.dim(`  сервер: ${cfg.server}`))
}

async function cmdLogin (args) {
  const cfg = loadConfig()
  const email = args[0] || cfg.user?.email
  if (!email) die('использование: obsisync login <email>')

  const password = process.env.OBSISYNC_PASSWORD ||
    await prompt('пароль: ', { hidden: true })

  let res = await api('/api/login', { method: 'POST', token: false, body: { email, password } })

  if (res.json?.step === 'verify') {
    warn('включена 2FA — нужен код из аутентификатора')
    const code = process.env.OBSISYNC_CODE ||
      await prompt('код (6 цифр): ', { hidden: true, env: false })
    res = await api('/api/login/verify', {
      method: 'POST',
      token: false,
      body: { verifyToken: res.json.verifyToken, code }
    })
  }

  cfg.token = res.json.token
  cfg.user = res.json.user
  saveConfig(cfg)
  ok(`вошли как @${res.json.user.username}`)
}

async function cmdLogout () {
  const cfg = requireToken()
  // сервер может уже отозвать токен — локальную сессию чистим в любом случае
  const res = await api('/api/logout', { method: 'POST', allowFail: true })
  cfg.token = null
  cfg.user = null
  saveConfig(cfg)
  if (res.status === 0) warn(`сервер недоступен — локальный токен всё равно удалён (${res.error})`)
  else if (res.status !== 204 && res.status !== 401) warn(`сервер ответил ${res.status}, но локальная сессия очищена`)
  ok('вы вышли')
}

async function cmdWhoami ({ json: asJson } = {}) {
  requireToken()
  const { json } = await api('/api/me')
  const { user, profile } = json

  if (asJson) return say(JSON.stringify({ user, profile }, null, 2))

  say(`${c.bold('@' + user.username)}  ${c.dim(user.email)}`)
  say(c.dim(`  id: ${user.id} · зарегистрирован: ${user.createdAt} · 2FA: ${user.twoFa ? 'да' : 'нет'}`))
  say(c.dim(`  bio: ${profile.bio || '—'}`))
  say(c.dim(`  тема баннера: ${profile.theme + 1} · аватар: ${profile.avatar || 'нет'} · баннер: ${profile.banner || 'нет'}`))

  const [{ json: act }, { json: ses }] = await Promise.all([
    api('/api/activity'),
    api('/api/sessions')
  ])
  say(c.dim(`  активность: ${act.total} операций, ${act.activeDays} активных дней · сессий: ${ses.sessions.length}`))
}

async function cmdProfile (args, flags) {
  requireToken()

  if (args[0] !== 'set') return cmdWhoami({ json: flags.json })

  const patch = {}
  if (flags.bio !== undefined) patch.bio = flags.bio
  if (flags.theme !== undefined) patch.theme = Number(flags.theme)
  if (Object.keys(patch).length === 0) die('нечего менять: --bio "текст" --theme 0..3')

  const { json } = await api('/api/profile', { method: 'PUT', body: patch })
  ok('профиль обновлён')
  say(c.dim(`  bio: ${json.profile.bio || '—'} · тема: ${json.profile.theme + 1}`))
}

async function cmdAvatarOrBanner (kind, args, flags) {
  requireToken()
  const label = kind === 'avatar' ? 'аватар' : 'баннер'

  if (flags.clear) {
    const { json } = await api(`/api/profile/${kind}`, { method: 'DELETE' })
    ok(`${label} сброшен на дефолтный`)
    say(c.dim(`  ${kind}: ${json.profile[kind] || 'нет'}`))
    return
  }

  const file = args[0]
  if (!file) die(`использование: obsisync ${kind} <файл.png>\n           obsisync ${kind} --clear`)
  const buf = readLocalFile(file)
  if (buf.length > 3 * 1024 * 1024) die('картинка больше 3 МБ')

  const ext = path.extname(file).toLowerCase().replace('.', '').replace('jpg', 'jpeg')
  const image = `data:image/${['png', 'jpeg', 'gif', 'webp'].includes(ext) ? ext : 'png'};base64,${buf.toString('base64')}`
  const { json } = await api(`/api/profile/${kind}`, { method: 'POST', body: { image } })
  ok(`${label} загружен: ${json.profile[kind]}`)
}

async function cmdSessions () {
  requireToken()
  const { json } = await api('/api/sessions')
  if (!json.sessions.length) return warn('сессий нет')

  for (const s of json.sessions) {
    const mark = s.current ? c.green('●') : c.dim('○')
    say(`${mark} ${String(s.id).padStart(4)}  ${s.label.padEnd(20)} ${c.dim(s.ip || '—')}`)
    say(`      вход ${s.createdAt} · последняя активность ${s.lastSeen}`)
  }
}

async function cmdRevoke (args) {
  requireToken()
  const id = args[0]
  if (!id) die('использование: obsisync revoke <id сессии>')
  await api(`/api/sessions/${id}`, { method: 'DELETE' })
  ok(`сессия ${id} отозвана`)
}

async function cmdPassword () {
  requireToken()
  const currentPassword = process.env.OBSISYNC_PASSWORD ||
    await prompt('текущий пароль: ', { hidden: true })
  // не берём его же из OBSISYNC_PASSWORD — новый пароль читаем отдельно
  const newPassword = process.env.OBSISYNC_NEW_PASSWORD ||
    await prompt('новый пароль (мин 8): ', { hidden: true, env: false })
  if (newPassword.length < 8) die('новый пароль короче 8 символов')
  await api('/api/profile/password', { method: 'POST', body: { currentPassword, newPassword } })
  ok('пароль изменён, остальные сессии отозваны')
}

/* ────────────────────────── команды: статус / активность / 2FA / аккаунт ────────────────────────── */

async function cmdStatus (flags) {
  const cfg = loadConfig()
  const server = SERVER_OVERRIDE || cfg.server

  const health = await api('/health', { token: false, allowFail: true })
  const online = health.status === 200
  const me = cfg.token ? await api('/api/me', { allowFail: true }) : null
  const authed = !!me && me.status === 200

  if (flags.json) {
    return say(JSON.stringify({
      server,
      online,
      service: health.json?.service || null,
      authed,
      user: authed ? me.json.user : null,
      profile: authed ? me.json.profile : null,
      vault: cfg.vault || null
    }, null, 2))
  }

  say(`${c.bold('сервер')}  ${server}  ${online ? c.green('✓ ' + (health.json?.service || 'ok')) : c.red('✗ недоступен')}`)
  if (authed) {
    const u = me.json.user
    say(`${c.bold('аккаунт')} @${u.username} ${c.dim(`id ${u.id} · ${u.email}`)} · 2FA: ${u.twoFa ? c.green('да') : c.dim('нет')}`)
    say(`${c.bold('профиль')} bio: ${me.json.profile.bio || '—'} · тема ${me.json.profile.theme + 1}`)
  } else if (cfg.token) {
    say(`${c.bold('аккаунт')} ${c.red('токен недействителен')} — obsisync login`)
  } else {
    say(`${c.bold('аккаунт')} ${c.dim('не авторизован')} — obsisync login`)
  }
  say(`${c.bold('vault')}   ${cfg.vault ? cfg.vault : c.dim('не привязан — obsisync obsidian link <папка>')}`)
  say(c.dim(`конфиг    ${CONFIG_PATH}`))

  if (authed) {
    const v = await api('/api/vault', { allowFail: true })
    if (v.status === 200) {
      const files = v.json.files
      const total = files.reduce((s, f) => s + f.size, 0)
      say(`${c.bold('файлы')}   ${files.length} · ${human(total)}`)
    }
  }
}

const MONTH_BAR = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

async function cmdActivity (flags) {
  requireToken()
  const { json } = await api('/api/activity')

  if (flags.json) return say(JSON.stringify(json, null, 2))

  if (json.total === 0) {
    warn('операций пока нет — синк ещё не запускался')
    say(c.dim('  попробуй: obsisync push <папка> или obsisync sync <папка>'))
    return
  }

  say(`${c.bold(String(json.total))} операций · ${json.activeDays} активных дней · лучшая серия ${json.bestStreak} дн. · за 7 дней ${json.week}`)

  if (json.breakdown.length) {
    const labels = { created: 'создано', updated: 'изменено', deleted: 'удалено', conflict: 'конфликты' }
    say('\n' + c.bold('по типам'))
    for (const b of json.breakdown) {
      const w = Math.round((b.count / json.total) * 34)
      say(`  ${(labels[b.kind] || b.kind).padEnd(11)} ${'█'.repeat(w)}${'░'.repeat(34 - w)} ${b.count}`)
    }
  }

  if (json.topFiles.length) {
    say('\n' + c.bold('чаще всего правили'))
    const max = json.topFiles[0].count
    for (const t of json.topFiles) {
      const w = Math.round((t.count / max) * 34)
      say(`  ${c.dim(t.path.padEnd(38).slice(0, 38))} ${'▓'.repeat(w)}${'░'.repeat(34 - w)} ${t.count}`)
    }
  }

  // последние 12 месяцев по дням активности
  const byMonth = new Map()
  for (const d of json.heatmap) {
    const key = d.date.slice(0, 7)
    byMonth.set(key, (byMonth.get(key) || 0) + d.count)
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12)
  if (months.length) {
    const mMax = Math.max(...months.map(m => m[1]))
    say('\n' + c.bold('по месяцам'))
    for (const [key, n] of months) {
      const [y, m] = key.split('-')
      const w = Math.round((n / mMax) * 30)
      say(`  ${MONTH_BAR[Number(m) - 1]} ${y.slice(2)}  ${'█'.repeat(w)}${'░'.repeat(30 - w)} ${n}`)
    }
  }
}

function otpauthUri (secret, account) {
  const q = new URLSearchParams({ secret, issuer: 'ObsiSync', algorithm: 'SHA1', digits: '6', period: '30' })
  return `otpauth://totp/ObsiSync:${encodeURIComponent(account)}?${q}`
}

async function cmdTwoFa (args, flags) {
  requireToken()
  const sub = args[0] || 'status'

  if (sub === 'status' || !['setup', 'enable', 'disable'].includes(sub)) {
    if (sub !== 'status' && !['setup', 'enable', 'disable'].includes(sub)) die(`неизвестный подкоманд 2fa: ${sub}\n  использование: obsisync 2fa [status|setup|enable <код>|disable <код>]`)
    const { json } = await api('/api/me')
    if (json.user.twoFa) {
      ok('2FA включена — при входе нужен код из аутентификатора')
    } else {
      warn('2FA выключена')
      say(c.dim('  включить: obsisync 2fa setup'))
    }
    return
  }

  if (sub === 'setup') {
    const { json } = await api('/api/2fa/setup', { method: 'POST', body: {} })
    say(c.bold('секрет (введи в аутентификатор):'))
    say(`  ${c.cyan(json.secret)}`)
    say(c.bold('\nили otpauth-ссылка:'))
    say(`  ${otpauthUri(json.secret, json.account)}`)
    say(c.dim(`\n  аккаунт: ${json.account} · срок подтверждения 10 минут`))
    say(c.dim(`  подтвердить: obsisync 2fa enable <код из аутентификатора>`))
    return
  }

  if (sub === 'enable') {
    const code = args[1] || process.env.OBSISYNC_CODE || await prompt('код из аутентификатора (6 цифр): ', { hidden: true, env: false })
    const { status, json } = await api('/api/2fa/enable', { method: 'POST', body: { code }, allowFail: true })
    if (status !== 200) return die(json?.error || 'код не принят')
    ok('2FA включена')
    return
  }

  // disable
  const code = args[1] || process.env.OBSISYNC_CODE || await prompt('код из аутентификатора (6 цифр): ', { hidden: true, env: false })
  const { status, json } = await api('/api/2fa/disable', { method: 'POST', body: { code }, allowFail: true })
  if (status !== 200) return die(json?.error || 'код не принят')
  ok('2FA отключена')
}

async function cmdAccountDelete (args, flags) {
  const cfg = requireToken()
  const who = cfg.user?.username ? `@${cfg.user.username}` : 'свой аккаунт'

  if (!flags.yes) {
    const answer = await prompt(`удалить аккаунт ${who} со всеми файлами и профилем? введи "да": `)
    if (!/^да|y|yes$/i.test(answer)) return warn('отменено')
  }

  const password = process.env.OBSISYNC_PASSWORD || await prompt('пароль для подтверждения: ', { hidden: true })
  const { status, error } = await api('/api/account', { method: 'DELETE', body: { password }, allowFail: true })
  if (status !== 204) return die(error || 'не удалось удалить аккаунт')

  cfg.token = null
  cfg.user = null
  cfg.vault = null
  saveConfig(cfg)
  ok('аккаунт удалён навсегда')
}

/* ────────────────────────── команды: файлы ────────────────────────── */

function readLocalFile (file) {
  if (!fs.existsSync(file)) die(`файла нет: ${file}`)
  return fs.readFileSync(file)
}

// системные папки и конфиг Obsidian — на сервер едут только заметки и вложения
const SKIP_DIRS = new Set(['.git', 'node_modules', '.trash', '.obsidian'])
const SKIP_FILES = new Set()

function shouldSkip (rel) {
  const norm = rel.split(path.sep).join('/')
  if (SKIP_FILES.has(norm)) return true
  return rel.split(path.sep).some(p => SKIP_DIRS.has(p))
}

function walk (dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(abs, base, out)
    else if (entry.isFile()) {
      const rel = path.relative(base, abs)
      if (!shouldSkip(rel)) out.push(rel)
    }
  }
  return out
}

const MAX_UPLOAD = 10 * 1024 * 1024 // сервер режет файлы больше 10 МБ

async function cmdFiles (args) {
  requireToken()
  const prefix = args[0] ? args[0].replace(/^\/+/, '').replace(/\/+$/, '') : ''
  const { json } = await api('/api/vault')
  const files = json.files.filter(f => !prefix || f.path === prefix || f.path.startsWith(prefix + '/'))

  if (!files.length) return say(c.dim(prefix ? `под «${prefix}» пусто` : 'vault пуст'))

  let total = 0
  for (const f of files) {
    total += f.size
    say(`  ${f.path.padEnd(50)} ${String(human(f.size)).padStart(8)}  ${c.dim(f.updatedAt)}`)
  }
  say(c.dim(`\n  файлов: ${files.length} · всего: ${human(total)}`))
}

async function cmdCat (args) {
  requireToken()
  const p = args[0]
  if (!p) die('использование: obsisync cat <путь/в/vault>')
  const { buf, headers } = await api('/api/vault/' + p.split('/').map(encodeURIComponent).join('/'))
  if (process.stdout.isTTY) {
    say(c.dim(`--- ${p} · ${human(buf.length)} · sha ${(headers.get('x-obsisync-hash') || '').slice(0, 12)} ---`))
  }
  process.stdout.write(buf)
}

async function cmdHistory (args) {
  requireToken()
  const target = args[0]
  if (!target) {
    die('использование: obsisync history <путь/в/vault> [<номер версии>]\n           (номер версии — вывести содержимое именно этой версии)')
  }
  const rel = target.replace(/^\/+/, '')
  const enc = p => p.split('/').map(encodeURIComponent).join('/')

  if (args[1]) {
    const { buf, headers } = await api(`/api/vault/${enc(rel)}?version=${encodeURIComponent(args[1])}`)
    if (process.stdout.isTTY) {
      say(c.dim(`--- ${rel} · версия ${headers.get('x-obsisync-version')} · ${human(buf.length)} · ${headers.get('x-obsisync-updated')} ---`))
    }
    process.stdout.write(buf)
    return
  }

  const { json } = await api(`/api/vault/${enc(rel)}?history=1`)
  if (!json.history.length) return say(c.dim(`у «${rel}» нет истории`))

  const opRu = { created: 'создан', updated: 'изменён', deleted: 'удалён', conflict: 'конфликт' }
  let first = true
  for (const r of json.history) {
    const mark = first ? c.green('●') : c.dim('○')
    first = false
    const dev = r.device ? c.dim(`  ${r.device}`) : ''
    say(`  ${mark} ${String(r.id).padStart(4)}  ${(opRu[r.op] || r.op).padEnd(9)} ${String(human(r.size)).padStart(8)}  ${c.dim(r.at)}${dev}`)
  }
  say(c.dim(`\n  версий: ${json.history.length} · содержимое версии: obsisync history ${rel} <номер>`))
}

async function cmdPush (args) {
  requireToken()
  const bound = loadConfig().vault
  const src = args[0] || bound
  if (!src) die('использование: obsisync push <файл|папка> [путь/в/vault]\n           (привязанную папку: obsisync obsidian link <папка>)')
  if (!fs.existsSync(src)) die(`нет такого: ${src}`)

  const stat = fs.statSync(src)
  const { json: listing } = await api('/api/vault')
  const known = new Set(listing.files.map(f => f.path))

  const jobs = []
  if (stat.isFile()) {
    const dest = args[1] || path.basename(src)
    jobs.push([src, dest.replace(/^\/+/, '')])
  } else if (stat.isDirectory()) {
    const root = args[1] ? args[1].replace(/^\/+/, '').replace(/\/+$/, '') : ''
    for (const rel of walk(src)) {
      jobs.push([path.join(src, rel), root ? `${root}/${rel}` : rel])
    }
  } else {
    die('источник — ни файл, ни папка')
  }

  if (!jobs.length) return warn('нечего отправлять')

  let uploaded = 0
  let same = 0
  let skipped = 0
  for (const [local, remote] of jobs) {
    const buf = fs.readFileSync(local)
    if (buf.length > MAX_UPLOAD) {
      skipped++
      warn(`${remote}: ${human(buf.length)} — больше лимита 10 МБ, пропущен`)
      continue
    }
    const hash = createHash('sha256').update(buf).digest('hex')
    const knownPath = listing.files.find(f => f.path === remote)
    if (knownPath && knownPath.hash === hash) {
      same++
      continue
    }
    const { json } = await api('/api/vault/' + remote.split('/').map(encodeURIComponent).join('/'), {
      method: 'PUT',
      raw: buf
    })
    uploaded++
    if (!flags.quiet) say(`  ${known.has(remote) ? c.yellow('↑') : c.green('+')} ${remote} ${c.dim(`(${human(json.size)})`)}`)
  }

  const tail = `${same ? `, без изменений: ${same}` : ''}${skipped ? `, пропущено: ${skipped}` : ''}`
  if (!uploaded && skipped) warn('ничего не загружено' + tail)
  else ok(`загружено: ${uploaded}${tail}`)
}

async function cmdPull (args) {
  requireToken()
  const bound = loadConfig().vault
  const remote = args[0]

  // без аргументов — забираем весь серверный vault в привязанную папку
  if (!remote) {
    if (!bound) die('использование: obsisync pull <путь/в/vault> [локальный путь]\n           или привяжи папку: obsisync obsidian link <папка>')
    const { json } = await api('/api/vault')
    if (!json.files.length) return warn('на сервере пусто')
    let n = 0
    for (const f of json.files) {
      const dest = path.join(bound, f.path)
      await downloadTo(f.path, dest)
      n++
      if (!flags.quiet) say(`  ↓ ${f.path} ${c.dim(`(${human(f.size)})`)}`)
    }
    ok(`скачано файлов: ${n} → ${bound}`)
    return
  }

  const rel = remote.replace(/^\/+/, '')

  const { json } = await api('/api/vault')
  const exact = json.files.find(f => f.path === rel)
  const under = json.files.filter(f => f.path.startsWith(rel.replace(/\/+$/, '') + '/'))

  if (exact) {
    const dest = args[1] || path.basename(rel)
    await downloadTo(exact.path, dest)
    ok(`скачан ${exact.path} → ${dest}`)
    return
  }

  if (!under.length) die(`на сервере нет ничего под: ${rel}`)

  const destRoot = args[1] || rel.replace(/\/+$/, '')
  let n = 0
  for (const f of under) {
    const suffix = f.path.slice(rel.replace(/\/+$/, '').length + 1)
    const dest = path.join(destRoot, suffix)
    await downloadTo(f.path, dest)
    n++
    if (!flags.quiet) say(`  ↓ ${f.path} ${c.dim(`(${human(f.size)})`)}`)
  }
  ok(`скачано файлов: ${n} → ${destRoot}`)
}

async function downloadTo (remotePath, dest) {
  const { buf } = await api('/api/vault/' + remotePath.split('/').map(encodeURIComponent).join('/'))
  fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true })
  fs.writeFileSync(dest, buf)
}

async function cmdRm (args) {
  requireToken()
  const target = args[0]
  if (!target) die('использование: obsisync rm <путь/в/vault>')
  const rel = target.replace(/^\/+/, '')

  const { json } = await api('/api/vault')
  const exact = json.files.find(f => f.path === rel)
  const under = json.files.filter(f => f.path.startsWith(rel.replace(/\/+$/, '') + '/'))
  const victims = exact ? [exact] : under

  if (!victims.length) die(`на сервере нет: ${rel}`)
  if (victims.length > 1 && !flags.yes) {
    const answer = await prompt(`удалить ${victims.length} файлов из «${rel}»? (да/нет): `)
    if (!/^(да|y|yes)$/i.test(answer)) return warn('отменено')
  }

  for (const f of victims) {
    await api('/api/vault/' + f.path.split('/').map(encodeURIComponent).join('/'), { method: 'DELETE' })
    if (!flags.quiet) say(`  ${c.red('−')} ${f.path}`)
  }
  ok(`удалено: ${victims.length}`)
}

/* ────────────────────────── команды: синк ────────────────────────── */

async function cmdSync (args, flags) {
  requireToken()
  const cfg = loadConfig()
  const local = args[0] || cfg.vault
  if (!local) die('использование: obsisync sync <папка>\n           (привяжи папку: obsisync obsidian link <папка>)')

  const root = path.resolve(local)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) die(`папки нет: ${root}`)

  const { json: listing } = await api('/api/vault')
  const remote = new Map(listing.files.map(f => [f.path, f]))
  const states = loadSyncState()
  const state = states[root] || {}

  const localFiles = new Map()
  for (const rel of walk(root)) {
    const abs = path.join(root, rel)
    const buf = fs.readFileSync(abs)
    localFiles.set(rel, { buf, hash: createHash('sha256').update(buf).digest('hex') })
  }

  const up = []          // отправить
  const down = []        // скачать
  const del = []         // удалить на сервере (файл удалили локально)
  const same = []        // совпадают
  const conflict = []    // изменились с обеих сторон

  for (const [rel, l] of localFiles) {
    const r = remote.get(rel)
    if (!r) { up.push(rel); continue }
    if (r.hash === l.hash) { same.push(rel); continue }
    const before = state[rel]
    if (before === l.hash) down.push(rel)   // менялся только сервер
    else if (before === r.hash) up.push(rel) // менялся только локально
    else conflict.push(rel)                  // разошлись обе стороны (или истории нет)
  }
  for (const rel of remote.keys()) {
    if (localFiles.has(rel)) continue
    if (state[rel] !== undefined) del.push(rel) // мы его удалили
    else down.push(rel)                          // видим впервые
  }

  const enc = p => p.split('/').map(encodeURIComponent).join('/')

  // раскладка конфликтов
  if (conflict.length && !flags.force) {
    const firstRun = Object.keys(state).length === 0
    warn(firstRun
      ? `конфликтов: ${conflict.length} (первый sync этой папки — истории изменений нет)`
      : `конфликтов: ${conflict.length} (изменены и локально, и на сервере)`)
    for (const rel of conflict) {
      say(`  ${c.yellow('!')} ${rel}`)
      say(c.dim(`      серверная версия: obsisync pull ${rel}`))
      say(c.dim(`      локальная версия:  obsisync push ${root}/${rel} ${rel}`))
    }
    say(c.dim('  или разрешить все сразу: obsisync sync --force (побеждает сервер)'))
  }

  // конфликты попадают в ленту активности на сайте (пропускаем при dry-run)
  if (conflict.length && !flags.force && !flags.dryRun) {
    for (const rel of conflict) {
      await api('/api/vault/conflict?path=' + encodeURIComponent(rel), { method: 'POST', allowFail: true })
    }
  }

  for (const rel of conflict) {
    if (!flags.force) continue
    down.push(rel)
  }

  let nUp = 0, nDown = 0, nDel = 0, nSkip = 0, nTooBig = 0
  if (!flags.dryRun) {
    for (const rel of up) {
      const l = localFiles.get(rel)
      if (l.buf.length > MAX_UPLOAD) {
        nTooBig++
        warn(`${rel}: ${human(l.buf.length)} — больше лимита 10 МБ, пропущен`)
        continue
      }
      const existed = remote.has(rel)
      await api('/api/vault/' + enc(rel), { method: 'PUT', raw: l.buf })
      nUp++
      if (!flags.quiet) say(`  ${existed ? c.yellow('↑') : c.green('+')} ${rel}`)
    }

    for (const rel of down) {
      const { buf } = await api('/api/vault/' + enc(rel))
      const dest = path.join(root, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, buf)
      nDown++
      if (!flags.quiet) say(`  ${c.cyan('↓')} ${rel}`)
    }

    for (const rel of del) {
      await api('/api/vault/' + enc(rel), { method: 'DELETE' })
      nDel++
      if (!flags.quiet) say(`  ${c.red('−')} ${rel} (удалён на сервере)`)
    }
  } else {
    for (const rel of up) say(`  ${c.green('+')} ${rel} (будет загружен)`)
    for (const rel of down) say(`  ${c.cyan('↓')} ${rel} (будет скачан)`)
    for (const rel of del) say(`  ${c.red('−')} ${rel} (будет удалён на сервере)`)
    nUp = up.length
    nDown = down.length
    nDel = del.length
  }

  // запоминаем, что стало после синка — конфликты не трогаем
  const newState = { ...state }
  for (const rel of up) newState[rel] = localFiles.get(rel).hash
  for (const rel of down) {
    const f = remote.get(rel)
    if (f) newState[rel] = f.hash
    else delete newState[rel]
  }
  for (const rel of del) delete newState[rel]
  for (const rel of same) newState[rel] = localFiles.get(rel).hash
  if (!flags.dryRun) {
    states[root] = newState
    saveSyncState(states)
  }

  const parts = [`↑ ${nUp}`, `↓ ${nDown}`, nDel ? `− ${nDel}` : null].filter(Boolean).join(' · ')
  const note = [
    `без изменений: ${same.length}`,
    conflict.length && !flags.force ? `конфликтов: ${conflict.length}` : null,
    nTooBig ? `пропущено: ${nTooBig}` : null
  ].filter(Boolean).join(' · ')
  if (flags.dryRun) ok(`пробный прогон (${parts})${note ? ' · ' + note : ''}`)
  else ok(`синк ${parts}${note ? ' · ' + note : ''}  →  ${root}`)
}

/* ────────────────────────── команды: Obsidian ────────────────────────── */

function run (cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' })
  return { ok: res.status === 0, out: (res.stdout || '') + (res.stderr || ''), status: res.status }
}

// для sudo/apt — пусть вывод и пароль идут прямо в терминал
function runInteractive (cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' })
  return res.status === 0
}

function which (bin) {
  return run('which', [bin]).ok
}

function findObsidian () {
  // сначала pacman: не запускаем сам бинарь (Electron-приложение может открыть окно)
  const pacman = run('pacman', ['-Q', 'obsidian'])
  if (pacman.ok) {
    const [, version] = pacman.out.trim().split(/\s+/)
    return { where: 'pacman', version }
  }
  const flatpak = run('flatpak', ['info', 'md.obsidian.Obsidian'])
  if (flatpak.ok) return { where: 'flatpak', version: 'установлен через flatpak' }

  const appImage = path.join(os.homedir(), 'Applications', 'Obsidian.AppImage')
  if (fs.existsSync(appImage)) return { where: appImage, version: 'AppImage' }

  if (which('obsidian')) return { where: 'PATH (/usr/bin/obsidian)', version: '—' }
  return null
}

/* Obsidian хранит список vault'ов в obsidian.json (обычный JSON со словарём vaults) */
function obsidianConfigCandidates () {
  const home = os.homedir()
  const out = []
  if (process.platform === 'linux') {
    out.push(path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'obsidian', 'obsidian.json'))
    out.push(path.join(home, '.var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json'))
  } else if (process.platform === 'darwin') {
    out.push(path.join(home, 'Library/Application Support/obsidian/obsidian.json'))
  } else if (process.platform === 'win32') {
    out.push(path.join(process.env.APPDATA || path.join(home, 'AppData/Roaming'), 'obsidian', 'obsidian.json'))
  }
  return out
}

function findObsidianConfig () {
  return obsidianConfigCandidates().find(p => fs.existsSync(p)) || null
}

function readObsidianVaults () {
  const cfgPath = findObsidianConfig()
  if (!cfgPath) return { config: null, vaults: [] }
  try {
    const j = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    const vaults = Object.entries(j.vaults || {}).map(([id, v]) => ({
      id,
      path: v.path,
      ts: v.ts || null,
      open: !!v.open
    }))
    return { config: cfgPath, vaults }
  } catch {
    return { config: cfgPath, vaults: [] }
  }
}

async function cmdObsidianVaults ({ json: asJson } = {}) {
  const { config, vaults } = readObsidianVaults()
  if (asJson) return say(JSON.stringify({ config, vaults }, null, 2))

  if (!config) {
    warn('конфиг Obsidian не найден — Obsidian не запускался на этой машине')
    say(c.dim(`  искал в:\n    ` + obsidianConfigCandidates().join('\n    ')))
    say(c.dim('  можно привязать папку вручную: obsisync obsidian link <папка>'))
    return
  }
  if (!vaults.length) {
    warn('Obsidian не настроил ни одного vault')
    say(c.dim(`  конфиг: ${config}`))
    return
  }
  const bound = loadConfig().vault
  say(c.bold(`vault'ы Obsidian (${vaults.length})`) + c.dim(`  ${config}`))
  vaults.forEach((v, i) => {
    const mark = v.open ? c.green('●') : c.dim('○')
    const hit = bound && path.resolve(v.path) === path.resolve(bound) ? c.cyan('  ← привязан') : ''
    say(`  ${mark} ${String(i + 1).padStart(2)}. ${v.path}${hit}`)
  })
  say(c.dim('\n  привязать: obsisync obsidian link <номер|путь>'))
}

async function cmdObsidianLink (args, flags) {
  const cfg = loadConfig()

  if (flags.clear) {
    cfg.vault = null
    saveConfig(cfg)
    return ok('папка отвязана')
  }

  let target = args[0] || (flags.vault !== undefined ? String(flags.vault) : null)

  // номер из `obsidian vaults`
  if (target && /^\d+$/.test(target)) {
    const { vaults } = readObsidianVaults()
    const v = vaults[Number(target) - 1]
    if (!v) die(`vault с номером ${target} не найден — посмотри: obsisync obsidian vaults`)
    target = v.path
  }

  if (!target) {
    const { vaults } = readObsidianVaults()
    if (!vaults.length) die('использование: obsisync obsidian link <папка>\n           (или: obsisync obsidian link <номер> — из `obsisync obsidian vaults`)')
    die(`выбери vault:\n${vaults.map((v, i) => `  ${i + 1}. ${v.path}`).join('\n')}\n\n  obsisync obsidian link <номер|путь>`)
  }

  const abs = path.resolve(target)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) die(`папки нет: ${abs}`)

  cfg.vault = abs
  saveConfig(cfg)
  ok(`привязана папка: ${abs}`)
  const files = walk(abs)
  const total = files.reduce((s, f) => s + fs.statSync(path.join(abs, f)).size, 0)
  say(c.dim(`  найдено: ${files.length} файлов (${human(total)}) · что дальше:`))
  say(c.dim(`    obsisync sync        — двухсторонний синк`))
  say(c.dim(`    obsisync push        — только загрузить на сервер`))
  say(c.dim(`    obsisync pull        — только скачать с сервера`))
}

async function cmdObsidianOpen (args) {
  const cfg = loadConfig()
  const root = args[0] || cfg.vault
  if (!root) die('сначала привяжи папку: obsisync obsidian link <папка>')
  const abs = path.resolve(root)
  if (!fs.existsSync(abs)) die(`папки нет: ${abs}`)

  const found = findObsidian()
  if (!found) die('Obsidian не установлен — obsisync obsidian install')
  if (found.where === 'flatpak') return runInteractive('flatpak', ['run', 'md.obsidian.Obsidian', abs])
  if (found.where.includes('AppImage')) return runInteractive(found.where, [abs])
  if (found.where.includes('pacman')) return runInteractive('obsidian', [abs])
  if (which('obsidian')) return runInteractive('obsidian', [abs])
  die(`не смог запустить Obsidian: ${found.where}`)
}

async function cmdObsidianStatus () {
  const found = findObsidian()
  if (found) {
    ok(`Obsidian установлен: ${found.version}`)
    say(c.dim(`  где: ${found.where}`))
  } else {
    warn('Obsidian не установлен')
    say(c.dim('  установить: obsisync obsidian install'))
  }

  const { config, vaults } = readObsidianVaults()
  if (config) say(c.dim(`  конфиг: ${config} · vault'ов: ${vaults.length}`))
  else say(c.dim('  конфиг Obsidian не найден'))

  const bound = loadConfig().vault
  if (bound) {
    if (!fs.existsSync(bound)) {
      warn(`привязанная папка исчезла: ${bound}`)
      say(c.dim('  отвязать: obsisync obsidian link --clear'))
    } else {
      const files = walk(bound)
      ok(`привязана папка: ${bound}`)
      say(c.dim(`  в ней ${files.length} файлов · синк: obsisync sync`))
    }
  } else {
    say(c.dim('  папка не привязана — obsisync obsidian link <папка>'))
  }
}

async function cmdObsidianInstall (flags) {
  const existing = findObsidian()
  if (existing && !flags.force) {
    ok(`уже установлен (${existing.version}, ${existing.where})`)
    say(c.dim('  чтобы переустановить: obsisync obsidian install --force'))
    return
  }

  const platform = process.platform
  if (platform !== 'linux') die(`автоустановка пока только для Linux, у тебя: ${platform}`)

  // 1) системный пакетный менеджер
  if (!flags.appimage && which('pacman')) {
    say(c.dim('  ставлю через pacman…'))
    if (runInteractive('sudo', ['pacman', '-S', '--needed', 'obsidian'])) {
      return ok('Obsidian установлен (pacman)')
    }
    warn('pacman не смог — пробую AppImage')
  }
  if (!flags.appimage && which('apt-get')) {
    say(c.dim('  ставлю .deb из релизов Obsidian…'))
    const deb = await downloadReleaseAsset(/_amd64\.deb$/)
    if (deb) {
      if (runInteractive('sudo', ['apt-get', 'install', '-y', deb])) {
        fs.rmSync(deb, { force: true })
        return ok('Obsidian установлен (.deb)')
      }
      fs.rmSync(deb, { force: true })
      warn('apt не смог — пробую AppImage')
    }
  }

  // 2) AppImage — универсально для любой дистрибуции
  say(c.dim('  качаю AppImage с GitHub Releases…'))
  const appImage = await downloadReleaseAsset(/\.AppImage$/)
  if (!appImage) die('не нашёл AppImage в релизах: https://github.com/obsidianmd/obsidian-releases/releases')
  ok(`скачан: ${appImage}`)
  say(c.dim('  запуск: ~/Applications/Obsidian.AppImage'))
}

async function downloadReleaseAsset (pattern) {
  let release
  try {
    const res = await fetch('https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest', {
      headers: { 'User-Agent': 'obsisync-cli', Accept: 'application/vnd.github+json' }
    })
    release = await res.json()
  } catch (e) {
    warn(`GitHub недоступен: ${e.message}`)
    return null
  }

  const asset = (release.assets || []).find(a => pattern.test(a.name))
  if (!asset) return null

  const dir = path.join(os.homedir(), 'Applications')
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, asset.name)

  const res = await fetch(asset.browser_download_url)
  if (!res.ok) return null
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf, { mode: 0o755 })
  return dest
}

/* ────────────────────────── help ────────────────────────── */

const HELP = `
${c.bold('obsisync')} — CLI для ObsiSync (сервер: ${loadConfig().server})

${c.bold('аккаунт')}
  status                              сервер + сессия + привязанная папка
  config [get|set <ключ> <значение>]  показать/сменить конфиг (server, vault)
  register <email> <username>         создать аккаунт
  login [email]                       войти (спросит пароль, при 2FA — код)
  logout                              выйти (локальный токен чистится всегда)
  me                                  аккаунт + профиль + активность
  password                            сменить пароль
  account delete [--yes]              удалить аккаунт навсегда

${c.bold('профиль (то же, что на сайте)')}
  profile set --bio "текст" --theme 0..3
  avatar <файл.png> | avatar --clear   загрузить/сбросить аватар (до 3 МБ)
  banner <файл.png> | banner --clear   загрузить/сбросить баннер (до 3 МБ)
  sessions                            список устройств
  revoke <id>                         отозвать сессию

${c.bold('двухфакторная защита')}
  2fa [status]                        включена ли
  2fa setup                           секрет + otpauth-ссылка для аутентификатора
  2fa enable <код>                    подтвердить и включить
  2fa disable <код>                   выключить

${c.bold('активность')}
  activity [--json]                   статистика правок: типы, файлы, месяцы

${c.bold('файлы vault')}
  files [префикс]                     список файлов
  cat <путь>                          вывести файл в терминал
  history <путь> [номер]              история версий файла (номер — её содержимое)
  push <файл|папка> [путь]            загрузить (без аргументов — привязанную папку)
  pull [путь] [локальный]             скачать (без аргументов — всё в привязанную папку)
  rm <путь> [--yes]                   удалить файл или папку
  sync <папка> [--dry-run] [--force]  двухсторонний синк (распознаёт конфликты)

${c.bold('obsidian')}
  obsidian status                     установлен ли Obsidian + привязанная папка
  obsidian vaults                     vault'ы из конфига Obsidian
  obsidian link <номер|папка>         привязать папку для push/pull/sync
  obsidian link --clear               отвязать
  obsidian open                       открыть привязанную папку в Obsidian
  obsidian install [--appimage]       установить (pacman / .deb / AppImage)

${c.dim('флаги: --json  --quiet  --yes  --force  --dry-run  --clear  --appimage  --server <url>')}
${c.dim('без интерактива: OBSISYNC_PASSWORD, OBSISYNC_NEW_PASSWORD, OBSISYNC_CODE')}
`

/* ────────────────────────── разбор аргументов ────────────────────────── */

const FLAGS_WITH_VALUE = new Set(['bio', 'theme', 'server', 'vault'])
// --dry-run → flags.dryRun
const camel = k => k.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())
const flags = {}
const args = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) { args.push(a); continue }
  const eq = a.indexOf('=')
  if (eq !== -1) { flags[camel(a.slice(2, eq))] = a.slice(eq + 1); continue }
  const key = a.slice(2)
  const next = argv[i + 1]
  if (FLAGS_WITH_VALUE.has(key) && next !== undefined && !next.startsWith('--')) {
    flags[camel(key)] = next
    i++
  } else {
    flags[camel(key)] = true
  }
}

const [cmd, sub, ...rest] = args
const pos = sub === undefined ? [] : [sub, ...rest] // позиционные аргументы команды
// разовый override адреса: obsisync --server http://… files
const SERVER_OVERRIDE = flags.server ? String(flags.server).replace(/\/+$/, '') : null

async function main () {
  switch (cmd) {
    case 'config': {
      const cfg = loadConfig()
      const keys = ['server', 'vault']
      if (sub === 'set' && rest[0] && rest[1] !== undefined) {
        const key = rest[0]
        if (!keys.includes(key)) die(`ключ должен быть одним из: ${keys.join(', ')}`)
        cfg[key] = key === 'server' ? String(rest[1]).replace(/\/+$/, '') : path.resolve(rest[1])
        saveConfig(cfg)
        ok(`${key}: ${cfg[key]}`)
      } else if (sub === 'set') {
        die(`использование: obsisync config set <${keys.join('|')}> <значение>`)
      } else if (sub && keys.includes(sub)) {
        say(String(cfg[sub] ?? '—'))
      } else {
        say(`server: ${cfg.server}`)
        say(`vault:  ${cfg.vault || c.dim('не привязан')}`)
        say(`user:   ${cfg.user ? '@' + cfg.user.username : c.dim('не авторизован')}`)
        say(`config: ${CONFIG_PATH}`)
      }
      break
    }
    case 'status': await cmdStatus(flags); break
    case 'register': await cmdRegister(pos); break
    case 'login': await cmdLogin(pos); break
    case 'logout': await cmdLogout(); break
    case 'me':
    case 'whoami': await cmdWhoami(flags); break
    case 'profile': await cmdProfile(pos, flags); break
    case 'avatar': await cmdAvatarOrBanner('avatar', pos, flags); break
    case 'banner': await cmdAvatarOrBanner('banner', pos, flags); break
    case 'sessions': await cmdSessions(); break
    case 'revoke': await cmdRevoke(pos); break
    case 'password': await cmdPassword(); break
    case 'activity': await cmdActivity(flags); break
    case '2fa':
    case 'totp': await cmdTwoFa(pos, flags); break
    case 'account':
      if (sub === 'delete') await cmdAccountDelete(pos, flags)
      else die('использование: obsisync account delete [--yes]')
      break
    case 'files':
    case 'ls': await cmdFiles(pos); break
    case 'cat': await cmdCat(pos); break
    case 'history': await cmdHistory(pos); break
    case 'push':
    case 'upload': await cmdPush(pos); break
    case 'pull':
    case 'download': await cmdPull(pos); break
    case 'rm':
    case 'delete': await cmdRm(pos); break
    case 'sync': await cmdSync(pos, flags); break
    case 'obsidian':
      if (sub === 'install') await cmdObsidianInstall(flags)
      else if (sub === 'vaults') await cmdObsidianVaults(flags)
      else if (sub === 'link') await cmdObsidianLink(rest, flags)
      else if (sub === 'open') await cmdObsidianOpen(rest)
      else await cmdObsidianStatus()
      break
    case 'help': say(HELP); break
    case undefined: say(HELP); break
    default:
      process.stderr.write(`неизвестная команда: ${cmd}\n`)
      process.stderr.write(HELP)
      process.exit(1)
  }
}

main().catch(e => die(e?.message || String(e)))
