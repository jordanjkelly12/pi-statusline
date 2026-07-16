/**
 * Statusline Extension
 *
 * A pi equivalent of the Claude Code statusline.sh. Replaces the footer with
 * a two-line status bar showing:
 *
 *   Line 1: model │ context-window % │ directory (git branch*) │ session time │ thinking level
 *
 * Built on ctx.ui.setFooter(). Unlike Claude Code's statusline (a standalone
 * shell script fed JSON on stdin), pi extensions get live, typed access to
 * session/model state, so no JSON parsing or polling is required.
 */

import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";

const execFileAsync = promisify(execFile);

function colorFor(theme: Theme, pct: number): "success" | "warning" | "error" {
	if (pct >= 90) return "error";
	if (pct >= 70) return "warning";
	return "success";
}

function bar(theme: Theme, pct: number, width: number): string {
	const clamped = Math.max(0, Math.min(100, pct));
	const filled = Math.round((clamped / 100) * width);
	const empty = width - filled;
	const color = colorFor(theme, clamped);
	return theme.fg(color, "●".repeat(filled)) + theme.fg("dim", "○".repeat(empty));
}

function formatDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s >= 3600) return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
	if (s >= 60) return `${Math.floor(s / 60)}m`;
	return `${s}s`;
}

const THINKING_ICON: Record<string, string> = {
	off: "○",
	minimal: "◔",
	low: "◔",
	medium: "◑",
	high: "●",
	xhigh: "●",
	max: "●",
};

function formatResetTime(iso: string | undefined, withDate: boolean): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const time = d
		.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
		.toLowerCase()
		.replace(/\s/g, "");
	if (!withDate) return time;
	const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toLowerCase();
	return `${date}, ${time}`;
}

// ── Anthropic OAuth usage (5h / 7d plan limits) ──────────────────────────
// Mirrors Claude Code's statusline.sh: same token lookup + same cache file,
// so both tools can share a single cached fetch and avoid double-hitting
// the rate-limit endpoint.

interface UsageData {
	fiveHourPct?: number;
	fiveHourReset?: string;
	sevenDayPct?: number;
	sevenDayReset?: string;
	extraEnabled?: boolean;
	extraPct?: number;
	extraUsed?: number;
	extraLimit?: number;
}

const CACHE_FILE = join("/tmp", "claude", "statusline-usage-cache.json");
const CACHE_MAX_AGE_MS = 60_000;

async function getOauthToken(): Promise<string | undefined> {
	if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN;

	if (process.platform === "darwin") {
		try {
			const { stdout } = await execFileAsync("security", [
				"find-generic-password",
				"-s",
				"Claude Code-credentials",
				"-w",
			]);
			const token = JSON.parse(stdout).claudeAiOauth?.accessToken;
			if (token) return token;
		} catch {
			// fall through
		}
	}

	try {
		const raw = await readFile(join(homedir(), ".claude", ".credentials.json"), "utf8");
		const token = JSON.parse(raw).claudeAiOauth?.accessToken;
		if (token) return token;
	} catch {
		// fall through
	}

	if (process.platform === "linux") {
		try {
			const { stdout } = await execFileAsync("secret-tool", [
				"lookup",
				"service",
				"Claude Code-credentials",
			]);
			const token = JSON.parse(stdout).claudeAiOauth?.accessToken;
			if (token) return token;
		} catch {
			// fall through
		}
	}

	return undefined;
}

async function readCache(): Promise<{ raw: any; ageMs: number } | undefined> {
	try {
		const st = await stat(CACHE_FILE);
		const raw = JSON.parse(await readFile(CACHE_FILE, "utf8"));
		return { raw, ageMs: Date.now() - st.mtimeMs };
	} catch {
		return undefined;
	}
}

function parseUsage(raw: any): UsageData {
	return {
		fiveHourPct: raw?.five_hour?.utilization,
		fiveHourReset: raw?.five_hour?.resets_at,
		sevenDayPct: raw?.seven_day?.utilization,
		sevenDayReset: raw?.seven_day?.resets_at,
		extraEnabled: raw?.extra_usage?.is_enabled ?? false,
		extraPct: raw?.extra_usage?.utilization,
		extraUsed: raw?.extra_usage?.used_credits != null ? raw.extra_usage.used_credits / 100 : undefined,
		extraLimit: raw?.extra_usage?.monthly_limit != null ? raw.extra_usage.monthly_limit / 100 : undefined,
	};
}

async function fetchUsage(): Promise<UsageData | undefined> {
	const cached = await readCache();
	if (cached && cached.ageMs < CACHE_MAX_AGE_MS) {
		return parseUsage(cached.raw);
	}

	const token = await getOauthToken();
	if (!token) return cached ? parseUsage(cached.raw) : undefined;

	try {
		const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				"anthropic-beta": "oauth-2025-04-20",
				"User-Agent": "claude-code/2.1.34",
			},
			signal: AbortSignal.timeout(5000),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		if (!data?.five_hour) throw new Error("unexpected response");

		await mkdir(join("/tmp", "claude"), { recursive: true });
		await writeFile(CACHE_FILE, JSON.stringify(data));
		return parseUsage(data);
	} catch {
		return cached ? parseUsage(cached.raw) : undefined;
	}
}

export default function (pi: ExtensionAPI) {
	let sessionStart = Date.now();
	let usage: UsageData | undefined;

	pi.on("session_start", async (_event, ctx) => {
		sessionStart = Date.now();
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			const refresh = () => {
				fetchUsage()
					.then((next) => {
						usage = next;
						tui.requestRender();
					})
					.catch(() => {});
			};
			refresh();
			const refreshTimer: NodeJS.Timeout = setInterval(refresh, CACHE_MAX_AGE_MS);

			return {
				dispose: () => {
					unsub();
					clearInterval(refreshTimer);
				},
				invalidate() {},
				render(width: number): string[] {
					const sep = theme.fg("dim", " │ ");

					// Model
					const modelName = ctx.model?.name ?? ctx.model?.id ?? "no-model";
					let out = theme.fg("accent", modelName);

					// Context window usage
					const ctxUsage = ctx.getContextUsage();
					if (ctxUsage?.percent != null) {
						const pct = Math.round(ctxUsage.percent);
						out += sep + theme.fg(colorFor(theme, pct), `${pct}%`);
					}

					// Directory + git branch
					const dirname = ctx.cwd.split("/").filter(Boolean).pop() ?? ctx.cwd;
					const branch = footerData.getGitBranch();
					out += sep + theme.fg("text", dirname);
					if (branch) out += theme.fg("dim", ` (${branch})`);

					// Session duration
					out += sep + theme.fg("dim", "⏱ ") + theme.fg("text", formatDuration(Date.now() - sessionStart));

					// Thinking level
					const level = pi.getThinkingLevel();
					const icon = THINKING_ICON[level] ?? "◑";
					out += sep + theme.fg("dim", `${icon} ${level}`);

					// Token / cost stats (from session branch, like custom-footer.ts)
					let input = 0,
						output = 0,
						cost = 0;
					for (const e of ctx.sessionManager.getBranch()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const m = e.message as AssistantMessage;
							input += m.usage.input;
							output += m.usage.output;
							cost += m.usage.cost.total;
						}
					}
					const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);
					out += sep + theme.fg("dim", `↑${fmt(input)} ↓${fmt(output)} $${cost.toFixed(3)}`);

					const lines = [truncateToWidth(out, width)];

					// Plan rate-limit bars (5-hour + weekly), like Claude Code's statusline
					if (usage?.fiveHourPct != null) {
						const pct = Math.round(usage.fiveHourPct);
						const reset = formatResetTime(usage.fiveHourReset, false);
						let line =
							theme.fg("text", "current ") +
							bar(theme, pct, 10) +
							" " +
							theme.fg(colorFor(theme, pct), `${pct}%`);
						if (reset) line += theme.fg("dim", ` ⟳ ${reset}`);
						lines.push(truncateToWidth(line, width));
					}
					if (usage?.sevenDayPct != null) {
						const pct = Math.round(usage.sevenDayPct);
						const reset = formatResetTime(usage.sevenDayReset, true);
						let line =
							theme.fg("text", "weekly  ") +
							bar(theme, pct, 10) +
							" " +
							theme.fg(colorFor(theme, pct), `${pct}%`);
						if (reset) line += theme.fg("dim", ` ⟳ ${reset}`);
						lines.push(truncateToWidth(line, width));
					}
					if (usage?.extraEnabled && usage.extraPct != null) {
						const pct = Math.round(usage.extraPct);
						const used = (usage.extraUsed ?? 0).toFixed(2);
						const limit = (usage.extraLimit ?? 0).toFixed(2);
						const line =
							theme.fg("text", "extra   ") +
							bar(theme, pct, 10) +
							" " +
							theme.fg(colorFor(theme, pct), `$${used}`) +
							theme.fg("dim", "/") +
							theme.fg("text", `$${limit}`);
						lines.push(truncateToWidth(line, width));
					}

					return lines;
				},
			};
		});
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
	});
}
