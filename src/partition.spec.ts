import ts from "typescript";
import { describe, expect, it } from "vitest";

import transformer from "./index.js";
import { createMockProgram, transformCode } from "./test-helpers/transform.js";

describe("partition", () => {
	it("should hoist jest.mock above imports", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
jest.mock("./foo");
`;

		expect(transformCode(input)).toMatchSnapshot();
	});

	it("should hoist jest.unmock above imports", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
jest.unmock("./foo");
`;

		expect(transformCode(input)).toMatchSnapshot();
	});

	it("should hoist both mock and unmock", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
import { a } from "./a";
jest.mock("./a");
jest.unmock("./b");
`;

		expect(transformCode(input)).toMatchSnapshot();
	});

	it("should keep @rbxts/jest-globals import first", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
jest.mock("./foo");
`;

		expect(transformCode(input)).toMatchSnapshot();
	});

	it("should preserve factory functions in jest.mock", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
jest.mock("./foo", () => ({ default: 42 }));
`;

		expect(transformCode(input)).toMatchSnapshot();
	});

	// cspell:ignore dontMock
	it("should leave non-hoistable jest calls in place", () => {
		expect.assertions(1);

		const input = `
import { foo } from "./foo";
jest.dontMock("./foo");
`;

		expect(transformCode(input)).toMatchSnapshot();
	});

	it("should ignore non-jest objects", () => {
		expect.assertions(1);

		const input = `
import { foo } from "./foo";
other.mock("./foo");
`;

		expect(transformCode(input)).toMatchSnapshot();
	});

	it("should not hoist plain function calls", () => {
		expect.assertions(1);

		const input = `
import { foo } from "./foo";
foo("./bar");
`;

		expect(transformCode(input)).toMatchSnapshot();
	});

	it("should not hoist non-call expression statements", () => {
		expect.assertions(1);

		const input = `
import { foo } from "./foo";
x = 5;
`;

		expect(transformCode(input)).toMatchSnapshot();
	});

	it("should pass through unchanged when no jest calls", () => {
		expect.assertions(1);

		const input = `
import { foo } from "./foo";
console.log(foo);
`;

		expect(transformCode(input)).toMatchSnapshot();
	});

	it("should be idempotent when already hoisted", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
jest.mock("./foo");
import { foo } from "./foo";
`;

		expect(transformCode(input)).toMatchSnapshot();
	});

	describe("mock-prefix variable hoisting (REQ-006)", () => {
		it("should hoist single mock-prefix var referenced in factory", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const mockFoo = jest.fn();
jest.mock("./foo", () => ({ foo: mockFoo }));
`;

			const result = transformCode(input);

			expect(result).toMatchSnapshot();
		});

		it("should hoist multiple mock-prefix vars", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { a } from "./a";
const mockA = jest.fn();
const mockB = jest.fn();
jest.mock("./a", () => ({ a: mockA, b: mockB }));
`;

			const result = transformCode(input);

			expect(result).toMatchSnapshot();
		});

		it("should hoist array-destructured mock-prefix var referenced in factory", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const [mockFoo] = jest.fn();
jest.mock("./foo", () => ({ foo: mockFoo }));
`;

			const result = transformCode(input);

			expect(result).toMatch(/^import.*jest.*\nconst \[mockFoo\].*\njest\.mock/);
		});

		it("should hoist array-destructured var with omitted element", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const [, mockFoo] = jest.fn();
jest.mock("./foo", () => ({ foo: mockFoo }));
`;

			const result = transformCode(input);

			expect(result).toMatch(/^import.*jest.*\nconst \[, mockFoo\].*\njest\.mock/);
		});

		it("should not hoist array-destructured var with nested destructuring", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const [[mockFoo]] = jest.fn();
jest.mock("./foo", () => ({ foo: mockFoo }));
`;

			const result = transformCode(input);

			expect(result).toMatch(/import.*foo.*\nconst \[\[mockFoo\]\]/);
		});

		it("should not hoist empty array destructuring", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const [] = jest.fn();
jest.mock("./foo", () => ({}));
`;

			const result = transformCode(input);

			expect(result).toMatch(/import.*foo.*\nconst \[\]/);
		});

		it("should not hoist object-destructured mock-prefix var", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const { mockFoo } = jest.fn();
jest.mock("./foo", () => ({ foo: mockFoo }));
`;

			const result = transformCode(input);

			expect(result).toMatch(/import.*foo.*\nconst \{ mockFoo \}/);
		});

		it("should not hoist non-mock-prefix var", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const helper = jest.fn();
jest.mock("./foo", () => ({ foo: helper }));
`;

			expect(() => transformCode(input)).toThrowError("helper");
		});

		it("should not hoist let mock-prefix var", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
let mockFoo = jest.fn();
jest.mock("./foo", () => ({ foo: mockFoo }));
`;

			const result = transformCode(input);

			expect(result).toMatch(/import.*foo.*\nlet mockFoo/);
		});

		it("should not hoist mock-prefix var not referenced in factory", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const mockBar = jest.fn();
jest.mock("./foo", () => ({ foo: mockFoo }));
`;

			const result = transformCode(input);

			expect(result).toMatch(/import.*foo.*\nconst mockBar/);
		});

		it("should not hoist mock-prefix var when no factory exists", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const mockFoo = jest.fn();
jest.mock("./foo");
`;

			const result = transformCode(input);

			expect(result).toMatch(/import.*foo.*\nconst mockFoo/);
		});

		it("should hoist transitive mock-prefix var dependencies", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const mockNetwork = createMockNetwork();
const mockStartGame = mockNetwork.clientEvent("start");
jest.mock("./foo", () => ({ start: mockStartGame }));
`;

			const result = transformCode(input);

			// mockStartGame is in factory but depends on mockNetwork — both must
			// hoist in order
			expect(result).toMatch(
				/^import.*jest.*\nconst mockNetwork.*\nconst mockStartGame.*\njest\.mock/,
			);
		});
	});

	it("should hoist mock-prefix var used as first arg to jest.mock", () => {
		expect.assertions(1);

		const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const mockPath = "some-path";
jest.mock(mockPath, () => ({}));
`;

		const result = transformCode(input);

		expect(result).toMatch(/const mockPath.*\njest\.mock/);
	});

	describe("chained calls (REQ-008)", () => {
		it("should hoist chained unmock calls", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { a } from "./a";
jest.unmock("./a").unmock("./b");
`;

			const result = transformCode(input);

			expect(result).toMatch(/^import.*jest.*\njest\.unmock.*\.unmock/);
		});

		it("should hoist chained mock+unmock", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { a } from "./a";
jest.mock("./a").unmock("./b");
`;

			const result = transformCode(input);

			expect(result).toMatch(/^import.*jest.*\njest\.mock.*\.unmock/);
		});

		it("should hoist 3-deep chained calls", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { a } from "./a";
jest.mock("./a").unmock("./b").mock("./c");
`;

			const result = transformCode(input);

			expect(result).toMatch(/^import.*jest.*\njest\.mock.*\.unmock.*\.mock/);
		});

		it("should not hoist chained calls on non-jest object", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { a } from "./a";
other.mock("./a").unmock("./b");
`;

			const result = transformCode(input);

			expect(result).toMatch(/import.*from "\.\/a";\nother\.mock/);
		});

		it("should validate factory in chained mock call", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
jest.mock("./foo", () => badRef).unmock("./bar");
`;

			expect(() => transformCode(input)).toThrowError("badRef");
		});

		it("should hoist mock-prefix var referenced in chained mock factory", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const mockFoo = jest.fn();
jest.mock("./foo", () => ({ foo: mockFoo })).unmock("./bar");
`;

			const result = transformCode(input);

			expect(result).toMatch(/^import.*jest.*\nconst mockFoo.*\njest\.mock/);
		});

		it("should hoist chained calls with namespace import", () => {
			expect.assertions(1);

			const input = `
import * as JG from "@rbxts/jest-globals";
import { a } from "./a";
JG.jest.mock("./a").unmock("./b");
`;

			const result = transformCode(input);

			expect(result).toMatch(/^import \* as JG.*\nJG\.jest\.mock.*\.unmock/);
		});
	});

	describe("dependency import hoisting", () => {
		it("should hoist import referenced in mock call first arg", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { SomeService } from "@rbxts/services";
import { foo } from "./foo";
jest.mock(SomeService.path, () => ({}));
`;

			const result = transformCode(input);

			// SomeService import should be between jest-globals and jest.mock
			expect(result).toMatch(
				/^import.*jest-globals.*\nimport.*SomeService.*\njest\.mock\(SomeService/,
			);
		});

		it("should hoist import referenced by hoisted mock-prefix var", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { SomeService } from "@rbxts/services";
import { foo } from "./foo";
const mockPath = SomeService.client.network;
jest.mock(mockPath, () => ({}));
`;

			const result = transformCode(input);

			// Order: jest-globals → SomeService import → mockPath var → jest.mock
			expect(result).toMatch(
				/^import.*jest-globals.*\nimport.*SomeService.*\nconst mockPath.*\njest\.mock\(mockPath/,
			);
		});

		it("should not hoist non-dependency imports", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { SomeService } from "@rbxts/services";
import { foo } from "./foo";
jest.mock(SomeService.path, () => ({}));
`;

			const result = transformCode(input);

			// foo import should be after jest.mock
			expect(result).toMatch(/jest\.mock.*\nimport.*foo/);
		});

		it("should hoist multiple dependency imports from different sources", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { ServiceA } from "@rbxts/service-a";
import { ServiceB } from "@rbxts/service-b";
import { foo } from "./foo";
jest.mock(ServiceA.path, () => ({}));
jest.mock(ServiceB.path, () => ({}));
`;

			const result = transformCode(input);

			// Both service imports before mock calls, foo after
			expect(result).toMatch(
				/^import.*jest-globals.*\nimport.*ServiceA.*\nimport.*ServiceB.*\njest\.mock/,
			);
		});

		it("should hoist namespace import referenced in mock call arg", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import * as Services from "@rbxts/services";
import { foo } from "./foo";
jest.mock(Services.SomeService.path, () => ({}));
`;

			const result = transformCode(input);

			expect(result).toMatch(/^import.*jest-globals.*\nimport \* as Services.*\njest\.mock/);
		});

		it("should hoist default import referenced in mock call arg", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import SomeService from "@rbxts/services";
import { foo } from "./foo";
jest.mock(SomeService.path, () => ({}));
`;

			const result = transformCode(input);

			expect(result).toMatch(/^import.*jest-globals.*\nimport SomeService.*\njest\.mock/);
		});

		it("should not hoist side-effect imports", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import "@rbxts/some-setup";
import { SomeService } from "@rbxts/services";
jest.mock(SomeService.path, () => ({}));
`;

			const result = transformCode(input);

			// side-effect import stays below, SomeService hoisted
			expect(result).toMatch(
				/^import.*jest-globals.*\nimport.*SomeService.*\njest\.mock.*\nimport "@rbxts\/some-setup"/,
			);
		});

		it("should not hoist default import that is not referenced", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import Unrelated from "@rbxts/unrelated";
import { SomeService } from "@rbxts/services";
jest.mock(SomeService.path, () => ({}));
`;

			const result = transformCode(input);

			// Unrelated stays below, SomeService hoisted
			expect(result).toMatch(/jest\.mock.*\nimport Unrelated/);
		});

		it("should allow and hoist import referenced in factory body", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { ReplicatedStorage } from "@rbxts/services";
import { foo } from "./foo";
jest.mock(ReplicatedStorage.client.network, () => {
    const actual = jest.requireActual(ReplicatedStorage.client.network);
    return { ...actual };
});
`;

			const result = transformCode(input);

			// ReplicatedStorage import hoisted above jest.mock, foo stays below
			expect(result).toMatch(
				/^import.*jest-globals.*\nimport.*ReplicatedStorage.*\njest\.mock/,
			);
		});

		it("should allow import in factory even when first arg is string", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { SomeService } from "@rbxts/services";
import { foo } from "./foo";
jest.mock("./foo", () => {
    return jest.requireActual(SomeService.path);
});
`;

			const result = transformCode(input);

			// SomeService import hoisted because it's referenced in factory
			expect(result).toMatch(/^import.*jest-globals.*\nimport.*SomeService.*\njest\.mock/);
		});

		it("should reject mocked module binding in factory with as-cast path", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
jest.mock("./foo" as unknown as ModuleScript, () => foo);
`;

			expect(() => transformCode(input)).toThrowError("foo");
		});

		it("should hoist React import when factory contains JSX", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import React from "@rbxts/react";
import { foo } from "./foo";
jest.mock("./foo", () => ({
  default: () => <textlabel Text="mock" />,
}));
`;

			expect(transformCode(input, "test.tsx")).toMatchSnapshot();
		});

		it("should hoist React import when hoisted variable contains JSX", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import React from "@rbxts/react";
import { foo } from "./foo";
const mockComponent = () => <textlabel Text="mock" />;
jest.mock("./foo", () => ({ default: mockComponent }));
`;

			expect(transformCode(input, "test.tsx")).toMatchSnapshot();
		});

		it("should hoist React import when factory contains JSX fragment", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import React from "@rbxts/react";
import { foo } from "./foo";
jest.mock("./foo", () => ({
  default: () => <></>,
}));
`;

			expect(transformCode(input, "test.tsx")).toMatchSnapshot();
		});

		it("should hoist custom jsxFactory import when factory contains JSX", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import h from "my-jsx-lib";
import { foo } from "./foo";
jest.mock("./foo", () => ({
  default: () => <textlabel Text="mock" />,
}));
`;

			const sourceFile = ts.createSourceFile("test.tsx", input, ts.ScriptTarget.ESNext, true);
			const program = createMockProgram({ jsxFactory: "h" });
			const result = ts.transform(sourceFile, [transformer(program)]);
			// eslint-disable-next-line unicorn/no-keyword-prefix -- TS API property name
			const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
			const output = printer.printFile(result.transformed[0]!);
			result.dispose();

			expect(output).toMatchSnapshot();
		});

		it("should not hoist imports when mock args have no import refs", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
jest.mock("./foo", () => ({}));
`;

			const result = transformCode(input);

			// foo import stays below jest.mock (string literal arg, no import
			// ref)
			expect(result).toMatch(/^import.*jest-globals.*\njest\.mock.*\nimport.*foo/);
		});
	});

	describe("mock-prefix class declaration hoisting", () => {
		it("should hoist mock-prefix class referenced in factory", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
class mockFoo {
    bar() { return 42; }
}
jest.mock("./foo", () => ({ foo: mockFoo }));
`;

			const result = transformCode(input);

			expect(result).toMatch(/^import.*jest.*\nclass mockFoo[\s\S]*?\}\njest\.mock/);
		});

		it("should not hoist mock-prefix class not referenced in factory", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
class mockBar {
    bar() { return 42; }
}
jest.mock("./foo", () => ({ foo: mockFoo }));
`;

			const result = transformCode(input);

			expect(result).toMatch(/import.*foo.*\nclass mockBar/);
		});

		it("should not hoist class without mock prefix", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
class MyHelper {
    bar() { return 42; }
}
jest.mock("./foo", () => ({ foo: MyHelper }));
`;

			expect(() => transformCode(input)).toThrowError("MyHelper");
		});

		it("should hoist mock-prefix class with transitive mock-prefix var dependency", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const mockError = jest.fn();
class mockLog {
    Error() { mockError(); }
}
jest.mock("./foo", () => ({ log: mockLog }));
`;

			const result = transformCode(input);

			expect(result).toMatch(
				/^import.*jest.*\nconst mockError.*\nclass mockLog[\s\S]*?\}\njest\.mock/,
			);
		});
	});

	describe("mock-prefix function declaration hoisting", () => {
		it("should hoist mock-prefix function referenced in factory", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
function mockFoo() { return 42; }
jest.mock("./foo", () => ({ foo: mockFoo }));
`;

			expect(transformCode(input)).toMatchSnapshot();
		});

		it("should not hoist mock-prefix function not referenced in factory", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
function mockBar() { return 42; }
jest.mock("./foo", () => ({ foo: mockFoo }));
`;

			expect(transformCode(input)).toMatchSnapshot();
		});

		it("should not hoist function without mock prefix", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
function MyHelper() { return 42; }
jest.mock("./foo", () => ({ foo: MyHelper }));
`;

			expect(() => transformCode(input)).toThrowError("MyHelper");
		});

		it("should hoist mock-prefix function with transitive mock-prefix var dependency", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const mockError = jest.fn();
function mockLog() { mockError(); }
jest.mock("./foo", () => ({ log: mockLog }));
`;

			expect(transformCode(input)).toMatchSnapshot();
		});

		it("should hoist mock-prefix function with case-insensitive prefix (MockFoo)", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
function MockFoo() { return 42; }
jest.mock("./foo", () => ({ default: MockFoo }));
`;

			expect(transformCode(input)).toMatchSnapshot();
		});
	});

	describe("block scope hoisting (REQ-007)", () => {
		it("should hoist jest.mock within if block body", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
if (true) {
  jest.mock("./foo");
  console.log("hello");
}
`;

			expect(transformCode(input)).toMatchSnapshot();
		});

		it("should hoist jest.mock within function body", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
function setup() {
  console.log("before");
  jest.mock("./foo");
}
`;

			expect(transformCode(input)).toMatchSnapshot();
		});

		it("should hoist jest.mock within arrow function body", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
const setup = () => {
  console.log("before");
  jest.mock("./foo");
};
`;

			expect(transformCode(input)).toMatchSnapshot();
		});

		it("should hoist jest.mock within try block", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
try {
  console.log("before");
  jest.mock("./foo");
} catch (e) {}
`;

			expect(transformCode(input)).toMatchSnapshot();
		});

		it("should hoist jest.mock within catch block", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
try {} catch (e) {
  console.log("before");
  jest.mock("./foo");
}
`;

			expect(transformCode(input)).toMatchSnapshot();
		});

		it("should hoist jest.mock in nested blocks", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
function outer() {
  if (true) {
    console.log("before");
    jest.mock("./foo");
  }
}
`;

			expect(transformCode(input)).toMatchSnapshot();
		});

		it("should not escape block scope to parent", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
console.log("top level");
if (true) {
  jest.mock("./foo");
}
`;

			const result = transformCode(input);

			// jest.mock should stay inside the if block, not escape to top level
			expect(result).toMatch(/console\.log\("top level"\);\nif \(true\) \{\n\s+jest\.mock/);
		});

		it("should hoist mock-prefix vars within block", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
function setup() {
  const mockFoo = jest.fn();
  console.log("between");
  jest.mock("./foo", () => ({ foo: mockFoo }));
}
`;

			expect(transformCode(input)).toMatchSnapshot();
		});

		it("should validate factory within block", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
function setup() {
  jest.mock("./foo", () => badRef);
}
`;

			expect(() => transformCode(input)).toThrowError("badRef");
		});

		it("should handle chained calls within block", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
function setup() {
  console.log("before");
  jest.mock("./a").unmock("./b");
}
`;

			expect(transformCode(input)).toMatchSnapshot();
		});

		it("should leave block unchanged when no hoistable calls", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
function setup() {
  console.log("hello");
  const x = 1;
}
`;

			expect(transformCode(input)).toMatchSnapshot();
		});

		it("should hoist in beforeEach callback", () => {
			expect.assertions(1);

			const input = `
import { jest, beforeEach } from "@rbxts/jest-globals";
beforeEach(() => {
  console.log("setup");
  jest.mock("./foo");
  jest.mock("./bar");
});
`;

			expect(transformCode(input)).toMatchSnapshot();
		});
	});

	describe("pure constant hoisting (REQ-009)", () => {
		it("should hoist pure constant referenced in factory", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const X = 42;
jest.mock("./foo", () => ({ value: X }));
`;

			const result = transformCode(input);

			expect(result).toMatch(/^import.*jest.*\nconst X = 42;\njest\.mock/);
		});

		it("should hoist pure constant used as call arg", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const PATH = "unresolved-path";
jest.mock(PATH);
`;

			const result = transformCode(input);

			expect(result).toMatch(/const PATH.*\njest\.mock\(PATH\)/);
		});

		it("should resolve a pure constant module path used as call arg", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const PATH = "./foo";
jest.mock(PATH);
`;

			const result = transformCode(input);

			expect(result).toMatch(/const PATH.*\njest\.mock\(script\.Parent\.foo\)/);
		});

		it("should not hoist const with impure init (throws)", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
const X = getValue();
jest.mock("./foo", () => X);
`;

			expect(() => transformCode(input)).toThrowError("X");
		});

		it("should not hoist let with pure value (throws)", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
let X = 42;
jest.mock("./foo", () => X);
`;

			expect(() => transformCode(input)).toThrowError("X");
		});

		it("should not hoist unreferenced pure constant", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const X = 42;
const Y = 99;
jest.mock("./foo", () => ({ value: X }));
`;

			const result = transformCode(input);

			// X hoisted, Y stays
			expect(result).toMatch(/const X = 42;\njest\.mock.*\nimport.*foo.*\nconst Y = 99;/);
		});

		it("should hoist multiple pure constants", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const A = 1;
const B = "hello";
jest.mock("./foo", () => ({ a: A, b: B }));
`;

			const result = transformCode(input);

			expect(result).toMatch(/^import.*jest.*\nconst A = 1;\nconst B = "hello";\njest\.mock/);
		});

		it("should hoist pure constant alongside mock-prefix var", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const X = 42;
const mockFn = jest.fn();
jest.mock("./foo", () => ({ value: X, fn: mockFn }));
`;

			const result = transformCode(input);

			expect(result).toMatch(/^import.*jest.*\nconst mockFn.*\nconst X = 42;\njest\.mock/);
		});

		it("should hoist pure constant in block scope", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
function setup() {
  const X = 42;
  console.log("between");
  jest.mock("./foo", () => ({ value: X }));
}
`;

			expect(transformCode(input)).toMatchSnapshot();
		});

		it("should not hoist multi-decl statement with mixed purity", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const A = 1, B = getValue();
jest.mock("./foo", () => ({ a: A }));
`;

			const result = transformCode(input);

			// A is in pureConstants so validation passes, but the statement
			// has B which is impure — statement not extracted
			expect(result).toMatch(/jest\.mock.*\nimport.*foo.*\nconst A = 1, B = getValue/);
		});

		it("should hoist complex pure inits (object, array, arrow fn)", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const OBJ = { a: 1, b: [2, 3] };
const ARR = [1, 2, 3];
const FN = () => 42;
jest.mock("./foo", () => ({ obj: OBJ, arr: ARR, fn: FN }));
`;

			const result = transformCode(input);

			expect(result).toMatch(
				/^import.*jest.*\nconst OBJ.*\nconst ARR.*\nconst FN.*\njest\.mock/,
			);
		});

		it("should hoist pure constant in chained factory", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const X = 42;
jest.mock("./foo", () => ({ value: X })).unmock("./bar");
`;

			const result = transformCode(input);

			expect(result).toMatch(/^import.*jest.*\nconst X = 42;\njest\.mock/);
		});

		it("should treat void 0 as pure constant", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const X = void 0;
jest.mock("./foo", () => ({ value: X }));
`;

			const result = transformCode(input);

			expect(result).toMatch(/^import.*jest.*\nconst X = void 0;\njest\.mock/);
		});

		it("should treat as-cast array as pure constant", () => {
			expect.assertions(1);

			const input = `
import { jest } from "@rbxts/jest-globals";
import { foo } from "./foo";
const X = [1] as const;
jest.mock("./foo", () => ({ value: X }));
`;

			const result = transformCode(input);

			expect(result).toMatch(/^import.*jest.*\nconst X = \[1\] as const;\njest\.mock/);
		});
	});
});
