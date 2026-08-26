const fs = require('fs');
const { chromium } = require('playwright');
const BASE = 'http://localhost:8787';
const DATA = 'D:/approval/data.json';
const results = {};
const createdRooms = new Set();
async function api(path, options) { const response = await fetch(BASE + path, options); return { status: response.status, data: await response.json().catch(() => ({})) }; }
async function load(page, hasSession = false) { await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 10000 }); await page.waitForSelector(hasSession ? '#newRequest' : '#homeModal', { timeout: 10000 }); }
async function createRoom(page, nickname) { await page.locator('#homeCreate').click(); await page.locator('#roomNickname').fill(nickname); await page.locator('#roomPassword').fill('0826'); const wait = page.waitForResponse(r => r.url().endsWith('/api/rooms') && r.request().method() === 'POST'); await page.locator('#createRoom').click(); const response = await wait; if (response.status() !== 201) throw new Error(`create room failed: ${response.status()}`); const data = await response.json(); createdRooms.add(data.room.id); return data; }
async function cleanup() { const db = JSON.parse(fs.readFileSync(DATA, 'utf8').replace(/^\uFEFF/, '')); db.rooms = db.rooms.filter(room => !createdRooms.has(room.id)); db.sessions = db.sessions.filter(session => !createdRooms.has(session.roomId)); fs.writeFileSync(DATA, JSON.stringify(db, null, 2), 'utf8'); }
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage(); await load(page);
    const first = await createRoom(page, 'Room A');
    await page.locator('#roomButton').click(); await page.locator('#homeRooms').click();
    results.afterFirstRoom = (await page.locator('[data-room-index]').count()) === 1;
    const second = await createRoom(page, 'Room B');
    await page.locator('#roomButton').click(); await page.locator('#homeRooms').click();
    results.twoRoomsBeforeRefresh = (await page.locator('[data-room-index]').count()) === 2;
    await page.reload({ waitUntil: 'commit' }); await page.waitForSelector('#newRequest'); await page.locator('#roomButton').click(); await page.locator('#homeRooms').click();
    results.refreshKeepsTwoRooms = (await page.locator('[data-room-index]').count()) === 2;
    await page.locator('[data-room-index="1"]').click(); await page.waitForSelector('#newRequest');
    results.switchRoomWorks = true;
    const oldToken = await page.evaluate(() => JSON.parse(localStorage.getItem('approval-room-session')).token);
    await page.locator('#roomButton').click(); await page.locator('#logoutRoom').click(); await page.waitForSelector('#homeModal');
    results.logoutLeavesOtherRoom = (await page.locator('[data-room-index]').count()) === 1;
    results.oldTokenStatus = (await api(`/api/rooms/${first.room.id}/requests`, { headers: { Authorization: `Bearer ${oldToken}` } })).status;
    results.oldTokenInvalidated = results.oldTokenStatus === 401;
    await page.locator('[data-room-index="0"]').click(); await page.waitForSelector('#newRequest'); results.remainingRoomEnterWorks = true;
    const db = JSON.parse(fs.readFileSync(DATA, 'utf8').replace(/^\uFEFF/, ''));
    results.serverRoomCountBeforeCleanup = db.rooms.filter(room => createdRooms.has(room.id)).length;
    results.noDuplicateRooms = results.serverRoomCountBeforeCleanup === 2;
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); await cleanup(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
