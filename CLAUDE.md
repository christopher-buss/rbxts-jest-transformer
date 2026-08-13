# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What This Is

TypeScript custom transformer for roblox-ts that hoists `jest.mock()` and
`jest.unmock()` calls above import statements at compile time. Needed because
roblox-ts compiles imports before mock registration runs, and there's no Babel
in the roblox-ts pipeline. The transformer reorders AST statements and uses
`ts.Program`/`TypeChecker` for factory validation (resolving globals).

## Commands

```sh
pnpm test              # unit tests (src/**/*.spec.ts)
pnpm test:watch        # unit tests in watch mode
pnpm test:coverage     # unit tests with 100% coverage thresholds
pnpm test:integration  # integration tests (test/**/*.spec.ts)
pnpm test:all          # both tiers
pnpm build             # build with tsdown → dist/index.mjs
pnpm lint              # eslint with cache
pnpm typecheck         # tsgo --noEmit (native TS compiler)
```

Run a single test by name: `pnpm test -- -t "should hoist jest.mock"`

## Architecture

**`src/index.ts`** — Single export: `transformer(program: ts.Program)` returning
`ts.TransformerFactory<ts.SourceFile>`. Two-phase approach:

1. Scan top-level statements to find `@rbxts/jest-globals` imports and track
   jest identifier names
2. Partition statements into buckets and reassemble:
   `[jestGlobalsImport, ...hoistedCalls, ...everything else]`

**`src/test-helpers/transform.ts`** — `transformCode(input)` helper that runs
`ts.createSourceFile` → `ts.transform` → `ts.createPrinter` with a mock
`ts.Program` (stubbed `TypeChecker.resolveName` and `getTypeAtLocation`). No
roblox-ts dependency — tests are pure TypeScript AST.

**`src/*.spec.ts`** — Snapshot-based unit tests. Update snapshots with
`pnpm test -- -u`.

**`test/module-specifier.spec.ts`** — Runs the transformer over a real
`ts.Program`, for behaviour that depends on the type checker (the mock checker
cannot prove it).

**`test/compile.ts`** — The patched `VirtualProject` prints the transformed
source and typechecks it again, which real roblox-ts does not do. Output that
does not typecheck on its own (`script.Parent.foo`, for example) fails there, so
assert resolved instance paths in `test/module-specifier.spec.ts` instead.

## Key Constraints

- `@rbxts/jest-globals` import must always remain as the first statement
  (roblox-ts-specific)
- Only `mock` and `unmock` are hoistable — `deepUnmock`, `enableAutomock`,
  `disableAutomock` are not implemented in `@rbxts/jest`
- Transformer requires `ts.Program` (roblox-ts always provides it)
- ESM-only, Node 24+, erasable syntax only
- 100% test coverage enforced (branches, functions, lines, statements)

## Pre-commit Hooks

`lint-staged` runs eslint --fix and `tsgo --noEmit` on staged files.

## Reference Implementations

- `reference/babel-plugin-jest-hoist/` — Babel's original jest hoist plugin
  (factory validation, mock-prefix variable hoisting)
- `reference/ts-jest-main/src/transformers/hoist-jest.ts` — ts-jest's TypeScript
  AST approach (closest to our implementation pattern)

## Requirements

See `PRD.md` for full spec. Key REQs: REQ-001 (basic hoisting), REQ-002
(jest-globals first), REQ-003 (import tracking), REQ-004 (shadowing), REQ-005
(factory validation), REQ-006 (mock-prefix vars), REQ-007 (block scope), REQ-008
(chained calls), REQ-009 (pure constant hoisting), REQ-010 (type-checker global
resolution), REQ-014 (static module-specifier check).

## Core Philosophy

**TEST-DRIVEN DEVELOPMENT IS NON-NEGOTIABLE.** Every single line of production
code must be written in response to a failing test. No exceptions. This is not a
suggestion or a preference - it is the fundamental practice that enables all
other principles in this document.

I follow Test-Driven Development (TDD) with a strong emphasis on behavior-driven
testing and functional programming principles. All work should be done in small,
incremental changes that maintain a working state throughout development.

## Quick Reference

- Write tests first (TDD)
- Test behavior, not implementation
- No `any` types or type assertions
- Immutable data only
- Small, pure functions
- TypeScript strict mode always
- Use real schemas/types in tests, never redefine them

## Development Workflow

**Core principle**: RED-GREEN-REFACTOR in small, known-good increments. TDD is
the fundamental practice.

**Quick reference:**

- RED: Write failing test first (NO production code without failing test)
- RED: Test should fail for expected reason (not syntax error, type error, etc.)
    - Implement test doubles/mocks as needed to isolate behavior
- GREEN: Write MINIMUM code to pass test
- REFACTOR: Assess improvement opportunities (only refactor if adds value)
- Each increment leaves codebase in working state
- Capture learnings as they occur, merge at end
