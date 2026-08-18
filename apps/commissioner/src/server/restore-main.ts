import { resolve } from "node:path";
import { BackupCoordinator } from "../infrastructure/files/backup-coordinator.js";

const [databaseArgument, manifestArgument] = process.argv.slice(2);
if (!databaseArgument || !manifestArgument) {
  console.error("Usage: npm run commissioner:restore -- <database-path> <manifest-path>");
  process.exitCode = 2;
} else {
  const databasePath = resolve(databaseArgument);
  const manifestPath = resolve(manifestArgument);
  try {
    const receipt = await new BackupCoordinator(databasePath).restore(manifestPath);
    console.log(JSON.stringify({ status: "restored", databasePath, ...receipt }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
