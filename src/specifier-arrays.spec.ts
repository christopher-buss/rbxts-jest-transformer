import ts from "typescript";
import { describe, expect, it } from "vitest";

import { collectSpecifierArrays } from "./specifier-arrays.js";
import { transformCode } from "./test-helpers/transform.js";

describe("arrays of module specifiers", () => {
	it("should resolve the elements of an inline array iterated into jest.doMock", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
for (const moduleName of ["./a", "./b"]) {
	jest.doMock(moduleName, () => ({}));
}
`;

		const result = transformCode(input);

		expect(result).toMatch(/of \[script\.Parent\.a, script\.Parent\.b\]/);
	});

	it("should resolve the elements of a const array iterated into jest.doMock", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
const RESET_MODULE_EXCEPTIONS = ["./a"];
for (const moduleName of RESET_MODULE_EXCEPTIONS) {
	jest.doMock(moduleName, () => jest.requireActual(moduleName));
}
`;

		const result = transformCode(input);

		expect(result).toMatch(/of \[script\.Parent\.a\]/);
	});

	it("should leave the const array declaration alone", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
const RESET_MODULE_EXCEPTIONS = ["./a"];
for (const moduleName of RESET_MODULE_EXCEPTIONS) {
	jest.doMock(moduleName, () => ({}));
}
`;

		const result = transformCode(input);

		expect(result).toMatch(/const RESET_MODULE_EXCEPTIONS = \["\.\/a"\]/);
	});

	it("should resolve the elements of an array passed through forEach", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
const RESET_MODULE_EXCEPTIONS = ["./a"];
RESET_MODULE_EXCEPTIONS.forEach((moduleName) => {
	jest.doMock(moduleName, () => jest.requireActual(moduleName));
});
`;

		const result = transformCode(input);

		expect(result).toMatch(/\[script\.Parent\.a]\.forEach/);
	});

	it("should resolve the elements of an array iterated into jest.mock", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
for (const moduleName of ["./a"]) {
	jest.mock(moduleName);
}
`;

		const result = transformCode(input);

		expect(result).toMatch(/of \[script\.Parent\.a\]/);
	});

	it("should accept an empty array", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
for (const moduleName of []) {
	jest.doMock(moduleName, () => ({}));
}
`;

		const result = transformCode(input);

		expect(result).toMatch(/of \[\]/);
	});

	it("should resolve an array iterated into a chained jest.doMock", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
for (const moduleName of ["./a"]) {
	jest.doMock("./b", () => ({})).dontMock(moduleName);
}
`;

		const result = transformCode(input);

		expect(result).toMatch(/of \[script\.Parent\.a\]/);
	});
});

describe("arrays that cannot be resolved", () => {
	it("should throw when the loop variable has a use that is not a specifier", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
for (const moduleName of ["./a"]) {
	print(moduleName);
	jest.doMock(moduleName, () => ({}));
}
`;

		expect(() => transformCode(input)).toThrowError(/Cannot resolve: moduleName/);
	});

	it("should throw when an element of the array does not resolve", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
for (const moduleName of ["./a", "@rbxts/react"]) {
	jest.doMock(moduleName, () => ({}));
}
`;

		expect(() => transformCode(input)).toThrowError(/Cannot resolve: moduleName/);
	});

	it("should throw when the array is not a const", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
let modules = ["./a"];
for (const moduleName of modules) {
	jest.doMock(moduleName, () => ({}));
}
`;

		expect(() => transformCode(input)).toThrowError(/Cannot resolve: moduleName/);
	});

	it("should not resolve an array built at runtime", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
const modules = getModules();
for (const moduleName of modules) {
	jest.doMock(moduleName, () => ({}));
}
`;

		const result = transformCode(input);

		expect(result).toMatch(/of modules\b/);
	});

	it("should not resolve an iterable that is a call", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
for (const moduleName of getModules()) {
	jest.doMock(moduleName, () => ({}));
}
`;

		const result = transformCode(input);

		expect(result).toMatch(/of getModules\(\)/);
	});

	it("should not resolve an array when forEach takes an index parameter", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
const modules = ["./a"];
modules.forEach((moduleName, index) => {
	jest.doMock(moduleName, () => ({}));
});
`;

		const result = transformCode(input);

		expect(result).toMatch(/modules\.forEach/);
	});

	it("should not resolve an array when the forEach parameter is destructured", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
const modules = ["./a"];
modules.forEach(({ moduleName }) => {
	jest.doMock(moduleName, () => ({}));
});
`;

		const result = transformCode(input);

		expect(result).toMatch(/modules\.forEach/);
	});

	it("should not resolve an array when forEach is given a function reference", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
const modules = ["./a"];
modules.forEach(mockModule);
`;

		const result = transformCode(input);

		expect(result).toMatch(/modules\.forEach/);
	});

	it("should not resolve an array when the loop variable is destructured", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
for (const [moduleName] of [["./a"]]) {
	jest.doMock(moduleName, () => ({}));
}
`;

		const result = transformCode(input);

		expect(result).toMatch(/of \[\["\.\/a"\]\]/);
	});

	it("should not resolve an array that holds a non-literal element", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
declare const other: string;
for (const moduleName of ["./a", other]) {
	jest.doMock(moduleName, () => ({}));
}
`;

		const result = transformCode(input);

		expect(result).toMatch(/of \["\.\/a", other\]/);
	});

	it("should leave a loop that never uses its variable alone", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
for (const moduleName of ["./a"]) {
	jest.doMock("./b", () => ({}));
}
`;

		const result = transformCode(input);

		expect(result).toMatch(/of \["\.\/a"\]/);
	});

	it("should not resolve an array declared in another file", () => {
		expect.assertions(1);

		const other = ts.createSourceFile(
			"other.ts",
			'export const modules = ["./a"];',
			ts.ScriptTarget.ESNext,
			true,
		);
		const declaration = other.statements[0];
		const sourceFile = ts.createSourceFile(
			"test.ts",
			`for (const moduleName of modules) {
	jest.doMock(moduleName, () => ({}));
}`,
			ts.ScriptTarget.ESNext,
			true,
		);
		const checker = {
			getSymbolAtLocation: () => {
				return {
					valueDeclaration: (declaration as ts.VariableStatement).declarationList
						.declarations[0],
				} as unknown as ts.Symbol;
			},
		} as unknown as ts.TypeChecker;

		const result = collectSpecifierArrays({
			checker,
			factory: ts.factory,
			names: { namespaces: new Set(), tracked: new Set(["jest"]) },
			resolver: undefined,
			sourceFile,
		});

		expect(result.replacements.size).toBe(0);
	});
});

describe("arrays used outside jest calls", () => {
	it("should throw when the loop variable is read by a factory body", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
for (const moduleName of ["./a"]) {
	jest.doMock(moduleName, () => ({ name: moduleName }));
}
`;

		expect(() => transformCode(input)).toThrowError(/Cannot resolve: moduleName/);
	});

	it("should allow the loop variable to name a property", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
for (const moduleName of ["./a"]) {
	jest.doMock(moduleName, () => ({}));
	other.moduleName = 1;
}
`;

		const result = transformCode(input);

		expect(result).toMatch(/of \[script\.Parent\.a\]/);
	});

	it("should throw when the loop variable is passed to a non-jest call", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
for (const moduleName of ["./a"]) {
	other.doMock(moduleName);
	jest.doMock(moduleName, () => ({}));
}
`;

		expect(() => transformCode(input)).toThrowError(/Cannot resolve: moduleName/);
	});

	it("should throw when the loop variable is not the first argument", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
for (const moduleName of ["./a"]) {
	jest.doMock("./b", moduleName);
	jest.doMock(moduleName, () => ({}));
}
`;

		expect(() => transformCode(input)).toThrowError(/Cannot resolve: moduleName/);
	});

	it("should throw when the loop variable is passed to a non-specifier method", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
for (const moduleName of ["./a"]) {
	jest.setTimeout(moduleName);
	jest.doMock(moduleName, () => ({}));
}
`;

		expect(() => transformCode(input)).toThrowError(/Cannot resolve: moduleName/);
	});

	it("should throw when the loop variable is used bare", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
for (const moduleName of ["./a"]) {
	moduleName;
	jest.doMock(moduleName, () => ({}));
}
`;

		expect(() => transformCode(input)).toThrowError(/Cannot resolve: moduleName/);
	});
});
