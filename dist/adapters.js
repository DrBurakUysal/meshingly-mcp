import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { defuse } from "./lib/listener.js";

/**
 * Per-tool adapters: how a prompt from the user's phone reaches a session of each AI tool.
 *
 * - Claude Code: channels and hooks (channel.ts, hook.ts), and the watcher's `claude -p`.
 * - Codex: `codex exec` (non-interactive, resumable with `codex exec resume <thread>`), status from Codex's own hooks.
 *   Codex has no way to type into a RUNNING terminal session, so there is no live delivery: the watcher resumes the thread.
 * - OpenCode: `opencode run` (reads the prompt on stdin), and live delivery through the HTTP API of an `opencode serve`
 *   that the USER started, on this computer only (loopback), with their own password if they set one.
 *
 * Which program runs is never decided by a model or a peer: the closed list below is fixed, the setting that chooses is
 * changed only in a terminal (or with the user's approval), and no preset carries a `--dangerously-*` or yolo flag.
 */
                                                        
export const TOOLS                  = ["claude-code", "codex", "opencode"];

/** Maps what a session calls its tool ("Claude Code", "codex-cli", "opencode") to one of the known tools, or undefined. */
export function normalizeTool(raw         )                   {
  const t = String(raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (t.includes("claude")) return "claude-code";
  if (t.includes("codex")) return "codex";
  if (t.includes("opencode")) return "opencode";
  return undefined;
}

/** The tool whose preset the watcher uses: the setting, or with "auto" what this project's own session said it runs in. */
export function resolveTool(setting        , localTool                    )       {
  if (setting === "codex" || setting === "opencode" || setting === "claude-code") return setting;
  return normalizeTool(localTool) ?? "claude-code";
}

/** Characters a tool's own session id may have: it ends up on a command line, so nothing a shell could read as syntax. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{5,79}$/;
export const validSessionId = (s         )              => typeof s === "string" && SESSION_ID.test(s);

/**
 * The command the watcher runs for a tool: reads the prompt on stdin, works in the project directory, limited by the
 * tool's own sandbox or permission rules. `sessionId` continues that conversation instead of starting a new one.
 */
export function presetCommand(tool      , sessionId         )         {
  const id = validSessionId(sessionId) ? sessionId : undefined;
  switch (tool) {
    case "claude-code":
      return "claude -p";
    case "codex":
      // workspace-write: edits inside the project, no network, no access outside it. "-" reads the prompt from stdin.
      return `codex exec --sandbox workspace-write --skip-git-repo-check ${id ? `resume ${id} ` : ""}-`;
    case "opencode":
      // The tool's own permission rules (opencode.json) apply; nothing is loosened here.
      return `opencode run${id ? ` --session ${id}` : ""}`;
  }
}

// ---- The tool's own session ids, recorded by its hooks -----------------------------------------------------------------

const sessionsFile = (root        ) => join(root, ".meshingly", "tool-sessions.json");

/** Remembers the latest session of a tool in this project (from its hooks), so the watcher can continue it. */
export function recordToolSession(root        , tool      , id        )       {
  if (!validSessionId(id)) return;
  try {
    const all = readAll(root);
    all[tool] = { id, at: Date.now() };
    mkdirSync(dirname(sessionsFile(root)), { recursive: true });
    const tmp = `${sessionsFile(root)}.tmp`;
    writeFileSync(tmp, JSON.stringify(all));
    renameSync(tmp, sessionsFile(root));
  } catch {
    /* only a convenience */
  }
}

function readAll(root        )                                             {
  try {
    if (!existsSync(sessionsFile(root))) return {};
    const raw = JSON.parse(readFileSync(sessionsFile(root), "utf8"))                                                  ;
    const out                                             = {};
    for (const [k, v] of Object.entries(raw)) if (validSessionId(v?.id) && typeof v.at === "number") out[k] = { id: v.id, at: v.at };
    return out;
  } catch {
    return {};
  }
}

/** The latest recorded session of a tool in this project, if it is recent (a week) and well-formed. */
export function recordedToolSession(root        , tool      , now = Date.now())                     {
  const r = readAll(root)[tool];
  return r && now - r.at < 7 * 86_400_000 ? r.id : undefined;
}

// ---- OpenCode: live delivery through a server the user started ---------------------------------------------------------

/**
 * The origin of a loopback http URL, or undefined for anything else. Prompts are only ever sent to this computer: a setting
 * that points elsewhere (or a URL with credentials, or https to a name) is refused, not followed.
 */
export function loopbackOrigin(raw        )                     {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" || u.username || u.password) return undefined;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}

const norm = (p        ) => resolve(p).replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();

                                                                                         

                              
                 
               
               
                                                                                  
                
                                                                                                   
                    
                     
                           
 

/**
 * Sends the text to a session of a running `opencode serve` (POST /session/:id/prompt_async: the session shows it live in
 * every attached TUI or web UI). Only the project's own sessions (same directory) are candidates. The text goes through
 * `defuse` like every peer or prompt text. Nothing is started and nothing is exposed: if there is no server or session,
 * the caller falls back to the command.
 */
export async function deliverToOpenCode(o             )                      {
  const origin = loopbackOrigin(o.server);
  if (!origin) return { ok: false, reason: "the OpenCode server address is not a loopback http address" };
  const f = o.fetchImpl ?? fetch;
  const headers                         = { "content-type": "application/json" };
  if (o.password) headers.authorization = `Basic ${Buffer.from(`opencode:${o.password}`).toString("base64")}`;
  const call = (path        , init              = {}) =>
    f(`${origin}${path}`, { ...init, headers: { ...headers, ...(init.headers                                      ) }, redirect: "error", signal: AbortSignal.timeout(o.timeoutMs ?? 5000) });
  try {
    const list = await call("/session");
    if (!list.ok) return { ok: false, reason: `the OpenCode server answered ${list.status}` };
    const sessions = (await list.json())                                                                              ;
    if (!Array.isArray(sessions)) return { ok: false, reason: "unexpected answer from the OpenCode server" };
    const mine = sessions
      .filter((s) => typeof s.id === "string" && /^[A-Za-z0-9_-]{4,80}$/.test(s.id) && typeof s.directory === "string" && norm(s.directory) === norm(o.root))
      .sort((a, b) => Number(b.time?.updated ?? 0) - Number(a.time?.updated ?? 0));
    const target = mine.find((s) => s.id === o.hint) ?? mine[0];
    if (!target) return { ok: false, reason: "no OpenCode session in this project is open on that server" };
    const sent = await call(`/session/${encodeURIComponent(target.id          )}/prompt_async`, {
      method: "POST",
      body: JSON.stringify({ parts: [{ type: "text", text: defuse(o.text).slice(0, 30_000) }] }),
    });
    return sent.ok ? { ok: true, sessionId: target.id           } : { ok: false, reason: `the OpenCode server refused the prompt (${sent.status})` };
  } catch (err) {
    return { ok: false, reason: `the OpenCode server could not be reached (${err instanceof Error ? err.message : String(err)})` };
  }
}

// ---- Setup helper: `meshingly-mcp adapters` ----------------------------------------------------------------------------

const CODEX_EVENTS = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "Stop", "SessionEnd"];

export function codexHooksToml()         {
  return CODEX_EVENTS.map((e) => `[[hooks.${e}]]\n[[hooks.${e}.hooks]]\ntype = "command"\ncommand = "npx -y meshingly-mcp hook --tool codex"\ntimeout = 10\n`).join("\n");
}

/** The OpenCode plugin: it tells `meshingly-mcp hook` what the session is doing (ids and states only, never text). */
export const OPENCODE_PLUGIN = `// Meshingly: reports whether this OpenCode session is working, idle or waiting for an approval.
// It sends only a state and the session id to \`meshingly-mcp hook\` on this computer, never any conversation text.
import { spawn } from "node:child_process";

const STATE = {
  "session.created": "SessionStart",
  "session.idle": "Stop",
  "session.deleted": "SessionEnd",
  "permission.asked": "PermissionRequest",
};

function report(event, sessionId, cwd) {
  try {
    const child = spawn("npx", ["-y", "meshingly-mcp", "hook", "--tool", "opencode"], { stdio: ["pipe", "ignore", "ignore"], shell: process.platform === "win32" });
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ hook_event_name: event, session_id: sessionId, cwd }));
    child.unref();
  } catch {}
}

export const MeshinglyPlugin = async ({ directory }) => ({
  event: async ({ event }) => {
    const p = event.properties ?? {};
    const id = p.sessionID ?? p.info?.id;
    let name = STATE[event.type];
    if (event.type === "session.status" && p.status?.type === "busy") name = "UserPromptSubmit";
    if (name && typeof id === "string") report(name, id, directory);
  },
});
`;

const ADAPTERS_HELP = `meshingly-mcp adapters: set up Codex or OpenCode for Meshingly.

  npx -y meshingly-mcp adapters codex       print the hooks that report a Codex session's state (paste into ~/.codex/config.toml or <project>/.codex/config.toml)
  npx -y meshingly-mcp adapters opencode    print the OpenCode plugin
  npx -y meshingly-mcp adapters opencode --install   write it to .opencode/plugins/meshingly.js in this project

Reading the output changes nothing. Then, in a terminal, choose which tool the watcher starts:
  npx -y meshingly-mcp settings set resumeTool codex      (or opencode, claude-code, auto)
`;

export function runAdapters(argv          , root = process.env.MESHINGLY_DIR ?? process.cwd())         {
  const [which, flag] = argv;
  if (which === "codex") {
    console.log(`# Codex hooks for Meshingly. Codex asks you to review and trust each hook in /hooks the first time.\n${codexHooksToml()}`);
    return 0;
  }
  if (which === "opencode") {
    if (flag === "--install") {
      const target = join(root, ".opencode", "plugins", "meshingly.js");
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, OPENCODE_PLUGIN);
      console.log(`Wrote ${target}. Restart OpenCode to load it.`);
    } else {
      console.log(OPENCODE_PLUGIN);
    }
    return 0;
  }
  console.log(ADAPTERS_HELP);
  return which === undefined || which === "--help" || which === "help" ? 0 : 2;
}
