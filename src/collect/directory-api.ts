/**
 * Talking to the directory endpoint, and getting a session to talk with.
 *
 * The directory is behind SSO, so unlike the course catalog there is no guest
 * path: a real session cookie is required. Three ways to get one, in order of
 * how little you have to do:
 *
 *   DIRECTORY_COOKIE=…            an env var, for a headless box
 *   --cookie <file>               a file holding the cookie header
 *   the Raycast extension's helper a signed macOS app that holds the SSO
 *                                 session and renews the site cookie silently
 *
 * The helper is a compiled WebKit window from cedarstalk-raycast, reused here
 * rather than rebuilt: the SSO flow it drives is a browser problem, and a
 * browser is what solves it.
 */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export const BASE_URL = "https://selfservice.cedarville.edu";

const SUPPORT = path.join(
  os.homedir(),
  "Library/Application Support/com.raycast.macos/extensions/cedarville-people-search",
);

export class AuthExpiredError extends Error {
  constructor() {
    super("session expired");
    this.name = "AuthExpiredError";
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundlePackageType</key><string>APPL</string>
\t<key>CFBundleExecutable</key><string>auth-browser</string>
\t<key>CFBundleIdentifier</key><string>sh.dunkirk.cedarengine.auth</string>
\t<key>CFBundleName</key><string>Cedarville Auth</string>
\t<key>NSPrincipalClass</key><string>NSApplication</string>
\t<key>NSHighResolutionCapable</key><true/>
\t<key>LSMinimumSystemVersion</key><string>13.0</string>
</dict>
</plist>`;

/**
 * A session cookie, however it can be had.
 *
 * The helper only shows a window if the SSO session actually needs a human, so
 * the silent pass is tried first and the visible one is the fallback.
 */
export async function sessionCookie({
  cookieFile,
  log = console.error,
}: { cookieFile?: string; log?: (message: string) => void } = {}): Promise<string> {
  const fromEnv = process.env.DIRECTORY_COOKIE?.trim();
  if (fromEnv) return fromEnv;

  if (cookieFile) {
    const cookie = (await readFile(cookieFile, "utf-8")).trim();
    if (cookie) return cookie;
  }

  const tmp = await mkdtemp(path.join(os.tmpdir(), "cedarengine-"));
  const app = path.join(tmp, "CedarvilleAuth.app");
  const macos = path.join(app, "Contents", "MacOS");
  await mkdir(macos, { recursive: true });
  await symlink(path.join(SUPPORT, "auth-browser"), path.join(macos, "auth-browser"));
  await writeFile(path.join(app, "Contents", "Info.plist"), PLIST);

  const target = path.join(tmp, "cookie.txt");
  await writeFile(target, "", { mode: 0o600 });
  const jar = path.join(SUPPORT, "sso-jar.json");

  try {
    for (const silent of [true, false]) {
      await new Promise<void>((resolve, reject) => {
        const args = ["-n", "-W", app, "--args", target, "--jar", jar];
        if (silent) args.push("--silent");
        const child = spawn("open", args, { stdio: "ignore" });
        child.on("close", () => resolve());
        child.on("error", reject);
      });
      const cookie = (await readFile(target, "utf-8")).trim();
      if (cookie) return cookie;
      if (silent) log("silent refresh failed, opening the sign-in window…");
    }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  throw new Error(
    "no session cookie — set DIRECTORY_COOKIE, pass --cookie <file>, or sign in from Raycast once",
  );
}

const headers = (cookie: string) => ({
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9",
  referer: `${BASE_URL}/cedarinfo/directory`,
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  cookie,
});

export interface DirectoryParams {
  FirstNameSearch?: string;
  LastNameSearch?: string;
  Department?: string;
  PopulationSearch?: string;
}

/**
 * One directory query. Retries transient failures; throws AuthExpiredError the
 * moment the server starts redirecting to SSO, because every retry after that
 * is a wasted round trip against a login page.
 */
export async function search(
  cookie: string,
  params: DirectoryParams,
  { retries = 3 }: { retries?: number } = {},
): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][],
  );
  const url = `${BASE_URL}/CedarInfo/Directory/SearchResultsJson?${qs}`;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(400 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, { headers: headers(cookie) });
      if (!res.url.includes("selfservice.cedarville.edu")) throw new AuthExpiredError();
      if (res.status === 401 || res.status === 403) throw new AuthExpiredError();
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      if (!Array.isArray(data)) throw new AuthExpiredError();
      return data as Record<string, unknown>[];
    } catch (error) {
      if (error instanceof AuthExpiredError) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error("request failed");
}
