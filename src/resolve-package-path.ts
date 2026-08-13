import path from "node:path";
import ts from "typescript";

import type { PackageJsonReader } from "./package-entry.js";
import { defaultReadPackageJson, resolvePackageEntryPath } from "./package-entry.js";
import type { TsConfigReader } from "./tsconfig-reader.js";
import { defaultReadTsConfig, resolveRojoFromTsConfig } from "./tsconfig-reader.js";

export interface CreateResolverOptions {
	loadDependencies?: () => Dependencies | undefined;
	readPackageJson?: PackageJsonReader;
	readTsConfig?: TsConfigReader;
	resolveModule?: ModuleResolver;
}

export interface Dependencies {
	PathTranslator: PathTranslatorConstructor;
	RojoResolver: RojoResolverStatic;
}

export interface PackageResolver {
	resolveToRbxPath(specifier: string, containingFile: string): ReadonlyArray<string> | undefined;
}

type ModuleResolver = (
	specifier: string,
	containingFile: string,
	options: ts.CompilerOptions,
) => string | undefined;

interface OwnerTranslator {
	readonly fileNames: ReadonlySet<string>;
	readonly pathTranslator: PathTranslatorLike;
}

type PathTranslatorConstructor = new (
	rootDirectory: string,
	outDirectory: string,
	buildInfoOutputPath: string | undefined,
	declaration: boolean,
) => PathTranslatorLike;

interface PathTranslatorLike {
	getImportPath(filePath: string, isNodeModule?: boolean): string;
}

interface ProjectContext {
	readonly compilerOptions: ts.CompilerOptions;
	readonly ownerTranslators: ReadonlyArray<OwnerTranslator>;
	readonly pathTranslator: PathTranslatorLike;
	readonly readPackageJson: PackageJsonReader;
	readonly resolveModule: ModuleResolver;
	readonly rojoResolver: RojoResolverLike;
}

interface RojoResolverLike {
	getRbxPathFromFilePath(filePath: string): ReadonlyArray<string> | undefined;
}

interface RojoResolverStatic {
	findRojoConfigFilePath(projectPath: string): { path: string | undefined };
	fromPath(rojoConfigFilePath: string): RojoResolverLike;
}

export function createPackageResolver(
	program: ts.Program,
	options: CreateResolverOptions = {},
): PackageResolver | undefined {
	const context = resolveProjectContext(program, options);
	if (context === undefined) {
		return undefined;
	}

	return {
		resolveToRbxPath(specifier: string, containingFile: string) {
			return resolveToRbxPath(context, specifier, containingFile);
		},
	};
}

export function findRojoConfig(
	resolver: { findRojoConfigFilePath(projectPath: string): { path: string | undefined } },
	projectDirectory: string,
): string | undefined {
	try {
		return resolver.findRojoConfigFilePath(projectDirectory).path;
	} catch {
		return undefined;
	}
}

export function rbxPathToExpression(
	factory: ts.NodeFactory,
	rbxPath: ReadonlyArray<string>,
): ts.Expression | undefined {
	const service = rbxPath[0];
	if (service === undefined) {
		return undefined;
	}

	const base = factory.createCallExpression(
		factory.createPropertyAccessExpression(factory.createIdentifier("game"), "GetService"),
		undefined,
		[factory.createStringLiteral(service)],
	);

	return chainFindFirstChild(factory, base, rbxPath.slice(1));
}

export function resolvePackagePath(
	factory: ts.NodeFactory,
	specifier: string,
	containingFile: string,
	resolver: PackageResolver,
): ts.Expression | undefined {
	if (specifier.startsWith(".")) {
		return undefined;
	}

	const rbxPath = resolver.resolveToRbxPath(specifier, containingFile);
	if (rbxPath === undefined) {
		return undefined;
	}

	return rbxPathToExpression(factory, rbxPath);
}

/* v8 ignore start -- integration-only: require catch + ts.resolveModuleName */
export function tryLoadDependencies():
	| undefined
	| { PathTranslator: PathTranslatorConstructor; RojoResolver: RojoResolverStatic } {
	try {
		// eslint-disable-next-line ts/no-require-imports -- optional peer deps loaded at runtime
		const rojoModule = require("@roblox-ts/rojo-resolver") as {
			RojoResolver: RojoResolverStatic;
		};
		// eslint-disable-next-line ts/no-require-imports -- optional peer deps loaded at runtime
		const pathModule = require("@roblox-ts/path-translator") as {
			PathTranslator: PathTranslatorConstructor;
		};

		return { PathTranslator: pathModule.PathTranslator, RojoResolver: rojoModule.RojoResolver };
	} catch {
		return undefined;
	}
}

function chainFindFirstChild(
	factory: ts.NodeFactory,
	base: ts.Expression,
	segments: ReadonlyArray<string>,
): ts.Expression {
	const chained = segments.reduce<ts.Expression>((accumulator, segment) => {
		return factory.createCallExpression(
			factory.createPropertyAccessExpression(
				factory.createNonNullExpression(accumulator),
				"FindFirstChild",
			),
			undefined,
			[factory.createStringLiteral(segment)],
		);
	}, base);

	if (segments.length > 0) {
		return factory.createAsExpression(chained, factory.createTypeReferenceNode("ModuleScript"));
	}

	return chained;
}

function defaultResolveModule(
	specifier: string,
	containingFile: string,
	options: ts.CompilerOptions,
): string | undefined {
	return ts.resolveModuleName(specifier, containingFile, options, ts.sys).resolvedModule
		?.resolvedFileName;
}

const NODE_MODULES_RE = /[\\/]node_modules[\\/]/;

interface BuildContextInput {
	readonly deps: Dependencies;
	readonly outDirectory: string;
	readonly readPackageJson: PackageJsonReader;
	readonly resolveModule: ModuleResolver;
	readonly rojoConfigPath: string;
	readonly rootDirectory: string;
}

function buildContext(program: ts.Program, input: BuildContextInput): ProjectContext {
	const { deps, outDirectory, readPackageJson, resolveModule, rojoConfigPath, rootDirectory } =
		input;
	return {
		compilerOptions: program.getCompilerOptions(),
		ownerTranslators: collectOwnerTranslators(program, deps.PathTranslator),
		pathTranslator: new deps.PathTranslator(rootDirectory, outDirectory, undefined, false),
		readPackageJson,
		resolveModule,
		rojoResolver: deps.RojoResolver.fromPath(rojoConfigPath),
	};
}

function buildOwnerTranslator(
	commandLine: ts.ParsedCommandLine,
	PathTranslatorCtor: PathTranslatorConstructor,
): OwnerTranslator | undefined {
	const { fileNames, options } = commandLine;
	const { configFilePath, outDir, rootDir } = options;
	if (typeof outDir !== "string") {
		return undefined;
	}

	const referenceRoot =
		rootDir ?? (typeof configFilePath === "string" ? path.dirname(configFilePath) : undefined);
	if (referenceRoot === undefined) {
		return undefined;
	}

	const pathTranslator = new PathTranslatorCtor(referenceRoot, outDir, undefined, false);
	return { fileNames: new Set(fileNames), pathTranslator };
}

function collectOwnerTranslators(
	program: ts.Program,
	PathTranslatorCtor: PathTranslatorConstructor,
): Array<OwnerTranslator> {
	const references = program.getResolvedProjectReferences() ?? [];
	const translators: Array<OwnerTranslator> = [];
	for (const reference of references) {
		if (reference === undefined) {
			continue;
		}

		const owner = buildOwnerTranslator(reference.commandLine, PathTranslatorCtor);
		if (owner !== undefined) {
			translators.push(owner);
		}
	}

	return translators;
}

function isUnderNodeModules(filePath: string): boolean {
	return NODE_MODULES_RE.test(filePath);
}

function pickOwnerTranslator(
	translators: ReadonlyArray<OwnerTranslator>,
	filePath: string,
): PathTranslatorLike | undefined {
	for (const owner of translators) {
		if (owner.fileNames.has(filePath)) {
			return owner.pathTranslator;
		}
	}

	return undefined;
}

function resolveProjectContext(
	program: ts.Program,
	options: CreateResolverOptions,
): ProjectContext | undefined {
	const { configFilePath, outDir, rootDir } = program.getCompilerOptions();
	const deps = (options.loadDependencies ?? tryLoadDependencies)();
	if (typeof configFilePath !== "string" || outDir === undefined || deps === undefined) {
		return undefined;
	}

	const projectDirectory = path.dirname(configFilePath);
	const rojoConfigPath = resolveRojoConfigPath(
		configFilePath,
		projectDirectory,
		options.readTsConfig ?? defaultReadTsConfig,
		deps.RojoResolver,
	);
	if (rojoConfigPath === undefined) {
		return undefined;
	}

	return buildContext(program, {
		deps,
		outDirectory: outDir,
		readPackageJson: options.readPackageJson ?? defaultReadPackageJson,
		resolveModule: options.resolveModule ?? defaultResolveModule,
		rojoConfigPath,
		rootDirectory: rootDir ?? projectDirectory,
	});
}

function resolveRojoConfigPath(
	configFilePath: string,
	projectDirectory: string,
	readTsConfig: TsConfigReader,
	rojoResolverStatic: RojoResolverStatic,
): string | undefined {
	return (
		resolveRojoFromTsConfig(configFilePath, readTsConfig) ??
		findRojoConfig(rojoResolverStatic, projectDirectory)
	);
}

/**
 * Mirrors roblox-ts's `createImportExpression` so that a mock is keyed by the
 * same instance the emitted `TS.import` requires.
 *
 * @param context - The resolved project context.
 * @param specifier - The module specifier to resolve.
 * @param containingFile - The file the specifier was written in.
 * @returns The rbx path of the target module, or `undefined` when it cannot be
 *   resolved.
 */
function resolveToRbxPath(
	context: ProjectContext,
	specifier: string,
	containingFile: string,
): ReadonlyArray<string> | undefined {
	const {
		compilerOptions,
		ownerTranslators,
		pathTranslator,
		readPackageJson,
		resolveModule,
		rojoResolver,
	} = context;
	const resolvedFileName = resolveModule(specifier, containingFile, compilerOptions);
	if (resolvedFileName === undefined) {
		return undefined;
	}

	if (isUnderNodeModules(resolvedFileName)) {
		const entryFileName =
			resolvePackageEntryPath(resolvedFileName, readPackageJson) ?? resolvedFileName;
		return rojoResolver.getRbxPathFromFilePath(
			pathTranslator.getImportPath(entryFileName, true),
		);
	}

	const translator = pickOwnerTranslator(ownerTranslators, resolvedFileName) ?? pathTranslator;
	return rojoResolver.getRbxPathFromFilePath(translator.getImportPath(resolvedFileName));
}
