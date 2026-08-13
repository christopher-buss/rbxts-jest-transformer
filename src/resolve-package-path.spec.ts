/* eslint-disable sonar/no-duplicate-string -- test assertion values */
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import type { Dependencies, PackageResolver } from "./resolve-package-path.js";
import {
	createPackageResolver,
	findRojoConfig,
	rbxPathToExpression,
	resolvePackagePath,
} from "./resolve-package-path.js";

const { createPrinter, createSourceFile, EmitHint, factory, NewLineKind, ScriptTarget } = ts;

// eslint-disable-next-line unicorn/no-keyword-prefix -- TS API property name
const printer = createPrinter({ newLine: NewLineKind.LineFeed });
const dummyFile = createSourceFile("test.ts", "", ScriptTarget.ESNext);

function print(node: ts.Expression | undefined): string {
	if (node === undefined) {
		throw new Error("Expected expression, got undefined");
	}

	return printer.printNode(EmitHint.Expression, node, dummyFile);
}

describe(rbxPathToExpression, () => {
	it("should return undefined for empty path", () => {
		expect.assertions(1);

		const result = rbxPathToExpression(factory, []);

		expect(result).toBeUndefined();
	});

	it("should wrap first segment in game.GetService()", () => {
		expect.assertions(1);

		const result = rbxPathToExpression(factory, ["ReplicatedStorage"]);

		expect(print(result)).toBe('game.GetService("ReplicatedStorage")');
	});

	it("should chain segments with FindFirstChild", () => {
		expect.assertions(1);

		const result = rbxPathToExpression(factory, [
			"ReplicatedStorage",
			"rbxts_include",
			"node_modules",
		]);

		expect(print(result)).toBe(
			'game.GetService("ReplicatedStorage")!.FindFirstChild("rbxts_include")!.FindFirstChild("node_modules") as ModuleScript',
		);
	});

	it("should handle @-prefixed segments with FindFirstChild", () => {
		expect.assertions(1);

		const result = rbxPathToExpression(factory, [
			"ReplicatedStorage",
			"rbxts_include",
			"node_modules",
			"@rbxts",
			"services",
		]);

		expect(print(result)).toBe(
			'game.GetService("ReplicatedStorage")!.FindFirstChild("rbxts_include")!.FindFirstChild("node_modules")!.FindFirstChild("@rbxts")!.FindFirstChild("services") as ModuleScript',
		);
	});

	it("should handle hyphenated segments with FindFirstChild", () => {
		expect.assertions(1);

		const result = rbxPathToExpression(factory, [
			"ReplicatedStorage",
			"rbxts_include",
			"node_modules",
			"@rbxts",
			"jest-globals",
		]);

		expect(print(result)).toBe(
			'game.GetService("ReplicatedStorage")!.FindFirstChild("rbxts_include")!.FindFirstChild("node_modules")!.FindFirstChild("@rbxts")!.FindFirstChild("jest-globals") as ModuleScript',
		);
	});
});

describe(resolvePackagePath, () => {
	function createMockResolver(rbxPath: ReadonlyArray<string> | undefined): PackageResolver {
		return {
			resolveToRbxPath(_specifier: string, _containingFile: string) {
				return rbxPath;
			},
		};
	}

	it("should resolve package specifier to instance expression", () => {
		expect.assertions(1);

		const resolver = createMockResolver([
			"ReplicatedStorage",
			"rbxts_include",
			"node_modules",
			"@rbxts",
			"services",
		]);

		const result = resolvePackagePath(factory, "@rbxts/services", "/src/test.ts", resolver);

		expect(print(result)).toBe(
			'game.GetService("ReplicatedStorage")!.FindFirstChild("rbxts_include")!.FindFirstChild("node_modules")!.FindFirstChild("@rbxts")!.FindFirstChild("services") as ModuleScript',
		);
	});

	it("should return undefined when resolver returns undefined", () => {
		expect.assertions(1);

		const resolver = createMockResolver(undefined);

		const result = resolvePackagePath(factory, "@rbxts/services", "/src/test.ts", resolver);

		expect(result).toBeUndefined();
	});

	it("should skip relative specifiers", () => {
		expect.assertions(1);

		const resolver = createMockResolver(["ReplicatedStorage", "foo"]);

		const result = resolvePackagePath(factory, "./foo", "/src/test.ts", resolver);

		expect(result).toBeUndefined();
	});
});

describe(createPackageResolver, () => {
	function mockProgram(
		options: Record<string, unknown>,
		references?: ReadonlyArray<MockProjectReference>,
	): ts.Program {
		return {
			getCompilerOptions: () => options,
			getResolvedProjectReferences: () => references,
		} as unknown as ts.Program;
	}

	interface MockProjectReference {
		readonly commandLine: {
			readonly fileNames: ReadonlyArray<string>;
			readonly options: {
				readonly outDir: string;
				readonly rootDir?: string;
			};
		};
	}

	function mockPathTranslator(transform = (filePath: string) => filePath) {
		return function PathTranslator() {
			return { getImportPath: transform, getOutputPath: transform };
		} as unknown as Dependencies["PathTranslator"];
	}

	/**
	 * Mirrors `PathTranslator.getImportPath`: TypeScript extensions become Luau
	 * ones and an `index` entry becomes `init`.
	 *
	 * @param filePath - The file path to translate.
	 * @returns The path of the emitted Luau file.
	 */
	function fakeImportPath(filePath: string): string {
		const luauPath = filePath.replace(/(?:\.d)?\.tsx?$/, ".lua");
		return luauPath === filePath
			? filePath
			: luauPath.replace(/(^|\/)index\.lua$/, "$1init.lua");
	}

	/**
	 * Mirrors `RojoResolver.getRbxPathFromFilePath` for the default roblox-ts
	 * `node_modules` partition: Luau extensions are stripped, an `init` file
	 * collapses into its folder, and anything else keeps its file name.
	 *
	 * @param filePath - The emitted file path to look up.
	 * @returns The rbx path of the file, or `undefined` outside `node_modules`.
	 */
	function fakeNodeModulesRbxPath(filePath: string): ReadonlyArray<string> | undefined {
		const relative = filePath.replace(/\\/g, "/").split("/node_modules/")[1];
		if (relative === undefined) {
			return undefined;
		}

		const segments = relative.split("/");
		const fileName = segments.pop()?.replace(/\.luau?$/, "");
		if (fileName !== undefined && fileName !== "init") {
			segments.push(fileName);
		}

		return ["ReplicatedStorage", "rbxts_include", "node_modules", ...segments];
	}

	function packageJsonReader(packageDirectory: string, json: unknown) {
		const manifestPath = path.resolve(packageDirectory, "package.json");
		return (packageJsonPath: string) => {
			return packageJsonPath === manifestPath ? json : (undefined as unknown);
		};
	}

	function mockDeps(
		rojoPath: string | undefined,
		rbxPathResult?: ReadonlyArray<string>,
	): Dependencies {
		return {
			PathTranslator: mockPathTranslator(),
			RojoResolver: {
				findRojoConfigFilePath: () => ({ path: rojoPath }),
				fromPath: () => ({ getRbxPathFromFilePath: () => rbxPathResult }),
			},
		};
	}

	it("should return undefined when configFilePath is missing", () => {
		expect.assertions(1);

		expect(createPackageResolver(mockProgram({}))).toBeUndefined();
	});

	it("should return undefined when outDir is missing", () => {
		expect.assertions(1);

		const program = mockProgram({ configFilePath: "/project/tsconfig.json" });

		expect(createPackageResolver(program)).toBeUndefined();
	});

	it("should return undefined when dependencies are not available", () => {
		expect.assertions(1);

		const program = mockProgram({
			configFilePath: "/project/tsconfig.json",
			outDir: "/project/out",
		});

		expect(createPackageResolver(program, { loadDependencies: () => {} })).toBeUndefined();
	});

	it("should return undefined when rojo config is not found", () => {
		expect.assertions(1);

		const program = mockProgram({
			configFilePath: "/project/tsconfig.json",
			outDir: "/project/out",
		});

		expect(
			createPackageResolver(program, {
				loadDependencies: () => mockDeps(undefined),
			}),
		).toBeUndefined();
	});

	it("should return resolver when all dependencies are available", () => {
		expect.assertions(1);

		const program = mockProgram({
			configFilePath: "/project/tsconfig.json",
			outDir: "/project/out",
		});
		const deps = mockDeps("/project/default.project.json");

		const resolver = createPackageResolver(program, { loadDependencies: () => deps });

		expect(resolver).toBeDefined();
	});

	it("should return undefined from resolveToRbxPath when module not found", () => {
		expect.assertions(1);

		const program = mockProgram({
			configFilePath: "/project/tsconfig.json",
			outDir: "/project/out",
		});
		const deps = mockDeps("/project/default.project.json", [
			"ReplicatedStorage",
			"rbxts_include",
		]);

		const resolver = createPackageResolver(program, {
			loadDependencies: () => deps,
			resolveModule: () => {},
		});
		const result = resolver?.resolveToRbxPath("@rbxts/services", "/project/src/test.ts");

		expect(result).toBeUndefined();
	});

	it("should resolve through full pipeline when module is found", () => {
		expect.assertions(1);

		const program = mockProgram({
			configFilePath: "/project/tsconfig.json",
			outDir: "/project/out",
		});
		const deps = mockDeps("/project/default.project.json", [
			"ReplicatedStorage",
			"rbxts_include",
			"node_modules",
			"@rbxts",
			"services",
		]);

		const resolver = createPackageResolver(program, {
			loadDependencies: () => deps,
			resolveModule: () => "/project/node_modules/@rbxts/services/index.d.ts",
		});
		const result = resolver?.resolveToRbxPath("@rbxts/services", "/project/src/test.ts");

		expect(result).toStrictEqual([
			"ReplicatedStorage",
			"rbxts_include",
			"node_modules",
			"@rbxts",
			"services",
		]);
	});

	it("should ask rojo about the runtime entry file, not the typings file", () => {
		expect.assertions(1);

		const program = mockProgram({
			configFilePath: "/project/tsconfig.json",
			outDir: "/project/out",
		});
		let queriedPath: string | undefined;
		const deps: Dependencies = {
			PathTranslator: mockPathTranslator(fakeImportPath),
			RojoResolver: {
				findRojoConfigFilePath: () => ({ path: "/project/default.project.json" }),
				fromPath: () => {
					return {
						getRbxPathFromFilePath: (filePath: string) => {
							queriedPath = filePath;
						},
					};
				},
			},
		};

		const resolver = createPackageResolver(program, {
			loadDependencies: () => deps,
			readPackageJson: packageJsonReader("/project/node_modules/@rbxts/jecs", {
				main: "src/jecs.luau",
				types: "src/jecs.d.ts",
			}),
			resolveModule: () => "/project/node_modules/@rbxts/jecs/src/jecs.d.ts",
		});
		resolver?.resolveToRbxPath("@rbxts/jecs", "/project/src/test.ts");

		expect(queriedPath).toBe(path.resolve("/project/node_modules/@rbxts/jecs/src/jecs.luau"));
	});

	it("should resolve a package entry to its module file, not the containing folder", () => {
		expect.assertions(1);

		const program = mockProgram({
			configFilePath: "/project/tsconfig.json",
			outDir: "/project/out",
		});
		const deps: Dependencies = {
			PathTranslator: mockPathTranslator(fakeImportPath),
			RojoResolver: {
				findRojoConfigFilePath: () => ({ path: "/project/default.project.json" }),
				fromPath: () => ({ getRbxPathFromFilePath: fakeNodeModulesRbxPath }),
			},
		};

		const resolver = createPackageResolver(program, {
			loadDependencies: () => deps,
			readPackageJson: packageJsonReader("/project/node_modules/@rbxts/jecs", {
				main: "src/jecs.luau",
				types: "src/jecs.d.ts",
			}),
			resolveModule: () => "/project/node_modules/@rbxts/jecs/src/jecs.d.ts",
		});
		const result = resolver?.resolveToRbxPath("@rbxts/jecs", "/project/src/test.ts");

		expect(result).toStrictEqual([
			"ReplicatedStorage",
			"rbxts_include",
			"node_modules",
			"@rbxts",
			"jecs",
			"src",
			"jecs",
		]);
	});

	it("should resolve a package whose entry is an index file to its folder", () => {
		expect.assertions(1);

		const program = mockProgram({
			configFilePath: "/project/tsconfig.json",
			outDir: "/project/out",
		});
		const deps: Dependencies = {
			PathTranslator: mockPathTranslator(fakeImportPath),
			RojoResolver: {
				findRojoConfigFilePath: () => ({ path: "/project/default.project.json" }),
				fromPath: () => ({ getRbxPathFromFilePath: fakeNodeModulesRbxPath }),
			},
		};

		const resolver = createPackageResolver(program, {
			loadDependencies: () => deps,
			readPackageJson: packageJsonReader("/project/node_modules/@rbxts/react", {
				main: "src/init.lua",
				types: "src/index.d.ts",
			}),
			resolveModule: () => "/project/node_modules/@rbxts/react/src/index.d.ts",
		});
		const result = resolver?.resolveToRbxPath("@rbxts/react", "/project/src/test.ts");

		expect(result).toStrictEqual([
			"ReplicatedStorage",
			"rbxts_include",
			"node_modules",
			"@rbxts",
			"react",
			"src",
		]);
	});

	it("should resolve a deep package import to its module file", () => {
		expect.assertions(1);

		const program = mockProgram({
			configFilePath: "/project/tsconfig.json",
			outDir: "/project/out",
		});
		const deps: Dependencies = {
			PathTranslator: mockPathTranslator(fakeImportPath),
			RojoResolver: {
				findRojoConfigFilePath: () => ({ path: "/project/default.project.json" }),
				fromPath: () => ({ getRbxPathFromFilePath: fakeNodeModulesRbxPath }),
			},
		};

		const resolver = createPackageResolver(program, {
			loadDependencies: () => deps,
			readPackageJson: packageJsonReader("/project/node_modules/@rbxts/react", {
				main: "src/init.lua",
				types: "src/index.d.ts",
			}),
			resolveModule: () => "/project/node_modules/@rbxts/react/src/prop-types.d.ts",
		});
		const result = resolver?.resolveToRbxPath(
			"@rbxts/react/src/prop-types",
			"/project/src/test.ts",
		);

		expect(result).toStrictEqual([
			"ReplicatedStorage",
			"rbxts_include",
			"node_modules",
			"@rbxts",
			"react",
			"src",
			"prop-types",
		]);
	});

	it("should use rbxts.rojo from tsconfig when present", () => {
		expect.assertions(1);

		const program = mockProgram({
			configFilePath: "/project/tsconfig.spec.json",
			outDir: "/project/out-test",
		});
		let fromPathArgument: string | undefined;
		const deps: Dependencies = {
			PathTranslator: function PathTranslator() {
				return { getOutputPath: (filePath: string) => filePath };
			} as unknown as Dependencies["PathTranslator"],
			RojoResolver: {
				findRojoConfigFilePath: () => ({ path: "/project/default.project.json" }),
				fromPath: (rojoPath: string) => {
					fromPathArgument = rojoPath;
					return { getRbxPathFromFilePath: () => {} };
				},
			},
		};

		createPackageResolver(program, {
			loadDependencies: () => deps,
			readTsConfig: (configPath: string) => {
				return configPath === "/project/tsconfig.spec.json"
					? { rbxts: { rojo: "./spec.project.json" } }
					: undefined;
			},
		});

		expect(fromPathArgument).toBe(path.resolve("/project", "./spec.project.json"));
	});

	it("should fall back to findRojoConfigFilePath when rbxts.rojo is absent", () => {
		expect.assertions(1);

		const program = mockProgram({
			configFilePath: "/project/tsconfig.json",
			outDir: "/project/out",
		});
		let fromPathArgument: string | undefined;
		const deps: Dependencies = {
			PathTranslator: function PathTranslator() {
				return { getImportPath: (filePath: string) => filePath };
			} as unknown as Dependencies["PathTranslator"],
			RojoResolver: {
				findRojoConfigFilePath: () => ({ path: "/project/default.project.json" }),
				fromPath: (rojoPath: string) => {
					fromPathArgument = rojoPath;
					return { getRbxPathFromFilePath: () => {} };
				},
			},
		};

		createPackageResolver(program, {
			loadDependencies: () => deps,
			readTsConfig: () => {},
		});

		expect(fromPathArgument).toBe("/project/default.project.json");
	});

	it("should use referenced project's translator when it owns the file", () => {
		expect.assertions(2);

		const libraryRootDirectory = "/project/src";
		const libraryOutDirectory = "/project/out";
		const sourceFile = "/project/src/server/add-item-stack.ts";

		const program = mockProgram(
			{
				configFilePath: "/project/tsconfig.spec.json",
				outDir: "/project/out-test",
			},
			[
				{
					commandLine: {
						fileNames: [sourceFile],
						options: { outDir: libraryOutDirectory, rootDir: libraryRootDirectory },
					},
				},
			],
		);

		const constructorCalls: Array<{
			outDirectory: string;
			rootDirectory: string;
		}> = [];
		const deps: Dependencies = {
			PathTranslator: function PathTranslator(rootDirectory: string, outDirectory: string) {
				constructorCalls.push({ outDirectory, rootDirectory });
				return {
					getImportPath: (filePath: string) => {
						return path
							.join(outDirectory, path.relative(rootDirectory, filePath))
							.replace(/\\/g, "/");
					},
				};
			} as unknown as Dependencies["PathTranslator"],
			RojoResolver: {
				findRojoConfigFilePath: () => ({ path: "/project/default.project.json" }),
				fromPath: () => {
					return {
						getRbxPathFromFilePath: (filePath: string) => {
							return filePath === "/project/out/server/add-item-stack.ts"
								? ["ServerScriptService", "server", "add-item-stack"]
								: undefined;
						},
					};
				},
			},
		};

		const resolver = createPackageResolver(program, {
			loadDependencies: () => deps,
			resolveModule: () => sourceFile,
		});
		const result = resolver?.resolveToRbxPath(
			"./add-item-stack",
			"/project/src/server/some.spec.ts",
		);

		expect(constructorCalls).toContainEqual({
			outDirectory: libraryOutDirectory,
			rootDirectory: libraryRootDirectory,
		});
		expect(result).toStrictEqual(["ServerScriptService", "server", "add-item-stack"]);
	});

	it("should fall back to current translator when no reference owns the file", () => {
		expect.assertions(1);

		const program = mockProgram(
			{
				configFilePath: "/project/tsconfig.spec.json",
				outDir: "/project/out-test",
				rootDir: "/project",
			},
			[
				{
					commandLine: {
						fileNames: ["/project/src/other.ts"],
						options: { outDir: "/project/out", rootDir: "/project/src" },
					},
				},
			],
		);

		const deps: Dependencies = {
			PathTranslator: function PathTranslator(rootDirectory: string, outDirectory: string) {
				return {
					getImportPath: (filePath: string) => {
						return path
							.join(outDirectory, path.relative(rootDirectory, filePath))
							.replace(/\\/g, "/");
					},
				};
			} as unknown as Dependencies["PathTranslator"],
			RojoResolver: {
				findRojoConfigFilePath: () => ({ path: "/project/default.project.json" }),
				fromPath: () => {
					return {
						getRbxPathFromFilePath: (filePath: string) => {
							return filePath === "/project/out-test/test/helper.ts"
								? ["ReplicatedStorage", "integration-tests", "helper"]
								: undefined;
						},
					};
				},
			},
		};

		const resolver = createPackageResolver(program, {
			loadDependencies: () => deps,
			resolveModule: () => "/project/test/helper.ts",
		});
		const result = resolver?.resolveToRbxPath(
			"#test/helper",
			"/project/src/server/some.spec.ts",
		);

		expect(result).toStrictEqual(["ReplicatedStorage", "integration-tests", "helper"]);
	});

	it("should bypass outDir translation for node_modules paths", () => {
		expect.assertions(2);

		const program = mockProgram({
			configFilePath: "/project/tsconfig.spec.json",
			outDir: "/project/out-test",
		});
		let nodeModuleFlag: boolean | undefined;
		const deps: Dependencies = {
			PathTranslator: function PathTranslator() {
				return {
					getImportPath: (filePath: string, isNodeModule = false) => {
						nodeModuleFlag = isNodeModule;
						return filePath;
					},
				};
			} as unknown as Dependencies["PathTranslator"],
			RojoResolver: {
				findRojoConfigFilePath: () => ({ path: "/project/default.project.json" }),
				fromPath: () => {
					return {
						getRbxPathFromFilePath: (filePath: string) => {
							return filePath === "/project/node_modules/@rbxts/services/index.d.ts"
								? [
										"ReplicatedStorage",
										"rbxts_include",
										"node_modules",
										"@rbxts",
										"services",
									]
								: undefined;
						},
					};
				},
			},
		};

		const resolver = createPackageResolver(program, {
			loadDependencies: () => deps,
			resolveModule: () => "/project/node_modules/@rbxts/services/index.d.ts",
		});
		const result = resolver?.resolveToRbxPath("@rbxts/services", "/project/src/test.ts");

		expect(nodeModuleFlag).toBe(true);
		expect(result).toStrictEqual([
			"ReplicatedStorage",
			"rbxts_include",
			"node_modules",
			"@rbxts",
			"services",
		]);
	});

	it("should apply outDir translation for project-local paths", () => {
		expect.assertions(2);

		const program = mockProgram({
			configFilePath: "/project/tsconfig.json",
			outDir: "/project/out",
		});
		let translatedFrom: string | undefined;
		const deps: Dependencies = {
			PathTranslator: function PathTranslator() {
				return {
					getImportPath: (filePath: string) => {
						translatedFrom = filePath;
						return "/project/out/shared/foo.luau";
					},
				};
			} as unknown as Dependencies["PathTranslator"],
			RojoResolver: {
				findRojoConfigFilePath: () => ({ path: "/project/default.project.json" }),
				fromPath: () => {
					return {
						getRbxPathFromFilePath: (filePath: string) => {
							return filePath === "/project/out/shared/foo.luau"
								? ["ReplicatedStorage", "shared", "foo"]
								: undefined;
						},
					};
				},
			},
		};

		const resolver = createPackageResolver(program, {
			loadDependencies: () => deps,
			resolveModule: () => "/project/src/shared/foo.ts",
		});
		const result = resolver?.resolveToRbxPath("@shared/foo", "/project/src/test.ts");

		expect(translatedFrom).toBe("/project/src/shared/foo.ts");
		expect(result).toStrictEqual(["ReplicatedStorage", "shared", "foo"]);
	});

	it("should resolve a project-local declaration file to its Luau module", () => {
		expect.assertions(1);

		const program = mockProgram({
			configFilePath: "/project/tsconfig.json",
			outDir: "/project/out",
		});
		const deps: Dependencies = {
			PathTranslator: mockPathTranslator(fakeImportPath),
			RojoResolver: {
				findRojoConfigFilePath: () => ({ path: "/project/default.project.json" }),
				fromPath: () => {
					return {
						getRbxPathFromFilePath: (filePath: string) => {
							return filePath === "/project/src/shared/legacy.lua"
								? ["ReplicatedStorage", "shared", "legacy"]
								: undefined;
						},
					};
				},
			},
		};

		const resolver = createPackageResolver(program, {
			loadDependencies: () => deps,
			resolveModule: () => "/project/src/shared/legacy.d.ts",
		});
		const result = resolver?.resolveToRbxPath("./legacy", "/project/src/shared/test.ts");

		expect(result).toStrictEqual(["ReplicatedStorage", "shared", "legacy"]);
	});
});

describe(findRojoConfig, () => {
	it("should return undefined when findRojoConfigFilePath throws", () => {
		expect.assertions(1);

		const resolver = {
			findRojoConfigFilePath: () => {
				throw new Error("ENOENT");
			},
			fromPath: () => ({ getRbxPathFromFilePath: () => {} }),
		};

		expect(findRojoConfig(resolver, "/nonexistent")).toBeUndefined();
	});

	it("should return path when config is found", () => {
		expect.assertions(1);

		const resolver = {
			findRojoConfigFilePath: () => ({ path: "/project/default.project.json" }),
			fromPath: () => ({ getRbxPathFromFilePath: () => {} }),
		};

		expect(findRojoConfig(resolver, "/project")).toBe("/project/default.project.json");
	});

	it("should return undefined when path is undefined", () => {
		expect.assertions(1);

		const resolver = {
			findRojoConfigFilePath: () => ({ path: undefined }),
			fromPath: () => ({ getRbxPathFromFilePath: () => {} }),
		};

		expect(findRojoConfig(resolver, "/project")).toBeUndefined();
	});
});
