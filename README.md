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
- Tests: Playwright and Node syntax checks.

## Local run

~~~powershell
cd D:\approval
npm install
npm run test:syntax
npm start
~~~

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
- `tests/`: regression tests.

## Security notes

- Room passwords are stored as hashes.
- API actions use Bearer session tokens.
- The server ignores forged member IDs and uses the authenticated session member.
- Runtime databases and local secrets must not be committed.

## Current scope

The app is a tested local / single-instance version. Public deployment, account-based room discovery, token expiry, rate limiting, audit logs and multi-instance database support remain future work.
