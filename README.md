# n8n-sunset

Scan n8n workflows for what is about to break:

- **OpenAI model shutdowns**: deprecated model IDs in OpenAI nodes, in HTTP Request nodes calling `api.openai.com`, and in Code node source.
- **OpenAI endpoint shutdowns**: calls to deprecated endpoints such as the Assistants API (`/v1/assistants`, `/v1/threads`), the Videos API, and reusable prompt objects, in HTTP Request and Code nodes and in n8n's own OpenAI nodes.
- **n8n 3.0**: removed nodes, removed node versions and options, and behavior changes you can see in workflow JSON. These apply when you upgrade, not on a date.

It reads workflows straight from a running n8n through its public API (`--from-api`), or from exported JSON files. Each finding shows the workflow, the node, what breaks, when, and the suggested replacement. The exit code is 1 when an OpenAI shutdown takes effect within 30 days or already has, so you can run it in CI. Add `--target 3.0` to also fail on what breaks when you upgrade to n8n 3.0.

## How this differs from n8n's Migration Report

n8n 2.x has a built-in [Migration Report](https://docs.n8n.io/changelog/v20-migration-tool) under **Settings > Migration Report**. It checks a running instance for n8n's own breaking changes, for n8n 2.0 and for n8n 3.0: the [n8n 3.0 breaking changes page](https://docs.n8n.io/changelog/v30-breaking-changes) points to it, and n8n's source at n8n@2.41.5 has [26 v3 rules](https://github.com/n8n-io/n8n/tree/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/cli/src/modules/breaking-changes/rules/v3) that check both workflows and instance settings. Only global owners and admins can open it (the `breakingChanges:list` scope).

Use the Migration Report to prepare an n8n upgrade. Use n8n-sunset for what the report doesn't do:

- **OpenAI shutdowns.** The report checks n8n's breaking changes only; none of its rules look at OpenAI model IDs or endpoints, which OpenAI retires on its own schedule, whether or not you upgrade n8n.
- **CI and scheduled checks.** n8n-sunset runs anywhere Node.js runs and sets an exit code, so a scheduled job fails before a shutdown date. It needs an API key or exported files, not an owner or admin login.
- **Offline.** It can scan exported JSON, such as workflows kept in Git, without a running instance.

The report covers more of n8n 3.0 than n8n-sunset does: instance settings (environment variables, Docker-only deployment, storage paths, the task runner timeout) aren't in workflow JSON, so n8n-sunset can't see them. A few workflow checks exist only in n8n-sunset, such as `$evaluateExpression()` in Code nodes and Webflow version 1 with OAuth2, which have no rule in the report at n8n@2.41.5. Before upgrading to n8n 3.0, run both.

## Example

Running it on the three workflows in [`examples/workflows`](examples/workflows), in a 100-column terminal:

<!-- example-table:start -->
```
$ npx n8n-sunset@latest examples/workflows --as-of 2026-10-02

n8n-sunset  ·  3 workflows scanned  ·  as of 2026-10-02 (UTC)  ·  window 30 days

Upcoming shutdowns (2 findings)

SEVERITY  WHEN        WORKFLOW       NODE           WHAT BREAKS                  REPLACEMENT
────────  ──────────  ─────────────  ─────────────  ───────────────────────────  ───────────────────
BREAKING  2026-10-23  Lead           Score lead     OpenAI shuts down model      gpt-5.6-sol
          in 21d      enrichment                    "gpt-4" (alias of
                                                    gpt-4-0613); API calls will
                                                    fail.
                                                    at HTTP Request to
                                                    api.openai.com: jsonBody

BREAKING  2026-11-30  Lead           Summarize      OpenAI shuts down reusable   Move reusable
          in 59d      enrichment     lead           prompt objects (prompt       prompt content into
                                                    object                       your application
                                                    pmpt_68d1lead0summary);      code (see OpenAI's
                                                    calls will fail.             "Migrate from
                                                    at Code node source: jsCode  prompt objects"
                                                                                 guide)

Already shut down (2 findings)

SEVERITY  WHEN        WORKFLOW       NODE           WHAT BREAKS                  REPLACEMENT
────────  ──────────  ─────────────  ─────────────  ───────────────────────────  ───────────────────
BREAKING  2026-08-26  Support bot    Ask helpdesk   OpenAI has shut down the     OpenAI node version
          37d ago                    assistant      Assistants API               2: the Text
                                                    (/v1/threads), which this    resource's "Message
                                                    node's "Message an           a Model" operation
                                                    Assistant" operation calls;  (Responses API) or
                                                    calls fail.                  the Conversation
                                                    at OpenAI node:              resource
                                                    resource=assistant,          (Conversations API)
                                                    operation=message (default)

BREAKING  2025-10-27  Weekly digest  OpenAI Chat    OpenAI has shut down model   o4-mini
          340d ago    (inactive)     Model          "o1-mini"; API calls fail.
                                                    at OpenAI node parameter:
                                                    model.value

Breaks on upgrade to n8n 3.0 (3 findings)

SEVERITY  WHEN        WORKFLOW       NODE           WHAT BREAKS                  REPLACEMENT
────────  ──────────  ─────────────  ─────────────  ───────────────────────────  ───────────────────
BREAKING  breaks on   Lead           Keep hot       Function node is removed in  Code node in "Run
          upgrade to  enrichment     leads          n8n 3.0.                     Once for All Items"
          n8n 3.0                                                                mode

BREAKING  breaks on   Weekly digest  Digest agent   AI Agent node version 1.x    Update the node to
          upgrade to  (inactive)                    is removed in n8n 3.0,       the latest AI Agent
          n8n 3.0                                   along with its agent modes   version (Tools
                                                    (SQL, Conversational,        Agent behaves the
                                                    OpenAI Functions, Plan and   same). For SQL
                                                    Execute, ReAct).             Agent, use a
                                                    (typeVersion 1.7)            Postgres or MySQL
                                                                                 tool sub-node with
                                                                                 a recent AI Agent.

BREAKING  breaks on   Weekly digest  Monday 8am     Cron node is removed in n8n  Schedule Trigger
          upgrade to  (inactive)                    3.0.                         node
          n8n 3.0

7 findings in 7 nodes across 3 workflows: 7 breaking, 0 behavior changes, 0 warnings, 0 info.
Data: n8n 3.0 changes apply when you upgrade (the release is scheduled for 2026-10); OpenAI shutdown
dates from https://developers.openai.com/api/docs/deprecations. Registry 2026-10-01.

3 breaking findings in 3 nodes across 3 workflows take effect within 30 days or already have.
3 breaking findings in 3 nodes break on upgrade to n8n 3.0; add --target 3.0 to fail on them.
```
<!-- example-table:end -->

The exit code is 1. [`test/readme.test.ts`](test/readme.test.ts) runs this command and compares its output with the block above byte for byte (after normalizing line endings), so the example can't drift from what the tool prints.

Findings come in sections: upcoming shutdowns (soonest first), shutdowns that already happened (most recent first), then what breaks, changes, or is otherwise affected on upgrade to n8n 3.0. Below 90 columns, each finding is printed as a block instead of a table row.

## Usage

Requires Node.js 20 or later. Always run the latest version:

```bash
npx n8n-sunset@latest --from-api        # straight from n8n
npx n8n-sunset@latest ./workflows       # from exported files
```

`@latest` matters: the shutdown dates ship inside the package, and OpenAI announces new deprecations all the time. n8n-sunset warns when its data is more than 30 days older than the date you scan for, and fails (exit 2) once it is more than 90 days older; change that limit with `--max-registry-age`.

### From the n8n API

```bash
export N8N_API_URL=https://<your-name>.app.n8n.cloud/api/v1   # self-hosted: https://<host>/api/v1
export N8N_API_KEY=<your-api-key>
npx n8n-sunset@latest --from-api
```

Create the key under **Settings > n8n API** ([authentication](https://docs.n8n.io/connect/n8n-api/authentication)); the API isn't available during the n8n Cloud free trial. n8n-sunset pages through `GET /workflows` with the largest page the API allows (250 workflows, see [pagination](https://docs.n8n.io/connect/n8n-api/pagination)), leaves out pinned test data (`excludePinnedData=true`), and scans everything in memory: nothing is written to disk, and the key is never printed. The scan covers the workflows the API returns for the key's user. Each finding points at the workflow in the n8n editor (`https://<host>/workflow/<id>`).

### From exported files (offline)

n8n-sunset reads every `.json` file in the folders you pass, including subfolders. It skips `node_modules` and dot-folders, reads each file once even when paths overlap (`./workflows ./workflows/a.json`), and doesn't follow symbolic links. It understands:

- single-workflow exports and arrays of workflows (`n8n export:workflow`);
- n8n API responses (`{ "data": [...], "nextCursor": ... }`);
- n8n.io templates, both `{ "workflow": { "nodes": [...] } }` and the templates API's `{ "workflow": { "name": ..., "workflow": { "nodes": [...] } } }`.

A JSON file that can't be parsed or holds no workflow, and a symbolic link, is listed with the reason (for example `JSON object without a "nodes" array` or `symbolic link, not followed`) and makes the run exit 2, unless you pass `--allow-skipped`.

Self-hosted, with the n8n CLI. Remove the old export first, so workflows deleted since then don't linger:

```bash
rm -rf workflows
n8n export:workflow --backup --output=./workflows/
npx n8n-sunset@latest ./workflows
```

`--backup` exports every workflow to its own file (`--all --pretty --separate`); see [n8n's CLI commands](https://docs.n8n.io/deploy/host-n8n/configure-n8n/use-the-command-line).

Self-hosted, with Docker. Export inside the container as the `node` user, then copy the files out. Clear both folders first: `docker cp` puts the folder *inside* `./workflows` if `./workflows` already exists, so a second run would scan old files in `./workflows/workflows`:

```bash
docker exec -u node n8n sh -c 'rm -rf /tmp/workflows && n8n export:workflow --backup --output=/tmp/workflows/'
rm -rf workflows
docker cp n8n:/tmp/workflows ./workflows
npx n8n-sunset@latest ./workflows
```

Replace `n8n` (the container name) with yours, as shown by `docker ps`.

### Options

| Option | Description |
| --- | --- |
| `--from-api` | Read workflows from the n8n API (`N8N_API_URL`, `N8N_API_KEY`) instead of files |
| `--json` | Print a JSON report instead of the table. Errors are printed as JSON too |
| `--days <n>` | Window for the exit code, in days (default: 30) |
| `--as-of <date>` | Measure dates from this day, `YYYY-MM-DD` (default: today in UTC) |
| `--target <version>` | Also fail on breaking changes on upgrade to this n8n version: `3.0` (or `3`) |
| `--allow-skipped` | Don't exit 2 for JSON files that aren't readable n8n workflows, or for symbolic links |
| `--max-registry-age <days>` | Exit 2 when the bundled data is older than this many days before `--as-of` (default: 90) |
| `--registry <path>` | Use this registry file instead of the bundled one |
| `--no-color` | Disable colors. `NO_COLOR` (when not empty) and `FORCE_COLOR=0` or `false` also turn colors off |

Dates are calendar days in UTC, so a CI runner gives the same result in any time zone.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No breaking finding takes effect within the window |
| `1` | A **breaking** OpenAI shutdown takes effect within the window, or already has. With `--target 3.0`, also any breaking change on upgrade to n8n 3.0 |
| `2` | A problem with the input or the data: usage error, unreadable path, no workflows found, a JSON file that isn't a readable n8n workflow or a symbolic link (unless `--allow-skipped`), an n8n API error, or a registry that is missing, invalid, or older than `--max-registry-age`. Takes precedence over 1 |

Only `BREAKING` findings affect the exit code, and only on enabled nodes:

- Findings on **disabled nodes** are shown, marked `(disabled, not counted)`, but never fail the run, because the node doesn't execute.
- **Inactive and archived workflows** are shown and marked `(inactive)` or `(archived)`. Their findings still count, because they can be run or reactivated.
- `CHANGE` (behavior change), `WARNING` (may break, needs review), and `INFO` findings are reported but never fail the run.

## In CI

OpenAI shutdowns happen whether or not you touch your workflows, so the useful setup is a scheduled job that reads the current workflows from n8n. A GitHub Actions example that runs every weekday:

```yaml
name: n8n-sunset
on:
  schedule:
    - cron: "0 6 * * 1-5"   # 06:00 UTC, Monday to Friday
  workflow_dispatch:

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Scan n8n workflows
        env:
          N8N_API_URL: ${{ secrets.N8N_API_URL }}   # https://<your-name>.app.n8n.cloud/api/v1
          N8N_API_KEY: ${{ secrets.N8N_API_KEY }}
        run: npx n8n-sunset@latest --from-api
```

The job fails in two cases, and both need attention:

- **Exit 1**: a breaking OpenAI shutdown takes effect within 30 days, or already has. Fix the workflows the report lists.
- **Exit 2**: something is wrong with the input or the data: the API rejected the key or couldn't be reached, or n8n-sunset's bundled data is older than `--max-registry-age` (90 days). The log says which.

Before upgrading n8n, run once more with `--target 3.0`. If your workflows live in a Git repository (for example through n8n's source control), scan the files on every push instead: `npx n8n-sunset@latest ./workflows`.

## What it checks

### n8n 3.0

n8n 3.0 changes take effect when an instance is upgraded, not on a calendar date: self-hosted instances keep running 2.x until you upgrade them. These findings are labeled "breaks on upgrade to n8n 3.0" (or "changes on upgrade" for behavior changes), have no date, and only affect the exit code with `--target 3.0`. The docs say 3.0 is scheduled for October 2026; that date is shown for information only.

| Rule | Severity | Flags |
| --- | --- | --- |
| `n8n3/removed-node` | breaking | 36 node types removed in 3.0: Function, Function Item, Item Lists, Cron, Interval, HTML Extract, iCalendar, Read/Write Binary File(s), Read PDF, Workflow Trigger, Orbit, legacy OpenAI, OpenAI Assistant, OpenAI Model, legacy HTTP Request Tool, SerpApi, Manual Chat Trigger, Motorhead, Zep, the old document loaders and Insert/Load vector store nodes, and more |
| `n8n3/removed-node` | info | AI Transform (n8n migrates it to a Code node automatically) |
| `n8n3/ai-agent-v1` | breaking | AI Agent node version 1.x and its agent modes |
| `n8n3/execute-workflow-each-mode` | breaking | Execute Sub-workflow in "Run once for each item" mode. Not on the breaking changes page; from n8n's source and its Migration Report rule |
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

- **OpenAI nodes** (any node type containing "openai", or using OpenAI credentials): the model parameter, including expressions such as `={{ $json.premium ? 'gpt-4-turbo' : 'gpt-4o-mini' }}`. For resource locators it reads only the `value`, never the editor's cached display name. If the node's `options.baseURL` points somewhere other than `api.openai.com` (for example OpenRouter), the finding is an unverified **warning**, because another provider serves the model on its own schedule.
- **HTTP Request nodes calling OpenAI** (the url field is on `api.openai.com`, with or without a port, or an expression URL plus OpenAI credentials): model IDs in the url field, quoted model IDs in the request body text, and `model` name/value pairs in body or query parameters. That covers every node version: `jsonBody`, `body`, `jsonQuery`, `bodyParameters`, and `queryParameters` from version 3, and `bodyParametersJson`, `queryParametersJson`, `bodyParametersUi`, and `queryParametersUi` in versions 1 and 2. Headers and options are not read for models. Requests to any other host are ignored, even with OpenAI credentials.
- **Code nodes** (JavaScript and Python, plus the legacy Function nodes): model IDs in string literals. Identifiers and comments are ignored, so `const o1 = 1` is not reported.
- **Any other node**: values assigned to a field named "model", such as an Edit Fields (Set) assignment. These are unverified **warnings**, since the value may never reach OpenAI.

Also matched:

- dated snapshots of model families listed as such (for example `gpt-realtime-2025-08-28`);
- fine-tuned IDs (`ft:<base>:...`), matched by their base model and marked unverified;
- legacy `/v1/fine-tunes` models (`curie:ft-acme-2021-08-23-17-54-10`), shut down on 2024-01-04, including the form with a custom suffix (`ada:ft-your-org:custom-model-name-2022-02-15-04-21-04`), which is marked unverified;
- provider-prefixed IDs as used by OpenRouter (`openai/gpt-4`), reported as unverified warnings.

The replacement shown for each model is the one OpenAI's deprecations page recommends, copied as written (for example `gpt-5.6-sol`).

### OpenAI endpoints (`openai/endpoint-shutdown`)

Every endpoint, API, and beta header that OpenAI's deprecations page lists as shut down or scheduled to shut down. The last column quotes OpenAI's recommended replacement word for word:

| Endpoint | Shutdown | OpenAI's recommendation (quoted) |
| --- | --- | --- |
| Assistants API: `/v1/assistants`, `/v1/threads` (and everything below them) | 2026-08-26 | "Responses API and Conversations API" |
| Videos API: `/v1/videos` | 2026-09-24 | none listed ("—") |
| Reusable prompt objects: `/v1/prompts`, and Responses calls that reference one (`"prompt": {"id": "pmpt_..."}`) | 2026-11-30 | "To migrate, move reusable prompt content into your application code. See Migrate from prompt objects." |
| Evals API: `/v1/evals` (read-only from 2026-10-31) | 2026-11-30 | "See Moving from OpenAI Evals to Promptfoo for a migration path." |
| Creating fine-tuning jobs: `POST /v1/fine_tuning/jobs` | 2027-01-06 (earlier for some organizations) | none listed |
| Realtime API Beta: header `OpenAI-Beta: realtime=v1` | 2026-05-12 | "Realtime API" |
| Assistants API beta v1: header `OpenAI-Beta: assistants=v1` | 2024-12-18 | "OpenAI-Beta: assistants=v2" (the Assistants API itself shut down later) |
| `/v1/fine-tunes`, `/v1/edits` | 2024-01-04 | "/v1/fine_tuning/jobs", "/v1/chat/completions" |
| `/v1/engines` | 2022-12-03 | "/v1/models" |
| `/v1/search`, `/v1/classifications`, `/v1/answers` | 2022-12-03 | "View transition guide" (the help articles the page links to no longer exist; checked 2026-10-02) |

In the tool's output, a few of these are reworded to name the guide, or to say that its link is dead.

**Replacements are OpenAI's recommendations, not a compatibility guarantee:** a recommended model or API can behave differently, so test your workflow after switching.

Where it looks:

- **HTTP Request nodes calling OpenAI** (including the HTTP Request tool for AI Agents): endpoint paths in the url field only, including `={{ $vars.OPENAI_BASE }}/threads`-style URLs when the node uses OpenAI credentials; `OpenAI-Beta` values in the headers (`headerParameters` and `jsonHeaders`, or `headerParametersUi` and `headerParametersJson` in versions 1 and 2); and quoted prompt object IDs (`pmpt_...`) in the request body. The fine-tuning entry only matches `POST` requests to the exact path.
- **Code nodes** that mention `api.openai.com` or an `OpenAI-Beta` header: paths inside `api.openai.com` URLs or in string literals that start with the path (`'/v1/threads'`), `OpenAI-Beta` header values, and quoted prompt object IDs. A path in a comment or in prose is not reported, and neither are URLs on other hosts.
- **n8n nodes that call these APIs themselves.** The finding's location names the settings that select the call, such as `OpenAI node: resource=assistant, operation=message (default)`; `(default)` marks a setting the export leaves out because it has n8n's default value.
  - The **OpenAI node** (`@n8n/n8n-nodes-langchain.openAi`) at type versions 1 to 1.8 with the "Assistant" resource. "Message an Assistant" (the default operation) calls `/v1/threads`; Create, Delete, List, and Update an Assistant call `/v1/assistants`. Version 2 has no Assistant resource; the suggested replacement is its Text "Message a Model" operation (Responses API) or its Conversation resource (Conversations API).
  - The **OpenAI node** at type versions 2 to 2.3 with the "Video" resource. Its only operation, Generate, calls the Videos API (`/v1/videos`), which shut down on 2026-09-24. OpenAI lists no replacement.
  - The **OpenAI node** at type versions 2 to 2.3, Text resource, "Message a Model" operation, with a Prompt ID set in its "Prompt" option. n8n sends it to the Responses API as a reusable prompt object reference.
  - The **OpenAI Assistant node** (`@n8n/n8n-nodes-langchain.openAiAssistant`), all versions. Both of its operations, "Use Existing Assistant" (the default) and "Use New Assistant", call `/v1/assistants` and then run the assistant on a thread (`/v1/threads`). It has been failing since 2026-08-26. n8n 3.0 also removes this node, and that finding is still reported in the upgrade section. Because the n8n docs suggest the OpenAI node's "Assistant" resource as its replacement, which calls the same shut-down API, n8n-sunset suggests the OpenAI node version 2 instead.

## Limitations

- **Model IDs in code and request bodies only count when quoted.** In Code nodes, in HTTP request bodies, and in OpenAI node model fields, a model ID is recognized only as a string literal such as `'gpt-4'` or `"gpt-4"`. This keeps a variable named `o1` or a prompt that mentions "davinci" from being reported, but it misses IDs assembled at run time (`'gpt-' + version`), IDs read from data, and IDs inside a longer string such as a URL built in code.
- **HTTP Request nodes with generic authentication need a literal OpenAI URL.** A node that sends the OpenAI key through generic credentials (for example Header Auth with `Authorization: Bearer ...`) is only recognized when its url field literally contains `https://api.openai.com/...`. If the URL comes from an expression such as `={{ $vars.OPENAI_URL }}/chat/completions`, n8n-sunset can't tell the node calls OpenAI and checks nothing. Use the predefined OpenAI credential type, or a literal URL, to be covered.
- **OpenAI-compatible providers are not checked.** Groq, Together, DeepSeek, local servers, and other APIs that copy OpenAI's request format retire models on their own schedules, so OpenAI's dates don't apply. HTTP Request nodes calling them are ignored, and an OpenAI node pointed at one through `options.baseURL` only produces warnings. Azure OpenAI is skipped entirely: it uses deployment names and its own retirement schedule. Model IDs named `openai/<model>` (OpenRouter style) are reported as warnings.
- **OpenAI credentials with a custom base URL can't be seen.** The credential's own base URL isn't part of a workflow export or of the API's workflow data, so a node that relies on it (rather than `options.baseURL`) is treated as calling OpenAI.
- **Endpoints in code need the full path.** A Code node that builds URLs from a base variable (`` `${base}/threads` ``) is not flagged, and neither are OpenAI SDK calls (`openai.beta.threads.create`). Code that doesn't mention `api.openai.com` is not checked for endpoints at all. In code the request method is unknown, so the `POST`-only fine-tuning entry is reported as unverified there.
- **Only these n8n node usages are checked for built-in endpoint calls:** the OpenAI node's "Assistant" resource (versions 1 to 1.8), its "Video" resource and "Message a Model" prompt option (versions 2 to 2.3), and the OpenAI Assistant node. Other n8n nodes that call OpenAI internally, such as the OpenAI Chat Model, are checked for deprecated models only.
- **Instance-level n8n 3.0 changes** you won't find in workflow JSON are out of scope: the Docker-only deployment requirement, environment variables, SSRF block list, storage paths, the task runner timeout, Chat Hub, and others. See the [n8n 3.0 breaking changes](https://docs.n8n.io/changelog/v30-breaking-changes) page, and n8n's Migration Report, for those.

## Data and sources

All dates and replacements live in [`data/sunset-registry.json`](data/sunset-registry.json). Each entry cites its source and access date (2026-10-01, or 2026-10-02 for the Migration Report and openai-python); GitHub links are pinned to the commit that was read:

| Source | Used for |
| --- | --- |
| [docs.n8n.io/changelog/v30-breaking-changes](https://docs.n8n.io/changelog/v30-breaking-changes) ([n8n-docs at `49668e5`](https://github.com/n8n-io/n8n-docs/blob/49668e57cd44ee74931c735366b19d7e2725d8fa/docs/changelog/v30-breaking-changes.md)) | What n8n 3.0 removes or changes, the scheduled month, and the replacements |
| [n8n source at n8n@2.41.5 (`a9c858b`)](https://github.com/n8n-io/n8n/tree/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages) and the [3.x branch at `599ca71`](https://github.com/n8n-io/n8n/tree/599ca716ee91b06d8f2026d432f8a09a9953f0a8) | The node type IDs behind the display names in the docs, node versions, and parameter defaults. The removed nodes are confirmed to be absent from the 3.x branch |
| [n8n's Migration Report rules (`a9c858b`)](https://github.com/n8n-io/n8n/tree/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/cli/src/modules/breaking-changes) | The Execute Sub-workflow "Run once for each item" removal, which the docs page doesn't list, and what the Migration Report covers |
| [n8n OpenAI node source (`a9c858b`)](https://github.com/n8n-io/n8n/tree/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/@n8n/nodes-langchain/nodes/vendors/OpenAi) | Which type versions have the "Assistant" and "Video" resources and the "Message a Model" prompt option (`OpenAi.node.ts` maps 1 to 1.8 to `v1/OpenAiV1.node.ts` and 2 to 2.3 to `v2/OpenAiV2.node.ts`), the resource and operation values, and the endpoints each operation calls |
| [n8n OpenAI Assistant node source (`a9c858b`)](https://github.com/n8n-io/n8n/blob/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/@n8n/nodes-langchain/nodes/agents/OpenAiAssistant/OpenAiAssistant.node.ts) and [LangChain's `OpenAIAssistantRunnable` (`6b914bc`)](https://github.com/langchain-ai/langchainjs/blob/6b914bceb4acd4664b12091770a2ddcbf5d8457e/libs/langchain-classic/src/experimental/openai_assistant/index.ts) (`@langchain/classic` 1.0.27, the version n8n uses) | The OpenAI Assistant node's versions, its `mode` parameter, and its Assistants API calls: `beta.assistants.update` or `createAssistant`, then `beta.threads` runs |
| [developers.openai.com/api/docs/deprecations](https://developers.openai.com/api/docs/deprecations) (formerly platform.openai.com/docs/deprecations, which now redirects there) | Model IDs, aliases, deprecated endpoints, beta headers, shutdown dates, and recommended replacements |
| [OpenAI OpenAPI spec (`c300cf2`)](https://github.com/openai/openai-openapi/blob/c300cf282956e5f29c23f00def1d68ab44f8d7ab/openapi.yaml) and the [Assistants migration guide](https://developers.openai.com/api/docs/assistants/migration) | The URL paths behind entries the deprecations page names only as a product (Assistants API, Videos API, Evals API, creating fine-tuning jobs). In the spec, `/assistants` and `/threads` are tagged "Assistants", and the guide covers threads, messages, and runs as part of the Assistants API |
| [OpenAI's "Migrate from prompt objects" guide](https://developers.openai.com/api/docs/guides/prompting/migrate-from-prompt-object) | Responses calls with `prompt: { id: "pmpt_..." }` are the usage to migrate away from before prompt objects shut down |
| [OpenAI Cookbook legacy fine-tuning example (`2182005`)](https://github.com/openai/openai-cookbook/blob/2182005bcaf5a5cdd96bb46fb9995d08730e7b91/examples/fine-tuned_qa/olympics-3-train-qa.ipynb) and [openai-python v0.28.1 (`f7ccce1`)](https://github.com/openai/openai-python/blob/f7ccce126325ea35b6e5224ab954652c97a74896/openai/cli.py) | The ID formats of legacy `/v1/fine-tunes` models: `curie:ft-<org>-<timestamp>`, and `{base_model}:ft-{org-title}:{suffix}-{timestamp}` when created with a suffix |
| [n8n API pagination](https://docs.n8n.io/connect/n8n-api/pagination) and the [`limit` parameter in n8n's API spec (`a9c858b`)](https://github.com/n8n-io/n8n/blob/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/cli/src/public-api/v1/shared/spec/parameters/limit.yml) | `--from-api` paging: `cursor` and `nextCursor`, and the 250-workflow maximum page size |

Anything that could not be fully confirmed from the official page is marked `unverified`. That covers dates that conflict on the page itself, multi-output nodes the docs don't name, fine-tuned model matches, legacy fine-tunes with a suffix, method-specific endpoints found in code, and every warning. Unverified findings show `[unverified]` in the table and carry a `verificationNote` in the JSON.

## JSON output

`--json` prints a report with every finding. This is the real output for the example above, cut down to the summary and the first finding:

<!-- example-json:start -->
```
$ npx n8n-sunset@latest examples/workflows --as-of 2026-10-02 --json | jq '{exitCode, summary, firstFinding: .findings[0]}'
{
  "exitCode": 1,
  "summary": {
    "workflowsScanned": 3,
    "findings": 7,
    "nodesAffected": 7,
    "workflowsAffected": 3,
    "breaking": 7,
    "behaviorChanges": 0,
    "warnings": 0,
    "info": 0,
    "upcoming": 2,
    "past": 2,
    "onUpgrade": 3,
    "exitFindings": 3,
    "exitNodes": 3,
    "exitWorkflows": 3,
    "filesSkipped": 0,
    "fileErrors": 0,
    "symlinksNotFollowed": 0
  },
  "firstFinding": {
    "category": "openai-model",
    "ruleId": "openai/model-shutdown",
    "severity": "breaking",
    "message": "OpenAI shuts down model \"gpt-4\" (alias of gpt-4-0613); API calls will fail.",
    "replacement": "gpt-5.6-sol",
    "verification": "verified",
    "sources": [
      "https://developers.openai.com/api/docs/deprecations"
    ],
    "model": "gpt-4",
    "locations": [
      "HTTP Request to api.openai.com: jsonBody"
    ],
    "workflow": "Lead enrichment",
    "workflowId": "Lp4Nv8LeadEnrich",
    "workflowActive": true,
    "file": "examples/workflows/lead-enrichment.json",
    "node": "Score lead",
    "nodeType": "n8n-nodes-base.httpRequest",
    "nodeDisabled": false,
    "trigger": "date",
    "date": "2026-10-23",
    "when": "2026-10-23",
    "daysUntil": 21,
    "status": "upcoming",
    "withinWindow": true,
    "countsTowardExit": true
  }
}
```
<!-- example-json:end -->

The full report also has `asOf`, `windowDays`, `targets`, `registry` (version, the n8n release note, and every source), `findings`, `warnings`, `skipped`, `errors`, and `symlinks`.

- `category` is `n8n-3.0`, `openai-model`, or `openai-endpoint`; `severity` is `breaking`, `behavior-change`, `warning`, or `info`.
- `trigger` is `date` for OpenAI shutdowns and `upgrade` for n8n 3.0. Upgrade findings have `date` and `daysUntil` set to `null`, `upgradeTo: "3.0"`, `status: "on-upgrade"`, and a `when` label such as `"breaks on upgrade to n8n 3.0"`.
- `status` is `upcoming`, `past` (including the shutdown day itself), or `on-upgrade`. `countsTowardExit` says whether the finding set exit code 1.
- `file` is the file path, or with `--from-api` the workflow's URL in the n8n editor. `workflowActive` and `workflowArchived` appear when the source includes them.
- Endpoint findings carry `endpoint` (for example `"/v1/threads"`, `"OpenAI-Beta: realtime=v1"`, or `"prompt object pmpt_abc123"`) instead of `model`.
- `skipped` lists files with the reason no workflow was read (symbolic links included), and `warnings` holds every warning that the table output would print to stderr.
- With `--json`, errors are printed on stdout too: `{ "tool": "n8n-sunset", "error": { "message": "..." }, "exitCode": 2 }`.

## Development

```bash
npm install
npm test          # vitest: a fixture workflow for every rule, a mock n8n API, and the README examples
npm run typecheck
npm run build
```

`npm publish` runs the typecheck and the tests first (`prepublishOnly`), then builds (`prepack`).

## License

[MIT](LICENSE)
