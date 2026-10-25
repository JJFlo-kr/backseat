# Connecting an agent over MCP (optional)

Backseat works without this: it pastes your capture into the AI window you used last. Connect an agent over MCP
only if you want it to fetch captures by itself, or to ask you to draw an answer.

## What the agent gets

The Backseat MCP server (`mcp-server.js`, installed with the app) gives the agent these tools:

| Tool | What it does |
|---|---|
| `backseat_latest` | The most recent capture: the request file (`brief.md`) and the marked-up image, optionally the unmarked screenshot |
| `backseat_get` | One capture by its id (the pasted line names it, so the editor can show "The AI fetched the capture") |
| `backseat_list` | Recent captures |
| `backseat_wait` | Waits for your next capture |
| `backseat_ask` | Asks you a question; your next capture is the answer |
| `backseat_register`, `backseat_agents` | Lets Backseat know which agent is connected in which window |

It needs [Node.js](https://nodejs.org/) on your PC. The server runs on your PC and reads captures from your
`Pictures\Backseat\sessions` folder for the agent; what the agent then sends to its AI service is up to the agent.

## Get the settings

Right-click the Backseat icon in the notification area → **Copy MCP connection settings**. The copied text has the
right path for your PC. For the installed app it looks like this:

```json
{
  "mcpServers": {
    "backseat": {
      "command": "node",
      "args": [
        "C:/Users/<you>/AppData/Local/Programs/Backseat/resources/app.asar.unpacked/out/main/mcp-server.js"
      ]
    }
  }
}
```

## Claude Code

Either put the copied JSON in your project's `.mcp.json`, or add the server from a terminal:

```sh
claude mcp add backseat -- node "C:/Users/<you>/AppData/Local/Programs/Backseat/resources/app.asar.unpacked/out/main/mcp-server.js"
```

Optional: copy [`integrations/claude-code/SKILL.md`](../integrations/claude-code/SKILL.md) into your skills folder
so Claude Code knows how to read a capture.

## Codex CLI

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.backseat]
command = "node"
args = ["C:/Users/<you>/AppData/Local/Programs/Backseat/resources/app.asar.unpacked/out/main/mcp-server.js"]
```

## Cursor

Put the copied JSON in `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` for all projects).

## What has been tested

The server is checked against the official MCP client SDK (`scripts/mcp-check.mjs`: tool list, latest capture,
fetch receipt, wait, ask). A full round trip inside each agent above has not been verified yet; if one does not
work for you, please [open an issue](https://github.com/JJFlo-kr/backseat/issues).
