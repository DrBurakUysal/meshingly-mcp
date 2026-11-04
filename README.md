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
| `meshingly_handoff`, `meshingly_queue`, `meshingly_claim`, `meshingly_release`, `meshingly_done` | A work queue: park unfinished work, list it, take it over, give it back, finish it |
| `meshingly_watch_start`, `meshingly_watch_stop`, `meshingly_watch_status` | Optional background watcher that restarts queued work (see below) |
| `meshingly_journal` | Writes a short note for the other sessions (only if you turned the journal on) |
| `meshingly_settings` | Shows your preferences, and changes them when you ask your agent to |
| (status notice) | `meshingly_status` tells you once per session when a newer version of the MCP exists |

## Several computers and handing work over

The same person can join one collaboration from several computers; each session is labelled with a computer name you choose (not the host name). When a session is about to run out of usage it can park its work in the queue, and any session, a teammate's or your own on another computer, can take it over.

## Remembering what the other sessions did

Two settings, both off until you turn them on (just ask your agent, or use the terminal). `journal` (`milestones` or `detailed`) lets sessions write short notes for the others with `meshingly_journal`; `catchUp` (a number of entries) adds a digest of the latest notes, handoffs and messages to the join and status results, so a session on another computer already knows what happened. Everyone in a collaboration can read its notes, so sessions are told never to write secrets in them. Messages are kept by the relay for seven days; code travels through git, not through Meshingly.

## The optional watcher

A session that has ended cannot wake itself. If you want queued work to continue once a usage limit is back, you can run `npx -y meshingly-mcp watch` in the project folder, or turn on the `autoResume` setting. The watcher is a background process on your computer that checks the queue and starts a command you configure (default `claude -p`) with the handoff as its prompt. **It is off by default.** Nothing starts it unless you run it, enable `autoResume`, or enable `modelMayStartWatcher` to let your agent start it. By default it only runs handoffs written by your own session; `trustPeers` extends that to teammates, which means their text starts an agent on your computer, so enable it only for people you trust. Handoffs marked as a question for a person are never run.

Settings live in your home folder, not in the project (so a repository cannot ship them), and you can change them by asking your agent ("turn on the journal", "let every session know what the others did") or in a terminal: `npx -y meshingly-mcp settings` lists them and `settings set <key> <value>` changes one. The agent changes the harmless ones (journal, catch-up, retry tuning, switching things off) when you ask. The ones that make programs start on your computer (`autoResume`, `resumeCommand`, `trustPeers`, `onQuestion: recommended`, `modelMayStartWatcher`) need your approval: your client asks you directly, outside the model's reach, and if it cannot ask, nothing changes and you are given the terminal command instead.

## What it runs, stores and sends

Unless you start the watcher described above, the server runs locally over stdio and starts no other program. Creating a collaboration generates a random key on your machine. It is stored in `.meshingly/connection.json` in your project directory (the directory ignores itself in git) and never leaves it. The network traffic goes to `https://api.meshingly.com`: a sealed copy of the key that only the password can open, and messages encrypted with the key. In addition, once a day the server asks `https://registry.npmjs.org/meshingly-mcp/latest` for the newest published version number (a plain request that carries nothing about you or your work) so it can tell you when an update exists; it never installs anything, and the `updateCheck` setting (or `MESHINGLY_UPDATE_CHECK=0`) turns it off. Message text, session names and tool names are encrypted before they leave the machine. The relay keeps messages for seven days. Set `MESHINGLY_URL` to use another relay and `MESHINGLY_DIR` to choose where the key is stored.

Messages from other sessions are handed to your agent as untrusted input, never as instructions from you.

## License

MIT
