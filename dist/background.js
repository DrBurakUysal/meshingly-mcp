import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveSettings } from "./settings.js";

const MAX_LOG_BYTES = 1_000_000;
/** The watcher process writes a heartbeat this often; a pid alone is not proof that the process is still our watcher. */
export const BEAT_MS = 30_000;
const BEAT_STALE_MS = 5 * 60_000;
const START_GRACE_MS = 30_000;

                         
              
                    
                  
                     
 

                               
                   
                         
                  
 

const dir = (root        ) => join(root, ".meshingly");
const recordFile = (root        ) => join(dir(root), "watch.json");
const beatFile = (root        ) => join(dir(root), "watch.beat");
const logFile = (root        ) => join(dir(root), "watch.log");
const lockFile = (root        ) => join(dir(root), "watch.lock");
export const stateFile = (root        ) => join(dir(root), "watch-state.json");

/** The handoff a watcher was running when it stopped (killed, crashed): the caller gives it back. */
export function takeCurrentRun(root        )                     {
  try {
    if (!existsSync(stateFile(root))) return undefined;
    const raw = JSON.parse(readFileSync(stateFile(root), "utf8"))                           ;
    if (typeof raw.current !== "string") return undefined;
    const id = raw.current;
    delete raw.current;
    writeFileSync(stateFile(root), JSON.stringify(raw));
    return id;
  } catch {
    return undefined;
  }
}

export function writeBeat(root        )       {
  try {
    mkdirSync(dir(root), { recursive: true });
    writeFileSync(beatFile(root), String(Date.now()));
  } catch {
    /* a missed beat only makes the watcher look stale for a moment */
  }
}

export function clearBeat(root        )       {
  rmSync(beatFile(root), { force: true });
}

function alive(pid        )          {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but is not ours to signal.
    return (err                         ).code === "EPERM";
  }
}

/** Ends a process and everything it started: with `shell: true` the pid is the shell's, and a plain kill would leave the agent running. */
export function killTree(pid        )       {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  // Children are started detached (their own process group), so the negative pid reaches the whole group.
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGTERM");
      return;
    } catch {
      /* try the single process, then give up: it is already gone */
    }
  }
}

/**
 * A watcher counts as running only when its pid is alive AND it has a fresh heartbeat (or has only just been started).
 * After a crash or a reboot the pid may belong to an unrelated process; without the heartbeat check Meshingly would
 * refuse to start a new watcher and, worse, stop would kill a stranger.
 */
export function watcherState(root        )               {
  const file = recordFile(root);
  if (!existsSync(file)) return { running: false, logFile: logFile(root) };
  try {
    const record = JSON.parse(readFileSync(file, "utf8"))                 ;
    if (!alive(record.pid)) return { running: false, record, logFile: logFile(root) };
    const now = Date.now();
    const beat = existsSync(beatFile(root)) ? now - statSync(beatFile(root)).mtimeMs : Infinity;
    const young = now - Date.parse(record.startedAt) < START_GRACE_MS;
    return { running: beat < BEAT_STALE_MS || young, record, logFile: logFile(root) };
  } catch {
    return { running: false, logFile: logFile(root) };
  }
}

/** Starts `meshingly-mcp watch` detached, so it keeps running after this session (and its MCP server) ended. */
export function startWatcher(root        , entry        )         {
  const state = watcherState(root);
  if (state.running) return `The watcher is already running (pid ${state.record .pid}, since ${state.record .startedAt}). Log: ${state.logFile}`;
  if (!entry || !existsSync(entry)) throw new Error("cannot find the script that starts the watcher");

  // Two servers starting together (two sessions in one project) must not both start a watcher: one would be orphaned.
  mkdirSync(dir(root), { recursive: true });
  let lock        ;
  try {
    lock = openSync(lockFile(root), "wx");
  } catch {
    if (existsSync(lockFile(root)) && Date.now() - statSync(lockFile(root)).mtimeMs < 30_000) return "A watcher is being started right now.";
    rmSync(lockFile(root), { force: true }); // left behind by a start that died
    lock = openSync(lockFile(root), "wx");
  }
  try {
    const again = watcherState(root);
    if (again.running) return `The watcher is already running (pid ${again.record .pid}, since ${again.record .startedAt}). Log: ${again.logFile}`;
    return launch(root, entry);
  } finally {
    closeSync(lock);
    rmSync(lockFile(root), { force: true });
  }
}

function launch(root        , entry        )         {

  // The watcher reads the same settings itself; the flags pin what this start saw, so a later edit needs a restart.
  const { resumeCommand: command, trustPeers: fromPeers, onQuestion, maxAttempts, checkIntervalSeconds, settleMinutes } = resolveSettings(root).values;
  mkdirSync(dir(root), { recursive: true });
  writeFileSync(join(dir(root), ".gitignore"), "*\n");
  const log = logFile(root);
  if (existsSync(log) && statSync(log).size > MAX_LOG_BYTES) rmSync(log);
  const fd = openSync(log, "a", 0o600);
  try {
    const args = [
      entry, "watch", "--dir", root, "--cmd", command, "--on-question", onQuestion,
      "--max-attempts", String(maxAttempts), "--interval", String(checkIntervalSeconds), "--settle-minutes", String(settleMinutes),
      ...(fromPeers ? ["--from-peers"] : []),
    ];
    const child = spawn(process.execPath, args, { detached: true, stdio: ["ignore", fd, fd], windowsHide: true, env: process.env });
    // Without a listener a failed spawn would be an uncaught exception that takes the MCP server down with it.
    child.on("error", (err) => console.error(`meshingly: the watcher process failed: ${err.message}`));
    child.unref();
    if (!child.pid) throw new Error("the watcher process did not start");
    const record                = { pid: child.pid, startedAt: new Date().toISOString(), command, fromPeers };
    writeFileSync(recordFile(root), JSON.stringify(record, null, 2), { mode: 0o600 });
  } finally {
    closeSync(fd);
  }
  return [
    `Watcher started. It checks the queue every ${checkIntervalSeconds} s and, once a handoff is ready, runs: ${command}`,
    onQuestion === "recommended" ? "If a run would ask a question it takes the recommended option and notes the assumption." : "If a run would need an answer it parks the question for a person.",
    fromPeers ? "It also runs handoffs written by other sessions (trustPeers)." : "It runs only handoffs written by this project's own session.",
    `It keeps running after this session ends, for as long as this computer is on. Log: ${log}. Stop it with meshingly_watch_stop. Settings: meshingly_settings.`,
  ].join("\n");
}

export function stopWatcher(root        )         {
  const state = watcherState(root);
  rmSync(recordFile(root), { force: true });
  if (!state.running || !state.record) {
    clearBeat(root);
    return "No watcher is running.";
  }
  const { pid } = state.record;
  killTree(pid);
  clearBeat(root);
  return `Watcher stopped (pid ${pid}).`;
}

export function describeWatcher(root        )         {
  const s = watcherState(root);
  if (!s.running || !s.record) return "No watcher is running.";
  return `Watcher running (pid ${s.record.pid}, since ${s.record.startedAt}), command: ${s.record.command}${s.record.fromPeers ? ", also for peers' handoffs" : ", own handoffs only"}. Log: ${s.logFile}`;
}
