import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BEAT_MS, clearBeat, killTree, stateFile, takeCurrentRun, writeBeat } from "./background.js";
import { Meshingly, ToolError } from "./connection.js";
import { LEASE_MS } from "./queue.js";
import { questionPolicy, resolveSettings,               } from "./settings.js";

                               
                                                                                          
                  
                     
                                                                             
                
                                                                              
                     
                                                                              
                                     
                                                             
                      
                                                                                                                  
                   
                                                                                                                 
                   
                                                                                                              
                    
                      
                              
 

const HELP = `meshingly-mcp watch: wakes up an AI session when work is waiting in the Meshingly queue.

Usage: npx -y meshingly-mcp watch [--cmd "claude -p"] [--interval 60] [--once] [--from-peers] [--on-question stop|recommended] [--dir <project>]

It checks the queue; when a handoff is open and its "limit expected back" time has passed (a handoff without one
waits a few minutes, in case its session is still working), it claims the handoff and starts the command with the
handoff as the prompt, in the project directory. If the command succeeds the handoff is marked finished. If it fails
(for example the usage limit is still out) the handoff goes back to the queue and is retried later, up to
--max-attempts times. Handoffs marked as a question for a person are never run.

  --cmd             Command that reads the prompt from stdin. Default: claude -p
                    Add the permissions the work needs yourself, e.g. "claude -p --permission-mode acceptEdits".
  --interval        Seconds between checks. Default 60.
  --once            Check once and exit, so cron or Task Scheduler can run it.
  --from-peers      Also run handoffs written by OTHER sessions. By default only this project's own session is
                    trusted, because a handoff is text that starts an AI agent on your computer: enable this
                    only for a collaboration whose members you trust.
  --on-question     What a run does when it would ask you something: stop (default) or recommended.
  --max-attempts    Default 3.
  --settle-minutes  Default 5.
  --dir             Project directory holding .meshingly/. Default: the current directory.

Every option has a setting that is used when the flag is absent: npx -y meshingly-mcp settings
`;

function sleep(ms        , signal             )                {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Runs the command with the prompt on stdin and resolves with its exit code (124 when it was stopped for running too long). */
function runCommand(command        , prompt        , cwd        , env                   , maxRunMs        , signal             )                  {
  return new Promise((resolve, reject) => {
    // Detached on POSIX: its own process group, so a timeout can end the agent and not just the shell around it.
    const child = spawn(command, { shell: true, cwd, env, stdio: ["pipe", "inherit", "inherit"], detached: process.platform !== "win32" });
    let timedOut = false;
    const stop = () => {
      if (child.pid) killTree(child.pid);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, maxRunMs);
    signal.addEventListener("abort", stop, { once: true });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      resolve(timedOut ? 124 : (code ?? 1));
    });
    // A command that exits before reading its input closes the pipe: that is a failed run, not a crash of the watcher.
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

/** Failed attempts and retry times per handoff, kept on disk: `--once` under cron and every restart would otherwise start from zero. */
                 
                                
                               
                                                                                                            
                   
 

function loadState(root        )        {
  const st        = { attempts: new Map(), retryAt: new Map() };
  try {
    if (!existsSync(stateFile(root))) return st;
    const raw = JSON.parse(readFileSync(stateFile(root), "utf8"))                                                                             ;
    for (const [id, n] of Object.entries(raw.attempts ?? {})) if (typeof n === "number") st.attempts.set(id, n);
    for (const [id, n] of Object.entries(raw.retryAt ?? {})) if (typeof n === "number") st.retryAt.set(id, n);
  } catch {
    /* a damaged file means a fresh start, not a crash */
  }
  return st;
}

/** Writes the state, keeping only handoffs that still exist. */
function saveState(root        , st       , live             )       {
  const pick = (m                     ) => Object.fromEntries([...m].filter(([id]) => live.has(id)));
  try {
    mkdirSync(join(root, ".meshingly"), { recursive: true });
    const tmp = `${stateFile(root)}.tmp`;
    writeFileSync(tmp, JSON.stringify({ attempts: pick(st.attempts), retryAt: pick(st.retryAt), ...(st.current ? { current: st.current } : {}) }));
    renameSync(tmp, stateFile(root));
  } catch {
    /* losing the counters is better than stopping the watcher */
  }
}

/** Looks at the queue once and runs at most one handoff. Returns whether it ran one. */
async function pass(m           , o              , st       , root        )                   {
  const { items, self } = await m.openHandoffs();
  const now = Date.now();
  const known = new Set(items.map((h) => h.id));
  for (const h of items) {
    if (o.signal.aborted) return false;
    if (h.status !== "open") continue; // someone is on it (a live session of this project included)
    if (h.needsPerson) continue; // a question for a human, not work for an agent
    if (!o.fromPeers && h.fromSessionId !== self) continue;
    if ((st.attempts.get(h.id) ?? 0) >= o.maxAttempts) continue;
    if ((st.retryAt.get(h.id) ?? 0) > now) continue;
    if (h.resetsAt) {
      if (Date.parse(h.resetsAt) > now) continue; // the limit is not back yet
    } else if (now - h.createdAt < o.settleMs) {
      continue; // no reset time: the session that parked it may still be working
    }

    let prompt        ;
    try {
      prompt = await m.claim({ id: h.id });
    } catch (err) {
      if (err instanceof ToolError) {
        o.log(`"${h.title}": ${err.message}`);
        continue;
      }
      throw err;
    }
    const attempt = (st.attempts.get(h.id) ?? 0) + 1;
    st.attempts.set(h.id, attempt);
    st.current = h.id;
    saveState(root, st, known);
    o.log(`"${h.title}": claimed, starting the command (attempt ${attempt}/${o.maxAttempts})`);

    const full = `${prompt}\n\nContinue this work in the current project directory. When it is finished, call meshingly_done with handoff id ${h.id}. If you are about to run out of usage again, call meshingly_handoff with the new state and stop.\n\n${questionPolicy(o.onQuestion)}`;
    let code        ;
    try {
      code = await runCommand(o.command, full, root, { ...process.env, MESHINGLY_DIR: root }, o.maxRunMs, o.signal);
    } catch (err) {
      o.log(`"${h.title}": could not start the command: ${err instanceof Error ? err.message : String(err)}`);
      code = 127;
    }
    st.current = undefined;

    // The run may have parked its own continuation (usage ran out again, or it has a question). That new handoff
    // replaces this one, and it inherits the attempt count and waits like a failure would: otherwise it would be
    // picked up at once, with fresh counters, in an endless loop. (A handoff parked meanwhile by the project's own live
    // session looks the same from here: it is only delayed, never lost.)
    const after = await m.openHandoffs();
    const parked = after.items.filter((n) => !known.has(n.id) && n.fromSessionId === self && n.status === "open");
    const wait = o.backoffMs * attempt;
    for (const n of parked) {
      st.attempts.set(n.id, attempt);
      st.retryAt.set(n.id, Date.now() + wait);
      o.log(`"${n.title}": parked by the run; it will not be started before ${new Date(Date.now() + wait).toISOString()}`);
    }
    if (parked.length > 0) {
      // Whatever the exit code, the continuation carries the work forward: handing the original back too would leave two copies.
      await m.done({ id: h.id, summary: "continued in a new handoff" });
      o.log(`"${h.title}": replaced by the handoff the run parked`);
    } else if (code === 0) {
      // The agent normally reports "done" itself; this makes it so when it did not (the call is idempotent).
      await m.done({ id: h.id, summary: "finished by the watcher's run" });
      o.log(`"${h.title}": finished`);
    } else {
      await m.release({ id: h.id });
      st.retryAt.set(h.id, Date.now() + wait);
      o.log(
        attempt >= o.maxAttempts
          ? `"${h.title}": failed (exit ${code}); giving up after ${attempt} attempts, it stays in the queue for a person or another session`
          : `"${h.title}": failed (exit ${code}); back in the queue, next try in ${Math.round(wait / 60000)} min`,
      );
    }
    saveState(root, st, new Set([...known, ...after.items.map((n) => n.id)]));
    return true;
  }
  saveState(root, st, known);
  return false;
}

export async function watch(m           , o              , root        )                {
  // A watcher that was killed in the middle of a run left its claim behind: give it back instead of making everyone wait for the lease.
  const stale = takeCurrentRun(root);
  if (stale) {
    try {
      await m.release({ id: stale });
      o.log(`gave back a handoff that a previous watcher was working on when it stopped`);
    } catch (err) {
      o.log(`could not give back an interrupted handoff: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const st = loadState(root);
  while (!o.signal.aborted) {
    try {
      // Drain what is ready; a failed item waits for its retry time, so this cannot spin.
      while (await pass(m, o, st, root)) {
        /* next item */
      }
    } catch (err) {
      o.log(`check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (o.once) return;
    await sleep(o.intervalMs, o.signal);
  }
}

/** Entry point for `meshingly-mcp watch ...`. Returns the process exit code. */
export async function runWatch(argv          )                  {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        cmd: { type: "string" },
        interval: { type: "string" },
        once: { type: "boolean", default: false },
        "from-peers": { type: "boolean" },
        "on-question": { type: "string" },
        "max-attempts": { type: "string" },
        "settle-minutes": { type: "string" },
        dir: { type: "string" },
        help: { type: "boolean", default: false },
      },
    }));
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n\n${HELP}`);
    return 2;
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const root = values.dir ?? process.env.MESHINGLY_DIR ?? process.cwd();
  // A flag wins; otherwise the setting (which an environment variable in the MCP configuration overrides).
  const saved = resolveSettings(root);
  const interval = values.interval === undefined ? saved.values.checkIntervalSeconds : Number(values.interval);
  const maxAttempts = values["max-attempts"] === undefined ? saved.values.maxAttempts : Number(values["max-attempts"]);
  const settleMinutes = values["settle-minutes"] === undefined ? saved.values.settleMinutes : Number(values["settle-minutes"]);
  const onQuestion = values["on-question"] ?? saved.values.onQuestion;
  const command = values.cmd ?? saved.values.resumeCommand;
  const fromPeers = values["from-peers"] ?? saved.values.trustPeers;
  if (
    !(interval >= 5) ||
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    !(settleMinutes >= 0) ||
    (onQuestion !== "stop" && onQuestion !== "recommended")
  ) {
    console.error(`--interval must be at least 5 seconds, --max-attempts a whole number of 1 or more, --settle-minutes 0 or more and --on-question stop or recommended.\n\n${HELP}`);
    return 2;
  }
  const m = new Meshingly(root);
  const stamp = (line        ) => console.error(`${new Date().toISOString()} meshingly watch: ${line}`);

  if (!m.connected()) {
    console.error("Connect this project first (ask your AI session to set up Meshingly; if .meshingly/connection.json is damaged, delete it), then run the watcher again.");
    return 1;
  }
  console.error(m.status());
  if (saved.problem) stamp(`warning: ${saved.problem}`);
  const abort = new AbortController();
  process.once("SIGINT", () => abort.abort());
  process.once("SIGTERM", () => abort.abort());

  // Proof of life for meshingly_watch_status and stop: a pid alone could be a stranger's after a reboot.
  let beat                            ;
  if (!values.once) {
    writeBeat(root);
    beat = setInterval(() => writeBeat(root), BEAT_MS);
    beat.unref();
  }
  stamp(`watching the queue every ${interval}s with "${command}"${fromPeers ? " (also handoffs from peers)" : " (own handoffs only)"}, on a question: ${onQuestion}`);
  try {
    await watch(
      m,
      {
        command,
        intervalMs: interval * 1000,
        once: values.once === true,
        fromPeers,
        onQuestion,
        maxAttempts,
        settleMs: settleMinutes * 60_000,
        maxRunMs: LEASE_MS - 10 * 60_000,
        backoffMs: 30 * 60_000,
        signal: abort.signal,
        log: stamp,
      },
      root,
    );
  } finally {
    if (beat) clearInterval(beat);
    if (!values.once) clearBeat(root);
  }
  return 0;
}
