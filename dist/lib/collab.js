// Browser-side collaboration crypto. The server only ever receives a random code, a salt, an auth key
// derived from the password, and the crypt key encrypted under a second password-derived key.
// Plain TypeScript on WebCrypto so Node tests can run the exact same code.

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 32 symbols: one random byte maps evenly
export const KDF_ITERATIONS = 600_000;

function toB64u(buf                          )         {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64u(s        )                          {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function randomSymbols(count        )         {
  const bytes = crypto.getRandomValues(new Uint8Array(count));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** 10 symbols (50 bits). Only locates the collaboration; the password is what protects it. */
export const generateCode = ()         => randomSymbols(10);

/** 16 symbols (80 bits), grouped for reading aloud or pasting. */
export const generatePassword = ()         => randomSymbols(16).replace(/(.{4})(?=.)/g, "$1-");

export const generateMasterKey = ()         => toB64u(crypto.getRandomValues(new Uint8Array(32)));

/** Forgives case, spaces and dashes so people can type what they were given. */
export const normalizeSecret = (input        )         => input.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const formatCode = (code        )         => `${code.slice(0, 5)}-${code.slice(5)}`;

                              
                                                                                      
                  
                                                       
                     
 

export async function deriveKeys(password        , salt        , iterations        )                       {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(normalizeSecret(password)), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64u(salt), iterations }, material, 512),
  );
  const wrapKey = await crypto.subtle.importKey("raw", bits.slice(32), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { authKey: toB64u(bits.slice(0, 32)), wrapKey };
}

                         
              
               
 

async function seal(bundle        , wrapKey           , code        )                  {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(code) },
    wrapKey,
    new TextEncoder().encode(JSON.stringify(bundle)),
  );
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), iv.length);
  return toB64u(out);
}

async function open(sealed        , wrapKey           , code        )                  {
  const raw = fromB64u(sealed);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12), additionalData: new TextEncoder().encode(code) },
    wrapKey,
    raw.slice(12),
  );
  return JSON.parse(new TextDecoder().decode(plain))          ;
}

                                   
               
                   
                 
 

/** Errors carry a kind instead of text so the UI can show them in the visitor's language. */
                                                                                                                               

export class CollabError extends Error {
           kind                 ;
           status        ;
           data                         ;

  constructor(kind                 , status = 0, data                          = {}) {
    super(kind);
    this.name = "CollabError";
    this.kind = kind;
    this.status = status;
    this.data = data;
  }
}

async function call   (url        , init              )             {
  let res          ;
  try {
    res = await fetch(url, init);
  } catch {
    throw new CollabError("network");
  }
  const data = (await res.json().catch(() => ({})))                           ;
  if (!res.ok) throw new CollabError(
      res.status === 403 ? "wrong" : res.status === 404 ? "notFound" : res.status === 423 ? "locked" : res.status === 409 ? "taken" : "server",
      res.status,
      data,
    );
  return data     ;
}

const post = (body         )              => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Generates code, password and key locally, then registers only the sealed bundle. Retries if the code collides. */
export async function createCollaboration(baseUrl        , name        )                            {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateCode();
    const password = generatePassword();
    const salt = toB64u(crypto.getRandomValues(new Uint8Array(16)));
    const bundle         = { key: generateMasterKey(), name };
    const { authKey, wrapKey } = await deriveKeys(password, salt, KDF_ITERATIONS);
    try {
      await call(`${baseUrl}/v1/collabs`, post({ code, salt, iterations: KDF_ITERATIONS, authKey, bundle: await seal(bundle, wrapKey, code) }));
      return { code, password, bundle };
    } catch (err) {
      if (!(err instanceof CollabError && err.status === 409)) throw err;
    }
  }
  throw new CollabError("taken");
}

/** Fetches the sealed bundle with proof of the password and opens it locally. */
export async function joinCollaboration(baseUrl        , codeInput        , password        )                  {
  const code = normalizeSecret(codeInput);
  if (code.length !== 10) throw new CollabError("codeFormat");
  const params = await call                                      (`${baseUrl}/v1/collabs/${code}`);
  const { authKey, wrapKey } = await deriveKeys(password, params.salt, params.iterations);
  const joined = await call                    (`${baseUrl}/v1/collabs/${code}/join`, post({ authKey }));
  return open(joined.bundle, wrapKey, code);
}
