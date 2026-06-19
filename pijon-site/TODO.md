# Pijon Web — TODO

## Deferred tests (write later)

Tests were paused to conserve usage. Code below was shipped WITHOUT tests and needs an
extensive Vitest suite added later (the project's standard is ~2:1 test:code). Append to this
list as more untested code lands.

### Phase 4 — IO layer
- `src/domain/io/csv.ts`
  - SIMPLE vs FULL format auto-detection
  - SIMPLE import: first-column extraction, header-row skip list, session-salted ids
  - FULL import: two-pass build, name→StudentId resolution, fixture id determinism
  - Warning emission: invalid weight, unknown pref type, empty file (parity with Python)
  - RFC-4180 parser edge cases: BOM, `\r\n`, quoted fields, doubled-quote escapes
  - Export: full-format round-trip, one-row-per-preference, no-preference row, idToname mapping
- `src/domain/io/projectFile.ts`
  - Zod schema validation: rejects malformed/partial `.pijon`, typed `ProjectParseError`
  - `serializeProject` / `parseProject` round-trip
  - `composeClassroom`: fixtures placed from geometry, real students from arrangement, stale fid/sid skipped
  - `extractProject`: inverse round-trip (classroom+roster+locks → ProjectFile)
  - `importLegacyClassroom`: prototype `data/classrooms/*.json` geometry, unknown kind fallback
  - version/migration entry point (`applyMigrations`)
