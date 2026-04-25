#!/usr/bin/env bash
set -euo pipefail

CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
SETTINGS="$CLAUDE_HOME/settings.json"
TIMESTAMP="$(date +%s)"
BACKUP="${SETTINGS}.bak.${TIMESTAMP}"

echo "==> Uninstalling Claude Code Statusline"
echo "==> Target: $CLAUDE_HOME"

# ── Remove installed .mjs files ───────────────────────────────────────────────
for f in "statusline.mjs" "hooks/agent-start.mjs" "hooks/agent-end.mjs"; do
  target="$CLAUDE_HOME/$f"
  if [[ -f "$target" ]]; then
    rm "$target"
    echo "    removed $target"
  fi
done

# ── Backup and edit settings.json ────────────────────────────────────────────
if [[ ! -f "$SETTINGS" ]]; then
  echo "==> No settings.json found — nothing more to do."
  exit 0
fi

cp "$SETTINGS" "$BACKUP"
echo "==> Backed up settings.json → $BACKUP"

env -u NODE_OPTIONS node - "$SETTINGS" <<'NODE_SCRIPT'
const fs = require('fs');

const settingsPath = process.argv[2];

let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
} catch {
  console.error('Could not parse settings.json — aborting merge step.');
  process.exit(1);
}

// Remove statusLine key
delete settings.statusLine;

// Remove our hooks from PreToolUse
if (Array.isArray(settings.hooks?.PreToolUse)) {
  settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(entry => {
    const hasOurs = (entry.hooks ?? []).some(
      h => typeof h.command === 'string' && h.command.includes('agent-start.mjs')
    );
    return !hasOurs;
  });
  if (settings.hooks.PreToolUse.length === 0) delete settings.hooks.PreToolUse;
}

// Remove our hooks from PostToolUse
if (Array.isArray(settings.hooks?.PostToolUse)) {
  settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(entry => {
    const hasOurs = (entry.hooks ?? []).some(
      h => typeof h.command === 'string' && h.command.includes('agent-end.mjs')
    );
    return !hasOurs;
  });
  if (settings.hooks.PostToolUse.length === 0) delete settings.hooks.PostToolUse;
}

// Clean up empty hooks object
if (settings.hooks && Object.keys(settings.hooks).length === 0) {
  delete settings.hooks;
}

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
NODE_SCRIPT

echo ""
echo "==> Uninstall complete!"
echo ""
echo "    settings.json has been updated (statusLine key and Agent hooks removed)."
echo ""
echo "    If you need to restore settings manually, backups are at:"
echo "      $CLAUDE_HOME/settings.json.bak.*"
echo ""
echo "    Restart Claude Code to apply changes."
