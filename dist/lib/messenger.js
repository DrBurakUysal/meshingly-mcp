import { randomUUID } from "node:crypto";
import { BrokerClient } from "./client.js";
import { buildAad, decrypt, deriveChannel, encrypt, signMessage, verifyMessage } from "./crypto.js";
import { parsePayload, signingInput,                                } from "./protocol.js";
                                                                       

                                  
              
             
                          
                   
                                                                            
                    
 

export class Messenger {
                   channelId        ;
                   client              ;
                   cryptKey        ;

                   session              ;

  constructor(config             , session              , client               ) {
    this.session = session;
    const { channelId, authToken } = deriveChannel(config.cryptKey);
    this.channelId = channelId;
    this.cryptKey = config.cryptKey;
    this.client = client ?? new BrokerClient({ serverUrl: config.serverUrl, channelId, authToken });
  }

  async send(type        , body        , meta                         )                                       {
    const id = randomUUID();
    const payload          = { type, body, meta, sentAt: new Date().toISOString() };
    const aad = buildAad(this.channelId, id, this.session.sessionId);
    const { publicKey, privateKey } = this.session.signingKeys;
    const sig = signMessage(privateKey, signingInput(aad, payload));
    const envelope = encrypt(this.cryptKey, JSON.stringify({ ...payload, pub: publicKey, sig }), aad);
    const { seq } = await this.client.push({ id, senderSessionId: this.session.sessionId, envelope });
    return { id, seq };
  }

  /** Tells the other sessions who this one is. Safe to repeat: peers keep the latest. */
  async hello()                                       {
    const name = this.session.name ?? this.session.role;
    const tool = this.session.tool ?? "unknown";
    return this.send("hello", `${name} (${tool}, ${this.session.role}) joined`, {
      name,
      tool,
      role: this.session.role,
    });
  }

  /** Sessions that have announced themselves in this collaboration (hellos expire with the broker's TTL). */
  async peers()                                                                   {
    const found = new Map                                                          ();
    let cursor = 0;
    for (;;) {
      const { messages, nextCursor } = await this.receive(cursor);
      for (const m of messages) {
        if (m.payload.type === "hello" && m.sender) {
          found.set(m.senderSessionId, { ...m.sender, sessionId: m.senderSessionId, seenAt: m.payload.sentAt });
        }
      }
      if (nextCursor <= cursor) return [...found.values()];
      cursor = nextCursor;
    }
  }

  /** Fetches messages from other sessions. Undecryptable ones are reported via `onSkip` and never block the cursor. */
  async receive(
    after        ,
    onSkip                                             = () => {},
    waitSeconds = 0,
  )                                                               {
    const res = await this.client.poll({ after, excludeSession: this.session.sessionId, waitSeconds });
    const messages                    = [];
    for (const wire of res.messages) {
      try {
        const aad = buildAad(this.channelId, wire.id, wire.senderSessionId);
        const signed = parsePayload(decrypt(this.cryptKey, wire.envelope, aad));
        this.authenticateSender(wire.senderSessionId, signed.pub, signingInput(aad, signed), signed.sig);
        const { pub: _pub, sig: _sig, ...payload } = signed;
        if (payload.type === "hello") this.rememberPeer(wire.senderSessionId, payload.meta);
        messages.push({
          seq: wire.seq,
          id: wire.id,
          senderSessionId: wire.senderSessionId,
          payload,
          sender: this.session.peerInfo[wire.senderSessionId],
        });
      } catch (err) {
        onSkip(wire, err instanceof Error ? err.message : String(err));
      }
    }
    return { messages, nextCursor: res.nextCursor };
  }

  /** Verifies the signature and pins the sender's key on first sight; a different key for a known session is a forgery. */
          authenticateSender(senderSessionId        , pub        , input        , sig        )       {
    if (!verifyMessage(pub, input, sig)) throw new Error("Invalid sender signature");
    const pinned = this.session.peers[senderSessionId];
    if (pinned === undefined) {
      this.session.peers[senderSessionId] = pub;
    } else if (pinned !== pub) {
      throw new Error(`Sender key mismatch for session ${senderSessionId} (possible impersonation)`);
    }
  }

          rememberPeer(sessionId        , meta                                    )       {
    if (!meta?.name) return;
    this.session.peerInfo[sessionId] = {
      name: meta.name.slice(0, 40),
      tool: (meta.tool ?? "unknown").slice(0, 40),
      role: (meta.role ?? "").slice(0, 40),
    };
  }
}
