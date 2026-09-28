#!/usr/bin/env node
// Установка всех частей ObsiSync одной командой: `npm run setup`
//
// Зачем отдельный скрипт, а не три строки в README:
//   * не зависит от текущего каталога — корень находится по расположению файла
//   * не зависит от оболочки: работает в bash, zsh, fish, PowerShell, cmd
//   * заранее проверяет версию Node и объясняет проблему человеческим языком
//   * ставит только то, что реально нужно (app — по запросу --with-app)

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIN_NODE = [22, 12, 0]
const withApp = process.argv.includes('--with-app') || process.argv.includes('-a')

const c = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`
}
const say = s => console.log(s)

/* ── 1. корень проекта ── */
if (!fs.existsSync(path.join(ROOT, 'package.json'))) {
  say(`${c.red('✗ не найден package.json')}`)
  say(`  искал здесь: ${ROOT}`)
  say(`  ${c.dim('похоже, это не корень ObsiSync')}`)
  process.exit(1)
}

/* ── 2. версия Node ── */
const cur = process.versions.node.split('.').map(Number)
const tooOld = cur[0] < MIN_NODE[0] ||
  (cur[0] === MIN_NODE[0] && cur[1] < MIN_NODE[1]) ||
  (cur[0] === MIN_NODE[0] && cur[1] === MIN_NODE[1] && cur[2] < MIN_NODE[2])

if (tooOld) {
  say(`${c.red('✗ Node.js ' + MIN_NODE.join('.') + ' и новее, а стоит ' + process.versions.node)}`)
  say('')
  say('  Почему так строго:')
  say(`    · сервер импортирует встроенный node:sqlite ${c.dim('(нужен с 22.5)')}`)
  say(`    · vite@8 и electron требуют ${MIN_NODE.join('.')}`)
  say('')
  say(`  ${c.yellow('npm install пройдёт и на старой версии, но сервер упадёт при старке.')}`)
  say(`  Поставь Node: https://nodejs.org  ${c.dim('(или пакетный менеджер твоей системы)')}`)
  process.exit(1)
}
say(`${c.green('✓')} Node ${process.versions.node} ${c.dim('(нужно ' + MIN_NODE.join('.') + '+)')}`)

/* ── 3. установка зависимостей ── */
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const parts = [
  { name: 'сайт и тесты', dir: ROOT },
  { name: 'сервер', dir: path.join(ROOT, 'server') },
  ...(withApp ? [{ name: 'десктоп-приложение', dir: path.join(ROOT, 'app') }] : [])
]

let broken = 0
for (const p of parts) {
  if (!fs.existsSync(path.join(p.dir, 'package.json'))) {
    say(`${c.yellow('⚠ пропускаю ' + p.name + ' — нет ' + path.relative(ROOT, p.dir) + '/package.json')}`)
    continue
  }
  say(`${c.dim('$')} npm install ${c.dim('— ' + p.name)}`)
  const r = spawnSync(npm, ['install'], {
    cwd: p.dir,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
  if (r.status !== 0) {
    say(`${c.red('  ✗ не установилось: ' + p.name)}`)
    broken++
  } else {
    say(`${c.green('  ✓ готово: ' + p.name)}`)
  }
}

if (broken) {
  say('')
  say(c.red(`✗ не собралось частей: ${broken}`))
  say('  Покажи преподавателю текст ошибки выше — по нему видно, чего не хватает.')
  process.exit(1)
}

if (!withApp) {
  say('')
  say(c.dim('  десктоп-приложение пропущено. Добавить: npm run setup -- --with-app'))
}

say('')
say(c.green('✓ всё установлено'))
say('')
say('Дальше — два терминала:')
say(`  ${c.bold('1)')} npm run api   ${c.dim('→ API на http://127.0.0.1:3000')}`)
say(`  ${c.bold('2)')} npm run dev   ${c.dim('→ сайт на http://localhost:5173')}`)
say('')
say('Проверка:')
say(`  · curl http://127.0.0.1:3000/health ${c.dim('→ {"status":"ok",...}')}`)
say(`  · node scripts/test-api.mjs ${c.dim('→ 7 проверок API')}`)
