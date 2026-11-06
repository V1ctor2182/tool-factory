# Research

Each brief lists its sources. Anything the researcher could not verify is marked `(guess)` or `(inferred)` inline.

## Cloning a site (2026-11-02)

| Brief | What it answers |
|---|---|
| [clone-any-site-process.md](clone-any-site-process.md) | The process that two runs produced, written so it can become the `site-clone` service |
| [clone-any-site-quorum.md](clone-any-site-quorum.md) | A run log on a canvas game |
| [clone-any-site-shopify-editions.md](clone-any-site-shopify-editions.md) | A run log on a scroll-driven marketing page with WebGPU, 3D models, Rive, and video |

## The AI video pipeline (2026-10-10)

The repo started as an AI video pipeline, then became the factory on 2026-10-14. No video pipeline exists in the repo. The prices and the layout below date from 2026-10-10, so check them before you use them.

| Brief | What it answers |
|---|---|
| [higgsfield.md](higgsfield.md) | What Higgsfield is, its models, pricing, API, MCP, comparison with Kling, Veo, Runway, and Seedance, known complaints, and cost per finished minute |
| [coding-agents.md](coding-agents.md) | Pipeline stages and tools, Claude Code versus Codex CLI for automation, open-source projects to borrow from, MCP servers, model pricing, and a recommended architecture |
| [skills.md](skills.md) | The SKILL.md spec, registries, existing video skills, best practices, and a proposed 11-skill set for the studio |

### Decisions the research supports

1. **Use the Higgsfield API, not the subscription, for scripted generation.** Launched 2026-09-16. Key auth, async poll or webhook, TS and Python SDKs. Verified list prices (2026-10-10): Kling 3.0 at $0.042/s, Seedance 2.5 at $0.144/s, Cinema Studio 4.0 at $0.21/s, Soul 2 at $0.0032/image. A 60 second video with 12 shots and 3x iteration is about $11 via API versus about $27 on the Plus plan (estimate, arithmetic in the brief).
2. **Higgsfield's own models win on preset camera and VFX control, not raw quality.** Kling 3.0, Veo 3.1, and Seedance 2.5 beat them on quality. Treat Higgsfield as the one-stop API for all of those plus Soul ID character consistency.
3. **Claude Code orchestrates. Codex reviews.** Both load the same SKILL.md files. Claude Code has the Agent SDK, scheduled tasks, hooks, and per-stage subagents. Codex CLI has no SDK and its automations cannot be created from the CLI.
4. **Video spend dwarfs LLM spend.** One 8 second Veo 3.1 Standard clip is $3.20. A whole script on Opus 5.5 is under $0.50. Model choice is not where the money goes. Draft on cheap tiers, finalize only approved shots.
5. **Install vendor skills, write studio skills.** `remotion-dev/skills`, `elevenlabs/skills`, `higgsfield-ai/skills`, and `fal-ai-community/skills` are official and current. Study `calesthio/OpenMontage` (manifest plus skills, AGPL) and `heygen-com/hyperframes` (HTML to MP4) before building anything.
6. **Anything that spends money is a user-only skill plus a budget hook.** A skill instruction is a request. A `PreToolUse` hook is enforcement.

### Proposed layout

```
videos/<slug>/manifest.json     per-video state: stage status, input hashes, vendor request IDs, cost
videos/<slug>/01-idea ... 09-publish
.claude/skills/<stage>/         script-draft, shot-list, video-prompt, gen-shot, voiceover, assemble, captions, publish-pack, qc-review
scripts/                        gen_shot.py, assemble.sh, captions.py, publish.py (deterministic, idempotent)
```

Reruns are idempotent. Every script checks the manifest first. Same input hash, skip. Vendor request ID with no file, poll instead of resubmit.

### Risk flags on Higgsfield

Credit prices changed several times in 2026. Unlimited passes are throttled by a "battery". Accounts have been suspended without explanation. Support waits of 36 to 48 hours. A Forbes piece (2026-02-11) on Earn program content and creator payments. Trustpilot 4.0 with 19% one-star. Keep the API key path, keep spend capped, keep a fallback vendor (fal.ai hosts Kling and Seedance too).
