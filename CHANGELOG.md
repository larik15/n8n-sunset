# Changelog

All notable changes to n8n-sunset. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/).

## [0.2.0] - 2026-10-06

### Possibly breaking for JSON consumers and CI

- Two new `category` values, `anthropic-model` and `gemini-model`, and new rule IDs `anthropic/model-retirement` and `gemini/model-shutdown`. Code that switches over categories without a default case needs updating.
- Exit code 1 now also covers Anthropic and Gemini findings, so a pipeline that was green on 0.1.x can turn red. Use `--skip-rule` (below) to leave a rule out while you migrate.
- A date finding can now be a `behavior-change` (a redirected Gemini ID) or a `warning` (a Gemini date that has passed but nothing confirms). The JSON report has a new top-level `skipRules` field.
- The registry warning now appears when the bundled data is more than 14 days older than `--as-of` (was 30). The failure threshold stays at 90 days.

### Added

- **Anthropic model retirement checks** (`anthropic/model-retirement`). All 20 models that Anthropic's [model deprecations page](https://platform.claude.com/docs/en/about-claude/model-deprecations) lists with a retirement date, each with Anthropic's recommended replacement. Also matched, as unverified:
  - the dateless aliases `claude-sonnet-4-5`, `claude-opus-4-1`, `claude-opus-4-0` and `claude-sonnet-4-0`, from the rule on the [model-IDs page](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions);
  - n8n's option values `claude-2` and `claude-instant-1`.
- **Google Gemini model shutdown checks** (`gemini/model-shutdown`). 66 models from Google's [deprecations page](https://ai.google.dev/gemini-api/docs/deprecations) and [release notes](https://ai.google.dev/gemini-api/docs/changelog), including:
  - the Gemini 1.5 family (versioned IDs and `-latest` names unverified);
  - the IDs as launched where the table spells them differently;
  - the managed agent `antigravity-preview-05-2026`.
  Each entry records whether the release notes confirmed the shutdown, announced its date, or say nothing (the table's earliest possible date). A past earliest-only date is a warning, and the redirected `gemini-3-pro-preview` is a behavior change.
- **Where the new rules look:**
  - the Anthropic and Google Gemini nodes, and so AI Agent model sub-nodes;
  - HTTP Request nodes calling `api.anthropic.com` or `generativelanguage.googleapis.com` (URL path, body, parameters);
  - OpenAI-compatible nodes whose `options.baseURL` points at either API;
  - Code nodes, including Gemini REST URLs in string literals;
  - `model` fields on other nodes (warnings).
- **Models n8n uses without naming them:**
  - an Anthropic Chat Model left at its default (per node version);
  - the OpenAI node's text to speech (default `tts-1`) and Transcribe/Translate (always `whisper-1`);
  - the Google Gemini node's image generation (default `gemini-3.1-flash-image-preview`).
  These are reported as unverified, with a replacement note when OpenAI's suggestion can't be selected in that node.
- **Replacement chains:** when a provider's suggested replacement is itself shut down or goes within the window, the report says so and names the next model, for all providers.
- `--skip-rule <rule ID or category>` to leave out a rule; repeatable.
- A warning when a `--registry` file has no Anthropic or Gemini section (written for 0.1.x).
- Exported `buildProviderIndex`, `matchProviderModel`, and the `ProviderModel`, `ProviderModels` and `ModelDefault` types.

### Changed

- **Code nodes:** comments are now really ignored when looking for model IDs (JavaScript `//` and `/* */`, Python `#`), for OpenAI too, as the README already said. A Code node that calls Vertex AI or Bedrock gets warnings instead of breaking findings.
- **Table layout:** the table no longer splits a model ID or host name across lines. When the terminal is too narrow for that, findings are printed as blocks.
- **OpenAI data:** re-checked against the current deprecations page. No date or replacement changed, and 7 models announced on 2026-10-01 were added (`gpt-5.3-codex`, `gpt-5.4-nano` and `gpt-5.1` on 2027-04-01; `tts-1`, `tts-1-hd` and the two `gpt-4o-mini-tts` snapshots on 2027-01-06). `gpt-4-1106-preview`, listed under two dates, now uses the newer announcement (2026-10-23) and stays unverified.
- The report footer names the source of each provider's dates (only for sections the registry has).
- Registry version 2026-10-06.

### Not included

- Anthropic's Claude 3.x `-latest` aliases and Gemini 1.0, because no official page lists them with a date.
- Claude on Amazon Bedrock and Google Cloud Vertex AI, and Gemini on Vertex AI, which follow their own schedules.
- Request settings that fail on newer Claude models (manual thinking, sampling parameters): a candidate for a later release.

## [0.1.0] - 2026-10-02

First release. Scans n8n workflows (exported JSON files, or a running n8n through its API) for OpenAI model shutdowns, OpenAI endpoint shutdowns (Assistants API, Videos API, reusable prompt objects, legacy `/v1` endpoints, `OpenAI-Beta` headers), and nodes removed or changed in n8n 3.0. Table and JSON output, an exit code for CI, and a bundled registry that cites its sources.

[0.2.0]: https://github.com/larik15/n8n-sunset/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/larik15/n8n-sunset/releases/tag/v0.1.0
