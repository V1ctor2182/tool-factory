# victor-tool-factory

A monorepo of small, atomic tools that plug into projects and agents. Each service is one directory with a `service.json` manifest, a CLI, and a `SKILL.md`. A generic `factory` CLI reads the manifests and provides the MCP adapter, run log, health checks, skill linking, and a read-only dashboard. The design and its rules are in [ARCHITECTURE.md](ARCHITECTURE.md).

The first services come from an AI video pipeline (transcripts, media fetch). The research below is the origin of those services.

## Research (2026-10-10)

Three briefs live under `research/`. Each claim carries a source URL. Anything the researcher could not verify is marked `(guess)` or `(inferred)` inline.

| Brief | What it answers |
|---|---|
| [research/higgsfield.md](research/higgsfield.md) | What Higgsfield is, its models, pricing, API, MCP, comparison with Kling / Veo / Runway / Seedance, known complaints, cost per finished minute |
| [research/coding-agents.md](research/coding-agents.md) | Pipeline stages and tools, Claude Code vs Codex CLI for automation, open-source projects to borrow from, MCP servers, model pricing, recommended architecture |
| [research/skills.md](research/skills.md) | The SKILL.md spec, registries, existing video skills, best practices, a proposed 11-skill set for this studio |

## Decisions the research supports

1. **Use the Higgsfield API, not the subscription, for scripted generation.** Launched 2026-09-16. Key auth, async poll or webhook, TS and Python SDKs. Verified list prices (2026-10-10): Kling 3.0 at $0.042/s, Seedance 2.5 at $0.144/s, Cinema Studio 4.0 at $0.21/s, Soul 2 at $0.0032/image. A 60 second video with 12 shots and 3x iteration is about $11 via API versus about $27 on the Plus plan (estimate, arithmetic in the brief).
2. **Higgsfield's own models win on preset camera and VFX control, not raw quality.** Kling 3.0, Veo 3.1, and Seedance 2.5 beat them on quality. Treat Higgsfield as the one-stop API for all of those plus Soul ID character consistency.
3. **Claude Code orchestrates. Codex reviews.** Both load the same SKILL.md files. Claude Code has the Agent SDK, scheduled tasks, hooks, and per-stage subagents. Codex CLI has no SDK and its automations cannot be created from the CLI.
4. **Video spend dwarfs LLM spend.** One 8 second Veo 3.1 Standard clip is $3.20. A whole script on Opus 5.5 is under $0.50. Model choice is not where the money goes. Draft on cheap tiers, finalize only approved shots.
5. **Install vendor skills, write studio skills.** `remotion-dev/skills`, `elevenlabs/skills`, `higgsfield-ai/skills`, and `fal-ai-community/skills` are official and current. Study `calesthio/OpenMontage` (manifest plus skills, AGPL) and `heygen-com/hyperframes` (HTML to MP4) before building anything.
6. **Anything that spends money is a user-only skill plus a budget hook.** A skill instruction is a request. A `PreToolUse` hook is enforcement.

## Proposed layout

```
videos/<slug>/manifest.json     per-video state: stage status, input hashes, vendor request IDs, cost
videos/<slug>/01-idea ... 09-publish
.claude/skills/<stage>/         script-draft, shot-list, video-prompt, gen-shot, voiceover, assemble, captions, publish-pack, qc-review
scripts/                        gen_shot.py, assemble.sh, captions.py, publish.py (deterministic, idempotent)
```

Reruns are idempotent. Every script checks the manifest first. Same input hash, skip. Vendor request ID with no file, poll instead of resubmit.

## Risk flags on Higgsfield

Credit prices changed several times in 2026. Unlimited passes are throttled by a "battery". Accounts have been suspended without explanation. Support waits of 36 to 48 hours. A Forbes piece (2026-02-11) on Earn program content and creator payments. Trustpilot 4.0 with 19% one-star. Keep the API key path, keep spend capped, keep a fallback vendor (fal.ai hosts Kling and Seedance too).
