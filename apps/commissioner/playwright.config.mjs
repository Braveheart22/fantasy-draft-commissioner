import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.mjs",
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "node dist/src/server/main.js",
    url: "http://127.0.0.1:4173/health",
    reuseExistingServer: false,
    env: { LEAGUE_DRAFT_DATA_DIR: join(tmpdir(), `commissioner-e2e-${process.pid}`) },
  },
});
