import ts from "typescript";

import type { JestNames } from "./constants.js";
import { HOIST_METHODS, MODULE_PATH_METHODS } from "./constants.js";
import { isModulePathCallee } from "./partition.js";
import type { SpecifierResolutionContext } from "./resolve-specifier.js";
import { resolveSpecifierExpression } from "./resolve-specifier.js";

export interface SpecifierArrayContext extends SpecifierResolutionContext {
	readonly checker: ts.TypeChecker;
	readonly names: JestNames;
}

export interface SpecifierArrays {
	/** Specifier arguments that the rewritten iterable makes safe. */
	readonly exempt: ReadonlySet<ts.Node>;
	/** Iterable expressions, mapped to the array of instance paths they become. */
	readonly replacements: ReadonlyMap<ts.Node, ts.Expression>;
}

interface Candidate {
	readonly arguments: ReadonlyArray<ts.Identifier>;
	readonly elements: ReadonlyArray<string>;
	readonly iterable: ts.Expression;
}

/**
 * Finds arrays of module specifiers whose elements are only ever iterated into
 * a jest call.
 *
 * `for (const name of ["./a"]) jest.doMock(name)` cannot resolve `name` on its
 * own, but the array it reads can be rewritten to instance paths, which leaves
 * the loop working as written. The iterable expression is rewritten, not the
 * declaration it may read, so every other use of the array keeps its strings.
 *
 * @param context - The checker used to find array declarations, the jest names
 *   in scope, and everything needed to resolve a specifier.
 * @returns The iterables to rewrite, and the arguments they make safe.
 */
export function collectSpecifierArrays(context: SpecifierArrayContext): SpecifierArrays {
	const exempt = new Set<ts.Node>();
	const replacements = new Map<ts.Node, ts.Expression>();

	for (const candidate of findCandidates(context.sourceFile, context)) {
		const resolved = resolveElements(candidate.elements, context);
		if (resolved === undefined) {
			continue;
		}

		replacements.set(
			candidate.iterable,
			context.factory.createArrayLiteralExpression(resolved),
		);
		for (const argument of candidate.arguments) {
			exempt.add(argument);
		}
	}

	return { exempt, replacements };
}

function buildCandidate(
	iterable: ts.Expression,
	binding: ts.Identifier,
	body: ts.Node,
	context: SpecifierArrayContext,
): Candidate | undefined {
	const elements = literalElements(iterable, context);
	if (elements === undefined) {
		return undefined;
	}

	const uses = collectUses(body, binding.text);
	if (uses.length === 0) {
		return undefined;
	}

	if (!uses.every((use) => isSpecifierArgument(use, context.names))) {
		return undefined;
	}

	return { arguments: uses, elements, iterable };
}

function collectUses(body: ts.Node, name: string): Array<ts.Identifier> {
	const uses: Array<ts.Identifier> = [];

	function visit(node: ts.Node): void {
		if (ts.isIdentifier(node) && node.text === name && !isPropertyName(node)) {
			uses.push(node);
		}

		ts.forEachChild(node, visit);
	}

	visit(body);
	return uses;
}

function findCandidates(
	sourceFile: ts.SourceFile,
	context: SpecifierArrayContext,
): Array<Candidate> {
	const candidates: Array<Candidate> = [];

	function visit(node: ts.Node): void {
		const candidate = matchForOf(node, context) ?? matchForEach(node, context);
		if (candidate !== undefined) {
			candidates.push(candidate);
		}

		ts.forEachChild(node, visit);
	}

	visit(sourceFile);
	return candidates;
}

function isPropertyName(node: ts.Identifier): boolean {
	const { parent } = node;
	return ts.isPropertyAccessExpression(parent) && parent.name === node;
}

function isSpecifierArgument(node: ts.Identifier, names: JestNames): boolean {
	const call = node.parent;
	if (!ts.isCallExpression(call) || call.arguments[0] !== node) {
		return false;
	}

	if (!ts.isPropertyAccessExpression(call.expression)) {
		return false;
	}

	const method = call.expression.name.text;
	if (!MODULE_PATH_METHODS.has(method) && !HOIST_METHODS.has(method)) {
		return false;
	}

	return isModulePathCallee(call.expression.expression, names);
}

function literalElements(
	expression: ts.Expression,
	context: SpecifierArrayContext,
): ReadonlyArray<string> | undefined {
	if (ts.isArrayLiteralExpression(expression)) {
		return stringElements(expression);
	}

	if (!ts.isIdentifier(expression)) {
		return undefined;
	}

	const declaration = context.checker.getSymbolAtLocation(expression)?.valueDeclaration;
	if (
		declaration === undefined ||
		!ts.isVariableDeclaration(declaration) ||
		declaration.initializer === undefined ||
		(declaration.parent.flags & ts.NodeFlags.Const) === 0
	) {
		return undefined;
	}

	// A relative specifier in another file names a module relative to that
	// file, which is not the path this file has to emit.
	if (declaration.getSourceFile() !== context.sourceFile) {
		return undefined;
	}

	return ts.isArrayLiteralExpression(declaration.initializer)
		? stringElements(declaration.initializer)
		: undefined;
}

function matchForEach(node: ts.Node, context: SpecifierArrayContext): Candidate | undefined {
	if (
		!ts.isCallExpression(node) ||
		!ts.isPropertyAccessExpression(node.expression) ||
		node.expression.name.text !== "forEach" ||
		node.arguments.length !== 1
	) {
		return undefined;
	}

	const [callback] = node.arguments;
	if (
		callback === undefined ||
		(!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
	) {
		return undefined;
	}

	// A callback that also reads the index or the array itself would still see
	// the strings, so only the plain one-parameter form can be rewritten.
	const parameter = callback.parameters.length === 1 ? callback.parameters[0] : undefined;
	if (parameter === undefined || !ts.isIdentifier(parameter.name)) {
		return undefined;
	}

	return buildCandidate(node.expression.expression, parameter.name, callback.body, context);
}

function matchForOf(node: ts.Node, context: SpecifierArrayContext): Candidate | undefined {
	if (!ts.isForOfStatement(node) || !ts.isVariableDeclarationList(node.initializer)) {
		return undefined;
	}

	const [declaration] = node.initializer.declarations;
	if (declaration === undefined || !ts.isIdentifier(declaration.name)) {
		return undefined;
	}

	return buildCandidate(node.expression, declaration.name, node.statement, context);
}

function resolveElements(
	elements: ReadonlyArray<string>,
	context: SpecifierArrayContext,
): Array<ts.Expression> | undefined {
	const resolved: Array<ts.Expression> = [];
	for (const element of elements) {
		const expression = resolveSpecifierExpression(element, context);
		if (expression === undefined) {
			return undefined;
		}

		resolved.push(expression);
	}

	return resolved;
}

function stringElements(node: ts.ArrayLiteralExpression): ReadonlyArray<string> | undefined {
	const elements: Array<string> = [];
	for (const element of node.elements) {
		if (!ts.isStringLiteral(element)) {
			return undefined;
		}

		elements.push(element.text);
	}

	return elements;
}
