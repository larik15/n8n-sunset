# n8n-sunset

[![CI](https://github.com/larik15/n8n-sunset/actions/workflows/ci.yml/badge.svg)](https://github.com/larik15/n8n-sunset/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/n8n-sunset)](https://www.npmjs.com/package/n8n-sunset)
[![License: MIT](https://img.shields.io/github/license/larik15/n8n-sunset)](LICENSE)

[12.7% of 11,075 public n8n workflows on GitHub hit a dated model shutdown; 23.6% break on n8n 3.0.](STUDY.md)

Scan n8n workflows for what is about to break:

- **OpenAI model shutdowns**: deprecated model IDs in OpenAI nodes, in HTTP Request nodes calling `api.openai.com`, and in Code node source.
- **OpenAI endpoint shutdowns**: calls to deprecated endpoints such as the Assistants API (`/v1/assistants`, `/v1/threads`), the Videos API, and reusable prompt objects, in HTTP Request and Code nodes and in n8n's own OpenAI nodes.
- **Anthropic model retirements**: retired or soon-to-retire Claude model IDs in the Anthropic Chat Model and Anthropic nodes (the Chat Model is what an AI Agent or chain uses), in HTTP Request nodes calling `api.anthropic.com`, and in Code node source.
- **Google Gemini model shutdowns**: Gemini API model IDs in the Google Gemini nodes (chat model, Gemini, embeddings), in HTTP Request nodes calling `generativelanguage.googleapis.com`, and in Code node source.
- **Models n8n uses without naming them**: an Anthropic Chat Model left at its default model, the OpenAI node's text to speech (default `tts-1`) and its Transcribe and Translate operations (always `whisper-1`), and the Google Gemini node's image generation (default `gemini-3.1-flash-image-preview`). n8n doesn't save default values, so these are invisible to a plain model search.
- **n8n 3.0**: removed nodes, removed node versions and options, and behavior changes you can see in workflow JSON. These apply when you upgrade, not on a date.

It reads workflows straight from a running n8n through its public API (`--from-api`), or from exported JSON files. Each finding shows the workflow, the node, what breaks, when, and the suggested replacement. The exit code is 1 when an OpenAI, Anthropic, or Gemini shutdown takes effect within 30 days or already has, so you can run it in CI. Add `--target 3.0` to also fail on what breaks when you upgrade to n8n 3.0.

## How this differs from n8n's Migration Report

n8n 2.x has a built-in [Migration Report](https://docs.n8n.io/changelog/v20-migration-tool) under **Settings > Migration Report**. It checks a running instance for n8n's own breaking changes, for n8n 2.0 and for n8n 3.0: the [n8n 3.0 breaking changes page](https://docs.n8n.io/changelog/v30-breaking-changes) points to it, and n8n's source at n8n@2.41.5 has [26 v3 rules](https://github.com/n8n-io/n8n/tree/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/cli/src/modules/breaking-changes/rules/v3) that check both workflows and instance settings. Only global owners and admins can open it (the `breakingChanges:list` scope).

Use the Migration Report to prepare an n8n upgrade. Use n8n-sunset for what the report doesn't do:

- **Model and endpoint shutdowns.** The report checks n8n's breaking changes only; none of its rules look at OpenAI, Anthropic, or Gemini model IDs, or at OpenAI endpoints, which the providers retire on their own schedules, whether or not you upgrade n8n.
- **CI and scheduled checks.** n8n-sunset runs anywhere Node.js runs and sets an exit code, so a scheduled job fails before a shutdown date. It needs an API key or exported files, not an owner or admin login.
- **Offline.** It can scan exported JSON, such as workflows kept in Git, without a running instance.

The report covers more of n8n 3.0 than n8n-sunset does: instance settings (environment variables, Docker-only deployment, storage paths, the task runner timeout) aren't in workflow JSON, so n8n-sunset can't see them. A few workflow checks exist only in n8n-sunset, such as `$evaluateExpression()` in Code nodes and Webflow version 1 with OAuth2, which have no rule in the report at n8n@2.41.5. Before upgrading to n8n 3.0, run both.

## Example

Running it on the three workflows in [`examples/workflows`](examples/workflows), in a 100-column terminal:

<!-- example-table:start -->
```
$ npx n8n-sunset@latest examples/workflows --as-of 2026-10-02

n8n-sunset  ·  3 workflows scanned  ·  as of 2026-10-02 (UTC)  ·  window 30 days

Upcoming shutdowns (3 findings)

SEVERITY  WHEN        WORKFLOW    NODE        WHAT BREAKS                         REPLACEMENT
────────  ──────────  ──────────  ──────────  ──────────────────────────────────  ──────────────────
BREAKING  2026-10-23  Lead        Score lead  OpenAI shuts down model "gpt-4"     gpt-5.6-sol
          in 21d      enrichment              (alias of gpt-4-0613); API calls
                                              will fail.
                                              at HTTP Request to api.openai.com:
                                              jsonBody

BREAKING  2026-11-30  Lead        Summarize   OpenAI shuts down reusable prompt   Move reusable
          in 59d      enrichment  lead        objects (prompt object              prompt content
                                              pmpt_68d1lead0summary); calls will  into your
                                              fail.                               application code
                                              at Code node source: jsCode         (see OpenAI's
                                                                                  "Migrate from
                                                                                  prompt objects"
                                                                                  guide)

BREAKING  2026-11-30  Weekly      Anthropic   Anthropic retires model             claude-sonnet-5-5
          in 59d      digest      Chat Model  "claude-sonnet-4-5" (alias of
                      (inactive)              claude-sonnet-4-5-20250929); API
                                              calls will fail.
                                              at Anthropic node parameter:
                                              model.value
                                              [unverified]

Past shutdown dates (4 findings)

SEVERITY  WHEN        WORKFLOW    NODE        WHAT BREAKS                         REPLACEMENT
────────  ──────────  ──────────  ──────────  ──────────────────────────────────  ──────────────────
BREAKING  2026-08-26  Support     Ask         OpenAI has shut down the            OpenAI node
          37d ago     bot         helpdesk    Assistants API (/v1/threads),       version 2: the
                                  assistant   which this node's "Message an       Text resource's
                                              Assistant" operation calls; calls   "Message a Model"
                                              fail.                               operation
                                              at OpenAI node:                     (Responses API) or
                                              resource=assistant,                 the Conversation
                                              operation=message (default)         resource
                                                                                  (Conversations
                                                                                  API)

BREAKING  2026-06-01  Lead        Ask Gemini  Google has shut down Gemini API     gemini-3.6-flash
          123d ago    enrichment              model "gemini-2.0-flash"; API
                                              calls fail.
                                              at HTTP Request to
                                              generativelanguage.googleapis.com:
                                              url

BREAKING  2025-10-28  Support     Classify    Anthropic has retired model         claude-sonnet-4-6
          339d ago    bot         intent      "claude-3-5-sonnet-20241022"; API
                                              calls fail.
                                              at Anthropic node parameter:
                                              model.value

BREAKING  2025-10-27  Weekly      OpenAI      OpenAI has shut down model          o4-mini (itself
          340d ago    digest      Chat Model  "o1-mini"; API calls fail.          shuts down on
                      (inactive)              at OpenAI node parameter:           2026-10-23; next:
                                              model.value                         gpt-5.6-terra)

Breaks on upgrade to n8n 3.0 (3 findings)

SEVERITY  WHEN        WORKFLOW    NODE        WHAT BREAKS                         REPLACEMENT
────────  ──────────  ──────────  ──────────  ──────────────────────────────────  ──────────────────
BREAKING  breaks on   Lead        Keep hot    Function node is removed in n8n     Code node in "Run
          upgrade to  enrichment  leads       3.0.                                Once for All
          n8n 3.0                                                                 Items" mode

BREAKING  breaks on   Weekly      Digest      AI Agent node version 1.x is        Update the node to
          upgrade to  digest      agent       removed in n8n 3.0, along with its  the latest AI
          n8n 3.0     (inactive)              agent modes (SQL, Conversational,   Agent version
                                              OpenAI Functions, Plan and          (Tools Agent
                                              Execute, ReAct). (typeVersion 1.7)  behaves the same).
                                                                                  For SQL Agent, use
                                                                                  a Postgres or
                                                                                  MySQL tool
                                                                                  sub-node with a
                                                                                  recent AI Agent.

BREAKING  breaks on   Weekly      Monday 8am  Cron node is removed in n8n 3.0.    Schedule Trigger
          upgrade to  digest                                                      node
          n8n 3.0     (inactive)

10 findings in 10 nodes across 3 workflows: 10 breaking, 0 behavior changes, 0 warnings, 0 info.
[unverified] = not fully confirmed from the official source; the --json output has the note for each
finding.
Data: n8n 3.0 changes apply when you upgrade (the release is scheduled for 2026-10); model shutdown
dates from https://developers.openai.com/api/docs/deprecations (OpenAI),
https://platform.claude.com/docs/en/about-claude/model-deprecations (Anthropic) and
https://ai.google.dev/gemini-api/docs/deprecations (Google Gemini). Registry 2026-10-06.

5 breaking findings in 5 nodes across 3 workflows take effect within 30 days or already have.
3 breaking findings in 3 nodes break on upgrade to n8n 3.0; add --target 3.0 to fail on them.
```
<!-- example-table:end -->

The exit code is 1. [`test/readme.test.ts`](test/readme.test.ts) runs this command and compares its output with the block above byte for byte (after normalizing line endings), so the example can't drift from what the tool prints.

Findings come in sections: upcoming shutdowns (soonest first), shutdowns that already happened (most recent first), then what breaks, changes, or is otherwise affected on upgrade to n8n 3.0. Below 90 columns, or when the table would have to split a model ID or host name across lines, each finding is printed as a block instead of a table row.

## Usage

Requires Node.js 20 or later. Always run the latest version:

```bash
npx n8n-sunset@latest --from-api        # straight from n8n
npx n8n-sunset@latest ./workflows       # from exported files
```

`@latest` matters: the shutdown dates ship inside the package, and the providers announce new deprecations all the time. n8n-sunset warns when its data is more than 14 days older than the date you scan for ("registry data from 2026-10-06 (15 days old); newer shutdowns may be missing"), and fails (exit 2) once it is more than 90 days older; change that limit with `--max-registry-age`. Preview models can go with very little notice: Google shut down `gemini-3-pro-preview` 11 days after announcing it, and OpenAI says preview models may get about two weeks. A 30-day window only catches those if the data is fresh, so in CI consider `--max-registry-age 30`, which fails the run when the package is a month old.

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
| `--skip-rule <id>` | Leave out the findings of one rule (`gemini/model-shutdown`) or category (`gemini-model`); repeat it for more. Unknown values are a usage error that lists the valid ones |
| `--ignore-model <id>` | Leave out the findings for one model ID as the workflow writes it (`claude-2.1`; a Gemini `models/` prefix is accepted), wherever it is found; repeat it for more. An ID the registry doesn't list gets a warning, since it may be a typo |
| `--allow-skipped` | Don't exit 2 for JSON files that aren't readable n8n workflows, or for symbolic links |
| `--max-registry-age <days>` | Exit 2 when the bundled data is older than this many days before `--as-of` (default: 90) |
| `--registry <path>` | Use this registry file instead of the bundled one |
| `--no-color` | Disable colors. `NO_COLOR` (when not empty) and `FORCE_COLOR=0` or `false` also turn colors off |

Dates are calendar days in UTC, so a CI runner gives the same result in any time zone.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No breaking finding takes effect within the window |
| `1` | A **breaking** OpenAI, Anthropic, or Gemini shutdown takes effect within the window, or already has. With `--target 3.0`, also any breaking change on upgrade to n8n 3.0 |
| `2` | A problem with the input or the data: usage error, unreadable path, no workflows found, a JSON file that isn't a readable n8n workflow or a symbolic link (unless `--allow-skipped`), an n8n API error, or a registry that is missing, invalid, or older than `--max-registry-age`. Takes precedence over 1 |

Only `BREAKING` findings affect the exit code, and only on enabled nodes:

- Findings on **disabled nodes** are shown, marked `(disabled, not counted)`, but never fail the run, because the node doesn't execute.
- **Inactive and archived workflows** are shown and marked `(inactive)` or `(archived)`. Their findings still count, because they can be run or reactivated.
- `CHANGE` (behavior change), `WARNING` (may break, needs review), and `INFO` findings are reported but never fail the run.

## In CI

Model shutdowns happen whether or not you touch your workflows, so the useful setup is a scheduled job that reads the current workflows from n8n. If a new rule fails your pipeline for a reason you have reviewed, leave it out with `--skip-rule` (for example `--skip-rule gemini/model-shutdown`), or leave out a single model with `--ignore-model`; the header and the JSON report's `skipRules` and `ignoreModels` say what was left out. A GitHub Actions example that runs every weekday:

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

- **Exit 1**: a breaking OpenAI, Anthropic, or Gemini shutdown takes effect within 30 days, or already has. Fix the workflows the report lists.
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

All 132 model IDs from OpenAI's deprecations page, with their aliases (for example `gpt-4` and `gpt-3.5-turbo`, which shut down on 2026-10-23). Where it looks:

- **OpenAI nodes** (any node type containing "openai", or using OpenAI credentials): the model parameter, including expressions such as `={{ $json.premium ? 'gpt-4-turbo' : 'gpt-4o-mini' }}`. For resource locators it reads only the `value`, never the editor's cached display name. If the node's `options.baseURL` points somewhere other than `api.openai.com` (for example OpenRouter), the finding is an unverified **warning**, because another provider serves the model on its own schedule. n8n only offers that option on the OpenAI Chat Model version 1, Embeddings OpenAI versions 1 and 1.1, and the legacy OpenAI Model node (checked at n8n@2.41.5); later versions take the base URL from the OpenAI credential, which the workflow doesn't contain (see [Limitations](#limitations)).
- **HTTP Request nodes calling OpenAI** (the url field is on `api.openai.com`, with or without a port, or an expression URL plus OpenAI credentials): model IDs in the url field, quoted model IDs in the request body text, and `model` name/value pairs in body or query parameters. That covers every node version: `jsonBody`, `body`, `jsonQuery`, `bodyParameters`, and `queryParameters` from version 3, and `bodyParametersJson`, `queryParametersJson`, `bodyParametersUi`, and `queryParametersUi` in versions 1 and 2. Headers and options are not read for models. Requests to any other host are ignored, even with OpenAI credentials.
- **Code nodes** (JavaScript and Python, plus the legacy Function nodes): model IDs in string literals. Identifiers and comments are ignored, so `const o1 = 1` and `// was 'gpt-4'` are not reported.
- **The OpenAI node's audio and image operations**, where the workflow JSON may not name a model: Audio > Generate (text to speech) left at its default uses `tts-1`, Audio > Transcribe and Translate always use `whisper-1`, and Image > Generate left at its default uses `dall-e-3` (node versions 1 to 2.1) or `gpt-image-1-mini` (2.2 and later). An empty model, including an empty resource locator, counts as left at its default. These findings are unverified, because n8n takes defaults from the installed version (checked at n8n@2.41.5). For text to speech, the replacement says that OpenAI's suggested model, `gpt-realtime-2.1-mini`, runs on the Realtime API, which connects over WebSocket or WebRTC, so neither the OpenAI node nor an HTTP Request node can call it. For Whisper, it says to call `/v1/audio/transcriptions` with an HTTP Request node, since the node always uses `whisper-1`.
- **Any other node**: values assigned to a field named "model", such as an Edit Fields (Set) assignment. These are unverified **warnings**, since the value may never reach OpenAI.

Also matched:

- dated snapshots of model families listed as such (for example `gpt-realtime-2025-08-28`);
- fine-tuned IDs (`ft:<base>:...`), matched by their base model and marked unverified;
- legacy `/v1/fine-tunes` models (`curie:ft-acme-2021-08-23-17-54-10`), shut down on 2024-01-04, including the form with a custom suffix (`ada:ft-your-org:custom-model-name-2022-02-15-04-21-04`), which is marked unverified;
- provider-prefixed IDs as used by OpenRouter (`openai/gpt-4`), reported as unverified warnings.

The replacement shown for each model is the one OpenAI's deprecations page recommends, copied as written (for example `gpt-5.6-sol`). When that replacement is itself shut down or goes within the window, the report says so and names the next model in the chain, for example `o4-mini (itself shuts down on 2026-10-23; next: gpt-5.6-terra)`. This works the same for Anthropic and Gemini.

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

### Anthropic models (`anthropic/model-retirement`)

All 20 model IDs that Anthropic's [model deprecations page](https://platform.claude.com/docs/en/about-claude/model-deprecations) lists with a retirement date, each with the replacement Anthropic recommends, plus:

- **Aliases.** Anthropic's [model-IDs page](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions) says that models before the 4.6 generation have a dateless alias per minor version that points to the latest snapshot, and names `claude-sonnet-4-5` as an example. n8n-sunset also matches `claude-opus-4-1`, `claude-opus-4-0`, and `claude-sonnet-4-0`, which follow from that rule (the `-0` form is an inference: Claude 4.0 IDs have no minor segment). The page doesn't say when an alias stops working, so **alias matches are unverified**; n8n-sunset assumes an alias retires with its snapshot.
- **n8n's own option values** `claude-2` ("LEGACY: Claude 2", the default of the Anthropic Chat Model version 1) and `claude-instant-1`, which aren't IDs on Anthropic's page. Their dates are those of the models they stand for, and the findings are unverified.

Still ahead, as of registry 2026-10-06:

| Retirement | Model | Anthropic's recommended replacement |
| --- | --- | --- |
| 2026-11-30 | `claude-sonnet-4-5-20250929` (alias `claude-sonnet-4-5`) | `claude-sonnet-5-5` |

The other 21 entries have already been retired, from `claude-1.0` (2024-11-06) to `claude-opus-4-1-20250805` (2026-08-05). Only models with an announced date are reported: active models that the page shows with "Not sooner than ..." are floors, not announcements, and `claude-mythos-preview` is deprecated with its retirement "to be announced". The full list, with dates, replacements, and the page section that announced each one, is in the registry file.

Where it looks:

- **Anthropic nodes** (any node type containing "anthropic", or using Anthropic credentials): the Anthropic Chat Model, which AI Agents and chains use as their model, and the Anthropic node. It reads the model parameter, including expressions such as `={{ $json.large ? 'claude-opus-4-1-20250805' : 'claude-haiku-4-5-20251001' }}`, and only the `value` of a resource locator, never the editor's cached display name.
- **An Anthropic Chat Model left at its default model.** n8n doesn't save a default, so the workflow has no model at all. n8n-sunset uses the default for the node's version (checked at n8n@2.41.5): 1 is `claude-2`, 1.1 `claude-3-sonnet-20240229`, 1.2 `claude-3-5-sonnet-20240620` (all retired), and 1.3 `claude-sonnet-4-5-20250929` (retires 2026-11-30). An empty model counts as unset. These findings are unverified, because n8n takes the default from the installed version. The defaults for 1 and 1.1 are less certain still: n8n's source declares the model parameter twice for those versions (once for the version alone, once for all versions up to 1.2 with the 1.2 default), and which declaration the editor uses was not verified; their findings say so.
- **HTTP Request nodes calling Anthropic** (the url field is on `api.anthropic.com`, or an expression URL plus Anthropic credentials; also the HTTP Request tool for AI Agents): quoted model IDs in the request body and `model` name/value pairs in body or query parameters, for every node version, exactly as for OpenAI.
- **OpenAI-compatible nodes pointed at Anthropic**: an OpenAI Chat Model version 1 (the only version with a Base URL option) whose `options.baseURL` is on `api.anthropic.com` is checked like an Anthropic node. Later versions set the URL in the OpenAI credential, which n8n-sunset can't see.
- **Code nodes**: quoted model IDs such as `'claude-2.1'`, outside comments. If the code, outside comments, uses a Bedrock or Vertex AI client (`AnthropicBedrock`, `bedrock-runtime`, `@anthropic-ai/bedrock-sdk`, `AnthropicVertex`, `@anthropic-ai/vertex-sdk`, or `aiplatform.googleapis.com`) and doesn't call `api.anthropic.com`, findings are unverified **warnings**, because those platforms set their own dates. The bare word "bedrock" in a variable name or log message doesn't count.
- **Any other node**: values assigned to a field named "model", such as an Edit Fields (Set) assignment. These are unverified **warnings**, since the value may never reach Anthropic.
- **Not checked:** Claude on Amazon Bedrock and on Google Cloud Vertex AI (their nodes are skipped). Anthropic's page says those platforms set their own retirement schedules; its dates do apply to Claude Platform on AWS and Microsoft Foundry.

### Google Gemini models (`gemini/model-shutdown`)

All 66 model IDs with a shutdown date: 47 from Google's [Gemini API deprecations page](https://ai.google.dev/gemini-api/docs/deprecations) (Gemini, embedding, Imagen, Veo, Live, and robotics models, and the managed agent `antigravity-preview-05-2026`) and 19 that only the [release notes](https://ai.google.dev/gemini-api/docs/changelog) carry (experimental and preview models, the Gemini 1.5 family, and models the release notes report as shut down).

Google says the table dates are only the **earliest possible** shutdown dates, so each entry records how firm its date is:

| Date status | Entries | What the release notes say | How it is reported |
| --- | --- | --- | --- |
| confirmed | 27 | The model was shut down | "Google has shut down ...; API calls fail." |
| announced | 31 | The shutdown was announced for that date | "Google shuts down ...; API calls will fail." (or "has shut down" once the date has passed) |
| earliest | 8 | Nothing; only the table's earliest date | Before the date: "calls can fail from <date> at the earliest". After it: a **warning**, "past Google's earliest shutdown date; calls may already fail", which never fails the run |

Each entry's `announcement` field holds the dated release-notes entries. Two more cases:

- `gemini-3-pro-preview` is a **behavior change**, not a failure: Google shut the model down on 2026-03-09 and pointed the ID at `gemini-3.1-pro-preview`, so calls still work but get a different model.
- **Notice dates:** for models the release notes only report as already shut down, with no earlier announcement (the Gemini 1.5 family, for example), the date is the date of that notice; the model may have stopped working earlier. The finding's message says so. The registry's other notes on an entry are shown the same way.
- **Aliases** are the IDs as launched where the table spells them differently (`gemini-2.5-flash-preview-09-2025`, `gemini-embedding-2-preview`) and the Gemini 1.5 `-latest` names. Alias matches are unverified, and so are the versioned 1.5 IDs (`gemini-1.5-pro-002` and others), which the notice that dates the family doesn't name.

Still ahead, as of registry 2026-10-06:

| Shutdown | Status | Model | Google's recommended replacement |
| --- | --- | --- | --- |
| 2026-10-22 | earliest | `veo-3.1-fast-generate-preview` | `gemini-omni-1.1-flash` |
| 2026-10-22 | earliest | `veo-3.1-generate-preview` | `gemini-omni-1.1-flash` |
| 2026-10-22 | earliest | `veo-3.1-lite-generate-preview` | `gemini-omni-1.1-flash` |
| 2027-05-07 | earliest | `gemini-3.1-flash-lite` | `gemini-3.5-flash-lite` |
| 2028-05-14 | earliest | `gemini-embedding-001` | `gemini-embedding-2` |

The other 61 entries are past their dates, from `gemini-2.5-pro-exp-03-25` (2025-06-26) to `antigravity-preview-05-2026` (2026-10-05). Rows that say "No shutdown date announced" are left out, even when a replacement is listed.

Where it looks:

- **Google Gemini nodes** (any node type containing "googleGemini", or using Google Gemini (PaLM) credentials): the Google Gemini Chat Model and the Embeddings Google Gemini node (the `modelName` parameter) and the Google Gemini node (`modelId`). n8n stores names as `models/gemini-2.5-flash`; the finding names the bare ID. Expressions and resource locators work as for Anthropic.
- **The Google Gemini node's image operations left at their default.** From node version 1.2, Image > Generate defaults to `models/gemini-3.1-flash-image-preview` (checked at n8n@2.41.5), which shut down on 2026-06-25. Image > Edit has an empty model by default, and n8n then uses `models/gemini-2.5-flash-image-preview` in every node version, which shut down on 2026-01-15. An empty model, including an empty resource locator, counts as left at its default. These findings are unverified, because n8n takes the default from the installed version.
- **HTTP Request nodes calling the Gemini API** (the url field is on `generativelanguage.googleapis.com`, or an expression URL plus Gemini credentials): the model in the URL path (`/v1beta/models/gemini-2.0-flash:generateContent`), in the request body (the OpenAI-compatible endpoint, `batchEmbedContents`, the managed-agent `agent` field), and in body or query parameters. A model named twice in one node (URL and body, or an alias and its model) is one finding with both locations.
- **OpenAI-compatible nodes pointed at the Gemini API**: an OpenAI Chat Model version 1 whose `options.baseURL` is on `generativelanguage.googleapis.com` is checked like a Gemini node. Later versions set the URL in the OpenAI credential, which n8n-sunset can't see.
- **Code nodes**: quoted model IDs outside comments, and the model inside `generativelanguage.googleapis.com` URLs in string literals (`'.../models/gemini-2.0-flash:generateContent?key=...'`). If the code, outside comments, uses Vertex AI (`aiplatform.googleapis.com`, `vertexai: true` or `vertexai=True` for the Google Gen AI SDK, `@google-cloud/vertexai`, `vertexai.generative_models`, `VertexAI`) and doesn't call the Gemini API, findings are unverified **warnings**.
- **Other nodes with a "model" field**: as for Anthropic.
- **Not checked:** Vertex AI nodes and `aiplatform.googleapis.com` HTTP requests, which follow their own model lifecycle.

## Limitations

- **Model IDs in code and request bodies only count when quoted.** In Code nodes, in HTTP request bodies, and in OpenAI node model fields, a model ID is recognized only as a string literal such as `'gpt-4'` or `"gpt-4"`. This keeps a variable named `o1` or a prompt that mentions "davinci" from being reported, but it misses IDs assembled at run time (`'gpt-' + version`), IDs read from data, and IDs inside a longer string such as a URL built in code.
- **HTTP Request nodes with generic authentication need a literal OpenAI URL.** A node that sends the OpenAI key through generic credentials (for example Header Auth with `Authorization: Bearer ...`) is only recognized when its url field literally contains `https://api.openai.com/...`. If the URL comes from an expression such as `={{ $vars.OPENAI_URL }}/chat/completions`, n8n-sunset can't tell the node calls OpenAI and checks nothing. Use the predefined OpenAI credential type, or a literal URL, to be covered.
- **OpenAI-compatible providers are not checked.** Groq, Together, DeepSeek, local servers, and other APIs that copy OpenAI's request format retire models on their own schedules, so OpenAI's dates don't apply. HTTP Request nodes calling them are ignored, and a node pointed at one through `options.baseURL` (OpenAI Chat Model version 1, Embeddings OpenAI 1 and 1.1, the legacy OpenAI Model) only produces warnings. Azure OpenAI is skipped entirely: it uses deployment names and its own retirement schedule. Model IDs named `openai/<model>` (OpenRouter style) are reported as warnings.
- **A gateway set in a credential can't be seen.** The OpenAI credential's base URL, the Anthropic credential's `url`, and the Google Gemini credential's `host` aren't part of a workflow export or of the API's workflow data. A node that relies on them is treated as calling the provider directly, so a model served through a gateway on its own schedule (OpenRouter, a company proxy, another OpenAI-compatible provider) is still reported as breaking. That covers most nodes: the OpenAI Chat Model from version 1.1, Embeddings OpenAI from 1.2, the OpenAI node, and every Anthropic and Gemini node set their endpoint only in the credential. The `options.baseURL` check applies only to the older node versions that have that option.
- **Endpoints in code need the full path.** A Code node that builds URLs from a base variable (`` `${base}/threads` ``) is not flagged, and neither are OpenAI SDK calls (`openai.beta.threads.create`). Code that doesn't mention `api.openai.com` is not checked for endpoints at all. In code the request method is unknown, so the `POST`-only fine-tuning entry is reported as unverified there.
- **Only these n8n node usages are checked for built-in endpoint calls:** the OpenAI node's "Assistant" resource (versions 1 to 1.8), its "Video" resource and "Message a Model" prompt option (versions 2 to 2.3), and the OpenAI Assistant node. Other n8n nodes that call OpenAI internally, such as the OpenAI Chat Model, are checked for deprecated models only.
- **Anthropic and Gemini: only dated models are reported.** A model that is not in the registry may still be on its way out. Anthropic's "Not sooner than" dates and Gemini's "No shutdown date announced" rows are not deadlines. The Gemini 1.0 models, which the release notes only call "no longer supported", are not listed.
- **Aliases are assumed to retire with their model.** No provider page says when an alias stops working. Aliases not covered: Anthropic's Claude 3.x `-latest` names (`claude-3-5-haiku-latest`, `claude-3-7-sonnet-latest`), which the model-IDs rule doesn't cover and no page lists, and Gemini's moving `gemini-pro-latest` and `gemini-flash-latest`, which point at current models.
- **Anthropic and Gemini findings use the same model-ID rules as OpenAI:** quoted IDs in code and request bodies, a literal provider URL for HTTP nodes that use generic authentication, and no checks for gateways (OpenRouter-style `anthropic/claude-...` IDs) or for IDs assembled at run time.
- **Code is scanned without running it.** Comments are ignored, but string literals count wherever they are, so a migration map like `{ 'claude-2.1': 'claude-opus-4-8' }` still reports the old ID. Leave those IDs out with `--ignore-model claude-2.1` (the rest of the rule still runs), or keep the old IDs out of string literals.
- **Defaults come from n8n@2.41.5.** For nodes that leave the model unset, n8n-sunset uses the default of that node version at n8n 2.41.5. n8n fills a missing value from the installed version, so these findings are marked unverified.
- **Instance-level n8n 3.0 changes** you won't find in workflow JSON are out of scope: the Docker-only deployment requirement, environment variables, SSRF block list, storage paths, the task runner timeout, Chat Hub, and others. See the [n8n 3.0 breaking changes](https://docs.n8n.io/changelog/v30-breaking-changes) page, and n8n's Migration Report, for those.

## Data and sources

All dates and replacements live in [`data/sunset-registry.json`](data/sunset-registry.json). Each entry cites its source and access date (2026-10-01, 2026-10-02 for the Migration Report and openai-python, and 2026-10-06 for the OpenAI, Anthropic, and Gemini pages); GitHub links are pinned to the commit that was read:

| Source | Used for |
| --- | --- |
| [docs.n8n.io/changelog/v30-breaking-changes](https://docs.n8n.io/changelog/v30-breaking-changes) ([n8n-docs at `49668e5`](https://github.com/n8n-io/n8n-docs/blob/49668e57cd44ee74931c735366b19d7e2725d8fa/docs/changelog/v30-breaking-changes.md)) | What n8n 3.0 removes or changes, the scheduled month, and the replacements |
| [n8n source at n8n@2.41.5 (`a9c858b`)](https://github.com/n8n-io/n8n/tree/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages) and the [3.x branch at `599ca71`](https://github.com/n8n-io/n8n/tree/599ca716ee91b06d8f2026d432f8a09a9953f0a8) | The node type IDs behind the display names in the docs, node versions, and parameter defaults. The removed nodes are confirmed to be absent from the 3.x branch |
| [n8n's Migration Report rules (`a9c858b`)](https://github.com/n8n-io/n8n/tree/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/cli/src/modules/breaking-changes) | The Execute Sub-workflow "Run once for each item" removal, which the docs page doesn't list, and what the Migration Report covers |
| [n8n OpenAI node source (`a9c858b`)](https://github.com/n8n-io/n8n/tree/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/@n8n/nodes-langchain/nodes/vendors/OpenAi) | Which type versions have the "Assistant" and "Video" resources and the "Message a Model" prompt option (`OpenAi.node.ts` maps 1 to 1.8 to `v1/OpenAiV1.node.ts` and 2 to 2.3 to `v2/OpenAiV2.node.ts`), the resource and operation values, and the endpoints each operation calls |
| [n8n OpenAI Assistant node source (`a9c858b`)](https://github.com/n8n-io/n8n/blob/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/@n8n/nodes-langchain/nodes/agents/OpenAiAssistant/OpenAiAssistant.node.ts) and [LangChain's `OpenAIAssistantRunnable` (`6b914bc`)](https://github.com/langchain-ai/langchainjs/blob/6b914bceb4acd4664b12091770a2ddcbf5d8457e/libs/langchain-classic/src/experimental/openai_assistant/index.ts) (`@langchain/classic` 1.0.27, the version n8n uses) | The OpenAI Assistant node's versions, its `mode` parameter, and its Assistants API calls: `beta.assistants.update` or `createAssistant`, then `beta.threads` runs |
| [developers.openai.com/api/docs/deprecations](https://developers.openai.com/api/docs/deprecations) (formerly platform.openai.com/docs/deprecations, which now redirects there) | Model IDs, aliases, deprecated endpoints, beta headers, shutdown dates, and recommended replacements |
| [platform.claude.com/docs/en/about-claude/model-deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations) (formerly docs.anthropic.com, which redirects there) | Anthropic model IDs, the retirement dates from its "Deprecation history" tables, and recommended replacements |
| [Anthropic: Model IDs and versioning](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions) | That dateless aliases such as `claude-sonnet-4-5` point at the most recent dated snapshot of that version |
| [ai.google.dev/gemini-api/docs/deprecations](https://ai.google.dev/gemini-api/docs/deprecations) | Gemini API model IDs, shutdown dates (the earliest possible dates), and recommended replacements |
| [ai.google.dev/gemini-api/docs/changelog](https://ai.google.dev/gemini-api/docs/changelog) | Which Gemini shutdowns were announced for a date or reported as done (the `dateStatus` of each entry), the redirect of `gemini-3-pro-preview`, the IDs as launched, and models only the release notes carry |
| [n8n Anthropic Chat Model source (`a9c858b`)](https://github.com/n8n-io/n8n/blob/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/@n8n/nodes-langchain/nodes/llms/LMChatAnthropic/LmChatAnthropic.node.ts) | The default model per node version, and the option values `claude-2` and `claude-instant-1` |
| [n8n OpenAI node audio operations (`a9c858b`)](https://github.com/n8n-io/n8n/tree/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/@n8n/nodes-langchain/nodes/vendors/OpenAi) | Generate defaults to `tts-1` and offers only `tts-1` and `tts-1-hd`; Transcribe and Translate always use `whisper-1` (versions 1 and 2) |
| [n8n Google Gemini image generation (`a9c858b`)](https://github.com/n8n-io/n8n/blob/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/@n8n/nodes-langchain/nodes/vendors/GoogleGemini/actions/image/generate.operation.ts) | From node version 1.2 the model defaults to `models/gemini-3.1-flash-image-preview` |
| [n8n Google Gemini image editing (`a9c858b`)](https://github.com/n8n-io/n8n/blob/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/@n8n/nodes-langchain/nodes/vendors/GoogleGemini/actions/image/edit.operation.ts) | An empty model falls back to `models/gemini-2.5-flash-image-preview` in every node version |
| [n8n OpenAI image generation, V1 (`a9c858b`)](https://github.com/n8n-io/n8n/blob/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/@n8n/nodes-langchain/nodes/vendors/OpenAi/v1/actions/image/generate.operation.ts) and [V2 (`a9c858b`)](https://github.com/n8n-io/n8n/blob/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/@n8n/nodes-langchain/nodes/vendors/OpenAi/v2/actions/image/generate.operation.ts) | The model defaults to `dall-e-3` up to node version 2.1 and to `gpt-image-1-mini` from 2.2 |
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
    "findings": 10,
    "nodesAffected": 10,
    "workflowsAffected": 3,
    "breaking": 10,
    "behaviorChanges": 0,
    "warnings": 0,
    "info": 0,
    "upcoming": 3,
    "past": 4,
    "onUpgrade": 3,
    "exitFindings": 5,
    "exitNodes": 5,
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

- `skipRules` lists what `--skip-rule` left out, and `ignoreModels` the model IDs `--ignore-model` left out (both empty by default).
- `category` is `n8n-3.0`, `openai-model`, `openai-endpoint`, `anthropic-model`, or `gemini-model`; `severity` is `breaking`, `behavior-change`, `warning`, or `info`.
- `trigger` is `date` for model and endpoint shutdowns and `upgrade` for n8n 3.0. A date finding can be a `behavior-change` (a redirected Gemini ID) or a `warning` (a Gemini date that has passed but nothing confirms); neither sets exit code 1. Upgrade findings have `date` and `daysUntil` set to `null`, `upgradeTo: "3.0"`, `status: "on-upgrade"`, and a `when` label such as `"breaks on upgrade to n8n 3.0"`.
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

## Need help?

Need your workflows fixed before the model shutdowns or the n8n 3.0 upgrade? I do fixed-price migrations, from $150. Email larik2174@gmail.com with your workflow export.

## License

[MIT](LICENSE)
