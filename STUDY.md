# How many public n8n workflows break on model shutdowns and n8n 3.0?

**Of 11,075 distinct public n8n workflows from GitHub, 12.7% (9.7% counting only verified findings) use a model or endpoint whose shutdown date has passed or has been published, a count that includes 40 workflows (0.4%) hit by Gemini's "earliest possible" shutdown dates, which are not confirmed; 23.6% would hit a breaking change on upgrade to n8n 3.0.**

This is an aggregate study of those workflows, scanned with n8n-sunset 0.2.0 on 2026-10-08. Only aggregate numbers are reported: no workflow names, authors, repositories or links. The collection and analysis scripts are in [`study/`](study/).

**Disclosure:** the author of this study also wrote n8n-sunset, the tool used for the scan.

**Reading the tables:** a workflow can appear in several rows of the same table (for example one that uses two affected models, or an affected model and a removed node), so rows don't add up to the totals. A date row counts a workflow once, however many of that date's models it uses; a model row counts one model ID.

## Key numbers

Shares of the 11,075 distinct workflows, with 95% confidence intervals. A workflow counts when at least one enabled node gets a **breaking** finding.

| | Workflows | Share | 95% CI |
| --- | ---: | ---: | --- |
| Already past a shutdown date (model or endpoint) | 814 | 7.3% | 6.9–7.9% |
| Hit by a shutdown within the next 30 days (2026-10-08 to 2026-11-07) | 319 | 2.9% | 2.6–3.2% |
| …of which OpenAI's 2026-10-23 shutdowns (`gpt-4`, `gpt-3.5-turbo`, `gpt-4.1-nano`, others) | 314 | 2.8% | 2.5–3.2% |
| Hit by a later announced shutdown (after 2026-11-07) | 407 | 3.7% | 3.3–4.0% |
| **Any dated breaking finding (past or upcoming)** | **1,406** | **12.7%** | 12.1–13.3% |
| Breaks on upgrade to n8n 3.0 | 2,614 | 23.6% | 22.8–24.4% |

Most public workflows don't use an AI model at all. Among the 4,017 workflows (36.3%) that contain at least one OpenAI, Anthropic, Gemini or LangChain node:

| | Workflows | Share | 95% CI |
| --- | ---: | ---: | --- |
| Already past a shutdown date | 710 | 17.7% | 16.5–18.9% |
| Hit within the next 30 days | 294 | 7.3% | 6.6–8.2% |
| Any dated breaking finding | 1,259 | 31.3% | 29.9–32.8% |
| Breaks on upgrade to n8n 3.0 | 1,581 | 39.4% | 37.9–40.9% |

147 of the 1,406 workflows with a dated finding have no AI node: they call a provider from an HTTP Request or Code node.

## By provider

Workflows with at least one breaking finding from each provider. A workflow can appear in several rows.

| Provider | Past shutdown date | Upcoming shutdown date |
| --- | ---: | ---: |
| OpenAI models | 212 (1.9%) | 611 (5.5%) |
| OpenAI endpoints (Assistants API and others) | 46 (0.4%) | 2 (0.0%) |
| Anthropic models | 181 (1.6%) | 47 (0.4%) |
| Gemini models | 406 (3.7%) | 40 (0.4%) |

## Upcoming shutdown dates

Every upcoming date with at least one affected workflow:

| Date | Provider | Workflows | Share |
| --- | --- | ---: | ---: |
| 2026-10-22 | Gemini (earliest possible date; Veo 3.1 previews) | 6 | 0.1% |
| 2026-10-23 | OpenAI models | 314 | 2.8% |
| 2026-11-30 | Anthropic (`claude-sonnet-4-5-20250929` and its alias `claude-sonnet-4-5`) | 47 | 0.4% |
| 2026-12-01 | OpenAI models | 3 | <0.1% |
| 2026-12-11 | OpenAI models | 5 | <0.1% |
| 2027-01-06 | OpenAI models (`tts-1`, `tts-1-hd`) and an OpenAI endpoint | 62 | 0.6% |
| 2027-02-26 | OpenAI models (`whisper-1`, `gpt-4o-mini-transcribe`) | 278 | 2.5% |
| 2027-04-01 | OpenAI models | 14 | 0.1% |
| 2027-05-07 | Gemini (`gemini-3.1-flash-lite`, earliest possible date) | 25 | 0.2% |
| 2028-05-14 | Gemini (`gemini-embedding-001`, earliest possible date) | 9 | 0.1% |

**What is behind 2026-10-23.** The 314 workflows use: `gpt-4` (98), `gpt-3.5-turbo` (55), `gpt-4.1-nano` (45), `gpt-image-1` (32), `gpt-4-turbo` (22), `o3-mini` (20), `gpt-4-1106-preview` (11), `o4-mini` (9), `o1` (7), and a few dated snapshots, `o1-pro` and one fine-tuned model. The registry holds all 17 entries OpenAI lists for that date, including fine-tuned variants, checked against OpenAI's deprecations page on 2026-10-10. The plain alias `gpt-4o` is not affected: only the snapshot `gpt-4o-2024-05-13` is (4 workflows). `gpt-4-1106-preview` appears on that page under two dates, 2026-03-26 and 2026-10-23; the registry uses the later one and marks it unverified.

**Date rows and model rows differ on purpose.** `whisper-1` is 277 workflows in the model table, while the 2027-02-26 row is 278: one more workflow uses `gpt-4o-mini-transcribe`, which shares that date. Likewise `gemini-2.0-flash` alone is 132 workflows (1.2%), while the 2026-06-01 row is 157 (1.4%) because four Gemini 2.0 Flash IDs share that date (`gemini-2.0-flash` 132, `gemini-2.0-flash-lite` 24, `gemini-2.0-flash-001` 18, `gemini-2.0-flash-lite-001` 3).

The past dates with the most affected workflows are 2026-06-01 (the four Gemini 2.0 Flash IDs above, 1.4%), 2025-09-29 (the Gemini 1.5 family, 1.0%), 2025-12-09 (Gemini 2.0 experimental and preview models, 0.6%), 2026-02-17 (`chatgpt-4o-latest`, 0.6%), 2026-05-12 (`dall-e-3` and `dall-e-2`, 0.6%) and 2026-06-15 (Claude Sonnet 4 and Opus 4, 0.6%). These workflows would fail if run against the provider's API as published.

## Most common affected models

| Model | Shutdown | Workflows | Share |
| --- | --- | ---: | ---: |
| `whisper-1` | 2027-02-26 | 277 | 2.5% |
| `gemini-2.0-flash` | 2026-06-01 (past) | 132 | 1.2% |
| `gpt-4` | 2026-10-23 | 98 | 0.9% |
| `chatgpt-4o-latest` | 2026-02-17 (past) | 67 | 0.6% |
| `gemini-2.0-flash-exp` | 2025-12-09 (past) | 64 | 0.6% |
| `dall-e-3` | 2026-05-12 (past) | 62 | 0.6% |
| `claude-sonnet-4-20250514` | 2026-06-15 (past) | 59 | 0.5% |
| `tts-1` | 2027-01-06 | 57 | 0.5% |
| `gpt-3.5-turbo` | 2026-10-23 | 55 | 0.5% |
| `gemini-1.5-flash` | 2025-09-29 (past) | 53 | 0.5% |
| `gpt-4.1-nano` | 2026-10-23 | 45 | 0.4% |
| `claude-sonnet-4-5-20250929` | 2026-11-30 | 40 | 0.4% |

`whisper-1` leads because the OpenAI node's Transcribe and Translate operations always use it; the workflow never names the model. Those findings are unverified (they depend on n8n's code, checked at n8n@2.41.5).

## Most common affected node types

| Node type | Workflows with a dated breaking finding |
| --- | ---: |
| OpenAI node (`@n8n/n8n-nodes-langchain.openAi`) | 475 (4.3%) |
| Google Gemini Chat Model | 314 (2.8%) |
| HTTP Request | 200 (1.8%) |
| Anthropic Chat Model | 173 (1.6%) |
| OpenAI Chat Model | 154 (1.4%) |
| Legacy OpenAI node (`n8n-nodes-base.openAi`) | 56 (0.5%) |
| Google Gemini node | 53 (0.5%) |
| Code | 38 (0.3%) |
| Embeddings Google Gemini | 37 (0.3%) |

## n8n 3.0

23.6% of workflows have at least one breaking change on upgrade to n8n 3.0:

| Change | Workflows | Share |
| --- | ---: | ---: |
| A node that n8n 3.0 removes | 1,445 | 13.0% |
| AI Agent node version 1.x | 1,294 | 11.7% |
| Execute Workflow in "Run once for each item" mode | 122 | 1.1% |

The removed nodes found most often are Function (5.9% of workflows), Cron (2.4%), Item Lists (1.4%), the HTTP Request tool for AI Agents (1.3%), the legacy OpenAI node (1.1%), Read Binary File and Move Binary Data (0.7% each), the SerpApi tool (0.7%), Interval (0.7%) and Function Item (0.5%).

**Source of the removal list.** n8n-sunset's list (37 removed nodes and 10 other changes) comes from n8n's [3.0 breaking changes](https://docs.n8n.io/changelog/v30-breaking-changes) page, read on 2026-10-01. Node type names and versions were checked against the n8n source at tag `n8n@2.41.5` and the node manifests of the 3.x branch (both read 2026-10-01), and the rules in n8n's own Migration Report (its breaking-changes module at `n8n@2.41.5`, read 2026-10-02). n8n 3.0 had not been released at that time (the page says "scheduled for October 2026"), so the final list may differ.

## Sensitivity checks

The headline shares hardly move when the sample is weighted differently:

| Metric | As sampled | Each repository counts once | Weighted by file-size stratum |
| --- | ---: | ---: | ---: |
| Already past a shutdown date | 7.3% | 8.6% | 6.7% |
| Within the next 30 days | 2.9% | 3.0% | 2.8% |
| Any dated breaking finding | 12.7% | 14.3% | 11.2% |
| Breaks on n8n 3.0 | 23.6% | 21.1% | 23.3% |

- **Verified findings only** (dropping alias matches, n8n defaults and other findings n8n-sunset marks as unverified): 9.7% have a dated breaking finding, instead of 12.7%.
- **NoOp nodes included:** 13.9% instead of 12.7%. In 1.2% of workflows, No Operation nodes still carry another node's model parameter and provider credentials. n8n-sunset 0.2.0 reports these as breaking, but a No Operation node never sends a request, so this study leaves those findings out. The tool will be fixed separately.
- **Warnings only:** 0.3% of workflows have only non-breaking dated findings: warnings such as a passed Gemini "earliest" date, or a behavior change such as a redirected Gemini ID.

## Source concentration

Distinct workflows by source repository, ranked (repository names are not reported). When the same workflow is published in several repositories, it is attributed to the first copy found.

| Rank | Workflows | Share of the sample | Cumulative share |
| ---: | ---: | ---: | ---: |
| 1 | 1,274 | 11.5% | 11.5% |
| 2 | 364 | 3.3% | 14.8% |
| 3 | 309 | 2.8% | 17.6% |
| 4 | 217 | 2.0% | 19.5% |
| 5 | 203 | 1.8% | 21.4% |
| 6 | 184 | 1.7% | 23.0% |
| 7 | 178 | 1.6% | 24.6% |
| 8 | 146 | 1.3% | 26.0% |
| 9 | 132 | 1.2% | 27.2% |
| 10 | 131 | 1.2% | 28.3% |
| Other 3,395 repositories | 7,937 | 71.7% | 100% |

The largest repository alone holds 11.5% of the sample, 3.5 times the second largest. Of the 3,405 repositories, 78.1% contribute exactly one workflow (median: 1).

## Methodology

### Why the n8n template library is not included

The official template library (about 13,100 templates) serves workflow JSON only through `api.n8n.io`. That host's [robots.txt](https://api.n8n.io/robots.txt) disallows all automated access (`User-Agent: *`, `Disallow: /`). The template pages on n8n.io are open to crawlers, but they load the workflow JSON from that API. n8n's legal pages have no clause on scraping, but robots.txt states the site owner's wish, so the study does not collect templates. Template copies that people re-published on GitHub are included like any other file (see Limitations).

### Collection (GitHub)

- **Source:** GitHub code search through the REST API, authenticated, at no more than 10 search requests per minute. Files were downloaded from `raw.githubusercontent.com`, three at a time with pauses, and backed off on any error. This follows GitHub's [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies), which allow research use of public information when the resulting publication is open access.
- **Query:** `"n8n-nodes-base" "typeVersion" "connections" extension:json`. GitHub estimates about 605,700 matching files.
- **Sampling:** code search returns at most 1,000 results per query, so the query was split into 28 strata by file size, from 0–1,000 bytes up to 200,001–400,000 bytes. Up to 1,000 results were taken from each, for 28,000 results in total. Within a stratum, GitHub returns results by its own relevance ranking, not at random.
- **Exclusions:** repositories owned by `n8n-io` (n8n's product test fixtures and docs; 260 results) and this project's own repository (0 results). Forks are not returned by code search.
- **Collected:** 2026-10-08.

### From files to distinct workflows

| Step | Count |
| --- | ---: |
| Search results | 28,000 |
| After dropping `n8n-io` repositories | 27,740 |
| Distinct files (byte-identical copies merged) | 16,363 |
| Deleted from GitHub since indexing | 13 |
| Not valid JSON | 151 |
| No n8n workflow inside (no non-empty `nodes` array plus a `connections` object) | 2,149 |
| Workflows found (a file can hold several) | 14,181 |
| Duplicates removed (same workflow published more than once) | 3,106 |
| **Distinct workflows** | **11,075**, from 3,405 repositories |

A file counts only when it holds at least one object with a non-empty `nodes` array and a `connections` object, either directly, as an array of workflows, or in an n8n API-style `data` array. Each object is then read with n8n-sunset's own loader.

Two workflows count as the same when their nodes match: the same node types, type versions, parameters and disabled flags, in any order. Workflow and node names, IDs, positions, credentials, webhook IDs, connections and metadata are ignored. This merges copies that were renamed or moved on the canvas, but it keeps workflows that differ in a single parameter separate.

### Scanning

- **Tool and data:** n8n-sunset 0.2.0, as published on npm, with its bundled registry (version 2026-10-06), `--as-of 2026-10-08`, a 30-day window, and target n8n 3.0.
- **Breaking:** a workflow counts when an enabled node has a finding of severity `breaking`, as the tool's exit code does. Disabled nodes, warnings and behavior changes are not counted.
- **Confidence intervals** are Wilson score intervals. They only reflect sampling noise; the sample is not random (see Limitations).
- **Scripts and reproducibility:** [`study/`](study/) holds the three scripts (`collect.mjs`, `download.mjs`, `analyze.mjs`) and a README. They contain no data, repository names or credentials. Re-running `analyze.mjs` on 2026-10-10 on the same files gave identical numbers.

### Privacy and credentials

Public exports sometimes contain hardcoded API keys, tokens or passwords. The analysis never printed, logged, extracted, tested or used any of them. Only counts, registry model IDs, node types and rule IDs leave the scan; fine-tuned model IDs, which contain the owner's organization, are reduced to their base model before counting. The downloaded files, together with the search listings that name the source repositories, were deleted on 2026-10-10. Only the aggregate results and the scripts were kept.

## Limitations

- **Workflows on GitHub are not running workflows.** A published export is a snapshot. The workflow may never have been deployed, may since have been fixed, or may be one of many copies of a tutorial. The numbers estimate how common these problems are in workflows people share, not how many production instances will fail.
- **Sample bias towards people who publish on GitHub.** GitHub authors include tutorial writers, course creators, agencies showcasing work, and people collecting templates. They aren't typical n8n users, whose workflows mostly live only in their instances. Collections are heavy (see Source concentration): the largest single repository contributes 11.5% of the distinct workflows, and the ten largest 28.3%. Counting each repository once moves the headline numbers by at most 2.5 points.
- **Not a random sample of GitHub either.** Each size stratum contributes the 1,000 results GitHub ranks highest, out of between about 2,000 and 36,000 matching files. GitHub's code search only indexes default branches and files under 384 KB. Its result counts are estimates, which limits the size-weighted check.
- **Templates vs. real deployments.** Only 1.9% of distinct workflows carry an n8n template ID, but many more are probably template copies with the ID stripped. Templates are written to show off current features, so they may use newer models than long-running deployments do, or older ones if they were never updated.
- **Exports vs. running instances.** An export doesn't contain the credential's base URL, so a model served through a gateway or proxy is counted as calling the provider directly. When a node leaves its model at the default, n8n-sunset uses n8n's default at n8n@2.41.5 (`whisper-1` for Transcribe, for example). A running instance could be on a version with a different default.
- **Some files aren't importable workflows.** A few files use node types that don't exist in n8n (for example `n8n-nodes-base.openai` or `n8n-nodes-base.openAIApi`). They are probably hand-written or AI-generated examples. They pass the `nodes`/`connections` check and are counted, but they are a small share: these two node types appear in at most 35 of the workflows with findings.
- **The tool's limits apply.** Model IDs built at run time, read from data, or sent to OpenAI-compatible providers aren't detected, so the model numbers are lower bounds. Unverified findings (aliases, n8n defaults) can be wrong in either direction; the verified-only figure is 9.7%.
- **Dates move.** Shares for upcoming dates depend on the registry of 2026-10-06. Providers add new shutdowns all the time, and Gemini's "earliest possible" dates may never happen as listed.
- **Deduplication is approximate.** Workflows that differ only in one prompt or one ID count as distinct. Two unrelated workflows with identical nodes and parameters would be merged, which is unlikely beyond trivial one-node workflows.
- **The author built the tool being evaluated.** The scan used n8n-sunset's own rules and registry, so any mistake in them carries into these numbers. The registry's 2026-10-23 entries were re-checked against OpenAI's page, and the scripts and the registry are public for anyone to check.
