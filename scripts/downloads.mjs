import fs from 'node:fs'
import path from 'node:path'

const root = path.dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, '')
const dist = path.join(root, 'app', 'dist')
const out = path.join(root, 'public', 'downloads')

if (!fs.existsSync(dist)) {
  console.error('нет app/dist — сначала собери приложение: cd app && npm run dist')
  process.exit(1)
}

fs.mkdirSync(out, { recursive: true })

const KINDS = [
  [/\.exe$/, 'win'],
  [/\.deb$/, 'deb'],
  [/\.AppImage$/, 'appimage']
]

const files = []
for (const name of fs.readdirSync(dist).sort()) {
  const kind = KINDS.find(([re]) => re.test(name))?.[1]
  if (!kind) continue
  fs.copyFileSync(path.join(dist, name), path.join(out, name))
  files.push({ name, kind, size: fs.statSync(path.join(out, name)).size })
}

const version = JSON.parse(fs.readFileSync(path.join(root, 'app', 'package.json'), 'utf8')).version
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ version, files }, null, 2) + '\n')

console.log(`скачиваемое в public/downloads (версия ${version}):`)
for (const f of files) console.log(`  ${f.kind.padEnd(9)} ${f.name} ${(f.size / 1024 / 1024).toFixed(1)} МБ`)
if (!files.length) console.log('  (ничего — сначала собери дистрибутивы)')
