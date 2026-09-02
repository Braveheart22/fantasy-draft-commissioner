const makeKey = () => crypto.randomUUID();

export function createApiClient(fetcher = fetch) {
  let version;
  return {
    expectedVersion: () => version,
    activateVersion(nextVersion) { version = nextVersion; },
    async request(path, method = "GET", body) {
      const creating = path === "/api/setup/seasons";
      const response = await fetcher(path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          "idempotency-key": makeKey(),
          ...(!creating && method !== "GET" && version !== undefined ? { "x-expected-season-version": String(version) } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json();
      if (!response.ok) { const error = new Error(data.message ?? "Request failed"); error.code = data.code ?? "REQUEST_FAILED"; error.statusCode = response.status; throw error; }
      if (method !== "GET" && data?.season?.rowVersion !== undefined) version = data.season.rowVersion;
      else if (!creating && method !== "GET") {
        const parts = path.split("?")[0].split("/");
        const seasonId = parts[3];
        if (seasonId && seasonId !== "seasons" && seasonId !== "corrections") {
          try {
          const bootstrapResponse = await fetcher(`/api/bootstrap/${encodeURIComponent(seasonId)}`, { method: "GET", headers: { "idempotency-key": makeKey() } });
          const bootstrap = await bootstrapResponse.json();
          if (!bootstrapResponse.ok) throw new Error(bootstrap.message ?? "Season refresh failed");
          version = bootstrap.season.rowVersion;
          } catch (cause) {
            if (parts[2] === "draft" && (parts[4] === "picks" || parts[4] === "order")) {
              const message = parts[4] === "picks"
                ? "Pick saved, but the season refresh failed. Reload draft state before continuing."
                : "Draft order saved, but the season refresh failed. Reload draft order before continuing.";
              const error = new Error(message, { cause });
              error.code = "ACKNOWLEDGED_REFRESH_FAILED";
              error.acknowledgedResult = data;
              throw error;
            }
            throw cause;
          }
        }
      }
      return data;
    },
  };
}

export function createSeasonActivation(client, initialSnapshot = null) {
  let snapshot = initialSnapshot;
  let requestNumber = 0;
  if (initialSnapshot?.season?.rowVersion !== undefined) client.activateVersion(initialSnapshot.season.rowVersion);
  return {
    current: () => snapshot,
    async activate(seasonId) {
      const ownRequest = ++requestNumber;
      const candidate = await client.request(`/api/bootstrap/${encodeURIComponent(seasonId)}`);
      if (ownRequest === requestNumber) {
        snapshot = candidate;
        client.activateVersion(candidate.season.rowVersion);
        return candidate;
      }
      return null;
    },
  };
}
