import { readFileSync, writeFileSync, renameSync } from 'fs';
import { createHash } from 'crypto';
import os from 'os';
import path from 'path';

const STATE_FILE = path.join(os.tmpdir(), 'claude-agents.json');

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
    const id = hashToolInput(input);

    const state = readState();

    // Option A: hash match — find entry with matching id
    const matchIndex = state.findIndex(entry => entry.id === id);

    let updated;
    if (matchIndex !== -1) {
      // Remove only the first (oldest) matching entry
      updated = [...state];
      updated.splice(matchIndex, 1);
    } else {
      // Option B (fallback): derive label and remove oldest entry with matching label
      const subagentType = input.subagent_type ?? '';
      const model = input.model ?? '';
      let label;
      if (subagentType.startsWith('codex:')) {
        label = 'codex';
      } else if (model) {
        const m = model.match(/claude-(\w+)/i);
        label = m ? m[1].toLowerCase() : model;
      } else {
        label = 'sonnet';
      }

      // Sort by startedAt ascending, find first matching label
      const sorted = state.map((entry, origIdx) => ({ entry, origIdx }))
        .sort((a, b) => a.entry.startedAt - b.entry.startedAt);

      const oldestMatch = sorted.find(({ entry }) => entry.label === label);
      if (oldestMatch !== undefined) {
        updated = state.filter((_, i) => i !== oldestMatch.origIdx);
      } else {
        updated = state;
      }
    }

    writeState(updated);
  } catch {
    // Never block — silent exit 0
  }
  process.exit(0);
}

main();
