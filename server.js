const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const DATA_FILE = process.env.APPROVAL_LEGACY_DATA || path.join(ROOT, 'data.json');
const DB_FILE = process.env.APPROVAL_DB_PATH || path.join(ROOT, 'approval.sqlite');
const EMPTY_DB = { rooms: [], sessions: [] };
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const sqlite = new DatabaseSync(DB_FILE);

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
  });
  res.end(JSON.stringify(body));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 100000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid json'));
      }
    });
  });
}
function sendError(res, status, message) {
  json(res, status, { error: message });
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}
function samePassword(password, record) {
  const actual = hashPassword(password, record.salt).hash;
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(record.hash, 'hex'));
}
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}
function id(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}
function getToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}
function issueSession(db, roomId, memberId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  db.sessions.push({
    tokenHash: hashToken(token),
    roomId,
    memberId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  });
  return token;
}
function getSession(req, db, roomId) {
  const token = getToken(req);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = db.sessions.find(item => item.tokenHash === tokenHash);
  if (!session || session.roomId !== roomId) return null;
  if (!session.expiresAt || Date.parse(session.expiresAt) <= Date.now()) {
    sqlite.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return session;
}
function cleanRoom(room) {
  return {
    id: room.id,
    createdAt: room.createdAt,
    members: room.members.map(({ id, nickname }) => ({ id, nickname })),
    requestCount: room.requests.length,
  };
}
function cleanRequest(request) {
  return { ...request };
}
function findRoom(db, roomId) {
  return db.rooms.find(room => room.id === roomId);
}

sqlite.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, nickname TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL, item TEXT NOT NULL, amount REAL NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, room_id TEXT NOT NULL, member_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);`);

const sessionColumns = sqlite
  .prepare('PRAGMA table_info(sessions)')
  .all()
  .map(column => column.name);
if (!sessionColumns.includes('expires_at'))
  sqlite.exec('ALTER TABLE sessions ADD COLUMN expires_at TEXT');
function parseLegacyDb() {
  try {
    const raw = fs
      .readFileSync(DATA_FILE, 'utf8')
      .replace(/^\uFEFF/, '')
      .trim();
    const value = raw ? JSON.parse(raw) : EMPTY_DB;
    return value && Array.isArray(value.rooms)
      ? { rooms: value.rooms, sessions: Array.isArray(value.sessions) ? value.sessions : [] }
      : EMPTY_DB;
  } catch (error) {
    console.error('Legacy database read failed:', error.message);
    return EMPTY_DB;
  }
}
function readDb() {
  const rooms = sqlite
    .prepare('SELECT id, created_at, password_salt, password_hash FROM rooms')
    .all()
    .map(row => ({
      id: row.id,
      createdAt: row.created_at,
      password: { salt: row.password_salt, hash: row.password_hash },
      members: [],
      requests: [],
    }));
  const members = sqlite.prepare('SELECT id, room_id, nickname FROM members').all();
  const requests = sqlite
    .prepare(
      'SELECT id, room_id, author_id, author_name, item, amount, reason, status, note, created_at, decided_at FROM requests',
    )
    .all();
  const sessions = sqlite
    .prepare('SELECT token_hash, room_id, member_id, created_at, expires_at FROM sessions')
    .all()
    .map(row => ({
      tokenHash: row.token_hash,
      roomId: row.room_id,
      memberId: row.member_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));
  for (const member of members) {
    const room = rooms.find(item => item.id === member.room_id);
    if (room) room.members.push({ id: member.id, nickname: member.nickname });
  }
  for (const request of requests) {
    const room = rooms.find(item => item.id === request.room_id);
    if (room)
      room.requests.push({
        id: request.id,
        authorId: request.author_id,
        authorName: request.author_name,
        item: request.item,
        amount: request.amount,
        reason: request.reason,
        status: request.status,
        note: request.note,
        createdAt: request.created_at,
        decidedAt: request.decided_at,
      });
  }
  return { rooms, sessions };
}
function writeDb(db) {
  const safeDb = {
    rooms: Array.isArray(db.rooms) ? db.rooms : [],
    sessions: Array.isArray(db.sessions) ? db.sessions : [],
  };
  sqlite.exec('BEGIN');
  try {
    sqlite.exec(
      'DELETE FROM sessions; DELETE FROM requests; DELETE FROM members; DELETE FROM rooms;',
    );
    const roomInsert = sqlite.prepare(
      'INSERT INTO rooms (id, created_at, password_salt, password_hash) VALUES (?, ?, ?, ?)',
    );
    const memberInsert = sqlite.prepare(
      'INSERT INTO members (id, room_id, nickname) VALUES (?, ?, ?)',
    );
    const requestInsert = sqlite.prepare(
      'INSERT INTO requests (id, room_id, author_id, author_name, item, amount, reason, status, note, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const sessionInsert = sqlite.prepare(
      'INSERT INTO sessions (token_hash, room_id, member_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    );
    for (const room of safeDb.rooms) {
      roomInsert.run(room.id, room.createdAt, room.password.salt, room.password.hash);
      for (const member of room.members || [])
        memberInsert.run(member.id, room.id, member.nickname);
      for (const request of room.requests || [])
        requestInsert.run(
          request.id,
          room.id,
          request.authorId,
          request.authorName,
          request.item,
          request.amount,
          request.reason,
          request.status,
          request.note || '',
          request.createdAt,
          request.decidedAt || null,
        );
    }
    for (const session of safeDb.sessions)
      sessionInsert.run(
        session.tokenHash,
        session.roomId,
        session.memberId,
        session.createdAt,
        session.expiresAt || new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      );
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}
function migrateLegacyDb() {
  const count = Number(sqlite.prepare('SELECT COUNT(*) AS count FROM rooms').get().count);
  if (count === 0 && fs.existsSync(DATA_FILE)) writeDb(parseLegacyDb());
}
migrateLegacyDb();

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health')
      return json(res, 200, { ok: true, service: 'approval-room', storage: 'sqlite' });
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const token = getToken(req);
      if (!token) return sendError(res, 401, 'authentication required');
      const result = sqlite
        .prepare('DELETE FROM sessions WHERE token_hash = ?')
        .run(hashToken(token));
      if (Number(result.changes) !== 1) return sendError(res, 401, 'invalid session');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/rooms') {
      const input = await body(req);
      if (!input.nickname || !input.password)
        return sendError(res, 400, 'nickname and password are required');
      const member = { id: id('member'), nickname: String(input.nickname).trim().slice(0, 40) };
      const password = hashPassword(input.password);
      const room = {
        id: id('room'),
        createdAt: new Date().toISOString(),
        password,
        members: [member],
        requests: [],
      };
      const db = readDb();
      db.rooms.push(room);
      const token = issueSession(db, room.id, member.id);
      writeDb(db);
      return json(res, 201, { room: cleanRoom(room), member, token });
    }
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (req.method === 'POST' && roomMatch) {
      const input = await body(req);
      const db = readDb();
      const room = findRoom(db, roomMatch[1]);
      if (!room) return sendError(res, 404, 'room not found');
      if (!input.nickname || !input.password || !samePassword(input.password, room.password))
        return sendError(res, 401, 'invalid room password');
      if (room.members.length >= 2) return sendError(res, 409, 'room is full');
      const member = { id: id('member'), nickname: String(input.nickname).trim().slice(0, 40) };
      room.members.push(member);
      const token = issueSession(db, room.id, member.id);
      writeDb(db);
      return json(res, 200, { room: cleanRoom(room), member, token });
    }
    const requestsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/requests$/);
    if (requestsMatch) {
      const db = readDb();
      const room = findRoom(db, requestsMatch[1]);
      if (!room) return sendError(res, 404, 'room not found');
      const auth = getSession(req, db, room.id);
      if (!auth) return sendError(res, 401, 'authentication required');
      if (req.method === 'GET')
        return json(res, 200, { requests: room.requests.map(cleanRequest) });
      if (req.method === 'POST') {
        const input = await body(req);
        // writeDb() rebuilds every table from the snapshot it is handed, so the snapshot has to be
        // taken after the body arrives: anything written while this handler waited would be erased.
        const fresh = readDb();
        const freshRoom = findRoom(fresh, requestsMatch[1]);
        if (!freshRoom) return sendError(res, 404, 'room not found');
        // Re-check the session against the same fresh snapshot: a logout during the wait must not
        // be able to submit.
        const freshAuth = getSession(req, fresh, freshRoom.id);
        if (!freshAuth) return sendError(res, 401, 'authentication required');
        const member = freshRoom.members.find(item => item.id === freshAuth.memberId);
        const amount = Number(input.amount);
        if (!member || !input.item || !input.reason || !Number.isFinite(amount) || amount <= 0)
          return sendError(res, 400, 'invalid request');
        const request = {
          id: id('request'),
          authorId: member.id,
          authorName: member.nickname,
          item: String(input.item).trim().slice(0, 100),
          amount,
          reason: String(input.reason).trim().slice(0, 1000),
          status: 'pending',
          note: '',
          createdAt: new Date().toISOString(),
          decidedAt: null,
        };
        freshRoom.requests.unshift(request);
        writeDb(fresh);
        return json(res, 201, { request });
      }
    }
    const decisionMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/requests\/([^/]+)$/);
    if (req.method === 'PATCH' && decisionMatch) {
      const input = await body(req);
      const db = readDb();
      const room = findRoom(db, decisionMatch[1]);
      if (!room) return sendError(res, 404, 'room not found');
      const auth = getSession(req, db, room.id);
      if (!auth) return sendError(res, 401, 'authentication required');
      const request = room.requests.find(item => item.id === decisionMatch[2]);
      if (!request) return sendError(res, 404, 'request not found');
      const actor = room.members.find(item => item.id === auth.memberId);
      if (!actor) return sendError(res, 401, 'member not found');
      if (input.action === 'approved' || input.action === 'rejected') {
        if (request.status !== 'pending') return sendError(res, 409, 'request already decided');
        if (request.authorId === actor.id)
          return sendError(res, 403, 'cannot approve your own request');
        if (input.action === 'rejected' && !String(input.note || '').trim())
          return sendError(res, 400, 'rejection note is required');
        request.status = input.action;
        request.note = String(input.note || '')
          .trim()
          .slice(0, 1000);
        request.decidedAt = new Date().toISOString();
      } else if (input.action === 'purchased') {
        if (request.authorId !== actor.id || request.status !== 'approved')
          return sendError(res, 403, 'only the author can mark an approved request as purchased');
        request.status = 'purchased';
      } else return sendError(res, 400, 'unsupported action');
      writeDb(db);
      return json(res, 200, { request });
    }
    if (req.method === 'GET' && url.pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    if (
      req.method === 'GET' &&
      ['/', '/index.html', '/style.css', '/app.js'].includes(url.pathname)
    ) {
      const files = {
        '/': ['index.html', 'text/html; charset=utf-8'],
        '/index.html': ['index.html', 'text/html; charset=utf-8'],
        '/style.css': ['style.css', 'text/css; charset=utf-8'],
        '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
      };
      const [fileName, contentType] = files[url.pathname];
      res.writeHead(200, { 'Content-Type': contentType });
      return res.end(fs.readFileSync(path.join(ROOT, fileName)));
    }
    return sendError(res, 404, 'not found');
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'internal server error');
  }
});
server.listen(PORT, () => console.log(`Approval room API listening on http://localhost:${PORT}`));
process.on('SIGINT', () => {
  sqlite.close();
  process.exit(0);
});
