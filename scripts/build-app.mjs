#!/usr/bin/env node
// Сборка десктоп-приложения + выкладка на сайт: `npm run dist:app`
//
// Заменяет связку `cd app && npm run dist && cd .. && npm run downloads`:
//   * не зависит от оболочки (никаких cd/&&)
//   * работает из любого каталога — корень берётся по расположению файла
//   * можно выбрать платформу: --linux | --win | --all  (по умолчанию Linux)
//
// Готовые файлы (~300 МБ) намеренно НЕ лежат в git: их собирают на месте.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = path.join(ROOT, 'app')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const c = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`
}
const say = s => console.log(s)

/* ── какая платформа ── */
const args = process.argv.slice(2)
const wantAll = args.includes('--all')
const wantWin = wantAll || args.includes('--win')
const target = wantAll ? 'dist' : wantWin ? 'dist:win' : 'dist:linux'

/* ── проверка wine для Windows-сборки (NSIS зовёт signtool.exe) ── */
if (wantWin && process.platform !== 'win32') {
  const hasWine = spawnSync('wine', ['--version'], { stdio: 'ignore' }).status === 0
  if (!hasWine) {
    say(c.yellow('⚠ для Windows-сборки нужен wine — NSIS вызывает signtool.exe через него'))
    say(`  ${c.dim('поставь:')} sudo pacman -S --needed wine`)
    say('')
    say(`  ${c.dim('пока можно собрать переносимую версию без wine:')}`)
    say(`    ${c.dim('cd app && npx electron-builder --win portable --publish never')}`)
    say('')
  }
}

/* ── проверки до долгой сборки ── */
if (!fs.existsSync(path.join(APP, 'package.json'))) {
  say(c.red('✗ нет app/package.json — это не корень ObsiSync'))
  process.exit(1)
}
if (!fs.existsSync(path.join(APP, 'node_modules'))) {
  say(`${c.yellow('⚠ зависимости десктопа не установлены — ставлю')}`)
  const r = spawnSync(npm, ['install'], { cwd: APP, stdio: 'inherit' })
  if (r.status !== 0) {
    say(c.red('✗ не установилось. Попробуй: npm run setup -- --with-app'))
    process.exit(1)
  }
}

say(`${c.bold('Собираю десктоп-приложение')} ${c.dim('(npm run ' + target + ', это несколько минут)')}`)
say('')

const build = spawnSync(npm, ['run', target], { cwd: APP, stdio: 'inherit' })
if (build.status !== 0) {
  say('')
  say(c.red('✗ сборка не удалась'))
  say('  Типичные причины на Linux: не хватает зависимостей electron-builder.')
  say('  На Arch: sudo pacman -S --needed base-devel libarchive')
  process.exit(1)
}

/* ── выкладка на сайт ── */
say('')
say(c.bold('Выкладываю на сайт'))
const dl = spawnSync(npm, ['run', 'downloads'], { cwd: ROOT, stdio: 'inherit' })
if (dl.status !== 0) process.exit(1)

/* ── итог ── */
const outDir = path.join(ROOT, 'public', 'downloads')
const built = fs.existsSync(outDir)
  ? fs.readdirSync(outDir).filter(n => /\.(exe|deb|AppImage)$/.test(n))
  : []

say('')
if (built.length) {
  say(c.green(`✓ готово: ${built.length} файл(ов) в public/downloads`))
  for (const n of built) {
    const mb = (fs.statSync(path.join(outDir, n)).size / 1024 / 1024).toFixed(1)
    say(`  · ${n} ${c.dim('(' + mb + ' МБ)')}`)
  }
  say('')
  say(`  Страница «Скачать» теперь отдаёт их: ${c.dim('обнови http://localhost:5173')}`)
  if (!built.some(n => n.endsWith('.exe'))) {
    say(`  ${c.yellow('.exe не собран — для Windows нужен:')} npm run dist:app -- --win`)
  }
} else {
  say(c.yellow('⚠ сборка прошла, но файлов в public/downloads не появилось'))
  say('  проверь: ls ' + outDir)
}
