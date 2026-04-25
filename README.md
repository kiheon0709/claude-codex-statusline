# claude-codex-statusline

Claude Code + Codex CLI 사용량을 터미널 상태바에 실시간으로 표시하는 statusline 스크립트.

**English:** A statusline for Claude Code that displays rate-limit usage bars, context window, Codex CLI budgets, and active subagent counts — all rendered inline in the Claude Code TUI.

![screenshot](./docs/screenshot.png)

---

## Quick install

```bash
curl -fsSL https://raw.githubusercontent.com/kiheon0709/claude-codex-statusline/main/install.sh | bash
```

재실행해도 안전합니다 (idempotent).

---

## 표시 항목

- **Directory / Model** — 현재 작업 디렉터리(fish-style 축약) + 사용 중인 Claude 모델명
- **Claude 5H / Week / Context** — Claude Code의 공식 statusline 페이로드에서 직접 읽어오는 rate-limit 바 (추가 API 호출 없음)
- **Codex 5H / Week** — 로컬 `~/.codex/sessions/.../rollout-*.jsonl` 파일에서 파싱하는 Codex CLI 사용량 바
- **Active Agents** — PreToolUse/PostToolUse 훅으로 추적하는 실행 중인 서브에이전트 카운터 (시작 후 경과 시간 포함)

사용량이 80% 이상이면 `!` 경고, 95% 이상이면 `⚠` 알림이 표시됩니다.

---

## Requirements

- **Claude Code** (Claude Code가 Node.js를 번들로 포함하므로 별도 설치 불필요)
- **Node.js** — Claude Code 번들 Node.js 사용
- **macOS or Linux** — Windows는 테스트되지 않음
- **Codex CLI** (선택) — 설치하지 않아도 동작하며, Codex 바는 사용 이력이 있을 때만 표시됨

---

## Manual install (clone)

```bash
git clone https://github.com/kiheon0709/claude-codex-statusline.git
cd claude-codex-statusline
./install.sh
```

---

## Uninstall

클론된 레포에서:

```bash
./uninstall.sh
```

또는 원라이너:

```bash
curl -fsSL https://raw.githubusercontent.com/kiheon0709/claude-codex-statusline/main/uninstall.sh | bash
```

---

## How it works

**Claude 데이터**: Claude Code가 statusline 커맨드를 실행할 때 stdin으로 JSON 페이로드를 전달합니다. `statusline.mjs`는 이 페이로드에서 `rate_limits`, `context_window`, `model`, `workspace` 등을 읽어 바를 렌더링합니다. 별도 네트워크 호출 없음.

**Codex 데이터**: `~/.codex/sessions/` 하위의 최신 `rollout-*.jsonl` 파일에서 `grep`으로 `rate_limits` 키가 포함된 마지막 줄을 추출해 JSON 파싱합니다. 파일 크기에 무관하게 빠릅니다.

**Agent 추적**: `hooks/agent-start.mjs`(PreToolUse)와 `hooks/agent-end.mjs`(PostToolUse)가 `Agent` 툴 호출 시마다 OS 임시 디렉터리(`os.tmpdir()`)의 `claude-agents.json`을 원자적으로 업데이트합니다. Statusline은 이 파일을 읽어 현재 실행 중인 서브에이전트를 표시합니다.

**텔레메트리 없음.** 설치 스크립트의 파일 다운로드 외에 네트워크 통신은 없습니다.

---

## Files installed

설치 후 생성/수정되는 파일:

| 파일 | 설명 |
|------|------|
| `~/.claude/statusline.mjs` | 메인 statusline 렌더러 |
| `~/.claude/hooks/agent-start.mjs` | Agent PreToolUse 훅 |
| `~/.claude/hooks/agent-end.mjs` | Agent PostToolUse 훅 |

`~/.claude/settings.json`에 추가되는 키:

- `statusLine` — `{ type: "command", command: "node ~/.claude/statusline.mjs" }`
- `hooks.PreToolUse[]` — matcher `Agent`, command `agent-start.mjs`
- `hooks.PostToolUse[]` — matcher `Agent`, command `agent-end.mjs`

---

## License

MIT — Copyright (c) 2026 [kiheon0709](https://github.com/kiheon0709)
