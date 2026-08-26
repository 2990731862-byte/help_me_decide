const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('playwright');
const BASE = 'http://localhost:8787';
const DB = 'D:/approval/approval.sqlite';
async function api(path, options) { const response = await fetch(BASE + path, options); return { status: response.status, data: await response.json().catch(() => ({})) }; }
function reset() { const db = new DatabaseSync(DB); for (const table of ['sessions', 'requests', 'members', 'rooms']) db.exec('DELETE FROM ' + table); db.close(); }
(async () => {
  reset();
  const first = await api('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Expiry A', password: '0826' }) });
  const second = await api('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Expiry B', password: '0826' }) });
  const roomA = first.data.room.id, tokenA = first.data.token, memberA = first.data.member;
  const roomB = second.data.room.id, tokenB = second.data.token;
  const db = new DatabaseSync(DB);
  const firstSession = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(require('crypto').createHash('sha256').update(tokenA).digest('hex'));
  const initialExpiryExists = !!firstSession?.expires_at;
  const valid = await api(`/api/rooms/${roomA}/requests`, { headers: { Authorization: `Bearer ${tokenA}` } });
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run('2000-01-01T00:00:00.000Z', require('crypto').createHash('sha256').update(tokenA).digest('hex'));
  db.close();
  const expired = await api(`/api/rooms/${roomA}/requests`, { headers: { Authorization: `Bearer ${tokenA}` } });
  const afterExpiry = new DatabaseSync(DB); const removed = !afterExpiry.prepare('SELECT token_hash FROM sessions WHERE token_hash = ?').get(require('crypto').createHash('sha256').update(tokenA).digest('hex')); afterExpiry.close();
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage(); await page.goto(BASE + '/', { waitUntil: 'commit' }); await page.evaluate(s => localStorage.setItem('approval-room-session', s), JSON.stringify({ roomId: roomA, member: memberA, token: tokenA })); await page.reload({ waitUntil: 'commit' }); await page.locator('#homeModal').waitFor({ state: 'visible', timeout: 5000 }); const frontendCleared = await page.evaluate(() => localStorage.getItem('approval-room-session') === null); await browser.close();
  const secondStillWorks = await api(`/api/rooms/${roomB}/requests`, { headers: { Authorization: `Bearer ${tokenB}` } });
  console.log(JSON.stringify({ tokenHasExpiry: initialExpiryExists, validTokenStatus: valid.status, expiredTokenStatus: expired.status, expiredSessionRemoved: removed, frontendReturnedHome: frontendCleared, otherRoomUnaffected: secondStillWorks.status === 200 }, null, 2));
  reset();
})().catch(error => { console.error(error.stack); process.exitCode = 1; reset(); });
