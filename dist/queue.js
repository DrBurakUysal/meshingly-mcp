                                                          

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

                          
             
              
                        
                
                                                                                                  
               
                                                                                                           
                 
                                                   
                    
                                                                                                        
                    
                                                                         
                        
                                      
                              
                     
 

/** Time of a message by the relay's clock, which all participants share; the sender's clock only when the relay's is missing. */
const at = (m                 )         => (typeof m.createdAt === "number" ? m.createdAt : Date.parse(m.payload.sentAt));

/**
 * Derives the queue from the collaboration's message history, so nothing is stored on the relay beyond the
 * encrypted messages themselves. Rules:
 * - a "claim" message names a handoff; the earliest live claim (lowest broker sequence number) owns it;
 * - a claim older than LEASE_MS (by the relay's clock) lapses, which frees the work again if its owner never finished;
 * - the owner can "release" a claim at once;
 * - "done" counts only when it comes from the current owner.
 */
export function buildQueue(messages                   , now        )            {
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
    } else if (m.payload.type === "claim" || m.payload.type === "release" || m.payload.type === "done") {
      const target = m.payload.meta?.handoff;
      if (typeof target === "string") about.set(target, [...(about.get(target) ?? []), m]);
    }
  }

  for (const [id, h] of handoffs) {
    const mine = about.get(id) ?? [];
    const finished = (claim                 )          =>
      mine.some((m) => m.payload.type === "done" && m.senderSessionId === claim.senderSessionId && m.seq > claim.seq);
    const leased = (m                 )          => {
      const age = now - at(m);
      return age > -CLOCK_SKEW_MS && age < LEASE_MS;
    };
    // The owner can give the work back ("release") instead of making everyone wait for the lease to run out.
    const released = (claim                 )          =>
      mine.some((m) => m.payload.type === "release" && m.senderSessionId === claim.senderSessionId && m.seq > claim.seq);
    const owner = mine.find((m) => m.payload.type === "claim" && (finished(m) || (leased(m) && !released(m))));
    if (!owner) continue;
    h.status = finished(owner) ? "done" : "claimed";
    h.claimedBySessionId = owner.senderSessionId;
    h.claimedAt = owner.payload.sentAt;
  }
  return [...handoffs.values()];
}
