import ts from "typescript";

import { ALLOWED_IDENTIFIERS } from "../constants.js";
import transformer from "../index.js";

const declarationFile = ts.createSourceFile("globals.d.ts", "", ts.ScriptTarget.ESNext);

const mockDeclaration = { getSourceFile: () => declarationFile } as unknown as ts.Declaration;

const MOCK_SYMBOL = { declarations: [mockDeclaration] };

const MOCK_GLOBALS = new Set([
	"CFrame",
	"game",
	"print",
	"task",
	"Vector3",
	...ALLOWED_IDENTIFIERS,
]);

// Minimal stand-in for the real checker. It only models what the transformer
// asks about: whether an expression is a compile-time string, a runtime string,
// or something else entirely (a `ModuleScript` in a real project).
const STRING_TYPE = fakeType(ts.TypeFlags.String);
const STRING_ARRAY_TYPE = fakeType(ts.TypeFlags.Object);
const UNKNOWN_TYPE = fakeType(ts.TypeFlags.Unknown);

const declarationSymbols = new Map<ts.Declaration, ts.Symbol>();

const mockChecker = {
	getSymbolAtLocation: symbolAtLocation,
	getTypeAtLocation: typeAtLocation,
	resolveName: (name: string) => (MOCK_GLOBALS.has(name) ? MOCK_SYMBOL : undefined),
} as unknown as ts.TypeChecker;

export const mockProgram = {
	getCompilerOptions: () => ({}),
	getTypeChecker: () => mockChecker,
} as unknown as ts.Program;

// eslint-disable-next-line unicorn/no-keyword-prefix -- TS API property name
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

export function createMockProgram(compilerOptions: ts.CompilerOptions = {}): ts.Program {
	return {
		getCompilerOptions: () => compilerOptions,
		getTypeChecker: () => mockChecker,
	} as unknown as ts.Program;
}

export function getMockChecker(): ts.TypeChecker {
	return mockChecker;
}

export function transformCode(input: string, fileName = "test.ts"): string {
	const sourceFile = ts.createSourceFile(fileName, input, ts.ScriptTarget.ESNext, true);
	const factory = transformer(mockProgram);
	const result = ts.transform(sourceFile, [factory]);
	const transformed = result.transformed[0];
	if (!transformed) {
		throw new Error("Transform produced no output");
	}

	const output = printer.printFile(transformed);
	result.dispose();
	return output;
}

function fakeType(flags: ts.TypeFlags, value?: string): ts.Type {
	return {
		flags,
		isStringLiteral: () => value !== undefined,
		isUnion: () => false,
		value,
	} as unknown as ts.Type;
}

function findVariableDeclaration(node: ts.Node, name: string): ts.VariableDeclaration | undefined {
	if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
		return node;
	}

	return ts.forEachChild(node, (child) => findVariableDeclaration(child, name));
}

function symbolAtLocation(node: ts.Node): ts.Symbol | undefined {
	if (!ts.isIdentifier(node)) {
		return undefined;
	}

	const declaration = findVariableDeclaration(node.getSourceFile(), node.text);
	if (declaration === undefined) {
		return undefined;
	}

	const existing = declarationSymbols.get(declaration);
	if (existing !== undefined) {
		return existing;
	}

	const symbol = { valueDeclaration: declaration } as unknown as ts.Symbol;
	declarationSymbols.set(declaration, symbol);
	return symbol;
}

function typeAtLocation(node: ts.Node): ts.Type {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		return fakeType(ts.TypeFlags.StringLiteral, node.text);
	}

	if (ts.isArrayLiteralExpression(node)) {
		return node.elements.every((element) => ts.isStringLiteral(element))
			? STRING_ARRAY_TYPE
			: UNKNOWN_TYPE;
	}

	if (!ts.isIdentifier(node)) {
		return UNKNOWN_TYPE;
	}

	const declaration = findVariableDeclaration(node.getSourceFile(), node.text);
	return declaration === undefined ? UNKNOWN_TYPE : typeOfDeclaration(declaration);
}

function typeOfDeclaration(declaration: ts.VariableDeclaration): ts.Type {
	if (declaration.type !== undefined) {
		return declaration.type.kind === ts.SyntaxKind.StringKeyword ? STRING_TYPE : UNKNOWN_TYPE;
	}

	const list = declaration.parent;
	if (ts.isForOfStatement(list.parent)) {
		return typeAtLocation(list.parent.expression) === STRING_ARRAY_TYPE
			? STRING_TYPE
			: UNKNOWN_TYPE;
	}

	if (declaration.initializer === undefined) {
		return UNKNOWN_TYPE;
	}

	const initializer = typeAtLocation(declaration.initializer);
	// `let`/`var` widen a literal initializer to `string`.
	if (initializer.isStringLiteral() && (list.flags & ts.NodeFlags.Const) === 0) {
		return STRING_TYPE;
	}

	return initializer;
}
