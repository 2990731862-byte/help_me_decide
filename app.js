const API = (location.protocol === 'file:' ? 'http://localhost:8787' : '');
const DEV_MODE = new URLSearchParams(location.search).get('dev') === '1';
const SESSION_KEY = 'approval-room-session';
const ROOMS_KEY = 'approval-room-sessions';
let session = null;
let requests = [];
let filter = 'all';
const $ = (s) => document.querySelector(s);
const text = { pending: '\u7b49\u5f85\u5ba1\u6279', approved: '\u5df2\u6279\u51c6', purchased: '\u5df2\u8d2d\u4e70', rejected: '\u5df2\u9a73\u56de' };
function escapeHtml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function money(value) { return `¥ ${Number(value).toLocaleString('zh-CN')}`; }
function getRoomSessions() { try { const value = JSON.parse(localStorage.getItem(ROOMS_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { localStorage.removeItem(ROOMS_KEY); return []; } }
function saveSession() { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); const rooms = getRoomSessions().filter(item => item.roomId !== session.roomId); rooms.unshift(session); localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms)); }
function loadSession() { try { const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return value && value.roomId && value.member ? value : null; } catch { localStorage.removeItem(SESSION_KEY); return null; } }
async function api(path, options = {}) { const headers = { 'Content-Type': 'application/json', ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}), ...(options.headers || {}) }; const response = await fetch(API + path, { ...options, headers }); const data = await response.json().catch(() => ({})); if (response.status === 401) expireCurrentSession(); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); return data; }
function expireCurrentSession() {
  if (!session) return;
  const expiredRoomId = session.roomId;
  localStorage.removeItem(SESSION_KEY);
  localStorage.setItem(ROOMS_KEY, JSON.stringify(getRoomSessions().filter(item => item.roomId !== expiredRoomId)));
  session = null;
  requests = [];
  render();
  showHome();
}
function currentMember() { return session?.member; }
function isMine(request) { return request.authorId === currentMember()?.id; }
function render() {
  const visible = requests.filter(request => filter === 'all' || request.status === filter);
  $('#requestList').innerHTML = visible.map(request => `<article class="request-card"><div class="category-icon">${request.icon || '✦'}</div><div><h3 class="request-title">${escapeHtml(request.item)}</h3><div class="request-meta"><b>${new Date(request.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</b>　·　由 ${escapeHtml(request.authorName)} 发起</div><div class="reason">“${escapeHtml(request.reason)}”</div>${request.note ? `<div class="reason">朋友说：${escapeHtml(request.note)}</div>` : ''}</div><div class="request-side"><div class="amount">${money(request.amount)}</div><span class="status ${request.status}">${text[request.status] || request.status}</span><div class="approval-buttons">${request.status === 'pending' && !isMine(request) ? `<button class="approve" data-action="approved" data-id="${request.id}">✓ \u6279\u51c6</button><button class="reject" data-action="rejected" data-id="${request.id}">× \u9a73\u56de</button>` : ''}${request.status === 'approved' && isMine(request) ? `<button class="approve" data-action="purchased" data-id="${request.id}">\u6807\u8bb0\u5df2\u8d2d\u4e70</button>` : ''}</div></div></article>`).join('') || '<div class="empty-state">\u8fd8\u6ca1\u6709\u6d88\u8d39\u7533\u8bf7</div>';
  $('#emptyState').hidden = visible.length > 0;
  $('#pendingCount').innerHTML = `${requests.filter(r => r.status === 'pending').length} <small>\u4ef6</small>`;
  $('#approvedTotal').textContent = money(requests.filter(r => r.status === 'approved' || r.status === 'purchased').reduce((sum, r) => sum + Number(r.amount), 0));
  const stats = document.querySelectorAll('.stat-card'); if (stats[2]) stats[2].querySelector('.stat-value').textContent = money(requests.filter(r => r.status === 'purchased').reduce((sum, r) => sum + Number(r.amount), 0));
  if ($('#roleName')) $('#roleName').textContent = session ? `${session.member.nickname} · ${session.roomId}` : '\u672a\u52a0\u5165\u623f\u95f4';
}
async function refresh() { if (!session) { requests = []; render(); return; } try { const data = await api(`/api/rooms/${encodeURIComponent(session.roomId)}/requests`); requests = data.requests; render(); } catch (error) { alert(error.message); } }
function setRoomModal(message = '') {
  let modal = $('#roomModal'); if (!modal) { document.body.insertAdjacentHTML('beforeend', `<div id="roomModal" class="modal-backdrop"><div class="modal-card"><form id="roomForm" onsubmit="return false"><button class="close-button" id="closeRoom">×</button><p class="kicker">SHARED ROOM</p><h2>\u52a0\u5165\u4f60\u4eec\u7684\u5171\u4eab\u7a7a\u95f4</h2><p class="modal-copy">\u521b\u5efa\u623f\u95f4\uff0c\u6216\u7528\u670b\u53cb\u53d1\u6765\u7684\u623f\u95f4 ID \u52a0\u5165\u3002</p><label>\u6635\u79f0<input id="roomNickname" autocomplete="nickname" required></label><label>\u623f\u95f4 ID<input id="roomIdInput" autocomplete="off" placeholder="\u521b\u5efa\u65f6\u53ef\u7559\u7a7a"></label><label>\u5171\u4eab\u5bc6\u7801<input id="roomPassword" type="password" autocomplete="current-password" required></label><div class="room-actions"><button type="button" class="primary-button" id="createRoom">\u521b\u5efa\u623f\u95f4</button><button type="button" class="secondary-button" id="joinRoom">\u52a0\u5165\u623f\u95f4</button><button type="button" class="secondary-button" id="logoutRoom">\\u9000\\u51fa\\u623f\\u95f4</button><button type="button" class="secondary-button" id="homeRooms">\\u6211\\u7684\\u623f\\u95f4</button></div><p id="roomMessage" class="room-hint"></p></form></div></div>`); modal = $('#roomModal'); $('#closeRoom').onclick = () => { modal.hidden = true; }; $('#createRoom').onclick = () => enterRoom(true); $('#joinRoom').onclick = () => enterRoom(false); $('#logoutRoom').hidden = !session; $('#logoutRoom').onclick = async () => { try { await api('/api/logout', { method: 'POST' }); } catch (error) { $('#roomMessage').textContent = error.message; return; } localStorage.removeItem(SESSION_KEY); localStorage.setItem(ROOMS_KEY, JSON.stringify(getRoomSessions().filter(item => item.roomId !== session?.roomId))); session = null; requests = []; modal.hidden = true; render(); showHome(); }; } $('#logoutRoom').hidden = !session; $('#homeRooms').hidden = !session; modal.hidden = false; if (message) $('#roomMessage').textContent = message; }
async function enterRoom(create) { const nickname = $('#roomNickname').value.trim(); const password = $('#roomPassword').value; const roomId = $('#roomIdInput').value.trim(); if (!nickname || !password || (!create && !roomId)) { $('#roomMessage').textContent = '\u8bf7\u586b\u5b8c\u5fc5\u586b\u4fe1\u606f'; return; } try { const data = create ? await api('/api/rooms', { method: 'POST', body: JSON.stringify({ nickname, password }) }) : await api(`/api/rooms/${encodeURIComponent(roomId)}`, { method: 'POST', body: JSON.stringify({ nickname, password }) }); session = { roomId: data.room.id, member: data.member, otherMember: data.room.members.find(item => item.id !== data.member.id) || null, token: data.token }; saveSession(); $('#roomModal').hidden = true; await refresh(); } catch (error) { $('#roomMessage').textContent = error.message; } }
$('#newRequest').addEventListener('click', () => { if (!session) return setRoomModal('\u8bf7\u5148\u52a0\u5165\u623f\u95f4'); $('#modal').hidden = false; $('#itemInput').focus(); });
$('#closeModal').addEventListener('click', () => { $('#modal').hidden = true; $('#requestForm').reset(); });
$('#modal').addEventListener('click', event => { if (event.target.id === 'modal') $('#modal').hidden = true; });
$('#requestForm').addEventListener('submit', async event => { event.preventDefault(); if (!session) return setRoomModal('\u8bf7\u5148\u52a0\u5165\u623f\u95f4'); const amount = Number($('#amountInput').value); if (!Number.isFinite(amount) || amount <= 0) return alert('\u8bf7\u8f93\u5165\u6709\u6548\u91d1\u989d'); try { await api(`/api/rooms/${encodeURIComponent(session.roomId)}/requests`, { method: 'POST', body: JSON.stringify({ memberId: session.member.id, item: $('#itemInput').value.trim(), amount, reason: $('#reasonInput').value.trim() }) }); $('#modal').hidden = true; event.target.reset(); await refresh(); } catch (error) { alert(error.message); } });
$('#requestList').addEventListener('click', async event => { const button = event.target.closest('button[data-action]'); if (!button || !session) return; const payload = { memberId: session.member.id, action: button.dataset.action }; if (payload.action === 'rejected') { const note = prompt('\u8bf7\u586b\u5199\u9a73\u56de\u7406\u7531'); if (!note || !note.trim()) return; payload.note = note.trim(); } try { await api(`/api/rooms/${encodeURIComponent(session.roomId)}/requests/${encodeURIComponent(button.dataset.id)}`, { method: 'PATCH', body: JSON.stringify(payload) }); await refresh(); } catch (error) { alert(error.message); } });
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('.filter').forEach(item => item.classList.remove('active')); button.classList.add('active'); filter = button.dataset.filter; render(); }));
$('#roleToggle').addEventListener('click', () => { if (!DEV_MODE || !session || !session.otherMember) return; const current = session.member; session.member = session.otherMember; session.otherMember = current; saveSession(); render(); });
const roleToggle = $('#roleToggle');
if (!DEV_MODE && roleToggle) roleToggle.hidden = true;
if (roleToggle && !$('#roomButton')) {
  const roomButton = document.createElement('button');
  roomButton.id = 'roomButton';
  roomButton.className = 'room-button';
  roomButton.textContent = '\u623f\u95f4\u8bbe\u7f6e';
  roleToggle.after(roomButton);
  roomButton.addEventListener('click', () => setRoomModal());
}
session = loadSession(); ensureRoomModal(); render(); if (session) refresh(); else showHome();





function showHome() {
  let home = $('#homeModal');
  if (!home) {
    document.body.insertAdjacentHTML('beforeend', '<div id="homeModal" class="modal-backdrop"><div class="modal-card"><p class="kicker">MY ROOMS</p><h2>\u6211\u7684\u623f\u95f4</h2><p class="modal-copy">\u6bcf\u4e2a\u623f\u95f4\u90fd\u53ef\u4ee5\u548c\u4e0d\u540c\u7684\u670b\u53cb\u4e00\u8d77\u4f7f\u7528\u3002</p><div id="roomList"></div><div class="room-actions"><button type="button" class="primary-button" id="homeCreate">\u521b\u5efa\u65b0\u623f\u95f4</button><button type="button" class="secondary-button" id="homeJoin">\u52a0\u5165\u623f\u95f4</button></div></div></div>');
    home = $('#homeModal');
    $('#homeCreate').onclick = () => { home.hidden = true; setRoomModal(); };
    $('#homeJoin').onclick = () => { home.hidden = true; setRoomModal(); };
  }
  const rooms = getRoomSessions();
  $('#roomList').innerHTML = rooms.length ? rooms.map((item, index) => `<div class="room-entry"><strong>${escapeHtml(item.roomId)}</strong><span>${escapeHtml(item.member.nickname)} · \u70b9\u51fb\u8fdb\u5165</span><button type="button" data-room-index="${index}">\u8fdb\u5165</button></div>`).join('') : '<div class="room-hint">\u8fd8\u6ca1\u6709\u623f\u95f4\uff0c\u5148\u521b\u5efa\u6216\u52a0\u5165\u4e00\u4e2a\u5427\u3002</div>';
  document.querySelectorAll('[data-room-index]').forEach(button => button.onclick = () => { session = rooms[Number(button.dataset.roomIndex)]; saveSession(); home.hidden = true; render(); refresh(); });
  home.hidden = false;
}
document.addEventListener('click', event => { if (event.target.id === 'homeRooms') { const modal = $('#roomModal'); if (modal) modal.hidden = true; showHome(); } });



function ensureRoomModal() {
  if (!$('#roomModal')) {
    setRoomModal();
    const modal = $('#roomModal');
    if (modal) modal.hidden = true;
  }
}

