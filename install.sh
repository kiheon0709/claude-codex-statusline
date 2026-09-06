#!/usr/bin/env bash
set -euo pipefail

RAW_BASE="https://raw.githubusercontent.com/kiheon0709/claude-codex-statusline/main"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"

# ── Mode detection ────────────────────────────────────────────────────────────
# When piped from curl, $0 is 'bash' so SCRIPT_DIR won't contain statusline.mjs.
# When run from a cloned repo, detect by checking the sibling file.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" || SCRIPT_DIR=""

if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/statusline.mjs" ]]; then
  MODE="local"
else
  MODE="curl"
fi

echo "==> Installing Claude Code Statusline (mode: $MODE)"
echo "==> Target: $CLAUDE_HOME"

# ── Create directories ────────────────────────────────────────────────────────
mkdir -p "$CLAUDE_HOME/hooks"

# ── Helper: get or download a file ───────────────────────────────────────────
install_file() {
  local rel_path="$1"       # e.g. statusline.mjs or hooks/agent-start.mjs
  local dest="$CLAUDE_HOME/$rel_path"

  if [[ "$MODE" == "local" ]]; then
    echo "    copying $rel_path"
    cp "$SCRIPT_DIR/$rel_path" "$dest"
  else
    echo "    downloading $rel_path"
    curl -fsSL "$RAW_BASE/$rel_path" -o "$dest"
  fi
  chmod +x "$dest"
}

# ── Install .mjs files ────────────────────────────────────────────────────────
install_file "statusline.mjs"
install_file "hooks/agent-start.mjs"
install_file "hooks/agent-end.mjs"

# ── Backup and merge settings.json ───────────────────────────────────────────
SETTINGS="$CLAUDE_HOME/settings.json"
TIMESTAMP="$(date +%s)"
BACKUP="${SETTINGS}.bak.${TIMESTAMP}"

if [[ -f "$SETTINGS" ]]; then
  cp "$SETTINGS" "$BACKUP"
  echo "==> Backed up settings.json → $BACKUP"
else
  echo "{}" > "$SETTINGS"
  BACKUP=""
fi

# Merge using node (guaranteed available — Claude Code requires it).
# Unset NODE_OPTIONS so wrappers like cmux don't inject preload modules
# whose temp paths aren't valid in the spawned subprocess.
env -u NODE_OPTIONS node - "$SETTINGS" "$CLAUDE_HOME" <<'NODE_SCRIPT'
const fs = require('fs');
const path = require('path');

const settingsPath = process.argv[2];
const claudeHome   = process.argv[3];

let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
} catch {
  settings = {};
}

// -- statusLine --
settings.statusLine = {
  type: 'command',
  command: `env -u NODE_OPTIONS node ${claudeHome}/statusline.mjs`,
};

// -- PreToolUse: agent-start.mjs --
if (!settings.hooks) settings.hooks = {};
if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];

// Remove stale entries referencing agent-start.mjs (idempotent re-install)
settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(entry => {
  const cmd = (entry.hooks ?? []).find(h => typeof h.command === 'string' && h.command.includes('agent-start.mjs'));
  return !cmd;
});

settings.hooks.PreToolUse.push({
  matcher: 'Agent',
  hooks: [{ type: 'command', command: `env -u NODE_OPTIONS node ${claudeHome}/hooks/agent-start.mjs` }],
});

// -- PostToolUse: agent-end.mjs --
if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];

// Remove stale entries referencing agent-end.mjs (idempotent re-install)
settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(entry => {
  const cmd = (entry.hooks ?? []).find(h => typeof h.command === 'string' && h.command.includes('agent-end.mjs'));
  return !cmd;
});

settings.hooks.PostToolUse.push({
  matcher: 'Agent',
  hooks: [{ type: 'command', command: `env -u NODE_OPTIONS node ${claudeHome}/hooks/agent-end.mjs` }],
});

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
NODE_SCRIPT

echo ""
echo "==> Installation complete!"
echo ""
echo "    Files installed:"
echo "      $CLAUDE_HOME/statusline.mjs"
echo "      $CLAUDE_HOME/hooks/agent-start.mjs"
echo "      $CLAUDE_HOME/hooks/agent-end.mjs"
echo ""
echo "    Toggle segments:  node $CLAUDE_HOME/statusline.mjs list | on <feature> | off <feature>"
echo ""
if [[ -n "${BACKUP:-}" ]]; then
  echo "    settings.json backed up to:"
  echo "      $BACKUP"
fi
echo ""
echo "    Restart Claude Code to activate the statusline."
