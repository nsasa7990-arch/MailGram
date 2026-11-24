const $ = s => document.querySelector(s);
const esc = s => String(s || '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const DEFAULT_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://w3.org' width='80' height='80'><rect width='80' height='80' fill='%232b5278'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' fill='white' font-size='32' font-family='sans-serif'>👤</text></svg>";

const badgeHtml = u => u?.verified ? '<span class="verified-badge" title="Подтверждённый аккаунт">✓</span>' : '';
const tagsHtml = u => {
  let out = '';
  if (u?.username) out += `<span class="tag-user">@${esc(u.username)}</span>`;
  if (u?.nft_username) out += `<span class="tag-nft">💎 @${esc(u.nft_username)}</span>`;
  return out;
};

const state = {
  token: localStorage.getItem('token'),
  user: null, socket: null, chats: [], activeChat: null, shop: [], giftTargetUserId: null
};

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const res = await fetch('/api' + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

const authScreen = $('#auth'), appScreen = $('#app'), authMsg = $('#authMsg');

document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
  $('#loginForm').classList.toggle('hidden', t.dataset.tab !== 'login');
  $('#registerForm').classList.toggle('hidden', t.dataset.tab !== 'register');
  authMsg.textContent = '';
});

$('#registerForm').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  try {
    const data = await api('/register', { method: 'POST', body: JSON.stringify({
      name: f.name.value, email: f.email.value, password: f.password.value
    })});
    login(data);
  } catch (err) { authMsg.textContent = err.message; }
};

$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  try {
    const data = await api('/login', { method: 'POST', body: JSON.stringify({
      email: f.email.value, password: f.password.value
    })});
    login(data);
  } catch (err) { authMsg.textContent = err.message; }
};

function login(data) {
  state.token = data.token;
  localStorage.setItem('token', data.token);
  state.user = data.user;
  enterApp();
}

function logout() {
  localStorage.removeItem('token');
  location.reload();
}
$('#logoutBtn').onclick = logout;

function renderMeBar() {
  $('#meAvatar').src = state.user.avatar || DEFAULT_AVATAR;
  $('#meName').innerHTML = esc(state.user.name) + badgeHtml(state.user);
  $('#meSub').textContent = `${state.user.stars} ⭐`;
}

async function enterApp() {
  authScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  renderMeBar();
  connectSocket();
  state.shop = await api('/gifts/shop');
  await loadChats();
}

function connectSocket() {
  state.socket = io({ auth: { token: state.token } });
  state.socket.on('message', msg => {
    if (state.activeChat && msg.chat_id === state.activeChat.id) appendMessage(msg);
  });
  state.socket.on('chat:update', u => {
    const chat = state.chats.find(c => c.id === u.chatId);
    if (chat) { chat.lastText = u.lastText; chat.lastAt = u.lastAt; renderChats(); }
    else loadChats();
  });
}

async function loadChats() {
  state.chats = await api('/chats');
  renderChats();
}

function renderChats() {
  const list = $('#chatList');
  list.innerHTML = '';
  state.chats.sort((a, b) => b.lastAt - a.lastAt);
  for (const c of state.chats) {
    const el = document.createElement('div');
    el.className = 'chat-item' + (state.activeChat?.id === c.id ? ' active' : '');
    el.innerHTML = `<div class="ci-title">${esc(c.title)}${badgeHtml(c.peer)}</div>
                    <div class="ci-last">${esc(c.lastText || 'Нет сообщений')}</div>`;
    el.onclick = () => openChat(c);
    list.appendChild(el);
  }
}

$('#mobileBackBtn').onclick = e => {
  e.stopPropagation();
  $('#app').classList.remove('chat-open');
  state.activeChat = null;
  renderChats();
};

async function openChat(chat) {
  state.activeChat = chat;
  $('#app').classList.add('chat-open');
  const av = $('#chatHeaderAvatar');
  if (chat.peer) {
    av.src = chat.peer.avatar || DEFAULT_AVATAR;
    av.classList.remove('hidden');
  } else {
    av.classList.add('hidden');
  }
  $('#chatHeaderTitle').innerHTML = esc(chat.title) + badgeHtml(chat.peer);
  renderChats();
  state.socket.emit('join', chat.id);
  const msgs = await api('/messages/' + chat.id);
  const box = $('#messages');
  box.innerHTML = '';
  msgs.forEach(appendMessage);
  box.scrollTop = box.scrollHeight;
}
function appendMessage(m) {
  const box = $('#messages');
  const el = document.createElement('div');
  el.className = 'msg' + (m.user_id === state.user.id ? ' mine' : '');
  if (m.gift) {
    el.innerHTML = `<div class="bubble gift-bubble">
      <span class="gift-emoji">${m.gift.emoji}</span>
      <div style="font-weight:700">${esc(m.gift.name)}</div>
      <div class="gift-label">Подарок от ${esc(m.user_name)}</div>
    </div>`;
  } else {
    el.innerHTML = `<div class="bubble">
      <div class="author">${esc(m.user_name)}</div>
      <div class="text">${esc(m.text)}</div>
    </div>`;
  }
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

$('#sendForm').onsubmit = e => {
  e.preventDefault();
  const input = $('#msgInput');
  const text = input.value.trim();
  if (!text || !state.activeChat) return;
  state.socket.emit('message', { chatId: state.activeChat.id, text });
  input.value = '';
};

$('#newChatForm').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  try {
    const { id } = await api('/chats', { method: 'POST', body: JSON.stringify({ query: f.query.value }) });
    f.reset();
    await loadChats();
    const chat = state.chats.find(c => c.id === id);
    if (chat) openChat(chat);
  } catch (err) { alert(err.message); }
};

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.onclick = () => $('#' + btn.dataset.close).classList.add('hidden');
});

function renderGiftsGrid(container, gifts) {
  container.innerHTML = gifts.length ? '' : '<div style="color:#666;font-size:13px">Пока нет подарков</div>';
  for (const g of gifts) {
    const card = document.createElement('div');
    card.className = 'gift-card';
    card.innerHTML = `<div class="g-ico">${g.emoji || '🎁'}</div>
      <div class="g-name">${esc(g.name)}</div>
      <div class="g-sub">от ${esc(g.from_name)}</div>`;
    container.appendChild(card);
  }
}

$('#openMyProfile').onclick = async () => {
  const { user, gifts } = await api('/users/' + state.user.id);
  state.user = user;
  renderMeBar();

  $('#profAvatar').src = user.avatar || DEFAULT_AVATAR;
  $('#profNameTitle').innerHTML = esc(user.name) + badgeHtml(user);
  $('#profUsernames').innerHTML = tagsHtml(user);
  $('#profBioText').textContent = user.bio || 'Нет описания';
  $('#profStars').textContent = user.stars;
  $('#myGiftsCount').textContent = gifts.length;
  renderGiftsGrid($('#myGiftsGrid'), gifts);
  $('#myProfileModal').classList.remove('hidden');
};

function openSettingsModal() {
  $('#setAvatar').src = state.user.avatar || DEFAULT_AVATAR;
  $('#setNameInput').value = state.user.name;
  $('#setBioInput').value = state.user.bio || '';
  $('#setUsernameInput').value = state.user.username || '';
  $('#setPassInput').value = '';

  if (state.user.isAdmin) {
    $('#adminPanel').classList.remove('hidden');
    $('#admEmail').value = state.user.email;
    $('#admVerified').checked = state.user.verified;
  } else {
    $('#adminPanel').classList.add('hidden');
  }
  $('#settingsModal').classList.remove('hidden');
}

$('#openSettingsBtn').onclick = openSettingsModal;
$('#goSettingsFromProf').onclick = () => {
  $('#myProfileModal').classList.add('hidden');
  openSettingsModal();
};

$('#avatarInput').onchange = e => {
  const file = e.target.files.item(0);
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const updated = await api('/profile', { method: 'POST', body: JSON.stringify({ avatar: reader.result }) });
      state.user = updated;
      $('#setAvatar').src = updated.avatar;
      renderMeBar();
    } catch (err) { alert(err.message); }
  };
  reader.readAsDataURL(file);
};

$('#settingsForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const updated = await api('/profile', { method: 'POST', body: JSON.stringify({
      name: $('#setNameInput').value,
      bio: $('#setBioInput').value,
      username: $('#setUsernameInput').value,
      password: $('#setPassInput').value
    })});
    state.user = updated;
    renderMeBar();
    $('#setPassInput').value = '';
    alert('Настройки сохранены!');
  } catch (err) { alert(err.message); }
};

$('#adminForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const res = await api('/admin/grant', { method: 'POST', body: JSON.stringify({
      email: $('#admEmail').value,
      stars: Number($('#admStars').value || 0),
      username: $('#admUsername').value,
      nft_username: $('#admNft').value,
      verified: $('#admVerified').checked
    })});
    if (res.user.id === state.user.id) {
      state.user = res.user;
      renderMeBar();
    }
    alert('Права / звёзды успешно выданы!');
  } catch (err) { alert(err.message); }
};

$('#chatHeader').onclick = async () => {
  if (!state.activeChat?.peer) return;
  const { user, gifts } = await api('/users/' + state.activeChat.peer.id);
  $('#peerAvatar').src = user.avatar || DEFAULT_AVATAR;
  $('#peerNameTitle').innerHTML = esc(user.name) + badgeHtml(user);
  $('#peerUsernames').innerHTML = tagsHtml(user);
  $('#peerBio').textContent = user.bio || 'Нет описания';
  $('#peerGiftsCount').textContent = gifts.length;
  renderGiftsGrid($('#peerGiftsGrid'), gifts);
  state.giftTargetUserId = user.id;
  $('#peerProfileModal').classList.remove('hidden');
};

function openGiftShop(targetUserId) {
  state.giftTargetUserId = targetUserId;
  $('#giftModalStars').textContent = state.user.stars;
  const grid = $('#shopGrid');
  grid.innerHTML = '';
  for (const g of state.shop) {
    const card = document.createElement('div');
    card.className = 'gift-card shop-item';
    card.innerHTML = `<div class="g-ico">${g.emoji}</div>
      <div class="g-name">${esc(g.name)}</div>
      <div class="g-sub" style="color:#fbbf24;font-weight:700">${g.price} ⭐</div>`;
    card.onclick = async () => {
      try {
        const res = await api('/gifts/send', { method: 'POST', body: JSON.stringify({
          toUserId: state.giftTargetUserId, giftId: g.id
        })});
        state.user.stars = res.stars;
        renderMeBar();
        $('#giftModal').classList.add('hidden');
        $('#peerProfileModal').classList.add('hidden');
      } catch (err) { alert(err.message); }
    };
    grid.appendChild(card);
  }
  $('#giftModal').classList.remove('hidden');
}

$('#openGiftBtn').onclick = () => {
  if (!state.activeChat?.peer) return alert('Сначала выберите чат с собеседником');
  openGiftShop(state.activeChat.peer.id);
};
$('#peerGiftBtn').onclick = () => openGiftShop(state.giftTargetUserId);

(async function init() {
  if (!state.token) return;
  try {
    state.user = await api('/me');
    await enterApp();
  } catch { logout(); }
})();