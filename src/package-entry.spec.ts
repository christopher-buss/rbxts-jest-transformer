/* eslint-disable sonar/no-duplicate-string -- test assertion values */
import path from "node:path";
import { describe, expect, it } from "vitest";

import { defaultReadPackageJson, resolvePackageEntryPath } from "./package-entry.js";

const PACKAGE_DIRECTORY = path.resolve("/project/node_modules/@rbxts/jecs");
const PACKAGE_JSON_PATH = path.join(PACKAGE_DIRECTORY, "package.json");

function reader(packages: Readonly<Record<string, unknown>>) {
	return (packageJsonPath: string) => packages[packageJsonPath];
}

describe(defaultReadPackageJson, () => {
	it("should return the parsed manifest for an existing package", () => {
		expect.assertions(1);

		const result = defaultReadPackageJson(path.resolve("package.json"));

		expect(result).toMatchObject({ name: "rbxts-transformer-jest" });
	});

	it("should return undefined when the file cannot be read", () => {
		expect.assertions(1);

		const result = defaultReadPackageJson("/nonexistent/path/package.json");

		expect(result).toBeUndefined();
	});

	it("should return undefined when the file is not valid JSON", () => {
		expect.assertions(1);

		const result = defaultReadPackageJson(path.resolve("README.md"));

		expect(result).toBeUndefined();
	});
});

describe(resolvePackageEntryPath, () => {
	it("should map the typings entry to the main file", () => {
		expect.assertions(1);

		const result = resolvePackageEntryPath(
			path.join(PACKAGE_DIRECTORY, "src/jecs.d.ts"),
			reader({
				[PACKAGE_JSON_PATH]: { main: "src/jecs.luau", types: "src/jecs.d.ts" },
			}),
		);

		expect(result).toBe(path.join(PACKAGE_DIRECTORY, "src/jecs.luau"));
	});

	it("should read the typings entry from the typings field", () => {
		expect.assertions(1);

		const result = resolvePackageEntryPath(
			path.join(PACKAGE_DIRECTORY, "src/jecs.d.ts"),
			reader({
				[PACKAGE_JSON_PATH]: { main: "src/jecs.luau", typings: "src/jecs.d.ts" },
			}),
		);

		expect(result).toBe(path.join(PACKAGE_DIRECTORY, "src/jecs.luau"));
	});

	it("should default the typings entry to index.d.ts", () => {
		expect.assertions(1);

		const result = resolvePackageEntryPath(
			path.join(PACKAGE_DIRECTORY, "index.d.ts"),
			reader({ [PACKAGE_JSON_PATH]: { main: "init.lua" } }),
		);

		expect(result).toBe(path.join(PACKAGE_DIRECTORY, "init.lua"));
	});

	it("should return undefined for a file that is not the typings entry", () => {
		expect.assertions(1);

		const result = resolvePackageEntryPath(
			path.join(PACKAGE_DIRECTORY, "src/other.d.ts"),
			reader({
				[PACKAGE_JSON_PATH]: { main: "src/jecs.luau", types: "src/jecs.d.ts" },
			}),
		);

		expect(result).toBeUndefined();
	});

	it("should return undefined when the package declares no main", () => {
		expect.assertions(1);

		const result = resolvePackageEntryPath(
			path.join(PACKAGE_DIRECTORY, "src/jecs.d.ts"),
			reader({ [PACKAGE_JSON_PATH]: { types: "src/jecs.d.ts" } }),
		);

		expect(result).toBeUndefined();
	});

	it("should ignore non-string manifest fields", () => {
		expect.assertions(1);

		const result = resolvePackageEntryPath(
			path.join(PACKAGE_DIRECTORY, "index.d.ts"),
			reader({ [PACKAGE_JSON_PATH]: { main: 42, types: [] } }),
		);

		expect(result).toBeUndefined();
	});

	it("should ignore manifests that are not objects", () => {
		expect.assertions(1);

		const result = resolvePackageEntryPath(
			path.join(PACKAGE_DIRECTORY, "index.d.ts"),
			reader({ [PACKAGE_JSON_PATH]: "not-an-object" }),
		);

		expect(result).toBeUndefined();
	});

	it("should walk up nested directories to find the manifest", () => {
		expect.assertions(1);

		const result = resolvePackageEntryPath(
			path.join(PACKAGE_DIRECTORY, "out/types/index.d.ts"),
			reader({
				[PACKAGE_JSON_PATH]: { main: "out/init.lua", types: "out/types/index.d.ts" },
			}),
		);

		expect(result).toBe(path.join(PACKAGE_DIRECTORY, "out/init.lua"));
	});

	it("should stop walking at the node_modules directory", () => {
		expect.assertions(2);

		const readPaths: Array<string> = [];
		const result = resolvePackageEntryPath(
			path.resolve("/project/node_modules/orphan.d.ts"),
			(packageJsonPath: string) => {
				readPaths.push(packageJsonPath);
			},
		);

		expect(result).toBeUndefined();
		expect(readPaths).toStrictEqual([]);
	});

	it("should stop walking at the file system root", () => {
		expect.assertions(1);

		const result = resolvePackageEntryPath(path.resolve("/orphan.d.ts"), () => {});

		expect(result).toBeUndefined();
	});
});
