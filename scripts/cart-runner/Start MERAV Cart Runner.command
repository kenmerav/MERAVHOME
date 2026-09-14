#!/bin/zsh
set -eu

cd "$(dirname "$0")/../.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print 'Node.js is needed to start MERAV Cart Runner. Please finish the computer setup first.'
  read -r '?Press Return to close.'
  exit 1
fi
if [[ -z "${MERAV_CODEX_BIN:-}" && -x /Applications/ChatGPT.app/Contents/Resources/codex ]]; then
  export MERAV_CODEX_BIN=/Applications/ChatGPT.app/Contents/Resources/codex
fi
print 'MERAV Cart Runner — keep this window open, then use Build Carts in Studio.'
exec node scripts/cart-runner/server.mjs
