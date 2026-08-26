// Guards the invariant that writeDb() breaks when its snapshot goes stale:
// a submit must not erase data written by anyone else while it was in flight.
// See issue #7 — three requests all returned 201 while a whole room vanished.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer } = require('../helpers/server.js');
const { makeClient, seedRoom } = require('../helpers/client.js');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Sends the request headers now and the body only when finish() is called, so
// the handler is parked on `await body(req)` in between. A real client hits the
// same state whenever the body arrives in a later packet than the headers.
function heldPost(baseUrl, apiPath, token, payload) {
  const url = new URL(baseUrl + apiPath);
  const request = http.request({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Transfer-Encoding': 'chunked',
    },
  });
  const answered = new Promise((resolve, reject) => {
    request.on('error', reject);
    request.on('response', response => {
      let raw = '';
      response.on('data', chunk => { raw += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(raw || '{}') }));
    });
  });
  request.flushHeaders();
  return {
    finish() {
      request.end(JSON.stringify(payload));
      return answered;
    },
  };
}

test('a submit in flight does not erase concurrent writes', async t => {
  const server = await startServer();
  const api = makeClient(server.baseUrl);
  t.after(() => server.stop());

  const roomA = await seedRoom(api, { password: 'pw-a', a: 'A1', b: 'A2' });
  const roomB = await seedRoom(api, { password: 'pw-b', a: 'B1', b: 'B2' });

  const held = heldPost(server.baseUrl, `/api/rooms/${roomA.roomId}/requests`, roomA.author.token, {
    item: 'Desk',
    amount: 100,
    reason: 'submitted slowly',
  });
  await wait(300);

  // Precondition: the held submit really is still in flight. Without this the
  // test could pass simply because the timing never produced a window.
  const duringA = await api.listRequests(roomA.roomId, roomA.author.token);
  assert.equal(duringA.data.requests.length, 0, 'the held submit already committed; the test proves nothing');

  // Other work lands while the submit is parked.
  const otherSubmit = await api.submitRequest(roomB.roomId, roomB.author.token, {
    item: 'Chair',
    amount: 50,
    reason: 'written during the window',
  });
  assert.equal(otherSubmit.status, 201);
  const newRoom = await api.createRoom({ nickname: 'C1', password: 'pw-c' });
  assert.equal(newRoom.status, 201);

  const heldResult = await held.finish();
  assert.equal(heldResult.status, 201);
  await wait(100);

  const roomBAfter = await api.listRequests(roomB.roomId, roomB.author.token);
  assert.equal(roomBAfter.status, 200, 'room B became unreachable');
  assert.equal(roomBAfter.data.requests.length, 1, 'the concurrent submit was erased');
  assert.equal(roomBAfter.data.requests[0].id, otherSubmit.data.request.id);

  const newRoomAfter = await api.listRequests(newRoom.data.room.id, newRoom.data.token);
  assert.equal(newRoomAfter.status, 200, 'the room created during the window was erased');

  const roomAAfter = await api.listRequests(roomA.roomId, roomA.author.token);
  assert.equal(roomAAfter.data.requests.length, 1, 'the held submit itself was lost');
});
