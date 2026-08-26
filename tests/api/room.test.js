// Product rules covered: a user can create or join multiple rooms;
// each room supports up to two members.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server.js');
const { makeClient } = require('../helpers/client.js');

test('rooms', async t => {
  const server = await startServer();
  const api = makeClient(server.baseUrl);
  t.after(() => server.stop());

  await t.test('health check answers', async () => {
    const { status } = await api.health();
    assert.equal(status, 200);
  });

  await t.test('creating a room returns 201 with a member and a token', async () => {
    const { status, data } = await api.createRoom({ nickname: 'Ann', password: 'pw-create' });
    assert.equal(status, 201);
    assert.match(data.room.id, /^room_[0-9a-f]{12}$/);
    assert.equal(data.room.members.length, 1);
    assert.equal(data.member.nickname, 'Ann');
    assert.ok(data.token);
  });

  await t.test('creating a room requires nickname and password', async () => {
    assert.equal((await api.createRoom({ nickname: 'Ann' })).status, 400);
    assert.equal((await api.createRoom({ password: 'pw' })).status, 400);
    assert.equal((await api.createRoom({})).status, 400);
  });

  await t.test('the second member joins with the room password', async () => {
    const created = await api.createRoom({ nickname: 'Ann', password: 'pw-join' });
    const joined = await api.joinRoom(created.data.room.id, { nickname: 'Ben', password: 'pw-join' });
    assert.equal(joined.status, 200);
    assert.equal(joined.data.room.members.length, 2);
    assert.notEqual(joined.data.token, created.data.token);
  });

  await t.test('joining with the wrong password is rejected', async () => {
    const created = await api.createRoom({ nickname: 'Ann', password: 'pw-right' });
    const joined = await api.joinRoom(created.data.room.id, { nickname: 'Ben', password: 'pw-wrong' });
    assert.equal(joined.status, 401);
  });

  await t.test('joining a room that does not exist is a 404', async () => {
    const joined = await api.joinRoom('room_deadbeefcafe', { nickname: 'Ben', password: 'pw' });
    assert.equal(joined.status, 404);
  });

  // README: "Each room supports up to two members." Previously untested.
  await t.test('a third member cannot join a full room', async () => {
    const created = await api.createRoom({ nickname: 'Ann', password: 'pw-full' });
    const roomId = created.data.room.id;
    assert.equal((await api.joinRoom(roomId, { nickname: 'Ben', password: 'pw-full' })).status, 200);
    const third = await api.joinRoom(roomId, { nickname: 'Cat', password: 'pw-full' });
    assert.equal(third.status, 409);
    assert.equal(third.data.error, 'room is full');
  });

  await t.test('one person can hold rooms independently', async () => {
    const first = await api.createRoom({ nickname: 'Ann', password: 'pw-1' });
    const second = await api.createRoom({ nickname: 'Ann', password: 'pw-2' });
    assert.equal(second.status, 201);
    assert.notEqual(first.data.room.id, second.data.room.id);
    // A token minted for one room must not reach the other.
    const crossed = await api.listRequests(second.data.room.id, first.data.token);
    assert.equal(crossed.status, 401);
  });
});
