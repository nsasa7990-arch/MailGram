const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const initSqlJs = require('sql.js');
const { Server } = require('socket.io');

const JWT_SECRET = process.env.JWT_SECRET || 'lume-secret-key-2026';
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'mailgram.db');
const ADMIN_EMAIL = 'licciy093@gmail.com';
const GH_TOKEN = (process.env.GITHUB_TOKEN || '').trim();
const GH_API = 'https://github.com';
const GIFTS = {
      "ALTER TABLE users ADD COLUMN music_text TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN music_audio TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN profile_channel_id INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN emoji_status TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN name_color TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN bubble_color TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN avatar_frame TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN garland INTEGER DEFAULT 1",
    "ALTER TABLE users ADD COLUMN hide_last_seen INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN admin_invisible INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN pin_code TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN token_ver INTEGER DEFAULT 1",
    "ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN last_seen INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN online_sec INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN last_bonus INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN quest_date TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN q_msgs INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN q_reacts INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN q_claimed INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN spent_stars INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN earned_stars INTEGER DEFAULT 0",
    "ALTER TABLE chats ADD COLUMN avatar TEXT DEFAULT ''",
    "ALTER TABLE chats ADD COLUMN bio TEXT DEFAULT ''",
    "ALTER TABLE chats ADD COLUMN invite_code TEXT DEFAULT ''",
    "ALTER TABLE chats ADD COLUMN is_banned INTEGER DEFAULT 0",
    "ALTER TABLE chats ADD COLUMN pinned_msg_id INTEGER DEFAULT 0",
    "ALTER TABLE chat_members ADD COLUMN role TEXT DEFAULT 'member'",
    "ALTER TABLE chat_members ADD COLUMN pinned INTEGER DEFAULT 0",
    "ALTER TABLE chat_members ADD COLUMN hidden INTEGER DEFAULT 0",
    "ALTER TABLE messages ADD COLUMN reply_to_id INTEGER DEFAULT 0",
    "ALTER TABLE messages ADD COLUMN fwd_from TEXT DEFAULT ''",
    "ALTER TABLE messages ADD COLUMN one_time INTEGER DEFAULT 0",
    "ALTER TABLE messages ADD COLUMN viewed_by TEXT DEFAULT '[]'",
    "ALTER TABLE messages ADD COLUMN views_count INTEGER DEFAULT 1",
    "ALTER TABLE messages ADD COLUMN stars_donated INTEGER DEFAULT 0",
    "ALTER TABLE messages ADD COLUMN poll_json TEXT DEFAULT ''",
    "ALTER TABLE user_gifts ADD COLUMN to_chat_id INTEGER DEFAULT 0",
    "ALTER TABLE user_gifts ADD COLUMN caption TEXT DEFAULT ''",
    "ALTER TABLE user_gifts ADD COLUMN is_anon INTEGER DEFAULT 0",
    "ALTER TABLE user_gifts ADD COLUMN hidden INTEGER DEFAULT 0",
    "ALTER TABLE user_gifts ADD COLUMN is_nft INTEGER DEFAULT 0",
    "ALTER TABLE user_gifts ADD COLUMN nft_bg TEXT DEFAULT ''",
    "ALTER TABLE user_gifts ADD COLUMN nft_pattern TEXT DEFAULT ''",
    "ALTER TABLE user_gifts ADD COLUMN market_price INTEGER DEFAULT 0",
  lollipop: { id: 'lollipop', name: 'Сладкий Леденец', emoji: '🍭', price: 10 },
  bear: { id: 'bear', name: 'Плюшевый Мишка', emoji: '🧸', price: 15 },
  heart: { id: 'heart', name: 'Сердце с бантиком', emoji: '💝', price: 25 },
  snowman: { id: 'snowman', name: 'Новогодний Снеговик', emoji: '⛄', price: 50 },
  tree: { id: 'tree', name: 'Новогодняя Ёлка', emoji: '🎄', price: 100 },
  ring: { id: 'ring', name: 'Кольцо с бриллиантом', emoji: '💍', price: 250 },
  crown: { id: 'crown', name: 'Золотая Корона', emoji: '👑', price: 1500 },
  unicorn: { id: 'unicorn', name: 'Лимитированный Единорог', emoji: '🦄', price: 10000, limited: 1000 }
};

const EXCLUSIVE_GIFTS = {
  crystal: { id: 'crystal', name: 'Редкий Кристалл (Admin)', emoji: '💎', price: 5000, exclusive: true },
  dragon: { id: 'dragon', name: 'Огненный Дракон (Admin)', emoji: '🐉', price: 15000, exclusive: true },
  rocket: { id: 'rocket', name: 'Ракета Lume (Admin)', emoji: '🚀', price: 25000, exclusive: true }
};

const ALL_GIFTS = { ...GIFTS, ...EXCLUSIVE_GIFTS };
let dbSha = null;
let diskTimer = null;
let ghTimer = null;

async function restoreDbFromGithub() {
  if (!GH_TOKEN) return;
  try {
    const res = await fetch(GH_API, {
      headers: { Authorization: 'Bearer ' + GH_TOKEN, 'User-Agent': 'LumeApp' }
    });
    if (!res.ok) return;
    const data = await res.json();
    dbSha = data.sha;
    if (data.content) fs.writeFileSync(DB_FILE, Buffer.from(data.content, 'base64'));
  } catch {}
}

function scheduleSave(sqlDb) {
  clearTimeout(diskTimer);
  diskTimer = setTimeout(() => {
    try { fs.writeFileSync(DB_FILE, Buffer.from(sqlDb.export())); } catch {}
    if (!GH_TOKEN) return;
    clearTimeout(ghTimer);
    ghTimer = setTimeout(async () => {
      try {
        const content = fs.readFileSync(DB_FILE).toString('base64');
        if (!dbSha) {
          const chk = await fetch(GH_API, { headers: { Authorization: 'Bearer ' + GH_TOKEN, 'User-Agent': 'LumeApp' } });
          if (chk.ok) dbSha = (await chk.json()).sha;
        }
        const body = { message: 'sync lume db', content };
        if (dbSha) body.sha = dbSha;
        const put = await fetch(GH_API, {
          method: 'PUT',
          headers: { Authorization: 'Bearer ' + GH_TOKEN, 'User-Agent': 'LumeApp', 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (put.ok) dbSha = (await put.json()).content?.sha || dbSha;
      } catch {}
    }, 2000);
  }, 600);
}

function createDbWrapper(sqlDb) {
  return {
    exec(sql) { sqlDb.run(sql); scheduleSave(sqlDb); },
    prepare(sql) {
      return {
        get(...params) {
          const stmt = sqlDb.prepare(sql);
          stmt.bind(params);
          const row = stmt.step() ? stmt.getAsObject() : undefined;
          stmt.free();
          return row;
        },
        all(...params) {
          const stmt = sqlDb.prepare(sql);
          stmt.bind(params);
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          stmt.free();
          return rows;
        },
        run(...params) {
          sqlDb.run(sql, params);
          const res = sqlDb.exec('SELECT last_insert_rowid() AS id');
          const lastInsertRowid = res.at(0)?.values?.at(0)?.at(0) || 0;
          scheduleSave(sqlDb);
          return { lastInsertRowid };
        }
      };
    }
  };
}

function calcNumberPrice(digits) {
  const unique = new Set(digits.split('')).size;
  if (unique === 1) return 15000;
  if (unique === 2) return 5000;
  if (digits.endsWith('0000') || digits.endsWith('7777') || digits.slice(0, 4) === digits.slice(4)) return 1500;
  if (unique <= 4) return 750;
  return 250;
}
async function start() {
  await restoreDbFromGithub();
  const SQL = await initSqlJs();
  const rawDb = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();
  const db = createDbWrapper(rawDb);

  db.exec(
    "CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, verified INTEGER DEFAULT 0, avatar TEXT DEFAULT '', banner TEXT DEFAULT '', bio TEXT DEFAULT '', music_text TEXT DEFAULT '', music_audio TEXT DEFAULT '', profile_channel_id INTEGER DEFAULT 0, username TEXT DEFAULT '', nft_username TEXT DEFAULT '', anon_number TEXT DEFAULT '', is_premium INTEGER DEFAULT 0, emoji_status TEXT DEFAULT '', name_color TEXT DEFAULT '', bubble_color TEXT DEFAULT '', avatar_frame TEXT DEFAULT '', theme TEXT DEFAULT 'dark', garland INTEGER DEFAULT 1, hide_email INTEGER DEFAULT 0, hide_last_seen INTEGER DEFAULT 0, admin_invisible INTEGER DEFAULT 0, pin_code TEXT DEFAULT '', token_ver INTEGER DEFAULT 1, lang TEXT DEFAULT 'ru', is_banned INTEGER DEFAULT 0, last_seen INTEGER DEFAULT 0, online_sec INTEGER DEFAULT 0, last_bonus INTEGER DEFAULT 0, quest_date TEXT DEFAULT '', q_msgs INTEGER DEFAULT 0, q_reacts INTEGER DEFAULT 0, q_claimed INTEGER DEFAULT 0, spent_stars INTEGER DEFAULT 0, earned_stars INTEGER DEFAULT 0, stars INTEGER DEFAULT 100);" +
    "CREATE TABLE IF NOT EXISTS contacts(user_id INTEGER NOT NULL, peer_id INTEGER NOT NULL, PRIMARY KEY(user_id, peer_id));" +
    "CREATE TABLE IF NOT EXISTS blocks(user_id INTEGER NOT NULL, blocked_id INTEGER NOT NULL, PRIMARY KEY(user_id, blocked_id));" +
    "CREATE TABLE IF NOT EXISTS chats(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, type TEXT DEFAULT 'private', owner_id INTEGER DEFAULT 0, username TEXT DEFAULT '', avatar TEXT DEFAULT '', bio TEXT DEFAULT '', invite_code TEXT DEFAULT '', is_banned INTEGER DEFAULT 0, pinned_msg_id INTEGER DEFAULT 0);" +
    "CREATE TABLE IF NOT EXISTS chat_members(chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT DEFAULT 'member', pinned INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0, PRIMARY KEY(chat_id, user_id));" +
    "CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL, text TEXT NOT NULL, reply_to_id INTEGER DEFAULT 0, fwd_from TEXT DEFAULT '', gift_id TEXT DEFAULT '', gift_num INTEGER DEFAULT 0, media_type TEXT DEFAULT '', media_data TEXT DEFAULT '', one_time INTEGER DEFAULT 0, viewed_by TEXT DEFAULT '[]', views_count INTEGER DEFAULT 1, stars_donated INTEGER DEFAULT 0, poll_json TEXT DEFAULT '', edited INTEGER DEFAULT 0, reactions TEXT DEFAULT '{}', created_at INTEGER NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS user_gifts(id INTEGER PRIMARY KEY AUTOINCREMENT, to_user_id INTEGER DEFAULT 0, to_chat_id INTEGER DEFAULT 0, from_user_id INTEGER NOT NULL, gift_id TEXT NOT NULL, caption TEXT DEFAULT '', is_anon INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0, is_nft INTEGER DEFAULT 0, nft_bg TEXT DEFAULT '', nft_pattern TEXT DEFAULT '', market_price INTEGER DEFAULT 0, created_at INTEGER NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS star_logs(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS stories(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, media_data TEXT NOT NULL, caption TEXT DEFAULT '', expires_at INTEGER NOT NULL, views INTEGER DEFAULT 0, created_at INTEGER NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, media_data TEXT NOT NULL, caption TEXT DEFAULT '', likes INTEGER DEFAULT 0, created_at INTEGER NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS stickers(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, image_data TEXT NOT NULL, created_at INTEGER NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS promos(code TEXT PRIMARY KEY, reward INTEGER NOT NULL, uses_left INTEGER NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS promo_uses(code TEXT NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY(code, user_id));" +
    "CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY AUTOINCREMENT, from_user_id INTEGER NOT NULL, target_type TEXT NOT NULL, target_id INTEGER NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);"
  );
    const alters = [
    "ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN banner TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN username TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN nft_username TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN anon_number TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN is_premium INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'dark'",
    "ALTER TABLE users ADD COLUMN hide_email INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN lang TEXT DEFAULT 'ru'",
    "ALTER TABLE users ADD COLUMN stars INTEGER DEFAULT 100",
    "ALTER TABLE chats ADD COLUMN type TEXT DEFAULT 'private'",
    "ALTER TABLE chats ADD COLUMN owner_id INTEGER DEFAULT 0",
    "ALTER TABLE chats ADD COLUMN username TEXT DEFAULT ''",
    "ALTER TABLE messages ADD COLUMN gift_id TEXT DEFAULT ''",
    "ALTER TABLE messages ADD COLUMN gift_num INTEGER DEFAULT 0",
    "ALTER TABLE messages ADD COLUMN media_type TEXT DEFAULT ''",
    "ALTER TABLE messages ADD COLUMN media_data TEXT DEFAULT ''",
    "ALTER TABLE messages ADD COLUMN edited INTEGER DEFAULT 0",
    "ALTER TABLE messages ADD COLUMN reactions TEXT DEFAULT '{}'",

  ];
  for (const sql of alters) { try { db.exec(sql); } catch {} }

  db.prepare('UPDATE users SET verified=1, is_premium=1, is_banned=0 WHERE email=?').run(ADMIN_EMAIL);

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 12 * 1024 * 1024 });
  app.use(express.json({ limit: '12mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  const onlineUsers = new Set();

  function logStar(userId, amount, reason) {
    if (!amount) return;
    db.prepare('INSERT INTO star_logs(user_id,amount,reason,created_at) VALUES(?,?,?,?)').run(userId, amount, reason, Date.now());
    if (amount < 0) {
      db.prepare('UPDATE users SET spent_stars = spent_stars + ? WHERE id=?').run(Math.abs(amount), userId);
    } else {
      db.prepare('UPDATE users SET earned_stars = earned_stars + ? WHERE id=?').run(amount, userId);
    }
  }

  function ensureSavedChat(userId) {
    let saved = db.prepare("SELECT c.id FROM chats c JOIN chat_members cm ON cm.chat_id=c.id WHERE c.type='saved' AND cm.user_id=? LIMIT 1").get(userId);
    if (!saved) {
      const cid = Number(db.prepare("INSERT INTO chats(title,type,owner_id) VALUES('Избранное','saved',?)").run(userId).lastInsertRowid);
      db.prepare("INSERT INTO chat_members(chat_id,user_id,role,pinned) VALUES(?,?,'owner',1)").run(cid, userId);
    }
  }

  const pub = (u, viewer = null) => {
    const isOwner = viewer && viewer.id === u.id;
    const viewerPrem = viewer && (viewer.is_premium || viewer.email === ADMIN_EMAIL);
    const isOnline = !u.admin_invisible && onlineUsers.has(u.id);
    let lastSeenVal = 0;
    if (!u.admin_invisible && !isOnline) {
      if (isOwner || !u.hide_last_seen || viewerPrem) {
        lastSeenVal = Number(u.last_seen || 0);
      } else {
        lastSeenVal = -1;
      }
    }

    let profCh = null;
    if (u.profile_channel_id) {
      const ch = db.prepare('SELECT id, title, avatar, username FROM chats WHERE id=? AND is_banned=0').get(u.profile_channel_id);
      if (ch) {
        const subs = db.prepare('SELECT COUNT(*) AS c FROM chat_members WHERE chat_id=?').get(ch.id)?.c || 1;
        const lastMsg = db.prepare('SELECT text FROM messages WHERE chat_id=? ORDER BY id DESC LIMIT 1').get(ch.id)?.text || 'Канал создан';
        profCh = { ...ch, subs, lastText: lastMsg };
      }
    }

    return {
      id: u.id,
      email: (isOwner || !u.hide_email) ? u.email : '',
      hideEmail: Boolean(u.hide_email),
      hideLastSeen: Boolean(u.hide_last_seen),
      adminInvisible: Boolean(u.admin_invisible),
      hasPin: Boolean(u.pin_code),
      lang: u.lang || 'ru',
      name: u.name,
      verified: Boolean(u.verified || u.email === ADMIN_EMAIL),
      isAdmin: u.email === ADMIN_EMAIL,
      isPremium: Boolean(u.is_premium || u.email === ADMIN_EMAIL),
      isBanned: Boolean(u.is_banned),
      avatar: u.avatar || '',
      banner: u.banner || '',
      bio: u.bio || '',
      musicText: u.music_text || '',
      musicAudio: u.music_audio || '',
      profileChannelId: Number(u.profile_channel_id || 0),
      profileChannel: profCh,
      username: u.username || '',
      nft_username: u.nft_username || '',
      anon_number: u.anon_number || '',
      emojiStatus: u.emoji_status || '',
      nameColor: u.name_color || '',
      bubbleColor: u.bubble_color || '',
      avatarFrame: u.avatar_frame || '',
      theme: u.theme || 'dark',
      garland: u.garland !== 0,
      isOnline,
      lastSeen: lastSeenVal,
      onlineSec: Number(u.online_sec || 0),
      spentStars: Number(u.spent_stars || 0),
      earnedStars: Number(u.earned_stars || 0),
      stars: Number(u.stars || 0)
    };
  };

  const sign = u => jwt.sign({ id: u.id, v: u.token_ver || 1 }, JWT_SECRET, { expiresIn: '30d' });

  function auth(req, res, next) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(payload.id);
      if (!user || (payload.v && payload.v !== (user.token_ver || 1))) return res.status(401).json({ error: 'Сессия завершена' });
      if (user.is_banned && user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Аккаунт заблокирован администратором' });
      req.user = user;
      next();
    } catch { res.status(401).json({ error: 'Неверный токен' }); }
  }

  app.post('/api/register', async (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password || !name) return res.status(400).json({ error: 'Заполните все поля' });
    if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    const norm = email.trim().toLowerCase();
    if (db.prepare('SELECT id FROM users WHERE email=?').get(norm)) return res.status(409).json({ error: 'Email уже занят' });
    const isAdm = norm === ADMIN_EMAIL;
    const hash = await bcrypt.hash(password, 10);
    const id = Number(db.prepare(
      'INSERT INTO users(email,name,password_hash,verified,is_premium,stars) VALUES(?,?,?,?,?,?)'
    ).run(norm, name.trim(), hash, isAdm ? 1 : 0, isAdm ? 1 : 0, isAdm ? 10000 : 100).lastInsertRowid);
    ensureSavedChat(id);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    res.json({ token: sign(user), user: pub(user, user) });
  });

  app.post('/api/login', async (req, res) => {
    const rawLogin = String(req.body?.email || req.body?.login || '').trim().toLowerCase();
    const cleanDigits = rawLogin.replace(/[\s\-()]/g, '');
    const password = String(req.body?.password || '');

    const user = db.prepare(
      "SELECT * FROM users WHERE LOWER(email)=? OR REPLACE(REPLACE(REPLACE(LOWER(anon_number),' ',''),'-',''),'(','')=?"
    ).get(rawLogin, cleanDigits);

    if (!user) return res.status(401).json({ error: 'Неверная почта, номер или пароль' });
    if (user.is_banned && user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Аккаунт заблокирован администратором' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Неверная почта, номер или пароль' });
    ensureSavedChat(user.id);
    res.json({ token: sign(user), user: pub(user, user) });
  });

  app.get('/api/me', auth, (req, res) => {
    ensureSavedChat(req.user.id);
    res.json(pub(req.user, req.user));
  });
  app.post('/api/profile', auth, async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || req.user.name).trim();
    const bio = String(b.bio ?? req.user.bio).trim();
    const musicText = String(b.musicText ?? req.user.music_text).trim();
    const musicAudio = b.musicAudio !== undefined ? String(b.musicAudio) : req.user.music_audio;
    const avatar = b.avatar !== undefined ? String(b.avatar) : req.user.avatar;
    const banner = b.banner !== undefined ? String(b.banner) : req.user.banner;
    const theme = b.theme !== undefined ? String(b.theme) : (req.user.theme || 'dark');
    const lang = b.lang !== undefined ? String(b.lang) : (req.user.lang || 'ru');
    const garland = b.garland !== undefined ? (b.garland ? 1 : 0) : (req.user.garland !== 0 ? 1 : 0);
    const hideEmail = b.hideEmail !== undefined ? (b.hideEmail ? 1 : 0) : (req.user.hide_email || 0);
    const hideLastSeen = b.hideLastSeen !== undefined ? (b.hideLastSeen ? 1 : 0) : (req.user.hide_last_seen || 0);
    const adminInvisible = (req.user.email === ADMIN_EMAIL && b.adminInvisible !== undefined)
      ? (b.adminInvisible ? 1 : 0) : (req.user.admin_invisible || 0);
    const profileChannelId = b.profileChannelId !== undefined ? Number(b.profileChannelId) : (req.user.profile_channel_id || 0);

    const isPrem = Boolean(req.user.is_premium || req.user.email === ADMIN_EMAIL);
    const emojiStatus = isPrem && b.emojiStatus !== undefined ? String(b.emojiStatus).trim() : (req.user.emoji_status || '');
    const nameColor = isPrem && b.nameColor !== undefined ? String(b.nameColor).trim() : (req.user.name_color || '');
    const bubbleColor = isPrem && b.bubbleColor !== undefined ? String(b.bubbleColor).trim() : (req.user.bubble_color || '');
    const avatarFrame = isPrem && b.avatarFrame !== undefined ? String(b.avatarFrame).trim() : (req.user.avatar_frame || '');

    const pinCode = b.pinCode !== undefined ? String(b.pinCode).trim() : (req.user.pin_code || '');
    const newEmail = b.email ? String(b.email).trim().toLowerCase() : req.user.email;
    const username = b.username !== undefined ? String(b.username).trim().replace(/^@/, '') : req.user.username;
    const newPass = String(b.password || '').trim();

    if (!name) return res.status(400).json({ error: 'Имя не может быть пустым' });
    if (pinCode && !/^\d{4}$/.test(pinCode)) return res.status(400).json({ error: 'PIN-код должен состоять ровно из 4 цифр' });
    if (newEmail !== req.user.email) {
      const emTaken = db.prepare('SELECT id FROM users WHERE LOWER(email)=LOWER(?) AND id!=?').get(newEmail, req.user.id);
      if (emTaken) return res.status(409).json({ error: 'Этот Email уже занят' });
    }
    if (username) {
      const taken = db.prepare('SELECT id FROM users WHERE LOWER(username)=LOWER(?) AND id!=?').get(username, req.user.id);
      if (taken) return res.status(409).json({ error: 'Этот @username уже занят' });
    }
    if (newPass && newPass.length < 6) return res.status(400).json({ error: 'Новый пароль минимум 6 символов' });

    const hash = newPass ? await bcrypt.hash(newPass, 10) : req.user.password_hash;
    db.prepare(
      'UPDATE users SET name=?, email=?, bio=?, music_text=?, music_audio=?, avatar=?, banner=?, theme=?, lang=?, garland=?, hide_email=?, hide_last_seen=?, admin_invisible=?, profile_channel_id=?, emoji_status=?, name_color=?, bubble_color=?, avatar_frame=?, pin_code=?, username=?, password_hash=? WHERE id=?'
    ).run(
      name, newEmail, bio, musicText, musicAudio, avatar, banner, theme, lang, garland,
      hideEmail, hideLastSeen, adminInvisible, profileChannelId, emojiStatus, nameColor,
      bubbleColor, avatarFrame, pinCode, username, hash, req.user.id
    );

    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json(pub(updated, updated));
  });

  app.post('/api/sessions/reset', auth, (req, res) => {
    db.prepare('UPDATE users SET token_ver = COALESCE(token_ver,1) + 1 WHERE id=?').run(req.user.id);
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json({ token: sign(updated), user: pub(updated, updated) });
  });

  app.post('/api/pin/verify', auth, (req, res) => {
    const pin = String(req.body?.pin || '').trim();
    if (!req.user.pin_code || req.user.pin_code === pin) return res.json({ ok: true });
    res.status(403).json({ error: 'Неверный PIN-код' });
  });

  app.post('/api/premium/buy', auth, (req, res) => {
    const price = 5000;
    if (req.user.is_premium || req.user.email === ADMIN_EMAIL) return res.status(400).json({ error: 'У вас уже есть Lume Premium ⭐' });
    if ((req.user.stars || 0) < price) return res.status(400).json({ error: 'Нужно 5 000 ⭐ для покупки Lume Premium' });
    db.prepare('UPDATE users SET stars = stars - ?, is_premium = 1 WHERE id=?').run(price, req.user.id);
    logStar(req.user.id, -price, 'Покупка вечного Lume Premium');
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json({ ok: true, user: pub(updated, updated) });
  });

  app.post('/api/numbers/check', auth, (req, res) => {
    const prefix = req.body?.prefix === '+999' ? '+999' : '+888';
    const raw = String(req.body?.digits || '').replace(/\D/g, '');
    if (raw.length !== 8) return res.status(400).json({ error: 'Введите ровно 8 цифр' });
    const formatted = prefix + ' ' + raw.slice(0, 4) + ' ' + raw.slice(4);
    const taken = db.prepare("SELECT id FROM users WHERE REPLACE(anon_number,' ','')=?").get(prefix + raw);
    if (taken) return res.status(409).json({ error: 'Этот номер уже занят' });
    res.json({ number: formatted, price: calcNumberPrice(raw) });
  });

  app.post('/api/numbers/buy', auth, (req, res) => {
    const prefix = req.body?.prefix === '+999' ? '+999' : '+888';
    const raw = String(req.body?.digits || '').replace(/\D/g, '');
    if (raw.length !== 8) return res.status(400).json({ error: 'Введите ровно 8 цифр' });
    const formatted = prefix + ' ' + raw.slice(0, 4) + ' ' + raw.slice(4);
    const taken = db.prepare("SELECT id FROM users WHERE REPLACE(anon_number,' ','')=?").get(prefix + raw);
    if (taken) return res.status(409).json({ error: 'Этот номер уже занят' });
    const price = calcNumberPrice(raw);
    if ((req.user.stars || 0) < price) return res.status(400).json({ error: 'Недостаточно звёзд ⭐ (нужно ' + price + ')' });
    db.prepare('UPDATE users SET stars = stars - ?, anon_number=? WHERE id=?').run(price, formatted, req.user.id);
    logStar(req.user.id, -price, 'Покупка анонимного номера ' + formatted);
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json({ ok: true, user: pub(updated, updated) });
  });
  app.get('/api/wallet', auth, (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    if (req.user.quest_date !== today) {
      db.prepare('UPDATE users SET quest_date=?, q_msgs=0, q_reacts=0, q_claimed=0 WHERE id=?').run(today, req.user.id);
      req.user.quest_date = today;
      req.user.q_msgs = 0;
      req.user.q_reacts = 0;
      req.user.q_claimed = 0;
    }

    const logs = db.prepare('SELECT * FROM star_logs WHERE user_id=? ORDER BY id DESC LIMIT 30').all(req.user.id);
    const topSpent = db.prepare('SELECT id, name, avatar, verified, is_premium, spent_stars AS val FROM users WHERE is_banned=0 ORDER BY spent_stars DESC LIMIT 10').all();
    const topEarned = db.prepare('SELECT id, name, avatar, verified, is_premium, earned_stars AS val FROM users WHERE is_banned=0 ORDER BY earned_stars DESC LIMIT 10').all();
    const topOnline = db.prepare('SELECT id, name, avatar, verified, is_premium, online_sec AS val FROM users WHERE is_banned=0 ORDER BY online_sec DESC LIMIT 10').all();

    res.json({
      stars: req.user.stars,
      spentStars: req.user.spent_stars || 0,
      earnedStars: req.user.earned_stars || 0,
      quests: {
        msgs: req.user.q_msgs || 0,
        reacts: req.user.q_reacts || 0,
        claimed: Boolean(req.user.q_claimed)
      },
      logs,
      topSpent,
      topEarned,
      topOnline
    });
  });

  app.post('/api/wallet/quest-claim', auth, (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    if (req.user.quest_date !== today || req.user.q_claimed) return res.status(400).json({ error: 'Награда уже получена или квесты не выполнены' });
    if ((req.user.q_msgs || 0) < 10 || (req.user.q_reacts || 0) < 5) {
      return res.status(400).json({ error: 'Выполните оба задания: 10 сообщений и 5 реакций' });
    }
    const reward = (req.user.is_premium || req.user.email === ADMIN_EMAIL) ? 100 : 50;
    db.prepare('UPDATE users SET stars = stars + ?, q_claimed = 1 WHERE id=?').run(reward, req.user.id);
    logStar(req.user.id, reward, 'Награда за ежедневные квесты');
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json({ ok: true, reward, stars: updated.stars });
  });

  app.post('/api/bonus/daily', auth, (req, res) => {
    const now = Date.now();
    if (now - Number(req.user.last_bonus || 0) < 12 * 3600 * 1000) {
      return res.status(400).json({ error: 'Ежедневный бонус уже получен! Приходите через 12 часов' });
    }
    const reward = (req.user.is_premium || req.user.email === ADMIN_EMAIL) ? 100 : 50;
    db.prepare('UPDATE users SET stars = stars + ?, last_bonus = ? WHERE id=?').run(reward, now, req.user.id);
    logStar(req.user.id, reward, 'Ежедневный бонус Lume');
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json({ ok: true, reward, stars: updated.stars });
  });

  app.post('/api/games/roulette', auth, (req, res) => {
    const cost = 25;
    if ((req.user.stars || 0) < cost) return res.status(400).json({ error: 'Для запуска рулетки нужно 25 ⭐' });
    const prizes = '0,0,10,15,25,35,50,100,250,500'.split(',').map(Number);
    const win = prizes[Math.floor(Math.random() * prizes.length)];
    const net = win - cost;
    db.prepare('UPDATE users SET stars = stars + ? WHERE id=?').run(net, req.user.id);
    logStar(req.user.id, -cost, 'Ставка в рулетке');
    if (win > 0) logStar(req.user.id, win, 'Выигрыш в рулетке');
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json({ ok: true, win, stars: updated.stars });
  });

  app.post('/api/games/dice', auth, (req, res) => {
    const bet = Math.max(10, Math.min(1000, Number(req.body?.bet || 20)));
    if ((req.user.stars || 0) < bet) return res.status(400).json({ error: 'Недостаточно звёзд для ставки' });
    const roll = Math.floor(Math.random() * 6) + 1;
    const win = roll >= 4 ? bet * 2 : 0;
    db.prepare('UPDATE users SET stars = stars + ? WHERE id=?').run(win - bet, req.user.id);
    logStar(req.user.id, -bet, 'Бросок кубика (ставка)');
    if (win > 0) logStar(req.user.id, win, 'Победа в кости (выпало ' + roll + ')');
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json({ ok: true, roll, win, stars: updated.stars });
  });

  app.post('/api/promo/redeem', auth, (req, res) => {
    const code = String(req.body?.code || '').trim().toUpperCase();
    const promo = db.prepare('SELECT * FROM promos WHERE code=?').get(code);
    if (!promo || promo.uses_left <= 0) return res.status(404).json({ error: 'Промокод не найден или закончился' });
    const used = db.prepare('SELECT 1 FROM promo_uses WHERE code=? AND user_id=?').get(code, req.user.id);
    if (used) return res.status(400).json({ error: 'Вы уже активировали этот промокод' });

    db.prepare('INSERT INTO promo_uses(code,user_id) VALUES(?,?)').run(code, req.user.id);
    db.prepare('UPDATE promos SET uses_left = uses_left - 1 WHERE code=?').run(code);
    db.prepare('UPDATE users SET stars = stars + ? WHERE id=?').run(promo.reward, req.user.id);
    logStar(req.user.id, promo.reward, 'Промокод ' + code);
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json({ ok: true, reward: promo.reward, stars: updated.stars });
  });

  app.post('/api/stars/transfer', auth, (req, res) => {
    const toUserId = Number(req.body?.toUserId);
    const amount = Math.floor(Number(req.body?.amount || 0));
    if (amount < 5) return res.status(400).json({ error: 'Минимальный перевод — 5 ⭐' });
    if (toUserId === req.user.id) return res.status(400).json({ error: 'Нельзя перевести звёзды самому себе' });
    const peer = db.prepare('SELECT * FROM users WHERE id=?').get(toUserId);
    if (!peer) return res.status(404).json({ error: 'Получатель не найден' });
    if ((req.user.stars || 0) < amount) return res.status(400).json({ error: 'Недостаточно звёзд ⭐' });

    db.prepare('UPDATE users SET stars = stars - ? WHERE id=?').run(amount, req.user.id);
    db.prepare('UPDATE users SET stars = stars + ? WHERE id=?').run(amount, toUserId);
    logStar(req.user.id, -amount, 'Перевод пользователю ' + peer.name);
    logStar(toUserId, amount, 'Перевод от ' + req.user.name);

    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json({ ok: true, stars: updated.stars });
  });
  app.get('/api/users/:id', auth, (req, res) => {
    const targetId = Number(req.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(targetId);
    if (!u) return res.status(404).json({ error: 'Пользователь не найден' });

    const isOwner = targetId === req.user.id;
    const rate = (u.is_premium || u.email === ADMIN_EMAIL) ? 1.0 : 0.8;
    const rawGifts = db.prepare(
      "SELECT ug.id AS userGiftId, ug.gift_id, ug.from_user_id, ug.caption, ug.is_anon, ug.hidden, ug.is_nft, ug.created_at, COALESCE(f.name, 'Администратор') AS from_name, COALESCE(f.avatar, '') AS from_avatar FROM user_gifts ug LEFT JOIN users f ON f.id=ug.from_user_id WHERE ug.to_user_id=? ORDER BY ug.id DESC"
    ).all(u.id);

    const gifts = rawGifts
      .filter(g => isOwner || !g.hidden)
      .map(g => {
        const info = ALL_GIFTS[g.gift_id] || {};
        const hideSender = Boolean(g.is_anon);
        return {
          ...info,
          userGiftId: g.userGiftId,
          gift_id: g.gift_id,
          caption: g.caption || '',
          isAnon: hideSender,
          hidden: Boolean(g.hidden),
          fromUserId: hideSender ? 0 : g.from_user_id,
          fromName: hideSender ? 'Аноним' : g.from_name,
          fromAvatar: hideSender ? '' : g.from_avatar,
          createdAt: g.created_at,
          sellPrice: Math.floor((info.price || 0) * rate)
        };
      });

    const posts = db.prepare('SELECT * FROM posts WHERE user_id=? ORDER BY id DESC').all(u.id);
    const isContact = Boolean(db.prepare('SELECT 1 FROM contacts WHERE user_id=? AND peer_id=?').get(req.user.id, u.id));
    const isBlocked = Boolean(db.prepare('SELECT 1 FROM blocks WHERE user_id=? AND blocked_id=?').get(req.user.id, u.id));

    res.json({ user: pub(u, req.user), gifts, posts, isContact, isBlocked });
  });

  app.post('/api/posts/create', auth, (req, res) => {
    const mediaData = String(req.body?.mediaData || '');
    const caption = String(req.body?.caption || '').trim();
    if (!mediaData) return res.status(400).json({ error: 'Выберите фото' });
    db.prepare('INSERT INTO posts(user_id,media_data,caption,created_at) VALUES(?,?,?,?)').run(req.user.id, mediaData, caption, Date.now());
    res.json({ ok: true });
  });

  app.post('/api/posts/:id/like', auth, (req, res) => {
    db.prepare('UPDATE posts SET likes = likes + 1 WHERE id=?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get('/api/stories', auth, (req, res) => {
    const now = Date.now();
    db.prepare('DELETE FROM stories WHERE expires_at <= ?').run(now);
    const rows = db.prepare(
      'SELECT s.*, u.name AS user_name, u.avatar AS user_avatar FROM stories s JOIN users u ON u.id=s.user_id WHERE u.is_banned=0 ORDER BY s.id DESC'
    ).all();
    res.json(rows);
  });

  app.post('/api/stories', auth, (req, res) => {
    const mediaData = String(req.body?.mediaData || '');
    const caption = String(req.body?.caption || '').trim();
    const hours = '6,12,24'.split(',').map(Number).includes(Number(req.body?.hours)) ? Number(req.body.hours) : 24;
    if (!mediaData) return res.status(400).json({ error: 'Выберите изображение для истории' });
    const isPrem = Boolean(req.user.is_premium || req.user.email === ADMIN_EMAIL);
    if (!isPrem) {
      const dayAgo = Date.now() - 24 * 3600 * 1000;
      const cnt = db.prepare('SELECT COUNT(*) AS c FROM stories WHERE user_id=? AND created_at > ?').get(req.user.id, dayAgo)?.c || 0;
      if (cnt >= 1) return res.status(400).json({ error: 'Без Lume Premium можно публиковать 1 историю в 24 часа' });
    }

    const now = Date.now();
    db.prepare('INSERT INTO stories(user_id,media_data,caption,expires_at,created_at) VALUES(?,?,?,?,?)')
      .run(req.user.id, mediaData, caption, now + hours * 3600 * 1000, now);
    res.json({ ok: true });
  });

  app.post('/api/stories/:id/view', auth, (req, res) => {
    db.prepare('UPDATE stories SET views = views + 1 WHERE id=?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get('/api/stickers', auth, (req, res) => {
    const rows = db.prepare('SELECT * FROM stickers ORDER BY id DESC LIMIT 60').all();
    res.json(rows);
  });

  app.post('/api/stickers', auth, (req, res) => {
    const imageData = String(req.body?.imageData || '');
    if (!imageData) return res.status(400).json({ error: 'Выберите картинку для стикера' });
    db.prepare('INSERT INTO stickers(user_id,image_data,created_at) VALUES(?,?,?)').run(req.user.id, imageData, Date.now());
    res.json({ ok: true });
  });

  app.get('/api/gifts/shop', auth, (req, res) => {
    const soldUnicorns = db.prepare("SELECT COUNT(*) AS c FROM user_gifts WHERE gift_id='unicorn'").get()?.c || 0;
    const list = Object.values(GIFTS).map(g => {
      if (g.id === 'unicorn') return { ...g, left: Math.max(0, g.limited - soldUnicorns) };
      return g;
    });
    res.json(list);
  });

  app.post('/api/gifts/send', auth, (req, res) => {
    const toUserId = Number(req.body?.toUserId || 0);
    const toChatId = Number(req.body?.toChatId || 0);
    const caption = String(req.body?.caption || '').trim();
    const isAnon = req.body?.isAnon ? 1 : 0;
    const gift = GIFTS[req.body?.giftId];
    if (!gift) return res.status(400).json({ error: 'Неизвестный подарок' });
    if (!toUserId && !toChatId) return res.status(400).json({ error: 'Не указан получатель' });
    if (toUserId === req.user.id) return res.status(400).json({ error: 'Нельзя дарить самому себе' });

    if (gift.limited) {
      const sold = db.prepare('SELECT COUNT(*) AS c FROM user_gifts WHERE gift_id=?').get(gift.id)?.c || 0;
      if (sold >= gift.limited) return res.status(400).json({ error: 'Лимитированный подарок полностью раскуплен!' });
    }
    if ((req.user.stars || 0) < gift.price) return res.status(400).json({ error: 'Недостаточно звёзд ⭐' });

    if (toUserId) {
      const blocked = db.prepare('SELECT 1 FROM blocks WHERE user_id=? AND blocked_id=?').get(toUserId, req.user.id);
      if (blocked) return res.status(403).json({ error: 'Пользователь ограничил получение подарков от вас' });
    }

    db.prepare('UPDATE users SET stars = stars - ? WHERE id=?').run(gift.price, req.user.id);
    logStar(req.user.id, -gift.price, 'Подарок: ' + gift.name);

    const now = Date.now();
    const ugId = Number(db.prepare(
      'INSERT INTO user_gifts(to_user_id,to_chat_id,from_user_id,gift_id,caption,is_anon,created_at) VALUES(?,?,?,?,?,?,?)'
    ).run(toUserId, toChatId, req.user.id, gift.id, caption, isAnon, now).lastInsertRowid);

    let targetChatId = toChatId;
    if (toUserId) {
      let chat = db.prepare(
        "SELECT c.id FROM chats c JOIN chat_members a ON a.chat_id=c.id AND a.user_id=? JOIN chat_members b ON b.chat_id=c.id AND b.user_id=? WHERE COALESCE(c.type,'private')='private' LIMIT 1"
      ).get(req.user.id, toUserId);
      if (!chat) {
        const cid = Number(db.prepare("INSERT INTO chats(title,type) VALUES(NULL,'private')").run().lastInsertRowid);
        db.prepare('INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)').run(cid, req.user.id);
        db.prepare('INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)').run(cid, toUserId);
        chat = { id: cid };
      }
      targetChatId = chat.id;
    }

    const senderLabel = isAnon ? 'Аноним' : req.user.name;
    const giftTitle = 'Подарок: ' + gift.name + ' #' + ugId;
    const msgId = Number(db.prepare(
      'INSERT INTO messages(chat_id,user_id,text,gift_id,gift_num,created_at) VALUES(?,?,?,?,?,?)'
    ).run(targetChatId, req.user.id, giftTitle, gift.id, ugId, now).lastInsertRowid);

    const msg = {
      id: msgId, chat_id: targetChatId, user_id: req.user.id,
      user_name: senderLabel, text: giftTitle,
      gift: { ...gift, userGiftId: ugId, caption, isAnon: Boolean(isAnon), fromName: senderLabel },
      reactions: {}, edited: 0, created_at: now
    };
    io.to('chat:' + targetChatId).emit('message', msg);

    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json({ ok: true, stars: updated.stars, chatId: targetChatId });
  });

  app.post('/api/gifts/toggle-hide', auth, (req, res) => {
    const ugId = Number(req.body?.userGiftId);
    const row = db.prepare('SELECT * FROM user_gifts WHERE id=? AND to_user_id=?').get(ugId, req.user.id);
    if (!row) return res.status(404).json({ error: 'Подарок не найден' });
    const next = row.hidden ? 0 : 1;
    db.prepare('UPDATE user_gifts SET hidden=? WHERE id=?').run(next, ugId);
    res.json({ ok: true, hidden: Boolean(next) });
  });

  app.post('/api/gifts/sell', auth, (req, res) => {
    const ugId = Number(req.body?.userGiftId);
    const row = db.prepare('SELECT * FROM user_gifts WHERE id=? AND to_user_id=?').get(ugId, req.user.id);
    if (!row) return res.status(404).json({ error: 'Подарок не найден' });
    const gift = ALL_GIFTS[row.gift_id];
    const rate = (req.user.is_premium || req.user.email === ADMIN_EMAIL) ? 1.0 : 0.8;
    const refund = Math.floor((gift?.price || 0) * rate);

    db.prepare('DELETE FROM user_gifts WHERE id=?').run(ugId);
    db.prepare('UPDATE users SET stars = stars + ? WHERE id=?').run(refund, req.user.id);
    logStar(req.user.id, refund, 'Продажа подарка ' + (gift?.name || '') + ' #' + ugId);
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json({ ok: true, stars: updated.stars, refund });
  });
  function findUserByQuery(q) {
    const clean = String(q || '').trim().toLowerCase().replace(/^@/, '');
    const digits = clean.replace(/[\s\-()]/g, '');
    const numId = /^\d+$/.test(clean) ? Number(clean) : 0;
    return db.prepare(
      "SELECT * FROM users WHERE id=? OR LOWER(username)=? OR LOWER(nft_username)=? OR REPLACE(REPLACE(REPLACE(LOWER(anon_number),' ',''),'-',''),'(','')=?"
    ).get(numId, clean, clean, digits);
  }

  app.get('/api/contacts', auth, (req, res) => {
    const rows = db.prepare(
      'SELECT u.* FROM users u JOIN contacts c ON c.peer_id=u.id WHERE c.user_id=? AND u.is_banned=0 ORDER BY u.name ASC'
    ).all(req.user.id);
    res.json(rows.map(u => pub(u, req.user)));
  });

  app.post('/api/contacts/add', auth, (req, res) => {
    const peer = findUserByQuery(req.body?.query);
    if (!peer || peer.is_banned) return res.status(404).json({ error: 'Пользователь по этому ID, @username или номеру не найден' });
    if (peer.id === req.user.id) return res.status(400).json({ error: 'Нельзя добавить самого себя' });
    db.prepare('INSERT OR IGNORE INTO contacts(user_id,peer_id) VALUES(?,?)').run(req.user.id, peer.id);
    res.json({ ok: true, user: pub(peer, req.user) });
  });

  app.post('/api/blocks/toggle', auth, (req, res) => {
    const targetId = Number(req.body?.userId);
    if (!targetId || targetId === req.user.id) return res.status(400).json({ error: 'Некорректный ID' });
    const exists = db.prepare('SELECT 1 FROM blocks WHERE user_id=? AND blocked_id=?').get(req.user.id, targetId);
    if (exists) {
      db.prepare('DELETE FROM blocks WHERE user_id=? AND blocked_id=?').run(req.user.id, targetId);
      return res.json({ blocked: false });
    }
    db.prepare('INSERT INTO blocks(user_id,blocked_id) VALUES(?,?)').run(req.user.id, targetId);
    res.json({ blocked: true });
  });

  app.post('/api/reports', auth, (req, res) => {
    const targetType = String(req.body?.targetType || 'user');
    const targetId = Number(req.body?.targetId || 0);
    const reason = String(req.body?.reason || '').trim();
    if (!targetId || !reason) return res.status(400).json({ error: 'Укажите причину жалобы' });
    db.prepare('INSERT INTO reports(from_user_id,target_type,target_id,reason,created_at) VALUES(?,?,?,?,?)')
      .run(req.user.id, targetType, targetId, reason, Date.now());
    res.json({ ok: true });
  });

  app.post('/api/admin/grant', auth, (req, res) => {
    if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Нет прав' });
    const target = findUserByQuery(req.body?.query);
    if (!target) return res.status(404).json({ error: 'Пользователь по ID, @username или номеру не найден' });

    const addStars = Number(req.body?.stars || 0);
    const username = String(req.body?.username || '').trim().replace(/^@/, '');
    const nft = String(req.body?.nft_username || '').trim().replace(/^@/, '');
    const anonNumber = String(req.body?.anon_number || '').trim();
    const verified = req.body?.verified ? 1 : 0;
    const isPremium = req.body?.is_premium ? 1 : 0;
    const giftId = String(req.body?.gift_id || '').trim();

    db.prepare(
      "UPDATE users SET stars = stars + ?, verified = ?, is_premium = ?, username = CASE WHEN ? != '' THEN ? ELSE username END, nft_username = CASE WHEN ? != '' THEN ? ELSE nft_username END, anon_number = CASE WHEN ? != '' THEN ? ELSE anon_number END WHERE id=?"
    ).run(addStars, verified, isPremium, username, username, nft, nft, anonNumber, anonNumber, target.id);

    if (addStars !== 0) logStar(target.id, addStars, 'Выдача администратором Lume');

    let grantedGiftNum = 0;
    if (giftId && ALL_GIFTS[giftId]) {
      grantedGiftNum = Number(db.prepare('INSERT INTO user_gifts(to_user_id,from_user_id,gift_id,caption,created_at) VALUES(?,?,?,?,?)')
        .run(target.id, req.user.id, giftId, 'Эксклюзив от администратора Lume', Date.now()).lastInsertRowid);
    }

    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(target.id);
    res.json({ ok: true, user: pub(updated, req.user), giftNum: grantedGiftNum });
  });

  app.post('/api/admin/ban-user', auth, (req, res) => {
    if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Нет прав' });
    const target = findUserByQuery(req.body?.query);
    if (!target || target.email === ADMIN_EMAIL) return res.status(404).json({ error: 'Пользователь не найден' });
    const next = target.is_banned ? 0 : 1;
    db.prepare('UPDATE users SET is_banned=?, token_ver = COALESCE(token_ver,1) + 1 WHERE id=?').run(next, target.id);
    res.json({ ok: true, banned: Boolean(next), name: target.name });
  });

  app.post('/api/admin/ban-channel', auth, (req, res) => {
    if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Нет прав' });
    const q = String(req.body?.query || '').trim().toLowerCase().replace(/^@/, '');
    const numId = /^\d+$/.test(q) ? Number(q) : 0;
    const ch = db.prepare('SELECT * FROM chats WHERE id=? OR LOWER(username)=?').get(numId, q);
    if (!ch || ch.type === 'private' || ch.type === 'saved') return res.status(404).json({ error: 'Канал или группа не найдены' });
    const next = ch.is_banned ? 0 : 1;
    db.prepare('UPDATE chats SET is_banned=? WHERE id=?').run(next, ch.id);
    res.json({ ok: true, banned: Boolean(next), title: ch.title });
  });

  app.post('/api/admin/promo', auth, (req, res) => {
    if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Нет прав' });
    const code = String(req.body?.code || '').trim().toUpperCase();
    const reward = Math.max(1, Number(req.body?.reward || 0));
    const uses = Math.max(1, Number(req.body?.uses || 1));
    if (!code) return res.status(400).json({ error: 'Введите код промокода' });
    db.prepare('INSERT OR REPLACE INTO promos(code,reward,uses_left) VALUES(?,?,?)').run(code, reward, uses);
    res.json({ ok: true });
  });

  app.get('/api/admin/reports', auth, (req, res) => {
    if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Нет прав' });
    const rows = db.prepare(
      'SELECT r.*, u.name AS from_name FROM reports r LEFT JOIN users u ON u.id=r.from_user_id ORDER BY r.id DESC LIMIT 40'
    ).all();
    res.json(rows);
  });
  app.get('/api/chats', auth, (req, res) => {
    const rows = db.prepare(
      "SELECT c.id, c.title, c.type, c.owner_id, c.username, c.avatar, c.bio, c.invite_code, c.pinned_msg_id, cm.role, cm.pinned, cm.hidden, (SELECT text FROM messages m WHERE m.chat_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_text, (SELECT created_at FROM messages m WHERE m.chat_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_at FROM chats c JOIN chat_members cm ON cm.chat_id=c.id WHERE cm.user_id=? AND c.is_banned=0 ORDER BY cm.pinned DESC, COALESCE(last_at,0) DESC"
    ).all(req.user.id);

    res.json(rows.map(r => {
      const members = db.prepare('SELECT u.*, cm.role FROM users u JOIN chat_members cm ON cm.user_id=u.id WHERE cm.chat_id=?').all(r.id);
      const isPrivate = (r.type || 'private') === 'private';
      const other = isPrivate ? members.find(m => m.id !== req.user.id) : null;
      return {
        id: r.id,
        type: r.type || 'private',
        ownerId: r.owner_id || 0,
        myRole: r.role || 'member',
        pinned: Boolean(r.pinned),
        hidden: Boolean(r.hidden),
        pinnedMsgId: Number(r.pinned_msg_id || 0),
        username: r.username || '',
        inviteCode: r.invite_code || '',
        avatar: isPrivate ? (other?.avatar || '') : (r.avatar || ''),
        bio: r.bio || '',
        membersCount: members.length,
        title: r.type === 'saved' ? 'Избранное' : (isPrivate ? (other ? other.name : 'Чат') : r.title),
        peer: other ? pub(other, req.user) : null,
        lastText: r.last_text || '',
        lastAt: r.last_at || 0
      };
    }));
  });

  app.post('/api/chats/:id/pin', auth, (req, res) => {
    const chatId = Number(req.params.id);
    const row = db.prepare('SELECT pinned FROM chat_members WHERE chat_id=? AND user_id=?').get(chatId, req.user.id);
    if (!row) return res.status(404).json({ error: 'Чат не найден' });
    const next = row.pinned ? 0 : 1;
    if (next === 1) {
      const isPrem = Boolean(req.user.is_premium || req.user.email === ADMIN_EMAIL);
      const limit = isPrem ? 5 : 2;
      const cnt = db.prepare('SELECT COUNT(*) AS c FROM chat_members WHERE user_id=? AND pinned=1').get(req.user.id)?.c || 0;
      if (cnt >= limit) return res.status(400).json({ error: 'Лимит закреплённых чатов (' + limit + '). С Lume Premium можно закрепить до 5!' });
    }
    db.prepare('UPDATE chat_members SET pinned=? WHERE chat_id=? AND user_id=?').run(next, chatId, req.user.id);
    res.json({ pinned: Boolean(next) });
  });

  app.post('/api/chats/:id/hide', auth, (req, res) => {
    const chatId = Number(req.params.id);
    const row = db.prepare('SELECT hidden FROM chat_members WHERE chat_id=? AND user_id=?').get(chatId, req.user.id);
    if (!row) return res.status(404).json({ error: 'Чат не найден' });
    const next = row.hidden ? 0 : 1;
    db.prepare('UPDATE chat_members SET hidden=? WHERE chat_id=? AND user_id=?').run(next, chatId, req.user.id);
    res.json({ hidden: Boolean(next) });
  });

  app.post('/api/chats/:id/clear', auth, (req, res) => {
    const chatId = Number(req.params.id);
    const ok = db.prepare('SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?').get(chatId, req.user.id);
    if (!ok) return res.status(403).json({ error: 'Нет доступа' });
    db.prepare('DELETE FROM messages WHERE chat_id=?').run(chatId);
    io.to('chat:' + chatId).emit('chat:cleared', { chatId });
    res.json({ ok: true });
  });

  app.post('/api/chats/:id/leave', auth, (req, res) => {
    const chatId = Number(req.params.id);
    db.prepare('DELETE FROM chat_members WHERE chat_id=? AND user_id=?').run(chatId, req.user.id);
    res.json({ ok: true });
  });

  app.get('/api/rooms/:id', auth, (req, res) => {
    const chatId = Number(req.params.id);
    const room = db.prepare('SELECT * FROM chats WHERE id=? AND is_banned=0').get(chatId);
    if (!room) return res.status(404).json({ error: 'Не найдено' });

    const members = db.prepare(
      'SELECT u.id, u.name, u.avatar, u.verified, u.is_premium, u.username, cm.role FROM users u JOIN chat_members cm ON cm.user_id=u.id WHERE cm.chat_id=? ORDER BY cm.role DESC, u.id ASC'
    ).all(chatId);

    const gifts = db.prepare(
      "SELECT ug.id AS userGiftId, ug.gift_id, ug.caption, ug.is_anon, ug.created_at, COALESCE(f.name, 'Аноним') AS from_name FROM user_gifts ug LEFT JOIN users f ON f.id=ug.from_user_id WHERE ug.to_chat_id=? ORDER BY ug.id DESC"
    ).all(chatId).map(g => {
      const info = ALL_GIFTS[g.gift_id] || {};
      return { ...info, ...g, fromName: g.is_anon ? 'Аноним' : g.from_name };
    });

    res.json({ room, members, gifts });
  });

  app.post('/api/rooms/:id/update', auth, (req, res) => {
    const chatId = Number(req.params.id);
    const room = db.prepare('SELECT * FROM chats WHERE id=?').get(chatId);
    if (!room || room.owner_id !== req.user.id) return res.status(403).json({ error: 'Только создатель может менять настройки' });
    const title = String(req.body?.title || room.title).trim();
    const bio = String(req.body?.bio ?? room.bio).trim();
    const avatar = req.body?.avatar !== undefined ? String(req.body.avatar) : room.avatar;
    db.prepare('UPDATE chats SET title=?, bio=?, avatar=? WHERE id=?').run(title, bio, avatar, chatId);
    res.json({ ok: true });
  });

  app.post('/api/rooms/:id/role', auth, (req, res) => {
    const chatId = Number(req.params.id);
    const targetId = Number(req.body?.userId);
    const action = String(req.body?.action || 'admin');
    const room = db.prepare('SELECT * FROM chats WHERE id=?').get(chatId);
    if (!room || room.owner_id !== req.user.id) return res.status(403).json({ error: 'Только создатель может управлять участниками' });
    if (targetId === req.user.id) return res.status(400).json({ error: 'Нельзя изменить свою роль' });

    if (action === 'kick') {
      db.prepare('DELETE FROM chat_members WHERE chat_id=? AND user_id=?').run(chatId, targetId);
    } else {
      const nextRole = action === 'admin' ? 'admin' : 'member';
      db.prepare('UPDATE chat_members SET role=? WHERE chat_id=? AND user_id=?').run(nextRole, chatId, targetId);
    }
    res.json({ ok: true });
  });

  app.post('/api/chats/create-room', auth, (req, res) => {
    const title = String(req.body?.title || '').trim();
    const type = req.body?.type === 'channel' ? 'channel' : 'group';
    const username = String(req.body?.username || '').trim().replace(/^@/, '').toLowerCase();
    if (!title) return res.status(400).json({ error: 'Введите название' });
    if (username) {
      const uEx = db.prepare('SELECT id FROM users WHERE LOWER(username)=? OR LOWER(nft_username)=?').get(username, username);
      const cEx = db.prepare('SELECT id FROM chats WHERE LOWER(username)=?').get(username);
      if (uEx || cEx) return res.status(409).json({ error: 'Этот @username уже занят' });
    }
    const inviteCode = 'lume_' + Math.random().toString(36).slice(2, 9);
    const chatId = Number(db.prepare(
      'INSERT INTO chats(title,type,owner_id,username,invite_code) VALUES(?,?,?,?,?)'
    ).run(title, type, req.user.id, username, inviteCode).lastInsertRowid);
    db.prepare("INSERT INTO chat_members(chat_id,user_id,role) VALUES(?,?,'owner')").run(chatId, req.user.id);
    res.json({ id: chatId });
  });

  app.post('/api/chats', auth, (req, res) => {
    const raw = String(req.body?.query || '').trim().toLowerCase();
    const q = raw.replace(/^@/, '').replace(/^lume\.app\/join\//, '');

    const room = db.prepare("SELECT * FROM chats WHERE (LOWER(username)=? OR LOWER(invite_code)=?) AND type IN ('group','channel') AND is_banned=0").get(q, q);
    if (room) {
      db.prepare("INSERT OR IGNORE INTO chat_members(chat_id,user_id,role) VALUES(?,?,'member')").run(room.id, req.user.id);
      return res.json({ id: room.id });
    }

    const peer = findUserByQuery(q);
    if (!peer || peer.is_banned) return res.status(404).json({ error: 'Пользователь по ID, @username или номеру не найден' });
    if (peer.id === req.user.id) {
      ensureSavedChat(req.user.id);
      const saved = db.prepare("SELECT c.id FROM chats c JOIN chat_members cm ON cm.chat_id=c.id WHERE c.type='saved' AND cm.user_id=?").get(req.user.id);
      return res.json({ id: saved.id });
    }

    const existing = db.prepare(
      "SELECT c.id FROM chats c JOIN chat_members a ON a.chat_id=c.id AND a.user_id=? JOIN chat_members b ON b.chat_id=c.id AND b.user_id=? WHERE COALESCE(c.type,'private')='private' LIMIT 1"
    ).get(req.user.id, peer.id);
    if (existing) return res.json({ id: existing.id });

    const chatId = Number(db.prepare("INSERT INTO chats(title,type) VALUES(NULL,'private')").run().lastInsertRowid);
    db.prepare('INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)').run(chatId, req.user.id);
    db.prepare('INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)').run(chatId, peer.id);
    res.json({ id: chatId });
  });
  app.get('/api/messages/:chatId', auth, (req, res) => {
    const chatId = Number(req.params.chatId);
    if (!db.prepare('SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?').get(chatId, req.user.id))
      return res.status(403).json({ error: 'Нет доступа' });

    const chatInfo = db.prepare('SELECT type FROM chats WHERE id=?').get(chatId);
    if (chatInfo?.type === 'channel') {
      db.prepare('UPDATE messages SET views_count = COALESCE(views_count,1) + 1 WHERE chat_id=? AND user_id!=?').run(chatId, req.user.id);
    }

    const msgs = db.prepare(
      'SELECT m.*, u.name AS user_name, u.name_color, u.bubble_color, u.emoji_status, u.verified, u.is_premium FROM messages m JOIN users u ON u.id=m.user_id WHERE m.chat_id=? ORDER BY m.id DESC LIMIT 80'
    ).all(chatId).reverse().map(m => {
      let rx = {};
      let viewed = [];
      let poll = null;
      try { rx = JSON.parse(m.reactions || '{}'); } catch {}
      try { viewed = JSON.parse(m.viewed_by || '[]'); } catch {}
      try { if (m.poll_json) poll = JSON.parse(m.poll_json); } catch {}
      const gInfo = m.gift_id ? ALL_GIFTS[m.gift_id] : null;
      const isConsumed = m.one_time && m.user_id !== req.user.id && viewed.includes(req.user.id);

      let replyData = null;
      if (m.reply_to_id) {
        const rep = db.prepare('SELECT m.text, u.name FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id=?').get(m.reply_to_id);
        if (rep) replyData = { id: m.reply_to_id, name: rep.name, text: rep.text };
      }

      return {
        ...m,
        media_data: isConsumed ? '' : m.media_data,
        consumed: Boolean(isConsumed),
        reactions: rx,
        poll,
        replyData,
        gift: gInfo ? { ...gInfo, userGiftId: m.gift_num || 0 } : null
      };
    });

    res.json(msgs);
  });

  app.post('/api/messages/:id/consume', auth, (req, res) => {
    const msgId = Number(req.params.id);
    const m = db.prepare('SELECT * FROM messages WHERE id=?').get(msgId);
    if (!m || !m.one_time) return res.json({ ok: true });
    let viewed = [];
    try { viewed = JSON.parse(m.viewed_by || '[]'); } catch {}
    if (!viewed.includes(req.user.id) && m.user_id !== req.user.id) {
      viewed.push(req.user.id);
      db.prepare('UPDATE messages SET viewed_by=?, media_data=? WHERE id=?').run(JSON.stringify(viewed), '', msgId);
      io.to('chat:' + m.chat_id).emit('message:consumed', { id: msgId });
    }
    res.json({ ok: true });
  });

  app.post('/api/messages/:id/donate', auth, (req, res) => {
    const msgId = Number(req.params.id);
    const amount = Math.max(5, Number(req.body?.amount || 10));
    const m = db.prepare('SELECT * FROM messages WHERE id=?').get(msgId);
    if (!m) return res.status(404).json({ error: 'Пост не найден' });
    if (m.user_id === req.user.id) return res.status(400).json({ error: 'Нельзя донатить самому себе' });
    if ((req.user.stars || 0) < amount) return res.status(400).json({ error: 'Недостаточно звёзд ⭐' });

    db.prepare('UPDATE users SET stars = stars - ? WHERE id=?').run(amount, req.user.id);
    db.prepare('UPDATE users SET stars = stars + ? WHERE id=?').run(amount, m.user_id);
    db.prepare('UPDATE messages SET stars_donated = COALESCE(stars_donated,0) + ? WHERE id=?').run(amount, msgId);
    logStar(req.user.id, -amount, 'Донат посту в канале');
    logStar(m.user_id, amount, 'Донат от подписчика ' + req.user.name);

    const updatedMsg = db.prepare('SELECT stars_donated FROM messages WHERE id=?').get(msgId);
    io.to('chat:' + m.chat_id).emit('message:donated', { id: msgId, starsDonated: updatedMsg.stars_donated });
    const me = db.prepare('SELECT stars FROM users WHERE id=?').get(req.user.id);
    res.json({ ok: true, stars: me.stars });
  });

  app.post('/api/messages/:id/vote', auth, (req, res) => {
    const msgId = Number(req.params.id);
    const optIdx = Number(req.body?.optionIndex);
    const m = db.prepare('SELECT * FROM messages WHERE id=?').get(msgId);
    if (!m || !m.poll_json) return res.status(404).json({ error: 'Опрос не найден' });
    const poll = JSON.parse(m.poll_json);
    if (!poll.options[optIdx]) return res.status(400).json({ error: 'Неверный вариант' });
    if (!poll.voters) poll.voters = {};
    if (poll.voters[req.user.id] !== undefined) return res.status(400).json({ error: 'Вы уже проголосовали' });

    poll.voters[req.user.id] = optIdx;
    poll.options[optIdx].votes = (poll.options[optIdx].votes || 0) + 1;
    db.prepare('UPDATE messages SET poll_json=? WHERE id=?').run(JSON.stringify(poll), msgId);
    io.to('chat:' + m.chat_id).emit('message:polled', { id: msgId, poll });
    res.json({ ok: true });
  });

  app.post('/api/chats/:id/pin-msg', auth, (req, res) => {
    const chatId = Number(req.params.id);
    const msgId = Number(req.body?.msgId || 0);
    db.prepare('UPDATE chats SET pinned_msg_id=? WHERE id=?').run(msgId, chatId);
    io.to('chat:' + chatId).emit('chat:pinned-msg', { chatId, msgId });
    res.json({ ok: true });
  });
  io.use((socket, next) => {
    try {
      const payload = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(payload.id);
      if (!user || user.is_banned) throw new Error();
      socket.user = user;
      next();
    } catch { next(new Error('unauthorized')); }
  });

  const floodMap = new Map();

  io.on('connection', socket => {
    const uid = socket.user.id;
    const connectedAt = Date.now();
    onlineUsers.add(uid);
    socket.join('user:' + uid);

    socket.on('disconnect', () => {
      onlineUsers.delete(uid);
      const sec = Math.max(1, Math.floor((Date.now() - connectedAt) / 1000));
      db.prepare('UPDATE users SET last_seen=?, online_sec = COALESCE(online_sec,0) + ? WHERE id=?').run(Date.now(), sec, uid);
    });

    socket.on('join', chatId => {
      if (db.prepare('SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?').get(chatId, uid)) socket.join('chat:' + chatId);
    });

    socket.on('typing', ({ chatId }) => {
      socket.to('chat:' + Number(chatId)).emit('typing', { chatId: Number(chatId), name: socket.user.name });
    });

    socket.on('message', ({ chatId, text, mediaType, mediaData, oneTime, replyToId, fwdFrom, poll }) => {
      const now = Date.now();
      const last = floodMap.get(uid) || 0;
      if (now - last < 300) return;
      floodMap.set(uid, now);

      chatId = Number(chatId);
      text = String(text || '').trim();
      mediaType = String(mediaType || '');
      mediaData = String(mediaData || '');
      oneTime = oneTime ? 1 : 0;
      replyToId = Number(replyToId || 0);
      fwdFrom = String(fwdFrom || '').trim();
      const pollJson = poll ? JSON.stringify(poll) : '';

      if ((!text && !mediaData && !pollJson) || !chatId) return;
      const member = db.prepare('SELECT role FROM chat_members WHERE chat_id=? AND user_id=?').get(chatId, uid);
      if (!member) return;

      const chatInfo = db.prepare('SELECT * FROM chats WHERE id=?').get(chatId);
      if (chatInfo?.type === 'channel' && chatInfo.owner_id !== uid && member.role !== 'admin') return;

      if (chatInfo?.type === 'private') {
        const other = db.prepare('SELECT user_id FROM chat_members WHERE chat_id=? AND user_id!=?').get(chatId, uid);
        if (other && db.prepare('SELECT 1 FROM blocks WHERE user_id=? AND blocked_id=?').get(other.user_id, uid)) return;
      }

      const previewText = pollJson ? ('📊 Опрос: ' + poll.question)
        : (mediaType === 'sticker' ? '🐻 Стикер'
        : (mediaType === 'image' ? (oneTime ? '🔥 Одноразовое фото' : '🖼️ Фото')
        : (mediaType === 'audio' ? (oneTime ? '🔥 Одноразовое голосовое' : '🎤 Голосовое сообщение') : text)));

      const id = Number(db.prepare(
        'INSERT INTO messages(chat_id,user_id,text,reply_to_id,fwd_from,media_type,media_data,one_time,poll_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
      ).run(chatId, uid, previewText, replyToId, fwdFrom, mediaType, mediaData, oneTime, pollJson, now).lastInsertRowid);

      const today = new Date().toISOString().slice(0, 10);
      db.prepare('UPDATE users SET q_msgs = CASE WHEN quest_date=? THEN q_msgs + 1 ELSE 1 END, quest_date=? WHERE id=?').run(today, today, uid);

      let replyData = null;
      if (replyToId) {
        const rep = db.prepare('SELECT m.text, u.name FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id=?').get(replyToId);
        if (rep) replyData = { id: replyToId, name: rep.name, text: rep.text };
      }

      const msg = {
        id, chat_id: chatId, user_id: uid, user_name: socket.user.name,
        name_color: socket.user.name_color, bubble_color: socket.user.bubble_color,
        emoji_status: socket.user.emoji_status, verified: socket.user.verified, is_premium: socket.user.is_premium,
        text: previewText, replyData, fwd_from: fwdFrom, media_type: mediaType, media_data: mediaData,
        one_time: oneTime, poll, views_count: 1, stars_donated: 0, edited: 0, reactions: {}, created_at: now
      };
      io.to('chat:' + chatId).emit('message', msg);

      for (const m of db.prepare('SELECT user_id FROM chat_members WHERE chat_id=?').all(chatId)) {
        io.to('user:' + m.user_id).emit('chat:update', { chatId, lastText: previewText, lastAt: now, fromId: uid });
      }
    });

    socket.on('message:edit', ({ msgId, text }) => {
      msgId = Number(msgId); text = String(text || '').trim();
      if (!msgId || !text) return;
      const m = db.prepare('SELECT * FROM messages WHERE id=? AND user_id=?').get(msgId, uid);
      if (!m || m.gift_id || m.media_type) return;
      db.prepare('UPDATE messages SET text=?, edited=1 WHERE id=?').run(text, msgId);
      io.to('chat:' + m.chat_id).emit('message:edited', { id: msgId, text });
    });

    socket.on('message:delete', ({ msgId }) => {
      msgId = Number(msgId);
      const m = db.prepare('SELECT * FROM messages WHERE id=?').get(msgId);
      if (!m) return;
      const member = db.prepare('SELECT role FROM chat_members WHERE chat_id=? AND user_id=?').get(m.chat_id, uid);
      if (m.user_id !== uid && member?.role !== 'owner' && member?.role !== 'admin') return;
      db.prepare('DELETE FROM messages WHERE id=?').run(msgId);
      io.to('chat:' + m.chat_id).emit('message:deleted', { id: msgId });
    });

    socket.on('message:react', ({ msgId, emoji }) => {
      msgId = Number(msgId); emoji = String(emoji || '').trim();
      if (!msgId || !emoji) return;
      const m = db.prepare('SELECT * FROM messages WHERE id=?').get(msgId);
      if (!m) return;
      let rx = {};
      try { rx = JSON.parse(m.reactions || '{}'); } catch {}
      rx[emoji] = (rx[emoji] || 0) + 1;
      db.prepare('UPDATE messages SET reactions=? WHERE id=?').run(JSON.stringify(rx), msgId);

      const today = new Date().toISOString().slice(0, 10);
      db.prepare('UPDATE users SET q_reacts = CASE WHEN quest_date=? THEN q_reacts + 1 ELSE 1 END, quest_date=? WHERE id=?').run(today, today, uid);

      io.to('chat:' + m.chat_id).emit('message:reacted', { id: msgId, reactions: rx });
    });
  });

  server.listen(PORT, '0.0.0.0', () => console.log('Lume server running on port ' + PORT));
}
start();
