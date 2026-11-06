# Contributing

This repo follows what one person needs, so a large change may not fit. Open an issue before you start one. Bug fixes and small improvements can go straight to a pull request.

## Run the tests

The tests also need `jq`.

1. To check the repo's structure rules, which takes under a second, run this command:

   ```bash
   node factory/bin/factory.mjs test --rules
   ```

2. To test one tool, name it:

   ```bash
   node factory/bin/factory.mjs test transcribe
   ```

3. To run everything, omit the names:

   ```bash
   node factory/bin/factory.mjs test
   ```

A full run from a fresh clone took 11 minutes on an Apple Silicon Mac, and the `site-clone` test took most of that. Some tests make real model calls through Claude Code, so a full run costs a small amount of money. To cap the spend, set `TOOL_FACTORY_BUDGET_USD`.

## Add an atom

1. Copy the closest existing folder in `atoms/` and pick one noun as its name. If it returns two shapes, make two atoms.
2. Set `kind` in `manifest.json` to `transform`, `model`, `observe`, or `act`. The kind decides what the tests must assert.
3. Declare every binary, secret, and paid backend in `needs`.
4. Add a JSON Schema to `contracts/` if no existing contract fits.
5. Write `test/test.sh` so that it calls the CLI the way a consumer does.
6. Run `node factory/bin/factory.mjs test <name>`.

A Python atom runs through `uv run` with inline script dependencies until it passes about 300 lines.

## Add a microservice

1. Copy a folder in `microservices/`.
2. List the atoms it calls in `uses`.
3. Call those atoms through their CLIs. A microservice never imports atom code or calls another microservice.

## Follow the boundaries

- An atom imports `kit/`, never another atom.
- Code enters `kit/` or `factory/` only when a second atom needs it.
- `factory/` is Node 24 with zero dependencies.
- Runtime data never enters the repo.
- `manifest.json` is the only place a verb's schema is written.

[ARCHITECTURE.md](ARCHITECTURE.md) explains these rules, and `factory test` enforces most of them.

## Write commits this way

Commit messages use the form `feat(scope): add the thing`, as in `git log`. Write them in plain, short sentences. A pull request says why the change exists before it says what changed.
