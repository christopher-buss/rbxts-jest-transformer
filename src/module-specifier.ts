import ts from "typescript";

export interface SpecifierContext {
	readonly checker: ts.TypeChecker;
	readonly sourceFile: ts.SourceFile;
}

/**
 * Reads the module specifier of a jest call as a compile-time string.
 *
 * A string literal is taken as written. Anything else is asked of the type
 * checker: a string literal type (a `const` bound to a literal, for example)
 * still resolves, while a specifier that only has a value at runtime cannot be
 * rewritten to an instance path and is rejected.
 *
 * @param node - The jest call whose first argument is a module specifier.
 * @param context - The checker used to type the argument, and the file the call
 *   belongs to (used for the diagnostic location).
 * @returns The specifier text, or `undefined` when the argument is absent or is
 *   not a string (an instance expression, for example).
 * @throws When the argument is a string that is only known at runtime.
 */
export function resolveModuleSpecifier(
	node: ts.CallExpression,
	context: SpecifierContext,
): string | undefined {
	const argument = node.arguments[0];
	if (argument === undefined) {
		return undefined;
	}

	if (ts.isStringLiteral(argument)) {
		return argument.text;
	}

	// Nodes made by an earlier transformer have no source position, so the
	// checker cannot type them.
	if (argument.pos < 0) {
		return undefined;
	}

	const type = context.checker.getTypeAtLocation(argument);
	if (type.isStringLiteral()) {
		return type.value;
	}

	if (!isStringLike(type)) {
		return undefined;
	}

	throwSpecifierError(node, argument, context.sourceFile);
}

function describeCall(node: ts.CallExpression): string {
	if (ts.isPropertyAccessExpression(node.expression)) {
		return `jest.${node.expression.name.text}()`;
	}

	return "jest.mock()";
}

function isStringLike(type: ts.Type): boolean {
	if (type.isUnion()) {
		return type.types.every((constituent) => isStringLike(constituent));
	}

	return (type.flags & ts.TypeFlags.StringLike) !== 0;
}

function throwSpecifierError(
	node: ts.CallExpression,
	argument: ts.Expression,
	sourceFile: ts.SourceFile,
): never {
	const { line } = ts.getLineAndCharacterOfPosition(sourceFile, argument.getStart(sourceFile));
	const location = `${sourceFile.fileName}:${String(line + 1)}`;
	throw new Error(
		`[rbxts-jest-transformer] ${location} — \`${describeCall(node)}\` requires a module specifier that can be resolved at compile time.\n` +
			`Cannot resolve: ${argument.getText(sourceFile)}\n` +
			"Note: the specifier must be a string literal, or a `const` bound to one, so it can be rewritten to a Roblox instance path. " +
			"A specifier that only exists at runtime — a loop variable, a `let` binding, an array element — reaches jest at runtime as a plain string and fails with `could not resolve an Instance named ...`.\n" +
			"Pass a `ModuleScript` instead if the module is not known until runtime.",
	);
}
