# n8n-sunset

Scan a folder of n8n workflow exports for what is about to break:

- **OpenAI model shutdowns**: deprecated model IDs in OpenAI nodes, in HTTP Request nodes calling `api.openai.com`, and in Code node source.
- **OpenAI endpoint shutdowns**: calls to deprecated endpoints such as the Assistants API (`/v1/assistants`, `/v1/threads`), the Videos API, and reusable prompt objects, in HTTP Request and Code nodes and in n8n's own OpenAI nodes.
- **n8n 3.0**: removed nodes, removed node versions and options, and behavior changes you can see in workflow JSON. These apply when you upgrade, not on a date.

Each finding shows the workflow, the node, what breaks, when, and the suggested replacement. The exit code is 1 when an OpenAI shutdown takes effect within 30 days or already has, so you can run it in CI. Add `--target 3.0` to also fail on what breaks when you upgrade to n8n 3.0.

```
$ npx n8n-sunset ./workflows

n8n-sunset · 2 workflows scanned · as of 2026-10-01 (UTC) · window 30 days

Upcoming shutdowns (2 findings)

SEVERITY  WHEN        WORKFLOW        NODE              WHAT BREAKS                     REPLACEMENT
────────  ──────────  ──────────────  ────────────────  ──────────────────────────────  ──────────────────────
BREAKING  2026-10-23  Lead scoring    GPT-4 chat model  OpenAI shuts down model         gpt-5.6-sol
          in 22d                                        "gpt-4" (alias of gpt-4-0613);
                                                        API calls will fail.
                                                        at OpenAI node parameter:
                                                        model.value
(...)

Already shut down (1 finding)

SEVERITY  WHEN        WORKFLOW        NODE              WHAT BREAKS                     REPLACEMENT
────────  ──────────  ──────────────  ────────────────  ──────────────────────────────  ──────────────────────
BREAKING  2025-10-27  Lead scoring    Message a model   OpenAI has shut down model      o4-mini
          339d ago                                      "o1-mini"; API calls fail.
                                                        at OpenAI node parameter:
                                                        modelId.value

Breaks on upgrade to n8n 3.0 (2 findings)

SEVERITY  WHEN        WORKFLOW        NODE              WHAT BREAKS                     REPLACEMENT
────────  ──────────  ──────────────  ────────────────  ──────────────────────────────  ──────────────────────
BREAKING  breaks on   Support agents  SQL agent         AI Agent node version 1.x is    Update the node to the
          upgrade to                                    removed in n8n 3.0, along with  latest AI Agent
          n8n 3.0                                       its agent modes (SQL, ...).     version (...)
(...)

5 findings in 5 nodes across 2 workflows: 5 breaking, 0 behavior changes, 0 warnings, 0 info.

3 breaking findings in 3 nodes across 1 workflow take effect within 30 days or already have.
2 breaking findings in 2 nodes break on upgrade to n8n 3.0; add --target 3.0 to fail on them.
```

Findings come in sections: upcoming shutdowns (soonest first), shutdowns that already happened (most recent first), then what breaks, changes, or is otherwise affected on upgrade to n8n 3.0. Below 90 columns, each finding is printed as a block instead of a table row.

## Usage

Requires Node.js 20 or later.

```bash
npx n8n-sunset ./workflows
```

Export your workflows first, for example with the n8n CLI (`--separate` writes one file per workflow):

```bash
n8n export:workflow --all --separate --output=./workflows/
```

n8n-sunset reads every `.json` file in the folder and its subfolders. It skips `node_modules` and dot-folders, and does not follow symbolic links (it warns about each one). It understands:

- single-workflow exports and arrays of workflows (`export:workflow --all` without `--separate`);
- n8n API responses (`{ "data": [...] }`);
- n8n.io templates, both `{ "workflow": { "nodes": [...] } }` and the templates API's `{ "workflow": { "name": ..., "workflow": { "nodes": [...] } } }`.

You can also pass individual files, or several paths. Every JSON file that can't be parsed, or that holds no workflow, is listed with the reason (for example `JSON object without a "nodes" array`) and makes the run exit 2, unless you pass `--allow-skipped`.

| Option | Description |
| --- | --- |
| `--json` | Print a JSON report instead of the table. Errors are printed as JSON too |
| `--days <n>` | Window for the exit code, in days (default: 30) |
| `--as-of <date>` | Measure dates from this day, `YYYY-MM-DD` (default: today in UTC) |
| `--target <version>` | Also fail on breaking changes on upgrade to this n8n version. Supported: `3.0` |
| `--allow-skipped` | Don't exit 2 for JSON files that aren't readable n8n workflows |
| `--no-color` | Disable colors. `NO_COLOR` (when not empty) and `FORCE_COLOR=0` or `false` also turn colors off |

Dates are calendar days in UTC, so a CI runner gives the same result in any time zone.

If the bundled data is more than 30 days older than the `--as-of` date, n8n-sunset warns you to update it: new shutdowns may have been announced since.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No breaking finding takes effect within the window |
| `1` | A **breaking** OpenAI shutdown takes effect within the window, or already has. With `--target 3.0`, also any breaking change on upgrade to n8n 3.0 |
| `2` | Usage error, unreadable path, no workflows found, or a JSON file that isn't a readable n8n workflow (unless `--allow-skipped`). Takes precedence over 1 |

Only `BREAKING` findings affect the exit code, and only on enabled nodes:

- Findings on **disabled nodes** are shown, marked `(disabled, not counted)`, but never fail the run, because the node doesn't execute.
- **Inactive and archived workflows** are shown and marked `(inactive)` or `(archived)`. Their findings still count, because they can be run or reactivated.
- `CHANGE` (behavior change), `WARNING` (may break, needs review), and `INFO` findings are reported but never fail the run.

### In CI

```yaml
- run: npx n8n-sunset ./workflows
# Before upgrading n8n:
- run: npx n8n-sunset ./workflows --target 3.0
```

## What it checks

### n8n 3.0

n8n 3.0 changes take effect when an instance is upgraded, not on a calendar date: self-hosted instances keep running 2.x until you upgrade them. These findings are labeled "breaks on upgrade to n8n 3.0" (or "changes on upgrade" for behavior changes), have no date, and only affect the exit code with `--target 3.0`. The docs say 3.0 is scheduled for October 2026; that date is shown for information only.

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
| `n8n3/compression-limits` | behavior change | Compression node decompressing (lower default size and entry limits). Decompress is the node's default operation in both versions, so nodes without an explicit operation count |

The Call n8n Workflow Tool node (`toolWorkflow`) only offers the Database and Parameter sources at every version, so the Execute Sub-workflow source change doesn't apply to it.

### OpenAI models (`openai/model-shutdown`)

All 125 model IDs from OpenAI's deprecations page, with their aliases (for example `gpt-4` and `gpt-3.5-turbo`, which shut down on 2026-10-23). Where it looks:

- **OpenAI nodes** (any node type containing "openai", or using OpenAI credentials): the model parameter, including resource locators and expressions such as `={{ $json.premium ? 'gpt-4-turbo' : 'gpt-4o-mini' }}`. If the node's `options.baseURL` points somewhere other than `api.openai.com` (for example OpenRouter), the finding is an unverified **warning**, because another provider serves the model on its own schedule.
- **HTTP Request nodes calling OpenAI** (the url field is on `api.openai.com`, with or without a port, or an expression URL plus OpenAI credentials): model IDs in the url field, quoted model IDs in the request body text (`jsonBody`, `body`, `jsonQuery`), and `model` name/value pairs in body or query parameters. Headers and options are not read. Requests to any other host are ignored, even with OpenAI credentials.
- **Code nodes** (JavaScript and Python, plus the legacy Function nodes): model IDs in string literals. Identifiers and comments are ignored, so `const o1 = 1` is not reported.
- **Any other node**: values assigned to a field named "model", such as an Edit Fields (Set) assignment. These are unverified **warnings**, since the value may never reach OpenAI.

Also matched:

- dated snapshots of model families listed as such (for example `gpt-realtime-2025-08-28`);
- fine-tuned IDs (`ft:<base>:...`), matched by their base model and marked unverified;
- legacy `/v1/fine-tunes` models (`curie:ft-acme-2021-08-23-17-54-10`), shut down on 2024-01-04;
- provider-prefixed IDs as used by OpenRouter (`openai/gpt-4`), reported as unverified warnings.

### OpenAI endpoints (`openai/endpoint-shutdown`)

Every endpoint, API, and beta header that OpenAI's deprecations page lists as shut down or scheduled to shut down:

| Endpoint | Shutdown | Replacement (from OpenAI) |
| --- | --- | --- |
| Assistants API: `/v1/assistants`, `/v1/threads` (and everything below them) | 2026-08-26 | Responses API and Conversations API |
| Videos API: `/v1/videos` | 2026-09-24 | None listed |
| Reusable prompt objects: `/v1/prompts`, and Responses calls that reference one (`"prompt": {"id": "pmpt_..."}`) | 2026-11-30 | Move prompt content into your application code |
| Evals API: `/v1/evals` (read-only from 2026-10-31) | 2026-11-30 | Promptfoo |
| Creating fine-tuning jobs: `POST /v1/fine_tuning/jobs` | 2027-01-06 (earlier for some organizations) | None listed |
| Realtime API Beta: header `OpenAI-Beta: realtime=v1` | 2026-05-12 | Realtime API (GA) |
| Assistants API beta v1: header `OpenAI-Beta: assistants=v1` | 2024-12-18 | `assistants=v2` (the Assistants API itself shut down later) |
| `/v1/fine-tunes`, `/v1/edits` | 2024-01-04 | `/v1/fine_tuning/jobs`, `/v1/chat/completions` |
| `/v1/engines`, `/v1/search`, `/v1/classifications`, `/v1/answers` | 2022-12-03 | `/v1/models`, or OpenAI's transition guides |

Where it looks:

- **HTTP Request nodes calling OpenAI** (including the HTTP Request tool for AI Agents): endpoint paths in the url field only, including `={{ $vars.OPENAI_BASE }}/threads`-style URLs when the node uses OpenAI credentials; `OpenAI-Beta` values in the headers; and quoted prompt object IDs (`pmpt_...`) in the request body. The fine-tuning entry only matches `POST` requests to the exact path.
- **Code nodes** that mention `api.openai.com` or an `OpenAI-Beta` header: paths inside `api.openai.com` URLs or in string literals that start with the path (`'/v1/threads'`), `OpenAI-Beta` header values, and quoted prompt object IDs. A path in a comment or in prose is not reported, and neither are URLs on other hosts.
- **n8n nodes that call these APIs themselves:**
  - The **OpenAI node** (`@n8n/n8n-nodes-langchain.openAi`) at type versions 1 to 1.8 with the "Assistant" resource. "Message an Assistant" (the default operation) calls `/v1/threads`; Create, Delete, List, and Update an Assistant call `/v1/assistants`. Version 2 has no Assistant resource; the suggested replacement is its Text "Message a Model" operation (Responses API) or its Conversation resource (Conversations API).
  - The **OpenAI node** at type versions 2 to 2.3 with the "Video" resource. Its only operation, Generate, calls the Videos API (`/v1/videos`), which shut down on 2026-09-24. OpenAI lists no replacement.
  - The **OpenAI node** at type versions 2 to 2.3, Text resource, "Message a Model" operation, with a Prompt ID set in its "Prompt" option. n8n sends it to the Responses API as a reusable prompt object reference.
  - The **OpenAI Assistant node** (`@n8n/n8n-nodes-langchain.openAiAssistant`), all versions. Both of its operations, "Use Existing Assistant" (the default) and "Use New Assistant", call `/v1/assistants` and then run the assistant on a thread (`/v1/threads`). It has been failing since 2026-08-26. n8n 3.0 also removes this node, and that finding is still reported in the upgrade section. Because the n8n docs suggest the OpenAI node's "Assistant" resource as its replacement, which calls the same shut-down API, n8n-sunset suggests the OpenAI node version 2 instead.

### Limitations

- **Model IDs in code and request bodies only count when quoted.** In Code nodes, in HTTP request bodies, and in OpenAI node model fields, a model ID is recognized only as a string literal such as `'gpt-4'` or `"gpt-4"`. This keeps a variable named `o1` or a prompt that mentions "davinci" from being reported, but it misses IDs assembled at run time (`'gpt-' + version`), IDs read from data, and IDs inside a longer string such as a URL built in code.
- **Azure OpenAI is skipped.** Azure OpenAI nodes and nodes using Azure OpenAI credentials are not checked: they reference deployment names, and Azure retires models on its own schedule, so OpenAI's dates don't apply. Models served by other providers are only reported when they use the `openai/<model>` naming, and then only as warnings.
- **OpenAI credentials with a custom base URL can't be seen.** The credential's own base URL isn't part of a workflow export, so a node that relies on it (rather than `options.baseURL`) is treated as calling OpenAI.
- **Endpoints in code need the full path.** A Code node that builds URLs from a base variable (`` `${base}/threads` ``) is not flagged, and neither are OpenAI SDK calls (`openai.beta.threads.create`). Code that doesn't mention `api.openai.com` is not checked for endpoints at all. In code the request method is unknown, so the `POST`-only fine-tuning entry is reported as unverified there.
- **Only these n8n node usages are checked for built-in endpoint calls:** the OpenAI node's "Assistant" resource (versions 1 to 1.8), its "Video" resource and "Message a Model" prompt option (versions 2 to 2.3), and the OpenAI Assistant node. Other n8n nodes that call OpenAI internally, such as the OpenAI Chat Model, are checked for deprecated models only.
- **Instance-level n8n 3.0 changes** you won't find in workflow JSON are out of scope: the Docker-only deployment requirement, environment variables, SSRF block list, storage paths, the task runner timeout, Chat Hub, and others. See the [n8n 3.0 breaking changes](https://docs.n8n.io/changelog/v30-breaking-changes) page for those.

## Data and sources

All dates and replacements live in [`data/sunset-registry.json`](data/sunset-registry.json). Each entry cites its source and access date:

| Source | Used for |
| --- | --- |
| [docs.n8n.io/changelog/v30-breaking-changes](https://docs.n8n.io/changelog/v30-breaking-changes) ([n8n-docs repo](https://github.com/n8n-io/n8n-docs/blob/main/docs/changelog/v30-breaking-changes.md)) | What n8n 3.0 removes or changes, the scheduled month, and the replacements |
| [n8n source at n8n@2.41.5](https://github.com/n8n-io/n8n/tree/n8n@2.41.5/packages) and the [3.x branch](https://github.com/n8n-io/n8n/tree/3.x) | The node type IDs behind the display names in the docs, node versions, and parameter defaults. The removed nodes are confirmed to be absent from the 3.x branch |
| [n8n OpenAI node source at n8n@2.41.5](https://github.com/n8n-io/n8n/tree/n8n@2.41.5/packages/@n8n/nodes-langchain/nodes/vendors/OpenAi) | Which type versions have the "Assistant" and "Video" resources and the "Message a Model" prompt option (`OpenAi.node.ts` maps 1 to 1.8 to `v1/OpenAiV1.node.ts` and 2 to 2.3 to `v2/OpenAiV2.node.ts`), the resource and operation values, and the endpoints each operation calls |
| [n8n OpenAI Assistant node source at n8n@2.41.5](https://github.com/n8n-io/n8n/blob/n8n@2.41.5/packages/@n8n/nodes-langchain/nodes/agents/OpenAiAssistant/OpenAiAssistant.node.ts) and [LangChain's `OpenAIAssistantRunnable`](https://github.com/langchain-ai/langchainjs/blob/6b914bceb4acd4664b12091770a2ddcbf5d8457e/libs/langchain-classic/src/experimental/openai_assistant/index.ts) (`@langchain/classic` 1.0.27, the version n8n uses) | The OpenAI Assistant node's versions, its `mode` parameter, and its Assistants API calls: `beta.assistants.update` or `createAssistant`, then `beta.threads` runs |
| [platform.openai.com/docs/deprecations](https://platform.openai.com/docs/deprecations) | Model IDs, aliases, deprecated endpoints, beta headers, shutdown dates, and recommended replacements |
| [OpenAI OpenAPI spec](https://github.com/openai/openai-openapi) and the [Assistants migration guide](https://developers.openai.com/api/docs/assistants/migration) | The URL paths behind entries the deprecations page names only as a product (Assistants API, Videos API, Evals API, creating fine-tuning jobs). In the spec, `/assistants` and `/threads` are tagged "Assistants", and the guide covers threads, messages, and runs as part of the Assistants API |
| [OpenAI's "Migrate from prompt objects" guide](https://developers.openai.com/api/docs/guides/prompting/migrate-from-prompt-object) | Responses calls with `prompt: { id: "pmpt_..." }` are the usage to migrate away from before prompt objects shut down |
| [OpenAI Cookbook legacy fine-tuning example](https://github.com/openai/openai-cookbook/blob/2182005bcaf5a5cdd96bb46fb9995d08730e7b91/examples/fine-tuned_qa/olympics-3-train-qa.ipynb) | The ID format of legacy `/v1/fine-tunes` models (`curie:ft-<org>-<timestamp>`) |

Anything that could not be fully confirmed from the official page is marked `unverified`. That covers dates that conflict on the page itself, multi-output nodes the docs don't name, fine-tuned model matches, method-specific endpoints found in code, and every warning. Unverified findings show `[unverified]` in the table and carry a `verificationNote` in the JSON.

## JSON output

`--json` prints:

```jsonc
{
  "tool": "n8n-sunset",
  "asOf": "2026-10-01",
  "windowDays": 30,
  "targets": [],
  "exitCode": 1,
  "summary": {
    "workflowsScanned": 1, "findings": 1, "nodesAffected": 1, "workflowsAffected": 1,
    "breaking": 1, "behaviorChanges": 0, "warnings": 0, "info": 0,
    "upcoming": 1, "past": 0, "onUpgrade": 0,
    "exitFindings": 1, "exitNodes": 1, "exitWorkflows": 1,
    "filesSkipped": 0, "fileErrors": 0, "symlinksNotFollowed": 0
  },
  "registry": { "version": "2026-10-01", "n8nRelease": { ... }, "sources": { ... } },
  "findings": [
    {
      "category": "openai-model",
      "ruleId": "openai/model-shutdown",
      "severity": "breaking",
      "message": "OpenAI shuts down model \"gpt-4\" (alias of gpt-4-0613); API calls will fail.",
      "replacement": "gpt-5.6-sol",
      "verification": "verified",
      "sources": ["https://platform.openai.com/docs/deprecations"],
      "model": "gpt-4",
      "locations": ["OpenAI node parameter: model.value"],
      "workflow": "Lead scoring",
      "file": "workflows/lead-scoring.json",
      "node": "GPT-4 chat model",
      "nodeType": "@n8n/n8n-nodes-langchain.lmChatOpenAi",
      "nodeDisabled": false,
      "trigger": "date",
      "date": "2026-10-23",
      "when": "2026-10-23",
      "daysUntil": 22,
      "status": "upcoming",
      "withinWindow": true,
      "countsTowardExit": true
    }
  ],
  "warnings": [],
  "skipped": [],
  "errors": [],
  "symlinks": []
}
```

- `category` is `n8n-3.0`, `openai-model`, or `openai-endpoint`; `severity` is `breaking`, `behavior-change`, `warning`, or `info`.
- `trigger` is `date` for OpenAI shutdowns and `upgrade` for n8n 3.0. Upgrade findings have `date` and `daysUntil` set to `null`, `upgradeTo: "3.0"`, `status: "on-upgrade"`, and a `when` label such as `"breaks on upgrade to n8n 3.0"`.
- `status` is `upcoming`, `past` (including the shutdown day itself), or `on-upgrade`. `countsTowardExit` says whether the finding set exit code 1.
- `workflowActive` and `workflowArchived` appear when the export includes them.
- Endpoint findings carry `endpoint` (for example `"/v1/threads"`, `"OpenAI-Beta: realtime=v1"`, or `"prompt object pmpt_abc123"`) instead of `model`.
- `skipped` lists files with the reason no workflow was read, and `warnings` holds every warning that the table output would print to stderr.
- With `--json`, errors are printed on stdout too: `{ "tool": "n8n-sunset", "error": { "message": "..." }, "exitCode": 2 }`.

## Development

```bash
npm install
npm test          # vitest, with a fixture workflow for every rule
npm run typecheck
npm run build
```

`npm publish` runs the typecheck and the tests first (`prepublishOnly`), then builds (`prepack`).

## License

[MIT](LICENSE)
