// Product rules covered: API actions use Bearer session tokens; sessions expire.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { startServer } = require('../helpers/server.js');
const { makeClient, seedRoom } = require('../helpers/client.js');

test('sessions', async t => {
  const server = await startServer();
  const api = makeClient(server.baseUrl);
  t.after(() => server.stop());

  await t.test('reading requests without a token is rejected', async () => {
    const room = await seedRoom(api);
    assert.equal((await api.listRequests(room.roomId)).status, 401);
  });

  await t.test('a forged token is rejected', async () => {
    const room = await seedRoom(api);
    assert.equal((await api.listRequests(room.roomId, 'not-a-real-token')).status, 401);
  });

  await t.test('a valid token reads the room', async () => {
    const room = await seedRoom(api);
    const listed = await api.listRequests(room.roomId, room.author.token);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.data.requests, []);
  });

  await t.test('every session is stored with an expiry', async () => {
    await seedRoom(api);
    const db = new DatabaseSync(server.dbPath);
    const rows = db.prepare('SELECT expires_at, created_at FROM sessions').all();
    db.close();
    assert.ok(rows.length > 0, 'expected at least one session row');
    for (const row of rows) {
      assert.ok(row.expires_at, 'session row has no expires_at');
      assert.ok(Date.parse(row.expires_at) > Date.parse(row.created_at));
    }
  });

  await t.test('logging out invalidates that token only', async () => {
    const first = await seedRoom(api);
    const second = await seedRoom(api);
    assert.equal((await api.logout(first.author.token)).status, 200);
    assert.equal((await api.listRequests(first.roomId, first.author.token)).status, 401);
    // The partner in the same room, and the other room, are untouched.
    assert.equal((await api.listRequests(first.roomId, first.partner.token)).status, 200);
    assert.equal((await api.listRequests(second.roomId, second.author.token)).status, 200);
  });

  await t.test('logging out with an unknown token is rejected', async () => {
    assert.equal((await api.logout('not-a-real-token')).status, 401);
  });

  await t.test('an expired session is rejected and deleted', async () => {
    const room = await seedRoom(api);
    const db = new DatabaseSync(server.dbPath);
    const past = new Date(Date.now() - 60_000).toISOString();
    const updated = db
      .prepare('UPDATE sessions SET expires_at = ? WHERE room_id = ? AND member_id = ?')
      .run(past, room.roomId, room.author.member.id);
    db.close();
    assert.equal(Number(updated.changes), 1, 'test setup failed to expire the session');

    assert.equal((await api.listRequests(room.roomId, room.author.token)).status, 401);

    const after = new DatabaseSync(server.dbPath);
    const left = after
      .prepare('SELECT COUNT(*) AS n FROM sessions WHERE member_id = ?')
      .get(room.author.member.id);
    after.close();
    assert.equal(Number(left.n), 0, 'expired session row was not deleted');
    // The partner's live session must survive the cleanup.
    assert.equal((await api.listRequests(room.roomId, room.partner.token)).status, 200);
  });
});
