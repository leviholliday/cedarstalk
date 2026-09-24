/**
 * Checking in with cedarengine-access, for anyone running their own copy
 * under a token issued by that registry.
 *
 * Deliberately opt-in and off by default: this does nothing at all unless
 * `ACCESS_REGISTRY_URL` is set. Levi's own instance predates the registry
 * and was never issued a token through it, so it never sets this and this
 * module never runs anything for him. It only matters for someone who went
 * through cedarengine-access to get their own token.
 *
 * What it sends, once at startup and then every 30 minutes: the bearer
 * token, a random id generated once and kept in a local file (never real
 * hardware info), and a bare count of how many requests this instance
 * served in that window -- reusing the same request-analytics table the
 * dashboard already reads, never which endpoints or who was looked up. That
 * count is the one thing the registry can use to notice a token being used
 * far beyond what one person's own use looks like -- someone's own token
 * fronting a public web app for strangers reads nothing like a personal
 * Raycast habit.
 *
 * Fails open. A registry that is slow, unreachable, or simply not running
 * should never be the reason a collector refuses to start -- it only warns.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config";
import { analytics } from "./analytics";

const DEVICE_ID_FILE = join(dirname(config.databasePath), ".device-id");
const HEARTBEAT_MINUTES = 30;

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

async function heartbeat(registryUrl: string, deviceId: string): Promise<void> {
  const windowMinutes = Math.round((Date.now() - lastHeartbeatAt) / 60_000) || HEARTBEAT_MINUTES;
  const requests = analytics(windowMinutes / 60).total;
  lastHeartbeatAt = Date.now();

  try {
    const res = await fetch(`${registryUrl.replace(/\/$/, "")}/.netlify/functions/check-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: config.bearerToken, deviceId, requests, windowMinutes }),
    });
    const body = (await res.json()) as { valid?: boolean; reason?: string; flagged?: boolean; message?: string };

    if (!body.valid) {
      status = { flagged: false };
      console.warn(
        `[access] ${registryUrl} says this token is not valid (${body.reason ?? "unknown reason"}). ` +
          "This engine will keep running, but you may have lost access -- check with whoever issued the token.",
      );
      return;
    }

    status = { flagged: Boolean(body.flagged), message: body.message };
    if (body.flagged) {
      console.warn(`[access] ${body.message ?? "This token has been flagged."}`);
    } else {
      console.log(`[access] checked in with ${registryUrl} — token is valid (${requests} requests this window)`);
    }
  } catch (error) {
    console.warn(
      `[access] could not reach ${registryUrl} to check in -- continuing anyway: ${(error as Error).message}`,
    );
  }
}

/** Called once at startup. A no-op unless ACCESS_REGISTRY_URL is set. */
export function startAccessRegistry(): void {
  const registryUrl = process.env.ACCESS_REGISTRY_URL;
  if (!registryUrl) return;

  const deviceId = localDeviceId();
  heartbeat(registryUrl, deviceId);
  setInterval(() => heartbeat(registryUrl, deviceId), HEARTBEAT_MINUTES * 60_000).unref();
}
