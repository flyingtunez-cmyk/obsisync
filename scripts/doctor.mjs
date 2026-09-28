#!/usr/bin/env node
// Диагностика окружения: `npm run doctor`
//
// Ничего не меняет и не устанавливает — только читает состояние и печатает отчёт.
// Нужен, когда установка падает: покажи вывод этого отчёта, и причина станет ясна.

import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIN = [22, 12, 0]

const c = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`
}
const out = []
const line = s => { out.push(s); console.log(s) }
const problems = []
const warnings = []

const ok = s => line(`${c.green('  ✓')} ${s}`)
const bad = s => { line(`${c.red('  ✗')} ${s}`); problems.push(s) }
const warn = s => { line(`${c.yellow('  ⚠')} ${s}`); warnings.push(s) }

const npmVer = (() => {
  try { return execFileSync('npm', ['-v'], { encoding: 'utf8' }).trim() } catch { return 'не найден' }
})()

line(c.bold('ObsiSync — диагностика'))
line('')

/* ── система ── */
line(c.bold('Система'))
line(`  ОС            ${os.type()} ${os.release()} (${os.arch()})`)
line(`  Node          ${process.versions.node}`)
line(`  npm           ${npmVer}`)
line(`  каталог       ${process.cwd()}`)
line('')

/* ── Node ── */
line(c.bold('Версия Node'))
const v = process.versions.node.split('.').map(Number)
const nodeOk = v[0] > MIN[0] || (v[0] === MIN[0] && (v[1] > MIN[1] || (v[1] === MIN[1] && v[2] >= MIN[2])))
nodeOk ? ok(`Node ${process.versions.node} — подходит (нужно ${MIN.join('.')}+)`)
       : bad(`Node ${process.versions.node} — нужно ${MIN.join('.')} или новее. Сервер не запустится: нужен node:sqlite (с 22.5), vite@8 и electron требуют ${MIN.join('.')}`)
try {
  const s = execFileSync('node', ['-e', "import('node:sqlite').then(()=>console.log('ok'),e=>console.log(e.message))"], { encoding: 'utf8' }).trim()
  s === 'ok' ? ok('встроенный node:sqlite доступен') : bad(`node:sqlite недоступен — ${s}`)
} catch (e) { bad(`node:sqlite недоступен — ${e.message}`) }
line('')

/* ── где мы ── */
line(c.bold('Расположение проекта'))
line(`  корень        ${ROOT}`)
if (fs.existsSync(path.join(ROOT, 'package.json'))) ok('package.json в корне есть')
else { bad('в корне нет package.json — это не корень ObsiSync'); problems.push('корень неверный') }
if (ROOT.startsWith(os.homedir())) line(c.dim('  проект лежит в домашней папке — ок'))
line('')

/* ── части ── */
line(c.bold('Части проекта'))
for (const [name, dir] of [['сайт', ROOT], ['сервер', path.join(ROOT, 'server')], ['десктоп', path.join(ROOT, 'app')]]) {
  const pj = path.join(dir, 'package.json')
  if (!fs.existsSync(pj)) { warn(`${name}: папки нет или нет package.json (${path.relative(ROOT, dir) || '.'})`); continue }
  const nm = fs.existsSync(path.join(dir, 'node_modules'))
  const rel = path.relative(ROOT, dir) || '.'
  nm ? ok(`${name}: package.json есть, node_modules установлены (${rel})`)
    : warn(`${name}: package.json есть, но node_modules отсутствует — нужен npm run setup (${rel})`)
}
line('')

/* ── файлы, нужные проекту ── */
line(c.bold('Обязательные файлы'))
for (const rel of ['cli/obsisync.js', 'vite.config.js', 'server/src/index.js', 'server/src/db.js', 'scripts/test-api.mjs', 'scripts/setup.mjs']) {
  fs.existsSync(path.join(ROOT, rel)) ? ok(rel) : bad(`нет файла: ${rel}`)
}
line('')

/* ── версия репозитория ── */
line(c.bold('Версия проекта'))
const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim() } catch { return null } }
if (!fs.existsSync(path.join(ROOT, '.git'))) {
  warn('это не git-клон (нет .git) — нельзя проверить обновления и не сработает git pull')
} else {
  const head = git('rev-parse', '--short', 'HEAD')
  const subject = git('log', '-1', '--pretty=%s')
  line(`  коммит        ${head} ${subject ? c.dim(subject) : ''}`)
  git('fetch', '--quiet', 'origin') // тихо, чтобы не лезть в сеть при первом запуске без спроса
  const behind = git('rev-list', '--count', 'HEAD..origin/main')
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  if (behind === null) warn('не удалось сравнить с origin — проверь интернет или права')
  else if (behind === '0') ok('код свежий, всё с origin')
  else {
    warn(`код устарел: ${behind} коммит(ов) позади origin/main`)
    warn(`  ${c.dim('обновить:')} git pull`)
  }
  if (branch && branch !== 'main') warn(`ты на ветке ${branch}, а не main`)
}

/* ── порты и сервер ── */
line(c.bold('Порты и запущенный сервер'))
for (const port of [3000, 5173]) {
  const open = await new Promise(res => {
    const s = net.connect(port, '127.0.0.1')
    s.on('connect', () => { s.destroy(); res(true) })
    s.on('error', () => res(false))
    setTimeout(() => { s.destroy(); res(false) }, 1500)
  })
  open ? ok(`порт ${port} отвечает`) : line(c.dim(`  · порт ${port} свободен (сервер не запущен — так и должно быть до npm run api)`))
}
try {
  const r = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(2500) })
  const t = await r.text()
  r.ok ? ok(`API отвечает: ${t}`) : warn(`API ответил ${r.status}: ${t}`)
} catch { line(c.dim('  · API не отвечает — запусти npm run api')) }
line('')

/* ── вердикт ── */
line(c.bold('Итог'))
if (problems.length) {
  line(c.red(`  Ошибок: ${problems.length}`))
  for (const p of problems) line(`    ✗ ${p}`)
  line('')
  line('  Пока это не исправлено, проект работать не будет.')
  if (problems.some(p => p.includes('Node '))) line('  Node обновляется пакетным менеджером системы, потом снова npm run doctor.')
} else if (warnings.length) {
  line(c.yellow(`  Критичных ошибок нет, но есть замечания (${warnings.length}):`))
  for (const p of warnings) line(`    ⚠ ${p}`)
  line('')
  if (warnings.some(p => p.includes('node_modules'))) {
    line('  Установка не завершена. Выполни:')
    line(c.bold('    npm run setup'))
  } else {
    line('  Замечания не критичны — можно продолжать.')
  }
} else {
  line(c.green('  Проблем не найдено.'))
  line('  Дальше: npm run setup, потом npm run api и npm run dev.')
}
line('')
line(c.dim('  Этот отчёт ничего не меняет. Скопируй его целиком, если что-то не работает.'))
