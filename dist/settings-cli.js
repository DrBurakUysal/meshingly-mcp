import { describeSettings, resetSettings, SETTING_KEYS, writeSetting } from "./settings.js";

const HELP = `meshingly-mcp settings: your preferences for this project (stored in your home folder, not in the project: a repository must not be able to ship them).

  npx -y meshingly-mcp settings                 show every setting and where its value comes from
  npx -y meshingly-mcp settings set <key> <value>
  npx -y meshingly-mcp settings reset           back to the defaults

Keys: ${SETTING_KEYS.join(", ")}

Examples:
  npx -y meshingly-mcp settings set autoResume true        continue queued work automatically after the limit is back
  npx -y meshingly-mcp settings set onQuestion recommended  an unattended run takes the recommended option instead of waiting
  npx -y meshingly-mcp settings set resumeCommand "codex exec -"

Settings are changed here, in a terminal, on purpose: an AI session cannot change them through its tools.
A running watcher keeps the values it started with: stop it and start it again after a change.
An environment variable in your MCP configuration (MESHINGLY_AUTOWATCH, MESHINGLY_WATCH_CMD, MESHINGLY_WATCH_FROM_PEERS) overrides the file.
`;

/** `meshingly-mcp settings ...`. Returns the process exit code. */
export function runSettings(argv          , root = process.env.MESHINGLY_DIR ?? process.cwd())         {
  const [verb, key, ...rest] = argv;
  if (verb === "--help" || verb === "help" || verb === "-h") {
    console.log(HELP);
    return 0;
  }
  if (verb === undefined) {
    console.log(describeSettings(root));
    return 0;
  }
  if (verb === "reset") {
    resetSettings(root);
    console.log("Settings are back to the defaults.");
    return 0;
  }
  if (verb === "set") {
    if (!key || rest.length === 0) {
      console.error(`Usage: settings set <key> <value>\n\n${HELP}`);
      return 2;
    }
    try {
      writeSetting(root, key, rest.join(" "));
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 2;
    }
    console.log(`${describeSettings(root)}\n\nSaved. A running watcher keeps its old values: stop it and start it again.`);
    return 0;
  }
  console.error(`Unknown command "${verb}".\n\n${HELP}`);
  return 2;
}
