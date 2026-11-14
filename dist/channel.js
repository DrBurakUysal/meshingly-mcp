                                                 

/**
 * Claude Code "channels" (a research preview): an MCP server that declares the `claude/channel` capability can push
 * events into a RUNNING session, and relay its permission prompts to another device. This bridge does both for the
 * user's own paired phone or app, and for nobody else:
 *
 * - a prompt from a paired owner device (signature verified against a key the user approved) is pushed into the session
 *   as a channel event; the session takes it with meshingly_claim, so the watcher cannot run it a second time;
 * - a permission request from Claude Code goes to the app as an `approval-request`; the verdict comes back only from a
 *   paired owner device, for a request this bridge issued and that is still open.
 *
 * Claude Code drops channel events silently when the session was not started with the channels flag, so nothing here
 * assumes delivery: an unclaimed prompt simply stays in the queue for the watcher.
 */
                                                                               

const REQUEST_TTL_MS = 15 * 60_000;

export class ChannelBridge {
                   pushed = new Set        ();
                   handled = new Set        ();
  /** Requests this bridge issued: when, the id of the request message and the digest of the text the app was shown. */
                   pending = new Map                                                           ();
          timer                            ;
          busy = false;

                   m           ;
                   notify        ;
                   intervalMs        ;

  constructor(m           , notify        , intervalMs = 4000) {
    this.m = m;
    this.notify = notify;
    this.intervalMs = intervalMs;
  }

  start()       {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop()       {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Claude Code is waiting for an approval: ask the app, in parallel with the dialog in the terminal. */
  async onPermissionRequest(params         )                {
    const p = (params ?? {})                           ;
    const id = typeof p.request_id === "string" ? p.request_id : "";
    if (!/^[a-z]{5}$/.test(id)) return;
    if (!this.m.connected()) return;
    // Nobody paired means nobody to ask: the terminal dialog stays the only way, exactly as without this bridge.
    if ((await this.m.pairedOwners()) === 0) return;
    const tool = typeof p.tool_name === "string" ? p.tool_name : "tool";
    const description = typeof p.description === "string" ? p.description : "";
    const preview = typeof p.input_preview === "string" ? p.input_preview : "";
    const sent = await this.m.sendApprovalRequest({ requestId: id, tool, text: [description, preview].filter(Boolean).join("\n") });
    if (sent) this.pending.set(id, { at: Date.now(), ...sent });
  }

  /** One look at what the app asked for. Safe to call at any time; overlapping calls are skipped. */
  async tick()                {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = Date.now();
      for (const [id, p] of this.pending) if (now - p.at > REQUEST_TTL_MS) this.pending.delete(id);
      const { prompts, answers } = await this.m.ownerEvents();
      for (const h of prompts) {
        if (this.pushed.has(h.id)) continue;
        this.pushed.add(h.id);
        this.notify("notifications/claude/channel", {
          content: h.body,
          meta: { kind: "prompt", message_id: h.id, prompt_id: h.promptId ?? h.id },
        });
      }
      for (const a of answers) {
        if (this.handled.has(a.id)) continue;
        this.handled.add(a.id);
        const issued = this.pending.get(a.requestId);
        // Not one of ours, already answered, or too old. It must name THIS request message and the text that was shown: a request
        // with the same short id written by someone else is a different message, and an answer to it is not an answer to this one.
        // (The relay's clock and this computer's differ a little, hence the two minutes.)
        if (issued === undefined || a.at < issued.at - 120_000) continue;
        if (a.messageId !== issued.messageId || a.digest !== issued.digest) continue;
        this.pending.delete(a.requestId);
        this.notify("notifications/claude/channel/permission", { request_id: a.requestId, behavior: a.behavior });
      }
    } catch (err) {
      if (process.env.MESHINGLY_DEBUG) console.error(`meshingly channel: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.busy = false;
    }
  }
}
