# cedarstalk

cedarstalk is a local-first Cedarville research tool: a Bun API, a SQLite
database, and collectors for directory, course, campus, and booklist data.

It is intended for the maintainer's private use. It is **not** a public
directory or hosted service. Do not publish a database, bearer token, browser
profile, or endpoint that exposes collected data.

## What stays online

The small access registry at `cedarstalk.netlify.app` is online so approved
copies can validate their access token. The engine and its database stay on
your own machine. When remote access is needed, use Tailscale rather than
opening a port to the public internet.

## Run locally

Requirements: [Bun](https://bun.sh) and a valid `BEARER_TOKEN`.

```bash
bun install
cp .env.example .env
# add BEARER_TOKEN to .env
bun run engine import       # optional: imports data from adjacent projects
bun run dev                 # http://127.0.0.1:3000
```

`HOST` defaults to `127.0.0.1`. Leave it that way unless you specifically need
to reach the service from another device. For a phone or another trusted
device, bind to the machine's Tailscale address or MagicDNS name, never
`0.0.0.0`, and do not use a public tunnel, port forwarding, or Tailscale
Funnel.

The dashboard is at `/`; the OpenAPI document is at `/openapi.json`. API
requests require `Authorization: Bearer <token>`.

## Collect data

```bash
bun run engine collect catalog 2027SP
bun run engine collect catalog --all
bun run engine collect book
bun run engine collect campus
bun run engine collect directory
```

Directory collection needs an authenticated Cedarville session. Keep session
cookies and browser profiles under `data/`; that directory is intentionally
ignored by Git. The Chrome extension in `extension/` can perform signed-in
browser collection and send results back to a trusted local engine.

## Security checklist

- Keep the GitHub repository private.
- Keep `.env`, `data/`, browser profiles, harvests, and SQLite files out of Git.
- Use a unique bearer token and do not include it in screenshots, issues, or
  launcher bundles.
- Restrict remote access to your tailnet; the server contains sensitive,
  person-level information.
- Before every push, review `git status` and `git diff --cached`.

## Development

```bash
bun run typecheck
bun test
bun run ci
```

## License and provenance

cedarstalk is an independently maintained, substantially modified derivative
of cedarengine. The original MIT copyright notice and license are retained in
[LICENSE.md](LICENSE.md), as required by that license.
