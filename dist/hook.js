import { basename } from "node:path";
import { normalizeTool, recordToolSession } from "./adapters.js";
import { Meshingly } from "./connection.js";

/**
 * `meshingly-mcp hook`: called by a tool's hooks (Claude Code: SessionStart, UserPromptSubmit, Stop, Notification, SessionEnd)
 * with the event as JSON on stdin. It tells the collaboration whether this session is working, idle or waiting for an
 * approval, so the app can show it. Only when the user turned statusReports on; only a state and the project's folder
 * name, nothing from the conversation. It must never get in the tool's way: every failure is silent and the exit code is 0.
 */
                                                      

/** What an event says about the session, or undefined when it says nothing. */
export function stateFor(payload                         )                    {
  switch (payload.hook_event_name) {
    case "SessionStart":
    case "Stop":
    case "Interrupt": // Codex
      return "idle";
    case "PermissionRequest": // Codex, and the OpenCode plugin
      return "waiting";
    case "UserPromptSubmit":
      return "working";
    case "SessionEnd":
      return "ended";
    case "Notification": {
      const kind = String(payload.notification_type ?? "");
      if (kind === "permission_prompt") return "waiting";
      if (kind === "idle_prompt") return "idle";
      return kind === "" && /permission|approv/i.test(String(payload.message ?? "")) ? "waiting" : undefined;
    }
    default:
      return undefined;
  }
}

const TEXT                        = {
  working: "working",
  idle: "idle",
  waiting: "waiting for an approval",
  ended: "session ended",
};

const TIMEOUT_MS = 4000;

export async function runHook(stdinText        , fallbackRoot = process.env.MESHINGLY_DIR ?? process.cwd(), toolName         )                  {
  try {
    const payload = JSON.parse(stdinText)                           ;
    const state = stateFor(payload);
    if (!state) return 0;
    const root = process.env.MESHINGLY_DIR ?? (typeof payload.cwd === "string" && payload.cwd ? payload.cwd : fallbackRoot);
    const m = new Meshingly(root);
    if (!m.connected()) return 0;
    // Codex and OpenCode: remember the tool's own session id, so the watcher can continue that conversation. Local only.
    const tool = normalizeTool(toolName);
    if (tool && tool !== "claude-code" && typeof payload.session_id === "string" && payload.hook_event_name !== "SessionEnd") recordToolSession(root, tool, payload.session_id);
    const agent = typeof payload.session_id === "string" ? payload.session_id.slice(0, 8) : undefined;
    await Promise.race([
      m.reportStatus({ state, text: TEXT[state], project: basename(root), ...(agent ? { agent } : {}) }),
      new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS)),
    ]);
  } catch (err) {
    // Never in the way of the tool: silent unless someone is looking for the reason.
    if (process.env.MESHINGLY_DEBUG) console.error(`meshingly hook: ${err instanceof Error ? err.message : String(err)}`);
  }
  return 0;
}

/** Reads all of stdin (empty when there is none). */
export async function readStdin(input                        = process.stdin)                  {
  let text = "";
  input.setEncoding("utf8");
  for await (const chunk of input) text += chunk;
  return text;
}
