import ts from "typescript";

import { isJestModuleImport } from "./collect-jest-names.js";
import { CHAINABLE_MODULE_PATH_METHODS, HOIST_METHODS, JEST_GLOBAL_NAME } from "./constants.js";
import type { IdentifierPredicate, JestNames } from "./constants.js";
import {
	collectHoistedIdentifiers,
	collectImportBindings,
	extractDependencyImports,
} from "./extract-imports.js";
import type { HoistableDeclaration } from "./extract-variables.js";
import { extractAllVariables } from "./extract-variables.js";
import { validateFactory } from "./factory-validation.js";
import { collectPureConstants } from "./purity.js";

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

export interface BlockPartitionResult {
	readonly hoisted: Array<ts.Statement>;
	readonly hoistedVariables: Array<HoistableDeclaration>;
	readonly rest: Array<ts.Statement>;
}

export interface PartitionResult {
	readonly dependencyImports: Array<ts.Statement>;
	readonly hoisted: Array<ts.Statement>;
	readonly hoistedVariables: Array<HoistableDeclaration>;
	readonly jestImport: Array<ts.Statement>;
	readonly rest: Array<ts.Statement>;
}

interface PartitionOptions {
	readonly isAllowed: IdentifierPredicate;
	readonly jsxFactoryIdentifier: string | undefined;
}

export function isJestCallee(node: ts.Expression, names: JestNames): boolean {
	if (ts.isIdentifier(node)) {
		return names.tracked.has(node.text);
	}

	if (
		ts.isPropertyAccessExpression(node) &&
		ts.isIdentifier(node.expression) &&
		node.name.text === JEST_GLOBAL_NAME &&
		names.namespaces.has(node.expression.text)
	) {
		return true;
	}

	// Chained calls: jest.mock('./a').unmock('./b')
	if (
		ts.isCallExpression(node) &&
		ts.isPropertyAccessExpression(node.expression) &&
		HOIST_METHODS.has(node.expression.name.text)
	) {
		return isJestCallee(node.expression.expression, names);
	}

	return false;
}

export function isModulePathCallee(node: ts.Expression, names: JestNames): boolean {
	if (isJestCallee(node, names)) {
		return true;
	}

	// Chained imperative calls: jest.doMock("./a", fa).doMock("./b", fb)
	return (
		ts.isCallExpression(node) &&
		ts.isPropertyAccessExpression(node.expression) &&
		CHAINABLE_MODULE_PATH_METHODS.has(node.expression.name.text) &&
		isModulePathCallee(node.expression.expression, names)
	);
}

export function partitionBlock(
	statements: ts.NodeArray<ts.Statement>,
	names: JestNames,
	sourceFile: ts.SourceFile,
	isAllowed: IdentifierPredicate,
): BlockPartitionResult | undefined {
	const pureConstants = collectPureConstants(statements);
	const hoisted: Array<ts.ExpressionStatement> = [];
	const rest: Array<ts.Statement> = [];
	for (const statement of statements) {
		if (isHoistableCall(statement, names)) {
			validateFactory(statement, sourceFile, {
				importBindings: EMPTY_SET,
				isAllowed,
				pureConstants,
			});
			hoisted.push(statement);
		} else {
			rest.push(statement);
		}
	}

	if (hoisted.length === 0) {
		return undefined;
	}

	const { hoistedVariables, remaining } = extractAllVariables(hoisted, rest, pureConstants);

	return { hoisted, hoistedVariables, rest: remaining };
}

export function partitionStatements(
	statements: ts.NodeArray<ts.Statement>,
	names: JestNames,
	sourceFile: ts.SourceFile,
	{ isAllowed, jsxFactoryIdentifier }: PartitionOptions,
): PartitionResult {
	const pureConstants = collectPureConstants(statements);
	const mockTargets = collectMockTargetModules(statements, names);
	const importBindings = collectImportBindings(statements, mockTargets);
	const jestImport: Array<ts.Statement> = [];
	const hoisted: Array<ts.ExpressionStatement> = [];
	const rest: Array<ts.Statement> = [];
	for (const statement of statements) {
		if (isJestModuleImport(statement)) {
			jestImport.push(statement);
		} else if (isHoistableCall(statement, names)) {
			validateFactory(statement, sourceFile, { importBindings, isAllowed, pureConstants });
			hoisted.push(statement);
		} else {
			rest.push(statement);
		}
	}

	const { hoistedVariables, remaining } = extractAllVariables(hoisted, rest, pureConstants);
	const depIds = collectHoistedIdentifiers(hoisted, hoistedVariables, jsxFactoryIdentifier);
	const { dependencyImports, remaining: finalRest } = extractDependencyImports(remaining, depIds);

	return { dependencyImports, hoisted, hoistedVariables, jestImport, rest: finalRest };
}

function collectMockTargetModules(
	statements: ts.NodeArray<ts.Statement>,
	names: JestNames,
): Set<string> {
	const targets = new Set<string>();
	for (const statement of statements) {
		if (!isHoistableCall(statement, names)) {
			continue;
		}

		let node = statement.expression;
		while (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			HOIST_METHODS.has(node.expression.name.text)
		) {
			for (const argument of node.arguments) {
				const value = unwrapStringLiteral(argument);
				if (value !== undefined) {
					targets.add(value);
				}
			}

			node = node.expression.expression;
		}
	}

	return targets;
}

function isHoistableCall(
	node: ts.Node,
	names: JestNames,
): node is ts.CallExpression | ts.ExpressionStatement {
	if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) {
		return false;
	}

	const { expression: callee } = node.expression;

	return (
		ts.isPropertyAccessExpression(callee) &&
		HOIST_METHODS.has(callee.name.text) &&
		isJestCallee(callee.expression, names)
	);
}

function unwrapStringLiteral(node: ts.Expression): string | undefined {
	if (ts.isStringLiteral(node)) {
		return node.text;
	}

	if (ts.isAsExpression(node)) {
		return unwrapStringLiteral(node.expression);
	}

	return undefined;
}
