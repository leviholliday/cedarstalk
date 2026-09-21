/**
 * A Self-Service session cookie, on any platform.
 *
 * The directory sweep has until now borrowed the Raycast extension's Swift
 * WKWebView helper to mint one silently. That works well and only works on
 * macOS -- and it couples the engine to a Raycast support directory, which is
 * a strange thing for a server to depend on whatever platform it runs on.
 *
 * The replacement was already here: `harvest-booklists.ts` drives a real
 * browser through playwright-core to get past the campus store's WAF. The same
 * browser, pointed at Self-Service with a persistent profile, holds an SSO
 * session for months and mints the short-lived cookie on demand.
 *
 * Exit codes, matching what `headless-directory.sh` already expects:
 *   0  a cookie was written
 *   2  the session needs a human -- run again with HEADED=1 and sign in
 *   3  playwright or Chrome is missing
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright-core";

const ROOT = dirname(import.meta.dir);
/**
 * Holds a live SSO session, so it is a credential. `data/` is gitignored
 * wholesale; never copy this directory anywhere.
 */
const PROFILE = join(ROOT, "data", "sso-profile");
const DIRECTORY_URL = "https://selfservice.cedarville.edu/cedarinfo/directory";
/** Cheap, returns JSON, and requires a real session -- a good liveness probe. */
const PROBE_URL =
  "https://selfservice.cedarville.edu/CedarInfo/Directory/SearchResultsJson?LastNameSearch=aa&FirstNameSearch=a";

const out = process.argv[2];
const headed = process.env.HEADED === "1";

function log(...parts: unknown[]) {
  console.log(new Date().toISOString().slice(0, 19).replace("T", " "), ...parts);
}

if (!out) {
  console.error("usage: bun run scripts/auth-session.ts <cookie-file> [--probe]");
  process.exit(1);
}

mkdirSync(PROFILE, { recursive: true });

let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>;
try {
  context = await chromium.launchPersistentContext(PROFILE, {
    channel: "chrome",
    headless: !headed,
    viewport: { width: 1280, height: 900 },
  });
} catch (error) {
  log(`could not start Chrome: ${(error as Error).message.split("\n")[0]}`);
  log("install Google Chrome, or swap channel for a downloaded chromium");
  process.exit(3);
}

const page = context.pages()[0] ?? (await context.newPage());

try {
  await page.goto(DIRECTORY_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // A live session lands on Self-Service; a dead one is redirected to
  // Microsoft's SSO, which is the whole tell.
  if (headed) {
    log("headed: sign in if prompted. Waiting up to 5 minutes...");
    await page
      .waitForURL((url) => url.host.endsWith("cedarville.edu"), { timeout: 300_000 })
      .catch(() => {});
  }

  const landedOnSso = !new URL(page.url()).host.endsWith("cedarville.edu");
  if (landedOnSso) {
    log(`session needs a human -- landed on ${new URL(page.url()).host}`);
    log("run again with HEADED=1 and sign in once; the profile keeps it for months");
    await context.close();
    process.exit(2);
  }

  // Prove the cookies actually work rather than trusting the URL. A request
  // from inside the page carries exactly what the sweep will carry.
  const probe = await page.evaluate(async (url) => {
    const res = await fetch(url, { headers: { accept: "*/*" } });
    const text = await res.text();
    return { status: res.status, json: text.trimStart().startsWith("["), landed: res.url };
  }, PROBE_URL);

  if (!probe.json) {
    log(`probe came back ${probe.status} and not JSON (landed ${probe.landed})`);
    log("that is an expired session; run again with HEADED=1");
    await context.close();
    process.exit(2);
  }

  const cookies = await context.cookies("https://selfservice.cedarville.edu");
  const header = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  if (!header) {
    log("no cookies for selfservice.cedarville.edu");
    await context.close();
    process.exit(2);
  }

  // Written 0600 from the start: a live session cookie is worth more to a
  // passer-by than anything else on the machine.
  writeFileSync(out, header, { mode: 0o600 });
  chmodSync(out, 0o600);
  log(`wrote ${header.length} bytes to ${out} (${cookies.length} cookies)`);
  await context.close();
  process.exit(0);
} catch (error) {
  log(`failed: ${(error as Error).message.split("\n")[0]}`);
  await context.close().catch(() => {});
  process.exit(2);
}
