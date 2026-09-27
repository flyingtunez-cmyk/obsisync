#!/usr/bin/env node
// Смоук-тесты API ObsiSync: версии файлов, чтение старых версий, дубли, WebSocket.
// Запуск (сервер должен быть поднят): node scripts/test-api.mjs
// Использует уникальный путь для каждого запуска — прогон идемпотентен.

import fs from 'node:fs'
import path from 'node:path'
import { WebSocket } from 'ws'

const BASE = process.env.API || 'http://127.0.0.1:3000'
const cfg = path.join(process.env.HOME, '.config/obsisync/config.json')
const token = JSON.parse(fs.readFileSync(cfg, 'utf8')).token
const H = { Authorization: `Bearer ${token}` }
const enc = p => p.split('/').map(encodeURIComponent).join('/')
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
const wait = ms => new Promise(r => setTimeout(r, ms))

// 1. список файлов и счётчик версий
const list = await j('/api/vault')
const f0 = list.body.files.find(f => f.path === 'ObsiSync/0. Главная.md')
check('список файлов с versions', list.status === 200 && f0 && f0.versions >= 1, `files=${list.body.files.length}, versions=${f0?.versions}`)

// 2. история существующего файла
const p = 'ObsiSync/0. Главная.md'
const hist = await j(`/api/vault/${enc(p)}?history=1`)
check('history у существующего файла', hist.status === 200 && hist.body.history.length === 1, JSON.stringify(hist.body.history[0]))

// 3. создание → правка → удаление дают три версии (уникальный путь: чисто при каждом запуске)
const testPath = `_тест-${Date.now()}.md`
await j(`/api/vault/${enc(testPath)}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: 'версия 1' })
await wait(1100) // время в SQLite хранится с точностью до секунды
await j(`/api/vault/${enc(testPath)}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: 'версия 2 — другая' })
await wait(1100)
const del = await j(`/api/vault/${enc(testPath)}`, { method: 'DELETE' })

const h2 = await j(`/api/vault/${enc(testPath)}?history=1`)
const ops = h2.body.history.map(r => r.op)
check('история: created → updated → deleted', del.status === 204 && JSON.stringify(ops) === JSON.stringify(['deleted', 'updated', 'created']), ops.join(','))

// 4. чтение старой версии
const firstRev = h2.body.history.at(-1)
const v1 = await fetch(`${BASE}/api/vault/${enc(testPath)}?version=${firstRev.id}`, { headers: H })
const v1text = await v1.text()
check('старая версия читается', v1.status === 200 && v1text === 'версия 1', `status=${v1.status} body=${JSON.stringify(v1text)}`)

// 5. дубли не плодятся: два одинаковых PUT подряд → одна версия
await j(`/api/vault/${enc(testPath)}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: 'одинаковый контент' })
const before = (await j(`/api/vault/${enc(testPath)}?history=1`)).body.history.length
const again = await j(`/api/vault/${enc(testPath)}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: 'одинаковый контент' })
const after = (await j(`/api/vault/${enc(testPath)}?history=1`)).body.history.length
check('повторная запись того же хеша не добавляет версию', again.body.changed === false && after === before, `changed=${again.body.changed}, версий ${before}→${after}`)

// 6. WebSocket: событие приходит при правке на сервере
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

// убираем за собой
await j(`/api/vault/${enc(testPath)}`, { method: 'DELETE' })
await j(`/api/vault/${enc('_ws-пуш.md')}`, { method: 'DELETE' })
console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nвсе проверки прошли')
process.exit(fails ? 1 : 0)
