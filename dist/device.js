import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The name of this computer when the user gave none: `#` and four letters or digits, made once and kept in the user's
 * home. It is not the host name (that often holds a real name or an employer) and it does not depend on the session id,
 * so a prompt the app aimed at this computer still finds the session running here after a new session id was made.
 */
let cached                    ;

export function machineDevice()         {
  if (cached) return cached;
  cached = read();
  return cached;
}

function read()         {
  const dir = process.env.MESHINGLY_HOME ?? join(homedir(), ".meshingly");
  const file = join(dir, "device");
  try {
    if (existsSync(file)) {
      const saved = readFileSync(file, "utf8").trim();
      if (/^#[0-9a-f]{4}$/.test(saved)) return saved;
    }
  } catch {
    /* made again below */
  }
  const made = `#${randomBytes(2).toString("hex")}`;
  try {
    mkdirSync(dir, { recursive: true });
    // Exclusive: when two sessions start together on a new machine, the first one's name wins for both.
    writeFileSync(file, made, { mode: 0o600, flag: "wx" });
  } catch {
    try {
      const saved = readFileSync(file, "utf8").trim();
      if (/^#[0-9a-f]{4}$/.test(saved)) return saved;
    } catch {
      /* kept for this run only */
    }
  }
  return made;
}
