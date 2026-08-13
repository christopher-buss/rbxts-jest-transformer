# rbxts-transformer-jest

[![npm version](https://img.shields.io/npm/v/rbxts-transformer-jest)](https://www.npmjs.com/package/rbxts-transformer-jest)
[![CI](https://github.com/christopher-buss/rbxts-jest-transformer/actions/workflows/ci.yaml/badge.svg)](https://github.com/christopher-buss/rbxts-jest-transformer/actions/workflows/ci.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/christopher-buss/rbxts-jest-transformer/blob/main/LICENSE)

TypeScript custom transformer for roblox-ts that hoists `jest.mock()` and
`jest.unmock()` calls above imports at compile time.

## The Problem

Jest requires `jest.mock()` calls to execute **before** the modules they target
are imported. You could manually place mocks above imports, but that's tedious
and easy to forget. Without Babel in the roblox-ts pipeline, there's no built-in
way to automate it.

This transformer reorders statements at the AST level so mocks run before
imports.

## Prerequisites

Requires [`@rbxts/jest`](https://github.com/jsdotlua/jest-lua) and
`@rbxts/jest-globals`.

## Install

```sh
pnpm i -D rbxts-transformer-jest
```

## Setup

Add to your `tsconfig.json`:

```jsonc
{
	"compilerOptions": {
		"plugins": [
			{
				"transform": "rbxts-transformer-jest",
			},
		],
	},
}
```

## Before / After

**Input:**

```ts
import { jest } from "@rbxts/jest-globals";

import { MyService } from "./my-service";

const mockHandler = jest.fn();
jest.mock("./my-service", () => ({ handler: mockHandler }));
```

**Output (reordered at compile time):**

```ts
import { jest } from "@rbxts/jest-globals";

const mockHandler = jest.fn();
jest.mock("./my-service", () => ({ handler: mockHandler }));

import { MyService } from "./my-service";
```

The `@rbxts/jest-globals` import always stays first. Mock-prefix variables
referenced in factories get hoisted alongside the mock call.

## String Require Support

The transformer can resolve package specifiers like `"@rbxts/services"` into
Roblox instance paths at compile time, so you can write:

```ts
jest.mock<typeof import("@rbxts/services")>("@rbxts/services", () => {
	return { Workspace: {} as Workspace };
});
```

This compiles to the equivalent of:

```lua
jest.mock(game:GetService("ReplicatedStorage"):FindFirstChild("rbxts_include"):FindFirstChild("node_modules"):FindFirstChild("@rbxts"):FindFirstChild("services"), function() ... end)
```

> **Note:** This string-specifier support applies to every method whose first
> argument the transformer resolves: `jest.mock()`, `jest.unmock()`,
> `jest.doMock()`, `jest.dontMock()`, and `jest.requireActual()`. If your
> `@rbxts/jest` types only accept `ModuleScript` for any of these (they don't
> account for string specifiers being rewritten at compile time), you must
> augment `@rbxts/jest-globals` with a `string` overload for that method — e.g.
> `declare module "@rbxts/jest-globals" { namespace jest { function doMock<T = unknown>(moduleScript: string, factory?: () => T): typeof jest; } }`
> — or `pnpm typecheck` will reject the string argument.

### The specifier must be known at compile time

A specifier is rewritten to an instance path while compiling, so its value has
to be statically known. A string literal works, and so does a `const` bound to
one:

```ts
const MODULE_PATH = "./my-service";
jest.mock(MODULE_PATH); // → jest.mock(script.Parent["my-service"])
```

A specifier that only has a value at runtime cannot be rewritten, and the
transformer reports a compile error instead of letting a raw string reach jest:

```ts
const RESET_MODULE_EXCEPTIONS = ["@rbxts/react"];
for (const moduleName of RESET_MODULE_EXCEPTIONS) {
	// [rbxts-jest-transformer] setup.ts:4 — `jest.doMock()` requires a module
	// specifier that can be resolved at compile time.
	jest.doMock(moduleName, () => jest.requireActual(moduleName));
}
```

Write the calls out with literal specifiers, or pass a `ModuleScript` — an
argument that is not a string is left untouched.

## Per-test Mocking (`doMock` / `dontMock`)

`jest.mock()` / `jest.unmock()` are hoisted to file scope, so they apply to the
whole test file. For **per-test** or **per-describe** mocking, use the
imperative `jest.doMock()` / `jest.dontMock()`. These are **not** hoisted (they
run where you write them) and their factories are **not** validated, so the
factory may reference imported helpers:

```ts
import { beforeEach, describe, expect, it, jest } from "@rbxts/jest-globals";

import { createServicesMock } from "./test/mock-services";

describe("server", () => {
	beforeEach(() => {
		jest.resetModules();
		jest.doMock("@rbxts/services", () => {
			return createServicesMock({ RunService: { IsServer: () => true } });
		});
	});

	it("sees IsServer() === true via dynamic import", async () => {
		const { RunService } = await import("@rbxts/services");
		expect(RunService.IsServer()).toBe(true);
	});
});
```

The transformer resolves the module-string first argument of `doMock`,
`dontMock`, and `requireActual` to a Roblox instance path, exactly as it does
for hoisted `mock` / `unmock`. Chained `doMock` / `dontMock` calls are
supported. (As with `mock` / `unmock`, the `string` overload must exist in your
`@rbxts/jest` types — see the note above.)

## License

[MIT](https://github.com/christopher-buss/rbxts-jest-transformer/blob/main/LICENSE)
