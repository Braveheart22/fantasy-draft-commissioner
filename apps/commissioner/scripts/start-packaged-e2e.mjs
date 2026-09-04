import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const commissioner = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rehearsalRoot = await mkdtemp(join(tmpdir(), "commissioner-package-e2e-"));
const packageDirectory = join(rehearsalRoot, "package");
const dataDirectory = join(rehearsalRoot, "data");

async function run(command, args) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolveRun() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

await run(process.execPath, [join(commissioner, "scripts", "package-local.mjs"), packageDirectory]);

const packagedNode = join(packageDirectory, "node.exe");
const packageMain = join(packageDirectory, "apps", "commissioner", "dist", "src", "server", "package-main.js");
const offlineGuard = join(commissioner, "scripts", "offline-network-guard.mjs");
const applicationPort = Number(process.env.LEAGUE_DRAFT_PORT ?? 4193);
const controlPort = Number(process.env.COMMISSIONER_PRODUCTION_E2E_CONTROL_PORT ?? 5193);
let restarting = false;
let server = startServer();

function startServer() {
  const child = spawn(packagedNode, ["--import", pathToFileURL(offlineGuard).href, packageMain], {
    env: { ...process.env, LEAGUE_DRAFT_DATA_DIR: dataDirectory, LEAGUE_DRAFT_NO_BROWSER: "1" },
    stdio: "inherit",
  });
  child.once("error", error => { if (!restarting) void fail(error); });
  child.once("exit", code => { if (!stopping && !restarting) void fail(new Error(`Packaged server exited with code ${code}`)); });
  return child;
}

async function waitForHealth() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${applicationPort}/health`)).ok) return; } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error("Restarted packaged server did not become healthy");
}

async function restartServer() {
  restarting = true;
  server.kill("SIGTERM");
  await new Promise(resolveExit => server.once("exit", resolveExit));
  server = startServer();
  await waitForHealth();
  restarting = false;
}

const control = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/restart") { response.writeHead(404).end(); return; }
  void restartServer().then(() => response.writeHead(204).end(), error => { console.error(error); response.writeHead(500).end(); });
});
control.listen(controlPort, "127.0.0.1");

let stopping = false;
async function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  await new Promise(resolveClose => control.close(resolveClose));
  if (server.exitCode === null) server.kill(signal);
  await new Promise(resolveExit => server.exitCode === null ? server.once("exit", resolveExit) : resolveExit());
  await rm(rehearsalRoot, { recursive: true, force: true });
}

async function fail(error) {
  console.error(error);
  await stop();
  process.exit(1);
}
process.once("SIGINT", () => { void stop("SIGINT").then(() => process.exit(0)); });
process.once("SIGTERM", () => { void stop("SIGTERM").then(() => process.exit(0)); });
