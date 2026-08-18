import { mkdir } from "node:fs/promises";
import { homedir, platform as currentPlatform } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";

const LOOPBACK_HOST = "127.0.0.1";

export function resolveDataDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  platform = currentPlatform(),
  localAppData = environment.LOCALAPPDATA,
): string {
  if (environment.LEAGUE_DRAFT_DATA_DIR) return environment.LEAGUE_DRAFT_DATA_DIR;
  if (platform === "win32") return join(localAppData ?? join(homedir(), "AppData", "Local"), "LeagueDraft");
  return join(environment.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "league-draft");
}

export interface CommissionerServerOptions {
  port?: number;
  dataDirectory?: string;
}

export async function startCommissionerServer(options: CommissionerServerOptions = {}) {
  const dataDirectory = options.dataDirectory ?? resolveDataDirectory();
  await mkdir(dataDirectory, { recursive: true });
  const server = Fastify({ logger: false });
  server.get("/health", async () => ({ status: "ok", dataDirectory }));
  await server.listen({ host: LOOPBACK_HOST, port: options.port ?? 4173 });
  const address = server.server.address();
  if (!address || typeof address === "string") throw new Error("Commissioner server did not expose a TCP address");
  let stopped = false;
  return {
    address: { host: LOOPBACK_HOST, port: address.port },
    dataDirectory,
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      await server.close();
    },
  };
}
