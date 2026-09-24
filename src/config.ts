/**
 * Everything the engine reads from the environment, resolved once.
 *
 * The bearer token is not optional. This database holds ten thousand real
 * people's rooms, phones and inferred majors; a server that starts without a
 * token is a server that hands them to anyone who finds the port. It comes
 * from BEARER_TOKEN in .env, or from the file the /setup page writes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const env = (name: string, fallback?: string): string => {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is required — copy .env.example to .env and fill it in`);
};

const databasePath = env("DATABASE_PATH", "data/cedarstalk.db");
const tokenFile = join(dirname(databasePath), ".token");

/** The token if one is configured anywhere, or null -- the server then runs in setup mode. */
export function savedToken(): string | null {
  const fromEnv = process.env.BEARER_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (!existsSync(tokenFile)) return null;
  return readFileSync(tokenFile, "utf-8").trim() || null;
}

export function saveToken(token: string): void {
  mkdirSync(dirname(tokenFile), { recursive: true });
  writeFileSync(tokenFile, token, { mode: 0o600 });
}

export const config = {
  databasePath,
  port: Number(env("PORT", "3000")),
  /** True when nobody chose a port, so the launcher may move off a busy 3000. */
  portIsDefault: !process.env.PORT?.trim(),
  hostname: env("HOST", "127.0.0.1"),
  /** Read lazily: the CLI collectors need a database, not a token. */
  get bearerToken() {
    const token = savedToken();
    if (!token) throw new Error("no token yet -- run the engine and open /setup, or set BEARER_TOKEN in .env");
    return token;
  },
};
