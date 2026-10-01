# n8n-sunset

Scan a folder of n8n workflow exports for what is about to break:

- **n8n 3.0** (scheduled for October 2026): removed nodes, removed node versions and options, and behavior changes you can see in workflow JSON.
- **OpenAI model shutdowns**: deprecated model IDs in OpenAI nodes, in HTTP Request nodes calling `api.openai.com`, and in Code node source.

Each finding shows the workflow, the node, what breaks, the date, and the suggested replacement. The exit code is 1 when anything breaking takes effect within 30 days, so you can run it in CI.

```
$ npx n8n-sunset ./workflows

n8n-sunset  ·  4 workflows scanned  ·  as of 2026-10-01  ·  window 30 days

SEVERITY  DATE        WORKFLOW           NODE               WHAT BREAKS                       REPLACEMENT
────────  ──────────  ─────────────────  ─────────────────  ────────────────────────────────  ────────────────────────
BREAKING  2025-10-27  Lead scoring       Message a model    OpenAI has shut down model        o4-mini
          339d ago                                          "o1-mini"; API calls fail.
                                                            at OpenAI node parameter:
                                                            modelId.value

BREAKING  2026-10     Legacy nightly     Mark imported      Function node is removed in n8n   Code node in "Run Once
          (day TBA)   import                                3.0.                              for All Items" mode
          this month

BREAKING  2026-10-23  Lead scoring       GPT-4 chat model   OpenAI shuts down model "gpt-4"   gpt-5.6-sol
          in 22d                                            (alias of gpt-4-0613); API calls
                                                            will fail.
                                                            at OpenAI node parameter:
                                                            model.value

CHANGE    2026-10     Inbox triage       Old Gmail Trigger  Gmail Trigger versions below 1.4  Turn on "Include Drafts"
          (day TBA)                                         run with version 1.4 behavior in  if the workflow relies
          this month                                        n8n 3.0: ...                      on drafts; ...

(... more rows ...)

12 breaking issues take effect within 30 days or already have.
```

## Usage

Requires Node.js 20 or later.

```bash
npx n8n-sunset ./workflows
```

Export your workflows first, for example with the n8n CLI (`--separate` writes one file per workflow):

```bash
n8n export:workflow --all --separate --output=./workflows/
```

n8n-sunset reads every `.json` file in the folder and its subfolders (skipping `node_modules` and dot-folders). It understands single-workflow exports, arrays of workflows (`export:workflow --all` without `--separate`), and n8n API responses (`{ "data": [...] }`). You can also pass individual files, or several paths.

| Option | Description |
| --- | --- |
| `--json` | Print a JSON report instead of the table |
| `--days <n>` | Window for the exit code, in days (default: 30) |
| `--as-of <date>` | Measure dates from this day, `YYYY-MM-DD` (default: today) |
| `--no-color` | Disable colors (`NO_COLOR` is honored too) |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Nothing breaking takes effect within the window |
| `1` | At least one **breaking** finding takes effect within the window, or already has |
| `2` | Usage error, unreadable path, or no workflows found |

Only `BREAKING` findings affect the exit code. `CHANGE` (behavior change) and `INFO` findings are reported but never fail the run.

### In CI

```yaml
- run: npx n8n-sunset ./workflows
```

## What it checks

### n8n 3.0

| Rule | Severity | Flags |
| --- | --- | --- |
| `n8n3/removed-node` | breaking | 36 node types removed in 3.0: Function, Function Item, Item Lists, Cron, Interval, HTML Extract, iCalendar, Read/Write Binary File(s), Read PDF, Workflow Trigger, Orbit, legacy OpenAI, OpenAI Assistant, OpenAI Model, legacy HTTP Request Tool, SerpApi, Manual Chat Trigger, Motorhead, Zep, the old document loaders and Insert/Load vector store nodes, and more |
| `n8n3/removed-node` | info | AI Transform (n8n migrates it to a Code node automatically) |
| `n8n3/ai-agent-v1` | breaking | AI Agent node version 1.x and its agent modes |
| `n8n3/execute-workflow-source` | breaking | Execute Sub-workflow using the Local File or URL source |
| `n8n3/get-paired-item` | breaking | `$getPairedItem` anywhere in node parameters |
| `n8n3/code-evaluate-expression` | breaking | `$evaluateExpression()` in a JavaScript Code node |
| `n8n3/gmail-trigger-pre-1-4` | behavior change | Gmail Trigger below version 1.4 |
| `n8n3/always-output-data-multi-output` | behavior change | Always Output Data on If/Switch (and, unverified, Compare Datasets and Loop Over Items) |
| `n8n3/webflow-v1-oauth2` | behavior change | Webflow node version 1 with OAuth2 |
| `n8n3/chat-trigger-json-frames` | behavior change | Chat Trigger in "Using Response Nodes" mode (WebSocket frames become JSON) |
| `n8n3/compression-limits` | behavior change | Compression node decompressing (lower default size and entry limits) |

n8n has announced only the month, not the day. For date math, n8n-sunset treats n8n 3.0 as taking effect on the first day of that month.

### OpenAI models (`openai/model-shutdown`)

All 125 model IDs from OpenAI's deprecations page, with their aliases (for example `gpt-4` and `gpt-3.5-turbo`, which shut down on 2026-10-23). Where it looks:

- **OpenAI nodes** (any node type containing "openai", or using OpenAI credentials): the model parameter, including resource locators and expressions such as `={{ $json.premium ? 'gpt-4-turbo' : 'gpt-4o-mini' }}`.
- **HTTP Request nodes calling `api.openai.com`**: the URL, the JSON body, and body or query parameters.
- **Code nodes** (JavaScript and Python, plus the legacy Function nodes): model IDs in string literals. Identifiers and comments are ignored, so `const o1 = 1` is not reported.
- **Any other node**: values assigned to a field named "model", such as an Edit Fields (Set) assignment.

Dated snapshots of model families listed as such (for example `gpt-realtime-2025-08-28`) also match. Fine-tuned IDs (`ft:<base>:...`) are matched by their base model and marked unverified.

### Not covered

- Instance-level n8n 3.0 changes you won't find in workflow JSON: the Docker-only deployment requirement, environment variables, SSRF block list, storage paths, the task runner timeout, Chat Hub, and others. See the [n8n 3.0 breaking changes](https://docs.n8n.io/changelog/v30-breaking-changes) page for those.
- Azure OpenAI deployments (Azure has its own retirement schedule) and models served by other providers.
- Model IDs that are only known at run time, such as a model name read from a database.

## Data and sources

All dates and replacements live in [`data/sunset-registry.json`](data/sunset-registry.json). Each entry cites its source and access date:

| Source | Used for |
| --- | --- |
| [docs.n8n.io/changelog/v30-breaking-changes](https://docs.n8n.io/changelog/v30-breaking-changes) ([n8n-docs repo](https://github.com/n8n-io/n8n-docs/blob/main/docs/changelog/v30-breaking-changes.md)) | What n8n 3.0 removes or changes, the release month, and the replacements |
| [n8n source at n8n@2.41.5](https://github.com/n8n-io/n8n/tree/n8n@2.41.5/packages) and the [3.x branch](https://github.com/n8n-io/n8n/tree/3.x) | The node type IDs behind the display names in the docs, node versions, and parameter defaults. The removed nodes are confirmed to be absent from the 3.x branch |
| [platform.openai.com/docs/deprecations](https://platform.openai.com/docs/deprecations) | Model IDs, aliases, shutdown dates, and recommended replacements |

Anything that could not be fully confirmed from the official page is marked `unverified`. That covers dates that conflict on the page itself, multi-output nodes the docs don't name, and fine-tuned model matches. Unverified findings show `[unverified]` in the table and carry a `verificationNote` in the JSON.

## JSON output

`--json` prints:

```jsonc
{
  "tool": "n8n-sunset",
  "asOf": "2026-10-01",
  "windowDays": 30,
  "exitCode": 1,
  "summary": { "workflowsScanned": 4, "findings": 14, "breakingWithinWindow": 12, ... },
  "registry": { "version": "2026-10-01", "n8nRelease": { ... }, "sources": { ... } },
  "findings": [
    {
      "workflow": "Lead scoring",
      "file": "workflows/lead-scoring.json",
      "node": "GPT-4 chat model",
      "nodeType": "@n8n/n8n-nodes-langchain.lmChatOpenAi",
      "ruleId": "openai/model-shutdown",
      "severity": "breaking",
      "message": "OpenAI shuts down model \"gpt-4\" (alias of gpt-4-0613); API calls will fail.",
      "date": "2026-10-23",
      "datePrecision": "day",
      "daysUntil": 22,
      "withinWindow": true,
      "replacement": "gpt-5.6-sol",
      "verification": "verified",
      "sources": ["https://platform.openai.com/docs/deprecations"],
      "model": "gpt-4",
      "locations": ["OpenAI node parameter: model.value"]
    }
  ],
  "skipped": [],
  "errors": []
}
```

## Development

```bash
npm install
npm test          # vitest, with a fixture workflow for every rule
npm run typecheck
npm run build
```

## License

[MIT](LICENSE)
