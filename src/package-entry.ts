import fs from "node:fs";
import path from "node:path";

export type PackageJsonReader = (packageJsonPath: string) => unknown;

export function defaultReadPackageJson(packageJsonPath: string): unknown {
	let text: string;
	try {
		text = fs.readFileSync(packageJsonPath, "utf8");
	} catch {
		return undefined;
	}

	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * Maps a package's typings file to the runtime file its `main` field points at,
 * mirroring how roblox-ts builds `nodeModulesPathMapping`.
 *
 * Without this mapping a package whose entry point is not `index`/`init`
 * resolves to the folder that holds the entry point instead of the
 * `ModuleScript` the emitted `TS.import` requires.
 *
 * @param typingsFilePath - The declaration file a module specifier resolved to.
 * @param readPackageJson - Reads and parses a `package.json` file.
 * @returns The absolute path of the runtime entry file, or `undefined` when the
 *   file is not the package's typings entry.
 */
export function resolvePackageEntryPath(
	typingsFilePath: string,
	readPackageJson: PackageJsonReader,
): string | undefined {
	const filePath = path.resolve(typingsFilePath);
	const manifest = findPackageManifest(path.dirname(filePath), readPackageJson);
	if (manifest === undefined) {
		return undefined;
	}

	const { directory, json } = manifest;
	const main = readStringField(json, "main");
	if (main === undefined) {
		return undefined;
	}

	const typings = readStringField(json, "types", "typings") ?? DEFAULT_TYPINGS;
	if (path.resolve(directory, typings) !== filePath) {
		return undefined;
	}

	return path.resolve(directory, main);
}

const DEFAULT_TYPINGS = "index.d.ts";
const NODE_MODULES = "node_modules";
const PACKAGE_JSON = "package.json";

interface PackageManifest {
	readonly directory: string;
	readonly json: Record<string, unknown>;
}

function findPackageManifest(
	fromDirectory: string,
	readPackageJson: PackageJsonReader,
): PackageManifest | undefined {
	let current = fromDirectory;
	while (path.basename(current) !== NODE_MODULES) {
		const json = readPackageJson(path.join(current, PACKAGE_JSON));
		if (isObjectRecord(json)) {
			return { directory: current, json };
		}

		const parent = path.dirname(current);
		if (parent === current) {
			return undefined;
		}

		current = parent;
	}

	return undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readStringField(
	json: Record<string, unknown>,
	...keys: ReadonlyArray<string>
): string | undefined {
	for (const key of keys) {
		const value = json[key];
		if (typeof value === "string") {
			return value;
		}
	}

	return undefined;
}
