import { readFileSync, writeFileSync, renameSync } from 'fs';
import { createHash } from 'crypto';
import os from 'os';
import path from 'path';

const STATE_FILE = path.join(os.tmpdir(), 'claude-agents.json');
const STALE_MS = 30 * 60 * 1000; // 30 minutes

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeState(state) {
  const tmp = `${STATE_FILE}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, JSON.stringify(state), 'utf8');
  renameSync(tmp, STATE_FILE);
}

function hashToolInput(toolInput) {
  return createHash('sha1')
    .update(JSON.stringify(toolInput))
    .digest('hex')
    .slice(0, 16);
}

async function main() {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const payload = JSON.parse(raw);

    if (payload.tool_name !== 'Agent') process.exit(0);

    const input = payload.tool_input ?? {};
    const subagentType = input.subagent_type ?? '';
    const model = input.model ?? '';
    const id = hashToolInput(input);

    let label;
    if (subagentType.startsWith('codex:')) {
      label = 'codex';
    } else if (model) {
      // Extract short model name: "claude-sonnet-4-5" → "sonnet", "claude-opus-4" → "opus"
      const m = model.match(/claude-(\w+)/i);
      label = m ? m[1].toLowerCase() : model;
    } else {
      label = 'sonnet'; // default per user routing rules
    }

    const now = Date.now();
    const state = readState();

    // Stale sweeper: remove entries older than 30 minutes
    const fresh = state.filter(entry => (now - entry.startedAt) < STALE_MS);

    fresh.push({ id, label, startedAt: now });
    writeState(fresh);
  } catch {
    // Never block — silent exit 0
  }
  process.exit(0);
}

main();
