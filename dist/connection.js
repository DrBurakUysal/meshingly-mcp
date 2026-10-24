import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CollabError, createCollaboration, formatCode, joinCollaboration } from "./lib/collab.js";
import { loadOrCreateSession, saveSession,                                     } from "./lib/config.js";
import { formatAsPrompt } from "./lib/listener.js";
import { Messenger } from "./lib/messenger.js";

export const DEFAULT_SERVER = "https://api.meshingly.com";
const MAX_WAIT_SECONDS = 25;

/** Everything needed to rejoin the collaboration. Holds the crypt key, so it never leaves `.meshingly/`. */
                             
                    
                   
                        
               
               
               
               
 

                           
                                                 
                    
                                                                                  
                
                                                                                   
                
 

/** Tool failures the model can act on: the message says what to tell the user. */
export class ToolError extends Error {}

export class Meshingly {
                   root        ;
                   serverUrl        ;

  constructor(root = process.env.MESHINGLY_DIR ?? process.cwd(), serverUrl = process.env.MESHINGLY_URL ?? DEFAULT_SERVER) {
    this.root = root;
    this.serverUrl = serverUrl;
  }

          get file()         {
    return join(this.root, ".meshingly", "connection.json");
  }

          load()                         {
    return existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8"))              ) : undefined;
  }

          save(c            )       {
    const dir = join(this.root, ".meshingly");
    mkdirSync(dir, { recursive: true });
    // The directory ignores itself, so the key cannot be committed even if .gitignore is forgotten.
    writeFileSync(join(dir, ".gitignore"), "*\n");
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

          require()                                                                    {
    const conn = this.load();
    if (!conn) {
      throw new ToolError(
        "Not connected to a collaboration. Ask the user: start a new collaboration from scratch, or join an existing one with a code and password?",
      );
    }
    const session = loadOrCreateSession(conn.role, this.root);
    const config              = { serverUrl: conn.serverUrl, cryptKey: conn.cryptKey, projectName: conn.collaboration, pollIntervalSeconds: 60, longPollSeconds: 0 };
    return { conn, session, messenger: new Messenger(config, session) };
  }

          identity(id          )                                             {
    const role = (id.role ?? "default").trim() || "default";
    const tool = (id.tool ?? process.env.MESHINGLY_TOOL ?? (process.env.CLAUDECODE ? "claude-code" : "unknown")).trim();
    return { role, name: (id.yourName ?? role).trim() || role, tool };
  }

  /** Stores the connection, gives this session its identity and tells the peers it arrived. */
          async connect(c            )                  {
    this.save(c);
    const { session, messenger } = this.require();
    session.name = c.name;
    session.tool = c.tool;
    saveSession(session, this.root);
    try {
      await messenger.hello();
      return "";
    } catch (err) {
      return ` (could not announce to peers yet: ${err instanceof Error ? err.message : String(err)})`;
    }
  }

          refuseIfConnected(replace          )       {
    const existing = this.load();
    if (existing && !replace) {
      throw new ToolError(
        `This project is already connected to "${existing.collaboration}" (code ${formatCode(existing.code)}). Ask the user whether to replace it; if yes, call again with replace=true.`,
      );
    }
  }

  status()         {
    const conn = this.load();
    if (!conn) {
      return "Not connected. Ask the user: start a new collaboration from scratch, or join an existing one with a code and password?";
    }
    return `Connected to "${conn.collaboration}" (code ${formatCode(conn.code)}) as ${conn.name} (${conn.tool}, role ${conn.role}).`;
  }

  async create(args                                                )                  {
    this.refuseIfConnected(args.replace);
    const name = args.name.trim();
    if (!name) throw new ToolError("A collaboration needs a name.");
    const created = await this.wrapErrors(() => createCollaboration(this.serverUrl, name));
    const note = await this.connect({
      serverUrl: this.serverUrl,
      cryptKey: created.bundle.key,
      collaboration: name,
      code: created.code,
      ...this.identity(args),
    });
    return [
      `Collaboration "${name}" created and this session is connected${note}.`,
      "",
      `Code:     ${formatCode(created.code)}`,
      `Password: ${created.password}`,
      "",
      "Show the code and the password to the user exactly as written, and tell them: the password is displayed only once and nobody, not even Meshingly, can recover it, so they should save it now.",
      "Teammates connect by telling their own AI agent: go to https://meshingly.com/install.md, join the collaboration with this code and this password.",
    ].join("\n");
  }

  async join(args                                                                  )                  {
    this.refuseIfConnected(args.replace);
    const bundle = await this.wrapErrors(() => joinCollaboration(this.serverUrl, args.code, args.password));
    const code = args.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const note = await this.connect({ serverUrl: this.serverUrl, cryptKey: bundle.key, collaboration: bundle.name, code, ...this.identity(args) });
    const peers = await this.require().messenger.peers().catch(() => []);
    return [
      `Joined "${bundle.name}"${note}.`,
      peers.length ? `Already here: ${peers.map((p) => `${p.name} (${p.tool}, ${p.role})`).join(", ")}.` : "Nobody else has announced themselves yet.",
    ].join("\n");
  }

  async peers()                  {
    const { messenger } = this.require();
    const peers = await messenger.peers();
    if (!peers.length) return "No other session has announced itself yet.";
    return peers.map((p) => `- ${p.name} (${p.tool}, role ${p.role}), last announced ${p.seenAt}`).join("\n");
  }

  async send(args                                 )                  {
    const { messenger, session } = this.require();
    if (!args.text.trim()) throw new ToolError("Nothing to send.");
    const { id } = await messenger.send(args.type?.trim() || "message", args.text);
    saveSession(session, this.root);
    return `Sent (id ${id}).`;
  }

  /** Returns new peer messages, framed as untrusted input. With waitSeconds it holds the request open until something arrives. */
  async receive(args                          )                  {
    const { messenger, session } = this.require();
    const wait = Math.min(MAX_WAIT_SECONDS, Math.max(0, Math.floor(args.waitSeconds ?? 0)));
    const skipped           = [];
    const { messages, nextCursor } = await messenger.receive(session.cursor, (wire, reason) => skipped.push(`${wire.id}: ${reason}`), wait);
    // Cursor moves only now that the messages are in hand, so a failed call re-delivers instead of dropping.
    session.cursor = Math.max(session.cursor, nextCursor);
    saveSession(session, this.root);

    const out = messages.map((m) =>
      m.payload.type === "hello"
        ? `[${m.sender ? `${m.sender.name} (${m.sender.tool}, ${m.sender.role})` : m.senderSessionId} joined the collaboration]`
        : formatAsPrompt(m),
    );
    if (skipped.length) out.push(`[${skipped.length} message(s) could not be verified or decrypted and were ignored]`);
    return out.length ? out.join("\n\n") : "No new messages.";
  }

          async wrapErrors   (run                  )             {
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof CollabError)) throw err;
      const left = Number(err.data.attemptsLeft ?? 0);
      const messages                                      = {
        network: `Could not reach ${this.serverUrl}. Check the connection and try again.`,
        codeFormat: "The code has 10 characters, like ABCDE-FGHJK. Ask the user to check it.",
        notFound: "No collaboration exists with that code. Ask the user to check it.",
        wrong: `The password is wrong; ${left} attempt(s) left before the code locks for 15 minutes. Ask the user to check it.`,
        locked: "Too many wrong passwords: this code is locked for 15 minutes.",
        taken: "Could not allocate a unique code. Try again.",
        server: `The Meshingly service failed (${err.status}). Try again in a moment.`,
        skillMissing: "Unexpected error.",
      };
      throw new ToolError(messages[err.kind]);
    }
  }
}
