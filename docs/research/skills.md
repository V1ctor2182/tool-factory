# Claude Code Skills for a Solo AI Video Studio

Research date: 2026-10-10. Every factual claim carries a URL. Unverified claims are marked (guess) or (inferred).

## 1. The skills spec as of Oct 2026

A skill is a folder with a required `SKILL.md` (YAML frontmatter plus Markdown body) and optional `scripts/`, `references/`, and `assets/` folders. [agentskills.io spec](https://agentskills.io/specification)

### Open standard fields (agentskills.io)

Required: `name` (1 to 64 chars, lowercase, digits, hyphens, must match folder name) and `description` (1 to 1024 chars, says what it does and when to use it). Optional: `license`, `compatibility` (max 500 chars), `metadata` (string map), `allowed-tools` (experimental). [spec](https://agentskills.io/specification)

### Claude Code extensions (code.claude.com)

Claude Code accepts the spec fields and adds these. [Claude Code skills docs](https://code.claude.com/docs/en/skills)

- `when_to_use`: extra trigger context. `description` plus `when_to_use` is truncated at 1,536 chars in the listing.
- `argument-hint`, `arguments`: argument autocomplete and named `$name` substitution.
- `disable-model-invocation: true`: Claude cannot auto-invoke; only `/name` works; the description is kept out of context. Recommended for side-effect workflows.
- `user-invocable: false`: hidden from the `/` menu; only Claude can load it. For background knowledge.
- `allowed-tools`, `disallowed-tools`: pre-approve or remove tools for the invocation turn. Supports `Bash(git *)` patterns and `Bash(${CLAUDE_SKILL_DIR}/scripts/render.sh *)`.
- `model`, `effort`: per-skill overrides.
- `context: fork` plus `agent: Explore|Plan|general-purpose|custom`: runs the skill as an isolated subagent. `background` defaults to true.
- `hooks`: hooks registered when the skill is invoked, persisting for the session. `once: true` runs a hook only the first time.
- `paths`: glob patterns that limit auto-activation to matching files.
- `shell`: `bash` or `powershell` for injected commands.
- Spec fields `license`, `compatibility`, `metadata` are accepted but unused.

Body features: `$ARGUMENTS`, `$0`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`, and dynamic injection via `` !`command` `` which runs on your machine before Claude sees the skill (2 minute timeout, non-zero exit aborts the invocation). [docs](https://code.claude.com/docs/en/skills)

### Progressive disclosure

Three levels: metadata (name plus description, about 100 tokens, loaded at startup for every skill), instructions (full SKILL.md body, under 5000 tokens recommended, loaded on activation), resources (scripts, references, assets, loaded only when needed). Keep SKILL.md under 500 lines. Keep file references one level deep. [spec](https://agentskills.io/specification). Scripts are executed, not read, so only their output costs tokens. [best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### Where skills live

Enterprise managed dir, personal `~/.claude/skills/<name>/SKILL.md`, project `.claude/skills/<name>/SKILL.md`, nested `<subdir>/.claude/skills/`, `--add-dir` dirs, plugins at `<plugin>/skills/<name>/` (namespaced as `/plugin:skill`), and claude.ai synced skills downloaded to `~/.claude/skills/synced/`. Name resolution: enterprise > personal > project > nested. Legacy `.claude/commands/*.md` files still work as skills. [docs](https://code.claude.com/docs/en/skills)

Plugins are distributed through marketplaces: a repo with `.claude-plugin/marketplace.json`, added with `claude plugin marketplace add <owner>/<repo>` and installed with `claude plugin install name@marketplace`. The name `claude-plugins-official` is reserved for Anthropic. [marketplace docs](https://code.claude.com/docs/en/plugin-marketplaces)

skills.sh is Vercel's directory; `npx skills add <owner/repo>` installs into any of 75+ agents by symlink or copy, project or global scope. [vercel-labs/skills](https://github.com/vercel-labs/skills), [skills.sh](https://skills.sh/)

### Invocation

User invocation: `/name args`, stackable up to 6 skills. Model invocation: Claude matches the task against descriptions and loads the body. Once loaded, content persists across turns; Claude Code does not re-read the file later, so write standing instructions. On compaction each re-attached skill keeps its first 5,000 tokens, 25,000 total. `skillOverrides` in settings can set a skill to `on`, `name-only`, `user-invocable-only`, or `off` without editing it. [docs](https://code.claude.com/docs/en/skills)

Local check: this machine has 130 plus skill folders under `~/.claude/skills/`. Example frontmatter seen: `architect` uses `disable-model-invocation: true`; gstack skills use `allowed-tools` lists plus non-spec `triggers` and `version` keys, which Claude Code ignores. (Read locally on 2026-10-10.)

## 2. Anthropic's official skills repo

[github.com/anthropics/skills](https://github.com/anthropics/skills): 180.2k stars, Apache 2.0 for most skills, document skills are source-available. Folders: `skills/`, `spec/`, `template/`, `.claude-plugin/`.

Skills present in `skills/`: academy-guide, algorithmic-art, brand-guidelines, canvas-design, claude-api, discernment-nudge, doc-coauthoring, docx, frontend-design, internal-comms, mcp-builder, pdf, pptx, skill-creator, slack-gif-creator, theme-factory, web-artifacts-builder, webapp-testing, xlsx. [skills dir](https://github.com/anthropics/skills/tree/main/skills)

Media-relevant ones: `slack-gif-creator` (animated GIF output), `canvas-design` (static poster and art PNG or PDF), `algorithmic-art`, `brand-guidelines`, `theme-factory`, `frontend-design`. [skills dir](https://github.com/anthropics/skills/tree/main/skills). There is no video, audio, or ffmpeg skill in the official repo. (verified by listing)

## 3. Community registries and marketplaces

| Registry | URL | What it is |
|---|---|---|
| skills.sh | https://skills.sh/ | Vercel's directory, 1.26M indexed skills, install leaderboard, `npx skills add` |
| Vercel skills CLI | https://github.com/vercel-labs/skills | 33.6k stars, `add find list update remove init`, 75+ agents |
| ComposioHQ/awesome-claude-skills | https://github.com/ComposioHQ/awesome-claude-skills | 76.8k stars, curated list, pushed 2026-09-18 |
| travisvn/awesome-claude-skills | https://github.com/travisvn/awesome-claude-skills | 15.3k stars, Claude Code focused, pushed 2026-04-28 |
| BehiSecc, karanb192, GetBindu lists | https://github.com/BehiSecc/awesome-claude-skills | Smaller curated lists found by search |
| majiayu000/claude-skill-registry | https://github.com/majiayu000/claude-skill-registry | Searchable catalog with generated registry artifacts |
| agentskills.io client list | https://agentskills.io/ | Spec site; lists Claude Code, Cursor, Codex, Gemini CLI, Copilot, OpenCode and 40 others as adopters |
| Claude Code plugin marketplaces | https://code.claude.com/docs/en/plugin-marketplaces | Git-hosted `marketplace.json` catalogs |

Third-party aggregator sites (skillsdirectory.com, skillsmp.com, claudeskills.club, agentskill.sh) also index skills but were not verified beyond search results. (inferred)

## 4. Existing video-production skills

Install counts are from skills.sh pages. Stars and push dates are from the GitHub API on 2026-10-10.

| Skill | Author | Installs or stars | Last push | What it does |
|---|---|---|---|---|
| [remotion-dev/skills](https://github.com/remotion-dev/skills) | Remotion (official) | 594.9K installs for remotion-best-practices, 4,973 stars | 2026-10-07 | 12 skills: best-practices, create, captions, render, multimedia, studio, maps, saas, etc. React video framework |
| [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) | HeyGen | 59.9k stars, Apache 2.0 | 2026-10-10 | HTML to deterministic MP4; 21 skills incl. router, captions, music-to-video, product-launch-video; installs as a plugin marketplace |
| [higgsfield-ai/skills](https://github.com/higgsfield-ai/skills) | Higgsfield (official) | 196.7K installs for higgsfield-generate, 1,250 stars, MIT | 2026-09-26 | Wraps higgsfield CLI: image, video, 3D, audio over 30 plus models incl. Veo 3.1 and Kling 3.0; also higgsfield-youtube-thumbnail (81.4K) and higgsfield-video-explainer (103.1K) |
| [OSideMedia/higgsfield-ai-prompt-skill](https://github.com/OSideMedia/higgsfield-ai-prompt-skill) | OSideMedia | 712 stars, MIT | 2026-09-27 | 32 prompt sub-skills for Seedance 2.5, Kling 3.0 Motion Control, Cinema Studio, Soul ID consistency |
| [elevenlabs/skills](https://github.com/elevenlabs/skills) | ElevenLabs (official) | 81.4K installs total; text-to-speech 14.1K, sound-effects 9.1K, music 8.9K, dubbing 2.6K; 482 stars, MIT | 2026-10-09 | 12 skills covering TTS, STT, SFX, music, voice changer, dubbing |
| [fal-ai-community/skills](https://github.com/fal-ai-community/skills) | fal community | 251 stars | 2026-09-29 | fal-generate skill for fal.ai image, video, audio models |
| [NickGeorge99/fal-skill](https://github.com/NickGeorge99/fal-skill) | NickGeorge99 | 0 stars, MIT | 2026-08-08 | One bash script plus jq; fal images, video, TTS, lipsync, local ffmpeg assembly |
| [sabaazdn73/gemini-veo-studio-skill-for-claude](https://github.com/sabaazdn73/gemini-veo-studio-skill-for-claude) | sabaazdn73 | not fetched | not fetched | Veo 3.1 via Gemini API: text-to-video, image-to-video, character reference, MP4 post |
| [kdowswell/veo-tools](https://github.com/kdowswell/veo-tools) | kdowswell | not fetched | not fetched | Veo 3.1 via Vertex AI, seamless loops |
| [jnMetaCode/ai-shortfilm-prompts](https://github.com/jnMetaCode/ai-shortfilm-prompts) | jnMetaCode | 459 stars, MIT | 2026-10-05 | Idea to model-ready video prompt for Sora, Kling, Veo, Seedance; 21 genre templates, eval-tested |
| [aicontentskills/ai-video-storyboard-skill](https://github.com/aicontentskills/ai-video-storyboard-skill) | aicontentskills | 62 stars | 2026-04-09 | Brief to multi-shot plan with cinematic prompts and consistency checklist |
| [XucroYuri/take](https://github.com/XucroYuri/take) | XucroYuri | 4 stars, MIT | 2026-08-24 | Screenplay to storyboard to video; Skill, MCP, and CLI |
| [MastroMimmo/ffmpeg-skill](https://github.com/MastroMimmo/ffmpeg-skill) | MastroMimmo | 22 stars, MIT | 2026-03-16 | 18 ffmpeg commands: cut, merge, compress, subtitle, GIF, watermark, speed, stabilize |
| [fabriqaai/ffmpeg-analyse-video-skill](https://github.com/fabriqaai/ffmpeg-analyse-video-skill) | fabriqaai | 33 stars | 2026-02-15 | Extract frames with ffmpeg, vision summaries with timestamps |
| [wilwaldon/Claude-Code-Video-Toolkit](https://github.com/wilwaldon/Claude-Code-Video-Toolkit) | wilwaldon | 89 stars | Feb 2026 | Curated index: Remotion, Manim, Playwright recording, YouTube clipper, ffmpeg |
| [op7418/Youtube-clipper-skill](https://github.com/op7418/Youtube-clipper-skill) | op7418 | 3.9K installs, 2,226 stars, MIT | 2026-01-22 | Clip segments from YouTube videos |
| [Jakeschincariol/youtube-agent-skill](https://github.com/Jakeschincariol/youtube-agent-skill) | Jakeschincariol | 913 stars, MIT | 2026-09-16 | 11 skills: 21 hook formulas, title plus thumbnail lint, EDL from transcript, retention reader, Shorts cutter |
| [ZeroPointRepo/youtube-skills](https://github.com/ZeroPointRepo/youtube-skills) | ZeroPointRepo | 1,040 stars, MIT | 2026-10-06 | YouTube transcripts, search, channel browsing |
| [kkoppenhaver/cc-skills video-subtitler](https://github.com/kkoppenhaver/cc-skills/tree/main/video-subtitler) | Keanan Koppenhaver | 6 stars | 2026-07-21 | Local whisper.cpp to cleaned SRT; no burn-in ([writeup](https://claudecodeformarketers.com/blog/subtitle-videos-with-claude-code/)) |

Other ffmpeg skills found by search but not inspected: n0an, kajisho5, zhaikong, donghaozhang, ychoi-kr. [search](https://github.com/n0an/ffmpeg-skill)

Categories with nothing found: a dedicated Kling-only skill with a live skills.sh page (the prime-skills kling-3-0 page returned 404), a screenplay-format skill in English (only a Chinese short-drama set, [shuohao-skills](https://github.com/eternityspring/shuohao-skills)), a YouTube upload or publish skill. A thumbnail skill exists only inside the Higgsfield and youtube-agent-skill bundles.

## 5. Skills versus other extension points

Source for the whole table: [Extend Claude Code](https://code.claude.com/docs/en/features-overview).

| Feature | What it is | Loads | Context cost | Combine with skills |
|---|---|---|---|---|
| CLAUDE.md | Always-on project rules, keep under 200 lines | Every session | Every request | CLAUDE.md says "follow our shot conventions", a skill holds the full guide |
| Skill | Instructions, knowledge, workflows; reference or action | Descriptions at start, body on use | Low until used | Core unit |
| Slash command | Legacy `.claude/commands/*.md`; now just a user-invoked skill | On `/name` | On invoke | Same thing as a skill ([skills docs](https://code.claude.com/docs/en/skills)) |
| Subagent | Isolated worker with own context, returns a summary | When spawned | Isolated | `context: fork` runs a skill as a subagent; a subagent can preload skills via `skills:` |
| MCP server | Protocol connection to an external service with auth | Tool names at start, schemas on demand | Low | MCP gives the tool, skill teaches how to use it well; reference tools as `Server:tool` ([best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)) |
| Hook | Script or request that always fires on a lifecycle event | On event | Zero unless it returns output | Guardrails go in hooks, not prompts; a skill can register hooks in frontmatter |
| Plugin | Package of skills, hooks, agents, MCP servers | Install | Varies | Distribution layer, namespaced `/plugin:skill` |

Rule from the docs: a hook is enforcement, a skill or CLAUDE.md line is a request. [features-overview](https://code.claude.com/docs/en/features-overview)

## 6. Best practices for writing skills

- Build evals before writing docs: run Claude without the skill, note failures, write three scenarios, write minimal instructions, iterate. [best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- Descriptions: third person, say what it does and when to trigger, include key terms. The skill-creator says descriptions should be "a little bit pushy" because undertriggering is the common failure, and Claude only consults skills for tasks it cannot easily do alone. [skill-creator](https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/SKILL.md)
- Keep SKILL.md under 500 lines, references one level deep, a table of contents on any reference over 100 lines. [best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- Scripts over prose for deterministic steps. If every test run writes the same helper code, bundle it in `scripts/`. Scripts should handle errors, not defer to Claude, and have no unexplained constants. [skill-creator](https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/SKILL.md), [best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- Match freedom to fragility: exact commands for fragile ops, heuristics for open ones. Use plan, validate, execute with a machine-checked intermediate file for batch work. [best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- Skill-creator workflow: interview, draft, 2 to 3 eval prompts in `evals/evals.json`, with-skill versus baseline runs, grade, `run_loop.py` to optimize the description over 20 queries, `package_skill.py`. Only spec fields survive packaging for claude.ai. [skill-creator](https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/SKILL.md), [docs](https://code.claude.com/docs/en/skills)
- Use `disable-model-invocation: true` on anything with side effects or cost. [features-overview](https://code.claude.com/docs/en/features-overview)
- Test across Haiku, Sonnet, Opus. Avoid dated instructions. Use one term per concept. [best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- `/skill-doctor` reports skill cost versus usage. [docs](https://code.claude.com/docs/en/skills)

## 7. Proposed skill set for this studio

Install, do not rewrite: remotion-dev/skills, elevenlabs/skills, higgsfield-ai/skills or fal-ai-community/skills depending on which vendor the studio uses. Write the ten below as project skills under `.claude/skills/` so they version with the repo. Model-invocable means default frontmatter. User-only means `disable-model-invocation: true`.

### Script

1. `script-draft`. Turn a brief into a timed voiceover script with beats and target duration. Wraps a prompt template in `references/script-format.md` plus a `scripts/wordcount_to_seconds.py` check. Model-invocable.
2. `script-review`. Read a script and flag pacing, hook strength, and claims that need a source. Wraps a checklist. Model-invocable, `context: fork`, `agent: Plan`.

### Shots

3. `shot-list`. Convert a script into a shot list JSON (shot id, duration, camera, subject, continuity refs). Wraps a JSON schema in `assets/shotlist.schema.json` and a `scripts/validate_shotlist.py`. Model-invocable. The validated JSON is the plan file for the plan, validate, execute pattern.

### Prompts

4. `video-prompt`. Write per-shot prompts for the chosen generator (Veo, Kling, Seedance) from the shot list, with character and style anchors. Wraps prompt templates per model in `references/`. Borrow structure from jnMetaCode/ai-shortfilm-prompts. Model-invocable.
5. `style-bible`. Reference-only skill holding the studio's visual rules, color, lens, and banned phrases. `user-invocable: false`. Zero scripts.

### Generate

6. `gen-shot`. Submit one shot prompt to the vendor API, poll, download to `renders/<shot-id>/`, log cost. Wraps `scripts/gen.sh` over the fal or Higgsfield CLI with `allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/gen.sh *)`. User-only, because it spends money.
7. `voiceover`. Render the script with ElevenLabs TTS into per-beat WAVs, then SFX if requested. Wraps `scripts/tts.sh` plus the official elevenlabs skill. User-only.

### Assemble

8. `assemble`. Build the timeline: concat renders, lay voiceover, duck music, burn captions, export 16:9 and 9:16. Wraps `scripts/assemble.py` over ffmpeg, reads the shot list JSON. Fragile and sequenced, so low freedom. User-only.
9. `captions`. Whisper to SRT, cleanup pass for names, optional burn-in. Wraps whisper.cpp like kkoppenhaver's video-subtitler plus an ffmpeg burn step. Model-invocable.

### Publish

10. `publish-pack`. Produce title options, description, tags, chapters from the script and SRT, plus a thumbnail brief. Wraps a template and a `scripts/chapters_from_srt.py`. Model-invocable. Actual upload stays manual or in a later user-only skill. (inferred: no public upload skill exists to borrow)

### Review

11. `qc-review`. Extract frames every N seconds, check against the shot list for continuity and artifacts, report timestamps. Wraps `scripts/frames.sh` (ffmpeg) and vision. Based on fabriqaai's frame-extraction approach. Model-invocable, `context: fork`.

Hooks to pair with these: a `PreToolUse` hook that blocks `gen.sh` when a `budget.json` cap is exceeded, since a skill instruction is a request and a hook is enforcement. [features-overview](https://code.claude.com/docs/en/features-overview) (inferred design)

## Sources

- https://code.claude.com/docs/en/skills
- https://agentskills.io/specification
- https://agentskills.io/
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- https://code.claude.com/docs/en/features-overview
- https://code.claude.com/docs/en/plugin-marketplaces
- https://github.com/anthropics/skills
- https://github.com/anthropics/skills/tree/main/skills
- https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/SKILL.md
- https://skills.sh/
- https://github.com/vercel-labs/skills
- https://github.com/ComposioHQ/awesome-claude-skills
- https://github.com/travisvn/awesome-claude-skills
- https://github.com/majiayu000/claude-skill-registry
- https://github.com/remotion-dev/skills
- https://skills.sh/remotion-dev/skills/remotion-best-practices
- https://github.com/heygen-com/hyperframes
- https://github.com/higgsfield-ai/skills
- https://skills.sh/higgsfield-ai/skills
- https://github.com/OSideMedia/higgsfield-ai-prompt-skill
- https://github.com/elevenlabs/skills
- https://skills.sh/elevenlabs/skills
- https://github.com/fal-ai-community/skills
- https://github.com/NickGeorge99/fal-skill
- https://github.com/sabaazdn73/gemini-veo-studio-skill-for-claude
- https://github.com/kdowswell/veo-tools
- https://github.com/jnMetaCode/ai-shortfilm-prompts
- https://github.com/aicontentskills/ai-video-storyboard-skill
- https://github.com/XucroYuri/take
- https://github.com/MastroMimmo/ffmpeg-skill
- https://github.com/fabriqaai/ffmpeg-analyse-video-skill
- https://github.com/wilwaldon/Claude-Code-Video-Toolkit
- https://github.com/op7418/Youtube-clipper-skill
- https://skills.sh/op7418/youtube-clipper-skill
- https://github.com/Jakeschincariol/youtube-agent-skill
- https://github.com/ZeroPointRepo/youtube-skills
- https://github.com/kkoppenhaver/cc-skills/tree/main/video-subtitler
- https://claudecodeformarketers.com/blog/subtitle-videos-with-claude-code/
- https://github.com/eternityspring/shuohao-skills
