# HTTP API plan

Add an `http` adapter so a caller that does not run on Victor's Mac can use a tool. The first such caller is a deployed product or a cloud agent that needs `youtube`.
Build it when that caller exists. Until then, every caller on the Mac uses the CLI with `--json`, the skill, or MCP.

## Who calls the tools today

Every adapter in v1 runs on the Mac that runs the command. Nothing listens on the network.

| Caller | Adapter | Works today |
|---|---|---|
| Claude Code in any project | Skill, after `factory link <name> --global` | Yes |
| An agent that runs on the Mac | MCP through `factory mcp <names>`, or the CLI | Yes |
| A product that runs on the Mac | The CLI, reading `--json` output | Yes |
| A deployed product or a cloud agent | HTTP | No. This plan adds it |

A local product calls the CLI, not atom or tool code. The CLI works from any language, and the manifest and `contracts/` fix its inputs and outputs, so a change inside an atom does not break the caller. Importing the Python code would tie the caller to Python, to the atom's dependency versions, and to the repo path.

## Shape of the adapter

The adapter is a copy of the MCP adapter's call path with HTTP in front. `factory/lib/mcp.mjs` validates the arguments against the verb's input schema, then runs the CLI through `invoke` (`mcp.mjs:14-19`). The HTTP adapter does the same two steps. It adds no tool code and no second copy of a schema.

- `factory/lib/http.mjs` serves the tools. `factory http <names...> [--port 4200]` starts it.
- `contracts/service.schema.json` already allows `http` in `adapters`. A tool opts in by listing it. `factory http` refuses a tool that does not, the way `factory mcp` refuses one without `mcp` (`factory.mjs:193`).
- `GET /` lists each tool and verb with its input schema and its output contract, read from the manifests.
- `POST /<tool>/<verb>` takes the verb's input as a JSON body and returns the CLI's `--json` output.
- `invoke` runs each call with `TOOL_FACTORY_CALLER=http`, so the run log and the dashboard tell HTTP calls apart.

The CLI's error codes map to HTTP status codes.

| Code | Status |
|---|---|
| `invalid_args` | 400 |
| `invalid_source` | 400 |
| `no_results` | 404 |
| `unavailable` | 422 |
| `budget_exceeded` | 429 |
| `network_error` | 502 |
| `internal` | 500 |

The response body is the CLI's `{"error": {"code", "message"}}` as printed.

## Guards

- **Auth.** Every request needs `Authorization: Bearer <token>`. The token lives in `$TOOL_FACTORY_HOME/http-token`, outside the repo, and the manifest's `needs.secrets` declares it. A request without the token gets 401 before any tool runs.
- **`act` atoms.** The adapter refuses them, as MCP does. No one at the Mac sees the request, so no one can confirm it.
- **Budget.** HTTP calls share the $3 daily cap and the $0.25 per-call ceiling in `factory_kit.model`. A caller that hits the cap gets 429. A per-caller budget waits until a second remote caller exists.
- **Timeouts.** A request waits for the CLI to exit. `transcribe` takes about 30 seconds for a ten-minute video, per `tools/youtube/SKILL.md`. The adapter ends a call after 10 minutes and returns 504. Async jobs wait until a real call runs longer than that.

## Where it runs

Victor decides this before the build. It is the one choice that changes the work.

- **On the Mac, behind Tailscale.** No new machine. The whisper weights, `uv`, `yt-dlp`, and node 22 are already installed. The Mac must be awake, and the caller must join the tailnet. A deployed product on Vercel cannot join without extra setup.
- **On the Mac, behind a Cloudflare Tunnel.** A public HTTPS URL that any host can reach. The bearer token is then the only guard.
- **On a cloud host.** Always up. It needs the whisper weights, about 574 MB for the default model, and CPU for `transcribe`. That host is a new cost and a second place to deploy, and v1 has no deploy step.

The recommended start is the Mac behind a Cloudflare Tunnel, since the first caller is likely a deployed product. Move to a cloud host only if the Mac being asleep breaks that product.

## Build checklist

- [ ] Victor names the first remote caller and picks where the adapter runs.
- [ ] Add `factory/lib/http.mjs`, `factory http`, and `http` to the `adapters` of the tools it serves.
- [ ] Unit tests in `factory/test/http.test.mjs`, calling the server the way a consumer does.
  - [ ] A request without the token gets 401, and no run is logged.
  - [ ] A body that fails the verb's input schema gets 400.
  - [ ] Each CLI error code maps to its status code in the table above.
  - [ ] A tool without `http` in `adapters` is refused at start.
  - [ ] The server binds only the address it is given, 127.0.0.1 by default.
- [ ] Live check. From another machine, `curl` `POST /youtube/transcript` on a real video through the chosen tunnel, and save the capture.
- [ ] Perf check. Compare the HTTP call's wall time with the same `youtube transcript --json` run directly, and explain any gap above about 100 ms.
- [ ] Update `ARCHITECTURE.md` and the dashboard so they show the `http` adapter.

## Out of scope

- Users, accounts, and per-caller budgets.
- Async jobs and webhooks.
- Hosting or deploy automation.
