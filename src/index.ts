/**
 * The server.
 *
 * Bun's router does the dispatching, so this file is the three things that
 * wrap every handler: the bearer check, the timer that feeds analytics, and
 * one place where a thrown HttpError becomes a response. Everything else lives
 * in the route modules.
 *
 * With no token configured yet it starts in setup mode instead: only /setup is
 * served, and pasting a valid token there switches the full engine on in the
 * same process.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { serve } from "bun";
import { version } from "../package.json";
import { checkToken, requireValidToken, startHeartbeat } from "./lib/access-registry";
import { config, saveToken, savedToken } from "./config";
import dashboard from "./dashboard.html";
import { record, trim } from "./lib/analytics";
import { errorResponse, json, unauthorized } from "./lib/http";
import { openapi } from "./lib/openapi";
import map from "./map.html";
import mobile from "./mobile.html";
import setup from "./setup.html";
import { routes } from "./routes";
import type { RouteDef, RouteRequest } from "./routes/types";

let token = savedToken();
const launched = process.env.CEDARSTALK_OPEN === "1";

/**
 * Constant-time comparison, because a bearer check that leaks its own answer
 * through timing is decoration.
 */
function authorised(request: Request): boolean {
  if (!token) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (given.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

function wrap(route: RouteDef) {
  return async (request: Request): Promise<Response> => {
    const started = performance.now();
    let status = 200;
    try {
      if (!route.open && !authorised(request)) throw unauthorized();
      const response = await route.handler(request as RouteRequest, new URL(request.url));
      status = response.status;
      return response;
    } catch (error) {
      const response = errorResponse(error);
      status = response.status;
      return response;
    } finally {
      record(route.path, status, Math.round((performance.now() - started) * 100) / 100);
    }
  };
}

const table: Record<string, Record<string, (request: Request) => Promise<Response>>> = {};
for (const route of routes) {
  table[route.path] ??= {};
  table[route.path]![route.method] = wrap(route);
}

const spec = openapi(routes, version);

// ---- first-run collection ------------------------------------------------

/** "catalog" | "campus" | "book" while running, "done" after, null if never started. */
let firstCollect: string | null = null;

/** The public sources need no login, so a fresh install fetches them right after setup. */
async function collectPublicSources(): Promise<void> {
  const logPath = join(dirname(config.databasePath), "first-collect.log");
  mkdirSync(dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath, { flags: "a" });
  for (const source of ["catalog", "campus", "book"]) {
    firstCollect = source;
    await new Promise<void>((done) => {
      const child = spawn(process.execPath, ["run", resolve("src/cli.ts"), "collect", source], {
        env: { ...process.env, CEDARSTALK_OPEN: "" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.pipe(log, { end: false });
      child.stderr.pipe(log, { end: false });
      child.on("exit", () => done());
      child.on("error", () => done());
    });
  }
  firstCollect = "done";
  log.end();
}

// ---- setup ---------------------------------------------------------------

let launchKey: { key: string; until: number } | null = null;
let origin = "";

/** Chrome or Edge can open a page as its own app window, with no tabs or address bar. */
function appBrowser(): { command: string; args: (url: string) => string[] } | null {
  const env = process.env;
  if (process.platform === "win32") {
    const exe = [
      `${env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
      `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ].find((p) => !p.startsWith("undefined") && existsSync(p));
    return exe ? { command: exe, args: (url) => [`--app=${url}`] } : null;
  }
  if (process.platform === "darwin") {
    const app = ["/Applications/Google Chrome.app", "/Applications/Microsoft Edge.app", "/Applications/Brave Browser.app"].find(
      (p) => existsSync(p),
    );
    return app ? { command: "open", args: (url) => ["-na", app, "--args", `--app=${url}`] } : null;
  }
  return null;
}

function openInBrowser(url: string): void {
  const opener =
    process.platform === "win32"
      ? spawn("cmd", ["/c", "start", "", url], { stdio: "ignore" })
      : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore" });
  opener.on("error", () => {});
}

/** First run: setup in the normal browser (where the extension gets loaded). After that: the app window. */
function openWindow(): void {
  if (!token) return openInBrowser(`${origin}/setup`);
  launchKey = { key: randomBytes(24).toString("hex"), until: Date.now() + 120_000 };
  const url = `${origin}/?key=${launchKey.key}`;
  const app = appBrowser();
  if (!app) return openInBrowser(url);
  const child = spawn(app.command, app.args(url), { stdio: "ignore", detached: true });
  child.on("error", () => openInBrowser(url));
  child.unref();
}

/** The packaged download keeps a top-level "Browser extension" copy; a clone only has extension/. */
const extensionFolder = existsSync(resolve("../Browser extension"))
  ? resolve("../Browser extension")
  : resolve("extension");

const setupRoutes = {
  "/setup": setup,
  "/setup/state": () =>
    json({ configured: Boolean(token), collecting: firstCollect, extensionFolder, installDir: resolve(".") }),
  // A second launch (the desktop shortcut while this is already running) asks
  // this copy to open a window rather than starting another one. JSON-only,
  // so a web page can't trigger it cross-origin without a CORS preflight.
  "/setup/open": {
    POST: (request: Request) => {
      if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "json only" }, 415);
      openWindow();
      return json({ ok: true });
    },
  },
  // The window opened by the launcher carries a one-time key, traded here for
  // the token so the dashboard is unlocked in whichever browser it opened in.
  "/setup/claim": {
    POST: async (request: Request) => {
      const body = (await request.json().catch(() => ({}))) as { key?: string };
      const valid = launchKey && token && body.key === launchKey.key && Date.now() < launchKey.until;
      launchKey = null;
      return valid ? json({ token }) : json({ error: "expired" }, 403);
    },
  },
  "/setup/token": {
    POST: async (request: Request): Promise<Response> => {
      if (token) return json({ error: "already set up" }, 409);
      const body = (await request.json().catch(() => ({}))) as { token?: string };
      const pasted = body.token?.trim() ?? "";
      if (!/^[0-9a-f]{32,128}$/i.test(pasted)) return json({ error: "that doesn't look like a token" }, 400);
      let result: { valid: boolean; reason?: string };
      try {
        result = await checkToken(pasted);
      } catch {
        return json({ error: "couldn't reach the registry -- check your internet and try again" }, 502);
      }
      if (!result.valid) return json({ error: `the registry says: ${result.reason ?? "not valid"}` }, 403);
      saveToken(pasted);
      token = pasted;
      server.reload(fullOptions as ServeOptions);
      startHeartbeat();
      collectPublicSources();
      return json({ ok: true });
    },
  },
};

const fullOptions = {
  routes: {
    ...table,
    ...setupRoutes,
    "/": dashboard,
    "/map": map,
    "/mobile": mobile,
    "/openapi.json": () => json(spec),
  },
  fetch: () => json({ error: "not found" }, 404),
  error: (error: Error) => errorResponse(error),
};

const setupOptions = {
  routes: {
    ...setupRoutes,
    "/": () => Response.redirect("/setup", 302),
  },
  fetch: () => Response.redirect("/setup", 302),
  error: (error: Error) => errorResponse(error),
};

// Every instance validates before it serves any data at all -- see
// lib/access-registry.ts for what this can and cannot actually enforce.
// Exits the process on a real refusal; only returns on success.
if (token) await requireValidToken();

type ServeOptions = Parameters<typeof serve>[0];

function listen(port: number): ReturnType<typeof serve> {
  return serve({
    port,
    hostname: config.hostname,
    // Bun shares a busy port by default on macOS; two copies splitting one
    // port's requests is worse than failing, so refuse and move on.
    reusePort: false,
    development: false,
    ...(token ? fullOptions : setupOptions),
  } as ServeOptions);
}

// Launched by double-click with nobody choosing a port: step off a busy 3000
// (another copy already running) instead of failing.
// The shortcut launched while this install is already running: open a window
// in the running copy and leave, instead of starting a second one.
if (launched && config.portIsDefault) {
  for (let port = config.port; port < config.port + 10; port++) {
    const state = (await fetch(`http://127.0.0.1:${port}/setup/state`, { signal: AbortSignal.timeout(800) })
      .then((r) => r.json())
      .catch(() => null)) as { installDir?: string } | null;
    if (state?.installDir !== resolve(".")) continue;
    await fetch(`http://127.0.0.1:${port}/setup/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => {});
    console.log("  cedarstalk is already running -- opened a window for it.");
    process.exit(0);
  }
}

let server: ReturnType<typeof serve>;
for (let port = config.port; ; port++) {
  try {
    server = listen(port);
    break;
  } catch (error) {
    const busy = (error as { code?: string }).code === "EADDRINUSE";
    if (!busy || !launched || !config.portIsDefault || port >= config.port + 10) throw error;
  }
}

// Analytics are for shape, not for keeping. Thirty days of rows is plenty and
// the trim costs nothing, so it happens at boot rather than on a schedule.
const trimmed = trim();
origin = `http://${server.hostname}:${server.port}`;

console.log(`cedarstalk ${version} on ${origin}`);
console.log(`  ${routes.length} routes  ·  ${config.databasePath}`);
if (trimmed) console.log(`  trimmed ${trimmed} old request rows`);
if (config.hostname !== "127.0.0.1" && config.hostname !== "localhost") {
  console.log("  listening beyond loopback — the bearer token is the only thing in the way");
}

if (token) {
  // Routine check-ins while the server keeps running -- every 30 minutes,
  // reporting a bare request count so the registry can tell a real person's
  // use apart from a token quietly fronting something public.
  startHeartbeat();
} else {
  console.log(`\n  First run -- open ${origin}/setup and paste your token.\n`);
}

if (launched) {
  console.log("  Leave this window open while you use cedarstalk. Close it to stop.\n");
  openWindow();
}
