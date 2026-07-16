# pi-statusline

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that
replaces the footer with a Claude-Code-style statusline: model, context
window usage, cwd/git branch, session duration, thinking level, token/cost
stats, and Claude account rate-limit bars (5-hour + weekly).

```
Claude Sonnet 5 │ 6% │ ProjectName │ ⏱ 41s │ ◑ medium │ ↑78 ↓28.4k $0.656
current ●●○○○○○○○○ 20% ⟳ 6:30pm
weekly  ●●○○○○○○○○ 18% ⟳ jul 21, 12:00am
```

## Why

pi extensions run in-process with typed access to session/model state, so
most of this (model, context usage, git branch, tokens, cost) is read
directly from pi's APIs — no shell scripting, JSON parsing, or polling
required. The plan rate-limit bars are the one exception: that data isn't
exposed by pi itself, so it's fetched directly from Anthropic's OAuth usage
endpoint using your local Claude Code credentials (see below).

## Install

**One-liner** (no clone needed):

```bash
curl -fsSL https://raw.githubusercontent.com/jordanjkelly12/pi-statusline/main/install.sh | bash
```

Installs to `~/.pi/agent/extensions/statusline.ts` (global, all projects).

**Project-local** (only for the current repo):

```bash
curl -fsSL https://raw.githubusercontent.com/jordanjkelly12/pi-statusline/main/install.sh | bash -s -- --project
```

**From a clone:**

```bash
git clone https://github.com/jordanjkelly12/pi-statusline.git
cd pi-statusline
./install.sh              # global install
./install.sh --project    # project-local install
./install.sh --uninstall  # remove global install
```

**Manual install** — just copy the file yourself:

```bash
mkdir -p ~/.pi/agent/extensions
cp statusline.ts ~/.pi/agent/extensions/statusline.ts
```

After installing, run `/reload` inside pi (or start a new session) to activate it.

## What it shows

**Line 1**

| Segment | Source |
|---|---|
| Model name | `ctx.model` |
| Context window % | `ctx.getContextUsage()` |
| Directory (+ git branch) | `ctx.cwd`, `footerData.getGitBranch()` |
| Session duration | tracked from `session_start` |
| Thinking level | `pi.getThinkingLevel()` |
| Token/cost stats | summed from `ctx.sessionManager.getBranch()` |

**Lines 2-3 (optional)** — Claude account plan usage, fetched from
`https://api.anthropic.com/api/oauth/usage` using a Claude Code OAuth token,
looked up in this order:

1. `CLAUDE_CODE_OAUTH_TOKEN` env var
2. macOS Keychain (`security find-generic-password -s "Claude Code-credentials" -w`)
3. `~/.claude/.credentials.json`
4. `secret-tool` (Linux)

This is the same credential Claude Code itself uses, so if you have Claude
Code installed and logged in, no extra setup is needed. Results are cached
in `/tmp/claude/statusline-usage-cache.json` (60s TTL) so it isn't fetched
on every render. If no token is found, these lines are simply omitted.

**Line 4 (optional)** — "extra usage" / overage credits, shown only if
enabled on the account.

## Notes

- Rate-limit bars require a Claude Code OAuth credential on the machine.
  They're purely additive — everything else works with any model/provider.
- Color thresholds: green < 70%, yellow < 90%, red >= 90%.

## License

MIT
