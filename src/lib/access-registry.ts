/**
 * Every instance of this engine -- the maintainer's own included, registered under their
 * real token the same as anyone else's -- validates against
 * cedarstalk-access before it will start. Not optional, and not something
 * an env var can turn off: the registry address is a constant, not
 * `ACCESS_REGISTRY_URL` read from `.env`, because a setting anyone could
 * unset is not a requirement.
 *
 * Worth being honest about what this can and cannot do. Anyone willing to
 * read and edit this file can delete the check entirely -- nothing here can
 * stop a determined person with the source in front of them, the same as
 * any license check in any piece of software ever has been able to. What it
 * does raise is the bar for casual redistribution: sharing a token is easy,
 * quietly patching out a validation call most people distributing this
 * won't think to look for is a different, higher bar.
 *
 * What it sends, once at startup and then every 30 minutes while the server
 * runs: the bearer token, a random id generated once and kept in a local
 * file (never real hardware info), and a bare count of how many requests
 * this instance served in that window -- reusing the existing
 * request-analytics table, never which endpoints or who was looked up.
 *
 * A registry that is briefly unreachable should not be the reason someone's
 * engine refuses to start -- but "briefly" is the operative word. The last
 * successful validation is cached locally with a timestamp; a fresh cache
 * (within CACHE_TTL_DAYS) lets startup proceed with a warning when the
 * registry cannot be reached right now. No cache at all, a stale one, or an
 * explicit "revoked" answer all refuse to start -- those are not network
 * problems, they are the check doing its job.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config";
import { analytics } from "./analytics";

const REGISTRY_URL = "https://cedarstalk.netlify.app";
const HEARTBEAT_MINUTES = 30;
const CACHE_TTL_DAYS = 7;

const DEVICE_ID_FILE = join(dirname(config.databasePath), ".device-id");
const CACHE_FILE = join(dirname(config.databasePath), ".access-cache.json");

export interface AccessStatus {
  flagged: boolean;
  message?: string;
}

/** What the last heartbeat learned, for /health (and anything reading it) to surface. */
let status: AccessStatus = { flagged: false };
let lastHeartbeatAt = Date.now();

export function accessStatus(): AccessStatus {
  return status;
}

function localDeviceId(): string {
  try {
    const existing = readFileSync(DEVICE_ID_FILE, "utf-8").trim();
    if (existing) return existing;
  } catch {
    // No file yet -- fall through and create one.
  }
  const id = randomUUID();
  try {
    mkdirSync(dirname(DEVICE_ID_FILE), { recursive: true });
    writeFileSync(DEVICE_ID_FILE, id);
  } catch {
    // Read-only filesystem or similar: still usable for this one process,
    // just not remembered for the next one.
  }
  return id;
}

function readCache(): { validatedAt: string } | null {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function writeCache(): void {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ validatedAt: new Date().toISOString() }));
  } catch {
    // Not fatal -- just means the next unreachable-registry case has nothing
    // fresh to fall back on, same as if this were the very first run.
  }
}

function cacheIsFresh(): boolean {
  const cache = readCache();
  if (!cache) return false;
  const age = Date.now() - new Date(cache.validatedAt).getTime();
  return age < CACHE_TTL_DAYS * 24 * 3_600_000;
}

interface CheckInResponse {
  valid?: boolean;
  reason?: string;
  flagged?: boolean;
  message?: string;
}

async function callRegistry(
  deviceId: string,
  traffic?: { requests: number; windowMinutes: number },
  token: string = config.bearerToken,
): Promise<CheckInResponse> {
  const res = await fetch(`${REGISTRY_URL}/.netlify/functions/check-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, deviceId, ...traffic }),
  });
  return res.json();
}

function accept(response: CheckInResponse): void {
  writeCache();
  status = { flagged: Boolean(response.flagged), message: response.message };
  if (response.flagged) console.warn(`[access] ${response.message ?? "This token has been flagged."}`);
  else console.log(`[access] validated with ${REGISTRY_URL}`);
}

/**
 * For the /setup page: checks a token someone just pasted, without exiting
 * on a bad one. Throws only when the registry cannot be reached at all.
 */
export async function checkToken(token: string): Promise<{ valid: boolean; reason?: string }> {
  const response = await callRegistry(localDeviceId(), undefined, token);
  if (!response.valid) return { valid: false, reason: response.reason };
  accept(response);
  return { valid: true };
}

/**
 * Called once, before the server binds a port or the CLI does anything else.
 * Exits the process on a real refusal -- an unknown or revoked token, or an
 * unreachable registry with no fresh cache to fall back on. Never exits for
 * being merely flagged; that is a softer signal, meant to be reviewed and
 * possibly reversed, not a kill switch.
 */
export async function requireValidToken(): Promise<void> {
  const deviceId = localDeviceId();

  let response: CheckInResponse;
  try {
    response = await callRegistry(deviceId);
  } catch (error) {
    if (cacheIsFresh()) {
      console.warn(
        `[access] could not reach ${REGISTRY_URL} to validate -- continuing on a cached check from within the last ${CACHE_TTL_DAYS} days.`,
      );
      return;
    }
    console.error(
      `[access] could not reach ${REGISTRY_URL} to validate this token, and there is no recent successful ` +
        `check to fall back on: ${(error as Error).message}`,
    );
    console.error("[access] refusing to start. Try again once the registry is reachable.");
    process.exit(1);
  }

  if (!response.valid) {
    console.error(
      `[access] ${REGISTRY_URL} says this token is not valid (${response.reason ?? "unknown reason"}).`,
    );
    console.error("[access] refusing to start. Check with whoever issued the token.");
    process.exit(1);
  }

  accept(response);
}

async function heartbeat(deviceId: string): Promise<void> {
  const windowMinutes = Math.round((Date.now() - lastHeartbeatAt) / 60_000) || HEARTBEAT_MINUTES;
  const requests = analytics(windowMinutes / 60).total;
  lastHeartbeatAt = Date.now();

  try {
    const response = await callRegistry(deviceId, { requests, windowMinutes });
    if (!response.valid) {
      status = { flagged: false };
      console.warn(
        `[access] ${REGISTRY_URL} says this token is no longer valid (${response.reason ?? "unknown reason"}). ` +
          "This instance will keep running for now, but check with whoever issued the token.",
      );
      return;
    }
    writeCache();
    status = { flagged: Boolean(response.flagged), message: response.message };
    if (response.flagged) console.warn(`[access] ${response.message ?? "This token has been flagged."}`);
  } catch (error) {
    console.warn(`[access] could not reach ${REGISTRY_URL} for a routine check-in: ${(error as Error).message}`);
  }
}

/** Call after requireValidToken() succeeds, for the long-running server only -- the CLI exits before 30 minutes pass. */
export function startHeartbeat(): void {
  const deviceId = localDeviceId();
  setInterval(() => heartbeat(deviceId), HEARTBEAT_MINUTES * 60_000).unref();
}
