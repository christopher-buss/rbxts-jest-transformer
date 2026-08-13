import type ts from "typescript";

import { resolveRelativeModulePath } from "./resolve-module-path.js";
import type { PackageResolver } from "./resolve-package-path.js";
import { resolvePackagePath } from "./resolve-package-path.js";

export interface SpecifierResolutionContext {
	readonly factory: ts.NodeFactory;
	readonly resolver: PackageResolver | undefined;
	readonly sourceFile: ts.SourceFile;
}

/**
 * Rewrites a module specifier to the instance path it names.
 *
 * @param specifier - The module specifier, as written in the source.
 * @param context - The factory used to build the path, the package resolver,
 *   and the file the specifier is written in.
 * @returns The instance expression, or `undefined` when the specifier names
 *   nothing the transformer can resolve.
 */
export function resolveSpecifierExpression(
	specifier: string,
	context: SpecifierResolutionContext,
): ts.Expression | undefined {
	const { factory, resolver, sourceFile } = context;
	return (
		resolveRelativeModulePath(factory, specifier) ??
		(resolver !== undefined
			? resolvePackagePath(factory, specifier, sourceFile.fileName, resolver)
			: undefined)
	);
}
