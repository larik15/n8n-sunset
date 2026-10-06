# Changelog

All notable changes to n8n-sunset. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/).

## [0.2.0] - 2026-10-06

### Added

- **Anthropic model retirement checks** (`anthropic/model-retirement`, category `anthropic-model`). All 20 models that Anthropic's [model deprecations page](https://platform.claude.com/docs/en/about-claude/model-deprecations) lists with a retirement date, plus the documented alias `claude-sonnet-4-5`, each with Anthropic's recommended replacement. Detected in the Anthropic Chat Model and Anthropic nodes (and so in AI Agent and chain model sub-nodes), in HTTP Request nodes calling `api.anthropic.com` (URL, JSON body, and body or query parameters), in Code nodes, and in `model` fields of other nodes (unverified warnings).
- **Google Gemini model shutdown checks** (`gemini/model-shutdown`, category `gemini-model`). All 54 models with a shutdown date on Google's [Gemini API deprecations page](https://ai.google.dev/gemini-api/docs/deprecations) or announced with a date in the [release notes](https://ai.google.dev/gemini-api/docs/changelog). Detected in the Google Gemini Chat Model, Google Gemini, and Embeddings Google Gemini nodes, in HTTP Request nodes calling `generativelanguage.googleapis.com` (model in the URL path or the body), in Code nodes, and in `model` fields of other nodes. `models/gemini-...` names and `:generateContent`-style suffixes are understood, and the finding names the bare model ID.
- Registry sections `anthropic` and `gemini`. Each entry records the model ID, the announced date, the replacement, where it was announced, and its source; `matching` and `excluded` explain what is and isn't listed. Four new sources are cited with their access date (2026-10-06).
- Exported `buildProviderIndex`, `matchProviderModel`, and the `ProviderModel` and `ProviderModels` types.
- The example workflows and the README now show Anthropic and Gemini findings.

### Changed

- Exit code 1 now also covers breaking Anthropic and Gemini findings that take effect within the window or already have, with the same rules as OpenAI (disabled nodes never count; warnings never fail the run).
- Findings for dates that are still ahead on the Gemini API say that Google lists them as the earliest possible shutdown dates.
- The report footer names the source of each provider's dates.
- Registry version 2026-10-06. The OpenAI entries were not re-checked for this release and are still as of 2026-10-01.
- Registry files written for 0.1.x, without `anthropic` or `gemini` sections, still load (those sections are empty).

### Not included

- Anthropic's `-latest` and `-0` aliases (for example `claude-3-5-haiku-latest`) and Gemini 1.5 and 1.0 models, because no official page lists them with a date.
- Claude on Amazon Bedrock and Google Vertex AI, and Gemini on Vertex AI, which follow their own schedules.

## [0.1.0] - 2026-10-02

First release. Scans n8n workflows (exported JSON files, or a running n8n through its API) for OpenAI model shutdowns, OpenAI endpoint shutdowns (Assistants API, Videos API, reusable prompt objects, legacy `/v1` endpoints, `OpenAI-Beta` headers), and nodes removed or changed in n8n 3.0. Table and JSON output, an exit code for CI, and a bundled registry that cites its sources.

[0.2.0]: https://github.com/larik15/n8n-sunset/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/larik15/n8n-sunset/releases/tag/v0.1.0
