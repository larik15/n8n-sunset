# Scripts behind STUDY.md

These three scripts collect public n8n workflow exports from GitHub and scan them with the published `n8n-sunset@0.2.0`. They are published so the numbers in [STUDY.md](../STUDY.md) can be checked and repeated. **This folder contains no data, no repository names and no credentials.**

## Requirements

- Node.js 20 or newer
- The [GitHub CLI](https://cli.github.com/), signed in with `gh auth login`. `collect.mjs` calls `gh api`, so the script itself holds no token.
- `npm install` in this folder (installs the pinned `n8n-sunset@0.2.0`)

## Run

```bash
cd study
npm install
node collect.mjs     # GitHub code search, 28 file-size strata, at most 10 searches a minute (about 30 minutes)
node download.mjs    # downloads each distinct file once from raw.githubusercontent.com, 3 at a time (about 50 minutes)
node analyze.mjs     # parses, deduplicates, scans, writes results.json (a minute or two)
```

All three work in a data folder, `./study-data` by default (git-ignored) or whatever `STUDY_DATA` points to. Set `AS_OF=YYYY-MM-DD` for `analyze.mjs` to measure shutdown dates from another day (STUDY.md uses 2026-10-08).

| Script | Reads | Writes |
| --- | --- | --- |
| `collect.mjs` | GitHub code search | `search/*.jsonl` (hits per size stratum), `strata.json` (GitHub's estimate of matching files per stratum) |
| `download.mjs` | `search/` | `raw/<sha>.json` (the downloaded files), `index.json` |
| `analyze.mjs` | `raw/`, `index.json`, `strata.json` | `results.json`: aggregate numbers only |

## What the scripts do and don't do

- **Query:** `"n8n-nodes-base" "typeVersion" "connections" extension:json`. Code search returns at most 1,000 results per query, hence the size strata.
- **Exclusions:** repositories owned by `n8n-io` and this project's own repository. Forks are not returned by code search.
- **A file counts** only if it holds an object with a non-empty `nodes` array and a `connections` object. Two workflows are the same if their node types, versions, parameters and disabled flags match; names, IDs, positions, credentials and connections are ignored.
- **Credentials in the files** are never read out, printed or used. Only node types, model IDs from the registry and counts leave the scan.
- **Repository names** are used in memory to count workflows per repository. `results.json` reports them by rank only.
- **Fine-tuned model IDs** carry the owner's organization after the base model name, so they are reduced to the base model plus a wildcard (`ft:<base>:*`) before counting.
- **No Operation nodes** are left out of the breaking counts: they never send a request, even when they still carry another node's model and credentials.

The downloaded data from the run behind STUDY.md was deleted afterwards; running the scripts again today will find newer files and may give different numbers.
