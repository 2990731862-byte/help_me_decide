// Thin API client so tests read as product rules, not as fetch plumbing.
function makeClient(baseUrl) {
  async function call(method, apiPath, { token, body } = {}) {
    const response = await fetch(baseUrl + apiPath, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    return { status: response.status, data };
  }

  return {
    call,
    health: () => call('GET', '/api/health'),
    createRoom: body => call('POST', '/api/rooms', { body }),
    joinRoom: (roomId, body) => call('POST', `/api/rooms/${roomId}`, { body }),
    listRequests: (roomId, token) => call('GET', `/api/rooms/${roomId}/requests`, { token }),
    submitRequest: (roomId, token, body) => call('POST', `/api/rooms/${roomId}/requests`, { token, body }),
    decide: (roomId, requestId, token, body) =>
      call('PATCH', `/api/rooms/${roomId}/requests/${requestId}`, { token, body }),
    logout: token => call('POST', '/api/logout', { token }),
  };
}

// A room with both members joined — the starting state for most product rules.
async function seedRoom(api, { password = 'test-pass-0826', a = 'Ann', b = 'Ben' } = {}) {
  const created = await api.createRoom({ nickname: a, password });
  if (created.status !== 201) throw new Error(`seed: createRoom returned ${created.status}`);
  const roomId = created.data.room.id;
  const joined = await api.joinRoom(roomId, { nickname: b, password });
  if (joined.status !== 200) throw new Error(`seed: joinRoom returned ${joined.status}`);
  return {
    roomId,
    password,
    author: { token: created.data.token, member: created.data.member },
    partner: { token: joined.data.token, member: joined.data.member },
  };
}

module.exports = { makeClient, seedRoom };
