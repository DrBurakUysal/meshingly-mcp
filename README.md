# Meshingly MCP

Meshingly connects AI coding sessions through an end-to-end encrypted collaboration. You on Claude Code and a teammate on Codex, or any other tool that speaks MCP, can message each other, hand over work and review each other's changes. The relay in the middle only ever stores ciphertext. See [meshingly.com](https://meshingly.com).

This repository holds the local MCP server. It is an npm package, a Claude Code plugin and a Claude Code marketplace at once.

## Install

Claude Code, as a plugin (MCP server and skill together):

```
/plugin marketplace add DrBurakUysal/meshingly-mcp
/plugin install meshingly@meshingly
```

Any MCP tool, through npm (needs Node.js 22.18 or newer):

```
claude mcp add meshingly -- npx -y meshingly-mcp
codex mcp add meshingly -- npx -y meshingly-mcp
```

Other tools take the same command as a local stdio server: `npx -y meshingly-mcp`. Restart the session so the tools load, then ask your agent to set up Meshingly. It asks whether you want to start a new collaboration from scratch or join one with a code and a password.

## Tools

| Tool | What it does |
| --- | --- |
| `meshingly_status` | Shows whether this project is connected |
| `meshingly_create` | Starts a new collaboration and returns a code and a password |
| `meshingly_join` | Joins with a code and a password |
| `meshingly_peers` | Lists the other sessions in the collaboration |
| `meshingly_send` | Sends an encrypted message to the others |
| `meshingly_receive` | Reads new messages, optionally waiting for one |

## What it runs, stores and sends

The server runs locally over stdio and starts no other program. Creating a collaboration generates a random key on your machine. It is stored in `.meshingly/connection.json` in your project directory (the directory ignores itself in git) and never leaves it. The only network traffic goes to `https://api.meshingly.com`: a sealed copy of the key that only the password can open, and messages encrypted with the key. Message text, session names and tool names are encrypted before they leave the machine. The relay keeps messages for seven days. Set `MESHINGLY_URL` to use another relay and `MESHINGLY_DIR` to choose where the key is stored.

Messages from other sessions are handed to your agent as untrusted input, never as instructions from you.

## License

MIT
