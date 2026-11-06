# Isolated GitHub Issues queue Worker

This is a replacement pilot for the HubSpot-derived Hive queue. It is intentionally a separate Worker, not a change to the production `ghf-watch` runtime.

## Public issue contract

Only open GitHub issues in the configured repository allowlist that carry the explicit `hive:public` label are discoverable/claimable. The pilot defaults to the central Cedwyn repo, Hive repo and Tithe H3 repo. Expand the allowlist only after repository-specific public-safety review. It returns a strict metadata allowlist: repository, issue number, title, public URL, state, priority labels, labels, assignee logins and timestamps. Issue bodies, comments, user profile data, HubSpot IDs and correspondence are never returned or stored.

## Lease contract

One SQLite-backed Durable Object instance per `owner/repo#issue_number`. Claim, renew and release are serialized by that issue's Durable Object and persisted in its storage. Lease state is coordination only; GitHub remains authoritative for issue state, labels, assignees and acceptance. Claims expire after 60 minutes; renewal is limited to 2 hours per call. Another agent's live claim is refused. Expired claims can be replaced. Only the holder can release.

## Browser access

The API allows CORS only from HTTPS origins on bucklerfamily.estate and its subdomains. Server-to-server calls need no CORS headers. Lease mutations require the bearer token.

## Endpoints

- `GET /health`
- `GET /jobs?limit=50`
- `GET /lease?repo=owner/repo&issue_number=123`
- `POST /claim` and `POST /renew` with `{ "repo", "issue_number", "agent" }`
- `POST /release` with the same body

## Preview / production boundary

When the repository has CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID Actions secrets, a PR deploys a separate Worker named cedwyn-hive-queue-pr-N, with its own Durable Object namespace; PR close deletes that Worker. If those secrets are absent, CI still runs unit tests and Wrangler dry-run but skips deployment and cleanup. The PR #16 preview on 6 November 2026 was deployed manually through the Cloudflare connection because the GitHub Actions secrets are absent. It does not bind to the live watch Worker or its KV namespace. No production domain, route, Worker, HubSpot record or existing KV key is changed by this pilot.

The pilot is not wired into the live Hive UI, WebMCP or JOIN contract. That integration is a later step after API smoke tests, multi-agent lease contention tests, repository allowlist review and explicit production approval.
