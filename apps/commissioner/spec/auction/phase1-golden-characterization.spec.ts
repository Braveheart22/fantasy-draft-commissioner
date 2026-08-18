import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("frozen Phase 1 golden characterization", () => {
  it("executes and enumerates every approved Golden 1-31 scenario without copying or editing the root fixtures", () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/phase1/approved-golden-scenarios.json", import.meta.url)), "utf8")) as { scenarioIds: number[] };
    expect(manifest.scenarioIds).toEqual(Array.from({ length: 31 }, (_, index) => index + 1));
    const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
    const source = readFileSync(resolve(repositoryRoot, "test/golden.test.js"), "utf8");
    for (const id of manifest.scenarioIds) expect(source).toMatch(new RegExp(`Golden [0-9/]*${id}\\b`));
    const output = execFileSync(process.execPath, ["--test", "test/golden.test.js"], { cwd: repositoryRoot, encoding: "utf8" });
    expect(output).toMatch(/pass 28/);
    expect(output).toMatch(/fail 0/);
  });
});
