const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('playwright');
const BASE = 'http://localhost:8787';
const DB = 'D:/approval/approval.sqlite';
const createdRooms = new Set();
const result = {};
async function load(page, expected) { await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 10000 }); await page.waitForSelector(expected, { timeout: 10000 }); }
async function createRoom(page, nickname) { await page.waitForSelector('#homeModal'); await page.locator('#homeCreate').click(); await page.waitForSelector('#roomModal', { timeout: 5000 }); await page.waitForSelector('#roomNickname'); await page.waitForSelector('#roomIdInput'); await page.waitForSelector('#roomPassword'); await page.locator('#roomNickname').fill(nickname); await page.locator('#roomPassword').fill('0826'); const wait = page.waitForResponse(r => r.url().endsWith('/api/rooms') && r.request().method() === 'POST'); await page.locator('#createRoom').click(); const response = await wait; const data = await response.json(); if (response.status() !== 201) throw new Error(`create failed ${response.status()}`); createdRooms.add(data.room.id); return data; }
async function cleanup() { const db = new DatabaseSync(DB); for (const roomId of createdRooms) { for (const table of ['sessions', 'requests', 'members']) db.prepare(`DELETE FROM ${table} WHERE room_id = ?`).run(roomId); db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId); } db.close(); }
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage(); const logs = []; page.on('console', message => logs.push(`console:${message.type()}:${message.text()}`)); page.on('pageerror', error => logs.push(`pageerror:${error.message}`));
  try {
    await load(page, '#homeModal'); result.homeReady = await page.locator('#homeModal').isVisible();
    const first = await createRoom(page, 'Room A'); result.firstCreateStatus = 201;
    await page.locator('#roomButton').click(); await page.locator('#homeRooms').click(); result.oneRoom = (await page.locator('[data-room-index]').count()) === 1;
    const second = await createRoom(page, 'Room B'); result.secondCreateStatus = 201; await page.locator('#roomButton').click(); await page.locator('#homeRooms').click(); result.twoRooms = (await page.locator('[data-room-index]').count()) === 2;
    await page.reload({ waitUntil: 'commit' }); await page.waitForSelector('#newRequest'); await page.locator('#roomButton').click(); await page.locator('#homeRooms').click(); result.refreshKeepsTwo = (await page.locator('[data-room-index]').count()) === 2;
    await page.locator('[data-room-index="1"]').click(); await page.waitForSelector('#newRequest'); result.switchWorks = true;
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem('approval-room-session')).token); await page.locator('#roomButton').click(); await page.locator('#logoutRoom').click(); await page.waitForSelector('#homeModal'); result.logoutLeavesOther = (await page.locator('[data-room-index]').count()) === 1;
    const old = await fetch(BASE + `/api/rooms/${first.id}/requests`, { headers: { Authorization: `Bearer ${token}` } }); result.oldToken401 = old.status === 401;
    const db = new DatabaseSync(DB); result.sqliteRoomsBeforeCleanup = Number(db.prepare('SELECT COUNT(*) AS count FROM rooms').get().count); db.close(); result.noUnexpectedRooms = result.sqliteRoomsBeforeCleanup === 2;
    console.log(JSON.stringify({ ...result, logs }, null, 2));
  } catch (error) { console.error(JSON.stringify({ error: error.message, url: page.url(), logs, body: (await page.locator('body').innerText().catch(() => '')).slice(0, 800) }, null, 2)); process.exitCode = 1; } finally { await browser.close(); await cleanup(); }
})()
