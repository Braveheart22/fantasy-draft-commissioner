import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("commissioner stage UI control contract", () => {
  it("retains every accepted setup and lifecycle E2E control in the staged composition", async () => {
    const source = (await Promise.all([
      readFile(new URL("../../src/ui/setup/main.jsx", import.meta.url), "utf8"),
      readFile(new URL("../../src/ui/stages/keepers/keepers-panel.jsx", import.meta.url), "utf8"),
    ])).join("\n");
    for (const label of [
      "Create two-team season", "Existing season ID", "Load season",
      "Add teams", "Add Eddie Gallagher", "Import sample NFL players", "Set $1 floors",
      "<KeepersPanel", "Lock reviewed keepers",
      "Open round {roundNumber}", "Bid player", "Finalize zero bids for {team.displayName}",
      "Finalize bid for {team.displayName}", "Lock, resolve & reveal round {roundNumber}",
      "Record external tie winner", "Publish round {roundNumber}",
      "Calculate order from Round 2 balances", "Record external order tie", "Finalize permanent order",
      "Available player", "Commit legal pick",
    ]) expect(source).toContain(label);
    expect(source).toContain("<OperationsPanel");
    expect(source).toContain("<ExportsPanel");
  });
});
