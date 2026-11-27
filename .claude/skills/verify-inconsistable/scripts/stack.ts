// A disposable InconsisTable stack for verification, run through Aspire on Podman: Postgres 18 in a container with no
// data volume, the Go api, and `next dev`, on ports of its own beside the developer's dev stack, then the sample seed.
//
//   bun .claude/skills/verify-inconsistable/scripts/stack.ts up       start, migrate, seed; prints the run id
//   bun .claude/skills/verify-inconsistable/scripts/stack.ts doctor   read-only health of the current run
//   bun .claude/skills/verify-inconsistable/scripts/stack.ts state "<room name>"   the sample GM's socket state as JSON
//   bun .claude/skills/verify-inconsistable/scripts/stack.ts down     stop the AppHost and its container
//
// Run state and evidence live in `.verify/<run id>/`; `down` keeps `evidence/`.
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../../..");
const APPHOST = path.join(ROOT, "aspire-apphost/apphost.mts");
const VERIFY = path.join(ROOT, ".verify");
const CURRENT = path.join(VERIFY, "current.json");
const PORTS = {
  postgres: Number(process.env.VERIFY_PG_PORT ?? 5445),
  api: Number(process.env.VERIFY_API_PORT ?? 4013),
  web: Number(process.env.VERIFY_WEB_PORT ?? 3013),
};

type Run = { runId: string; dir: string; apiUrl: string; webUrl: string; adminKey: string; gitRev: string };

const requireSmoke = createRequire(path.join(ROOT, "apps/smoke/package.json"));

const gitRev = () => spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();

// The HTTP status of a GET, or 0 when nothing answers.
const status = (url: string) =>
  fetch(url).then(
    (r) => r.status,
    () => 0,
  );

function aspire(args: string[], env: Record<string, string> = {}, log?: string): SpawnSyncReturns<string> {
  const out = spawnSync("aspire", [...args, "--apphost", APPHOST, "--non-interactive", "--nologo"], {
    cwd: ROOT,
    env: { ...process.env, ASPIRE_CONTAINER_RUNTIME: "podman", ...env },
    encoding: "utf8",
    timeout: 600_000,
  });
  if (log) writeFileSync(log, `$ aspire ${args.join(" ")}\n${out.stdout}${out.stderr}\n`, { flag: "a" });
  return out;
}

// The AppHosts the Aspire CLI sees running from this repo's AppHost file.
function runningAppHosts(): unknown[] {
  const out = spawnSync("aspire", ["ps", "--format", "Json", "--non-interactive", "--nologo"], { encoding: "utf8" });
  const text = out.stdout.trim();
  if (!text.startsWith("[")) return [];
  const all = JSON.parse(text) as Record<string, unknown>[];
  const mine = path.normalize(APPHOST).toLowerCase();
  return all.filter((a) => JSON.stringify(a).toLowerCase().replaceAll("\\\\", "\\").includes(mine));
}

function readRun(): Run {
  if (!existsSync(CURRENT)) throw new Error("no verification run: start one with `stack.ts up`");
  return JSON.parse(readFileSync(CURRENT, "utf8")) as Run;
}

async function waitFor(label: string, check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label} not ready after ${timeoutMs / 1000}s`);
}

async function up(): Promise<void> {
  if (existsSync(CURRENT)) throw new Error(`run ${readRun().runId} is still recorded: run \`stack.ts down\` first`);
  // `aspire stop --apphost` cannot pick one of two instances of the same AppHost, so never start beside the dev one.
  if (runningAppHosts().length)
    throw new Error("an Aspire AppHost from this repo is already running (aspire ps); refusing to start a second one");
  for (const [name, port] of Object.entries(PORTS))
    if ((await status(`http://localhost:${port}/`)) !== 0)
      throw new Error(`port ${port} (${name}) already answers, not started by this run; refusing to share it`);
  const podman = spawnSync("podman", ["info", "--format", "{{.Host.RemoteSocket.Exists}}"], { encoding: "utf8" });
  if (podman.status !== 0)
    throw new Error(`podman is not reachable (start the machine: podman machine start)\n${podman.stderr}`);

  const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const dir = path.join(VERIFY, runId);
  mkdirSync(path.join(dir, "evidence"), { recursive: true });
  const run: Run = {
    runId,
    dir,
    apiUrl: `http://localhost:${PORTS.api}`,
    webUrl: `http://localhost:${PORTS.web}`,
    adminKey: randomBytes(32).toString("hex"),
    gitRev: gitRev(),
  };
  writeFileSync(CURRENT, JSON.stringify(run, null, 2));

  const log = path.join(dir, "aspire.log");
  const start = aspire(
    ["start", "--isolated"],
    {
      IT_PG_PORT: String(PORTS.postgres),
      IT_API_PORT: String(PORTS.api),
      IT_WEB_PORT: String(PORTS.web),
      IT_EPHEMERAL: "1",
      ADMIN_KEY: run.adminKey,
    },
    log,
  );
  if (start.status !== 0) throw new Error(`aspire start failed; see ${log}`);
  console.log("aspire AppHost started (isolated, podman)");

  for (const resource of ["postgres", "api", "web"]) {
    const wait = aspire(["wait", resource, "--status", "up", "--timeout", "300"], {}, log);
    if (wait.status !== 0) throw new Error(`${resource} never came up; see ${log}`);
  }
  // up is not usable: the api answers health only after migrations, the web only once a page compiles through its proxy
  await waitFor("api", async () => (await status(`${run.apiUrl}/api/health`)) === 200, 300_000);
  console.log(`api up at ${run.apiUrl}, migrations applied`);

  const seed = spawnSync("bun", ["apps/smoke/scripts/seed.ts"], {
    cwd: ROOT,
    env: { ...process.env, API_URL: run.apiUrl },
    encoding: "utf8",
  });
  writeFileSync(path.join(dir, "seed.log"), seed.stdout + seed.stderr);
  if (seed.status !== 0) throw new Error(`seed failed:\n${seed.stdout}${seed.stderr}`);
  console.log("seeded");

  const webReady = async () => (await status(`${run.webUrl}/api/health`)) === 200 && (await status(run.webUrl)) === 200;
  // Up for 30 s straight, not just once: the exit below comes right after the first page renders.
  const webStays = async () => {
    for (let i = 0; i < 30; i++) {
      if (!(await webReady())) return false;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return true;
  };
  await waitFor("web", webReady, 300_000);
  if (!(await webStays())) {
    // `experimental.agentUpgrade` in next.config.ts makes the first `next dev` under an agent print a notice and exit;
    // the second start keeps running. Restart once, never more.
    console.log("next dev exited after its first page, starting the web resource once more");
    if (aspire(["resource", "web", "start"], {}, log).status !== 0) throw new Error(`web restart failed; see ${log}`);
    await waitFor("web", webReady, 300_000);
    if (!(await webStays())) throw new Error("next dev exited twice; see `aspire logs web`");
  }
  console.log(`web up at ${run.webUrl}`);
  console.log(`run ${runId}: evidence goes in ${path.join(dir, "evidence")}`);
}

async function doctor(): Promise<boolean> {
  const run = readRun();
  const checks: [string, boolean, string][] = [];
  const hosts = runningAppHosts();
  checks.push(["apphost running", hosts.length === 1, `${hosts.length} AppHost(s) from this repo in aspire ps`]);
  const described = aspire(["describe", "--format", "Json"]);
  for (const resource of ["postgres", "api", "web"]) {
    const ok =
      described.status === 0 &&
      new RegExp(`"name"\\s*:\\s*"${resource}[^"]*"[\\s\\S]{0,400}?"state"\\s*:\\s*"Running"`, "i").test(
        described.stdout,
      );
    checks.push([`${resource} resource`, ok, ok ? "Running" : "not Running in aspire describe"]);
  }
  const apiHealth = await status(`${run.apiUrl}/api/health`);
  checks.push(["api health", apiHealth === 200, `GET ${run.apiUrl}/api/health ${apiHealth}`]);
  const webHealth = await status(`${run.webUrl}/api/health`);
  checks.push(["web proxy", webHealth === 200, `GET ${run.webUrl}/api/health ${webHealth} (web → this run's api)`]);
  const rev = gitRev();
  checks.push(["build", rev === run.gitRev, `run started at ${run.gitRev}, HEAD is ${rev}`]);
  for (const [name, ok, detail] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  console.log(`run ${run.runId}, evidence ${path.join(run.dir, "evidence")}`);
  return checks.every(([, ok]) => ok);
}

async function state(roomName: string): Promise<void> {
  const run = readRun();
  const { io } = requireSmoke("socket.io-client") as typeof import("socket.io-client");
  const cookie = `it_device=${readFileSync(path.join(ROOT, ".seed-device"), "utf8").trim()}`;
  const lobby = (await (await fetch(`${run.apiUrl}/api/lobby`, { headers: { cookie } })).json()) as Record<
    string,
    unknown
  >;
  const rooms = ["mine", "seated", "archived"].flatMap((k) => (lobby[k] ?? []) as { id: string; name: string }[]);
  const room = rooms.find((r) => r.name === roomName);
  if (!room)
    throw new Error(`the sample GM has no room named "${roomName}" (has: ${rooms.map((r) => r.name).join(", ")})`);
  const socket = io(run.apiUrl, {
    auth: { campaignId: room.id },
    extraHeaders: { cookie },
    transports: ["websocket"],
    reconnection: false,
  });
  const snapshot = await new Promise((resolve, reject) => {
    socket.once("state", resolve);
    socket.once("connect_error", reject);
  });
  socket.close();
  console.log(JSON.stringify(snapshot, null, 2));
}

async function down(): Promise<void> {
  const run = readRun();
  const log = path.join(run.dir, "aspire.log");
  if (runningAppHosts().length) {
    const stop = aspire(["stop"], {}, log);
    if (stop.status !== 0) throw new Error(`aspire stop failed; see ${log}`);
  }
  await waitFor(
    "ports to close",
    async () => (await status(run.apiUrl)) === 0 && (await status(run.webUrl)) === 0,
    60_000,
  );
  rmSync(CURRENT);
  console.log(`run ${run.runId} down; evidence kept in ${path.join(run.dir, "evidence")}`);
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === "up") {
    const before = existsSync(CURRENT);
    await up().catch(async (err: unknown) => {
      // a half-started run is torn down at once, so a failed launch never strands an AppHost, port or container
      if (!before && existsSync(CURRENT)) await down().catch(() => {});
      throw err;
    });
  } else if (command === "doctor") process.exit((await doctor()) ? 0 : 1);
  else if (command === "state" && arg) await state(arg);
  else if (command === "down") await down();
  else {
    console.error('usage: stack.ts up | doctor | state "<room name>" | down');
    process.exit(2);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
