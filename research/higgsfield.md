# Higgsfield AI. Research brief for a solo AI video studio

Date: 2026-10-10. All claims carry a source URL. Items marked (guess) or (inferred) were not verified directly.

## 1. What Higgsfield is and who runs it

Higgsfield is a San Francisco AI video and image platform. It bundles its own models with licensed third-party models in one web app, one API, and one MCP server. Founder and CEO is Alex Mashrabov, who previously led generative AI at Snap after Snap bought his startup AI Factory in 2020 ([Wikipedia summary via search](https://en.wikipedia.org/wiki/Higgsfield_AI), [TechCrunch](https://techcrunch.com/2026/08/17/higgsfield-raises-400m-series-b-quadrupling-its-valuation-in-8-months-to-5-4b/)). Cofounder Yerzat Dulat and Chief Strategy Officer Mahi de Silva are the other named leaders ([Product Growth teardown](https://www.productgrowth.blog/p/higgsfield-growth-teardown)). The company was founded in October 2023 and is headquartered in San Francisco ([Baidu wiki](https://baike.baidu.com/en/item/Higgsfield%20AI/4816265), [About page](https://higgsfield.ai/about)).

Funding: $8M seed April 2024 (Menlo), $50M Series A September 2025 (GFT), $80M extension January 2026 at $1.3B valuation, $400M Series B August 2026 at $5.4B led by DST Global ([Sacra](https://sacra.com/c/higgsfield/), [TechCrunch](https://techcrunch.com/2026/08/17/higgsfield-raises-400m-series-b-quadrupling-its-valuation-in-8-months-to-5-4b/)). Claimed scale: $700M annualized revenue and 30M users at Series B; Sacra reports a $1B run rate by September 2026 and about 1M paying subscribers ([TechCrunch](https://techcrunch.com/2026/08/17/higgsfield-raises-400m-series-b-quadrupling-its-valuation-in-8-months-to-5-4b/), [Sacra](https://sacra.com/c/higgsfield/)).

Product lineup and release dates:

- Diffuse mobile app, April 2024 ([Baidu wiki](https://baike.baidu.com/en/item/Higgsfield%20AI/4816265)).
- Web platform, March 2025 ([Product Growth](https://www.productgrowth.blog/p/higgsfield-growth-teardown)).
- DoP I2V-01-preview, image-to-video with camera presets, March 2025 ([Baidu wiki](https://baike.baidu.com/en/item/Higgsfield%20AI/4816265)).
- Soul image model. Presets were expanded in July 2025, so launch was mid 2025 (inferred) ([Baidu wiki](https://baike.baidu.com/en/item/Higgsfield%20AI/4816265)). Now at Soul 2.0 plus Soul Cinema, Soul ID, Soul HEX ([About page](https://higgsfield.ai/about)).
- Speak, talking-character lipsync. Now Speak 2.0 ([Help center lipsync](https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-lipsync-voiceover-and-aspect-ratios)). Original launch date mid 2025 (guess).
- Popcorn storyboard model, October 2025 ([Baidu wiki](https://baike.baidu.com/en/item/Higgsfield%20AI/4816265)). Makes 4, 6 or 8 frame sequences ([Soku](https://soku.ai/integrations/higgsfield)).
- Cinema Studio. Sources conflict: September 2025 per Product Growth, December 2025 per Baidu ([Product Growth](https://www.productgrowth.blog/p/higgsfield-growth-teardown), [Baidu wiki](https://baike.baidu.com/en/item/Higgsfield%20AI/4816265)). Version 4.0 shipped August 12, 2026 with 30 second generations ([Changelog](https://higgsfield.ai/creator-hub/changelog)).
- Recent 2026 additions, all from the [official changelog](https://higgsfield.ai/creator-hub/changelog): Seedance 2.5 with 30s clips and native audio (Aug 6), Genjutsu video edit (Sep 1), 3D Jutsu (Sep 4), Higgsfield API public launch (Sep 16), AI Influencer (Oct 2), Ad Multiplier and Nano Banana 2.1 (Oct 6), Katana Claude skill (Oct 8). Also a Supercomputer chat workspace, Marketing Studio, Photoshop, Blender, After Effects, Figma and DaVinci plugins.

## 2. Hosted models vs Higgsfield's own

Third-party video models on the platform: Kling 3.0, Kling o1, Kling 2.6, Sora 2, Veo 3.1, Wan 2.7 and Wan 3.0, Seedance 2.0 and 2.5 (ByteDance), MiniMax Hailuo, Grok Imagine Video 1.5, LTX 2.5 ([AI video page](https://higgsfield.ai/ai-video), [Changelog](https://higgsfield.ai/creator-hub/changelog), [API page](https://higgsfield.ai/higgsfield-api)). Higgsfield has an enterprise dedicated US deployment of Seedance ([Changelog](https://higgsfield.ai/creator-hub/changelog)).

Third-party image models: Nano Banana 2 and 2.1, Nano Banana Pro, GPT Image 2 and 2.5, Seedream 5.0, FLUX 3, Ideogram 4.5, Recraft V4 ([Changelog](https://higgsfield.ai/creator-hub/changelog)). Audio: Eleven v4, Seed Audio, MiniMax Speech, Qwen ([Which model guide](https://higgsfield.ai/creator-hub/help-center/ai-models/which-ai-model-should-i-use)).

Higgsfield's own: Soul 2, Soul Cinema, Soul ID, Soul HEX, DoP, Keyframes, Popcorn, Speak 2.0, Cinema Studio 4.0, Genjutsu, Marketing Studio Image ([API page](https://higgsfield.ai/higgsfield-api), [About page](https://higgsfield.ai/about)). Sacra characterizes the proprietary layer as camera control, character consistency, story reasoning and similarity scoring on top of licensed generators ([Sacra](https://sacra.com/c/higgsfield/)).

## 3. Signature features and output specs

- Camera presets: DoP offers categories Effects, Basic Camera, Epic Camera, Catch the Pulse, Mix, Trending ([DoP help](https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-dop)). Reviewers count 70+ presets such as Crash Zoom, Dolly, 360 Orbit, Bullet Time ([frankx guide](https://www.frankx.ai/guides/higgsfield-ai-video-guide)). 13 new viral presets added August 7, 2026 ([Changelog](https://higgsfield.ai/creator-hub/changelog)).
- VFX and effects: Effects 2.0 presets, Relight (6 presets), HEX video color grading (50+ presets) ([Changelog](https://higgsfield.ai/creator-hub/changelog)).
- Character consistency: Soul ID trains a character once and reuses the face across generations and as Elements in other models ([Which model guide](https://higgsfield.ai/creator-hub/help-center/ai-models/which-ai-model-should-i-use)).
- Lip sync: Speak 2.0 plus routed third-party lipsync (Veo 3.1, Kling 2.6 Lipsync up to 1080p, Wan 2.5 Speak, Kling Avatars 2.0, Infinite Talk, Sync Lipsync 3 up to 4K). Aspect ratios 9:16, 16:9, 1:1, 4:3, 3:4, 21:9 ([Lipsync help](https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-lipsync-voiceover-and-aspect-ratios)).
- Image-to-video: DoP accepts PNG or JPG, clips of 3 or 5 seconds ([DoP help](https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-dop)).
- Start and end frames: Keyframes tool is native; Wan offers first and last frame control ([Which model guide](https://higgsfield.ai/creator-hub/help-center/ai-models/which-ai-model-should-i-use), [About page](https://higgsfield.ai/about)).
- Extend: Seedance 2.5 supports video edit and extend per community prompt skill ([OSideMedia skill](https://github.com/OSideMedia/higgsfield-ai-prompt-skill)).
- Upscaling: ByteDance Upscale to 4K with 60fps interpolation, FLUX 3 Video Upscaler, and a dedicated image Upscale tool ([Changelog](https://higgsfield.ai/creator-hub/changelog)).

Output specs:

- Cinema Studio 4.0 via API: 480p to 720p, 4 to 30 seconds, 24 fps, optional sound ([Open Higgsfield playground](https://open.higgsfield.ai/models/higgsfield/cinema-studio/4.0/playground)). Marketing pages claim native 4K and up to one minute on the web product ([Cinema Studio page](https://higgsfield.ai/cinematic-video-generator)). Treat 4K as web-only and upscaled (inferred).
- Soul Cinema images: 720p or 1080p, seven aspect ratios ([layer.ai docs](https://layer.ai/docs/models/higgsfield-soul-cinema)).
- Seedance 2.5: up to 30 seconds with native ambience, foley and score. Seedance 2.0: up to 4K ([Changelog](https://higgsfield.ai/creator-hub/changelog)).
- DoP: 3 or 5 second clips, no native audio mentioned ([DoP help](https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-dop)). Resolution not published (guess: 720p to 1080p).

## 4. Pricing

Consumer plans as of October 7, 2026 ([sloptv](https://sloptv.co/guides/higgsfield-pricing), [Krea](https://www.krea.ai/blog/higgsfield-pricing-explained-2026-unlimited-credits-and-real-monthly-costs)):

| Plan | Monthly | Annual (per mo) | Credits/mo | Unlimited perks | Parallel jobs |
|---|---|---|---|---|---|
| Free | $0 | $0 | 0 (10 image gens/day) | None | 1 |
| Starter | $19 | $19 | 270 | None. Seedance Fast/Mini only | 2 video, 4 image |
| Plus | $59 | $47 | 1,200 | 7 day Kling 3.0 and Nano Banana 2 | Unlimited paid |
| Ultra | $129 | $99 | 3,000 | Adds Nano Banana Pro 2K, 7 day window | Unlimited paid |

Older plan names (Basic $9, Pro $29, Max $79, Creator $119) still appear in some reviews. Prices changed several times in 2026 ([novoads](https://novoads.ai/en/blog/higgsfield-pricing), [gstory](https://www.gstory.ai/blog/higgsfield-ai/)). Team, Scale and Enterprise plans exist with per-seat unlimited bundles ([Changelog](https://higgsfield.ai/creator-hub/changelog)).

Credit value: about $0.070 (Starter), $0.039 (Plus annual), $0.033 (Ultra annual) ([sloptv](https://sloptv.co/guides/higgsfield-pricing)). Top-up packs: 80 credits for $5 up to 1,700 for $80, about $0.047 to $0.063 per credit ([Krea](https://www.krea.ai/blog/higgsfield-pricing-explained-2026-unlimited-credits-and-real-monthly-costs)).

Per-generation credit costs: Seedance 2.0 23 credits (5s 720p), 45 (5s 1080p), 90 (10s 1080p). Kling 3.0 10 credits (5s 720p), 12.5 (5s 1080p). Wan 2.7 8 to 13 credits. Nano Banana Pro 2 to 4 credits per image ([Krea](https://www.krea.ai/blog/higgsfield-pricing-explained-2026-unlimited-credits-and-real-monthly-costs)). Veo 3.1 about 29 credits per 4s. Sora 2 Pro 30 to 54 credits ([aifunnelinsider](https://aifunnelinsider.com/higgsfield-ai-review-2026/)). In dollars on Plus annual: one 5s Kling 1080p clip is about $0.49, one 5s Seedance 1080p clip about $1.76.

Unlimited: "365 Day Unlimited" is mostly image models. Unlimited video runs through a slower standard queue with a "battery" that slows generations with use, resolution locked at 720p, 2 to 4 concurrent jobs ([aiimagetovideo](https://aiimagetovideo.pro/blog/higgsfield-unlimited/), [sloptv](https://sloptv.co/guides/higgsfield-pricing)). An "All Unlimited" pass launched July 20, 2026 ([Changelog](https://higgsfield.ai/creator-hub/changelog)).

Credit expiry: subscription credits reset at renewal and do not roll over. Packs expire 90 days after purchase. Re-rolls and upscales cost credits ([Krea](https://www.krea.ai/blog/higgsfield-pricing-explained-2026-unlimited-credits-and-real-monthly-costs)).

Commercial rights: Higgsfield claims no ownership of outputs and does not restrict commercial use on any paid plan. The pricing page marks Free as "no commercial use" and Free outputs are watermarked, which conflicts with the Terms ([Ownership help](https://higgsfield.ai/creator-hub/help-center/account/who-owns-my-generations-and-can-i-use-them-commercially), [sloptv](https://sloptv.co/guides/higgsfield-pricing)).

API pricing (separate from subscriptions): pay per generation, 15% launch discount, extra discounts on 4 chosen models, $15 credit for verified business email. Sample list prices: Kling 3.0 $0.042/s (50% off), Seedance 2.5 $0.144/s (30% off), Cinema Studio 4.0 $0.2057 to $0.4623/s, Hailuo 2.3 $0.0117/s, Soul 2 $0.0032/image ([API page](https://higgsfield.ai/higgsfield-api), [Cinema Studio playground](https://open.higgsfield.ai/models/higgsfield/cinema-studio/4.0/playground)). API credits expire one year after purchase. Failed or moderated requests are not charged. Outputs are retained at least seven days ([Billing docs](https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md)).

## 5. Programmatic access

An official API exists. It launched publicly September 16, 2026 ([Changelog](https://higgsfield.ai/creator-hub/changelog)).

- Docs: https://docs.higgsfield.ai/docs. Console: https://console.higgsfield.ai (also open.higgsfield.ai). OpenAPI spec at https://docs.higgsfield.ai/docs/openapi.json ([llms.txt index](https://docs.higgsfield.ai/docs/llms.txt), [Official platforms](https://higgsfield.ai/creator-hub/help-center/getting-started/official-higgsfield-platforms)).
- Auth: header `Authorization: Key <KEY_ID>:<KEY_SECRET>`, created in the console. Optional `Idempotency-Key` ([layer3labs](https://www.layer3labs.io/guides/higgsfield-api), [API reference](https://docs.higgsfield.ai/docs/api-reference/overview)).
- Lifecycle: POST JSON to a model endpoint on https://api.higgsfield.ai, store `request_id`, poll `status_url` or receive a webhook, download on `completed` ([How it works](https://docs.higgsfield.ai/docs/how-to/introduction)).
- Rate limits: concurrency based, varies by account and model, shown in the console. The marketing page says 20 concurrent requests per key to start. Exceeding returns HTTP 400 "Maximum number of concurrent requests". No Retry-After headers. Higher limits by asking in Discord ([Rate limits doc](https://docs.higgsfield.ai/docs/concepts/rate-limits.md), [API page](https://higgsfield.ai/higgsfield-api)).
- SDKs: official TypeScript `@higgsfield/client` (MIT, 68 stars) and Python, plus `@higgsfield/cli` ([higgsfield-js](https://github.com/higgsfield-ai/higgsfield-js), [SDK doc](https://docs.higgsfield.ai/docs/how-to/sdk.md)).
- MCP: hosted at https://mcp.higgsfield.ai/mcp, OAuth login, no API key. It bills subscription credits, requires a paid plan, and does not honor unlimited passes ([Connect help](https://higgsfield.ai/creator-hub/help-center/integrations/how-do-i-connect-higgsfield-to-ai-agent)). Claude Code users are told to use the CLI plus `npx skills add higgsfield-ai/skills` instead ([meltflexai](https://www.meltflexai.com/blog/higgsfield-mcp)).
- Partner access: Higgsfield's own models are not listed on fal.ai or Replicate. The "swap a single key" claim means request shape compatibility, not hosting ([API page](https://higgsfield.ai/higgsfield-api), [search](https://www.eachlabs.ai/higgsfield/higgsfield)). Eachlabs lists Higgsfield VFX and Soul endpoints ([Eachlabs](https://www.eachlabs.ai/higgsfield/higgsfield)). Make.com has a community app ([Make](https://apps.make.com/higgsfield-ai-sxl99v)).
- Unofficial GitHub: robonuggets/higgsfield-skill (Claude Code skill), OSideMedia/higgsfield-ai-prompt-skill (32 prompt sub-skills), genfeed.ai provider ([robonuggets](https://github.com/robonuggets/higgsfield-skill), [OSideMedia](https://github.com/OSideMedia/higgsfield-ai-prompt-skill), [genfeed PR](https://github.com/genfeedai/genfeed.ai/pull/4839)).

Browser automation of the web app is unnecessary now that an API exists. It also risks account suspension, which Higgsfield has applied without explanation ([Trustpilot via search](https://www.trustpilot.com/review/higgsfield.ai?page=4)).

## 6. Comparison

Price is per 5 second clip at API list prices, 720p to 1080p, unless noted. Quality and control are my judgment (inferred) from the cited reviews.

| Model | Quality | Control | Speed | Price per 5s | API | Native audio |
|---|---|---|---|---|---|---|
| Higgsfield DoP / Cinema Studio 4.0 | Good, preset-driven look | Best preset camera and VFX control. Soul ID | Priority queue on paid; unlimited queue slow | $1.03 to $2.31 (CS 4.0) | Yes, Sep 2026 | Optional |
| Kling 3.0 (via Higgsfield) | Top photorealism | Motion control, lipsync | Medium | $0.21 (Higgsfield promo), $0.42 to $0.63 elsewhere | Yes | Audio x1.5 add-on |
| Runway Gen-4 / Gen-4.5 / Aleph | High, strong edit tools | Aleph video-to-video editing | Fast (Turbo) | $0.25 Turbo, $0.60 to $1.00 Gen-4.5, $1.40 Aleph | Yes, Gen-4.5 gated | No |
| Veo 3.1 | Top, 4K | References, start/end frames | Medium | $0.75 Fast, $2.00 Standard | Yes (Google) | Yes |
| Sora 2 | High physics | Weak fine control | Slow queues | $0.50 | API sunset Sept 2026 | Yes |
| Seedance 2.0 / 2.5 | Top motion, 30s | Omni-reference, extend | Medium | $0.45 (2.0), $0.72 (2.5 on Higgsfield) | Yes | Yes (2.5) |
| Luma Ray 3.2 | Good | Keyframes, 1080p | Fast | $0.30 720p, $1.20 1080p | Yes | No |
| Pika 2.5 | Mid | Effects-led | Fast | $0.25 to $0.75 | Via aggregators | No |

Sources: [modelslab](https://modelslab.com/blog/api/veo-3-1-vs-kling-3-sora-2-ai-video-api-cost-2026), [apiframe](https://apiframe.ai/blog/best-ai-video-generation-apis), [unifically Runway](https://unifically.com/blogs/runway-gen-4), [teamday](https://www.teamday.ai/blog/best-ai-video-models-2026), [faxianai Luma vs Pika](https://media.faxianai.com/en/compare/luma-ray3-vs-pika-2-5/), [Higgsfield API page](https://higgsfield.ai/higgsfield-api), [Cinema Studio playground](https://open.higgsfield.ai/models/higgsfield/cinema-studio/4.0/playground), [Pollo review](https://pollo.ai/hub/higgsfield-ai-review). Pollo's verdict: good for camera effects, not better than Kling or Runway on raw quality ([Pollo](https://pollo.ai/hub/higgsfield-ai-review)).

## 7. Weaknesses and complaints

- Credit burn: reviewers document 2x to 6x credit cost increases within three months, and real per-clip cost only shows at the Generate button ([gstory](https://www.gstory.ai/blog/higgsfield-ai/), [aifunnelinsider](https://aifunnelinsider.com/higgsfield-ai-review-2026/)). With 3x to 5x iteration, Plus yields only 34 to 57 usable Kling clips a month ([aifunnelinsider](https://aifunnelinsider.com/higgsfield-ai-review-2026/)).
- Unlimited throttling: a "battery" slows unlimited generations with use, 2 minutes to over 2 hours for the same model. A 53-upvote Reddit thread called it deceptive because the same prompt runs instantly on credits ([aiimagetovideo](https://aiimagetovideo.pro/blog/higgsfield-unlimited/), [gstory](https://www.gstory.ai/blog/higgsfield-ai/)).
- Queue times: 12+ minute waits on Ultra at peak (18:00 to 23:00 UTC) ([aifunnelinsider](https://aifunnelinsider.com/higgsfield-ai-review-2026/)).
- Moderation: stricter than the underlying models, with previously approved content retroactively blocked and no refund on annual plans ([gstory](https://www.gstory.ai/blog/higgsfield-ai/)).
- Account bans: holiday promo buyers were suspended without explanation, refunds sent to dead cards ([Trustpilot via search](https://www.trustpilot.com/review/higgsfield.ai?page=4)).
- Refunds: 7 day window, zero credits used, renewals non-refundable, up to 6% fee ([aifunnelinsider](https://aifunnelinsider.com/higgsfield-ai-review-2026/)).
- Support: AI-first, 36 to 48 hour email waits even on $119 tier ([gstory](https://www.gstory.ai/blog/higgsfield-ai/)).
- Reputation: Forbes (Feb 11, 2026) documented racist videos and nonconsensual celebrity deepfakes in Earn program marketing and creator payment problems. The X account was suspended afterward ([Forbes](https://www.forbes.com/sites/rashishrivastava/2026/02/11/racist-videos-and-payment-problems-the-dark-side-of-this-ai-startups-super-fast-growth/), [Product Growth](https://www.productgrowth.blog/p/higgsfield-growth-teardown)). A dedicated complaint site exists ([higgsfieldsucks](https://higgsfieldsucks.com/)).
- Trustpilot: 4.0 of 5 on about 4,600 reviews, but 19% one-star ([Trustpilot](https://www.trustpilot.com/review/higgsfield.ai)). BBB has a complaints page ([BBB](https://www.bbb.org/us/ca/san-francisco/profile/artificial-intelligence/higgsfield-ai-1116-977987/complaints)).

## 8. How a solo studio would use it

Workflow for a 60 second finished piece (12 shots of 5 seconds):

1. Script and shot list outside Higgsfield.
2. Build one Soul ID character from reference photos ([Which model guide](https://higgsfield.ai/creator-hub/help-center/ai-models/which-ai-model-should-i-use)).
3. Generate stills in Soul 2 or Nano Banana Pro, 2 to 3 per shot, pick 12.
4. Optionally storyboard in Popcorn to lock continuity ([Soku](https://soku.ai/integrations/higgsfield)).
5. Animate each still: Kling 3.0 for most shots, Seedance 2.5 for two hero shots with native sound, DoP presets for two stylized camera moves.
6. One dialogue shot through Speak 2.0.
7. Upscale finals, assemble and grade in DaVinci or Premiere.

Estimated cost per finished minute (estimate, Plus annual, $0.039 per credit):

- Stills: 36 images x 2 credits = 72 credits.
- Kling 3.0: 10 shots x 3 attempts x 12.5 credits (5s 1080p) = 375 credits.
- Seedance 2.5: 2 shots x 2 attempts x 45 credits (assumes 2.0 pricing, guess) = 180 credits.
- Speak: 1 shot x 2 attempts x 15 credits (guess) = 30 credits.
- Upscales: 12 x 2 credits (guess) = 24 credits.
- Total about 681 credits, about $27 per finished minute on Plus. That is 57% of the Plus monthly allowance, so Plus supports about two such videos a month. On Ultra annual ($0.033) the same minute is about $22.

Same workflow through the API at launch prices: Kling 3.0 150s x $0.042 = $6.30. Seedance 2.5 20s x $0.144 = $2.88. Images 36 x $0.0032 = $0.12. Speak and upscales not priced, guess $2. Total about $11 per finished minute, with no monthly fee but no unlimited passes ([API page](https://higgsfield.ai/higgsfield-api)). The API is the cheaper and more predictable route for a solo studio that can script its pipeline.

## Sources

- https://techcrunch.com/2026/08/17/higgsfield-raises-400m-series-b-quadrupling-its-valuation-in-8-months-to-5-4b/
- https://sacra.com/c/higgsfield/
- https://www.productgrowth.blog/p/higgsfield-growth-teardown
- https://baike.baidu.com/en/item/Higgsfield%20AI/4816265
- https://higgsfield.ai/about
- https://higgsfield.ai/creator-hub/changelog
- https://higgsfield.ai/ai-video
- https://higgsfield.ai/higgsfield-api
- https://higgsfield.ai/cinematic-video-generator
- https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-dop
- https://higgsfield.ai/creator-hub/help-center/ai-models/which-ai-model-should-i-use
- https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-lipsync-voiceover-and-aspect-ratios
- https://higgsfield.ai/creator-hub/help-center/integrations/how-do-i-connect-higgsfield-to-ai-agent
- https://higgsfield.ai/creator-hub/help-center/account/who-owns-my-generations-and-can-i-use-them-commercially
- https://higgsfield.ai/creator-hub/help-center/getting-started/official-higgsfield-platforms
- https://docs.higgsfield.ai/docs/llms.txt
- https://docs.higgsfield.ai/docs/how-to/introduction
- https://docs.higgsfield.ai/docs/api-reference/overview
- https://docs.higgsfield.ai/docs/concepts/rate-limits.md
- https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md
- https://docs.higgsfield.ai/docs/how-to/sdk.md
- https://open.higgsfield.ai/models/higgsfield/cinema-studio/4.0/playground
- https://github.com/higgsfield-ai/higgsfield-js
- https://github.com/robonuggets/higgsfield-skill
- https://github.com/OSideMedia/higgsfield-ai-prompt-skill
- https://github.com/genfeedai/genfeed.ai/pull/4839
- https://www.layer3labs.io/guides/higgsfield-api
- https://www.meltflexai.com/blog/higgsfield-mcp
- https://www.eachlabs.ai/higgsfield/higgsfield
- https://apps.make.com/higgsfield-ai-sxl99v
- https://sloptv.co/guides/higgsfield-pricing
- https://www.krea.ai/blog/higgsfield-pricing-explained-2026-unlimited-credits-and-real-monthly-costs
- https://novoads.ai/en/blog/higgsfield-pricing
- https://aifunnelinsider.com/higgsfield-ai-review-2026/
- https://aiimagetovideo.pro/blog/higgsfield-unlimited/
- https://www.gstory.ai/blog/higgsfield-ai/
- https://layer.ai/docs/models/higgsfield-soul-cinema
- https://soku.ai/integrations/higgsfield
- https://www.frankx.ai/guides/higgsfield-ai-video-guide
- https://pollo.ai/hub/higgsfield-ai-review
- https://modelslab.com/blog/api/veo-3-1-vs-kling-3-sora-2-ai-video-api-cost-2026
- https://apiframe.ai/blog/best-ai-video-generation-apis
- https://unifically.com/blogs/runway-gen-4
- https://www.teamday.ai/blog/best-ai-video-models-2026
- https://media.faxianai.com/en/compare/luma-ray3-vs-pika-2-5/
- https://www.forbes.com/sites/rashishrivastava/2026/02/11/racist-videos-and-payment-problems-the-dark-side-of-this-ai-startups-super-fast-growth/
- https://www.trustpilot.com/review/higgsfield.ai
- https://www.trustpilot.com/review/higgsfield.ai?page=4
- https://www.bbb.org/us/ca/san-francisco/profile/artificial-intelligence/higgsfield-ai-1116-977987/complaints
- https://higgsfieldsucks.com/
- https://en.wikipedia.org/wiki/Higgsfield_AI
