                                                          

/** A claim that is older than this without a "done" is treated as abandoned, and the handoff is open again. */
export const LEASE_MS = 2 * 3600 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
/** The relay keeps messages for seven days, so a "limit is back" time further out than that is not believable. */
const MAX_RESET_AHEAD_MS = 7 * 24 * 3600 * 1000;

/** The first `max` UTF-16 units of `text`, never ending in half of an emoji (a lone surrogate is not valid text). */
export function cut(text        , max        )         {
  const part = text.slice(0, max);
  const last = part.charCodeAt(part.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? part.slice(0, -1) : part;
}

/** One line of plain text: peers write titles and names, and a newline in one could pose as a new instruction. */
export function clean(text        , max        )         {
  return cut(text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim(), max);
}

/** Plain text that may span lines (the result of a run, shown on the phone): control characters go, line breaks stay, blank runs collapse. */
export function cleanBlock(text        , max        )         {
  return cut(
    text
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    max,
  );
}

/** A prompt from a paired phone or app that nobody has taken within this long is dropped: an old instruction must not start an agent days later. */
export const PROMPT_TTL_MS = 24 * 3600 * 1000;
/**
 * The relay's clock says when a prompt arrived; the owner's signed `sentAt` says when it was written. A member of the
 * collaboration can re-send an old signed prompt under its old id once the relay has forgotten the original (after a week),
 * and the relay's clock would call it new. So the signed time must be close to the relay's: a replay is not.
 */
export const PROMPT_SENT_SKEW_MS = 15 * 60 * 1000;
const NO_OWNERS                      = new Set();

/** Whether a prompt's `to` names this computer: `any`, this session's id, or `device:<name>` with this session's device name. */
export function meantForHere(to                    , device                    , self        )          {
  if (!to || to === "any" || to === self) return true;
  return to.startsWith("device:") && device !== undefined && device.toLowerCase() === to.slice(7).trim().toLowerCase();
}

                          
             
              
                        
                
                                                                                                  
               
                                                                                                           
                 
                                                   
                    
                                                                                                        
                    
                                                                         
                        
                                                                                                                                              
                      
                                                                     
              
                                                                                                          
                    
                                                                                                                                   
                            
                                      
                              
                     
 

/** Time of a message by the relay's clock, which all participants share; the sender's clock only when the relay's is missing. */
export const at = (m                 )         => (typeof m.createdAt === "number" ? m.createdAt : Date.parse(m.payload.sentAt));

/**
 * Derives the queue from the collaboration's message history, so nothing is stored on the relay beyond the
 * encrypted messages themselves. Rules:
 * - a "claim" message names a handoff; the earliest live claim (lowest broker sequence number) owns it;
 * - a claim older than LEASE_MS (by the relay's clock) lapses, which frees the work again if its owner never finished;
 * - the owner can "release" a claim at once;
 * - "done" counts only when it comes from the current owner.
 */
/** Who a claim, release or done message speaks for: the session AND the process in it (a watcher and a live session share one session id). */
const holder = (m                 )         => `${m.senderSessionId}|${m.payload.meta?.claimer ?? ""}`;

/**
 * `deviceOf` names the computer a session said it runs on. A prompt aimed at one computer can only be claimed from it
 * (otherwise any member could claim or finish the user's prompt and keep it from running); a prompt for `any` computer can be taken by any.
 */
export function buildQueue(
  messages                   ,
  now        ,
  owners                      = NO_OWNERS,
  deviceOf                                            = () => undefined,
)            {
  const sorted = [...messages].sort((a, b) => a.seq - b.seq);
  const handoffs = new Map                 ();
  const about = new Map                           ();
  for (const m of sorted) {
    if (m.payload.type === "handoff") {
      const meta = m.payload.meta ?? {};
      const reset = Date.parse(meta.resetsAt ?? "");
      handoffs.set(m.id, {
        id: m.id,
        seq: m.seq,
        fromSessionId: m.senderSessionId,
        title: clean(String(meta.title ?? ""), 120) || "Untitled",
        body: m.payload.body,
        sentAt: m.payload.sentAt,
        createdAt: at(m),
        ...(Number.isFinite(reset) ? { resetsAt: new Date(Math.min(reset, at(m) + MAX_RESET_AHEAD_MS)).toISOString() } : {}),
        ...(meta.needsPerson === "1" ? { needsPerson: true } : {}),
        status: "open",
      });
    } else if (m.payload.type === "prompt" && m.senderKey !== undefined && owners.has(m.senderKey)) {
      const sent = Date.parse(m.payload.sentAt);
      if (!Number.isFinite(sent) || at(m) - sent > PROMPT_SENT_SKEW_MS) continue; // written long before it arrived: a replay (or a clock that is far off)
      const meta = m.payload.meta ?? {};
      handoffs.set(m.id, {
        id: m.id,
        seq: m.seq,
        fromSessionId: m.senderSessionId,
        title: clean(m.payload.body.split("\n")[0] ?? "", 80) || "Prompt",
        body: m.payload.body,
        sentAt: m.payload.sentAt,
        createdAt: at(m),
        fromOwner: true,
        to: clean(meta.to ?? "any", 80) || "any",
        promptId: clean(meta.promptId ?? m.id, 80) || m.id,
        status: "open",
      });
    } else if (m.payload.type === "claim" || m.payload.type === "release" || m.payload.type === "done") {
      const target = m.payload.meta?.handoff;
      if (typeof target === "string") about.set(target, [...(about.get(target) ?? []), m]);
    }
  }

  const stale = new Set        ();
  for (const [id, h] of handoffs) {
    const everything = about.get(id) ?? [];
    const claimAllowed = (m                 )          => {
      if (!h.fromOwner || m.payload.type !== "claim") return true;
      const to = h.to ?? "any";
      if (to === "any") return true;
      if (to.startsWith("device:")) return deviceOf(m.senderSessionId)?.toLowerCase() === to.slice(7).trim().toLowerCase();
      return m.senderSessionId === to;
    };
    const mine = everything.filter(claimAllowed);
    const finished = (claim                 )          =>
      mine.some((m) => m.payload.type === "done" && holder(m) === holder(claim) && m.seq > claim.seq);
    const leased = (m                 )          => {
      const age = now - at(m);
      return age > -CLOCK_SKEW_MS && age < LEASE_MS;
    };
    // The owner can give the work back ("release") instead of making everyone wait for the lease to run out.
    const released = (claim                 )          =>
      mine.some((m) => m.payload.type === "release" && holder(m) === holder(claim) && m.seq > claim.seq);
    const owner = mine.find((m) => m.payload.type === "claim" && (finished(m) || (leased(m) && !released(m))));
    if (!owner) {
      // The user's prompt was taken and the taker neither finished nor gave it back: it may well have run. Reopening it would run it a second time.
      if (h.fromOwner && mine.some((m) => m.payload.type === "claim" && !finished(m) && !released(m) && !leased(m))) stale.add(id);
      continue;
    }
    h.status = finished(owner) ? "done" : "claimed";
    h.claimedBySessionId = owner.senderSessionId;
    h.claimedByClaimer = owner.payload.meta?.claimer ?? "";
    h.claimedAt = owner.payload.sentAt;
  }
  return [...handoffs.values()].filter((h) => !stale.has(h.id) && !(h.fromOwner && h.status === "open" && now - h.createdAt > PROMPT_TTL_MS));
}
