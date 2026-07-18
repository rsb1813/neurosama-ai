# neru web search — SearXNG

Self-hosted [SearXNG](https://github.com/searxng/searxng) metasearch backend for neru's `webSearch` tool.

## Run

```bash
docker compose -f infra/searxng/docker-compose.yml up -d
```

Serves `http://localhost:8888` (bound to 127.0.0.1 only). Stop with `docker compose -f infra/searxng/docker-compose.yml down`.

## How neru uses it

neru's `webSearch` builtin tool (always-on) calls the main-process web-search service, which fetches `GET http://localhost:8888/search?q=...&format=json`. Override the URL with `NERU_SEARXNG_URL`.

Search is an **optional dependency** — if this container is not running, neru degrades gracefully ("I can't search right now") instead of crashing.

## Notes

- `settings.yml` enables the `json` output format (off by default) and sets a local `secret_key` — change it if you ever expose this beyond localhost.
- If Google rate-limits the instance (captchas), SearXNG still returns results from the other aggregated engines.
