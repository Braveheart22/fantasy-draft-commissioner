import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const port = Number(process.env.COMMISSIONER_PRODUCTION_E2E_PORT ?? 4193);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  workers: 1,
  testDir: "e2e-production",
  testMatch: "*.e2e.mjs",
  use: { baseURL },
  webServer: {
    command: "node scripts/start-packaged-e2e.mjs",
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    env: { LEAGUE_DRAFT_PORT: String(port), COMMISSIONER_PRODUCTION_E2E_CONTROL_PORT: String(port + 1000), LEAGUE_DRAFT_DATA_DIR: join(tmpdir(), `commissioner-production-e2e-${process.pid}`) },
  },
});
