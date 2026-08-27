import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const port = Number(process.env.COMMISSIONER_E2E_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  workers: 1,
  testDir: "e2e",
  testMatch: "*.e2e.mjs",
  use: { baseURL },
  webServer: {
    command: "node dist/src/server/main.js",
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    env: { LEAGUE_DRAFT_PORT: String(port), LEAGUE_DRAFT_DATA_DIR: join(tmpdir(), `commissioner-e2e-${process.pid}`) },
  },
});
