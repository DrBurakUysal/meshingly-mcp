import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { formatCode } from "./lib/collab.js";
import { encodeQr, renderTerminal } from "./qr.js";

/**
 * Links the phone app understands (the `meshingly://` scheme is registered by the app):
 *   meshingly://join?code=ABCDE-FGHJK[&password=...]   join a collaboration
 *   meshingly://pair?key=<owner key>                    the app's own pairing code, for `settings pair`
 */
export function joinLink(code        , password         )         {
  const base = `meshingly://join?code=${encodeURIComponent(formatCode(code.toUpperCase().replace(/[^A-Z0-9]/g, "")))}`;
  return password ? `${base}&password=${encodeURIComponent(password)}` : base;
}

/** The owner key in what the user pasted: the bare key, or a `meshingly://pair?key=...` link. Undefined when it is neither. */
export function pairKeyFrom(input        )                     {
  const text = input.trim();
  if (!/^meshingly:\/\//i.test(text)) return text || undefined;
  try {
    const u = new URL(text);
    if (u.hostname.toLowerCase() !== "pair") return undefined;
    return (u.searchParams.get("key") ?? u.searchParams.get("code") ?? undefined)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

const HELP = `meshingly-mcp invite: shows a QR code that opens this collaboration in the Meshingly app on your phone.

  npx -y meshingly-mcp invite                   the QR carries the code only; the app asks you for the password
  npx -y meshingly-mcp invite --with-password   the QR also carries the password (you confirm, and type it: it is not stored here)

Anyone who can see the QR code can read what it carries. The code alone is useless without the password. With --with-password
the QR is a key to the collaboration: show it only on your own screen, scan it at once, and the screen is cleared when you press
Enter (the app also forgets the link right after joining).
`;

function line(prompt        )                  {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    let answered = false;
    rl.question(prompt, (a) => {
      answered = true;
      rl.close();
      resolve(a);
    });
    rl.on("close", () => {
      if (!answered) resolve("");
    });
  });
}

/** A line typed without echo on a terminal (a password); plain when input is piped. */
async function secret(prompt        )                  {
  if (!process.stdin.isTTY) return (await line(prompt)).trim();
  process.stderr.write(prompt);
  return new Promise((resolve) => {
    let text = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const onData = (chunk        ) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stderr.write("\n");
          return resolve(text);
        }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f" || ch === "\b") text = text.slice(0, -1);
        else text += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

/** `meshingly-mcp invite ...`. Returns the process exit code. */
export async function runInvite(argv          , root = process.env.MESHINGLY_DIR ?? process.cwd())                  {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const withPassword = argv.includes("--with-password");
  const file = join(root, ".meshingly", "connection.json");
  let code = "";
  try {
    if (existsSync(file)) code = String((JSON.parse(readFileSync(file, "utf8"))                      ).code ?? "");
  } catch {
    /* handled below */
  }
  if (!code) {
    console.error("This project is not connected to a collaboration yet. Ask your AI session to set up Meshingly, then run this again.");
    return 1;
  }
  let password                    ;
  if (withPassword) {
    console.error(
      "The QR code will contain the collaboration's PASSWORD as well as its code. Anyone who sees it (a screen share, a photo, a recording, a shoulder) can join and read everything.\nShow it only on your own screen, to your own phone.",
    );
    if ((await line("Type yes to continue: ")).trim().toLowerCase() !== "yes") {
      console.error("Cancelled. Nothing was shown.");
      return 1;
    }
    password = await secret("Collaboration password (not stored by Meshingly): ");
    if (!password) {
      console.error("No password given. Cancelled.");
      return 1;
    }
  }
  const link = joinLink(code, password);
  let qr;
  try {
    qr = encodeQr(link, { ecc: "M" });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  console.log(`\n${renderTerminal(qr)}\n`);
  console.log(`Scan this in the Meshingly app (Join, Scan QR), or open it on the phone.\nCode: ${formatCode(code)}`);
  if (password) {
    console.log("It carries the password. Scan it now.");
    await line("Press Enter to clear the screen: ");
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    console.log("Cleared.");
  } else {
    console.log("It carries the code only: the app asks you for the password.");
    console.log(`Link: ${link}`);
  }
  return 0;
}
