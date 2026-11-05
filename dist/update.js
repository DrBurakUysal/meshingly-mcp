import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The only thing this does is read the public version number of the package from npm, at most once a day, and only when
 * the user has not switched `updateCheck` off. It sends nothing about the user (the request is a plain GET), and it never
 * installs anything: replacing code that runs on the user's computer, in the middle of a session, is the user's call.
 */
export const DEFAULT_UPDATE_URL = "https://registry.npmjs.org/meshingly-mcp/latest";
const CHECK_EVERY_MS = 24 * 3600_000;
/** After a failed lookup (offline, npm down) the next try is an hour later, not on every start. */
const RETRY_AFTER_FAILURE_MS = 3600_000;
const TIMEOUT_MS = 3000;

export function parseVersion(version        )                                       {
  const m = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** Plain x.y.z only: a prerelease or anything unreadable is never offered as an update. */
export function isNewer(latest        , current        )          {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]  > b[i] ;
  return false;
}

                 
                    
                                                                                                            
               
                  
 

const cacheFile = ()         => join(process.env.MESHINGLY_HOME ?? join(homedir(), ".meshingly"), "update-check.json");

function readCache(url        )                    {
  try {
    if (!existsSync(cacheFile())) return undefined;
    const raw = JSON.parse(readFileSync(cacheFile(), "utf8"))                  ;
    if (raw.url !== url) return undefined;
    return typeof raw.checkedAt === "number" ? { checkedAt: raw.checkedAt, ...(typeof raw.latest === "string" && parseVersion(raw.latest) ? { latest: raw.latest } : {}) } : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(cache       )       {
  try {
    mkdirSync(dirname(cacheFile()), { recursive: true });
    const tmp = `${cacheFile()}.tmp`;
    writeFileSync(tmp, JSON.stringify(cache));
    renameSync(tmp, cacheFile());
  } catch {
    /* an unwritable home folder only means asking again next time */
  }
}

/** The newest published version, from the cache when it is less than a day old. Never throws. */
export async function latestVersion(opts                                                           = {})                              {
  const now = opts.now ?? Date.now();
  const url = opts.url ?? process.env.MESHINGLY_UPDATE_URL ?? DEFAULT_UPDATE_URL;
  const cached = readCache(url);
  // A time in the future (the clock was wrong when it was written) is stale, not fresh forever.
  const age = cached ? now - cached.checkedAt : -1;
  if (cached && age >= 0 && age < CHECK_EVERY_MS) return cached.latest;
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`npm answered ${res.status}`);
    const version = ((await res.json())                         ).version;
    if (typeof version !== "string" || !parseVersion(version)) throw new Error("unreadable answer");
    writeCache({ checkedAt: now, url, latest: version });
    return version;
  } catch {
    // Remember the failure, and keep the last good answer, so an offline machine does not wait three seconds on every start.
    writeCache({ checkedAt: now - CHECK_EVERY_MS + RETRY_AFTER_FAILURE_MS, url, ...(cached?.latest ? { latest: cached.latest } : {}) });
    return cached?.latest;
  }
}

                                                       

/** How this copy was installed, judged by where it runs from. Only used to say how to update it. */
export function installMethod(path = fileURLToPath(import.meta.url), env                    = process.env)                {
  const p = path.replaceAll("\\", "/");
  if (env.CLAUDE_PLUGIN_ROOT || p.includes("/plugins/cache/")) return "plugin";
  if (p.includes("/_npx/")) return "npx";
  return "other";
}

/** Shown until the user has decided: no request to npm is made before they answer. Written for the model to ask in the user's language. */
export function updateQuestion()         {
  return [
    "The user has not decided yet whether Meshingly may look for updates. Ask them once, briefly, in their own language:",
    "once a day the MCP would ask npm (a service in the United States) what the newest version is; the request carries this computer's IP address and nothing else, and nothing is ever installed automatically. Do they want that check?",
    'Save their answer with meshingly_settings: {"settings":{"updateCheck":true}} for yes, {"settings":{"updateCheck":false}} for no. Until they answer, no request is made. Do not answer for them.',
  ].join(" ");
}

/** What the status tells the model, written for the model to pass on to the user. */
export function updateNotice(current        , latest        , method               )         {
  const how =
    method === "plugin"
      ? "To update, they run these two commands in a terminal, then restart Claude Code: claude plugin marketplace update meshingly   and   claude plugin update meshingly@meshingly (if the second says it is already up to date, the plugin copy has not been rebuilt for this version yet: they can try again later)"
      : method === "npx"
        ? "To update, make sure the MCP command ends in meshingly-mcp@latest (npx -y meshingly-mcp@latest), then restart the session"
        : "To update, they reinstall the way they installed it (npx -y meshingly-mcp@latest, or the plugin), then restart the session";
  return [
    `A newer version of the Meshingly MCP is available (${current} → ${latest}). Tell the user once, briefly. ${how}.`,
    "Do not run the update yourself unless the user says to. They can turn this notice off with the updateCheck setting.",
  ].join(" ");
}
