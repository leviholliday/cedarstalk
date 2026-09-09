/**
 * Everything the engine reads from the environment, resolved once.
 *
 * The bearer token is not optional. This database holds ten thousand real
 * people's rooms, phones and inferred majors; a server that starts without a
 * token is a server that hands them to anyone who finds the port.
 */

const env = (name: string, fallback?: string): string => {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is required — copy .env.example to .env and fill it in`);
};

export const config = {
  databasePath: env("DATABASE_PATH", "data/cedarengine.db"),
  port: Number(env("PORT", "3000")),
  hostname: env("HOST", "127.0.0.1"),
  /** Read lazily: the CLI collectors need a database, not a token. */
  get bearerToken() {
    return env("BEARER_TOKEN");
  },
};
