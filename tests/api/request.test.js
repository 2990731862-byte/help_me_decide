// Product rules covered: a member submits item + amount + required reason;
// nobody approves their own request; rejection requires a reason;
// the author marks an approved request as purchased.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server.js');
const { makeClient, seedRoom } = require('../helpers/client.js');

const VALID = { item: 'Standing desk', amount: 1299.5, reason: 'Back pain' };

test('requests', async t => {
  const server = await startServer();
  const api = makeClient(server.baseUrl);
  t.after(() => server.stop());

  const submitted = async () => {
    const room = await seedRoom(api);
    const created = await api.submitRequest(room.roomId, room.author.token, VALID);
    assert.equal(created.status, 201);
    return { room, request: created.data.request };
  };

  await t.test('a submitted request starts pending and is readable', async () => {
    const { room, request } = await submitted();
    assert.equal(request.status, 'pending');
    assert.equal(request.item, VALID.item);
    assert.equal(request.amount, VALID.amount);
    assert.equal(request.reason, VALID.reason);
    assert.equal(request.authorId, room.author.member.id);
    assert.equal(request.note, '');
    assert.equal(request.decidedAt, null);

    const listed = await api.listRequests(room.roomId, room.partner.token);
    assert.equal(listed.data.requests.length, 1);
    assert.equal(listed.data.requests[0].id, request.id);
  });

  // README: "Each member can submit an item, amount, and required reason."
  await t.test('item, reason and a positive numeric amount are all required', async () => {
    const room = await seedRoom(api);
    const bad = [
      { ...VALID, item: '' },
      { ...VALID, reason: '' },
      { ...VALID, amount: 0 },
      { ...VALID, amount: -5 },
      { ...VALID, amount: 'a lot' },
      { item: VALID.item },
    ];
    for (const body of bad) {
      const { status } = await api.submitRequest(room.roomId, room.author.token, body);
      assert.equal(status, 400, `expected 400 for ${JSON.stringify(body)}`);
    }
  });

  await t.test('submitting without a token is rejected', async () => {
    const room = await seedRoom(api);
    assert.equal((await api.submitRequest(room.roomId, undefined, VALID)).status, 401);
  });

  // README: "The server ignores forged member IDs and uses the authenticated
  // session member." Asserted here for the first time.
  await t.test('a forged memberId in the body is ignored', async () => {
    const room = await seedRoom(api);
    const created = await api.submitRequest(room.roomId, room.author.token, {
      ...VALID,
      memberId: room.partner.member.id,
      authorId: room.partner.member.id,
      authorName: room.partner.member.nickname,
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.request.authorId, room.author.member.id);
    assert.equal(created.data.request.authorName, room.author.member.nickname);
  });

  // README: "A member cannot approve their own request." The old suite only
  // checked that the UI button was hidden, which a direct PATCH bypasses.
  await t.test('the author cannot approve or reject their own request', async () => {
    const { room, request } = await submitted();
    const approved = await api.decide(room.roomId, request.id, room.author.token, {
      action: 'approved',
    });
    assert.equal(approved.status, 403);
    assert.equal(approved.data.error, 'cannot approve your own request');

    const rejected = await api.decide(room.roomId, request.id, room.author.token, {
      action: 'rejected',
      note: 'no',
    });
    assert.equal(rejected.status, 403);

    const listed = await api.listRequests(room.roomId, room.author.token);
    assert.equal(listed.data.requests[0].status, 'pending', 'status changed despite the 403');
  });

  await t.test('the partner approves a pending request', async () => {
    const { room, request } = await submitted();
    const approved = await api.decide(room.roomId, request.id, room.partner.token, {
      action: 'approved',
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.request.status, 'approved');
    assert.ok(approved.data.request.decidedAt);
  });

  // README: "Rejection requires a reason."
  await t.test('rejecting without a reason is refused, with one it is stored', async () => {
    const blank = await submitted();
    for (const body of [{ action: 'rejected' }, { action: 'rejected', note: '   ' }]) {
      const refused = await api.decide(
        blank.room.roomId,
        blank.request.id,
        blank.room.partner.token,
        body,
      );
      assert.equal(refused.status, 400);
      assert.equal(refused.data.error, 'rejection note is required');
    }

    const rejected = await api.decide(
      blank.room.roomId,
      blank.request.id,
      blank.room.partner.token,
      {
        action: 'rejected',
        note: 'Too expensive this month',
      },
    );
    assert.equal(rejected.status, 200);
    assert.equal(rejected.data.request.status, 'rejected');
    assert.equal(rejected.data.request.note, 'Too expensive this month');
  });

  await t.test('a decided request cannot be decided again', async () => {
    const { room, request } = await submitted();
    await api.decide(room.roomId, request.id, room.partner.token, { action: 'approved' });
    const again = await api.decide(room.roomId, request.id, room.partner.token, {
      action: 'rejected',
      note: 'changed my mind',
    });
    assert.equal(again.status, 409);
  });

  await t.test('only the author marks an approved request purchased', async () => {
    const { room, request } = await submitted();
    await api.decide(room.roomId, request.id, room.partner.token, { action: 'approved' });

    const byPartner = await api.decide(room.roomId, request.id, room.partner.token, {
      action: 'purchased',
    });
    assert.equal(byPartner.status, 403);

    const byAuthor = await api.decide(room.roomId, request.id, room.author.token, {
      action: 'purchased',
    });
    assert.equal(byAuthor.status, 200);
    assert.equal(byAuthor.data.request.status, 'purchased');
  });

  await t.test('a pending request cannot be marked purchased', async () => {
    const { room, request } = await submitted();
    const early = await api.decide(room.roomId, request.id, room.author.token, {
      action: 'purchased',
    });
    assert.equal(early.status, 403);
  });

  await t.test('an unsupported action is a 400, a missing request a 404', async () => {
    const { room, request } = await submitted();
    assert.equal(
      (await api.decide(room.roomId, request.id, room.partner.token, { action: 'shipped' })).status,
      400,
    );
    assert.equal(
      (
        await api.decide(room.roomId, 'request_deadbeef', room.partner.token, {
          action: 'approved',
        })
      ).status,
      404,
    );
  });
});
