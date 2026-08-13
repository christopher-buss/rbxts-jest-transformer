import ts from "typescript";
import { describe, expect, it } from "vitest";

import transformer from "../src/index.js";

const FILE_NAME = "/src/test.ts";

// eslint-disable-next-line unicorn/no-keyword-prefix -- TS API property name
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

/**
 * Runs the transformer over a real `ts.Program`.
 *
 * The unit tests use a stubbed checker, so these confirm that a real checker
 * hands back the literal type of a `const`, and a plain `string` for a value
 * that only exists at runtime.
 *
 * @param source - The TypeScript source to transform.
 * @returns The printed output of the transformed source file.
 */
function transformWithRealProgram(source: string): string {
	const sourceFile = ts.createSourceFile(FILE_NAME, source, ts.ScriptTarget.ESNext, true);
	const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ESNext };
	const libraryFileName = ts.getDefaultLibFilePath(options);
	const host: ts.CompilerHost = {
		fileExists: (fileName) => fileName === FILE_NAME || ts.sys.fileExists(fileName),
		getCanonicalFileName: (fileName) => fileName,
		getCurrentDirectory: () => "/",
		getDefaultLibFileName: () => libraryFileName,
		getNewLine: () => "\n",
		getSourceFile: (fileName) => {
			if (fileName === FILE_NAME) {
				return sourceFile;
			}

			const text = ts.sys.readFile(fileName);
			return text === undefined
				? undefined
				: ts.createSourceFile(fileName, text, ts.ScriptTarget.ESNext, true);
		},
		readFile: (fileName) => ts.sys.readFile(fileName),
		useCaseSensitiveFileNames: () => true,
		writeFile: () => {},
	};

	const program = ts.createProgram([FILE_NAME], options, host);
	const result = ts.transform(program.getSourceFile(FILE_NAME)!, [transformer(program)], options);
	const output = printer.printFile(result.transformed[0]!);
	result.dispose();
	return output;
}

describe("integration: module specifiers against a real type checker", () => {
	it("should resolve a const bound to a relative module path", () => {
		expect.assertions(1);

		const source = `
import { jest } from "@rbxts/jest-globals";
const MODULE_PATH = "./foo";
jest.mock(MODULE_PATH);
`;

		expect(transformWithRealProgram(source)).toMatch(/jest\.mock\(script\.Parent\.foo\)/);
	});

	it("should resolve a const module path in jest.doMock", () => {
		expect.assertions(1);

		const source = `
import { jest } from "@rbxts/jest-globals";
const MODULE_PATH = "./foo";
jest.doMock(MODULE_PATH, () => ({}));
`;

		expect(transformWithRealProgram(source)).toMatch(/jest\.doMock\(script\.Parent\.foo,/);
	});

	it("should throw on a module specifier read from a loop variable", () => {
		expect.assertions(1);

		const source = `
import { jest } from "@rbxts/jest-globals";
const RESET_MODULE_EXCEPTIONS = ["@rbxts/react"];
for (const moduleName of RESET_MODULE_EXCEPTIONS) {
	jest.doMock(moduleName, () => ({}));
}
`;

		expect(() => transformWithRealProgram(source)).toThrowError(
			/\[rbxts-jest-transformer] \/src\/test\.ts:5 — `jest\.doMock\(\)` requires a module specifier that can be resolved at compile time/,
		);
	});

	it("should throw on a module specifier read from a let binding", () => {
		expect.assertions(1);

		const source = `
import { jest } from "@rbxts/jest-globals";
let modulePath = "./foo";
jest.mock(modulePath);
`;

		expect(() => transformWithRealProgram(source)).toThrowError(/Cannot resolve: modulePath/);
	});

	it("should leave a non-string specifier untouched", () => {
		expect.assertions(1);

		const source = `
import { jest } from "@rbxts/jest-globals";
declare const target: { readonly path: string };
jest.mock(target);
`;

		expect(transformWithRealProgram(source)).toMatch(/jest\.mock\(target\)/);
	});
});
