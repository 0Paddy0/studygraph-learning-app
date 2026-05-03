#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APP_DIR="$ROOT_DIR/desktop/app"
export PATH="$HOME/.cargo/bin:$PATH"

cd "$APP_DIR"

echo "== StudyGraph desktop smoke =="
echo "Repo: $ROOT_DIR"

printf "\n== Toolchain ==\n"
node --version
npm --version
cargo --version
rustc --version

printf "\n== Linux Tauri system dependencies (pkg-config) ==\n"
if command -v pkg-config >/dev/null 2>&1; then
  missing=0
  for pkg in webkit2gtk-4.1 javascriptcoregtk-4.1 gtk+-3.0 libsoup-3.0; do
    if pkg-config --exists "$pkg"; then
      echo "ok: $pkg $(pkg-config --modversion "$pkg")"
    else
      echo "missing: $pkg"
      missing=1
    fi
  done
  if (( missing )); then
    cat <<'MSG'
Install the Tauri Linux WebKit stack before running the UI, for example on Ubuntu 24.04:
  sudo apt update
  sudo apt install -y libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
MSG
  fi
else
  echo "missing: pkg-config (install pkg-config plus the Tauri WebKit/GTK dev packages)"
fi

printf "\n== Frontend unit tests ==\n"
npm test

printf "\n== Frontend production build ==\n"
npm run build

printf "\n== Rust core tests ==\n"
(cd "$ROOT_DIR" && cargo test -p studygraph_core)

if [[ "${RUN_TAURI_DEV:-0}" == "1" ]]; then
  printf "\n== Launching Tauri dev UI ==\n"
  echo "Close the Tauri window or press Ctrl+C here when the UI smoke check is done."
  npm run tauri:dev
else
  cat <<'MSG'

Skipping interactive Tauri launch. To include it:
  RUN_TAURI_DEV=1 npm run smoke:tauri
Manual UI checks: app opens, sidebar renders, dashboard counts load, notes/todo/graph tabs switch without console or Rust errors.
MSG
fi
