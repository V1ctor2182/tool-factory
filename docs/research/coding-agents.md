# Coding agents for an AI video pipeline

Research date: 2026-10-10. All star counts and commit dates come from the GitHub API on that date. Claims not verified against a primary source are marked (guess) or (inferred).

## 1. Pipeline stages and tools

**Idea and script.** The LLM does this directly. Use Claude Opus 5.5 or Sonnet 5.5 via the Claude API ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)) or GPT-6.1 Sol via the OpenAI API ([models](https://developers.openai.com/api/docs/models/compare)). A project skill holds the house style. See section 2.

**Shot list and storyboard.** Same LLM, structured output. Claude Code supports `--json-schema` with `--output-format json` ([headless docs](https://code.claude.com/docs/en/headless)). Codex has `codex exec --output-schema` ([non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)). Storyboard stills: gpt-image-2.5 ([OpenAI pricing](https://developers.openai.com/api/docs/pricing)) or Nano Banana 2.1 at about $0.034 to $0.113 per image ([Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)).

**Per-shot prompts.** Prompt-writing skills exist for specific models. OSideMedia/higgsfield-ai-prompt-skill has 32 sub-skills for Seedance 2.5 and 2.0 prompts, 712 stars, pushed 2026-09-27 ([repo](https://github.com/OSideMedia/higgsfield-ai-prompt-skill)).

**Generation APIs.**
- Higgsfield. Public API launched 2026-09-17, pay per generation, 50+ models including Seedance 2.5, Kling 3.0, Sora 2 and Veo 3.1 ([Higgsfield blog](https://higgsfield.ai/blog/generate-ai-videos-higgsfield-api)). Base URL api.higgsfield.ai. Jobs are async with a `request_id`, `status_url` or webhook. Python and TypeScript SDKs. Outputs last at least seven days ([docs](https://docs.higgsfield.ai/)).
- Google Veo 3.1 on the Gemini API. Standard is $0.40/sec at 720p or 1080p and $0.60/sec at 4K. Fast is $0.10 to $0.30/sec. Lite is $0.05 to $0.08/sec ([Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)). Veo 3 and Veo 3 Fast were shut down 2026-06-30 (third-party report, [magichour](https://magichour.ai/blog/veo-3-pricing)).
- Kling. Official developer portal at kling.ai/dev. The API authenticates with a JWT signed from an access key and secret key pair, and is billed against prepaid resource packs ([Kling docs](https://kling.ai/document-api/api/get-started/authentication.md), [quick start](https://kling.ai/document-api/guides/get-started/quick-start.md)).
- Runway. API offers Seedance 2.5, Gen 4.5, Aleph 2.0 and GPT Image 2 with Node and Python SDKs and an async task model ([Runway dev docs](https://docs.dev.runwayml.com/)). Third-party sources put Gen-4 Turbo at $0.05/sec and Gen-4.5 at $0.12/sec ([costbench](https://costbench.com/software/ai-media-apis/runway-api/)) (unverified on official page).
- fal.ai. Queue API at queue.fal.run with submit, status, stream and cancel endpoints ([fal queue docs](https://fal.ai/docs/documentation/model-apis/inference/queue)).
- Replicate. `predictions.create` for community models, `models.predictions.create` for official models ([Replicate docs](https://replicate.com/docs/topics/predictions/create-a-prediction.md)).

**Assembly.**
- ffmpeg. The default for concat, overlay and mux. Wrap it in a script, not an MCP (see section 8).
- Remotion. React-based rendering, 62,868 stars, pushed 2026-10-09 ([repo](https://github.com/remotion-dev/remotion)). Render with `npx remotion render <entry> <composition> <out>` ([render CLI](https://remotion.dev/docs/cli/render)). Official Agent Skills install with `npx skills add remotion-dev/skills` and give `/remotion-create`, `/remotion-docs` and `/remotion-render` ([Remotion skills](https://www.remotion.dev/docs/ai/skills)).
- HyperFrames (HeyGen). "Write HTML. Render video. Built for agents." 59,911 stars, pushed 2026-10-10, Apache 2.0. Installs as a Claude Code plugin with `claude plugin marketplace add heygen-com/hyperframes` ([repo](https://github.com/heygen-com/hyperframes)).
- MoviePy. Python, 14,963 stars, pushed 2026-08-26 ([repo](https://github.com/Zulko/moviepy)). Editly, 5,522 stars, last pushed 2025-05-12, is unmaintained ([repo](https://github.com/mifi/editly)).

**Voice and captions.**
- ElevenLabs. Current models are Eleven v4, v4 Turbo, v3, Multilingual v2 and Flash v2.5 ([TTS docs](https://elevenlabs.io/docs/capabilities/text-to-speech)). The `/v1/text-to-speech/{voice_id}/with-timestamps` endpoint returns character-level alignment for captions ([streaming with timestamps](https://elevenlabs.io/docs/api-reference/streaming-with-timestamps)).
- OpenAI TTS. `gpt-4o-mini-tts` is $12 per 1M audio output tokens ([pricing](https://developers.openai.com/api/docs/pricing)) with 13 built-in voices ([TTS guide](https://developers.openai.com/api/docs/guides/text-to-speech)).
- Transcription. `whisper-1` is $0.006 per minute and is the only OpenAI model with word and segment timestamps. `gpt-transcribe` and `gpt-4o-transcribe` do not return timestamps. Files cap at 25 MB ([speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text)).

**Thumbnails.** gpt-image-2.5 is billed per token, $30 per 1M image output tokens ([pricing](https://developers.openai.com/api/docs/pricing)). Third-party estimates put GPT Image 2 at about $0.03 per 1K image ([aireiter](https://aireiter.com/blog/gpt-image-2-api-pricing)) (unverified).

**Publish.**
- YouTube Data API v3. Default quota is 100 `videos.insert` calls and 10,000 units per day; the upload cost dropped to about 100 units on 2025-12-04 ([quota docs](https://developers.google.com/youtube/v3/determine_quota_cost)).
- TikTok Content Posting API. Direct Post via `/v2/post/publish/content/init/`, limited to six requests per minute per access token ([TikTok docs](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)).
- Instagram Graph API. Publish reels with `media_type=REELS` and `video_url`. Limit is 50 posts per 24 hours ([Meta docs](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing)).

## 2. Claude Code capabilities (October 2026)

All from [code.claude.com/docs](https://code.claude.com/docs/en/features-overview). Claude Code is at v2.1.296 as of 2026-10-09 ([changelog](https://code.claude.com/docs/en/changelog)). The repo has 149,915 stars ([GitHub](https://github.com/anthropics/claude-code)).

- **Skills.** A `SKILL.md` with YAML frontmatter in `.claude/skills/<name>/`. Fields include `description` for auto-invocation, `disable-model-invocation`, `allowed-tools`, `context: fork` to run in an isolated subagent, and `arguments`. Skills replace `.claude/commands/`. Inline `` !`cmd` `` runs a shell command and injects the output ([skills](https://code.claude.com/docs/en/skills)).
- **MCP.** Local stdio and remote HTTP servers. Tool search is on by default so idle MCP tools cost little context ([features overview](https://code.claude.com/docs/en/features-overview)). Add a hosted server with `claude mcp add --transport http <name> <url>` ([fal example](https://fal.ai/mcp)).
- **Hooks.** Five handler types: `command`, `http`, `mcp_tool`, `prompt`, `agent`. Events include `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `SessionStart`, `SessionEnd` and about 30 more ([hooks](https://code.claude.com/docs/en/hooks)). v2.1.296 added `onFailure: "block"` ([changelog](https://code.claude.com/docs/en/changelog)).
- **Subagents.** Markdown files in `.claude/agents/` with `model`, `tools`, `skills`, `mcpServers`, `maxTurns`, `background`, `isolation: worktree` and `effort`. Default 20 concurrent, depth 3, resumable ([subagents](https://code.claude.com/docs/en/sub-agents)).
- **Dynamic workflows.** Claude writes a script that runs many subagents and returns one result ([features overview](https://code.claude.com/docs/en/features-overview)).
- **Scheduling.** Three options. Cloud Routines run on Anthropic infrastructure with schedule, API and GitHub triggers, minimum interval one hour, 100 scheduled runs per hour per account, research preview, Pro and Max and Team and Enterprise only, created with `/schedule` ([routines](https://code.claude.com/docs/en/routines)). Desktop scheduled tasks run on your machine with local file access, minimum one minute, only while the app is open ([desktop tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks)). `/loop` runs inside a session, expires after seven days ([scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks)).
- **Headless.** `claude -p "<prompt>"` with `--output-format json`, `--json-schema`, `--allowedTools`, `--permission-mode`, `--permission-prompts none` for unattended runs, `--max-budget-usd`, `--continue` and `--resume`. `--bare` skips hooks, skills, MCP and CLAUDE.md and needs `ANTHROPIC_API_KEY`. JSON output includes `total_cost_usd` ([headless](https://code.claude.com/docs/en/headless)).
- **Agent SDK.** `pip install claude-agent-sdk` and `npm install @anthropic-ai/claude-agent-sdk`. Same tools, hooks, subagents, MCP, sessions and permissions as the CLI, and it loads `.claude/` skills automatically ([SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [Python repo](https://github.com/anthropics/claude-agent-sdk-python), [TS repo](https://github.com/anthropics/claude-agent-sdk-typescript)). Managed Agents is the hosted alternative ([overview](https://code.claude.com/docs/en/agent-sdk/overview)).
- **New in 2026.** Cross-session messaging, Artifacts, output styles, `/goal`, Monitor tool, agent teams (experimental, about 7x tokens) ([features overview](https://code.claude.com/docs/en/features-overview), [costs](https://code.claude.com/docs/en/costs)).

## 3. OpenAI Codex CLI and GPT (October 2026)

Docs moved to learn.chatgpt.com. The repo is Rust, 128,427 stars, pushed 2026-10-10 ([GitHub](https://github.com/openai/codex)).

- **CLI.** Install with `curl -fsSL https://chatgpt.com/codex/install.sh | sh`. Default model is GPT-6.1 Sol at medium reasoning. Sign in with a ChatGPT plan or an API key ([Codex CLI](https://learn.chatgpt.com/docs/codex/cli)).
- **AGENTS.md.** Repo-level standing instructions, kept small ([customization](https://learn.chatgpt.com/docs/customization/overview)).
- **Skills.** `SKILL.md` plus optional scripts in `.agents/skills` (repo) or `~/.agents/skills` (user). Invoke with `$name` in the CLI or by description match. Optional `agents/openai.yaml` sets invocation policy and tool dependencies ([skills](https://learn.chatgpt.com/docs/build-skills)). The skills format is close enough that Remotion and HyperFrames ship one skill set for both agents ([Remotion skills](https://www.remotion.dev/docs/ai/skills)).
- **Plugins.** 1,700+ in marketplaces ([Codex CLI](https://learn.chatgpt.com/docs/codex/cli)).
- **MCP.** `codex mcp add`, stdio and streamable HTTP, OAuth with CIMD and DCR, per-tool approval modes `auto`, `prompt`, `writes`, `approve` ([MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)). `codex mcp-server` was removed 2026-09-05, so Codex no longer runs as an MCP server ([changelog](https://learn.chatgpt.com/docs/changelog)).
- **Subagents.** TOML files in `.codex/agents/` or `~/.codex/agents/` with `name`, `description`, `developer_instructions`. Concurrency capped by `agents.max_concurrent_threads_per_session` ([subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)).
- **Hooks.** `PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`, `SubagentStop` and others, configured in `config.toml` or `~/.codex/hooks.json` ([hooks](https://learn.chatgpt.com/docs/hooks)).
- **Headless.** `codex exec "<task>"` with `--json` (JSONL events), `--output-schema`, `-o` to write the last message, and `codex exec resume <id>`. Read-only sandbox by default. Auth via `CODEX_API_KEY` ([non-interactive](https://learn.chatgpt.com/docs/non-interactive-mode)).
- **Scheduling.** Automations are created in the ChatGPT desktop app or web only. The CLI cannot create them. Desktop runs locally and needs the app open. Web runs in the cloud. Event triggers (Gmail, Slack, GitHub) are web only ([automations](https://learn.chatgpt.com/docs/automations?surface=app)).
- **Models and pricing per 1M tokens** ([pricing](https://developers.openai.com/api/docs/pricing)): GPT-6 Astra $10 in / $50 out. GPT-6.1 Sol $2 / $10, cached $0.10. GPT-6 Sol $2 / $10. GPT-6 Luna $0.10 / $0.50. GPT-5.6 Sol $4 / $20. GPT-5.6 Terra $2 / $12. GPT-5.6 Luna $0.20 / $1.20. gpt-5-mini $0.25 / $2. gpt-5-nano $0.05 / $0.40. GPT-5.4 and 5.4 mini were deprecated in July 2026 ([changelog](https://learn.chatgpt.com/docs/changelog)).
- **Access.** Codex is bundled with ChatGPT Plus at $20 and Pro at $100 to $500 with usage caps; an API key bills at token rates with no caps (third-party, [morphllm](https://www.morphllm.com/codex-pricing)) (plan prices unverified on an OpenAI page).

## 4. Open-source projects

| Repo | Stars | Last push | Lang | What it does |
| - | - | - | - | - |
| [harry0703/MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) | 129,364 | 2026-10-10 | Python | Topic to HD short video with an automated LLM, stock footage, TTS and subtitle workflow. |
| [calesthio/OpenMontage](https://github.com/calesthio/OpenMontage) | 65,910 | 2026-10-03 | Python | Agentic production system for Claude Code, Codex, Cursor. 12 pipelines as YAML manifests plus 700+ Markdown skills. Picks Remotion or HyperFrames per project. AGPLv3. |
| [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) | 59,911 | 2026-10-10 | TypeScript | HTML and CSS to deterministic MP4. Ships a Claude Code plugin and skills. |
| [HBAI-Ltd/Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app) | 17,022 | 2026-10-09 | TypeScript | Short drama and motion comic studio: script, storyboard, character assets, image and video generation, MCP and plugins. |
| [FujiwaraChoki/MoneyPrinter](https://github.com/FujiwaraChoki/MoneyPrinter) | 14,037 | 2026-03-26 | Python | YouTube Shorts automation on MoviePy. |
| [Vincentwei1021/video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) | 11,069 | 2026-10-05 | TypeScript | Skill for Claude Code and Codex: cinematic product videos in Remotion, 152 shot recipe cards. |
| [RayVentura/ShortGPT](https://github.com/RayVentura/ShortGPT) | 8,012 | 2025-02-10 | Python | Shorts and TikTok automation framework. Stale. |
| [Anil-matcha/AI-Youtube-Shorts-Generator](https://github.com/Anil-matcha/AI-Youtube-Shorts-Generator) | 5,288 | 2026-10-06 | Python | Long-form to 9:16 shorts with LLM highlight detection, Whisper and auto crop. |
| [FireRedTeam/FireRed-OpenStoryline](https://github.com/FireRedTeam/FireRed-OpenStoryline) | 3,471 | 2026-07-31 | Python | Editing agent: natural language intent to LLM plan to tool calls. |
| [0xsline/OpenChatCut](https://github.com/0xsline/OpenChatCut) | 2,232 | 2026-10-07 | TypeScript | Local-first conversational editor with multi-track timeline, Agent Skills and MCP. |
| [myccarl/ai-shortVideo-pipeline](https://github.com/myccarl/ai-shortVideo-pipeline) | 726 | 2026-09-02 | Python | FastAPI pipeline with multi-model failover, circuit breaker and quality gating. |
| [aqm857886159/Nomi](https://github.com/aqm857886159/Nomi) | 557 | 2026-10-10 | TypeScript | Video workbench that Claude Code or Codex directs over MCP: storyboard, generation, first cut on a timeline. |

OpenMontage is the closest existing answer. Its README routes all work through `pipeline_defs/` YAML manifests and stage director skills, with Python only for tools and persistence ([README](https://github.com/calesthio/OpenMontage)).

## 5. MCP servers for video and media

| Target | Server | Status |
| - | - | - |
| ffmpeg | [KyaniteLabs/kinocut](https://github.com/KyaniteLabs/kinocut) | 198 stars, pushed 2026-10-09, guardrailed ffmpeg plus HyperFrames tools. Active. |
| ffmpeg | [video-creator/ffmpeg-mcp](https://github.com/video-creator/ffmpeg-mcp) | 152 stars, pushed 2026-05-20. Slow. |
| Remotion | [Official MCP](https://www.remotion.dev/docs/ai/mcp) | Deprecated. Shutdown no earlier than 2026-08-31. Use [Agent Skills](https://www.remotion.dev/docs/ai/skills) instead. |
| Remotion | [stephengpope/remotion-media-mcp](https://github.com/stephengpope/remotion-media-mcp) | 34 stars, pushed 2026-02-25. Low activity. |
| fal.ai | [Official hosted](https://fal.ai/mcp) at mcp.fal.ai/mcp | Maintained by fal. Nine tools, bearer key auth. |
| fal.ai | [luminarylane/fal-mcp-server](https://github.com/luminarylane/fal-mcp-server) | 59 stars, pushed 2026-05-04. Superseded by hosted. |
| Replicate | [Official hosted](https://replicate.com/docs/reference/mcp) at mcp.replicate.com | Maintained by Replicate. Web auth flow. |
| Replicate | [deepfates/mcp-replicate](https://github.com/deepfates/mcp-replicate) | 94 stars. Archived. |
| ElevenLabs | [Official hosted](https://elevenlabs.io/docs/agents-platform/operate/hosted-mcp) at api.elevenlabs.io/v1/mcp | OAuth, no install. The [local repo](https://github.com/elevenlabs/elevenlabs-mcp) (1,535 stars) was archived 2026-08-20. |
| YouTube | [ZubeidHendricks/youtube-mcp-server](https://github.com/ZubeidHendricks/youtube-mcp-server) | 580 stars, pushed 2026-08-08. Community. |
| YouTube | [anwerj/youtube-uploader-mcp](https://github.com/anwerj/youtube-uploader-mcp) | 59 stars, pushed 2026-09-20, Go, upload and schedule. Community. No official Google MCP found (inferred). |
| Higgsfield | [Official hosted](https://higgsfield.ai/creator-hub/help-center/integrations/what-is-higgsfield-mcp) at mcp.higgsfield.ai/mcp | Launched April 2026, OAuth, five tools, seven models, `claude mcp add --transport http higgsfield https://mcp.higgsfield.ai/mcp`. |
| Higgsfield | [Hikhakk/higgsfield-mcp-unified](https://github.com/Hikhakk/higgsfield-mcp-unified) | 91 stars, pushed 2026-08-01, 27 models via official API. Community. |
| MiniMax | [MiniMax-AI/MiniMax-MCP](https://github.com/MiniMax-AI/MiniMax-MCP) | 1,583 stars, pushed 2026-08-20. Official. TTS, image and video. |

Pattern: funded vendors moved to hosted OAuth MCPs and archived local ones. Community ffmpeg and YouTube servers are thin wrappers a short script replaces.

## 6. Model choice and cost

Claude, per 1M tokens, from the [official pricing page](https://platform.claude.com/docs/en/about-claude/pricing):

| Model | Input | Output | Cache hit |
| - | - | - | - |
| Fable 5.1 | $10 | $50 | $0.25 |
| Opus 5.5 | $4 | $20 | $0.20 |
| Sonnet 5.5 | $2 | $10 | $0.10 |
| Haiku 5.5 (prompts under 100k) | $0.10 | $0.50 | $0.01 |
| Haiku 4.5 | $1 | $5 | $0.10 |

Opus 5.5 launched 2026-09-22 and Sonnet 5.5 on 2026-10-07 (third-party, [benchlm](https://benchlm.ai/anthropic/api-pricing)). Models from 4.7 on use a tokenizer that yields about 30% more tokens, and the 5.5 models and Fable always use extended thinking, billed as output ([pricing](https://platform.claude.com/docs/en/about-claude/pricing), [costs](https://code.claude.com/docs/en/costs)). Anthropic reports about $13 per developer per active day for Claude Code ([costs](https://code.claude.com/docs/en/costs)).

GPT prices are in section 3. The tiers line up: GPT-6.1 Sol and Sonnet 5.5 are both $2 / $10, GPT-6 Luna and Haiku 5.5 are both $0.10 / $0.50, GPT-6 Astra and Fable 5.1 are both $10 / $50.

Fit by stage (inferred from price tables and docs, not benchmarked):
- Creative writing (idea, script, hooks): Opus 5.5 or GPT-6.1 Sol. A script is a few thousand tokens, so even Fable 5.1 costs under $0.50 per video. Spend here.
- Orchestration (reads the manifest, decides what runs, checks results): Sonnet 5.5 or GPT-6.1 Sol. The loop resends context many times, so the $0.10 cache hit rate dominates.
- Mechanical (per-shot prompt expansion, caption cleanup, metadata): Haiku 5.5 or GPT-6 Luna.
- Video generation dwarfs LLM cost. One 8-second Veo 3.1 Standard clip is $3.20, so twenty clips is $64 ([Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)). Draft on Lite or Fast, finalize on Standard (inferred).

## 7. Claude Code vs Codex CLI for this use case

| Row | Claude Code | Codex CLI |
| - | - | - |
| Skills and extensibility | `SKILL.md` with frontmatter, `context: fork`, `allowed-tools`, inline shell injection, plugins ([skills](https://code.claude.com/docs/en/skills)) | `SKILL.md` in `.agents/skills`, `$name` invocation, `agents/openai.yaml`, 1,700+ plugins ([skills](https://learn.chatgpt.com/docs/build-skills)) |
| MCP | stdio and HTTP, OAuth, tool search on by default, connectors in Routines ([MCP](https://code.claude.com/docs/en/mcp)) | stdio and streamable HTTP, OAuth with CIMD and DCR, per-tool approval modes. No longer runs as an MCP server ([MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)) |
| Subagents | Markdown, per-agent model, tools, MCP, worktree isolation, 20 concurrent, resumable ([subagents](https://code.claude.com/docs/en/sub-agents)) | TOML, built-in `default`, `worker`, `explorer`, concurrency cap in config ([subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)) |
| Scheduling | Cloud Routines with API and GitHub triggers, Desktop tasks, `/loop`, all creatable from the CLI ([routines](https://code.claude.com/docs/en/routines)) | Automations in app or web only. CLI cannot create them ([automations](https://learn.chatgpt.com/docs/automations?surface=app)) |
| SDK | Python and TypeScript Agent SDK with hooks, subagents, sessions, structured output ([SDK](https://code.claude.com/docs/en/agent-sdk/overview)) | `codex exec --json --output-schema` as the scripting surface; no equivalent library documented (inferred from [non-interactive docs](https://learn.chatgpt.com/docs/non-interactive-mode)) |
| Cost | Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50, Opus 5.5 $4 / $20 | GPT-6.1 Sol $2 / $10, GPT-6 Luna $0.10 / $0.50, GPT-6 Astra $10 / $50. ChatGPT plan bundles usage. |
| Strengths | Richest scheduling, five hook types, subagent isolation, and Higgsfield, fal, Replicate and ElevenLabs document Claude Code setup first | Cheap flagship via Sol, strong sandbox defaults, same SKILL.md convention so Remotion and HyperFrames skills work |
| Weaknesses | Routines are research preview with one-hour minimum and no local files; Fable is $50 output | No CLI scheduling, no Agent SDK, MCP server mode removed, docs domain churn |

## 8. Recommended architecture

1. Claude Code orchestrates. One `/produce <idea>` skill is the entry point. Run it as `claude -p "/produce ..." --output-format json --permission-mode acceptEdits --max-budget-usd 5` from cron or a Desktop scheduled task, since Routines cannot see local files ([headless](https://code.claude.com/docs/en/headless), [desktop tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks)).
2. Keep Codex as a second opinion. The same `SKILL.md` files load in both, so `codex exec` can review a script or shot list ([skills](https://learn.chatgpt.com/docs/build-skills)).
3. Skills hold judgment: house style, hook formulas, shot grammar, per-model prompt rules (borrow from higgsfield-ai-prompt-skill and video-shotcraft), QA checklists. Each stage is its own skill with `context: fork` so a bad stage does not pollute the main context ([skills](https://code.claude.com/docs/en/skills)).
4. MCP only for hosted vendor servers with OAuth: Higgsfield, fal, Replicate, ElevenLabs. They handle auth and model discovery, which a script does badly.
5. Plain scripts for everything deterministic: `gen_shot.py` (submit, poll, download), `assemble.sh` (ffmpeg concat and mux), `captions.py` (whisper-1 timestamps to SRT), `publish.py` (YouTube Data API). Scripts are cheaper than MCP tools in context and easier to test ([costs](https://code.claude.com/docs/en/costs)).
6. Subagents per stage: `scriptwriter` on Opus 5.5, `shot-planner` on Sonnet 5.5, `prompt-expander` on Haiku 5.5, `qa-reviewer` on Sonnet 5.5 with read-only tools ([subagents](https://code.claude.com/docs/en/sub-agents)).
7. State lives in `videos/<slug>/manifest.json` plus stage folders `01-idea/` through `09-publish/`. The manifest records each stage's status, input hash, output paths, vendor request IDs, cost and timestamps, as OpenMontage does ([OpenMontage](https://github.com/calesthio/OpenMontage)).
8. Idempotent reruns: every script checks the manifest first. If output exists and the input hash matches, skip. If a vendor `request_id` exists but no file, poll instead of resubmitting. Name clips by shot ID plus prompt hash so a changed prompt makes a new file and an unchanged one is reused.
9. Hooks enforce the budget: a `PreToolUse` hook on Bash blocks any `gen_shot.py` call when the manifest's spend exceeds the per-video cap; a `Stop` hook writes the final manifest and cost summary ([hooks](https://code.claude.com/docs/en/hooks)).
10. Drafts on cheap tiers, finals on expensive ones. Generate the first pass with Veo 3.1 Lite or a cheap fal model, review the cut, then regenerate only approved shots at Standard ([Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)).
11. Publishing is a manual-approved step. The agent writes title, description and tags into `09-publish/meta.json`; you run `publish.py`. Quota is 100 uploads per day ([YouTube quota](https://developers.google.com/youtube/v3/determine_quota_cost)).
12. Use `--json-schema` for every structured handoff so no script parses prose ([headless](https://code.claude.com/docs/en/headless)).
13. Install OpenMontage and HyperFrames in a scratch folder first and copy their manifest and skill layouts (inferred recommendation).

## Sources

- https://code.claude.com/docs/en/features-overview
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/routines
- https://code.claude.com/docs/en/desktop-scheduled-tasks
- https://code.claude.com/docs/en/scheduled-tasks
- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/agent-sdk/overview
- https://code.claude.com/docs/en/changelog
- https://code.claude.com/docs/en/costs
- https://code.claude.com/docs/en/mcp
- https://platform.claude.com/docs/en/about-claude/pricing
- https://github.com/anthropics/claude-code
- https://github.com/anthropics/claude-agent-sdk-python
- https://github.com/anthropics/claude-agent-sdk-typescript
- https://learn.chatgpt.com/docs/codex/cli
- https://learn.chatgpt.com/docs/build-skills
- https://learn.chatgpt.com/docs/extend/mcp?surface=cli
- https://learn.chatgpt.com/docs/agent-configuration/subagents
- https://learn.chatgpt.com/docs/non-interactive-mode
- https://learn.chatgpt.com/docs/automations?surface=app
- https://learn.chatgpt.com/docs/hooks
- https://learn.chatgpt.com/docs/customization/overview
- https://learn.chatgpt.com/docs/changelog
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/models/compare
- https://developers.openai.com/api/docs/guides/text-to-speech
- https://developers.openai.com/api/docs/guides/speech-to-text
- https://github.com/openai/codex
- https://www.morphllm.com/codex-pricing
- https://higgsfield.ai/blog/generate-ai-videos-higgsfield-api
- https://docs.higgsfield.ai/
- https://higgsfield.ai/creator-hub/help-center/integrations/what-is-higgsfield-mcp
- https://ai.google.dev/gemini-api/docs/pricing
- https://magichour.ai/blog/veo-3-pricing
- https://kling.ai/document-api/api/get-started/authentication.md
- https://kling.ai/document-api/guides/get-started/quick-start.md
- https://docs.dev.runwayml.com/
- https://costbench.com/software/ai-media-apis/runway-api/
- https://fal.ai/docs/documentation/model-apis/inference/queue
- https://fal.ai/mcp
- https://replicate.com/docs/topics/predictions/create-a-prediction.md
- https://replicate.com/docs/reference/mcp
- https://remotion.dev/docs/cli/render
- https://www.remotion.dev/docs/ai/skills
- https://www.remotion.dev/docs/ai/mcp
- https://github.com/remotion-dev/remotion
- https://github.com/heygen-com/hyperframes
- https://github.com/Zulko/moviepy
- https://github.com/mifi/editly
- https://elevenlabs.io/docs/capabilities/text-to-speech
- https://elevenlabs.io/docs/api-reference/streaming-with-timestamps
- https://elevenlabs.io/docs/agents-platform/operate/hosted-mcp
- https://github.com/elevenlabs/elevenlabs-mcp
- https://aireiter.com/blog/gpt-image-2-api-pricing
- https://developers.google.com/youtube/v3/determine_quota_cost
- https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing
- https://github.com/harry0703/MoneyPrinterTurbo
- https://github.com/calesthio/OpenMontage
- https://github.com/HBAI-Ltd/Toonflow-app
- https://github.com/FujiwaraChoki/MoneyPrinter
- https://github.com/Vincentwei1021/video-shotcraft
- https://github.com/RayVentura/ShortGPT
- https://github.com/Anil-matcha/AI-Youtube-Shorts-Generator
- https://github.com/FireRedTeam/FireRed-OpenStoryline
- https://github.com/0xsline/OpenChatCut
- https://github.com/myccarl/ai-shortVideo-pipeline
- https://github.com/aqm857886159/Nomi
- https://github.com/OSideMedia/higgsfield-ai-prompt-skill
- https://github.com/KyaniteLabs/kinocut
- https://github.com/video-creator/ffmpeg-mcp
- https://github.com/stephengpope/remotion-media-mcp
- https://github.com/luminarylane/fal-mcp-server
- https://github.com/deepfates/mcp-replicate
- https://github.com/ZubeidHendricks/youtube-mcp-server
- https://github.com/anwerj/youtube-uploader-mcp
- https://github.com/Hikhakk/higgsfield-mcp-unified
- https://github.com/MiniMax-AI/MiniMax-MCP
- https://benchlm.ai/anthropic/api-pricing
