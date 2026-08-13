import ts from "typescript";

import { HOIST_METHODS } from "./constants.js";
import type { SpecifierContext } from "./module-specifier.js";
import { resolveModuleSpecifier } from "./module-specifier.js";
import { resolveRelativeModulePath } from "./resolve-module-path.js";
import type { PackageResolver } from "./resolve-package-path.js";
import { resolvePackagePath } from "./resolve-package-path.js";

export interface MockArgumentContext extends SpecifierContext {
	readonly factory: ts.NodeFactory;
	readonly resolver: PackageResolver | undefined;
}

export function transformFirstArgument(
	node: ts.CallExpression,
	context: MockArgumentContext,
): ReadonlyArray<ts.Expression> {
	const specifier = resolveModuleSpecifier(node, context);
	if (specifier === undefined) {
		return node.arguments;
	}

	const { factory, resolver, sourceFile } = context;
	const resolved =
		resolveRelativeModulePath(factory, specifier) ??
		(resolver !== undefined
			? resolvePackagePath(factory, specifier, sourceFile.fileName, resolver)
			: undefined);

	if (resolved === undefined) {
		return node.arguments;
	}

	return [resolved, ...node.arguments.slice(1)];
}

export function transformMockArguments(
	statements: ReadonlyArray<ts.Statement>,
	context: MockArgumentContext,
): Array<ts.Statement> {
	return statements.map((statement) => transformStatement(statement, context));
}

function transformCallChain(
	node: ts.CallExpression,
	context: MockArgumentContext,
): ts.CallExpression {
	const { factory } = context;
	const args = transformFirstArgument(node, context);
	const chained = transformInnerChain(node, args, context);
	if (chained !== undefined) {
		return chained;
	}

	if (args !== node.arguments) {
		return factory.updateCallExpression(node, node.expression, node.typeArguments, args);
	}

	return node;
}

function transformInnerChain(
	node: ts.CallExpression,
	args: ReadonlyArray<ts.Expression>,
	context: MockArgumentContext,
): ts.CallExpression | undefined {
	if (
		!ts.isPropertyAccessExpression(node.expression) ||
		!HOIST_METHODS.has(node.expression.name.text) ||
		!ts.isCallExpression(node.expression.expression)
	) {
		return undefined;
	}

	const inner = transformCallChain(node.expression.expression, context);
	if (inner === node.expression.expression && args === node.arguments) {
		return undefined;
	}

	const { factory } = context;
	const callee = factory.updatePropertyAccessExpression(
		node.expression,
		inner,
		node.expression.name,
	);

	return factory.updateCallExpression(node, callee, node.typeArguments, args);
}

function transformStatement(statement: ts.Statement, context: MockArgumentContext): ts.Statement {
	if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
		return statement;
	}

	const transformed = transformCallChain(statement.expression, context);
	if (transformed === statement.expression) {
		return statement;
	}

	return context.factory.updateExpressionStatement(statement, transformed);
}
