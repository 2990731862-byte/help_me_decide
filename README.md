# Approval Room

A two-person shared spending approval app.

## Product rules

- A user can create or join multiple rooms.
- Each room supports up to two members.
- Each member can submit an item, amount, and required reason.
- A member cannot approve their own request.
- Rejection requires a reason.
- The author can mark an approved request as purchased.
- Production mode uses a fixed member view. Development view switching is enabled only with `?dev=1`.

## Stack

- Frontend: HTML, CSS, vanilla JavaScript.
- Backend: Node.js native HTTP server.
- Storage: Node built-in SQLite.
- Tests: `node:test` assertions over the REST API; no browser required.

## Local run

~~~bash
git clone https://github.com/2990731862-byte/help_me_decide.git
cd help_me_decide
npm install
npm test
npm start
~~~

Requires Node 24 or newer (`server.js` uses `node:sqlite`).

Open http://localhost:8787.

## Environment variables

- `PORT`: HTTP port, default `8787`.
- `APPROVAL_DB_PATH`: SQLite database path.
- `APPROVAL_LEGACY_DATA`: optional one-time legacy JSON migration source.

## Main files

- `index.html`: page structure.
- `style.css`: responsive visual design.
- `app.js`: room, session, request, approval and API client logic.
- `server.js`: HTTP API, SQLite storage, authentication and static files.
- `Dockerfile`: generic container build.
- `tests/api/`: API-level regression tests, one file per product area.
- `tests/helpers/`: throwaway server and API client used by the tests.

## Security notes

- Room passwords are stored as hashes.
- API actions use Bearer session tokens.
- The server ignores forged member IDs and uses the authenticated session member.
- Runtime databases and local secrets must not be committed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the Issue → branch → PR → CI → review flow,
and [AGENTS.md](AGENTS.md) for repo facts an AI assistant needs.

## Current scope

The app is a tested local / single-instance version. Public deployment, account-based room discovery, token expiry, rate limiting, audit logs and multi-instance database support remain future work.
