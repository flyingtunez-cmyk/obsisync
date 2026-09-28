#!/usr/bin/env bash
# Восстановление ObsiSync: найти папку, обновить код, поставить зависимости.
#
# Запуск (работает в любой оболочке — bash, zsh, fish):
#
#   curl -sL https://raw.githubusercontent.com/flyingtunez-cmyk/obsisync/main/scripts/fix-update.sh | bash
#
# Либо, если ты уже в папке проекта:
#
#   bash scripts/fix-update.sh
#
# Скрипт на bash, поэтому запускай именно через `bash`, а не `./fix-update.sh`:
# в fish нет синтаксиса <(...) и ./скрипт не сработает.
set -u

say() { printf '%s\n' "$*"; }
hr()  { say "────────────────────────────────────────"; }

hr; say "1. Ищу папку проекта"; hr

DIR=""
if [ -f package.json ] && grep -q '"obsisync"' package.json 2>/dev/null; then
  DIR="$(pwd)"
fi
if [ -z "$DIR" ]; then
  for cand in ~/Projects/obsisync ~/obsisync ~/projects/obsisync ./obsisync ./obsisync-main; do
    if [ -f "$cand/package.json" ]; then DIR="$cand"; break; fi
  done
fi
if [ -z "$DIR" ]; then
  # глубокий поиск, если лежит нестандартно
  DIR="$(find ~ -maxdepth 4 -type f -name package.json -path '*obsisync*' 2>/dev/null | head -1 | xargs -r dirname)"
fi
if [ -z "$DIR" ]; then
  say "✗ папку с ObsiSync не нашёл."
  say "  Скачай заново: https://github.com/flyingtunez-cmyk/obsisync"
  exit 1
fi

cd "$DIR" || exit 1
say "✓ нашёл: $(pwd)"
say "  команд доступно: $(node -p "Object.keys(require('./package.json').scripts).join(', ')" 2>/dev/null || echo 'не читается')"
[ -f scripts/doctor.mjs ] && say "  doctor: есть" || say "  doctor: НЕТ (код устарел)"

hr; say "2. Обновляю код"; hr

if [ ! -d .git ]; then
  say "⚠ это не git-клон (нет папки .git) — обновить нельзя."
  say "  Если качал ZIP: удали папку и склонируй заново:"
  say ""
  say "    rm -rf \"$DIR\""
  say "    git clone https://github.com/flyingtunez-cmyk/obsisync.git"
  say "    cd obsisync && npm run setup"
  exit 1
fi

DIRTY=0
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  DIRTY=1
  say ""
  say "⚠ в папке есть твои правки — спрячу их, обновлю код и верну обратно."
  git stash push -u -m "obsisync-fix-autostash" > /tmp/obsisync_stash.log 2>&1 \
    && say "  правки убраны в stash" || say "  ⚠ не смог убрать правки, продолжаю без этого"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
if [ "$BRANCH" = "HEAD" ]; then
  say "  ⚠ ты в отсоединённом состоянии (detached HEAD) — обычный git pull здесь не работает"
  say "  возвращаюсь на ветку main"
  if ! git checkout main > /tmp/obsisync_checkout.log 2>&1; then
    say "  не смог перейти на main:"
    sed 's/^/      /' /tmp/obsisync_checkout.log | head -5
    exit 1
  fi
  BRANCH="main"
fi
say "  ветка:    $BRANCH"
say "  коммит:   $(git rev-parse --short HEAD 2>/dev/null)"

if git pull --rebase --autostash > /tmp/obsisync_pull.log 2>&1; then
  say "✓ обновил"
else
  say "✗ git pull не сработал. Причина:"
  sed 's/^/    /' /tmp/obsisync_pull.log | head -12
  say ""
  say "  Если написано dubious ownership — выполни:"
  say "    sudo chown -R \"\$(id -u):\$(id -g)\" \"$DIR\" .git"
  say "  Если написано про конфликт — выполни:"
  say "    git pull --rebase --autostash"
  exit 1
fi

say "  теперь:    $(git rev-parse --short HEAD)  ($(git rev-parse --abbrev-ref HEAD))"

if [ "$DIRTY" = "1" ]; then
  if git stash pop > /tmp/obsisync_pop.log 2>&1; then
    say "✓ твои правки вернулись на место"
  else
    say "⚠ твои правки не применились автоматически, они лежат в stash:"
    sed 's/^/    /' /tmp/obsisync_pop.log | head -6
  fi
fi

hr; say "3. Ставлю зависимости"; hr
npm run setup || { say "✗ установка не удалась — покажи вывод"; exit 1; }

hr; say "4. Проверяю"; hr
npm run doctor

hr
say "Готово. Дальше: npm run api   и   npm run dev"
hr
