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
 * What it sends: the bearer token, and a random id generated once and kept
 * in a local file -- never anything about Cedarville, never real hardware
 * info. What it's for: letting the registry's own dashboard show whether a
 * token has been revoked, and flag more than one install checking in under
 * the same one as a token that might have been shared.
 *
 * Fails open. A registry that is slow, unreachable, or simply not running
 * should never be the reason a collector refuses to start -- it only warns.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config";

const DEVICE_ID_FILE = join(dirname(config.databasePath), ".device-id");

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

export async function checkInWithRegistry(): Promise<void> {
  const registryUrl = process.env.ACCESS_REGISTRY_URL;
  if (!registryUrl) return;

  const deviceId = localDeviceId();
  try {
    const res = await fetch(`${registryUrl.replace(/\/$/, "")}/.netlify/functions/check-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: config.bearerToken, deviceId }),
    });
    const body = (await res.json()) as { valid?: boolean; reason?: string };
    if (body.valid) {
      console.log(`[access] checked in with ${registryUrl} — token is valid`);
    } else {
      console.warn(
        `[access] ${registryUrl} says this token is not valid (${body.reason ?? "unknown reason"}). ` +
          "This engine will keep running, but you may have lost access -- check with whoever issued the token.",
      );
    }
  } catch (error) {
    console.warn(
      `[access] could not reach ${registryUrl} to check in -- continuing anyway: ${(error as Error).message}`,
    );
  }
}
