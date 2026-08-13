import { describe, expect, it } from "vitest";

import { tryLoadDependencies } from "../src/resolve-package-path.js";
import { compile } from "./compile.js";

// `@rbxts/jest` types only accept `ModuleScript`, so a source that passes a
// string specifier needs the documented augmentation to typecheck.
const JEST_STRING_PATCH = `
	import "@rbxts/jest-globals";
	declare module "@rbxts/jest-globals" {
		namespace jest {
			function mock<T = unknown>(moduleScript: string, factory?: () => T): typeof jest;
			function doMock<T = unknown>(moduleScript: string, factory?: () => T): typeof jest;
			function requireActual<TModule extends {} = unknown>(moduleScript: string): TModule;
		}
	}
`;

describe(tryLoadDependencies, () => {
	it("should load rojo-resolver and path-translator when available", () => {
		expect.assertions(2);

		const result = tryLoadDependencies();

		expect(result?.RojoResolver).toBeDefined();
		expect(result?.PathTranslator).toBeDefined();
	});
});

describe("integration: hoist-jest through roblox-ts pipeline", () => {
	it("should hoist jest.mock above require in Lua output", () => {
		expect.assertions(1);

		const source = `
			import { jest } from "@rbxts/jest-globals";
			import { foo } from "./foo";
			jest.mock("./foo" as unknown as ModuleScript);
			print(foo);
		`;

		const luau = compile(source);

		expect(luau).toMatchSnapshot();
	});

	it("should keep jest-globals import as first statement", () => {
		expect.assertions(2);

		const source = `
			import { jest } from "@rbxts/jest-globals";
			import { foo } from "./foo";
			jest.mock("./foo" as unknown as ModuleScript);
			print(foo);
		`;

		const luau = compile(source);
		const importLines = luau.split("\n").filter((line) => line.includes("TS.import"));

		expect(importLines).not.toHaveLength(0);
		expect(importLines[0]).toContain("jest-globals");
	});

	it("should compile aliased jest import correctly", () => {
		expect.assertions(1);

		const source = `
			import { jest as j } from "@rbxts/jest-globals";
			import { foo } from "./foo";
			j.mock("./foo" as unknown as ModuleScript);
			print(foo);
		`;

		const luau = compile(source);

		expect(luau).toMatchSnapshot();
	});

	it("should compile namespace import correctly", () => {
		expect.assertions(1);

		const source = `
			import * as JG from "@rbxts/jest-globals";
			import { foo } from "./foo";
			JG.jest.mock("./foo" as unknown as ModuleScript);
			print(foo);
		`;

		const luau = compile(source);

		expect(luau).toMatchSnapshot();
	});

	it("should pass through unchanged when no jest calls", () => {
		expect.assertions(1);

		const source = `
			import { foo } from "./foo";
			const _x = foo;
		`;

		const luau = compile(source);

		expect(luau).toMatchSnapshot();
	});

	it("should throw on factory referencing out-of-scope variable", () => {
		expect.assertions(1);

		const source = `
			import { jest } from "@rbxts/jest-globals";
			import { foo } from "./foo";
			jest.mock("./foo" as unknown as ModuleScript, () => foo);
		`;

		expect(() => compile(source)).toThrowError(/rbxts-jest-transformer/);
	});

	it("should allow Roblox globals in mock factory", () => {
		expect.assertions(1);

		const source = `
			import { jest } from "@rbxts/jest-globals";
			import { foo } from "./foo";
			jest.mock("./foo" as unknown as ModuleScript, () => ({
				pos: new Vector3(1, 2, 3),
				cf: new CFrame(),
			}));
			print(foo);
		`;

		expect(() => compile(source)).not.toThrowError();
	});

	it("should allow game global in mock factory", () => {
		expect.assertions(1);

		const source = `
			import { jest } from "@rbxts/jest-globals";
			import { foo } from "./foo";
			jest.mock("./foo" as unknown as ModuleScript, () => ({
				svc: game.GetService("Workspace"),
			}));
			print(foo);
		`;

		expect(() => compile(source)).not.toThrowError();
	});

	it("should transform jest.requireActual inside jest.mock factory", () => {
		expect.assertions(1);

		const source = `
			import { jest } from "@rbxts/jest-globals";
			jest.mock("@rbxts/jest", () => {
				const actual = jest.requireActual("@rbxts/jest");
				return actual;
			});
		`;

		const luau = compile(source, {
			"/src/jest-string-patch.d.ts": JEST_STRING_PATCH,
		});

		expect(luau).toMatchSnapshot();
	});

	it("should throw on a module specifier that only exists at runtime", () => {
		expect.assertions(1);

		const source = `
			import { jest } from "@rbxts/jest-globals";
			const RESET_MODULE_EXCEPTIONS = ["@rbxts/jest"];
			for (const moduleName of RESET_MODULE_EXCEPTIONS) {
				jest.doMock(moduleName, () => jest.requireActual(moduleName));
			}
		`;

		expect(() =>
			compile(source, { "/src/jest-string-patch.d.ts": JEST_STRING_PATCH }),
		).toThrowError(/requires a module specifier that can be resolved at compile time/);
	});

	it("should not throw on a ModuleScript specifier held in a variable", () => {
		expect.assertions(1);

		const source = `
			import { jest } from "@rbxts/jest-globals";
			const target = script.Parent!.FindFirstChild("foo") as ModuleScript;
			jest.doMock(target, () => ({}));
		`;

		expect(() => compile(source)).not.toThrowError();
	});

	it("should hoist React import above jest.mock when factory contains JSX", () => {
		expect.assertions(3);

		const source = `
			import { jest } from "@rbxts/jest-globals";
			import React from "@rbxts/react";
			import { foo } from "./foo";
			jest.mock("./foo" as unknown as ModuleScript, () => ({
				default: () => <textlabel />,
			}));
			print(foo);
		`;

		const luau = compile(source);
		const lines = luau.split("\n");
		const reactImportIndex = lines.findIndex((line) => line.includes("react"));
		const jestMockIndex = lines.findIndex((line) => line.includes("jest.mock"));
		const fooImportIndex = lines.findIndex(
			(line) => line.includes("foo") && line.includes("TS.import"),
		);

		expect(reactImportIndex).toBeGreaterThan(-1);
		expect(reactImportIndex).toBeLessThan(jestMockIndex);
		expect(fooImportIndex).toBeGreaterThan(jestMockIndex);
	});

	it("should preserve order of multiple mocks and un-mocks", () => {
		expect.assertions(1);

		const source = `
			import { jest } from "@rbxts/jest-globals";
			import { a } from "./a";
			import { b } from "./b";
			jest.mock("./a" as unknown as ModuleScript);
			jest.unmock("./b" as unknown as ModuleScript);
			jest.mock("./b" as unknown as ModuleScript);
			print(a, b);
		`;

		const luau = compile(source);

		expect(luau).toMatchSnapshot();
	});

	it("should keep jest.doMock imperative with a factory referencing imports", () => {
		expect.assertions(3);

		const jestStringPatch = `
			import "@rbxts/jest-globals";
			declare module "@rbxts/jest-globals" {
				namespace jest {
					function doMock<T = unknown>(moduleScript: string, factory?: () => T): typeof jest;
				}
			}
		`;

		// Factory references the imported \`foo\` binding — this only compiles
		// because doMock is neither hoisted nor validated against scope (the
		// equivalent jest.mock factory throws, see the out-of-scope test above).
		const source = `
			import { jest } from "@rbxts/jest-globals";
			import { foo } from "./foo";
			jest.doMock("@rbxts/jest", () => ({ default: foo }));
			print(foo);
		`;

		const luau = compile(source, {
			"/src/jest-string-patch.d.ts": jestStringPatch,
		});
		const lines = luau.split("\n");
		const fooImportIndex = lines.findIndex(
			(line) => line.includes("foo") && line.includes("TS.import"),
		);
		const doMockIndex = lines.findIndex((line) => line.includes("doMock"));

		expect(doMockIndex).toBeGreaterThan(-1);
		// Imperative: doMock stays after the import (NOT hoisted above it).
		expect(doMockIndex).toBeGreaterThan(fooImportIndex);
		// The factory captured the imported binding (proves it was not checked).
		expect(luau).toMatch(/default = foo/);
	});
});
