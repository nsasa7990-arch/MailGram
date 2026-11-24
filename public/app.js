const $ = s => document.querySelector(s);
const esc = s => String(s || '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const DEFAULT_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://w3.org' width='80' height='80'><rect width='80' height='80' fill='%232b5278'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' fill='white' font-size='32' font-family='sans-serif'>👤</text></svg>";

const badgeHtml = u => {
  let s = '';
  if (u?.verified) s += '<span class="verified-badge" title="Подтверждённый аккаунт">✓</span>';
  if (u?.isPremium) s += '<span class="prem-star" title="MailGram Premium">⭐</span>';
  return s;
};

const tagsHtml = u => {
  let out = '';
  if (u?.username) out += `<span class="tag-user">@${esc(u.username)}</span>`;
  if (u?.nft_username) out += `<span class="tag-nft">💎 @${esc(u.nft_username)}</span>`;
  if (u?.anon_number) out += `<span class="tag-anon">📞 ${esc(u.anon_number)}</span>`;
  return out;
};

function applyTheme(theme) {
  document.body.className = 'theme-' + (theme || 'dark');
}

function playNotifySound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(580, ctx.currentTime + 0.14);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
  } catch {}
}

const state = {
  token: localStorage.getItem('token'),
  user: null, socket: null, chats: [], activeChat: null,
  shop: [], giftTargetUserId: null, unread: {}, selectedMsg: null
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
  applyTheme(state.user.theme);
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
  state.socket.on('message:edited', ({ id, text }) => {
    const el = document.querySelector(`[data-msg-id="${id}"] .msg-body-text`);
    if (el) el.innerHTML = esc(text) + '<span class="edited-mark">изм.</span>';
  });
  state.socket.on('message:deleted', ({ id }) => {
    const row = document.querySelector(`[data-msg-id="${id}"]`);
    if (row) row.remove();
  });
  state.socket.on('message:reacted', ({ id, reactions }) => {
    const row = document.querySelector(`[data-msg-id="${id}"] .reactions-row`);
    if (row) row.innerHTML = renderReactionsHtml(reactions);
  });
  state.socket.on('chat:update', u => {
    const isCurrent = state.activeChat && state.activeChat.id === u.chatId;
    if (!isCurrent && u.fromId !== state.user.id) {
      state.unread[u.chatId] = (state.unread[u.chatId] || 0) + 1;
      playNotifySound();
    }
    const chat = state.chats.find(c => c.id === u.chatId);
    if (chat) {
      chat.lastText = u.lastText;
      chat.lastAt = u.lastAt;
      renderChats();
    } else {
      loadChats();
    }
  });
}

function renderReactionsHtml(rx) {
  if (!rx) return '';
  return Object.entries(rx)
    .filter(([, count]) => count > 0)
    .map(([emo, count]) => `<span class="rx-pill">${emo} ${count}</span>`)
    .join('');
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
    const prefix = c.type === 'channel' ? '📢 ' : (c.type === 'group' ? '👥 ' : '');
    const count = state.unread[c.id] || 0;
    const badge = count > 0 ? `<span class="unread-badge">${count}</span>` : '';
    el.innerHTML = `
      <div class="chat-row">
        <div style="min-width:0;flex:1">
          <div class="ci-title">${prefix}${esc(c.title)}${badgeHtml(c.peer)}</div>
          <div class="ci-last">${esc(c.lastText || 'Нет сообщений')}</div>
        </div>
        ${badge}
      </div>`;
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
  state.unread[chat.id] = 0;
  $('#app').classList.add('chat-open');

  const av = $('#chatHeaderAvatar');
  const sub = $('#chatHeaderSub');
  if (chat.type === 'private' && chat.peer) {
    av.src = chat.peer.avatar || DEFAULT_AVATAR;
    av.classList.remove('hidden');
    sub.textContent = chat.peer.username ? '@' + chat.peer.username : (chat.peer.anon_number || '');
  } else {
    av.classList.add('hidden');
    const kind = chat.type === 'channel' ? 'Канал' : 'Группа';
    const tag = chat.username ? ` • @${chat.username}` : '';
    sub.textContent = `${kind} • ${chat.membersCount || 1} уч.${tag}`;
  }

  const prefix = chat.type === 'channel' ? '📢 ' : (chat.type === 'group' ? '👥 ' : '');
  $('#chatHeaderTitle').innerHTML = prefix + esc(chat.title) + badgeHtml(chat.peer);

  const isReadOnlyChannel = chat.type === 'channel' && chat.ownerId !== state.user.id;
  $('#sendForm').classList.toggle('hidden', isReadOnlyChannel);
  $('#channelReadOnly').classList.toggle('hidden', !isReadOnlyChannel);
  $('#openGiftBtn').classList.toggle('hidden', chat.type !== 'private');

  renderChats();
  state.socket.emit('join', chat.id);
  const msgs = await api('/messages/' + chat.id);
  const box = $('#messages');
  box.innerHTML = '';
  msgs.forEach(appendMessage);
  box.scrollTop = box.scrollHeight;
}

function buildVoicePlayer(src) {
  const wrap = document.createElement('div');
  wrap.className = 'tg-voice';
const heights = new Array(22).fill(0).map((_, i) => 6 + (i * 5) % 16);
  const bars = heights.map(h => `<span style="height:${h}px"></span>`).join('');
  wrap.innerHTML = `
    <button type="button" class="tg-voice-play">▶</button>
    <div class="tg-wave">${bars}</div>
    <span class="tg-voice-time">0:00</span>`;
  const audio = new Audio(src);
  const btn = wrap.querySelector('.tg-voice-play');
  const timeEl = wrap.querySelector('.tg-voice-time');
  const fmt = sec => {
    if (!isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };
  audio.onloadedmetadata = () => { timeEl.textContent = fmt(audio.duration); };
  audio.ontimeupdate = () => { timeEl.textContent = fmt(audio.currentTime); };
  audio.onended = () => {
    wrap.classList.remove('playing');
    btn.textContent = '▶';
    timeEl.textContent = fmt(audio.duration);
  };
  btn.onclick = e => {
    e.stopPropagation();
    if (audio.paused) {
      audio.play().catch(() => alert('Не удалось воспроизвести аудио'));
      wrap.classList.add('playing');
      btn.textContent = '⏸';
    } else {
      audio.pause();
      wrap.classList.remove('playing');
      btn.textContent = '▶';
    }
  };
  return wrap;
}

function appendMessage(m) {
  const box = $('#messages');
  const el = document.createElement('div');
  el.className = 'msg' + (m.user_id === state.user.id ? ' mine' : '');
  el.dataset.msgId = m.id;

  const bubble = document.createElement('div');
  if (m.gift) {
    bubble.className = 'bubble gift-bubble';
    bubble.innerHTML = `
      <span class="gift-emoji">${m.gift.emoji}</span>
      <div style="font-weight:700">${esc(m.gift.name)}</div>
      <div class="gift-label">Подарок от ${esc(m.user_name)}</div>`;
  } else if (m.media_type === 'image' && m.media_data) {
    bubble.className = 'bubble';
    bubble.innerHTML = `<div class="author">${esc(m.user_name)}</div><img class="chat-photo" src="${m.media_data}" alt="Фото">`;
  } else if (m.media_type === 'audio' && m.media_data) {
    bubble.className = 'bubble';
    bubble.innerHTML = `<div class="author">${esc(m.user_name)}</div>`;
    bubble.appendChild(buildVoicePlayer(m.media_data));
  } else {
    bubble.className = 'bubble';
    const ed = m.edited ? '<span class="edited-mark">изм.</span>' : '';
    bubble.innerHTML = `<div class="author">${esc(m.user_name)}</div><div class="text msg-body-text">${esc(m.text)}${ed}</div>`;
  }

  const rxRow = document.createElement('div');
  rxRow.className = 'reactions-row';
  rxRow.innerHTML = renderReactionsHtml(m.reactions);
  bubble.appendChild(rxRow);

  bubble.onclick = () => {
    state.selectedMsg = m;
    const isMine = m.user_id === state.user.id;
    const canEdit = isMine && !m.gift && !m.media_type;
    $('#ownerMsgBtns').classList.toggle('hidden', !isMine);
    $('#editMsgBtn').classList.toggle('hidden', !canEdit);
    $('#msgActionModal').classList.remove('hidden');
  };

  el.appendChild(bubble);
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}
/* ---------- Действия с сообщениями (редактировать / удалить / реакции) ---------- */
document.querySelectorAll('#reactPicker button').forEach(btn => {
  btn.onclick = () => {
    if (!state.selectedMsg) return;
    state.socket.emit('message:react', { msgId: state.selectedMsg.id, emoji: btn.dataset.react });
    $('#msgActionModal').classList.add('hidden');
  };
});

$('#editMsgBtn').onclick = () => {
  if (!state.selectedMsg) return;
  const next = prompt('Изменить сообщение:', state.selectedMsg.text);
  if (next && next.trim()) {
    state.socket.emit('message:edit', { msgId: state.selectedMsg.id, text: next.trim() });
  }
  $('#msgActionModal').classList.add('hidden');
};

$('#deleteMsgBtn').onclick = () => {
  if (!state.selectedMsg) return;
  if (confirm('Удалить это сообщение?')) {
    state.socket.emit('message:delete', { msgId: state.selectedMsg.id });
  }
  $('#msgActionModal').classList.add('hidden');
};

/* ---------- Отправка текста и Редактор фото перед отправкой ---------- */
$('#sendForm').onsubmit = e => {
  e.preventDefault();
  const input = $('#msgInput');
  const text = input.value.trim();
  if (!text || !state.activeChat) return;
  state.socket.emit('message', { chatId: state.activeChat.id, text });
  input.value = '';
};

let rawPhotoImg = null;
let isDrawing = false;
const photoCanvas = $('#photoCanvas');
const photoCtx = photoCanvas.getContext('2d');

function drawBasePhoto() {
  if (!rawPhotoImg) return;
  const maxW = 520;
  const scale = rawPhotoImg.width > maxW ? maxW / rawPhotoImg.width : 1;
  photoCanvas.width = Math.round(rawPhotoImg.width * scale);
  photoCanvas.height = Math.round(rawPhotoImg.height * scale);
  photoCtx.drawImage(rawPhotoImg, 0, 0, photoCanvas.width, photoCanvas.height);
}

$('#attachPhotoBtn').onclick = () => {
  if (!state.activeChat) return alert('Сначала выберите чат');
  $('#photoInput').click();
};

$('#photoInput').onchange = e => {
  const file = e.target.files.item(0);
  if (!file || !state.activeChat) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      rawPhotoImg = img;
      drawBasePhoto();
      $('#photoCaptionInput').value = '';
      $('#photoEditorModal').classList.remove('hidden');
    };
    img.src = reader.result;
    e.target.value = '';
  };
  reader.readAsDataURL(file);
};

function getCanvasPos(ev) {
  const rect = photoCanvas.getBoundingClientRect();
  const clientX = ev.touches ? ev.touches.item(0).clientX : ev.clientX;
  const clientY = ev.touches ? ev.touches.item(0).clientY : ev.clientY;
  return {
    x: (clientX - rect.left) * (photoCanvas.width / rect.width),
    y: (clientY - rect.top) * (photoCanvas.height / rect.height)
  };
}

photoCanvas.onpointerdown = e => {
  isDrawing = true;
  const pos = getCanvasPos(e);
  photoCtx.strokeStyle = $('#drawColor').value;
  photoCtx.lineWidth = 4;
  photoCtx.lineCap = 'round';
  photoCtx.beginPath();
  photoCtx.moveTo(pos.x, pos.y);
};
photoCanvas.onpointermove = e => {
  if (!isDrawing) return;
  const pos = getCanvasPos(e);
  photoCtx.lineTo(pos.x, pos.y);
  photoCtx.stroke();
};
window.addEventListener('pointerup', () => { isDrawing = false; });

$('#addTextBtn').onclick = () => {
  const txt = $('#photoCaptionInput').value.trim();
  if (!txt) return;
  photoCtx.font = 'bold 26px sans-serif';
  photoCtx.textAlign = 'center';
  photoCtx.lineWidth = 4;
  photoCtx.strokeStyle = '#000';
  photoCtx.strokeText(txt, photoCanvas.width / 2, photoCanvas.height - 24);
  photoCtx.fillStyle = $('#drawColor').value;
  photoCtx.fillText(txt, photoCanvas.width / 2, photoCanvas.height - 24);
  $('#photoCaptionInput').value = '';
};

$('#resetPhotoBtn').onclick = drawBasePhoto;

$('#sendEditedPhotoBtn').onclick = () => {
  if (!state.activeChat) return;
  const dataUrl = photoCanvas.toDataURL('image/jpeg', 0.85);
  state.socket.emit('message', {
    chatId: state.activeChat.id,
    mediaType: 'image',
    mediaData: dataUrl
  });
  $('#photoEditorModal').classList.add('hidden');
};

/* ---------- Голосовые сообщения (запись) ---------- */
let mediaRecorder = null;
let audioChunks = [];

$('#voiceBtn').onclick = async () => {
  if (!state.activeChat) return alert('Сначала выберите чат');
  const btn = $('#voiceBtn');

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    btn.classList.remove('voice-rec');
    btn.textContent = '🎤';
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
      : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
    mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);

    mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const type = mediaRecorder.mimeType || 'audio/webm';
      const blob = new Blob(audioChunks, { type });
      const reader = new FileReader();
      reader.onload = () => {
        if (state.activeChat && reader.result) {
          state.socket.emit('message', {
            chatId: state.activeChat.id,
            mediaType: 'audio',
            mediaData: reader.result
          });
        }
      };
      reader.readAsDataURL(blob);
    };
    mediaRecorder.start(200);
    btn.classList.add('voice-rec');
    btn.textContent = '⏹️';
  } catch {
    alert('Разрешите доступ к микрофону в настройках браузера / приложения');
  }
};
/* ---------- Поиск и создание групп / каналов ---------- */
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

$('#openCreateRoomBtn').onclick = () => $('#createRoomModal').classList.remove('hidden');

$('#createRoomForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const { id } = await api('/chats/create-room', { method: 'POST', body: JSON.stringify({
      type: $('#roomTypeSelect').value,
      title: $('#roomTitleInput').value,
      username: $('#roomUsernameInput').value
    })});
    e.target.reset();
    $('#createRoomModal').classList.add('hidden');
    await loadChats();
    const chat = state.chats.find(c => c.id === id);
    if (chat) openChat(chat);
  } catch (err) { alert(err.message); }
};

/* ---------- Модальные окна, Профиль, Баннер и Продажа подарков ---------- */
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.onclick = () => $('#' + btn.dataset.close).classList.add('hidden');
});

function setBannerStyle(el, bannerUrl) {
  if (bannerUrl) {
    el.style.backgroundImage = `url("${bannerUrl}")`;
  } else {
    el.style.backgroundImage = 'linear-gradient(135deg, #1e3a8a, #581c87)';
  }
}

function renderGiftsGrid(container, gifts, canSell = false) {
  container.innerHTML = gifts.length ? '' : '<div style="color:var(--muted);font-size:13px">Пока нет подарков</div>';
  for (const g of gifts) {
    const card = document.createElement('div');
    card.className = 'gift-card';
    const sellHtml = canSell && g.sellPrice > 0
      ? `<button type="button" class="sell-btn" data-sell="${g.id}">Продать за +${g.sellPrice} ⭐</button>`
      : '';
    card.innerHTML = `<div class="g-ico">${g.emoji || '🎁'}</div>
      <div class="g-name">${esc(g.name || 'Подарок')}</div>
      <div class="g-sub">от ${esc(g.from_name)}</div>
      ${sellHtml}`;
    container.appendChild(card);
  }

  if (canSell) {
    container.querySelectorAll('[data-sell]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Продать этот подарок за звёзды?')) return;
        try {
          const res = await api('/gifts/sell', { method: 'POST', body: JSON.stringify({
            userGiftId: Number(btn.dataset.sell)
          })});
          state.user.stars = res.stars;
          renderMeBar();
          $('#openMyProfile').click();
        } catch (err) { alert(err.message); }
      };
    });
  }
}

$('#openMyProfile').onclick = async () => {
  const { user, gifts } = await api('/users/' + state.user.id);
  state.user = user;
  renderMeBar();

  setBannerStyle($('#profBanner'), user.banner);
  $('#profAvatar').src = user.avatar || DEFAULT_AVATAR;
  $('#profNameTitle').innerHTML = esc(user.name) + badgeHtml(user);
  $('#profUsernames').innerHTML = tagsHtml(user);
  $('#profBioText').textContent = user.bio || 'Нет описания';
  $('#profStars').textContent = user.stars;
  $('#myGiftsCount').textContent = gifts.length;
  renderGiftsGrid($('#myGiftsGrid'), gifts, true);
  $('#myProfileModal').classList.remove('hidden');
};
/* ---------- Настройки, Темы, Премиум и Расширенная Админка ---------- */
function openSettingsModal() {
  $('#setAvatar').src = state.user.avatar || DEFAULT_AVATAR;
  $('#setNameInput').value = state.user.name;
  $('#setBioInput').value = state.user.bio || '';
  $('#setUsernameInput').value = state.user.username || '';
  $('#setThemeSelect').value = state.user.theme || 'dark';
  $('#setPassInput').value = '';

  if (state.user.isPremium) {
    $('#buyPremBtn').textContent = 'Активен ✓';
    $('#buyPremBtn').disabled = true;
  } else {
    $('#buyPremBtn').textContent = 'Купить 500 ⭐';
    $('#buyPremBtn').disabled = false;
  }

  if (state.user.isAdmin) {
    $('#adminPanel').classList.remove('hidden');
    $('#admQuery').value = state.user.username || state.user.email;
    $('#admVerified').checked = state.user.verified;
    $('#admPremium').checked = state.user.isPremium;
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

$('#buyPremBtn').onclick = async () => {
  if (!confirm('Купить MailGram Premium за 500 ⭐?')) return;
  try {
    const res = await api('/premium/buy', { method: 'POST' });
    state.user = res.user;
    renderMeBar();
    openSettingsModal();
    alert('Поздравляем! MailGram Premium ⭐ активирован!');
  } catch (err) { alert(err.message); }
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

$('#bannerInput').onchange = e => {
  const file = e.target.files.item(0);
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const updated = await api('/profile', { method: 'POST', body: JSON.stringify({ banner: reader.result }) });
      state.user = updated;
      alert('Баннер профиля обновлён!');
    } catch (err) { alert(err.message); }
  };
  reader.readAsDataURL(file);
};

$('#setThemeSelect').onchange = () => applyTheme($('#setThemeSelect').value);

$('#settingsForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const updated = await api('/profile', { method: 'POST', body: JSON.stringify({
      name: $('#setNameInput').value,
      bio: $('#setBioInput').value,
      username: $('#setUsernameInput').value,
      theme: $('#setThemeSelect').value,
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
      query: $('#admQuery').value,
      stars: Number($('#admStars').value || 0),
      username: $('#admUsername').value,
      nft_username: $('#admNft').value,
      anon_number: $('#admAnonNumber').value,
      gift_id: $('#admGiftSelect').value,
      verified: $('#admVerified').checked,
      is_premium: $('#admPremium').checked
    })});
    if (res.user.id === state.user.id) {
      state.user = res.user;
      renderMeBar();
    }
    $('#admStars').value = '';
    $('#admGiftSelect').value = '';
    alert('Успешно выдано игроку ' + res.user.name + '!');
  } catch (err) { alert(err.message); }
};

/* ---------- Профиль собеседника и магазин подарков ---------- */
$('#chatHeader').onclick = async () => {
  if (!state.activeChat?.peer) return;
  const { user, gifts } = await api('/users/' + state.activeChat.peer.id);
  setBannerStyle($('#peerBanner'), user.banner);
  $('#peerAvatar').src = user.avatar || DEFAULT_AVATAR;
  $('#peerNameTitle').innerHTML = esc(user.name) + badgeHtml(user);
  $('#peerUsernames').innerHTML = tagsHtml(user);
  $('#peerBio').textContent = user.bio || 'Нет описания';
  $('#peerGiftsCount').textContent = gifts.length;
  renderGiftsGrid($('#peerGiftsGrid'), gifts, false);
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
