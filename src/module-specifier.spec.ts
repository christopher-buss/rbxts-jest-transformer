import ts from "typescript";
import { describe, expect, it } from "vitest";

import { resolveModuleSpecifier } from "./module-specifier.js";
import { getMockChecker, transformCode } from "./test-helpers/transform.js";

function makeContext(sourceFile: ts.SourceFile): {
	checker: ts.TypeChecker;
	sourceFile: ts.SourceFile;
} {
	return { checker: getMockChecker(), sourceFile };
}

describe("runtime module specifiers", () => {
	it("should throw when the specifier comes from a loop over module names", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
const RESET_MODULE_EXCEPTIONS = ["@rbxts/react"];
for (const moduleName of RESET_MODULE_EXCEPTIONS) {
	jest.doMock(moduleName, () => jest.requireActual(moduleName));
}
`;

		expect(() => transformCode(input)).toThrowError(
			/\[rbxts-jest-transformer] test\.ts:5 — .* requires a module specifier that can be resolved at compile time/,
		);
	});

	it("should name jest.doMock in the diagnostic", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
const RESET_MODULE_EXCEPTIONS = ["@rbxts/react"];
for (const moduleName of RESET_MODULE_EXCEPTIONS) {
	jest.doMock(moduleName, () => ({}));
}
`;

		expect(() => transformCode(input)).toThrowError(/`jest\.doMock\(\)` requires/);
	});

	it("should name the unresolvable expression in the diagnostic", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
let moduleName = "@rbxts/react";
jest.doMock(moduleName, () => ({}));
`;

		expect(() => transformCode(input)).toThrowError(/Cannot resolve: moduleName/);
	});

	it("should throw when jest.mock receives a runtime string", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
declare const path: string;
jest.mock(path);
`;

		expect(() => transformCode(input)).toThrowError(
			/`jest\.mock\(\)` requires a module specifier/,
		);
	});

	it("should throw when jest.requireActual receives a runtime string", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
declare const path: string;
const actual = jest.requireActual(path);
`;

		expect(() => transformCode(input)).toThrowError(/`jest\.requireActual\(\)` requires/);
	});

	it("should throw when the specifier is a union of string literals", () => {
		expect.assertions(1);

		const source = ts.createSourceFile(
			"test.ts",
			"jest.doMock(name);",
			ts.ScriptTarget.ESNext,
			true,
		);
		const call = (source.statements[0] as ts.ExpressionStatement).expression;
		const checker = {
			getTypeAtLocation: () => {
				return {
					isStringLiteral: () => false,
					isUnion: () => true,
					types: [
						{ flags: ts.TypeFlags.StringLiteral, isUnion: () => false },
						{ flags: ts.TypeFlags.StringLiteral, isUnion: () => false },
					],
				} as unknown as ts.Type;
			},
		} as unknown as ts.TypeChecker;

		expect(() =>
			resolveModuleSpecifier(call as ts.CallExpression, { checker, sourceFile: source }),
		).toThrowError(/`jest\.doMock\(\)` requires/);
	});

	it("should fall back to jest.mock() in the diagnostic for a bare callee", () => {
		expect.assertions(1);

		const source = ts.createSourceFile("test.ts", "mock(name);", ts.ScriptTarget.ESNext, true);
		const call = (source.statements[0] as ts.ExpressionStatement).expression;
		const checker = {
			getTypeAtLocation: () => {
				return {
					flags: ts.TypeFlags.String,
					isStringLiteral: () => false,
					isUnion: () => false,
				} as unknown as ts.Type;
			},
		} as unknown as ts.TypeChecker;

		expect(() =>
			resolveModuleSpecifier(call as ts.CallExpression, { checker, sourceFile: source }),
		).toThrowError(/`jest\.mock\(\)` requires/);
	});

	it("should not consult the checker for a synthesized argument", () => {
		expect.assertions(1);

		const source = ts.createSourceFile("test.ts", "", ts.ScriptTarget.ESNext, true);
		const call = ts.factory.createCallExpression(
			ts.factory.createPropertyAccessExpression(
				ts.factory.createIdentifier("jest"),
				"doMock",
			),
			undefined,
			[ts.factory.createIdentifier("moduleName")],
		);
		const checker = {
			getTypeAtLocation: () => {
				throw new Error("checker should not be consulted");
			},
		} as unknown as ts.TypeChecker;

		expect(resolveModuleSpecifier(call, { checker, sourceFile: source })).toBeUndefined();
	});

	it("should return undefined for a call with no arguments", () => {
		expect.assertions(1);

		const source = ts.createSourceFile(
			"test.ts",
			"jest.doMock();",
			ts.ScriptTarget.ESNext,
			true,
		);
		const call = (source.statements[0] as ts.ExpressionStatement).expression;

		expect(
			resolveModuleSpecifier(call as ts.CallExpression, makeContext(source)),
		).toBeUndefined();
	});
});

describe("statically resolvable module specifiers", () => {
	it("should resolve a const bound to a relative string literal", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
const MODULE_PATH = "./foo";
jest.mock(MODULE_PATH);
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.mock\(script\.Parent\.foo\)/);
	});

	it("should resolve a const bound to a relative string literal in jest.doMock", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
const MODULE_PATH = "./foo";
jest.doMock(MODULE_PATH, () => ({}));
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.doMock\(script\.Parent\.foo,/);
	});

	it("should leave a non-string argument unchanged", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
import { SomeService } from "@rbxts/services";
jest.doMock(SomeService.path, () => ({}));
`;

		const result = transformCode(input);

		expect(result).toMatch(/jest\.doMock\(SomeService\.path/);
	});
});
