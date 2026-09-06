import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

// ── Feature toggles ──────────────────────────────────────────────────────────
// Config lives in ~/.claude/statusline.json as { "disabled": ["cache", ...] }.
// Manage it with:  node ~/.claude/statusline.mjs list | on <feature> | off <feature>
const FEATURES = {
  branch:  'git branch next to the directory',
  effort:  'effort level next to the model (high/max/...)',
  badges:  '[thinking on/off] and [fast] badges',
  session: 'session elapsed time and estimated cost',
  limits:  'Claude 5H / Week rate-limit bars',
  context: 'Context window usage bar',
  cache:   'prompt cache time-to-live and hit ratio',
  codex:   'Codex CLI usage bars',
  agents:  'running subagent tracker',
};
const CONFIG_PATH = path.join(os.homedir(), '.claude', 'statusline.json');

function loadDisabled() {
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return new Set(Array.isArray(cfg.disabled) ? cfg.disabled : []);
  } catch {
    return new Set();
  }
}

const DISABLED = loadDisabled();
const on = name => !DISABLED.has(name);

function runCli(args) {
  const [cmd, ...names] = args;
  const names_ok = names.every(n => n in FEATURES);
  if ((cmd === 'on' || cmd === 'off') && names.length > 0 && names_ok) {
    for (const n of names) cmd === 'off' ? DISABLED.add(n) : DISABLED.delete(n);
    writeFileSync(CONFIG_PATH, JSON.stringify({ disabled: [...DISABLED] }, null, 2) + '\n');
    console.log(`${cmd === 'off' ? 'disabled' : 'enabled'}: ${names.join(', ')}  (${CONFIG_PATH})`);
    return 0;
  }
  if (cmd !== 'list') {
    console.log('usage: node statusline.mjs list | on <feature...> | off <feature...>\n');
  }
  for (const [n, desc] of Object.entries(FEATURES)) {
    console.log(`  ${on(n) ? 'on ' : 'off'}  ${n.padEnd(8)} ${desc}`);
  }
  return cmd === 'list' ? 0 : 1;
}

if (process.argv.length > 2) {
  process.exit(runCli(process.argv.slice(2)));
}

const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  try {
    const d = JSON.parse(Buffer.concat(chunks).toString());
    process.stdout.write(formatStatus(d));
  } catch {
    process.stdout.write('\x1b[2mstatusline: no data\x1b[0m');
  }
});


function visLen(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function parseWidth(value) {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function widthFromCommand(command, pick = s => s) {
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 200,
    }).trim();
    return parseWidth(pick(output));
  } catch {
    return null;
  }
}

function detectTerminalWidth() {
  const streamWidth = parseWidth(process.stdout.columns) ?? parseWidth(process.stderr.columns);
  if (streamWidth) return streamWidth;

  const envWidth = parseWidth(process.env.COLUMNS);
  if (envWidth) return envWidth;

  // When Claude runs the statusline as a child with piped stdio, plain `tput cols`
  // often falls back to terminfo's default width (commonly 80) instead of the
  // real terminal width. Query /dev/tty directly when possible.
  const ttyWidth =
    widthFromCommand('stty size < /dev/tty', output => output.split(/\s+/).pop()) ??
    widthFromCommand('tput cols < /dev/tty');
  if (ttyWidth) return ttyWidth;

  if (process.stdin.isTTY || process.stdout.isTTY || process.stderr.isTTY) {
    const interactiveWidth = widthFromCommand('tput cols');
    if (interactiveWidth) return interactiveWidth;
  }

  return 80;
}

function packSegments(segments, termWidth) {
  const S = sep();
  const sepLen = visLen(S);
  const width = Math.max(20, parseWidth(termWidth) ?? 80);
  const lines = [];
  let currentLine = '';
  let currentLen = 0;

  for (const seg of segments) {
    if (!currentLine) {
      currentLine = seg.text;
      currentLen = seg.len;
    } else {
      const nextLen = currentLen + sepLen + seg.len;
      if (nextLen > width) {
        lines.push(currentLine);
        currentLine = seg.text;
        currentLen = seg.len;
      } else {
        currentLine += S + seg.text;
        currentLen = nextLen;
      }
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.join('\n');
}

// ── Helpers for improvements ──────────────────────────────────────────────

// Color palette — 24-bit true color to bypass terminal theme remapping
const C = {
  bar5H:        '38;2;135;206;250',   // light sky blue
  barWeek:      '38;2;100;149;237',   // cornflower blue
  barContext:   '38;2;176;196;222',   // light steel blue
  barCodex5H:   '38;2;255;182;193',   // light pink
  barCodexWeek: '38;2;221;160;221',   // plum
  text5H:       '38;2;173;216;230',   // pastel sky
  textWeek:     '38;2;176;196;222',   // pastel steel blue
  textContext:  '38;2;200;220;240',   // very pale blue
  textCodex5H:  '38;2;255;200;210',   // pastel pink
  textCodexWeek:'38;2;230;200;230',   // pastel plum
  textAgents:   '38;2;255;218;185',   // pastel peach
  textDir:      '38;2;175;238;238',   // pale turquoise
  textModel:    '38;2;221;190;221',   // pastel mauve
  textEffort:   '38;2;190;170;200',   // muted mauve (effort level)
  textBranch:   '38;2;152;195;121',   // pastel green (git branch)
  textCache:    '38;2;170;220;190',   // pale mint (prompt cache)
  textDim:      '38;2;160;160;160',   // neutral dim
  warn:         '38;2;255;223;128',   // pastel yellow (≥80%)
  alert:        '38;2;255;153;153',   // pastel red (≥95%)
};

// #3: Budget warning prefix (urgency-based; not for Context)
function budgetPrefix(pct) {
  if (pct >= 95) return color('⚠ ', C.alert);
  if (pct >= 80) return color('! ', C.warn);
  return '';
}

// #5: Elapsed time formatter
function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function gitBranch(dir) {
  try {
    return execSync(`git -C "${dir}" symbolic-ref --short -q HEAD`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 200,
    }).trim() || null;
  } catch {
    return null;
  }
}

function formatStatus(d) {
  const MARGIN = 20;

  // Part A: prefer width from stdin JSON payload before falling back to TTY detection
  const jsonWidth =
    parseWidth(d.terminal?.width) ??
    parseWidth(d.terminal?.columns) ??
    parseWidth(d.width) ??
    parseWidth(d.columns);

  const rawWidth = (jsonWidth && jsonWidth > 20) ? jsonWidth : detectTerminalWidth();

  // Part B: subtract safety margin for Claude Code TUI padding/borders
  const termWidth = Math.max(20, rawWidth - MARGIN);

  // Adaptive bar width: full bars at wide terminals, shorter or none when narrow.
  // Use rawWidth (pre-margin) so thresholds align with the terminal's actual column count.
  const barW = rawWidth >= 80 ? 10 : rawWidth >= 60 ? 5 : 0;

  const group1 = [];
  const group2 = [];
  const group3 = [];

  // ── Group 1: directory, model ─────────────────────────────────────────────
  const rawDir = d.workspace?.current_dir || d.cwd || '~';
  const home = os.homedir();
  const dir = home && rawDir.startsWith(home) ? '~' + rawDir.slice(home.length) : rawDir;
  // Git branch: prefer the worktree branch from the payload, else ask git; hidden outside repos
  const branch = on('branch') ? (d.worktree?.branch || gitBranch(rawDir)) : null;
  const branchText = branch ? ' ' + color(`(${branch})`, C.textBranch) : '';
  const dirText = color(dir, C.textDir) + branchText;
  group1.push({ text: dirText, len: visLen(dirText) });

  const model = d.model?.display_name || '?';
  // Effort level (low/medium/high/xhigh/max) — present only when the model supports it
  const effort = on('effort') ? d.effort?.level : null;
  const effortColor = (effort === 'xhigh' || effort === 'max') ? C.warn : C.textEffort;
  const effortText = effort ? ' ' + color(`(${effort})`, effortColor) : '';
  // Badges: thinking state always shown (off = yellow), fast mode only when on
  const badges = [];
  if (on('badges') && typeof d.thinking?.enabled === 'boolean') {
    badges.push(d.thinking.enabled
      ? color('thinking on', C.textEffort)
      : color('thinking off', C.warn));
  }
  if (on('badges') && d.fast_mode === true) badges.push(color('fast', C.warn));
  const badgeText = badges.length
    ? ' ' + color('[', C.textDim) + badges.join(color(', ', C.textDim)) + color(']', C.textDim)
    : '';
  const modelText = color(model, C.textModel) + effortText + badgeText;
  group1.push({ text: modelText, len: visLen(modelText) });

  // Session elapsed time + estimated cost
  const cost = d.cost;
  if (on('session') && cost?.total_duration_ms) {
    const parts = [fmtElapsed(cost.total_duration_ms)];
    if (typeof cost.total_cost_usd === 'number') parts.push(`$${cost.total_cost_usd.toFixed(2)}`);
    const t = color(parts.join(' · '), C.textDim);
    group1.push({ text: t, len: visLen(t) });
  }

  // ── Group 2: 5H, Week, Context ────────────────────────────────────────────
  const fiveH = d.rate_limits?.five_hour;
  if (on('limits') && fiveH) {
    const nowSec = Math.floor(Date.now() / 1000);
    const isStale = fiveH.resets_at && fiveH.resets_at < nowSec;
    if (isStale) {
      const sp = barW > 0 ? ' ' : '';
      const readyStr = barW === 0 ? '' : color(' (ready)', C.textDim);
      const t = color('5H ', C.text5H) + bar(0, barW, C.bar5H) + color(`${sp}0%`, C.text5H) + readyStr;
      group2.push({ text: t, len: visLen(t) });
    } else {
      const sp = barW > 0 ? ' ' : '';
      const pct = fiveH.used_percentage ?? 0;
      const rounded = Math.round(pct);
      const reset = fmtReset(fiveH.resets_at);
      const resetStr = (reset && barW > 0) ? color(` (${reset})`, C.textDim) : '';
      const prefix = budgetPrefix(pct);
      const t = prefix + color('5H ', C.text5H) + bar(pct, barW, C.bar5H) + color(`${sp}${rounded}%`, C.text5H) + resetStr;
      group2.push({ text: t, len: visLen(t) });
    }
  }

  const sevenD = d.rate_limits?.seven_day;
  if (on('limits') && sevenD) {
    const nowSec = Math.floor(Date.now() / 1000);
    const isStale = sevenD.resets_at && sevenD.resets_at < nowSec;
    if (isStale) {
      const sp = barW > 0 ? ' ' : '';
      const readyStr = barW === 0 ? '' : color(' (ready)', C.textDim);
      const t = color('Week ', C.textWeek) + bar(0, barW, C.barWeek) + color(`${sp}0%`, C.textWeek) + readyStr;
      group2.push({ text: t, len: visLen(t) });
    } else {
      const sp = barW > 0 ? ' ' : '';
      const pct = sevenD.used_percentage ?? 0;
      const rounded = Math.round(pct);
      const reset = fmtReset(sevenD.resets_at);
      const resetStr = (reset && barW > 0) ? color(` (${reset})`, C.textDim) : '';
      const prefix = budgetPrefix(pct);
      const t = prefix + color('Week ', C.textWeek) + bar(pct, barW, C.barWeek) + color(`${sp}${rounded}%`, C.textWeek) + resetStr;
      group2.push({ text: t, len: visLen(t) });
    }
  }

  const ctx = d.context_window;
  if (on('context') && ctx) {
    const pct = ctx.used_percentage ?? 0;
    const rounded = Math.round(pct);
    // Context: no budget prefix (ephemeral, different semantics)
    const sp = barW > 0 ? ' ' : '';
    const t = color('Context ', C.textContext) + bar(pct, barW, C.barContext) + color(`${sp}${rounded}%`, C.textContext);
    group2.push({ text: t, len: visLen(t) });
  }

  // Prompt cache: time left before the cache goes cold (then the whole conversation is re-written)
  const cache = d.prompt_cache;
  if (on('cache') && cache) {
    const left = cache.warm ? fmtReset(cache.expires_at) : '';
    let t;
    if (left) {
      const hit = (typeof cache.hit_ratio === 'number' && barW > 0)
        ? color(` (${Math.round(cache.hit_ratio * 100)}% hit)`, C.textDim) : '';
      t = color(`Cache ${left}`, C.textCache) + hit;
    } else {
      t = color('Cache cold', C.textDim);
    }
    group2.push({ text: t, len: visLen(t) });
  }

  // ── Group 3: Codex windows (5H / Week / 30D, whichever the CLI reports) ─────
  const codexLimits = on('codex') ? getCodexRateLimits() : null;
  if (codexLimits) {
    const nowSec = Math.floor(Date.now() / 1000);
    const sp = barW > 0 ? ' ' : '';
    const styles = [
      { bar: C.barCodex5H, text: C.textCodex5H },
      { bar: C.barCodexWeek, text: C.textCodexWeek },
    ];
    codexLimits.forEach((win, i) => {
      const label = `Codex ${fmtWindow(win.window_minutes)} `;
      const style = styles[i] ?? styles[1];
      // Stale window (reset time already passed) → hide; reappears once Codex is used again
      if (win.resets_at && win.resets_at < nowSec) return;
      const pct = win.used_percent ?? 0;
      const reset = fmtReset(win.resets_at);
      const resetStr = (reset && barW > 0) ? color(` (${reset})`, C.textDim) : '';
      const t = budgetPrefix(pct) + color(label, style.text) + bar(pct, barW, style.bar) + color(`${sp}${Math.round(pct)}%`, style.text) + resetStr;
      group3.push({ text: t, len: visLen(t) });
    });
  }

  // ── Group 4: Live subagent tracker ───────────────────────────────────────
  const group4 = [];
  const agents = on('agents') ? getActiveAgents() : [];
  if (agents.length > 0) {
    const counts = {};
    const oldestStart = {};  // #5: track oldest startedAt per label
    for (const { label, startedAt } of agents) {
      counts[label] = (counts[label] ?? 0) + 1;
      if (startedAt && (!oldestStart[label] || startedAt < oldestStart[label])) {
        oldestStart[label] = startedAt;
      }
    }
    const now = Date.now();
    const parts = Object.entries(counts).map(([label, n]) => {
      const elapsed = oldestStart[label] ? fmtElapsed(now - oldestStart[label]) : null;
      return elapsed ? `${n}\xd7${label} (${elapsed})` : `${n}\xd7${label}`;
    });
    const t = color('Agents: ' + parts.join(', '), C.textAgents);
    group4.push({ text: t, len: visLen(t) });
  }

  return [group1, group2, group3, group4]
    .filter(g => g.length > 0)
    .map(g => packSegments(g, termWidth))
    .join('\n\n');
}

function sep() {
  return color(' │ ', '38;2;100;100;100');
}

function bar(pct, width, colorCode) {
  if (width === 0) return '';
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return `\x1b[${colorCode}m${'█'.repeat(filled)}${'░'.repeat(empty)}\x1b[0m`;
}

// Codex window label from its length in minutes
function fmtWindow(mins) {
  if (!mins) return '5H';
  if (mins <= 300) return '5H';
  if (mins <= 10080) return 'Week';
  return `${Math.round(mins / 1440)}D`;
}

function fmtReset(epoch) {
  if (!epoch) return '';
  const diff = epoch - Math.floor(Date.now() / 1000);
  if (diff <= 0) return '';
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function getCodexRateLimits() {
  try {
    const sessionsBase = `${os.homedir()}/.codex/sessions`;
    // Most recently written rollout file across all sessions (mtime, not filename),
    // so concurrent Codex sessions don't surface a stale one
    const latestFile = execSync(
      `ls -t "${sessionsBase}"/????/??/??/rollout-*.jsonl 2>/dev/null | head -1`,
      { timeout: 500 }
    ).toString().trim();
    if (!latestFile) return null;

    // Use grep to find lines with rate_limits (avoid reading large files fully)
    const grepResult = execSync(
      `grep -a "rate_limits" "${latestFile}" 2>/dev/null | tail -1`,
      { timeout: 1000 }
    ).toString().trim();
    if (!grepResult) return null;

    // Parse the JSON line — it may be a top-level object or nested
    const parsed = JSON.parse(grepResult);

    // Navigate to rate_limits — it can appear at various nesting levels
    let rl = parsed?.rate_limits ?? parsed?.payload?.rate_limits ?? parsed?.data?.rate_limits ?? parsed?.event?.rate_limits;
    if (!rl) {
      // Walk all values looking for a rate_limits key
      const str = JSON.stringify(parsed);
      const m = str.match(/"rate_limits"\s*:\s*(\{[^}]+\{[^}]*\}[^}]*\})/);
      if (!m) return null;
      rl = JSON.parse(m[1]);
    }

    // Newer Codex builds report only `primary` (secondary: null) — show whatever exists
    const windows = [rl?.primary, rl?.secondary].filter(w => w && typeof w === 'object');
    return windows.length ? windows : null;
  } catch {
    return null;
  }
}

function getActiveAgents() {
  try {
    const raw = readFileSync(path.join(os.tmpdir(), 'claude-agents.json'), 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const cutoff = Date.now() - 30 * 60 * 1000; // 30 minutes — filter stale/crashed
    return arr.filter(e => e && typeof e.label === 'string' && (e.startedAt ?? 0) > cutoff);
  } catch {
    return [];
  }
}

function color(text, code) {
  return `\x1b[${code}m${text}\x1b[0m`;
}
