import ts from "typescript";
import { describe, expect, it } from "vitest";

import type { PackageResolver } from "./resolve-package-path.js";
import { getMockChecker, transformCode } from "./test-helpers/transform.js";
import type { MockArgumentContext } from "./transform-mock-args.js";
import { transformMockArguments } from "./transform-mock-args.js";

function makeContext(sourceFile: ts.SourceFile, resolver?: PackageResolver): MockArgumentContext {
	return { checker: getMockChecker(), factory: ts.factory, resolver, sourceFile };
}

describe(transformMockArguments, () => {
	it("should transform relative string in jest.mock to instance expression", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
jest.mock("./foo");
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.mock\(script\.Parent\.foo\)/);
	});

	it("should transform relative string in jest.unmock to instance expression", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
jest.unmock("./foo");
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.unmock\(script\.Parent\.foo\)/);
	});

	it("should preserve factory function when transforming first arg", () => {
		expect.assertions(2);

		const input = `
import { jest } from "@rbxts/jest-globals";
jest.mock("./foo", () => ({}));
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.mock\(script\.Parent\.foo,/);
		expect(result).toMatch(/\(\) => \(\{\}\)/);
	});

	it("should transform both args in chained calls", () => {
		expect.assertions(2);

		const input = `
import { jest } from "@rbxts/jest-globals";
jest.mock("./a").unmock("./b");
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.mock\(script\.Parent\.a\)/);
		expect(result).toMatch(/\.unmock\(script\.Parent\.b\)/);
	});

	it("should leave non-relative string unchanged", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
jest.mock("@rbxts/some-package");
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.mock\("@rbxts\/some-package"\)/);
	});

	it("should leave chained non-relative strings unchanged", () => {
		expect.assertions(2);

		const input = `
import { jest } from "@rbxts/jest-globals";
jest.mock("@rbxts/a").unmock("@rbxts/b");
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.mock\("@rbxts\/a"\)/);
		expect(result).toMatch(/\.unmock\("@rbxts\/b"\)/);
	});

	it("should leave non-string first arg unchanged", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
import { SomeService } from "@rbxts/services";
jest.mock(SomeService.path, () => ({}));
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.mock\(SomeService\.path/);
	});

	it("should leave AsExpression-wrapped strings unchanged", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
jest.mock("./foo" as unknown as ModuleScript);
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.mock\("\.\/foo" as unknown as ModuleScript\)/);
	});

	it("should transform nested path segments", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
jest.mock("./a/b/c");
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.mock\(script\.Parent\.a\.b\.c\)/);
	});

	it("should transform parent path", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
jest.mock("../foo");
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.mock\(script\.Parent\.Parent\.foo\)/);
	});

	it("should pass through non-expression statements unchanged", () => {
		expect.assertions(1);

		const source = ts.createSourceFile("test.ts", "const x = 1;", ts.ScriptTarget.ESNext, true);
		const statement = source.statements[0]!;
		const result = transformMockArguments([statement], makeContext(source));

		expect(result[0]).toBe(statement);
	});

	it("should pass through call with no arguments unchanged", () => {
		expect.assertions(1);

		const source = ts.createSourceFile("test.ts", "foo();", ts.ScriptTarget.ESNext, true);
		const statement = source.statements[0]!;
		const result = transformMockArguments([statement], makeContext(source));

		expect(result[0]).toBe(statement);
	});

	it("should resolve package specifier when resolver is provided", () => {
		expect.assertions(1);

		const resolver: PackageResolver = {
			resolveToRbxPath: () => [
				"ReplicatedStorage",
				"rbxts_include",
				"node_modules",
				"@rbxts",
				"services",
			],
		};

		const source = ts.createSourceFile(
			"test.ts",
			'jest.mock("@rbxts/services");',
			ts.ScriptTarget.ESNext,
			true,
		);
		const result = transformMockArguments(
			[...source.statements],
			makeContext(source, resolver),
		);

		// eslint-disable-next-line unicorn/no-keyword-prefix -- TS API property name
		const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
		const printed = printer.printFile(ts.factory.updateSourceFile(source, result));

		expect(printed).toMatch(
			/jest\.mock\(game\.GetService\("ReplicatedStorage"\)!\.FindFirstChild\("rbxts_include"\)!\.FindFirstChild\("node_modules"\)!\.FindFirstChild\("@rbxts"\)!\.FindFirstChild\("services"\) as ModuleScript\)/,
		);
	});

	it("should leave package specifier unchanged when no resolver provided", () => {
		expect.assertions(1);

		const source = ts.createSourceFile(
			"test.ts",
			'jest.mock("@rbxts/services");',
			ts.ScriptTarget.ESNext,
			true,
		);
		const result = transformMockArguments([...source.statements], makeContext(source));

		expect(result[0]).toBe(source.statements[0]);
	});
});

describe("jest.requireActual string path transformation", () => {
	it("should transform relative string in jest.requireActual to instance expression", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
jest.requireActual("./foo");
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.requireActual\(script\.Parent\.foo\)/);
	});

	it("should transform nested relative path in jest.requireActual", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
jest.requireActual("./a/b/c");
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.requireActual\(script\.Parent\.a\.b\.c\)/);
	});

	it("should transform parent path in jest.requireActual", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
jest.requireActual("../foo");
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.requireActual\(script\.Parent\.Parent\.foo\)/);
	});

	it("should transform jest.requireActual inside jest.mock factory", () => {
		expect.assertions(2);

		const input = `
import { jest } from "@rbxts/jest-globals";
jest.mock("./foo", () => {
    return jest.requireActual("./foo");
});
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.mock\(script\.Parent\.foo/);
		expect(result).toMatch(/jest\.requireActual\(script\.Parent\.foo\)/);
	});

	it("should transform requireActual with aliased jest import", () => {
		expect.assertions(1);

		const input = `
import { jest as j } from "@rbxts/jest-globals";
j.requireActual("./foo");
`;

		const result = transformCode(input);

		expect(result).toMatch(/j\.requireActual\(script\.Parent\.foo\)/);
	});

	it("should transform requireActual with namespace import", () => {
		expect.assertions(1);

		const input = `
import * as JG from "@rbxts/jest-globals";
JG.jest.requireActual("./foo");
`;

		const result = transformCode(input);

		expect(result).toMatch(/JG\.jest\.requireActual\(script\.Parent\.foo\)/);
	});

	it("should transform requireActual as variable initializer", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
const actual = jest.requireActual("./foo");
`;

		const result = transformCode(input);

		expect(result).toMatch(/const actual = jest\.requireActual\(script\.Parent\.foo\)/);
	});

	it("should leave non-string arg in jest.requireActual unchanged", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
import { SomeService } from "@rbxts/services";
jest.requireActual(SomeService.path);
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.requireActual\(SomeService\.path\)/);
	});

	it("should leave non-relative string in jest.requireActual unchanged when no resolver", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
jest.requireActual("@rbxts/some-package");
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.requireActual\("@rbxts\/some-package"\)/);
	});

	it("should resolve package specifier in jest.requireActual when resolver is provided", () => {
		expect.assertions(1);

		const resolver: PackageResolver = {
			resolveToRbxPath: () => [
				"ReplicatedStorage",
				"rbxts_include",
				"node_modules",
				"@rbxts",
				"services",
			],
		};

		const source = ts.createSourceFile(
			"test.ts",
			'jest.requireActual("@rbxts/services");',
			ts.ScriptTarget.ESNext,
			true,
		);
		const result = transformMockArguments(
			[...source.statements],
			makeContext(source, resolver),
		);

		// eslint-disable-next-line unicorn/no-keyword-prefix -- TS API property name
		const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
		const printed = printer.printFile(ts.factory.updateSourceFile(source, result));

		expect(printed).toMatch(
			/jest\.requireActual\(game\.GetService\("ReplicatedStorage"\)!\.FindFirstChild\("rbxts_include"\)!\.FindFirstChild\("node_modules"\)!\.FindFirstChild\("@rbxts"\)!\.FindFirstChild\("services"\) as ModuleScript\)/,
		);
	});

	it("should not transform requireActual on non-jest object", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
other.requireActual("./foo");
`;

		const result = transformCode(input);

		expect(result).toMatch(/other\.requireActual\("\.\/foo"\)/);
	});
});
