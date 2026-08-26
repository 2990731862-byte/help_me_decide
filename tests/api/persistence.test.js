// Product rule covered: state lives in SQLite, so it survives a restart.
// This is what the sqlite* counters in the old diagnostic scripts were watching.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { startServer } = require('../helpers/server.js');
const { makeClient, seedRoom } = require('../helpers/client.js');

const count = (dbPath, table) => {
  const db = new DatabaseSync(dbPath);
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
  db.close();
  return Number(row.n);
};

test('persistence', async t => {
  const server = await startServer();
  const api = makeClient(server.baseUrl);
  t.after(() => server.stop());

  await t.test('a room, its members and one request land in SQLite exactly once', async () => {
    const room = await seedRoom(api);
    await api.submitRequest(room.roomId, room.author.token, { item: 'Kettle', amount: 39, reason: 'Old one leaks' });

    assert.equal(count(server.dbPath, 'rooms'), 1);
    assert.equal(count(server.dbPath, 'members'), 2);
    assert.equal(count(server.dbPath, 'requests'), 1, 'a single submit wrote more than one row');
    assert.equal(count(server.dbPath, 'sessions'), 2);
  });

  await t.test('decisions survive a server restart', async () => {
    const room = await seedRoom(api);
    const created = await api.submitRequest(room.roomId, room.author.token, {
      item: 'Monitor', amount: 899, reason: 'Second screen',
    });
    await api.decide(room.roomId, created.data.request.id, room.partner.token, {
      action: 'rejected', note: 'Next quarter',
    });

    await server.restart();

    const listed = await api.listRequests(room.roomId, room.author.token);
    assert.equal(listed.status, 200, 'the session did not survive the restart');
    const found = listed.data.requests.find(item => item.id === created.data.request.id);
    assert.ok(found, 'the request disappeared across the restart');
    assert.equal(found.status, 'rejected');
    assert.equal(found.note, 'Next quarter');
  });
});
