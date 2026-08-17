/**
 * Pins the namespace registration in FluidDynamicsConstants.ts to the file's
 * own exports.
 *
 * The register() call at the bottom of that file exposes every constant at
 * phet.fluidDynamics.FluidDynamicsConstants for console debugging, and it is
 * maintained by hand — so it silently falls behind. It had done exactly that:
 * eleven constants added with the obstacle shaping handles and the toolbox were
 * never registered, and nothing failed.
 *
 * Parsing the source rather than importing the module is deliberate. The
 * registered object is not reachable from the module's exports (register()
 * takes it and returns nothing), so the only way to compare the two lists is to
 * read them out of the text.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Resolved from the working directory rather than import.meta.url: the suite
// runs under happy-dom, where import.meta.url is not a file: URL and
// fileURLToPath() throws.
const SOURCE = readFileSync(resolve(process.cwd(), "src/FluidDynamicsConstants.ts"), "utf8");

/** Every `export const NAME` / `export function name` at the top level of the file. */
function exportedNames(source: string): string[] {
  return [...source.matchAll(/^export (?:const|function) ([A-Za-z_][A-Za-z0-9_]*)/gm)].map((match) => match[1] ?? "");
}

/** Every shorthand property inside the trailing register() call. */
function registeredNames(source: string): string[] {
  const start = source.indexOf('FluidDynamicsNamespace.register("FluidDynamicsConstants", {');
  expect(start, "the register() call should exist").toBeGreaterThan(-1);
  return [...source.slice(start).matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*),$/gm)].map((match) => match[1] ?? "");
}

describe("FluidDynamicsConstants namespace registration", () => {
  it("registers every exported constant", () => {
    const registered = new Set(registeredNames(SOURCE));
    const missing = exportedNames(SOURCE).filter((name) => !registered.has(name));
    expect(missing, `not registered: ${missing.join(", ")}`).toEqual([]);
  });

  it("registers nothing the file does not export", () => {
    const exported = new Set(exportedNames(SOURCE));
    const extra = registeredNames(SOURCE).filter((name) => !exported.has(name));
    expect(extra, `registered but not exported: ${extra.join(", ")}`).toEqual([]);
  });

  it("finds a plausible number of constants, so the parser cannot silently match nothing", () => {
    expect(exportedNames(SOURCE).length).toBeGreaterThan(50);
    expect(registeredNames(SOURCE).length).toBeGreaterThan(50);
  });
});
