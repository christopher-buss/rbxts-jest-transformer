import ts from "typescript";

import { collectJestNames } from "./collect-jest-names.js";
import type { IdentifierPredicate, JestNames } from "./constants.js";
import {
	ALLOWED_IDENTIFIERS,
	CHAINABLE_MODULE_PATH_METHODS,
	MODULE_PATH_METHODS,
} from "./constants.js";
import { isJestCallee, partitionBlock, partitionStatements } from "./partition.js";
import type { PackageResolver } from "./resolve-package-path.js";
import { createPackageResolver } from "./resolve-package-path.js";
import { collectShadowedNames, filterShadowed } from "./shadowing.js";
import type { MockArgumentContext } from "./transform-mock-args.js";
import { transformFirstArgument, transformMockArguments } from "./transform-mock-args.js";

interface TransformContext extends MockArgumentContext, TransformerOptions {
	readonly names: JestNames;
}

interface TransformerOptions {
	readonly checker: ts.TypeChecker;
	readonly isAllowed: IdentifierPredicate;
	readonly jsxFactoryIdentifier: string | undefined;
	readonly resolver: PackageResolver | undefined;
}

export default function transformer(program: ts.Program): ts.TransformerFactory<ts.SourceFile> {
	const checker = program.getTypeChecker();
	const options: TransformerOptions = {
		checker,
		isAllowed: createGlobalCheck(checker),
		jsxFactoryIdentifier: getJsxFactoryIdentifier(program.getCompilerOptions()),
		resolver: createPackageResolver(program),
	};

	return (context) => {
		return (sourceFile) => {
			const ctx = buildContext(context, sourceFile, options);
			const hoisted = ts.visitNode(
				sourceFile,
				createHoistVisitor(context, ctx),
				ts.isSourceFile,
			);

			return ts.visitNode(hoisted, createModulePathVisitor(context, ctx), ts.isSourceFile);
		};
	};
}

function buildContext(
	context: ts.TransformationContext,
	sourceFile: ts.SourceFile,
	options: TransformerOptions,
): TransformContext {
	const names = collectJestNames(sourceFile.statements);
	const shadowed = collectShadowedNames(sourceFile.statements, names);

	return {
		...options,
		factory: context.factory,
		names: filterShadowed(names, shadowed),
		sourceFile,
	};
}

function createGlobalCheck(checker: ts.TypeChecker): IdentifierPredicate {
	return (name: string) => {
		if (ALLOWED_IDENTIFIERS.has(name)) {
			return true;
		}

		const symbol = checker.resolveName(
			name,
			undefined,
			ts.SymbolFlags.Value | ts.SymbolFlags.Namespace,
			false,
		);
		if (symbol?.declarations === undefined || symbol.declarations.length === 0) {
			return false;
		}

		return symbol.declarations.every((decl) => decl.getSourceFile().isDeclarationFile);
	};
}

function createHoistVisitor(
	context: ts.TransformationContext,
	ctx: TransformContext,
): (node: ts.Node) => ts.Node {
	function visitor(node: ts.Node): ts.Node {
		const visited = ts.visitEachChild(node, visitor, context);

		if (ts.isSourceFile(visited)) {
			return visitSourceFile(visited, ctx);
		}

		if (ts.isBlock(visited)) {
			return visitBlock(visited, ctx);
		}

		return visited;
	}

	return visitor;
}

function createModulePathVisitor(
	context: ts.TransformationContext,
	ctx: TransformContext,
): (node: ts.Node) => ts.Node {
	function visitor(node: ts.Node): ts.Node {
		const visited = ts.visitEachChild(node, visitor, context);

		if (ts.isCallExpression(visited) && isModulePathCall(visited, ctx.names)) {
			return visitModulePathCall(visited, ctx);
		}

		return visited;
	}

	return visitor;
}

function getJsxFactoryIdentifier(options: ts.CompilerOptions): string | undefined {
	const factory = options.jsxFactory ?? "React.createElement";
	const dot = factory.indexOf(".");
	return dot === -1 ? factory : factory.slice(0, dot);
}

function isModulePathCall(node: ts.CallExpression, names: JestNames): boolean {
	return (
		ts.isPropertyAccessExpression(node.expression) &&
		MODULE_PATH_METHODS.has(node.expression.name.text) &&
		isModulePathCallee(node.expression.expression, names)
	);
}

function isModulePathCallee(node: ts.Expression, names: JestNames): boolean {
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

function visitBlock(node: ts.Block, ctx: TransformContext): ts.Block {
	const result = partitionBlock(node.statements, ctx.names, ctx.sourceFile, ctx.isAllowed);
	if (!result) {
		return node;
	}

	return ctx.factory.updateBlock(node, [
		...result.hoistedVariables,
		...transformMockArguments(result.hoisted, ctx),
		...result.rest,
	]);
}

function visitModulePathCall(node: ts.CallExpression, ctx: TransformContext): ts.CallExpression {
	const args = transformFirstArgument(node, ctx);
	if (args === node.arguments) {
		return node;
	}

	return ctx.factory.updateCallExpression(node, node.expression, node.typeArguments, args);
}

function visitSourceFile(node: ts.SourceFile, ctx: TransformContext): ts.SourceFile {
	const { dependencyImports, hoisted, hoistedVariables, jestImport, rest } = partitionStatements(
		node.statements,
		ctx.names,
		ctx.sourceFile,
		{ isAllowed: ctx.isAllowed, jsxFactoryIdentifier: ctx.jsxFactoryIdentifier },
	);

	return ctx.factory.updateSourceFile(node, [
		...jestImport,
		...dependencyImports,
		...hoistedVariables,
		...transformMockArguments(hoisted, ctx),
		...rest,
	]);
}
