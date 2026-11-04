import { readFileSync } from "node:fs";

/** package.json sits one level up from both src/ (in the repo) and dist/ (in the published package). */
export const VERSION         = (() => {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))                       ).version;
  } catch (err) {
    console.error(`meshingly: could not read the package version: ${err instanceof Error ? err.message : String(err)}`);
    return "unknown";
  }
})();
