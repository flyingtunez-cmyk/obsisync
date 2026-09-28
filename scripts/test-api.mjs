#!/usr/bin/env node
// Смоук-тесты API ObsiSync: версии файлов, чтение старых версий, дубли, WebSocket.
// Запуск: сервер должен быть поднят, затем `node scripts/test-api.mjs`
//
// Тест самодостаточен: регистрирует временный аккаунт, создаёт свои файлы
// и удаляет аккаунт за собой. Никаких личных данных и чужих vault'ов не нужно.

import { WebSocket } from 'ws'

const BASE = process.env.API || 'http://127.0.0.1:3000'
const stamp = Date.now()
const USER = `tester_${String(stamp).slice(-8)}`
const EMAIL = `${USER}@obsisync.test`
const PASSWORD = 'TestPass123'

const enc = p => p.split('/').map(encodeURIComponent).join('/')
const wait = ms => new Promise(r => setTimeout(r, ms))

let H = {}
const j = async (p, opt = {}) => {
  const r = await fetch(BASE + p, { ...opt, headers: { ...H, ...(opt.headers || {}) } })
  const t = await r.text()
  try { return { status: r.status, body: JSON.parse(t) } } catch { return { status: r.status, body: t } }
}

let fails = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  ok ' : '  FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!cond) fails++
}

// ── подготовка: временный аккаунт ──
const reg = await j('/api/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, email: EMAIL, password: PASSWORD })
})
if (reg.status !== 201 || !reg.body?.token) {
  console.log(`  FAIL подготовить тестовый аккаунт — HTTP ${reg.status}: ${reg.body?.error || reg.body}`)
  console.log(`\nПРОВАЛЕНО: 1 (сервер на ${BASE} отвечает?)`)
  process.exit(1)
}
H = { Authorization: `Bearer ${reg.body.token}` }
console.log(`  временный аккаунт: @${reg.body.user.username}\n`)

// убираем за собой, даже если тест упал
const cleanup = async () => {
  await j('/api/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD })
  })
}

// 1. список файлов и счётчик версий
const FIXTURE = 'тест/файл.md'
await j(`/api/vault/${enc(FIXTURE)}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: 'версия 1'
})
const list = await j('/api/vault')
const f0 = list.body?.files?.find(f => f.path === FIXTURE)
check('список файлов с versions', list.status === 200 && !!f0 && f0.versions >= 1,
  `files=${list.body?.files?.length}, versions=${f0?.versions}`)

// 2. история существующего файла
const hist = await j(`/api/vault/${enc(FIXTURE)}?history=1`)
check('history у существующего файла', hist.status === 200 && hist.body?.history?.length === 1,
  JSON.stringify(hist.body?.history?.[0]))

// 3. создание → правка → удаление дают три версии (уникальный путь: чисто при каждом запуске)
const testPath = `_тест-${stamp}.md`
await j(`/api/vault/${enc(testPath)}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: 'версия 1' })
await wait(1100) // время в SQLite хранится с точностью до секунды
await j(`/api/vault/${enc(testPath)}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: 'версия 2 — другая' })
await wait(1100)
const del = await j(`/api/vault/${enc(testPath)}`, { method: 'DELETE' })

const h2 = await j(`/api/vault/${enc(testPath)}?history=1`)
const ops = (h2.body?.history || []).map(r => r.op)
check('история: created → updated → deleted', del.status === 204 && JSON.stringify(ops) === JSON.stringify(['deleted', 'updated', 'created']), ops.join(','))

// 4. чтение старой версии
const firstRev = h2.body?.history?.at(-1)
const v1 = await fetch(`${BASE}/api/vault/${enc(testPath)}?version=${firstRev?.id}`, { headers: H })
const v1text = await v1.text()
check('старая версия читается', v1.status === 200 && v1text === 'версия 1', `status=${v1.status} body=${JSON.stringify(v1text)}`)

// 5. дубли не плодятся: два одинаковых PUT подряд → одна версия
await j(`/api/vault/${enc(testPath)}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: 'одинаковый контент' })
const before = (await j(`/api/vault/${enc(testPath)}?history=1`)).body?.history?.length ?? -1
const again = await j(`/api/vault/${enc(testPath)}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: 'одинаковый контент' })
const after = (await j(`/api/vault/${enc(testPath)}?history=1`)).body?.history?.length ?? -1
check('повторная запись того же хеша не добавляет версию', again.body?.changed === false && after === before, `changed=${again.body?.changed}, версий ${before}→${after}`)

// 6. WebSocket: событие приходит при правке на сервере
const token = reg.body.token
const wsUrl = `${BASE.replace(/^http/, 'ws')}/api/ws?token=${encodeURIComponent(token)}`
const event = await new Promise(resolve => {
  const ws = new WebSocket(wsUrl)
  const to = setTimeout(() => { ws.close(); resolve(null) }, 5000)
  ws.on('open', async () => {
    await wait(150)
    await j(`/api/vault/${enc('_ws-пуш.md')}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: 'пуш!' })
  })
  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString())
    if (msg.type === 'change') { clearTimeout(to); ws.close(); resolve(msg) }
  })
  ws.on('error', () => { clearTimeout(to); resolve(null) })
})
check('WS получил change-событие', !!event && event.path === '_ws-пуш.md' && event.op === 'created', JSON.stringify(event))

// 7. без токена не пускают
const noAuth = await new Promise(resolve => {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/ws`)
  const to = setTimeout(() => { ws.close(); resolve('timeout') }, 3000)
  ws.on('unexpected-response', (_r, res) => { clearTimeout(to); resolve(res.statusCode) })
  ws.on('open', () => { clearTimeout(to); ws.close(); resolve('open') })
  ws.on('error', () => { clearTimeout(to); resolve('error') })
})
check('WS без токена — 401', noAuth === 401, String(noAuth))

// убираем за собой: аккаунт целиком вместе со своими файлами
await cleanup()
console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nвсе проверки прошли')
process.exit(fails ? 1 : 0)
