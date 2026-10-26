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
| `backseat_job_get`, `backseat_job_submit`, `backseat_job_status` | UI/UX jobs: fetch a job the user started in Backseat, send back the result, report progress or failure (see below) |

It needs [Node.js](https://nodejs.org/) on your PC. The server runs on your PC and reads captures from your
`Pictures\Backseat\sessions` folder for the agent; what the agent then sends to its AI service is up to the agent.

### Design preview

`backseat_get` and `backseat_latest` take an optional `includeDesignPreview` (default off). When the capture carries a
UI/UX design the user chose, it attaches `design-preview.png` (a mock-up, not a screenshot of the app) after the other
images; a package without one gets a short note instead. The text of `brief.md`, including its UI/UX section, is
returned exactly as before.

### UI/UX jobs

When you ask Backseat's UI/UX tools for something that needs your agent (understand the project, propose designs,
audit styles), Backseat creates a job and gives your agent its id in the pasted text. The agent then uses:

| Tool | Arguments | What it does |
|---|---|---|
| `backseat_job_get` | `jobId` | Returns the job (type, project, status, deadline, `inputRevision`), its input data, the JSON Schema of the result and the rules: use only the project files needed, no secrets or customer data, project-relative evidence paths, every statement marked verified / user / estimated / unknown, verified needs evidence. A pending job becomes fetched. A cancelled, expired, failed or finished job is reported as such and not reopened. |
| `backseat_job_submit` | `jobId`, `inputRevision`, `result` (JSON object or JSON text) | Checks the result for the job type and stores it; the job becomes submitted. |
| `backseat_job_status` | `jobId`, `status` (`in_progress` or `failed`), `message?` | Reports progress (only a note, the job state stays) or a failure (stored with the message). The reply shows the current status, including `cancelled` and `expired`: the agent stops then. |

Replies are a sentence in the brief language followed by JSON with fixed English field names (`status`, `accepted`,
`errors`, `completeness`, and so on).

Result by job type:

| Type | `result` | Checked with |
|---|---|---|
| `project_overview` | the project overview: summary, purpose, goals, audiences, workflows, architecture, stack, ... | `readOverview`. The reply also says whether it is complete and what is missing (`purposeUnbacked`, `workflows`, ...). An incomplete overview is stored; until the deadline it can be replaced by a complete one. |
| `skill_setup` | `{ projectId, skillId, fields, missing }` | `readSkillContext` |
| `capabilities` | `{ skills: [...] }` | `readSkillList` |
| `design_proposal` | `{ proposals: [...] }`, up to 4 different `proposalId`s (repeats are dropped, the first counts). Each may carry `previewPngBase64`: a PNG mock-up as raw base64, at most 8 MB, 1 to 8000 px per side | `readProposal` per proposal. The PNG is checked (signature, header, size, closing chunk) and stored as `jobs/<jobId>.<proposalId>.png`, referenced by file name only |
| `style_audit` | `{ findings: [{ area, issue, source, evidence?, suggestion }] }` | `src/main/mcp/styleaudit.ts` |

What is refused: an unknown job, a wrong `inputRevision` (`stale`), a cancelled, expired or failed job, a result for
another project, and any invalid result (`rejected`, with the list of errors; the agent may submit again until the
deadline). The same result submitted twice gets the same answer and stores nothing new; a different result for a
finished job is refused. Nothing in a result is executed or fetched; it is data.

The jobs live in Backseat's data folder (`uiux/jobs` under the folder that holds `config.json`); the MCP server finds
that folder the same way it finds `config.json`. For tests only, the environment variable `BACKSEAT_USER_DATA` replaces
that folder (`scripts/mcp-check.mjs` and the job tests use it). Do not set it for real use: the server would then look
somewhere other than the app.

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
fetch receipt, wait, ask, design preview, and a UI/UX job round trip: get, rejected and stale submits, accepted
result, duplicate, cancelled, failed, mock-up image). A full round trip inside each agent above has not been verified yet; if one does not
work for you, please [open an issue](https://github.com/JJFlo-kr/backseat/issues).
