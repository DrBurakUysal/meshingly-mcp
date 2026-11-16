/**
 * A small QR code encoder (ISO/IEC 18004), byte mode only, error correction L or M, versions 1 to 40. No dependency.
 * It exists so `meshingly-mcp invite` can draw a join code in the terminal. Written from the specification; the tests check
 * it against a decoder's reading of known codes and against the structure the standard fixes (finders, timing, format bits).
 */
                            

                         
                  
               
               
           
                                   
                       
 

const ECC_PER_BLOCK                        = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
};
const BLOCKS                        = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
};
const FORMAT_BITS                      = { L: 1, M: 0 };

const rawModules = (v        )         => {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (v >= 7) r -= 36;
  }
  return r;
};

/** Data codewords a version holds at a correction level. */
export const dataCodewords = (v        , ecc     )         => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[ecc][v]  * BLOCKS[ecc][v] ;

function alignmentPositions(v        )           {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2;
  const step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = v * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

// Reed-Solomon over GF(256), polynomial 0x11D.
function gfMul(x        , y        )         {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree        )           {
  const out = new Array        (degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < out.length; j++) {
      out[j] = gfMul(out[j] , root);
      if (j + 1 < out.length) out[j] = out[j]  ^ out[j + 1] ;
    }
    root = gfMul(root, 2);
  }
  return out;
}

function rsRemainder(data          , divisor          )           {
  const out = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ out.shift() ;
    out.push(0);
    divisor.forEach((c, i) => (out[i] = out[i]  ^ gfMul(c, factor)));
  }
  return out;
}

function encodeData(bytes            , v        , ecc     )           {
  const bits           = [];
  const put = (value        , len        ) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, v >= 10 ? 16 : 8);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(v, ecc) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const out           = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; out.length < capacity / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function addEccAndInterleave(data          , v        , ecc     )           {
  const blocks = BLOCKS[ecc][v] ;
  const eccLen = ECC_PER_BLOCK[ecc][v] ;
  const raw = Math.floor(rawModules(v) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLen);
  const parts             = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const e = rsRemainder(dat, divisor);
    if (i < shortBlocks) dat.push(0);
    parts.push([...dat, ...e]);
  }
  const out           = [];
  for (let i = 0; i < parts[0] .length; i++) {
    parts.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(block[i] );
    });
  }
  return out;
}

const MASKS                                           = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function penalty(m             )         {
  const size = m.length;
  let score = 0;
  const line = (get                        ) => {
    let run = 1;
    for (let i = 1; i < size; i++) {
      if (get(i) === get(i - 1)) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score++;
      } else run = 1;
    }
  };
  for (let y = 0; y < size; y++) line((i) => m[y] [i] );
  for (let x = 0; x < size; x++) line((i) => m[i] [x] );
  for (let y = 0; y + 1 < size; y++) for (let x = 0; x + 1 < size; x++) if (m[y] [x] === m[y] [x + 1] && m[y] [x] === m[y + 1] [x] && m[y] [x] === m[y + 1] [x + 1]) score += 3;
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  score += Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
  return score;
}

/** Encodes bytes. `mask` forces one mask pattern (0 to 7), for tests; by default the best of the eight is chosen. */
export function encodeQr(input                     , opts                                                    = {})         {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const ecc = opts.ecc ?? "M";
  let v = Math.max(1, opts.minVersion ?? 1);
  for (; ; v++) {
    if (v > 40) throw new Error("The text is too long for a QR code.");
    const lenBits = v >= 10 ? 16 : 8;
    if (4 + lenBits + bytes.length * 8 <= dataCodewords(v, ecc) * 8) break;
  }
  const size = v * 4 + 17;
  const grid = Array.from({ length: size }, () => new Array         (size).fill(false));
  const fn = Array.from({ length: size }, () => new Array         (size).fill(false));
  const set = (x        , y        , dark         ) => {
    grid[y] [x] = dark;
    fn[y] [x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]         ) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const align = alignmentPositions(v);
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(align[i]  + dx, align[j]  + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  const drawFormat = (mask        ) => {
    const data = (FORMAT_BITS[ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i        ) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0); // reserves the area; redrawn with the real mask below
  if (v >= 7) {
    let rem = v;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (v << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  const codewords = addEccAndInterleave(encodeData(bytes, v, ecc), v, ecc);
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (!fn[y] [x] && bitIndex < codewords.length * 8) {
          grid[y] [x] = ((codewords[bitIndex >>> 3]  >>> (7 - (bitIndex & 7))) & 1) !== 0;
          bitIndex++;
        }
      }
    }
  }

  const apply = (mask        ) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y] [x] && MASKS[mask] (x, y)) grid[y] [x] = !grid[y] [x];
  };
  let best = opts.mask ?? 0;
  if (opts.mask === undefined) {
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      apply(mask);
      drawFormat(mask);
      const score = penalty(grid);
      if (score < bestScore) {
        bestScore = score;
        best = mask;
      }
      apply(mask); // undo
    }
  }
  apply(best);
  drawFormat(best);
  return { version: v, size, mask: best, ecc, modules: grid };
}

/** Draws the code for a terminal: two rows of modules per line with half blocks, a quiet zone of two modules, dark on light. */
export function renderTerminal(qr        , quiet = 2)         {
  const n = qr.size + quiet * 2;
  const dark = (x        , y        ) => x >= quiet && y >= quiet && x < n - quiet && y < n - quiet && qr.modules[y - quiet] [x - quiet] ;
  const lines           = [];
  for (let y = 0; y < n; y += 2) {
    let line = "";
    for (let x = 0; x < n; x++) {
      const top = dark(x, y);
      const bottom = dark(x, y + 1);
      // The terminal is usually light-on-dark: invert, so the code reads as dark squares on a light field.
      line += top && bottom ? " " : top ? "▄" : bottom ? "▀" : "█";
    }
    lines.push(line);
  }
  return lines.join("\n");
}
