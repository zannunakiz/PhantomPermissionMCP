# Repository Baseline — PhantomPermissionMCP (Step 01)

> Generated during Step 01 of `Prompt.md`. Inspection-only step except the
> explicitly requested code cleanup listed below. Recorded 2026-10-10 (UTC).

## 1. Toolchain

| Item | Value |
| --- | --- |
| Package manager | npm 11.19.1 (lockfile `package-lock.json` present) |
| Runtime | Node.js v25.9.0 |
| NestJS | `@nestjs/common` / `@nestjs/core` / `@nestjs/platform-express` 11.2.7, `@nestjs/cli` 11.0.24, `@nestjs/schematics` 11.1.0 |
| TypeScript | 5.9.3 (`tsconfig.json` / `tsconfig.build.json`) |
| Jest | 30.5.2 (unit via `rootDir: src`, e2e via `test/jest-e2e.json`) |
| ESLint | 9.39.5 (flat config `eslint.config.mjs`, `typescript-eslint` type-checked ruleset + prettier) |
| Prettier | 3.9.10 (`.prettierrc`: singleQuote, trailingComma all) |
| ORM / Database | none |
| Docker | none (no `Dockerfile`, no compose files) |
| CI | none (no `.github/workflows`, no CircleCI) |
| Environment files | none (no `.env*`, no `.env.example`) |

## 2. Repository structure (tracked files + docs added in this step)

```text
.
├── docs/engineering/repository-baseline.md   # added by Step 01
├── src/
│   ├── main.ts                               # bootstrap, port from PORT ?? 3000
│   ├── app.module.ts                         # AppController + AppService wiring
│   ├── app.controller.ts                     # GET / -> "Hello World!"
│   ├── app.service.ts                        # getHello()
│   └── app.controller.spec.ts                # unit test for the root route
├── test/
│   ├── app.e2e-spec.ts                       # e2e: GET / returns 200 "Hello World!"
│   └── jest-e2e.json
├── eslint.config.mjs
├── nest-cli.json
├── package.json / package-lock.json
├── tsconfig.json / tsconfig.build.json
├── .prettierrc / .gitignore / LICENSE (MIT) / README.md (Nest starter boilerplate)
└── Prompt.md (intentionally git-ignored; see .gitignore "Prompt clearance")
```

Not present (relevant for later steps): modules beyond `AppModule`,
configuration/validation layer, error-formatting filter, logging/middleware,
MCP code, persistence, Swagger, Postman collections, Docker, CI workflow.

## 3. Scripts (from `package.json`)

`build` (`nest build`), `start`, `start:dev`, `start:debug`, `start:prod`
(`node dist/main`), `lint` (`eslint "{src,apps,libs,test}/**/*.ts" --fix`),
`format` (prettier `--write`), `test` (jest), `test:watch`, `test:cov`,
`test:debug`, `test:e2e` (`jest --config ./test/jest-e2e.json`).

Gaps noted for Step 03: no dedicated `typecheck` or `format:check` script,
no `lint` variant without `--fix`, no coverage thresholds, no schema/DB scripts
(none needed yet — no ORM).

## 4. Cleanup performed before the Step 01 inspection

Request: delete unused files and clean up code.

- Deleted `dist/` (stale, git-ignored build output, 13 files). It was
  regenerated later by the validation `npm run build` below.
- Ran the repo's own `npm run lint` (includes `--fix`); no source file needed
  rewriting.
- **Kept on purpose:** `src/app.controller.ts`, `src/app.service.ts`, and
  `src/app.controller.spec.ts` look like throwaway "Hello World" scaffolding,
  but they are the working baseline wired into `AppModule`, the unit test, and
  the e2e test. Removing them would break the test suite and violate the Step
  01 gate ("no existing code was replaced just for preference"). They are
  expected to be replaced by real RBAC modules in later steps.
- Pre-existing working-tree state preserved: the only tracked modification is
  `package.json` `license: UNLICENSED -> MIT` (made by the repo owner before
  this step, left untouched). `Prompt.md` stays untracked/git-ignored.

## 5. Validation results (all commands run, real outcomes)

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` | PASS — 0 errors, 1 pre-existing warning (`src/main.ts:8` `@typescript-eslint/no-floating-promises` on bare `bootstrap()`; baseline, not introduced by this step) |
| Build | `npm run build` | PASS — exit 0, `dist/` regenerated |
| Typecheck | `npx tsc -p tsconfig.build.json --noEmit` | PASS — exit 0, no diagnostics |
| Unit tests | `npm test` | PASS — 1 suite, 1 test (`AppController root should return "Hello World!"`), 1.04 s |
| E2E tests | `npm run test:e2e` | PASS — 1 suite, 1 test (`GET /` → 200 `"Hello World!"`), 1.21 s |

No failures — existing or new. Formatter (`prettier --write`) was not run
because the repo's `format` script rewrites files and there were no formatting
complaints via the lint `prettier/prettier` rule (only the await warning above).

## 6. Constraints for upcoming steps

1. Only executables/validation scope: `src/main.ts` has a bare
   `bootstrap()` call — eslint `no-floating-promises` flags it; address when
   touching bootstrap, not before.
2. `lint` always applies `--fix`; a non-mutating lint variant should be added
   in Step 03 for CI safety.
3. Typecheck currently has no npm script — add one in Step 03.
4. README is still the default Nest starter text; full rewrite is scheduled
   work (Step 62), so it was intentionally left alone here.
5. No ORM/DB, Docker, CI, env files, or MCP/REST domain code exist yet;
   architecture decisions belong to Step 02.
