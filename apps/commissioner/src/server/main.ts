import { startCommissionerServer } from "./startup.js";

const configuredPort = Number.parseInt(process.env.LEAGUE_DRAFT_PORT ?? "4173", 10);
if (!Number.isSafeInteger(configuredPort) || configuredPort < 0 || configuredPort > 65_535) {
  throw new Error("LEAGUE_DRAFT_PORT must be an integer from 0 through 65535");
}

const application = await startCommissionerServer({ port: configuredPort });
console.log(`League Draft Commissioner listening at http://${application.address.host}:${application.address.port}`);
console.log(`Data directory: ${application.dataDirectory}`);

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await application.stop();
}

process.once("SIGINT", () => { void stop().then(() => process.exit(0)); });
process.once("SIGTERM", () => { void stop().then(() => process.exit(0)); });
