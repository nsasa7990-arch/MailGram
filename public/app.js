const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const initSqlJs = require('sql.js');
const { Server } = require('socket.io');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'mailgram.db');
const ADMIN_EMAIL = 'licciy093@gmail.com';
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const GH_API = 'https://github.com';

const GIFTS = {
  bear: { id: 'bear', name: 'Мишка', emoji: '🧸', price: 15 },
  heart: { id: 'heart', name: 'Сердце с бантиком', emoji: '💝', price: 15 },
  rose: { id: 'rose', name: 'Роза', emoji: '🌹', price: 25 },
  crown: { id: 'crown', name: 'Бриллиантовая корона', emoji: '👑', price: 2000 }
};

const EXCLUSIVE_GIFTS = {
  crystal: { id: 'crystal', name: 'Редкий Кристалл (Admin)', emoji: '💎', price: 5000, exclusive: true },
  dragon: { id: 'dragon', name: 'Огненный Дракон (Admin)', emoji: '🐉', price: 10000, exclusive: true },
  rocket: { id: 'rocket', name: 'Ракета MailGram (Admin)', emoji: '🚀', price: 7500, exclusive: true }
};

const ALL_GIFTS = { ...GIFTS, ...EXCLUSIVE_GIFTS };

let dbSha = null;
let syncTimer = null;

async function restoreDbFromGithub() {
  if (!GH_TOKEN) return;
  try {
    const res = await fetch(GH_API, {
      headers: { Authorization: 'Bearer ' + GH_TOKEN, 'User-Agent': 'MailGram' }
    });
    if (!res.ok) return;
    const data = await res.json();
    dbSha = data.sha;
    if (data.content) fs.writeFileSync(DB_FILE, Buffer.from(data.content, 'base64'));
  } catch {}
}

function scheduleGithubBackup() {
  if (!GH_TOKEN) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      const content = fs.readFileSync(DB_FILE).toString('base64');
      if (!dbSha) {
        const check = await fetch(GH_API, {
          headers: { Authorization: 'Bearer ' + GH_TOKEN, 'User-Agent': 'MailGram' }
        });
        if (check.ok) dbSha = (await check.json()).sha;
      }
      const body = { message: 'sync db', content };
      if (dbSha) body.sha = dbSha;
      const put = await fetch(GH_API, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + GH_TOKEN,
          'User-Agent': 'MailGram',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (put.ok) dbSha = (await put.json()).content?.sha || dbSha;
    } catch {}
  }, 2000);
}

function createDbWrapper(sqlDb) {
  const save = () => {
    fs.writeFileSync(DB_FILE, Buffer.from(sqlDb.export()));
    scheduleGithubBackup();
  };
  return {
    exec(sql) { sqlDb.run(sql); save(); },
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
          save();
          return { lastInsertRowid };
        }
      };
    }
  };
}

async function start() {
  await restoreDbFromGithub();
  const SQL = await initSqlJs();
  const rawDb = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();
  const db = createDbWrapper(rawDb);

  db.exec(
    "CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, verified INTEGER DEFAULT 0, avatar TEXT DEFAULT '', banner TEXT DEFAULT '', bio TEXT DEFAULT '', username TEXT DEFAULT '', nft_username TEXT DEFAULT '', anon_number TEXT DEFAULT '', is_premium INTEGER DEFAULT 0, theme TEXT DEFAULT 'dark', hide_email INTEGER DEFAULT 0, lang TEXT DEFAULT 'ru', stars INTEGER DEFAULT 100);" +
    "CREATE TABLE IF NOT EXISTS chats(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, type TEXT DEFAULT 'private', owner_id INTEGER DEFAULT 0, username TEXT DEFAULT '');" +
    "CREATE TABLE IF NOT EXISTS chat_members(chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY(chat_id, user_id));" +
    "CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL, text TEXT NOT NULL, gift_id TEXT DEFAULT '', gift_num INTEGER DEFAULT 0, media_type TEXT DEFAULT '', media_data TEXT DEFAULT '', edited INTEGER DEFAULT 0, reactions TEXT DEFAULT '{}', created_at INTEGER NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS user_gifts(id INTEGER PRIMARY KEY AUTOINCREMENT, to_user_id INTEGER NOT NULL, from_user_id INTEGER NOT NULL, gift_id TEXT NOT NULL, created_at INTEGER NOT NULL);"
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
    "ALTER TABLE messages ADD COLUMN reactions TEXT DEFAULT '{}'"
  ];
  for (const sql of alters) { try { db.exec(sql); } catch {} }

  db.prepare('UPDATE users SET verified=1, is_premium=1 WHERE email=?').run(ADMIN_EMAIL);

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 15 * 1024 * 1024 });
  app.use(express.json({ limit: '15mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  const pub = (u, forOwner = false) => ({
    id: u.id,
    email: (forOwner || !u.hide_email) ? u.email : '',
    hideEmail: Boolean(u.hide_email),
    lang: u.lang || 'ru',
    name: u.name,
    verified: Boolean(u.verified || u.email === ADMIN_EMAIL),
    isAdmin: u.email === ADMIN_EMAIL,
    isPremium: Boolean(u.is_premium || u.email === ADMIN_EMAIL),
    avatar: u.avatar || '',
    banner: u.banner || '',
    bio: u.bio || '',
    username: u.username || '',
    nft_username: u.nft_username || '',
    anon_number: u.anon_number || '',
    theme: u.theme || 'dark',
    stars: Number(u.stars || 0)
  });

  const sign = u => jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '30d' });

  function auth(req, res, next) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    try {
      const { id } = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!user) return res.status(401).json({ error: 'Не найден' });
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
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    res.json({ token: sign(user), user: pub(user, true) });
  });

  app.post('/api/login', async (req, res) => {
    const { email, password } = req.body || {};
    const norm = String(email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(norm);
    if (!user) return res.status(401).json({ error: 'Неверный email или пароль' });
    const ok = await bcrypt.compare(password || '', user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });
    res.json({ token: sign(user), user: pub(user, true) });
  });

  app.get('/api/me', auth, (req, res) => res.json(pub(req.user, true)));
  app.post('/api/profile', auth, async (req, res) => {
    const name = String(req.body?.name || req.user.name).trim();
    const bio = String(req.body?.bio ?? req.user.bio).trim();
    const avatar = req.body?.avatar !== undefined ? String(req.body.avatar) : req.user.avatar;
    const banner = req.body?.banner !== undefined ? String(req.body.banner) : req.user.banner;
    const theme = req.body?.theme !== undefined ? String(req.body.theme) : (req.user.theme || 'dark');
    const lang = req.body?.lang !== undefined ? String(req.body.lang) : (req.user.lang || 'ru');
    const hideEmail = req.body?.hideEmail !== undefined ? (req.body.hideEmail ? 1 : 0) : (req.user.hide_email || 0);
    const newEmail = req.body?.email ? String(req.body.email).trim().toLowerCase() : req.user.email;
    const username = req.body?.username !== undefined
      ? String(req.body.username).trim().replace(/^@/, '')
      : req.user.username;
    const newPass = String(req.body?.password || '').trim();

    if (!name) return res.status(400).json({ error: 'Имя не может быть пустым' });
    if (newEmail !== req.user.email) {
      const emTaken = db.prepare('SELECT id FROM users WHERE LOWER(email)=LOWER(?) AND id!=?').get(newEmail, req.user.id);
      if (emTaken) return res.status(409).json({ error: 'Этот Email уже занят' });
    }
    if (username) {
      const taken = db.prepare('SELECT id FROM users WHERE LOWER(username)=LOWER(?) AND id!=?').get(username, req.user.id);
      if (taken) return res.status(409).json({ error: 'Этот @username уже занят' });
    }
    if (newPass && newPass.length < 6) {
      return res.status(400).json({ error: 'Новый пароль минимум 6 символов' });
    }

    if (newPass) {
      const hash = await bcrypt.hash(newPass, 10);
      db.prepare('UPDATE users SET name=?, email=?, bio=?, avatar=?, banner=?, theme=?, lang=?, hide_email=?, username=?, password_hash=? WHERE id=?')
        .run(name, newEmail, bio, avatar, banner, theme, lang, hideEmail, username, hash, req.user.id);
    } else {
      db.prepare('UPDATE users SET name=?, email=?, bio=?, avatar=?, banner=?, theme=?, lang=?, hide_email=?, username=? WHERE id=?')
        .run(name, newEmail, bio, avatar, banner, theme, lang, hideEmail, username, req.user.id);
    }

    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json(pub(updated, true));
  });

  app.post('/api/premium/buy', auth, (req, res) => {
    const price = 500;
    if (req.user.is_premium || req.user.email === ADMIN_EMAIL) {
      return res.status(400).json({ error: 'У вас уже активен MailGram Premium ⭐' });
    }
    if ((req.user.stars || 0) < price) {
      return res.status(400).json({ error: 'Недостаточно звёзд ⭐' });
    }
    db.prepare('UPDATE users SET stars = stars - ?, is_premium = 1 WHERE id=?').run(price, req.user.id);
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json({ ok: true, user: pub(updated, true) });
  });

  app.get('/api/users/:id', auth, (req, res) => {
    const targetId = Number(req.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(targetId);
    if (!u) return res.status(404).json({ error: 'Не найден' });

    const rate = (u.is_premium || u.email === ADMIN_EMAIL) ? 1.0 : 0.8;
    const gifts = db.prepare(
      "SELECT ug.id AS userGiftId, ug.gift_id, ug.created_at, COALESCE(u.name, 'Администратор') AS from_name FROM user_gifts ug LEFT JOIN users u ON u.id=ug.from_user_id WHERE ug.to_user_id=? ORDER BY ug.id DESC"
    ).all(u.id).map(g => {
      const info = ALL_GIFTS[g.gift_id] || {};
      return { ...info, ...g, sellPrice: Math.floor((info.price || 0) * rate) };
    });

    res.json({ user: pub(u, targetId === req.user.id), gifts });
  });

  app.get('/api/gifts/shop', auth, (req, res) => res.json(Object.values(GIFTS)));

  app.post('/api/gifts/send', auth, (req, res) => {
    const toUserId = Number(req.body?.toUserId);
    const gift = GIFTS[req.body?.giftId];
    if (!gift) return res.status(400).json({ error: 'Неизвестный подарок' });
    if (toUserId === req.user.id) return res.status(400).json({ error: 'Нельзя дарить самому себе' });

    const peer = db.prepare('SELECT * FROM users WHERE id=?').get(toUserId);
    if (!peer) return res.status(404).json({ error: 'Получатель не найден' });
    if ((req.user.stars || 0) < gift.price) return res.status(400).json({ error: 'Недостаточно звёзд ⭐' });

    db.prepare('UPDATE users SET stars = stars - ? WHERE id=?').run(gift.price, req.user.id);
    const now = Date.now();
    const ugId = Number(db.prepare('INSERT INTO user_gifts(to_user_id,from_user_id,gift_id,created_at) VALUES(?,?,?,?)')
      .run(toUserId, req.user.id, gift.id, now).lastInsertRowid);

    let chat = db.prepare(
      "SELECT c.id FROM chats c JOIN chat_members a ON a.chat_id=c.id AND a.user_id=? JOIN chat_members b ON b.chat_id=c.id AND b.user_id=? WHERE COALESCE(c.type,'private')='private' LIMIT 1"
    ).get(req.user.id, toUserId);

    if (!chat) {
      const cid = Number(db.prepare("INSERT INTO chats(title,type) VALUES(NULL,'private')").run().lastInsertRowid);
      db.prepare('INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)').run(cid, req.user.id);
      db.prepare('INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)').run(cid, toUserId);
      chat = { id: cid };
    }

    const giftTitle = 'Подарок: ' + gift.name + ' #' + ugId;
    const msgId = Number(db.prepare(
      'INSERT INTO messages(chat_id,user_id,text,gift_id,gift_num,created_at) VALUES(?,?,?,?,?,?)'
    ).run(chat.id, req.user.id, giftTitle, gift.id, ugId, now).lastInsertRowid);

    const msg = {
      id: msgId, chat_id: chat.id, user_id: req.user.id,
      user_name: req.user.name, text: giftTitle,
      gift: { ...gift, userGiftId: ugId }, reactions: {}, edited: 0, created_at: now
    };
    io.to('chat:' + chat.id).emit('message', msg);
    io.to('user:' + req.user.id).emit('chat:update', { chatId: chat.id, lastText: '🎁 ' + gift.name + ' #' + ugId, lastAt: now, fromId: req.user.id });
    io.to('user:' + toUserId).emit('chat:update', { chatId: chat.id, lastText: '🎁 ' + gift.name + ' #' + ugId, lastAt: now, fromId: req.user.id });

    const meUpdated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json({ ok: true, stars: meUpdated.stars, chatId: chat.id });
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
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json({ ok: true, stars: updated.stars, refund });
  });

  app.post('/api/admin/grant', auth, (req, res) => {
    if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Нет прав' });
    const q = String(req.body?.query || req.body?.email || '').trim().toLowerCase().replace(/^@/, '');
    const target = db.prepare(
      'SELECT * FROM users WHERE LOWER(email)=? OR LOWER(username)=? OR LOWER(nft_username)=?'
    ).get(q, q, q);
    if (!target) return res.status(404).json({ error: 'Пользователь по этому @username или Email не найден' });

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

    let grantedGiftNum = 0;
    if (giftId && ALL_GIFTS[giftId]) {
      grantedGiftNum = Number(db.prepare('INSERT INTO user_gifts(to_user_id,from_user_id,gift_id,created_at) VALUES(?,?,?,?)')
        .run(target.id, req.user.id, giftId, Date.now()).lastInsertRowid);
    }

    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(target.id);
    res.json({ ok: true, user: pub(updated, true), giftNum: grantedGiftNum });
  });
  app.get('/api/chats', auth, (req, res) => {
    const rows = db.prepare(
      "SELECT c.id, c.title, c.type, c.owner_id, c.username, (SELECT text FROM messages m WHERE m.chat_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_text, (SELECT created_at FROM messages m WHERE m.chat_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_at FROM chats c JOIN chat_members cm ON cm.chat_id=c.id WHERE cm.user_id=? ORDER BY COALESCE(last_at,0) DESC"
    ).all(req.user.id);

    res.json(rows.map(r => {
      const members = db.prepare('SELECT u.* FROM users u JOIN chat_members cm ON cm.user_id=u.id WHERE cm.chat_id=?').all(r.id);
      const isPrivate = (r.type || 'private') === 'private';
      const other = isPrivate ? members.find(m => m.id !== req.user.id) : null;
      return {
        id: r.id, type: r.type || 'private', ownerId: r.owner_id || 0, username: r.username || '',
        membersCount: members.length, title: isPrivate ? (other ? other.name : 'Чат') : r.title,
        peer: other ? pub(other, false) : null, lastText: r.last_text || '', lastAt: r.last_at || 0
      };
    }));
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
    const chatId = Number(db.prepare('INSERT INTO chats(title,type,owner_id,username) VALUES(?,?,?,?)').run(title, type, req.user.id, username).lastInsertRowid);
    db.prepare('INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)').run(chatId, req.user.id);
    res.json({ id: chatId });
  });

  app.post('/api/chats', auth, (req, res) => {
    const q = String(req.body?.query || req.body?.email || '').trim().toLowerCase().replace(/^@/, '');
    const room = db.prepare("SELECT * FROM chats WHERE LOWER(username)=? AND type IN ('group','channel')").get(q);
    if (room) {
      const inRoom = db.prepare('SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?').get(room.id, req.user.id);
      if (!inRoom) db.prepare('INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)').run(room.id, req.user.id);
      return res.json({ id: room.id });
    }
    const peer = db.prepare('SELECT * FROM users WHERE LOWER(email)=? OR LOWER(username)=? OR LOWER(nft_username)=? OR LOWER(anon_number)=?').get(q, q, q, q);
    if (!peer) return res.status(404).json({ error: 'Пользователь, группа или канал не найдены' });
    if (peer.id === req.user.id) return res.status(400).json({ error: 'Нельзя создать чат с собой' });
    const existing = db.prepare("SELECT c.id FROM chats c JOIN chat_members a ON a.chat_id=c.id AND a.user_id=? JOIN chat_members b ON b.chat_id=c.id AND b.user_id=? WHERE COALESCE(c.type,'private')='private' LIMIT 1").get(req.user.id, peer.id);
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
    const msgs = db.prepare('SELECT m.id, m.text, m.gift_id, m.gift_num, m.media_type, m.media_data, m.edited, m.reactions, m.created_at, m.user_id, u.name AS user_name FROM messages m JOIN users u ON u.id=m.user_id WHERE m.chat_id=? ORDER BY m.id ASC').all(chatId).map(m => {
      let rx = {};
      try { rx = JSON.parse(m.reactions || '{}'); } catch {}
      const gInfo = m.gift_id ? ALL_GIFTS[m.gift_id] : null;
      return { ...m, reactions: rx, gift: gInfo ? { ...gInfo, userGiftId: m.gift_num || 0 } : null };
    });
    res.json(msgs);
  });

  io.use((socket, next) => {
    try {
      const { id } = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!user) throw new Error();
      socket.user = user;
      next();
    } catch { next(new Error('unauthorized')); }
  });

  io.on('connection', socket => {
    socket.join('user:' + socket.user.id);
    socket.on('join', chatId => {
      if (db.prepare('SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?').get(chatId, socket.user.id)) socket.join('chat:' + chatId);
    });
    socket.on('message', ({ chatId, text, mediaType, mediaData }) => {
      chatId = Number(chatId); text = String(text || '').trim(); mediaType = String(mediaType || ''); mediaData = String(mediaData || '');
      if ((!text && !mediaData) || !chatId) return;
      if (!db.prepare('SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?').get(chatId, socket.user.id)) return;
      const chatInfo = db.prepare('SELECT * FROM chats WHERE id=?').get(chatId);
      if (chatInfo?.type === 'channel' && chatInfo.owner_id !== socket.user.id) return;
      const previewText = mediaType === 'image' ? '🖼️ Фото' : (mediaType === 'audio' ? '🎤 Голосовое сообщение' : text);
      const createdAt = Date.now();
      const id = Number(db.prepare('INSERT INTO messages(chat_id,user_id,text,media_type,media_data,created_at) VALUES(?,?,?,?,?,?)').run(chatId, socket.user.id, previewText, mediaType, mediaData, createdAt).lastInsertRowid);
      const msg = { id, chat_id: chatId, user_id: socket.user.id, user_name: socket.user.name, text: previewText, media_type: mediaType, media_data: mediaData, edited: 0, reactions: {}, created_at: createdAt };
      io.to('chat:' + chatId).emit('message', msg);
      for (const m of db.prepare('SELECT user_id FROM chat_members WHERE chat_id=?').all(chatId)) {
        io.to('user:' + m.user_id).emit('chat:update', { chatId, lastText: previewText, lastAt: createdAt, fromId: socket.user.id });
      }
    });
    socket.on('message:edit', ({ msgId, text }) => {
      msgId = Number(msgId); text = String(text || '').trim();
      if (!msgId || !text) return;
      const m = db.prepare('SELECT * FROM messages WHERE id=? AND user_id=?').get(msgId, socket.user.id);
      if (!m || m.gift_id || m.media_type) return;
      db.prepare('UPDATE messages SET text=?, edited=1 WHERE id=?').run(text, msgId);
      io.to('chat:' + m.chat_id).emit('message:edited', { id: msgId, text });
    });
    socket.on('message:delete', ({ msgId }) => {
      msgId = Number(msgId);
      const m = db.prepare('SELECT * FROM messages WHERE id=? AND user_id=?').get(msgId, socket.user.id);
      if (!m) return;
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
      io.to('chat:' + m.chat_id).emit('message:reacted', { id: msgId, reactions: rx });
    });
  });

  server.listen(PORT, '0.0.0.0', () => console.log('Server running on port ' + PORT));
}
start();
