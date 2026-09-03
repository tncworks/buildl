# Step 0 — Workspace and vendored ec-core

Date: 2026-09-04

## What was done

- Created npm workspace root `build/package.json` with workspaces `packages/*`, `services/*`, `apps/*`.
- Copied `tsconfig.base.json` from the Bot Kit unchanged (strict, ES2022, Bundler resolution, `noUncheckedIndexedAccess`).
- Added `.env.example` (no secrets) and `.gitignore`.
- Vendored `dreamdex-bot-kit/packages/ec-core` into `packages/ec-core`: `src/`, `tests/`, `tsconfig.json`, `vitest.config.ts`, `LICENSE`. Only `package.json` differs (name `@calibrate/ec-core`, SDK pinned to exactly `0.28.1`). See `packages/ec-core/VENDORED.md`.
- Root dev dependencies: `typescript 5.9.3`, `tsx 4.23.13`, `vitest 2.1.9`, `@types/node 22.20.1`.

## Verification

```
$ npm install
# clean; only warning was npm's allow-scripts gate for esbuild's postinstall
$ npm approve-scripts --allow-scripts-pending && npm rebuild esbuild
rebuilt dependencies successfully
$ npx tsx -e "console.log('tsx ok')"
tsx ok
$ npm run typecheck -w @calibrate/ec-core
> tsc -p tsconfig.json --noEmit          # exit 0, no output
$ npm test -w @calibrate/ec-core
 ✓ tests/markets.test.ts (4 tests) 3ms
 Test Files  1 passed (1)   Tests  4 passed (4)
$ node -e "const {DatabaseSync}=require('node:sqlite'); ..."
node:sqlite OK { c: 1 }
```

Resolved dependency tree (`npm ls --depth=0`): `@somnia-chain/markets-sdk@0.28.1`, `viem@2.56.3`, `dotenv@16.6.1`.

## Notes

- Node's built-in `node:sqlite` (`DatabaseSync`) works on Node 24.19, so no native SQLite dependency is needed.
- esbuild's postinstall is blocked by npm's allow-scripts feature on this machine; it must be approved once or `tsx`/`vitest` cannot run. Recorded here so a fresh clone does not stall on it.
