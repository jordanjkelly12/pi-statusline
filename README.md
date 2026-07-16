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

Claude Code ships a `statusline.sh` script (JSON piped over stdin, `jq`
parsing, polling Anthropic's usage API, shelling out to `git`). pi extensions
run in-process with typed access to session/model state, so this is a
native TypeScript reimplementation — no subprocess/JSON boundary needed for
model, context, and token/cost info. The plan rate-limit bars still call
Anthropic's OAuth usage endpoint (the same one `statusline.sh` uses) since
that data isn't otherwise exposed to pi.

## Install

Copy (or symlink) `statusline.ts` into pi's extension auto-discovery path:

```bash
mkdir -p ~/.pi/agent/extensions
cp statusline.ts ~/.pi/agent/extensions/statusline.ts
```

Project-local install (only for that repo):

```bash
mkdir -p .pi/extensions
cp statusline.ts .pi/extensions/statusline.ts
```

Reload with `/reload` inside pi, or just start a new session.

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
`https://api.anthropic.com/api/oauth/usage` using the same OAuth token
lookup order as `statusline.sh`:

1. `CLAUDE_CODE_OAUTH_TOKEN` env var
2. macOS Keychain (`security find-generic-password -s "Claude Code-credentials" -w`)
3. `~/.claude/.credentials.json`
4. `secret-tool` (Linux)

Results are cached in `/tmp/claude/statusline-usage-cache.json` (60s TTL) —
the same cache file `statusline.sh` uses, so both tools can share one fetch
instead of double-polling the rate-limit endpoint. If no token is found,
these lines are simply omitted.

**Line 4 (optional)** — "extra usage" / overage credits, shown only if
enabled on the account.

## Notes

- Rate-limit bars require a Claude Code OAuth credential on the machine.
  They're purely additive — everything else works with any model/provider.
- Color thresholds: green < 70%, yellow < 90%, red >= 90%.

## License

MIT
