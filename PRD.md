# PRD: rbxts-jest-transformer

**Author:** Christopher Buss **Date:** 2026-02-12 **Status:** Draft **Taskmaster
Optimized:** Yes

---

## Problem & Solution

### Problem

roblox-ts projects using `@rbxts/jest` cannot use `jest.mock()` because
roblox-ts compiles imports before mock registration runs. Jest requires mock
calls to execute before the modules they target are imported — but TypeScript
(and by extension roblox-ts) hoists `import` statements to the top of the file
per spec.

### Proposed Solution

A TypeScript custom transformer that reorders AST statements to hoist
`jest.mock()` (and related calls) above imports at compile time, while keeping
the `@rbxts/jest-globals` import first. Uses `ts.Program`/`TypeChecker` for
factory validation (resolving globals from `.d.ts` files).

### Success Metric

All hoistable jest methods correctly reordered in roblox-ts compilation
pipeline, validated by unit tests with 100% coverage and integration tests
through the full roblox-ts VirtualProject pipeline (TS → Lua).

---

## Requirements

### Must Have

1. **[REQ-001]** ✅: Hoist jest `mock` and `unmock` above imports
    - Methods: `mock`, `unmock`
    - `deepUnmock`, `enableAutomock`, `disableAutomock` not implemented in
      `@rbxts/jest` — omitted
    - Acceptance: `jest.mock("./foo")` placed after imports → appears before
      imports in output

2. **[REQ-002]** ✅: Keep `@rbxts/jest-globals` import as first statement
    - roblox-ts-specific: `@rbxts/jest-globals` must execute before hoisted
      calls so `jest`/`expect` are available
    - Acceptance: Output order is always `@rbxts/jest-globals` import → hoisted
      calls → other imports → rest

3. **[REQ-003]** ✅: Detect jest calls via import tracking
    - Support named (`import { jest }`), aliased (`import { jest as j }`), and
      namespace (`import * as JG`) imports from `@rbxts/jest-globals`
    - roblox-ts has no global jest — only tracked import bindings are recognized
    - Acceptance: All 3 import styles correctly detected

4. **[REQ-004]** ✅: Ignore non-jest objects and shadowed bindings
    - `other.mock("./foo")` must not hoist
    - `const jest = {...}; jest.mock()` must not hoist
    - Requires scope stack to detect shadowing (no Babel scope API available)
    - Acceptance: Non-jest and shadowed calls remain in original position

5. **[REQ-005]** ✅: Validate factory function purity
    - `jest.mock("./foo", () => ...)` factory must only reference allowed
      identifiers, `mock`-prefixed vars, or `jest`/`expect`
    - Invalid factories throw a compile error (match Babel behavior)
    - Acceptance: Invalid factory refs throw, valid ones hoist

6. **[REQ-006]** ✅: Hoist mock-prefixed variables
    - Variables matching `/^mock/i` referenced in factories hoist alongside the
      `jest.mock` call
    - Only `const` declarations hoist (not `let`/`var`)
    - Acceptance: `const mockFoo = jest.fn(); jest.mock("./foo", () => mockFoo)`
      → both hoist above imports

7. **[REQ-007]** ✅: Block scope hoisting — hoist within function/block bodies,
   not just top-level (matches Babel behavior which hoists in every
   BlockStatement)

8. **[REQ-008]** ✅: Chained call support — `jest.unmock('./a').unmock('./b')`
   treated as single hoistable statement (recursive jest object extraction)
    - Factory validation and mock-prefix var hoisting also work through chains

### Should Have

9. **[REQ-009]** ✅: Pure constant hoisting —
   `const X = 42; jest.mock('./foo', () => X)` hoists `X` too
10. **[REQ-010]** ✅: Type-checker-based global resolution — use
    `ts.Program`/`TypeChecker.resolveName()` to allow any identifier declared in
    `.d.ts` files (Roblox globals like `Vector3`, `CFrame`, `game`, polyfill
    globals, etc.) in mock factories. Eliminates hardcoded allowlists. Base set
    (`jest`, `expect`, `undefined`, `NaN`, `Infinity`) kept as fallback for
    import bindings not resolvable as globals.

### Nice to Have

11. **[REQ-011]**: Polyfill-aware allowlist — allow roblox-ts polyfill globals
    (`Array`, `Map`, `Set`, `Object`, etc.) in factories since their imports
    wouldn't be mocked and would remain above hoisted calls
12. **[REQ-012]**: Configurable jest module specifier — allow overriding the
    `@rbxts/jest-globals` module name via plugin config for non-standard setups
13. **[REQ-013]** ✅: Imperative module-specifier resolution — resolve the
    first-argument module string of `doMock`, `dontMock`, and `requireActual` to
    an Instance path (same resolution as hoisted `mock`/`unmock`), without
    hoisting or factory-validating them. Enables per-test/per-describe module
    mocking via `jest.doMock(...)` (factories may reference imported helpers
    since they are never validated). Chained `doMock`/`dontMock` supported.
14. **[REQ-014]** ✅: Static module-specifier check — a specifier that is not a
    string literal is typed with the `TypeChecker`. A string literal type (a
    `const` bound to a literal, for example) resolves like a literal; a
    specifier that is a string only at runtime (loop variable, `let` binding,
    array element) throws a compile error naming the call, the file, and the
    line. A non-string specifier (a `ModuleScript`) is left untouched.

---

## Technical Notes

**Architecture:** Single
`(program: ts.Program) => ts.TransformerFactory<ts.SourceFile>` export.
Two-phase approach:

1. **Scan** — walk top-level statements to track `@rbxts/jest-globals` imports
   and collect jest identifier names
2. **Reorder** — partition statements into buckets and reassemble in correct
   order

**Transform pipeline:**

```text
SourceFile statements
  → partition into: jestImport | hoistedVars | hoistedCalls | other
  → reassemble: [jestImport, ...hoistedVars, ...hoistedCalls, ...other]
```

**Statement classification:**

```typescript
// Hoistable if:
// 1. ExpressionStatement with CallExpression
// 2. Callee is PropertyAccessExpression on tracked jest identifier
// 3. Property name is `mock` or `unmock`
// 4. If factory arg exists, passes purity validation
```

**Factory validation (type-checker + base allowlist):**

```typescript
// Base set — import bindings that are always safe (not globals)
const ALLOWED_IDENTIFIERS = new Set([
	"expect",
	"Infinity",
	"jest",
	"NaN",
	"undefined",
]);
// + TypeChecker.resolveName() for any .d.ts-declared global
// + /^mock/i test for variable names
// + /^(?:__)?cov/ for istanbul coverage vars
```

The transformer accepts `ts.Program` and uses `checker.resolveName()` to resolve
identifiers. Any name whose declarations are all in `.d.ts` files is permitted
(covers Roblox globals like `Vector3`, `CFrame`, `game`, `task`, `print`, and
polyfill globals like `Array`, `Map`, `Set`). `ALLOWED_IDENTIFIERS` is kept as a
fallback for names like `jest`/`expect` that are import bindings, not globals.

**Scope stack for shadowing detection:**

Without Babel's scope/binding API, we implement a lightweight scope stack:

- Push scope on entering Block/Function/SourceFile
- Track variable declarations (`const`, `let`, `var`, function params, catch
  bindings)
- Check if `jest` identifier has a binding in any enclosing scope
- If bound → shadowed → don't hoist

**Error format:**

Invalid factory references throw an `Error` with location and guidance:

```text
[rbxts-jest-transformer] <file>:<line> — The module factory of `jest.mock()`
is not allowed to reference any out-of-scope variables.
Invalid variable access: <name>
Note: This is a precaution to guard against uninitialized mock variables.
If it is ensured that the mock is required lazily, variable names prefixed
with `mock` (case insensitive) are permitted.
Global identifiers and variables initialized with pure constant expressions
(literals, arrays, objects, arrow functions) are also permitted.
```

**Dependencies:**

- `typescript` (peer — AST APIs, `TypeChecker.resolveName()`)
- Requires `ts.Program` from roblox-ts pipeline (non-optional parameter)
- No roblox-ts dependency for the transformer itself

---

## Implementation

**Phase 1 — Core hoisting:**

- Implement jest import tracking (`@rbxts/jest-globals` detection, all 3 import
  styles)
- Implement hoistable call detection (`mock`, `unmock`)
- Implement top-level statement reordering
- Implement shadowed binding detection (scope stack)
- Update snapshot tests

**Phase 2 — Validation & variables:** ✅

- Port factory purity validation from babel (minimal allowlist)
- Implement mock-prefixed variable hoisting (`/^mock/i`, `const` only)
- Throw on invalid factory references
- Chained call support (recursive jest object extraction)

**Phase 3 — Block scope & edge cases:** ✅

- ~~Add block scope hoisting (REQ-007)~~ ✅
- ~~Pure constant hoisting (REQ-009)~~ ✅
- ~~Polyfill-aware allowlist expansion (REQ-010)~~ ✅ — superseded by
  type-checker-based global resolution

---

## Out of Scope

- Babel AST / babel plugin compatibility
- `_getJestObj()` getter pattern (roblox-ts has no dynamic require)
- ~~Integration test tier (Tier 2 with patched roblox-ts VirtualProject)~~ —
  implemented via `test/compile.ts` + `test/hoist.spec.ts`
- ~~`jest.requireActual` / `jest.requireMock` support~~ — `jest.requireActual`
  string path transformation implemented (see REQ-013, alongside `doMock` /
  `dontMock`); `jest.requireMock` remains out of scope
- JSX/TSX-specific handling

---

## Resolved Questions

1. **Invalid factories** → throw compile error (match Babel)
2. **Scope detection** → lightweight scope stack (track bindings per
   block/function)
3. **Block hoisting** → promoted to must-have (REQ-007), matches Babel behavior
4. **Allowlist** → minimal base set (`jest`, `expect`, `undefined`, `NaN`,
   `Infinity`) + `TypeChecker.resolveName()` for `.d.ts`-declared globals

## Open Questions

1. Do we need `jest.createMockFromModule` in the hoistable set?
2. Should we support `require()` calls inside factories given roblox-ts
   limitations?

---

**Task Breakdown for Taskmaster:**

1. Jest import tracking (named, aliased, namespace) — Depends on: none
2. Hoistable call detection (`mock`, `unmock`) — Depends on: Task 1
3. Top-level statement reordering — Depends on: Task 2
4. Shadowed binding detection (scope stack) — Depends on: Task 1
5. Factory purity validation (minimal allowlist, throw on invalid) — Depends on:
   Task 2
6. Mock-prefixed variable hoisting — Depends on: Task 5
7. Block scope hoisting — Depends on: Task 3
8. Chained call support — Depends on: Task 2
9. Update tests + snapshots — Depends on: Tasks 3, 4, 5, 6, 7
10. Pure constant hoisting — Depends on: Task 5
11. Polyfill-aware allowlist — Depends on: Task 5
12. Configurable jest module specifier — Depends on: none

**Critical Path:** Task 1 → Task 2 → Task 3 → Task 7
