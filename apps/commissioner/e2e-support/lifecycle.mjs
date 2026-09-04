import { expect } from "@playwright/test";

const positions = ["QB", "QB", "RB", "RB", "RB", "WR", "WR", "WR", "TE", "TE", "K", "K", "DST", "DST"];

export function transport(request, prefix) {
  let serial = 0;
  let version;
  return async (method, path, data) => {
    const response = await request.fetch(path, {
      method,
      headers: {
        ...(data === undefined ? {} : { "content-type": "application/json" }),
        "idempotency-key": `${prefix}-${++serial}`,
        ...(version === undefined ? {} : { "x-expected-season-version": String(version) }),
      },
      ...(data === undefined ? {} : { data }),
    });
    if (!response.ok()) throw new Error(`${method} ${path}: ${await response.text()}`);
    const result = await response.json();
    if (result?.season?.rowVersion !== undefined) version = result.season.rowVersion;
    return result;
  };
}

export async function seedLockedSeason(request, seasonId, playerCount = 28, { playerPrefix = "Player", seasonName = "UI lifecycle" } = {}) {
  const send = transport(request, seasonId);
  await send("POST", "/api/setup/seasons", { seasonId, leagueId: `league-${seasonId}`, year: 2026, name: seasonName, teamCount: 2 });
  await send("GET", `/api/setup/${seasonId}`);
  await send("PUT", `/api/setup/${seasonId}/teams`, { teams: [{ id: "alpha", displayName: "Alpha", seedOrder: 1 }, { id: "beta", displayName: "Beta", seedOrder: 2 }] });
  for (let index = 0; index < playerCount; index++) {
    await send("POST", `/api/setup/${seasonId}/custom-players`, { id: `${seasonId}-p${index}`, name: `${playerPrefix} ${index}`, position: positions[index % positions.length] });
  }
  await send("PUT", `/api/setup/${seasonId}/pricing`, { floors: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 } });
  await send("POST", `/api/setup/${seasonId}/lock`, { rosterCapacity: 14 });
  return send;
}

export async function load(page, seasonId) {
  await page.goto("/");
  await page.getByLabel("Existing season ID").fill(seasonId);
  await page.getByRole("button", { name: "Load season" }).click();
  await expect(page.getByRole("status").first()).toHaveText("Saved");
}

export async function reloadSeason(page, seasonId) {
  await page.reload();
  await page.getByLabel("Existing season ID").fill(seasonId);
  await page.getByRole("button", { name: "Load season" }).click();
  await expect(page.getByRole("status").first()).toHaveText("Saved");
}

export async function act(page, button) {
  const commandPromise = page.waitForResponse(response => response.url().includes("/api/") && !["GET", "OPTIONS"].includes(response.request().method()));
  const hydrationPromise = page.waitForResponse(response => response.url().includes("/api/bootstrap/") && response.request().method() === "GET");
  await button.click();
  const command = await commandPromise;
  expect(command.ok(), `${command.request().method()} ${command.url()}: ${await command.text()}`).toBeTruthy();
  const hydration = await hydrationPromise;
  expect(hydration.ok(), `GET ${hydration.url()}: ${await hydration.text()}`).toBeTruthy();
}

export async function selectPlayer(page, label, name) {
  const finder = page.getByLabel(label, { exact: true });
  await page.getByLabel(`${label} search`).fill(name);
  await page.getByLabel(`${label} search`).press("Enter");
  await finder.getByRole("button", { name: new RegExp(`^${name} ·`) }).click();
}

export async function zeroBidRound(page, round) {
  await act(page, page.getByRole("button", { name: `Open round ${round}` }));
  await act(page, page.getByRole("button", { name: "Finalize zero bids", exact: true }));
  await page.getByRole("button", { name: / · DRAFT · 0 bid\(s\)$/, pressed: false }).click();
  await act(page, page.getByRole("button", { name: "Finalize zero bids", exact: true }));
  await act(page, page.getByRole("button", { name: `Lock, resolve & reveal round ${round}` }));
  await act(page, page.getByRole("button", { name: `Publish round ${round}` }));
}

export async function recordExternalTie(page, method = "Witnessed external draw") {
  await page.getByLabel(/^Precedence 1 at/).selectOption({ label: "Beta" });
  await page.getByLabel(/^Precedence 2 at/).selectOption({ label: "Alpha" });
  await page.getByLabel(/^Tie decision method at/).fill(method);
  await act(page, page.getByRole("button", { name: /Record external order tie/ }));
}
