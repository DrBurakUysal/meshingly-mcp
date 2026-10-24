import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateSigningKeys,                  } from "./crypto.js";

                              
                    
                   
                                                       
                       
                              
                          
 

                               
                    
               
                                                        
                 
                    
                           
                                                                                                   
                                
                                                                                 
                                     
                                                       
                
                                                                                                   
                
 

                           
               
               
               
 

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadConfig(env                    = process.env)              {
  const file = join(SKILL_DIR, "meshingly.config.json");
  const fromFile                       = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const cryptKey = env.MESHINGLY_KEY ?? fromFile.cryptKey;
  const serverUrl = env.MESHINGLY_URL ?? fromFile.serverUrl;
  if (!cryptKey || !serverUrl) {
    throw new Error("Missing cryptKey/serverUrl: re-download the skill from the Meshingly web app or set MESHINGLY_KEY and MESHINGLY_URL");
  }
  return {
    cryptKey,
    serverUrl,
    projectName: fromFile.projectName,
    pollIntervalSeconds: Number(env.MESHINGLY_POLL_SECONDS ?? fromFile.pollIntervalSeconds ?? 60),
    longPollSeconds: Number(env.MESHINGLY_LONGPOLL_SECONDS ?? fromFile.longPollSeconds ?? 0),
  };
}

const stateDir = (cwd        ) => join(cwd, ".meshingly");
const stateFile = (cwd        , role        ) => join(stateDir(cwd), `${role.replace(/[^\w-]/g, "_")}.json`);

/** Loads the session for `role`, assigning a new Session ID on first use. */
export function loadOrCreateSession(role        , cwd = process.cwd())               {
  const file = stateFile(cwd, role);
  if (existsSync(file)) {
    const session = JSON.parse(readFileSync(file, "utf8"))                                        ;
    // State files written before signing existed get keys on first load.
    if (!session.signingKeys || !session.peers || !session.peerInfo) {
      session.signingKeys ??= generateSigningKeys();
      session.peers ??= {};
      session.peerInfo ??= {};
      saveSession(session, cwd);
    }
    return session;
  }
  const session               = {
    sessionId: randomUUID(),
    role,
    cursor: 0,
    createdAt: new Date().toISOString(),
    signingKeys: generateSigningKeys(),
    peers: {},
    peerInfo: {},
  };
  saveSession(session, cwd);
  return session;
}

export function saveSession(session              , cwd = process.cwd())       {
  mkdirSync(stateDir(cwd), { recursive: true });
  const file = stateFile(cwd, session.role);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(session, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}
