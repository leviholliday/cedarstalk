/**
 * Request analytics, kept deliberately thin.
 *
 * One row per request and a few group-bys over it. Rollup tables would buy
 * speed this does not need: a week of personal traffic is tens of thousands of
 * rows, and SQLite counts those faster than the network hands them over.
 *
 * Rows carry an endpoint pattern, never a full path — `/v1/people/:id` rather
 * than the id. Analytics on a directory must not become a second copy of who
 * was looked up.
 */

import { db } from "../db";

const RETENTION_DAYS = 30;

export function record(endpoint: string, status: number, ms: number): void {
  db()
    .query("INSERT INTO requests (at, endpoint, status, ms) VALUES (?, ?, ?, ?)")
    .run(new Date().toISOString(), endpoint, status, ms);
}

export function trim(days = RETENTION_DAYS): number {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  return db().query("DELETE FROM requests WHERE at < ?").run(cutoff).changes;
}

export interface Analytics {
  total: number;
  errors: number;
  p50: number;
  p95: number;
  byEndpoint: { endpoint: string; n: number; ms: number }[];
  overTime: { hour: string; n: number; ms: number }[];
}

export function analytics(hours = 24): Analytics {
  const database = db();
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  const percentile = (p: number) =>
    database
      .query<{ ms: number }, [string, number]>(
        `SELECT ms FROM requests WHERE at >= ?
         ORDER BY ms LIMIT 1
         OFFSET MAX(0, CAST((SELECT COUNT(*) FROM requests WHERE at >= ?1) * ? AS INTEGER) - 1)`,
      )
      .get(since, p)?.ms ?? 0;

  return {
    total:
      database
        .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM requests WHERE at >= ?")
        .get(since)?.n ?? 0,
    errors:
      database
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) AS n FROM requests WHERE at >= ? AND status >= 400",
        )
        .get(since)?.n ?? 0,
    p50: percentile(0.5),
    p95: percentile(0.95),
    byEndpoint: database
      .query<{ endpoint: string; n: number; ms: number }, [string]>(
        `SELECT endpoint, COUNT(*) AS n, ROUND(AVG(ms), 2) AS ms
         FROM requests WHERE at >= ? GROUP BY endpoint ORDER BY n DESC`,
      )
      .all(since),
    overTime: database
      .query<{ hour: string; n: number; ms: number }, [string]>(
        `SELECT substr(at, 1, 13) AS hour, COUNT(*) AS n, ROUND(AVG(ms), 2) AS ms
         FROM requests WHERE at >= ? GROUP BY hour ORDER BY hour`,
      )
      .all(since),
  };
}
