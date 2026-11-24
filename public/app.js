const $ = s => document.querySelector(s);
const esc = s => String(s || '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const DEFAULT_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://w3.org' width='80' height='80'><rect width='80' height='80' fill='%232b5278'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' fill='white' font-size='32' font-family='sans-serif'>👤</text></svg>";
const ANON_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://w3.org' width='80' height='80'><rect width='80' height='80' fill='%231f2937'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' fill='white' font-size='34' font-family='sans-serif'>🕵️</text></svg>";

function compressImageFile(file, maxSide = 720, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.max(img.width, img.height) > maxSide ? maxSide / Math.max(img.width, img.height) : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const badgeHtml = u => {
  let s = '';
  if (u?.verified) s += '<span class="verified-badge" title="Подтверждён">✓</span>';
  if (u?.isPremium) s += '<span class="prem-star" title="Lume Premium">⭐</span>';
  if (u?.emojiStatus) s += '<span style="margin-left:4px">' + esc(u.emojiStatus) + '</span>';
  return s;
};

const nameStyledHtml = u => {
  const colorStyle = u?.nameColor ? ' style="color:' + esc(u.nameColor) + '"' : '';
  return '<span' + colorStyle + '>' + esc(u?.name || '') + '</span>' + badgeHtml(u);
};

function formatLastSeen(u) {
  if (!u) return '';
  if (u.isOnline) return 'в сети';
  if (u.lastSeen === -1) return 'был(а) недавно';
  if (!u.lastSeen) return 'не в сети';
  const d = new Date(u.lastSeen);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return 'был(а) в сети в ' + hh + ':' + mm;
}

function formatTextWithSpoilers(raw) {
  const safe = esc(raw);
  return safe.replace(/\|\|(.+?)\|\|/g, '<span class="spoiler" onclick="event.stopPropagation();this.classList.toggle(\'revealed\')">$1</span>');
}

function applyThemeAndGarland(user) {
  const theme = user?.theme || localStorage.getItem('lume_theme') || 'dark';
  localStorage.setItem('lume_theme', theme);
  document.body.className = 'theme-' + theme;
  const gEl = $('#sideGarland');
  if (gEl) gEl.classList.toggle('hidden', user?.garland === false);
}

function applyLang(lang) {
  const isEn = lang === 'en';
  $('#msgInput').placeholder = isEn ? 'Message...' : 'Сообщение...';
  $('#logoutBtn').textContent = isEn ? 'Log out' : 'Выйти';
  $('#authSubtitle').textContent = isEn ? 'Next-gen Messenger' : 'Мессенджер нового поколения';
}

function playNotifySound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(580, ctx.currentTime + 0.14);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
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
  folder: 'all', showHidden: false, drafts: {},
  shop: [], stickers: [], stories: [],
  giftTargetUserId: null, giftTargetChatId: null,
  unread: {}, selectedMsg: null, replyTo: null,
  oneTimeVoice: false, currentTopKind: 'spent', walletCache: null
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
const MAIN_TABS = 'Chats,Contacts,Settings,Profile'.split(',');
let currentMainTab = 'Chats';

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
      login: f.login.value, password: f.password.value
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

function switchMainTab(tabName) {
  currentMainTab = tabName;
  MAIN_TABS.forEach(t => {
    $('#tab' + t).classList.toggle('hidden', t !== tabName);
  });
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.nav === tabName);
  });
  if (tabName === 'Contacts') loadContacts();
  if (tabName === 'Settings') populateSettingsForm();
  if (tabName === 'Profile') renderMyProfile();
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.onclick = () => switchMainTab(btn.dataset.nav);
});

/* Свайпы на главном экране (переключение Чаты <-> Контакты <-> Настройки <-> Профиль) */
let shellTouchX = 0;
let shellTouchY = 0;
const mainShell = $('.main-shell');
mainShell.addEventListener('touchstart', e => {
  shellTouchX = e.touches.item(0).clientX;
  shellTouchY = e.touches.item(0).clientY;
}, { passive: true });
mainShell.addEventListener('touchend', e => {
  const dx = e.changedTouches.item(0).clientX - shellTouchX;
  const dy = e.changedTouches.item(0).clientY - shellTouchY;
  if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.4) {
    const idx = MAIN_TABS.indexOf(currentMainTab);
    if (dx < 0 && idx < MAIN_TABS.length - 1) switchMainTab(MAIN_TABS[idx + 1]);
    if (dx > 0 && idx > 0) switchMainTab(MAIN_TABS[idx - 1]);
  }
}, { passive: true });

/* Свайп вправо внутри переписки / группы / канала -> выход назад к списку чатов */
let chatTouchX = 0;
let chatTouchY = 0;
const chatAreaEl = $('#chatArea');
chatAreaEl.addEventListener('touchstart', e => {
  chatTouchX = e.touches.item(0).clientX;
  chatTouchY = e.touches.item(0).clientY;
}, { passive: true });
chatAreaEl.addEventListener('touchend', e => {
  const dx = e.changedTouches.item(0).clientX - chatTouchX;
  const dy = e.changedTouches.item(0).clientY - chatTouchY;
  if (dx > 75 && Math.abs(dx) > Math.abs(dy) * 1.5 && $('#app').classList.contains('chat-open')) {
    saveCurrentDraft();
    $('#app').classList.remove('chat-open');
    state.activeChat = null;
    renderChats();
  }
}, { passive: true });

function renderTopHeader() {
  const u = state.user;
  const handle = u.username ? '@' + u.username : (u.anon_number || u.name);
  $('#topHandleTitle').innerHTML = esc(handle) + badgeHtml(u);
  $('#topStarsVal').textContent = u.stars;
  $('#openAdminBtn').classList.toggle('hidden', !u.isAdmin);
  $('#navProfAvatar').src = u.avatar || DEFAULT_AVATAR;
  applyThemeAndGarland(u);
  applyLang(u.lang);
}

async function enterApp() {
  authScreen.classList.add('hidden');
  if (state.user.hasPin && !sessionStorage.getItem('lume_pin_ok')) {
    $('#pinLockScreen').classList.remove('hidden');
    return;
  }
  appScreen.classList.remove('hidden');
  renderTopHeader();
  connectSocket();
  state.shop = await api('/gifts/shop');
  await Promise.all([loadChats(), loadStories(), loadStickers()]);
}

$('#pinUnlockBtn').onclick = async () => {
  try {
    await api('/pin/verify', { method: 'POST', body: JSON.stringify({ pin: $('#pinUnlockInput').value }) });
    sessionStorage.setItem('lume_pin_ok', '1');
    $('#pinLockScreen').classList.add('hidden');
    enterApp();
  } catch (err) { alert(err.message); }
};
function connectSocket() {
  state.socket = io({ auth: { token: state.token } });

  state.socket.on('message', msg => {
    if (state.activeChat && msg.chat_id === state.activeChat.id) appendMessage(msg);
  });

  state.socket.on('typing', ({ chatId, name }) => {
    if (state.activeChat && state.activeChat.id === chatId) {
      const sub = $('#chatHeaderSub');
      const prev = sub.dataset.base || sub.textContent;
      sub.dataset.base = prev;
      sub.textContent = name + ' печатает...';
      sub.style.color = '#38bdf8';
      clearTimeout(sub._t);
      sub._t = setTimeout(() => {
        sub.textContent = sub.dataset.base || '';
        sub.style.color = 'var(--muted)';
      }, 2200);
    }
  });

  state.socket.on('message:edited', ({ id, text }) => {
    const el = document.querySelector('[data-msg-id="' + id + '"] .msg-body-text');
    if (el) el.innerHTML = formatTextWithSpoilers(text) + '<span class="edited-mark">изм.</span>';
  });

  state.socket.on('message:deleted', ({ id }) => {
    const row = document.querySelector('[data-msg-id="' + id + '"]');
    if (row) row.remove();
  });

  state.socket.on('message:reacted', ({ id, reactions }) => {
    const row = document.querySelector('[data-msg-id="' + id + '"] .reactions-row');
    if (row) row.innerHTML = renderReactionsHtml(reactions);
  });

  state.socket.on('message:consumed', ({ id }) => {
    const pill = document.querySelector('[data-msg-id="' + id + '"] .onetime-pill');
    if (pill) {
      pill.classList.add('consumed');
      pill.textContent = '🔥 Просмотрено / прослушано';
    }
  });

  state.socket.on('message:donated', ({ id, starsDonated }) => {
    const el = document.querySelector('[data-msg-id="' + id + '"] .donate-count');
    if (el) el.textContent = '⭐ ' + starsDonated;
  });

  state.socket.on('message:polled', ({ id, poll }) => {
    const box = document.querySelector('[data-msg-id="' + id + '"] .poll-box');
    if (box) box.innerHTML = renderPollInner(id, poll);
  });

  state.socket.on('chat:cleared', ({ chatId }) => {
    if (state.activeChat && state.activeChat.id === chatId) $('#messages').innerHTML = '';
  });

  state.socket.on('chat:pinned-msg', ({ chatId, msgId }) => {
    if (state.activeChat && state.activeChat.id === chatId) {
      state.activeChat.pinnedMsgId = msgId;
      updatePinnedBanner();
    }
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

/* ---------- Мини-истории (6, 12, 24 часа) ---------- */
async function loadStories() {
  state.stories = await api('/stories');
  const box = $('#storiesList');
  box.innerHTML = '';
  for (const st of state.stories) {
    const el = document.createElement('div');
    el.className = 'story-bubble';
    el.innerHTML =
      '<div class="story-ring"><img src="' + (st.user_avatar || DEFAULT_AVATAR) + '" alt=""></div>' +
      '<div class="story-lbl">' + esc(st.user_name) + '</div>';
    el.onclick = () => {
      $('#vsAvatar').src = st.user_avatar || DEFAULT_AVATAR;
      $('#vsAuthor').textContent = st.user_name;
      $('#vsImage').src = st.media_data;
      $('#vsCaption').textContent = st.caption || '';
      $('#vsViews').textContent = (st.views || 0) + 1;
      $('#viewStoryModal').classList.remove('hidden');
      api('/stories/' + st.id + '/view', { method: 'POST' }).catch(() => {});
    };
    box.appendChild(el);
  }
}

let pendingStoryImg = '';
$('#addStoryBtn').onclick = () => {
  pendingStoryImg = '';
  $('#storyCaptionInput').value = '';
  $('#createStoryModal').classList.remove('hidden');
};
$('#storyFileInput').onchange = async e => {
  const file = e.target.files.item(0);
  if (file) pendingStoryImg = await compressImageFile(file, 720, 0.82);
};
$('#createStoryForm').onsubmit = async e => {
  e.preventDefault();
  if (!pendingStoryImg) return alert('Сначала выберите фото для истории');
  try {
    await api('/stories', { method: 'POST', body: JSON.stringify({
      mediaData: pendingStoryImg,
      caption: $('#storyCaptionInput').value,
      hours: Number($('#storyHoursSelect').value)
    })});
    $('#createStoryModal').classList.add('hidden');
    loadStories();
  } catch (err) { alert(err.message); }
};

/* ---------- Папки чатов, черновики и скрытые чаты ---------- */
function saveCurrentDraft() {
  if (!state.activeChat) return;
  const val = $('#msgInput').value.trim();
  if (val) state.drafts[state.activeChat.id] = val;
  else delete state.drafts[state.activeChat.id];
}

document.querySelectorAll('.folder-tab[data-folder]').forEach(btn => {
  btn.onclick = () => {
    state.showHidden = false;
    $('#toggleHiddenChatsBtn').classList.remove('active');
    document.querySelectorAll('.folder-tab[data-folder]').forEach(b => b.classList.toggle('active', b === btn));
    state.folder = btn.dataset.folder;
    renderChats();
  };
});

$('#toggleHiddenChatsBtn').onclick = async () => {
  if (!state.showHidden && state.user.hasPin) {
    const p = prompt('Введите 4-значный PIN-код для открытия скрытых чатов:');
    if (!p) return;
    try { await api('/pin/verify', { method: 'POST', body: JSON.stringify({ pin: p }) }); }
    catch (err) { return alert(err.message); }
  }
  state.showHidden = !state.showHidden;
  $('#toggleHiddenChatsBtn').classList.toggle('active', state.showHidden);
  renderChats();
};

async function loadChats() {
  state.chats = await api('/chats');
  renderChats();
}

function renderChats() {
  const list = $('#chatList');
  list.innerHTML = '';

  const totalUnread = Object.values(state.unread).reduce((a, b) => a + b, 0);
  const navBadge = $('#navUnreadBadge');
  navBadge.textContent = totalUnread;
  navBadge.classList.toggle('hidden', totalUnread === 0);

  const filtered = state.chats.filter(c => {
    if (Boolean(c.hidden) !== state.showHidden) return false;
    if (state.folder === 'private') return c.type === 'private' || c.type === 'saved';
    if (state.folder === 'group') return c.type === 'group';
    if (state.folder === 'channel') return c.type === 'channel';
    if (state.folder === 'unread') return (state.unread[c.id] || 0) > 0;
    return true;
  });

  for (const c of filtered) {
    const el = document.createElement('div');
    el.className = 'chat-item' + (state.activeChat?.id === c.id ? ' active' : '') + (c.pinned ? ' pinned-chat' : '');
    const avSrc = c.type === 'saved'
      ? "data:image/svg+xml;utf8,<svg xmlns='http://w3.org' width='80' height='80'><rect width='80' height='80' fill='%232563eb'/><text x='50%' y='55%' dominant-baseline='middle' text-anchor='middle' fill='white' font-size='34'>🔖</text></svg>"
      : (c.avatar || DEFAULT_AVATAR);

    const frameCls = c.peer?.avatarFrame ? (' ' + c.peer.avatarFrame) : '';
    const prefix = c.type === 'channel' ? '📢 ' : (c.type === 'group' ? '👥 ' : '');
    const pinMark = c.pinned ? '📌 ' : '';
    const count = state.unread[c.id] || 0;
    const badge = count > 0 ? '<span class="unread-badge">' + count + '</span>' : '';

    const draft = state.drafts[c.id];
    const subHtml = draft
      ? '<span class="draft-tag">Черновик: </span>' + esc(draft)
      : esc(c.lastText || 'Нет сообщений');

    el.innerHTML =
      '<img class="avatar' + frameCls + '" src="' + avSrc + '" alt="">' +
      '<div class="ci-body">' +
        '<div class="ci-top">' +
          '<div class="ci-title">' + pinMark + prefix + (c.peer ? nameStyledHtml(c.peer) : esc(c.title)) + '</div>' +
          badge +
        '</div>' +
        '<div class="ci-last">' + subHtml + '</div>' +
      '</div>';
    el.onclick = () => openChat(c);
    list.appendChild(el);
  }
}
$('#mobileBackBtn').onclick = e => {
  e.stopPropagation();
  saveCurrentDraft();
  $('#app').classList.remove('chat-open');
  state.activeChat = null;
  renderChats();
};

function updatePinnedBanner() {
  const banner = $('#pinnedMsgBanner');
  if (!state.activeChat?.pinnedMsgId) {
    banner.classList.add('hidden');
    return;
  }
  const el = document.querySelector('[data-msg-id="' + state.activeChat.pinnedMsgId + '"] .msg-body-text');
  $('#pinnedMsgText').textContent = el ? el.textContent : 'Закреплённое сообщение #' + state.activeChat.pinnedMsgId;
  banner.classList.remove('hidden');
}

$('#unpinMsgBtn').onclick = async () => {
  if (!state.activeChat) return;
  await api('/chats/' + state.activeChat.id + '/pin-msg', { method: 'POST', body: JSON.stringify({ msgId: 0 }) });
};

async function openChat(chat) {
  if (state.activeChat && state.activeChat.id !== chat.id) saveCurrentDraft();
  state.activeChat = chat;
  state.unread[chat.id] = 0;
  state.replyTo = null;
  $('#replyPreviewBar').classList.add('hidden');
  $('#stickerDrawer').classList.add('hidden');
  $('#app').classList.add('chat-open');

  $('#msgInput').value = state.drafts[chat.id] || '';

  const av = $('#chatHeaderAvatar');
  const sub = $('#chatHeaderSub');
  if (chat.type === 'saved') {
    av.src = "data:image/svg+xml;utf8,<svg xmlns='http://w3.org' width='80' height='80'><rect width='80' height='80' fill='%232563eb'/><text x='50%' y='55%' dominant-baseline='middle' text-anchor='middle' fill='white' font-size='34'>🔖</text></svg>";
    sub.textContent = 'Ваше личное облачное хранилище';
  } else if (chat.type === 'private' && chat.peer) {
    av.src = chat.peer.avatar || DEFAULT_AVATAR;
    sub.textContent = formatLastSeen(chat.peer);
  } else {
    av.src = chat.avatar || DEFAULT_AVATAR;
    const kind = chat.type === 'channel' ? 'Канал' : 'Группа';
    const tag = chat.username ? ' • @' + chat.username : '';
    sub.textContent = kind + ' • ' + (chat.membersCount || 1) + ' уч.' + tag;
  }
  sub.dataset.base = sub.textContent;

  const prefix = chat.type === 'channel' ? '📢 ' : (chat.type === 'group' ? '👥 ' : '');
  $('#chatHeaderTitle').innerHTML = prefix + (chat.peer ? nameStyledHtml(chat.peer) : esc(chat.title));

  const canPostChannel = chat.ownerId === state.user.id || chat.myRole === 'admin';
  const isReadOnlyChannel = chat.type === 'channel' && !canPostChannel;
  $('#sendForm').classList.toggle('hidden', isReadOnlyChannel);
  $('#channelReadOnly').classList.toggle('hidden', !isReadOnlyChannel);
  $('#openGiftBtn').classList.toggle('hidden', chat.type !== 'private');
  $('#openPollBtn').classList.toggle('hidden', chat.type !== 'group' && chat.type !== 'channel');

  renderChats();
  state.socket.emit('join', chat.id);
  const msgs = await api('/messages/' + chat.id);
  const box = $('#messages');
  box.innerHTML = '';

  if (!msgs.length) {
    box.innerHTML =
      '<div class="empty-chat-welcome">' +
        '<div style="font-size:38px;margin-bottom:6px">👋</div>' +
        '<div style="font-weight:700;font-size:15px">Сообщений пока нет</div>' +
        '<div style="font-size:12px;color:var(--muted);margin-top:4px">Отправьте первое сообщение, стикер или подарок!</div>' +
      '</div>';
  } else {
    msgs.forEach(appendMessage);
  }
  updatePinnedBanner();
  box.scrollTop = box.scrollHeight;
}

function renderReactionsHtml(rx) {
  if (!rx) return '';
  return Object.entries(rx)
    .filter(([, count]) => count > 0)
    .map(([emo, count]) => '<span class="rx-pill">' + emo + ' ' + count + '</span>')
    .join('');
}

function renderPollInner(msgId, poll) {
  const total = poll.options.reduce((s, o) => s + (o.votes || 0), 0);
  const optsHtml = poll.options.map((o, idx) => {
    const pct = total ? Math.round(((o.votes || 0) / total) * 100) : 0;
    return '<button type="button" class="poll-opt-btn" onclick="event.stopPropagation();votePoll(' + msgId + ',' + idx + ')">' +
      '<span>' + esc(o.text) + '</span><span>' + pct + '% (' + (o.votes || 0) + ')</span></button>';
  }).join('');
  return '<div style="font-weight:700;margin-bottom:4px">📊 ' + esc(poll.question) + '</div>' + optsHtml +
    '<div style="font-size:11px;opacity:0.75;margin-top:5px">Всего голосов: ' + total + '</div>';
}

window.votePoll = async (msgId, optionIndex) => {
  try { await api('/messages/' + msgId + '/vote', { method: 'POST', body: JSON.stringify({ optionIndex }) }); }
  catch (err) { alert(err.message); }
};

function buildVoicePlayer(src, msg) {
  const wrap = document.createElement('div');
  wrap.className = 'tg-voice';
  const heights = new Array(20).fill(0).map((_, i) => 6 + (i * 5) % 15);
  const bars = heights.map(h => '<span style="height:' + h + 'px"></span>').join('');
  wrap.innerHTML =
    '<button type="button" class="tg-voice-play">▶</button>' +
    '<div class="tg-wave">' + bars + '</div>' +
    '<span class="tg-voice-time">0:00</span>' +
    '<button type="button" class="speed-pill" title="Скорость">1x</button>' +
    '<button type="button" class="speed-pill" title="Расшифровка (Premium)">🅰️</button>';

  const audio = new Audio(src);
  const playBtn = wrap.querySelector('.tg-voice-play');
  const timeEl = wrap.querySelector('.tg-voice-time');
  const speedBtn = wrap.querySelectorAll('.speed-pill').item(0);
  const transBtn = wrap.querySelectorAll('.speed-pill').item(1);
  const speeds = '1,1.5,2'.split(',').map(Number);
  let spIdx = 0;

  const fmt = sec => {
    if (!isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  };
  audio.onloadedmetadata = () => { timeEl.textContent = fmt(audio.duration); };
  audio.ontimeupdate = () => { timeEl.textContent = fmt(audio.currentTime); };
  audio.onended = () => {
    wrap.classList.remove('playing');
    playBtn.textContent = '▶';
    timeEl.textContent = fmt(audio.duration);
    if (msg.one_time && msg.user_id !== state.user.id) {
      api('/messages/' + msg.id + '/consume', { method: 'POST' }).catch(() => {});
    }
  };

  playBtn.onclick = e => {
    e.stopPropagation();
    if (audio.paused) {
      audio.play().catch(() => alert('Не удалось воспроизвести'));
      wrap.classList.add('playing');
      playBtn.textContent = '⏸';
    } else {
      audio.pause();
      wrap.classList.remove('playing');
      playBtn.textContent = '▶';
    }
  };

  speedBtn.onclick = e => {
    e.stopPropagation();
    spIdx = (spIdx + 1) % speeds.length;
    audio.playbackRate = speeds[spIdx];
    speedBtn.textContent = speeds[spIdx] + 'x';
  };

  transBtn.onclick = e => {
    e.stopPropagation();
    if (!state.user.isPremium) return alert('Расшифровка голосовых сообщений доступна только с Lume Premium ⭐!');
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return alert('Ваш браузер не поддерживает голосовую расшифровку текста');
    alert('Запустите воспроизведение ГС — распознавание речи Lume Premium включено!');
  };

  return wrap;
}
function appendMessage(m) {
  const box = $('#messages');
  const empty = box.querySelector('.empty-chat-welcome');
  if (empty) empty.remove();

  const isMine = m.user_id === state.user.id;
  const el = document.createElement('div');
  el.className = 'msg' + (isMine ? ' mine' : '');
  el.dataset.msgId = m.id;

  const bubble = document.createElement('div');
  if (isMine && m.bubble_color && !m.gift && m.media_type !== 'sticker') {
    bubble.style.background = m.bubble_color;
  }

  let topHtml = '';
  if (!isMine) {
    const cStyle = m.name_color ? ' style="color:' + esc(m.name_color) + '"' : '';
    topHtml += '<div class="author"' + cStyle + '>' + esc(m.user_name) + badgeHtml(m) + '</div>';
  }
  if (m.fwd_from) topHtml += '<div class="fwd-tag">↪️ Переслано от ' + esc(m.fwd_from) + '</div>';
  if (m.replyData) {
    topHtml += '<div class="reply-quote"><b>' + esc(m.replyData.name) + '</b><br>' + esc(m.replyData.text) + '</div>';
  }

  if (m.gift) {
    const numStr = m.gift.userGiftId ? ' #' + m.gift.userGiftId : '';
    bubble.className = 'bubble gift-bubble';
    bubble.innerHTML =
      '<span class="gift-emoji">' + m.gift.emoji + '</span>' +
      '<div style="font-weight:700">' + esc(m.gift.name) + numStr + '</div>' +
      '<div class="gift-label">Подарок от ' + esc(m.user_name) + '</div>';
  } else if (m.media_type === 'sticker' && m.media_data) {
    bubble.className = 'bubble sticker-bubble';
    bubble.innerHTML = topHtml + '<img class="chat-sticker" src="' + m.media_data + '" alt="Стикер">';
  } else if (m.poll) {
    bubble.className = 'bubble';
    bubble.innerHTML = topHtml + '<div class="poll-box">' + renderPollInner(m.id, m.poll) + '</div>';
  } else if (m.one_time) {
    bubble.className = 'bubble';
    const consumed = m.consumed || !m.media_data;
    const label = consumed ? '🔥 Просмотрено / прослушано'
      : (m.media_type === 'image' ? '🔥 Одноразовое фото (нажмите)' : '🔥 Одноразовое голосовое (нажмите)');
    bubble.innerHTML = topHtml + '<div class="onetime-pill' + (consumed ? ' consumed' : '') + '">' + label + '</div>';
    if (!consumed && m.media_data) {
      bubble.querySelector('.onetime-pill').onclick = async ev => {
        ev.stopPropagation();
        if (m.media_type === 'image') {
          $('#oneTimeImg').src = m.media_data;
          $('#oneTimeViewModal').classList.remove('hidden');
          if (!isMine) await api('/messages/' + m.id + '/consume', { method: 'POST' }).catch(() => {});
        } else if (m.media_type === 'audio') {
          const a = new Audio(m.media_data);
          a.play().catch(() => {});
          a.onended = () => {
            if (!isMine) api('/messages/' + m.id + '/consume', { method: 'POST' }).catch(() => {});
          };
        }
      };
    }
  } else if (m.media_type === 'image' && m.media_data) {
    bubble.className = 'bubble';
    bubble.innerHTML = topHtml + '<img class="chat-photo" src="' + m.media_data + '" alt="Фото">';
  } else if (m.media_type === 'audio' && m.media_data) {
    bubble.className = 'bubble';
    bubble.innerHTML = topHtml;
    bubble.appendChild(buildVoicePlayer(m.media_data, m));
  } else {
    bubble.className = 'bubble';
    const ed = m.edited ? '<span class="edited-mark">изм.</span>' : '';
    bubble.innerHTML = topHtml + '<div class="text msg-body-text">' + formatTextWithSpoilers(m.text) + ed + '</div>';
  }

  const rxRow = document.createElement('div');
  rxRow.className = 'reactions-row';
  rxRow.innerHTML = renderReactionsHtml(m.reactions);
  bubble.appendChild(rxRow);

  const d = new Date(m.created_at || Date.now());
  const timeStr = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const isChannel = state.activeChat?.type === 'channel';
  const viewsHtml = isChannel ? '<span>👁️ ' + (m.views_count || 1) + '</span>' : '';
  const donHtml = isChannel ? '<span class="donate-count">⭐ ' + (m.stars_donated || 0) + '</span>' : '';
  const meta = document.createElement('div');
  meta.className = 'msg-meta-row';
  meta.innerHTML = viewsHtml + donHtml + '<span>' + timeStr + '</span>';
  bubble.appendChild(meta);

  let lastTap = 0;
  bubble.onclick = () => {
    const now = Date.now();
    if (now - lastTap < 280) {
      state.socket.emit('message:react', { msgId: m.id, emoji: '❤️' });
      lastTap = 0;
      return;
    }
    lastTap = now;

    state.selectedMsg = m;
    const canEdit = isMine && !m.gift && !m.media_type && !m.poll;
    const canDel = isMine || state.activeChat?.ownerId === state.user.id || state.activeChat?.myRole === 'admin';
    $('#editMsgBtn').classList.toggle('hidden', !canEdit);
    $('#deleteMsgBtn').classList.toggle('hidden', !canDel);
    $('#donatePostBtn').classList.toggle('hidden', !isChannel || isMine);
    $('#msgActionModal').classList.remove('hidden');
  };

  el.appendChild(bubble);
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}
/* ---------- Действия с сообщениями (Реакции, Reply, Forward, Pin, Донат, Редактирование) ---------- */
document.querySelectorAll('#reactPicker button').forEach(btn => {
  btn.onclick = () => {
    if (!state.selectedMsg) return;
    state.socket.emit('message:react', { msgId: state.selectedMsg.id, emoji: btn.dataset.react });
    $('#msgActionModal').classList.add('hidden');
  };
});

$('#replyMsgBtn').onclick = () => {
  if (!state.selectedMsg) return;
  state.replyTo = state.selectedMsg;
  $('#replyToAuthor').textContent = state.selectedMsg.user_name;
  $('#replyToText').textContent = state.selectedMsg.text;
  $('#replyPreviewBar').classList.remove('hidden');
  $('#msgActionModal').classList.add('hidden');
  $('#msgInput').focus();
};

$('#cancelReplyBtn').onclick = () => {
  state.replyTo = null;
  $('#replyPreviewBar').classList.add('hidden');
};

$('#forwardMsgBtn').onclick = () => {
  if (!state.selectedMsg) return;
  $('#msgActionModal').classList.add('hidden');
  const list = $('#forwardChatsList');
  list.innerHTML = '';
  for (const c of state.chats) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.background = 'var(--input)';
    btn.style.textAlign = 'left';
    btn.textContent = (c.type === 'channel' ? '📢 ' : (c.type === 'group' ? '👥 ' : '💬 ')) + c.title;
    btn.onclick = () => {
      state.socket.emit('message', {
        chatId: c.id,
        text: state.selectedMsg.text,
        mediaType: state.selectedMsg.media_type,
        mediaData: state.selectedMsg.media_data,
        fwdFrom: state.selectedMsg.user_name
      });
      $('#forwardModal').classList.add('hidden');
      alert('Переслано в ' + c.title);
    };
    list.appendChild(btn);
  }
  $('#forwardModal').classList.remove('hidden');
};

$('#pinMsgBtn').onclick = async () => {
  if (!state.selectedMsg || !state.activeChat) return;
  await api('/chats/' + state.activeChat.id + '/pin-msg', {
    method: 'POST',
    body: JSON.stringify({ msgId: state.selectedMsg.id })
  });
  $('#msgActionModal').classList.add('hidden');
};

$('#donatePostBtn').onclick = async () => {
  if (!state.selectedMsg) return;
  const val = prompt('Сколько звёзд ⭐ отправить автору поста?', '25');
  if (!val) return;
  try {
    const res = await api('/messages/' + state.selectedMsg.id + '/donate', {
      method: 'POST',
      body: JSON.stringify({ amount: Number(val) })
    });
    state.user.stars = res.stars;
    renderTopHeader();
    $('#msgActionModal').classList.add('hidden');
  } catch (err) { alert(err.message); }
};

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

/* ---------- Отправка текста, индикатор «печатает...» и опросы ---------- */
let lastTypingSent = 0;
$('#msgInput').oninput = () => {
  if (!state.activeChat) return;
  const now = Date.now();
  if (now - lastTypingSent > 1800) {
    lastTypingSent = now;
    state.socket.emit('typing', { chatId: state.activeChat.id });
  }
};

$('#sendForm').onsubmit = e => {
  e.preventDefault();
  const input = $('#msgInput');
  const text = input.value.trim();
  if (!text || !state.activeChat) return;
  state.socket.emit('message', {
    chatId: state.activeChat.id,
    text,
    replyToId: state.replyTo ? state.replyTo.id : 0
  });
  input.value = '';
  delete state.drafts[state.activeChat.id];
  state.replyTo = null;
  $('#replyPreviewBar').classList.add('hidden');
};

$('#openPollBtn').onclick = () => {
  $('#pollForm').reset();
  $('#pollModal').classList.remove('hidden');
};

$('#pollForm').onsubmit = e => {
  e.preventDefault();
  if (!state.activeChat) return;
  const question = $('#pollQuestion').value.trim();
  const opts = Array.from(document.querySelectorAll('.poll-opt-in'))
    .map(i => i.value.trim())
    .filter(Boolean)
    .map(text => ({ text, votes: 0 }));
  if (!question || opts.length < 2) return alert('Введите вопрос и минимум 2 варианта');
  state.socket.emit('message', { chatId: state.activeChat.id, poll: { question, options: opts } });
  $('#pollModal').classList.add('hidden');
};

/* ---------- Панель стикеров и создание своего стикера из фото ---------- */
async function loadStickers() {
  state.stickers = await api('/stickers');
  const grid = $('#stickersGrid');
  grid.innerHTML = '';
  for (const st of state.stickers) {
    const cell = document.createElement('div');
    cell.className = 'sticker-cell';
    cell.innerHTML = '<img src="' + st.image_data + '" alt="Стикер">';
    cell.onclick = () => {
      if (!state.activeChat) return;
      state.socket.emit('message', {
        chatId: state.activeChat.id,
        mediaType: 'sticker',
        mediaData: st.image_data
      });
      $('#stickerDrawer').classList.add('hidden');
    };
    grid.appendChild(cell);
  }
}

$('#toggleStickersBtn').onclick = () => $('#stickerDrawer').classList.toggle('hidden');

$('#createStickerInput').onchange = async e => {
  const file = e.target.files.item(0);
  if (!file) return;
  const compressed = await compressImageFile(file, 260, 0.85);
  await api('/stickers', { method: 'POST', body: JSON.stringify({ imageData: compressed }) });
  e.target.value = '';
  loadStickers();
};

/* ---------- Редактор фото перед отправкой (Обрезка, Рисование, Текст, Одноразовое фото) ---------- */
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
      $('#oneTimePhotoCheck').checked = false;
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

$('#cropPhotoBtn').onclick = () => {
  const w = Math.round(photoCanvas.width * 0.8);
  const h = Math.round(photoCanvas.height * 0.8);
  const sx = Math.round((photoCanvas.width - w) / 2);
  const sy = Math.round((photoCanvas.height - h) / 2);
  const cut = photoCtx.getImageData(sx, sy, w, h);
  photoCanvas.width = w;
  photoCanvas.height = h;
  photoCtx.putImageData(cut, 0, 0);
};

$('#resetPhotoBtn').onclick = drawBasePhoto;

$('#sendEditedPhotoBtn').onclick = () => {
  if (!state.activeChat) return;
  const dataUrl = photoCanvas.toDataURL('image/jpeg', 0.82);
  state.socket.emit('message', {
    chatId: state.activeChat.id,
    mediaType: 'image',
    mediaData: dataUrl,
    oneTime: $('#oneTimePhotoCheck').checked
  });
  $('#photoEditorModal').classList.add('hidden');
};
/* ---------- Голосовые сообщения (свайп влево — отмена + одноразовый режим) ---------- */
let mediaRecorder = null;
let audioChunks = [];
let voiceCancelled = false;
let voiceStartX = 0;

$('#oneTimeVoiceBtn').onclick = () => {
  state.oneTimeVoice = !state.oneTimeVoice;
  $('#oneTimeVoiceBtn').classList.toggle('active-flag', state.oneTimeVoice);
};

const voiceBtn = $('#voiceBtn');
voiceBtn.addEventListener('touchstart', e => { voiceStartX = e.touches.item(0).clientX; }, { passive: true });
voiceBtn.addEventListener('touchmove', e => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    const dx = e.touches.item(0).clientX - voiceStartX;
    if (dx < -45) {
      voiceCancelled = true;
      mediaRecorder.stop();
      voiceBtn.classList.remove('voice-rec');
      voiceBtn.textContent = '🎤';
    }
  }
}, { passive: true });

voiceBtn.onclick = async () => {
  if (!state.activeChat) return alert('Сначала выберите чат');
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    voiceCancelled = false;
    mediaRecorder.stop();
    voiceBtn.classList.remove('voice-rec');
    voiceBtn.textContent = '🎤';
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    voiceCancelled = false;
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
      : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
    mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);

    mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      if (voiceCancelled) return;
      const type = mediaRecorder.mimeType || 'audio/webm';
      const blob = new Blob(audioChunks, { type });
      const reader = new FileReader();
      reader.onload = () => {
        if (state.activeChat && reader.result) {
          state.socket.emit('message', {
            chatId: state.activeChat.id,
            mediaType: 'audio',
            mediaData: reader.result,
            oneTime: state.oneTimeVoice
          });
          state.oneTimeVoice = false;
          $('#oneTimeVoiceBtn').classList.remove('active-flag');
        }
      };
      reader.readAsDataURL(blob);
    };
    mediaRecorder.start(200);
    voiceBtn.classList.add('voice-rec');
    voiceBtn.textContent = '⏹️';
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
/* ---------- Меню три точки (⋮) в шапке чата ---------- */
$('#chatMenuBtn').onclick = () => {
  if (!state.activeChat) return;
  const isPriv = state.activeChat.type === 'private';
  const isRoom = state.activeChat.type === 'group' || state.activeChat.type === 'channel';
  $('#cmBlockBtn').classList.toggle('hidden', !isPriv);
  $('#cmLeaveBtn').classList.toggle('hidden', !isRoom);
  $('#chatMenuModal').classList.remove('hidden');
};

$('#cmPinChatBtn').onclick = async () => {
  if (!state.activeChat) return;
  try {
    await api('/chats/' + state.activeChat.id + '/pin', { method: 'POST' });
    $('#chatMenuModal').classList.add('hidden');
    loadChats();
  } catch (err) { alert(err.message); }
};

$('#cmHideChatBtn').onclick = async () => {
  if (!state.activeChat) return;
  await api('/chats/' + state.activeChat.id + '/hide', { method: 'POST' });
  $('#chatMenuModal').classList.add('hidden');
  $('#app').classList.remove('chat-open');
  state.activeChat = null;
  loadChats();
};

$('#cmInviteBtn').onclick = () => {
  if (!state.activeChat) return;
  const c = state.activeChat;
  const link = c.peer
    ? (c.peer.username ? '@' + c.peer.username : 'ID: ' + c.peer.id)
    : (c.username ? '@' + c.username : ('lume.app/join/' + c.inviteCode));
  navigator.clipboard?.writeText(link).catch(() => {});
  alert('Скопировано: ' + link);
  $('#chatMenuModal').classList.add('hidden');
};

$('#cmBlockBtn').onclick = async () => {
  if (!state.activeChat?.peer) return;
  const res = await api('/blocks/toggle', { method: 'POST', body: JSON.stringify({ userId: state.activeChat.peer.id }) });
  alert(res.blocked ? 'Пользователь добавлен в чёрный список 🚫' : 'Пользователь разблокирован ✓');
  $('#chatMenuModal').classList.add('hidden');
};

$('#cmReportBtn').onclick = async () => {
  if (!state.activeChat) return;
  const reason = prompt('Опишите причину жалобы администратору Lume:');
  if (!reason) return;
  const isPriv = state.activeChat.type === 'private' && state.activeChat.peer;
  await api('/reports', { method: 'POST', body: JSON.stringify({
    targetType: isPriv ? 'user' : 'channel',
    targetId: isPriv ? state.activeChat.peer.id : state.activeChat.id,
    reason
  })});
  alert('Жалоба отправлена администратору!');
  $('#chatMenuModal').classList.add('hidden');
};

$('#cmClearBtn').onclick = async () => {
  if (!state.activeChat || !confirm('Очистить всю историю сообщений в этом чате?')) return;
  await api('/chats/' + state.activeChat.id + '/clear', { method: 'POST' });
  $('#chatMenuModal').classList.add('hidden');
};

$('#cmLeaveBtn').onclick = async () => {
  if (!state.activeChat || !confirm('Покинуть этот канал / группу?')) return;
  await api('/chats/' + state.activeChat.id + '/leave', { method: 'POST' });
  $('#chatMenuModal').classList.add('hidden');
  $('#app').classList.remove('chat-open');
  state.activeChat = null;
  loadChats();
};

/* ---------- Профиль группы или канала (участники, админы, подарки каналу) ---------- */
async function openRoomProfile(chatId) {
  const { room, members, gifts } = await api('/rooms/' + chatId);
  $('#roomProfHeader').textContent = room.type === 'channel' ? 'Профиль канала' : 'Профиль группы';
  $('#roomProfAvatar').src = room.avatar || DEFAULT_AVATAR;
  $('#roomProfTitle').textContent = room.title;
  $('#roomProfSub').textContent = (room.username ? '@' + room.username + ' • ' : '') + members.length + ' участников';
  $('#roomProfBio').textContent = room.bio || 'Нет описания';
  $('#roomGiftsCount').textContent = gifts.length;
  $('#roomMembersCount').textContent = members.length;

  const isOwner = room.owner_id === state.user.id;
  $('#roomOwnerBox').classList.toggle('hidden', !isOwner);
  if (isOwner) {
    $('#roomEditTitle').value = room.title;
    $('#roomEditBio').value = room.bio || '';
  }

  $('#roomInviteLink').onclick = () => {
    const link = room.username ? '@' + room.username : ('lume.app/join/' + room.invite_code);
    navigator.clipboard?.writeText(link).catch(() => {});
    alert('Ссылка скопирована: ' + link);
  };

  $('#roomGiftBtn').onclick = () => openGiftShop(0, room.id);
  renderGiftsGrid($('#roomGiftsGrid'), gifts, false);

  const mList = $('#roomMembersList');
  mList.innerHTML = '';
  for (const m of members) {
    const row = document.createElement('div');
    row.className = 'info-box';
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 10px';
    const roleTag = m.role === 'owner' ? '👑 Создатель' : (m.role === 'admin' ? '⭐ Админ' : '');
    row.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;cursor:pointer" class="rm-user-link">' +
        '<img class="avatar sm" src="' + (m.avatar || DEFAULT_AVATAR) + '" alt="">' +
        '<div><b>' + esc(m.name) + '</b> <span style="font-size:11px;color:#60a5fa">' + roleTag + '</span></div>' +
      '</div>' +
      (isOwner && m.id !== state.user.id
        ? '<div style="display:flex;gap:4px">' +
            '<button type="button" class="rm-admin-btn" style="padding:4px 8px;font-size:11px">' + (m.role === 'admin' ? 'Снять' : 'Админ') + '</button>' +
            '<button type="button" class="rm-kick-btn" style="padding:4px 8px;font-size:11px;background:#dc2626">✕</button>' +
          '</div>'
        : '');

    row.querySelector('.rm-user-link').onclick = () => {
      $('#roomProfileModal').classList.add('hidden');
      openPeerProfileById(m.id);
    };
    if (isOwner && m.id !== state.user.id) {
      row.querySelector('.rm-admin-btn').onclick = async () => {
        await api('/rooms/' + room.id + '/role', {
          method: 'POST',
          body: JSON.stringify({ userId: m.id, action: m.role === 'admin' ? 'member' : 'admin' })
        });
        openRoomProfile(room.id);
      };
      row.querySelector('.rm-kick-btn').onclick = async () => {
        await api('/rooms/' + room.id + '/role', {
          method: 'POST',
          body: JSON.stringify({ userId: m.id, action: 'kick' })
        });
        openRoomProfile(room.id);
      };
    }
    mList.appendChild(row);
  }
  $('#roomProfileModal').classList.remove('hidden');
}

$('#roomAvatarInput').onchange = async e => {
  const file = e.target.files.item(0);
  if (!file || !state.activeChat) return;
  const img = await compressImageFile(file, 360, 0.8);
  await api('/rooms/' + state.activeChat.id + '/update', { method: 'POST', body: JSON.stringify({ avatar: img }) });
  openRoomProfile(state.activeChat.id);
  loadChats();
};

$('#saveRoomBtn').onclick = async () => {
  if (!state.activeChat) return;
  await api('/rooms/' + state.activeChat.id + '/update', {
    method: 'POST',
    body: JSON.stringify({ title: $('#roomEditTitle').value, bio: $('#roomEditBio').value })
  });
  alert('Данные канала / группы обновлены!');
  openRoomProfile(state.activeChat.id);
  loadChats();
};
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.onclick = () => $('#' + btn.dataset.close).classList.add('hidden');
});

function openGiftDetailModal(g, isOwner) {
  $('#gdNumberTag').textContent = g.userGiftId ? '#' + g.userGiftId : '';
  $('#gdEmoji').textContent = g.emoji || '🎁';
  $('#gdTitle').textContent = isOwner ? 'Подарок Вам' : (g.name || 'Подарок');
  $('#gdSubHint').textContent = isOwner
    ? 'Вы можете скрыть или продать этот подарок.'
    : 'Подарок в профиле пользователя';

  const senderCell = $('#gdSenderCell');
  const avSrc = g.isAnon ? ANON_AVATAR : (g.fromAvatar || DEFAULT_AVATAR);
  senderCell.innerHTML =
    '<img class="avatar sm" style="width:22px;height:22px" src="' + avSrc + '" alt="">' +
    '<span style="color:' + (g.isAnon ? 'var(--muted)' : '#60a5fa') + '">' + esc(g.fromName || 'Аноним') + '</span>';

  senderCell.onclick = () => {
    if (g.isAnon || !g.fromUserId) return;
    $('#giftDetailModal').classList.add('hidden');
    openPeerProfileById(g.fromUserId);
  };

  const d = new Date(g.createdAt || Date.now());
  $('#gdDateCell').textContent = d.toLocaleDateString('ru-RU') + ' в ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  $('#gdPriceCell').textContent = '⭐ ' + (g.price || 0);

  if (g.caption) {
    $('#gdCaptionRow').classList.remove('hidden');
    $('#gdCaptionCell').textContent = g.caption;
  } else {
    $('#gdCaptionRow').classList.add('hidden');
  }

  const ownerBox = $('#gdOwnerActions');
  ownerBox.classList.toggle('hidden', !isOwner);
  if (isOwner) {
    const hideBtn = $('#gdToggleHideBtn');
    hideBtn.textContent = g.hidden ? '👁️ Показать в профиле' : '🙈 Скрыть из профиля';
    hideBtn.onclick = async () => {
      await api('/gifts/toggle-hide', { method: 'POST', body: JSON.stringify({ userGiftId: g.userGiftId }) });
      $('#giftDetailModal').classList.add('hidden');
      renderMyProfile();
    };

    const sellBtn = $('#gdSellBtn');
    sellBtn.textContent = '⭐ Продать за +' + g.sellPrice;
    sellBtn.onclick = async () => {
      if (!confirm('Продать этот подарок за +' + g.sellPrice + ' ⭐?')) return;
      try {
        const res = await api('/gifts/sell', { method: 'POST', body: JSON.stringify({ userGiftId: g.userGiftId }) });
        state.user.stars = res.stars;
        renderTopHeader();
        $('#giftDetailModal').classList.add('hidden');
        renderMyProfile();
      } catch (err) { alert(err.message); }
    };
  }

  $('#giftDetailModal').classList.remove('hidden');
}

function renderGiftsGrid(container, gifts, isOwner = false) {
  container.innerHTML = gifts.length ? '' : '<div style="color:var(--muted);font-size:13px">Пока нет подарков</div>';
  for (const g of gifts) {
    const card = document.createElement('div');
    card.className = 'gift-card';
    const numStr = g.userGiftId ? ' #' + g.userGiftId : '';
    const dotSrc = g.isAnon ? ANON_AVATAR : (g.fromAvatar || DEFAULT_AVATAR);
    const hideMark = g.hidden ? '<span class="hidden-gift-badge" title="Скрыт">🙈</span>' : '';
    card.innerHTML =
      '<img class="gift-sender-dot" src="' + dotSrc + '" alt="">' +
      hideMark +
      '<div class="g-ico">' + (g.emoji || '🎁') + '</div>' +
      '<div class="g-name">' + esc((g.name || 'Подарок') + numStr) + '</div>' +
      '<div class="g-sub">⭐ ' + (g.price || 0) + '</div>';
    card.onclick = () => openGiftDetailModal(g, isOwner);
    container.appendChild(card);
  }
}
function applyHeroBannerStyle(el, bannerVal) {
  if (!bannerVal) {
    el.style.backgroundImage = 'linear-gradient(135deg, #1e3a8a, #581c87)';
  } else if (bannerVal.startsWith('linear-gradient')) {
    el.style.backgroundImage = bannerVal;
  } else {
    el.style.backgroundImage = 'url("' + bannerVal + '")';
  }
}

document.querySelectorAll('[data-prof-tab]').forEach(btn => {
  btn.onclick = () => {
    const tab = btn.dataset.profTab;
    document.querySelectorAll('[data-prof-tab]').forEach(b => b.classList.toggle('active', b === btn));
    $('#profTabPosts').classList.toggle('hidden', tab !== 'posts');
    $('#profTabGifts').classList.toggle('hidden', tab !== 'gifts');
  };
});

let profMusicAudio = null;
async function renderMyProfile() {
  const { user, gifts, posts } = await api('/users/' + state.user.id);
  state.user = user;
  renderTopHeader();

  applyHeroBannerStyle($('#myHeroBanner'), user.banner);
  const av = $('#profAvatar');
  av.src = user.avatar || DEFAULT_AVATAR;
  av.className = 'avatar xl bordered-av' + (user.avatarFrame ? ' ' + user.avatarFrame : '');

  $('#profNameTitle').innerHTML = nameStyledHtml(user);
  $('#profSubStatus').textContent = 'в сети • ID: ' + user.id;

  const mBar = $('#profMusicBar');
  const mPlay = $('#profMusicPlayBtn');
  if (user.musicText || user.musicAudio) {
    mBar.classList.remove('hidden');
    $('#profMusicLabel').textContent = '🎵 ' + (user.musicText || 'Аудио в профиле');
    if (user.musicAudio) {
      mPlay.classList.remove('hidden');
      mPlay.onclick = () => {
        if (!profMusicAudio) profMusicAudio = new Audio(user.musicAudio);
        if (profMusicAudio.paused) { profMusicAudio.play(); mPlay.textContent = '⏸'; }
        else { profMusicAudio.pause(); mPlay.textContent = '▶'; }
      };
    } else mPlay.classList.add('hidden');
  } else mBar.classList.add('hidden');

  const chCard = $('#profChannelCard');
  if (user.profileChannel) {
    chCard.classList.remove('hidden');
    $('#profChAvatar').src = user.profileChannel.avatar || DEFAULT_AVATAR;
    $('#profChTitle').textContent = user.profileChannel.title;
    $('#profChSubs').textContent = user.profileChannel.subs + ' подписчиков';
    $('#profChLast').textContent = user.profileChannel.lastText;
    chCard.onclick = () => {
      const c = state.chats.find(x => x.id === user.profileChannel.id);
      if (c) openChat(c);
    };
  } else chCard.classList.add('hidden');

  $('#profPhoneVal').textContent = user.anon_number || 'Не привязан (нажмите, чтобы купить +888 / +999)';
  $('#profPhoneRow').onclick = () => { if (!user.anon_number) $('#numberMarketModal').classList.remove('hidden'); };
  $('#profBioVal').textContent = user.bio || 'Нет описания';

  let uStr = user.username ? '@' + user.username : '@не_указан';
  if (user.nft_username) uStr += ' • 💎 @' + user.nft_username;
  $('#profUsernameVal').textContent = uStr;
  $('#profRatingVal').textContent = '🏆 ' + user.spentStars + ' очков (нажмите для кошелька)';
  $('#profRatingRow').onclick = openWalletModal;

  $('#myGiftsCount').textContent = gifts.length;
  renderGiftsGrid($('#myGiftsGrid'), gifts, true);

  const pGrid = $('#myPostsGrid');
  pGrid.innerHTML = posts.length ? '' : '<div style="color:var(--muted);font-size:13px">Пока нет публикаций</div>';
  for (const p of posts) {
    const card = document.createElement('div');
    card.className = 'post-card';
    card.innerHTML =
      '<img src="' + p.media_data + '" alt="">' +
      '<div class="post-foot"><span>' + esc(p.caption || 'Публикация') + '</span><span>❤️ ' + p.likes + '</span></div>';
    pGrid.appendChild(card);
  }
}

$('#quickPhotoBtn').onclick = () => $('#avatarInput').click();
$('#quickEditBtn').onclick = () => switchMainTab('Settings');
$('#quickSettingsBtn').onclick = () => switchMainTab('Settings');
$('#openQrBtn').onclick = () => {
  const u = state.user;
  const info = 'Визитка Lume:\nИмя: ' + u.name + '\nID: ' + u.id +
    (u.username ? '\nЮзернейм: @' + u.username : '') +
    (u.anon_number ? '\nНомер: ' + u.anon_number : '');
  navigator.clipboard?.writeText(info).catch(() => {});
  alert(info + '\n\n(Скопировано в буфер обмена!)');
};

$('#addPostBtn').onclick = () => $('#postPhotoInput').click();
$('#postPhotoInput').onchange = async e => {
  const file = e.target.files.item(0);
  if (!file) return;
  const img = await compressImageFile(file, 680, 0.82);
  const caption = prompt('Подпись к публикации (необязательно):') || '';
  await api('/posts/create', { method: 'POST', body: JSON.stringify({ mediaData: img, caption }) });
  e.target.value = '';
  renderMyProfile();
};

async function loadContacts() {
  const list = await api('/contacts');
  const box = $('#contactsList');
  box.innerHTML = list.length ? '' : '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">Контактов пока нет. Добавьте друга по ID, @username или номеру!</div>';
  for (const u of list) {
    const el = document.createElement('div');
    el.className = 'chat-item';
    el.innerHTML =
      '<img class="avatar" src="' + (u.avatar || DEFAULT_AVATAR) + '" alt="">' +
      '<div class="ci-body">' +
        '<div class="ci-title">' + nameStyledHtml(u) + '</div>' +
        '<div class="ci-last">' + formatLastSeen(u) + ' • ID: ' + u.id + '</div>' +
      '</div>';
    el.onclick = () => openPeerProfileById(u.id);
    box.appendChild(el);
  }
}

$('#addContactForm').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/contacts/add', { method: 'POST', body: JSON.stringify({ query: f.query.value }) });
    f.reset();
    loadContacts();
  } catch (err) { alert(err.message); }
};

$('#openNumberMarketBtn').onclick = () => {
  $('#numQuoteBox').classList.add('hidden');
  $('#numberMarketModal').classList.remove('hidden');
};

$('#checkNumBtn').onclick = async () => {
  try {
    const res = await api('/numbers/check', { method: 'POST', body: JSON.stringify({
      prefix: $('#numPrefixSelect').value,
      digits: $('#numDigitsInput').value
    })});
    $('#numFormattedText').textContent = res.number;
    $('#numPriceText').textContent = res.price;
    $('#numQuoteBox').classList.remove('hidden');
  } catch (err) { alert(err.message); }
};

$('#buyNumBtn').onclick = async () => {
  if (!confirm('Купить и привязать этот номер к аккаунту?')) return;
  try {
    const res = await api('/numbers/buy', { method: 'POST', body: JSON.stringify({
      prefix: $('#numPrefixSelect').value,
      digits: $('#numDigitsInput').value
    })});
    state.user = res.user;
    renderTopHeader();
    $('#numberMarketModal').classList.add('hidden');
    alert('Поздравляем! Номер ' + res.user.anon_number + ' привязан к вашему аккаунту!');
  } catch (err) { alert(err.message); }
};
async function openWalletModal() {
  const data = await api('/wallet');
  state.walletCache = data;
  $('#walBalance').textContent = data.stars;
  $('#walSpent').textContent = data.spentStars;
  $('#walEarned').textContent = data.earnedStars;
  $('#qMsgsVal').textContent = data.quests.msgs;
  $('#qReactsVal').textContent = data.quests.reacts;
  $('#claimQuestBtn').disabled = data.quests.claimed;
  $('#claimQuestBtn').textContent = data.quests.claimed ? 'Награда получена ✓' : 'Забрать награду за задания';

  const logsBox = $('#walLogsList');
  logsBox.innerHTML = data.logs.length ? '' : '<div style="color:var(--muted);font-size:13px">История операций пока пуста</div>';
  for (const l of data.logs) {
    const row = document.createElement('div');
    row.className = 'info-box';
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 10px;font-size:13px';
    const plus = l.amount > 0;
    row.innerHTML = '<span>' + esc(l.reason) + '</span><b style="color:' + (plus ? '#34d399' : '#f87171') + '">' + (plus ? '+' : '') + l.amount + ' ⭐</b>';
    logsBox.appendChild(row);
  }

  renderLeaderboard(state.currentTopKind);
  $('#walletModal').classList.remove('hidden');
}

function renderLeaderboard(kind) {
  state.currentTopKind = kind;
  if (!state.walletCache) return;
  const arr = kind === 'spent' ? state.walletCache.topSpent : (kind === 'earned' ? state.walletCache.topEarned : state.walletCache.topOnline);
  const box = $('#walTopList');
  box.innerHTML = '';
  arr.forEach((u, i) => {
    const valStr = kind === 'online' ? (Math.floor(u.val / 60) + ' мин.') : (u.val + ' ⭐');
    const row = document.createElement('div');
    row.className = 'info-box';
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 10px;font-size:13px;cursor:pointer';
    row.innerHTML = '<span><b>#' + (i + 1) + '</b> ' + esc(u.name) + '</span><b style="color:#fbbf24">' + valStr + '</b>';
    row.onclick = () => { $('#walletModal').classList.add('hidden'); openPeerProfileById(u.id); };
    box.appendChild(row);
  });
}

$('#openWalletBtn').onclick = openWalletModal;
$('#openWalletFromProfBtn').onclick = openWalletModal;

document.querySelectorAll('[data-wal-tab]').forEach(btn => {
  btn.onclick = () => {
    const t = btn.dataset.walTab;
    document.querySelectorAll('[data-wal-tab]').forEach(b => b.classList.toggle('active', b === btn));
    $('#walTabEarn').classList.toggle('hidden', t !== 'earn');
    $('#walTabLogs').classList.toggle('hidden', t !== 'logs');
    $('#walTabTops').classList.toggle('hidden', t !== 'tops');
  };
});

document.querySelectorAll('[data-top-kind]').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('[data-top-kind]').forEach(b => b.classList.toggle('active', b === btn));
    renderLeaderboard(btn.dataset.topKind);
  };
});

$('#dailyBonusBtn').onclick = async () => {
  try {
    const res = await api('/bonus/daily', { method: 'POST' });
    state.user.stars = res.stars;
    renderTopHeader();
    openWalletModal();
    alert('Получено +' + res.reward + ' ⭐!');
  } catch (err) { alert(err.message); }
};

$('#claimQuestBtn').onclick = async () => {
  try {
    const res = await api('/wallet/quest-claim', { method: 'POST' });
    state.user.stars = res.stars;
    renderTopHeader();
    openWalletModal();
    alert('Награда за задания получена: +' + res.reward + ' ⭐!');
  } catch (err) { alert(err.message); }
};

$('#spinRouletteBtn').onclick = async () => {
  try {
    const res = await api('/games/roulette', { method: 'POST' });
    state.user.stars = res.stars;
    renderTopHeader();
    openWalletModal();
    alert(res.win > 0 ? ('Выпало: +' + res.win + ' ⭐!') : 'В этот раз не повезло (0 ⭐). Попробуйте ещё!');
  } catch (err) { alert(err.message); }
};

$('#rollDiceBtn').onclick = async () => {
  try {
    const res = await api('/games/dice', { method: 'POST', body: JSON.stringify({ bet: Number($('#diceBetInput').value) }) });
    state.user.stars = res.stars;
    renderTopHeader();
    openWalletModal();
    alert('На кубике выпало ' + res.roll + '! ' + (res.win > 0 ? ('Выигрыш: +' + res.win + ' ⭐!') : 'Ставка не сыграла.'));
  } catch (err) { alert(err.message); }
};

$('#redeemPromoBtn').onclick = async () => {
  try {
    const res = await api('/promo/redeem', { method: 'POST', body: JSON.stringify({ code: $('#promoInput').value }) });
    state.user.stars = res.stars;
    $('#promoInput').value = '';
    renderTopHeader();
    openWalletModal();
    alert('Промокод активирован! Начислено +' + res.reward + ' ⭐');
  } catch (err) { alert(err.message); }
};

function populateSettingsForm() {
  const u = state.user;
  $('#setAvatar').src = u.avatar || DEFAULT_AVATAR;
  $('#setNameInput').value = u.name;
  $('#setUsernameInput').value = u.username || '';
  $('#setBioInput').value = u.bio || '';
  $('#setMusicTextInput').value = u.musicText || '';
  $('#setEmojiStatus').value = u.emojiStatus || '';
  $('#setNameColor').value = u.nameColor || '';
  $('#setBubbleColor').value = u.bubbleColor || '';
  $('#setAvatarFrame').value = u.avatarFrame || '';
  $('#setThemeSelect').value = u.theme || 'dark';
  $('#setLangSelect').value = u.lang || 'ru';
  $('#setGarland').checked = u.garland !== false;
  $('#setHideEmail').checked = Boolean(u.hideEmail);
  $('#setHideLastSeen').checked = Boolean(u.hideLastSeen);
  $('#adminInvisRow').classList.toggle('hidden', !u.isAdmin);
  $('#setAdminInvisible').checked = Boolean(u.adminInvisible);
  $('#setPinInput').value = '';
  $('#setEmailInput').value = u.email || '';
  $('#setPassInput').value = '';

  const chSel = $('#setProfileChannelSelect');
  chSel.innerHTML = '<option value="0">— Не показывать канал —</option>';
  state.chats.filter(c => c.type === 'channel' && c.ownerId === u.id).forEach(ch => {
    const opt = document.createElement('option');
    opt.value = ch.id;
    opt.textContent = ch.title;
    chSel.appendChild(opt);
  });
  chSel.value = String(u.profileChannelId || 0);

  if (u.isPremium) {
    $('#buyPremBtn').textContent = 'Активен ✓';
    $('#buyPremBtn').disabled = true;
  } else {
    $('#buyPremBtn').textContent = '5 000 ⭐';
    $('#buyPremBtn').disabled = false;
  }
}

$('#buyPremBtn').onclick = async () => {
  if (!confirm('Купить вечный Lume Premium за 5 000 ⭐?')) return;
  try {
    const res = await api('/premium/buy', { method: 'POST' });
    state.user = res.user;
    renderTopHeader();
    populateSettingsForm();
    alert('Поздравляем! Вечный Lume Premium ⭐ активирован!');
  } catch (err) { alert(err.message); }
};

$('#avatarInput').onchange = async e => {
  const file = e.target.files.item(0);
  if (!file) return;
  const img = await compressImageFile(file, 360, 0.8);
  const updated = await api('/profile', { method: 'POST', body: JSON.stringify({ avatar: img }) });
  state.user = updated;
  $('#setAvatar').src = updated.avatar;
  renderTopHeader();
};

$('#bannerInput').onchange = async e => {
  const file = e.target.files.item(0);
  if (!file) return;
  const img = await compressImageFile(file, 720, 0.8);
  const updated = await api('/profile', { method: 'POST', body: JSON.stringify({ banner: img }) });
  state.user = updated;
  alert('Баннер профиля обновлён!');
};

$('#musicAudioInput').onchange = e => {
  const file = e.target.files.item(0);
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) return alert('Аудиофайл слишком большой (максимум 4 МБ)');
  const reader = new FileReader();
  reader.onload = async () => {
    const updated = await api('/profile', { method: 'POST', body: JSON.stringify({ musicAudio: reader.result }) });
    state.user = updated;
    alert('Аудио-трек прикреплён к профилю!');
  };
  reader.readAsDataURL(file);
};

$('#setThemeSelect').onchange = () => applyThemeAndGarland({ theme: $('#setThemeSelect').value, garland: $('#setGarland').checked });
$('#setGarland').onchange = () => applyThemeAndGarland({ theme: $('#setThemeSelect').value, garland: $('#setGarland').checked });
$('#setLangSelect').onchange = () => applyLang($('#setLangSelect').value);

$('#settingsForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const body = {
      name: $('#setNameInput').value,
      username: $('#setUsernameInput').value,
      bio: $('#setBioInput').value,
      musicText: $('#setMusicTextInput').value,
      profileChannelId: Number($('#setProfileChannelSelect').value),
      emojiStatus: $('#setEmojiStatus').value,
      nameColor: $('#setNameColor').value,
      bubbleColor: $('#setBubbleColor').value,
      avatarFrame: $('#setAvatarFrame').value,
      theme: $('#setThemeSelect').value,
      lang: $('#setLangSelect').value,
      garland: $('#setGarland').checked,
      hideEmail: $('#setHideEmail').checked,
      hideLastSeen: $('#setHideLastSeen').checked,
      adminInvisible: $('#setAdminInvisible').checked,
      email: $('#setEmailInput').value,
      password: $('#setPassInput').value
    };
    const preset = $('#setBannerPreset').value;
    if (preset) body.banner = preset;
    const pinVal = $('#setPinInput').value.trim();
    if (pinVal) body.pinCode = pinVal;

    const updated = await api('/profile', { method: 'POST', body: JSON.stringify(body) });
    state.user = updated;
    renderTopHeader();
    $('#setPassInput').value = '';
    alert('Все настройки сохранены!');
  } catch (err) { alert(err.message); }
};

$('#resetSessionsBtn').onclick = async () => {
  if (!confirm('Завершить все другие активные сессии на других устройствах?')) return;
  const res = await api('/sessions/reset', { method: 'POST' });
  state.token = res.token;
  localStorage.setItem('token', res.token);
  alert('Все остальные сессии завершены!');
};
let peerMusicAudio = null;
async function openPeerProfileById(userId) {
  const { user, gifts } = await api('/users/' + userId);
  applyHeroBannerStyle($('#peerHeroBanner'), user.banner);
  const av = $('#peerAvatar');
  av.src = user.avatar || DEFAULT_AVATAR;
  av.className = 'avatar xl bordered-av' + (user.avatarFrame ? ' ' + user.avatarFrame : '');

  $('#peerNameTitle').innerHTML = nameStyledHtml(user);
  $('#peerSubStatus').textContent = formatLastSeen(user) + ' • ID: ' + user.id;

  const mBar = $('#peerMusicBar');
  const mPlay = $('#peerMusicPlayBtn');
  if (user.musicText || user.musicAudio) {
    mBar.classList.remove('hidden');
    $('#peerMusicLabel').textContent = '🎵 ' + (user.musicText || 'Аудио в профиле');
    if (user.musicAudio) {
      mPlay.classList.remove('hidden');
      mPlay.onclick = () => {
        if (!peerMusicAudio) peerMusicAudio = new Audio(user.musicAudio);
        if (peerMusicAudio.paused) { peerMusicAudio.play(); mPlay.textContent = '⏸'; }
        else { peerMusicAudio.pause(); mPlay.textContent = '▶'; }
      };
    } else mPlay.classList.add('hidden');
  } else mBar.classList.add('hidden');

  const chCard = $('#peerChannelCard');
  if (user.profileChannel) {
    chCard.classList.remove('hidden');
    $('#peerChTitle').textContent = '📢 ' + user.profileChannel.title + ' (' + user.profileChannel.subs + ' подп.)';
    chCard.onclick = async () => {
      $('#peerProfileModal').classList.add('hidden');
      const { id } = await api('/chats', { method: 'POST', body: JSON.stringify({ query: user.profileChannel.username || String(user.profileChannel.id) }) });
      await loadChats();
      const c = state.chats.find(x => x.id === id);
      if (c) openChat(c);
    };
  } else chCard.classList.add('hidden');

  if (user.anon_number) {
    $('#peerPhoneRow').classList.remove('hidden');
    $('#peerPhoneVal').textContent = user.anon_number;
  } else $('#peerPhoneRow').classList.add('hidden');

  $('#peerBio').textContent = user.bio || 'Нет описания';
  let uStr = user.username ? '@' + user.username : 'Нет @username';
  if (user.nft_username) uStr += ' • 💎 @' + user.nft_username;
  $('#peerUsernames').textContent = uStr;
  $('#peerRatingVal').textContent = '🏆 ' + user.spentStars + ' очков';

  $('#peerGiftsCount').textContent = gifts.length;
  renderGiftsGrid($('#peerGiftsGrid'), gifts, false);
  state.giftTargetUserId = user.id;
  state.giftTargetChatId = 0;

  $('#peerTransferBtn').onclick = async () => {
    const val = prompt('Сколько звёзд ⭐ перевести пользователю ' + user.name + '?', '50');
    if (!val) return;
    try {
      const res = await api('/stars/transfer', { method: 'POST', body: JSON.stringify({ toUserId: user.id, amount: Number(val) }) });
      state.user.stars = res.stars;
      renderTopHeader();
      alert('Перевод выполнен!');
    } catch (err) { alert(err.message); }
  };

  $('#peerProfileModal').classList.remove('hidden');
}

$('#chatHeaderInfo').onclick = () => {
  if (!state.activeChat) return;
  if (state.activeChat.type === 'private' && state.activeChat.peer) {
    openPeerProfileById(state.activeChat.peer.id);
  } else if (state.activeChat.type === 'group' || state.activeChat.type === 'channel') {
    openRoomProfile(state.activeChat.id);
  }
};

function openGiftShop(targetUserId, targetChatId = 0) {
  state.giftTargetUserId = targetUserId;
  state.giftTargetChatId = targetChatId;
  $('#giftModalStars').textContent = state.user.stars;
  $('#giftCaptionInput').value = '';
  $('#giftAnonCheck').checked = false;

  const grid = $('#shopGrid');
  grid.innerHTML = '';
  for (const g of state.shop) {
    const card = document.createElement('div');
    card.className = 'gift-card';
    const limHtml = g.limited ? '<div style="font-size:10px;color:#f59e0b">Осталось: ' + g.left + ' / ' + g.limited + '</div>' : '';
    card.innerHTML =
      '<div class="g-ico">' + g.emoji + '</div>' +
      '<div class="g-name">' + esc(g.name) + '</div>' +
      limHtml +
      '<div class="g-sub" style="color:#fbbf24;font-weight:700">' + g.price + ' ⭐</div>';
    card.onclick = async () => {
      try {
        const res = await api('/gifts/send', { method: 'POST', body: JSON.stringify({
          toUserId: state.giftTargetUserId,
          toChatId: state.giftTargetChatId,
          giftId: g.id,
          caption: $('#giftCaptionInput').value,
          isAnon: $('#giftAnonCheck').checked
        })});
        state.user.stars = res.stars;
        renderTopHeader();
        $('#giftModal').classList.add('hidden');
        $('#peerProfileModal').classList.add('hidden');
        $('#roomProfileModal').classList.add('hidden');
      } catch (err) { alert(err.message); }
    };
    grid.appendChild(card);
  }
  $('#giftModal').classList.remove('hidden');
}

$('#openGiftBtn').onclick = () => {
  if (!state.activeChat?.peer) return;
  openGiftShop(state.activeChat.peer.id, 0);
};
$('#peerGiftBtn').onclick = () => openGiftShop(state.giftTargetUserId, 0);

$('#openAdminBtn').onclick = () => {
  $('#admQuery').value = String(state.user.id);
  $('#admVerified').checked = state.user.verified;
  $('#admPremium').checked = state.user.isPremium;
  $('#adminModal').classList.remove('hidden');
};

document.querySelectorAll('[data-adm-tab]').forEach(btn => {
  btn.onclick = async () => {
    const t = btn.dataset.admTab;
    document.querySelectorAll('[data-adm-tab]').forEach(b => b.classList.toggle('active', b === btn));
    $('#adminForm').classList.toggle('hidden', t !== 'grant');
    $('#admTabBans').classList.toggle('hidden', t !== 'bans');
    $('#admTabReports').classList.toggle('hidden', t !== 'reports');
    if (t === 'reports') {
      const reps = await api('/admin/reports');
      const box = $('#reportsList');
      box.innerHTML = reps.length ? '' : '<div style="color:var(--muted);font-size:13px">Жалоб пока нет</div>';
      for (const r of reps) {
        const div = document.createElement('div');
        div.className = 'info-box';
        div.style.fontSize = '12px';
        div.innerHTML = '<b>[' + esc(r.target_type) + ' #' + r.target_id + ']</b> от ' + esc(r.from_name) + '<br>' + esc(r.reason);
        box.appendChild(div);
      }
    }
  };
});

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
      renderTopHeader();
    }
    $('#admStars').value = '';
    $('#admGiftSelect').value = '';
    const extra = res.giftNum ? ' (подарок #' + res.giftNum + ')' : '';
    alert('Успешно выдано пользователю ' + res.user.name + extra + '!');
  } catch (err) { alert(err.message); }
};

$('#banUserBtn').onclick = async () => {
  try {
    const res = await api('/admin/ban-user', { method: 'POST', body: JSON.stringify({ query: $('#banUserQuery').value }) });
    alert(res.name + (res.banned ? ' заблокирован 🚫' : ' разблокирован ✓'));
  } catch (err) { alert(err.message); }
};

$('#banChannelBtn').onclick = async () => {
  try {
    const res = await api('/admin/ban-channel', { method: 'POST', body: JSON.stringify({ query: $('#banChannelQuery').value }) });
    alert(res.title + (res.banned ? ' заблокирован 🚫' : ' разблокирован ✓'));
  } catch (err) { alert(err.message); }
};

$('#createPromoBtn').onclick = async () => {
  try {
    await api('/admin/promo', { method: 'POST', body: JSON.stringify({
      code: $('#newPromoCode').value,
      reward: Number($('#newPromoReward').value),
      uses: Number($('#newPromoUses').value)
    })});
    alert('Промокод создан!');
    $('#newPromoCode').value = '';
  } catch (err) { alert(err.message); }
};

(async function init() {
  applyThemeAndGarland(null);
  if (!state.token) return;
  try {
    state.user = await api('/me');
    await enterApp();
  } catch { logout(); }
})();
