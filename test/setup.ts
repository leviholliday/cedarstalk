/**
 * Every test runs against a database in memory.
 *
 * Preloaded, so no test can reach the real one by forgetting to. The file it
 * would otherwise open holds ten thousand real people.
 */

process.env.DATABASE_PATH = ":memory:";
process.env.BEARER_TOKEN ??= "test-token";
