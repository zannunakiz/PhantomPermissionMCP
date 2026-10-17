# Test boundaries and coverage gates (Step 53)

- **Unit tests** (`src/**/*.spec.ts`, `npm test` / `npm run test:cov`): fast, no DB/network.
  Covers domain engine (`src/domain`) + critical services (auth, common, config,
  health, mcp, metrics, models, simulations, tenancy, tracing, repositories).
- **Integration tests** (`src/**/*.int-spec.ts`, `npm run test:integration`):
  disposable local test DB only (`*_test` name enforced), migrations applied
  first, tables truncated before/after each run (Step 54). Non-local, prod-like
  or production (`NODE_ENV=production`) configuration is refused before any
  connection is made — see `scripts/integration-test-db.js`.
- **E2E tests** (`test/**/*.e2e-spec.ts`, `npm run test:e2e`): full HTTP app,
  contract + security. Not part of unit coverage.

## Coverage (`npm run test:cov`)

- Runs `jest --coverage --coverageReporters=text,json-summary`, then
  `node scripts/check-domain-coverage.js`.
- `collectCoverageFrom` includes domain + critical app services only.
- Excluded (justified glue/generated): `*.spec.ts`, `*.int-spec.ts`,
  `*.e2e-spec.ts`, `*.dto.ts`, `*.module.ts`, `index.ts` barrels, `main.ts`
  bootstrap, `docs/**`.
- Gates (enforced — non-zero exit when missed):
  - Jest global thresholds: 70% stmts, 55% branches, 55% funcs, 68% lines
  - Domain aggregate gate (`scripts/check-domain-coverage.js`):
    90% stmts/lines, 75% branches, 78% funcs over `src/domain`
  - Jest global gates reject overall drops; the domain script rejects
    engine-only regressions that global averages would hide.
- No test is skipped to satisfy the gate (`33` suites / `177` tests passing).

- `collectCoverageFrom` includes domain + critical app services only.
- Excluded (justified glue/generated): `*.spec.ts`, `*.int-spec.ts`,
  `*.e2e-spec.ts`, `*.dto.ts`, `*.module.ts`, `index.ts` barrels, `main.ts`
  bootstrap, `docs/**`.
- Thresholds (enforced — Jest exits non-zero when missed):
  - global: 70% stmts/lines, 55% branches/functions
  - `src/domain`: 90% stmts/lines, 75% branches, 78% functions
  - `src/auth`: 60/60/50/50; `src/common`: 80/80/70/80
- No test is skipped to satisfy the gate (`33` suites / `177` tests passing).
