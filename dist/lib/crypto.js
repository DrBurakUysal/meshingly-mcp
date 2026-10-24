import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign as edSign,
  verify as edVerify,
} from "node:crypto";

const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const INFO_CHANNEL = "meshingly/v1/channel";
const INFO_AUTH = "meshingly/v1/auth";
const INFO_MESSAGE_KEY = "meshingly/v1/message-key";

                           
       
               
             
             
              
 

                                     
                                                         
                    
                                                               
                    
 

export class CryptoError extends Error {
  constructor(message        ) {
    super(message);
    this.name = "CryptoError";
  }
}

const toB64u = (buf            )         => Buffer.from(buf).toString("base64url");
const fromB64u = (s        )         => Buffer.from(s, "base64url");

export function generateMasterKey()         {
  return toB64u(randomBytes(KEY_BYTES));
}

export function parseMasterKey(encoded        )         {
  const key = fromB64u(encoded);
  if (key.length !== KEY_BYTES) {
    throw new CryptoError(`Crypt key must decode to ${KEY_BYTES} bytes`);
  }
  return key;
}

function hkdf(master        , salt        , info        , length        )         {
  return Buffer.from(hkdfSync("sha256", master, salt, info, length));
}

/** Derives routing id and auth token so the master key never leaves the machine. */
export function deriveChannel(masterKey        )                     {
  const master = parseMasterKey(masterKey);
  const empty = Buffer.alloc(0);
  return {
    channelId: toB64u(hkdf(master, empty, INFO_CHANNEL, 16)),
    authToken: toB64u(hkdf(master, empty, INFO_AUTH, 32)),
  };
}

/**
 * AES-256-GCM with a fresh subkey per message (HKDF over a random salt),
 * so a random 96-bit nonce collision can never repeat a (key, nonce) pair.
 * `aad` binds the ciphertext to its routing metadata.
 */
export function encrypt(masterKey        , plaintext        , aad        )           {
  const master = parseMasterKey(masterKey);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", hkdf(master, salt, INFO_MESSAGE_KEY, KEY_BYTES), iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { v: 1, salt: toB64u(salt), iv: toB64u(iv), ct: toB64u(ct), tag: toB64u(cipher.getAuthTag()) };
}

export function decrypt(masterKey        , envelope          , aad        )         {
  if (envelope?.v !== 1) throw new CryptoError("Unsupported envelope version");
  const master = parseMasterKey(masterKey);
  const salt = fromB64u(envelope.salt);
  const iv = fromB64u(envelope.iv);
  const tag = fromB64u(envelope.tag);
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new CryptoError("Malformed envelope");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", hkdf(master, salt, INFO_MESSAGE_KEY, KEY_BYTES), iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(fromB64u(envelope.ct)), decipher.final()]).toString("utf8");
  } catch {
    throw new CryptoError("Decryption failed (wrong key, tampered data or mismatched metadata)");
  }
}

export function buildAad(channelId        , messageId        , senderSessionId        )         {
  return `meshingly/v1|${channelId}|${messageId}|${senderSessionId}`;
}

                              
                                                                    
                    
                                                                                            
                     
 

export function generateSigningKeys()              {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: toB64u(publicKey.export({ type: "spki", format: "der" })),
    privateKey: toB64u(privateKey.export({ type: "pkcs8", format: "der" })),
  };
}

export function signMessage(privateKey        , data        )         {
  const key = createPrivateKey({ key: fromB64u(privateKey), format: "der", type: "pkcs8" });
  return toB64u(edSign(null, Buffer.from(data, "utf8"), key));
}

/** Returns false (never throws) for malformed keys or signatures. */
export function verifyMessage(publicKey        , data        , signature        )          {
  try {
    const key = createPublicKey({ key: fromB64u(publicKey), format: "der", type: "spki" });
    return edVerify(null, Buffer.from(data, "utf8"), key, fromB64u(signature));
  } catch {
    return false;
  }
}
