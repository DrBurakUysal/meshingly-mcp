import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Per-project preferences of the person using Meshingly. They are changed from a terminal (`meshingly-mcp settings`),
 * never through an MCP tool: the settings decide what runs unattended on this computer, so a model that a peer's
 * message talked into something must not be able to change them. (An agent with shell access could still edit the
 * file, exactly as it could edit its own permission settings: the guarantee is about the tool surface.)
 *
 * They live in the user's home directory, keyed by the project's path, and NOT in the project's own `.meshingly/`:
 * a repository can ship a `.meshingly/` folder, and a command to run unattended must never come from there.
 */
                           
                                                                                            
                      
                                                                        
                        
                                                                                  
                      
                                                                                   
                                     
                                                                                                          
                                             
                                                                                                                    
                  
                                                                                         
                                
                                                                                                                                         
                        
                                                                   
                      
                                      
                               
                                                                                                                                         
                       
 

                                                                                                                                      

export const SETTING_INFO                                                                                                               = {
  autoResume: {
    kind: { type: "boolean" },
    default: false,
    env: "MESHINGLY_AUTOWATCH",
    description: "Start the background watcher automatically, so queued work continues after the usage limit is back.",
  },
  resumeCommand: {
    kind: { type: "string" },
    default: "claude -p",
    env: "MESHINGLY_WATCH_CMD",
    description: "Command that receives the handoff on stdin and continues the work. Add the permissions it needs yourself.",
  },
  trustPeers: {
    kind: { type: "boolean" },
    default: false,
    env: "MESHINGLY_WATCH_FROM_PEERS",
    description: "Also run handoffs written by teammates. Their text starts an agent on this computer: only for people you trust.",
  },
  onQuestion: {
    kind: { type: "enum", values: ["stop", "recommended"] },
    default: "stop",
    description:
      "When an unattended run would ask a question: stop = park the question for a person; recommended = take the option it recommends, note the assumption and carry on (never for deleting, spending, publishing or pushing).",
  },
  journal: {
    kind: { type: "enum", values: ["off", "milestones", "detailed"] },
    default: "off",
    description:
      "Sessions write short notes for the other sessions (milestones: finished steps and decisions; detailed: every step). Everyone in the collaboration can read them.",
  },
  catchUp: {
    kind: { type: "int", min: 0, max: 200 },
    default: 0,
    description: "Turns on the catch-up: when a session joins or starts it gets a short map of the collaboration and this many of the latest entries (at most 6 are quoted), so it knows what the other sessions did. 0 = off.",
  },
  modelMayStartWatcher: {
    kind: { type: "boolean" },
    default: false,
    description: "Let an AI session start the background watcher with its meshingly_watch_start tool. Off: only you start it (watch command, or autoResume).",
  },
  settleMinutes: {
    kind: { type: "int", min: 0, max: 240 },
    default: 5,
    description: "How long a handoff without a limit-reset time waits before the watcher runs it, in case the session that parked it is still working.",
  },
  maxAttempts: { kind: { type: "int", min: 1, max: 10 }, default: 3, description: "Failed runs per handoff before the watcher gives up on it." },
  checkIntervalSeconds: { kind: { type: "int", min: 5, max: 3600 }, default: 60, description: "Seconds between queue checks." },
  updateCheck: {
    kind: { type: "boolean" },
    default: true,
    env: "MESHINGLY_UPDATE_CHECK",
    description: "Once a day, look on npm whether a newer version of the MCP exists and say so in the status. It only reads the public version number and never installs anything.",
  },
};

export const SETTING_KEYS = Object.keys(SETTING_INFO)                         ;

/**
 * Settings an AI session may change itself when the user asks for it in the conversation. They decide what is shared inside
 * the collaboration or how patient the watcher is; none of them starts a program.
 */
export const MODEL_MAY_SET                              = new Set(["journal", "catchUp", "settleMinutes", "maxAttempts", "checkIntervalSeconds", "updateCheck"]);

/**
 * Whether a change needs the user's own approval, which the model cannot give. Everything does, except what is on the
 * allow-list above and switching a supervision-reducing setting back off: a setting added later is guarded until someone
 * deliberately puts it on the list.
 */
export function needsApproval(key                , value         )          {
  if (MODEL_MAY_SET.has(key)) return false;
  if ((key === "autoResume" || key === "trustPeers" || key === "modelMayStartWatcher") && value === false) return false;
  if (key === "onQuestion" && value === "stop") return false;
  return true;
}

/** What a change means, in the words the user sees when asked to approve it. */
export function riskNote(key                , value         )         {
  switch (key) {
    case "autoResume":
      return "a background process will start an AI agent on this computer whenever queued work is ready";
    case "resumeCommand":
      return `this command will be run unattended, with queued work as its input: ${String(value)}`;
    case "trustPeers":
      return "handoffs written by teammates will start an AI agent on this computer";
    case "onQuestion":
      return "unattended runs will decide questions themselves instead of waiting for you (never deleting, spending, publishing or pushing)";
    case "modelMayStartWatcher":
      return "an AI session may start the background watcher without asking you again";
    default:
      return "this changes how Meshingly runs on this computer";
  }
}

/** Where this project's settings are kept: under the user's home (MESHINGLY_HOME overrides it, for tests), keyed by the project's path. */
export function settingsPath(root        )         {
  // The same folder must give the same file however it was spelled (c:\dev vs C:\Dev, a symlink): otherwise a setting
  // made from one shell would be silently ignored by a server started from another.
  let real = resolve(root);
  try {
    real = realpathSync.native(real);
  } catch {
    /* the folder does not exist (yet): use the path as given */
  }
  const key = createHash("sha256").update(process.platform === "win32" ? real.toLowerCase() : real).digest("hex").slice(0, 16);
  return join(process.env.MESHINGLY_HOME ?? join(homedir(), ".meshingly"), "projects", `${key}.json`);
}
const file = settingsPath;

/** Turns text into a valid value for the setting, or says why not. */
export function parseSetting(key                , raw         )                                                                                {
  const { kind } = SETTING_INFO[key];
  const text = typeof raw === "string" ? raw.trim() : raw;
  switch (kind.type) {
    case "boolean": {
      if (typeof text === "boolean") return { ok: true, value: text };
      const t = String(text).toLowerCase();
      if (["true", "on", "yes", "1"].includes(t)) return { ok: true, value: true };
      if (["false", "off", "no", "0"].includes(t)) return { ok: true, value: false };
      return { ok: false, reason: "use true or false" };
    }
    case "enum":
      return typeof text === "string" && kind.values.includes(text) ? { ok: true, value: text } : { ok: false, reason: `use one of: ${kind.values.join(", ")}` };
    case "int": {
      // Not Number(): it turns "", true and [3] into numbers, and a malformed value must never become a valid setting.
      const n = typeof text === "number" ? text : typeof text === "string" && /^-?\d+$/.test(text) ? Number(text) : Number.NaN;
      return Number.isInteger(n) && n >= kind.min && n <= kind.max ? { ok: true, value: n } : { ok: false, reason: `use a whole number from ${kind.min} to ${kind.max}` };
    }
    case "string":
      return typeof text === "string" && text.length > 0 && text.length <= 300 && !/[\r\n]/.test(text) ? { ok: true, value: text } : { ok: false, reason: "use a single line of 1 to 300 characters" };
  }
}

                           
                   
                                                                                                     
                                                                      
                                                                          
                   
 

export function resolveSettings(root        , env                    = process.env)           {
  const values = Object.fromEntries(SETTING_KEYS.map((k) => [k, SETTING_INFO[k].default]))                       ;
  const sources = Object.fromEntries(SETTING_KEYS.map((k) => [k, "default"]))                       ;
  let problem                    ;

  if (existsSync(file(root))) {
    try {
      const stored = JSON.parse(readFileSync(file(root), "utf8"))                           ;
      for (const k of SETTING_KEYS) {
        if (!(k in stored)) continue;
        const parsed = parseSetting(k, stored[k]);
        if (parsed.ok) {
          (values                                      )[k] = parsed.value;
          sources[k] = "file";
        } else {
          problem = `${k} in the settings file is invalid (${parsed.reason}); the default is used`;
        }
      }
    } catch (err) {
      problem = `the settings file could not be read (${err instanceof Error ? err.message : String(err)}); the defaults are used`;
    }
  }
  for (const k of SETTING_KEYS) {
    const name = SETTING_INFO[k].env;
    const raw = name ? env[name] : undefined;
    if (!name || raw === undefined || raw === "") continue;
    const parsed = parseSetting(k, raw);
    if (parsed.ok) {
      (values                                      )[k] = parsed.value;
      sources[k] = "environment";
    }
  }
  return { values, sources, ...(problem ? { problem } : {}) };
}

/** Writes one setting to the project's settings file. Throws an Error whose message says what is wrong. */
export function writeSetting(root        , key        , raw        )           {
  return writeSettings(root, { [key]: raw });
}

/** Writes several settings in one go: all are checked first, then saved with a single rename, so a failure leaves none of them half applied. */
export function writeSettings(root        , entries                        )           {
  const checked                                                    = [];
  for (const [key, raw] of Object.entries(entries)) {
    if (!SETTING_KEYS.includes(key                  )) throw new Error(`Unknown setting "${key}". Settings: ${SETTING_KEYS.join(", ")}.`);
    const k = key                  ;
    const parsed = parseSetting(k, raw);
    if (!parsed.ok) throw new Error(`${k}: ${parsed.reason}.`);
    checked.push([k, parsed.value]);
  }
  let stored                          = {};
  try {
    if (existsSync(file(root))) stored = JSON.parse(readFileSync(file(root), "utf8"))                           ;
  } catch {
    stored = {}; // a broken file is replaced, not extended
  }
  for (const [k, value] of checked) stored[k] = value;
  mkdirSync(dirname(file(root)), { recursive: true });
  const tmp = `${file(root)}.tmp`;
  writeFileSync(tmp, JSON.stringify(stored, null, 2), { mode: 0o600 });
  renameSync(tmp, file(root));
  return resolveSettings(root).values;
}

export function resetSettings(root        )       {
  rmSync(file(root), { force: true });
}

export function describeSettings(root        , env                    = process.env)         {
  const { values, sources, problem } = resolveSettings(root, env);
  const lines = SETTING_KEYS.map((k) => `${k.padEnd(21)} ${String(values[k]).padEnd(12)} ${sources[k] === "default" ? "(default)" : `(${sources[k]})`}  ${SETTING_INFO[k].description}`);
  lines.push("", `File: ${settingsPath(root)}`);
  if (problem) lines.push(`Note: ${problem}.`);
  return lines.join("\n");
}

/** What a session is told about the journal. Empty when it is off. */
export function journalPolicy(level                     )         {
  if (level === "off") return "";
  const when =
    level === "detailed"
      ? "after each step you take (what you changed, which files, what you decided and why, what comes next)"
      : "after each milestone you finish (a feature done, a bug found or fixed, a decision made, what comes next)";
  return `The user turned the journal on (${level}): ${when}, call meshingly_journal with one to three sentences. The other sessions in this collaboration, including your own later ones on other computers, read these notes to know what happened here, and everyone in the collaboration can read them. Never put secrets in a note. Give each note a short topic, the files you touched (files), and decision=true when it records a decision: the map of the collaboration is built from them, so later sessions read a short map instead of the whole record.`;
}

/** Appended to the prompt of an unattended run. */
export function questionPolicy(onQuestion                        )         {
  if (onQuestion === "stop") {
    return "Nobody is at the keyboard. If you need an answer from the user to go on, do not guess: call meshingly_handoff with needsPerson=true, the question and what you have done so far, then stop.";
  }
  return [
    "Nobody is at the keyboard, and the user chose that you carry on instead of waiting.",
    "When you would ask the user to choose, take the option you would recommend, write down the assumption you made, and continue. Put every such assumption in your final summary and in meshingly_done.",
    "Exception: never decide for the user anything that deletes data, spends money, publishes, pushes, or contacts other people. For those, call meshingly_handoff with needsPerson=true, the question and what you have done so far, then stop.",
  ].join(" ");
}
