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

const GIFTS = {
  bear: { id: 'bear', name: 'Мишка', emoji: '🧸', price: 15 },
  heart: { id: 'heart', name: 'Сердце с бантиком', emoji: '💝', price: 15 },
  rose: { id: 'rose', name: 'Роза', emoji: '🌹', price: 25 },
  crown: { id: 'crown', name: 'Бриллиантовая корона', emoji: '👑', price: 2000 }
};

function createDbWrapper(sqlDb) {
  const save = () => {
    const data = sqlDb.export();
    fs.writeFileSync(DB_FILE, Buffer.from(data));
  };

  return {
    exec(sql) {
      sqlDb.run(sql);
      save();
    },
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
  const SQL = await initSqlJs();
  const rawDb = fs.existsSync(DB_FILE)
    ? new SQL.Database(fs.readFileSync(DB_FILE))
    : new SQL.Database();
  const db = createDbWrapper(rawDb);

  db.exec(`
  CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    verified INTEGER DEFAULT 0,
    code TEXT,
    avatar TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    username TEXT DEFAULT '',
    nft_username TEXT DEFAULT '',
    stars INTEGER DEFAULT 100
  );
  CREATE TABLE IF NOT EXISTS chats(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT
  );
  CREATE TABLE IF NOT EXISTS chat_members(
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY(chat_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS messages(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    gift_id TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_gifts(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_user_id INTEGER NOT NULL,
    from_user_id INTEGER NOT NULL,
    gift_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);
  `);

  const cols = [
    "ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN username TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN nft_username TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN stars INTEGER DEFAULT 100",
    "ALTER TABLE messages ADD COLUMN gift_id TEXT DEFAULT ''"
  ];
  for (const sql of cols) {
    try { db.exec(sql); } catch {}
  }

  db.prepare('UPDATE users SET verified=1 WHERE email=?').run(ADMIN_EMAIL);

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  app.use(express.json({ limit: '8mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  const pub = u => ({
    id: u.id,
    email: u.email,
    name: u.name,
    verified: Boolean(u.verified || u.email === ADMIN_EMAIL),
    isAdmin: u.email === ADMIN_EMAIL,
    avatar: u.avatar || '',
    bio: u.bio || '',
    username: u.username || '',
    nft_username: u.nft_username || '',
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
    if (db.prepare('SELECT id FROM users WHERE email=?').get(norm))
      return res.status(409).json({ error: 'Email уже занят' });

    const isAdm = norm === ADMIN_EMAIL;
    const hash = await bcrypt.hash(password, 10);
    const id = Number(db.prepare(
      'INSERT INTO users(email,name,password_hash,verified,stars) VALUES(?,?,?,?,?)'
    ).run(norm, name.trim(), hash, isAdm ? 1 : 0, isAdm ? 10000 : 100).lastInsertRowid);

    const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    res.json({ token: sign(user), user: pub(user) });
  });

  app.post('/api/login', async (req, res) => {
    const { email, password } = req.body || {};
    const norm = String(email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(norm);
    if (!user) return res.status(401).json({ error: 'Неверный email или пароль' });

    const ok = await bcrypt.compare(password || '', user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });

    res.json({ token: sign(user), user: pub(user) });
  });

  app.get('/api/me', auth, (req, res) => res.json(pub(req.user)));

  app.post('/api/profile', auth, async (req, res) => {
    const name = String(req.body?.name || req.user.name).trim();
    const bio = String(req.body?.bio ?? req.user.bio).trim();
    const avatar = req.body?.avatar !== undefined ? String(req.body.avatar) : req.user.avatar;
    const username = req.body?.username !== undefined
      ? String(req.body.username).trim().replace(/^@/, '')
      : req.user.username;
    const newPass = String(req.body?.password || '').trim();

    if (!name) return res.status(400).json({ error: 'Имя не может быть пустым' });
    if (username) {
      const taken = db.prepare('SELECT id FROM users WHERE LOWER(username)=LOWER(?) AND id!=?').get(username, req.user.id);
      if (taken) return res.status(409).json({ error: 'Этот @username уже занят' });
    }
    if (newPass && newPass.length < 6) {
      return res.status(400).json({ error: 'Новый пароль минимум 6 символов' });
    }

    if (newPass) {
      const hash = await bcrypt.hash(newPass, 10);
      db.prepare('UPDATE users SET name=?, bio=?, avatar=?, username=?, password_hash=? WHERE id=?')
        .run(name, bio, avatar, username, hash, req.user.id);
    } else {
      db.prepare('UPDATE users SET name=?, bio=?, avatar=?, username=? WHERE id=?')
        .run(name, bio, avatar, username, req.user.id);
    }

    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json(pub(updated));
  });
  app.get('/api/users/:id', auth, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id));
    if (!u) return res.status(404).json({ error: 'Не найден' });

    const gifts = db.prepare(`
      SELECT ug.id, ug.gift_id, ug.created_at, u.name AS from_name
      FROM user_gifts ug JOIN users u ON u.id=ug.from_user_id
      WHERE ug.to_user_id=? ORDER BY ug.id DESC
    `).all(u.id).map(g => ({ ...g, ...(GIFTS[g.gift_id] || {}) }));

    res.json({ user: pub(u), gifts });
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
    db.prepare('INSERT INTO user_gifts(to_user_id,from_user_id,gift_id,created_at) VALUES(?,?,?,?)')
      .run(toUserId, req.user.id, gift.id, now);

    let chat = db.prepare(`
      SELECT c.id FROM chats c
      JOIN chat_members a ON a.chat_id=c.id AND a.user_id=?
      JOIN chat_members b ON b.chat_id=c.id AND b.user_id=?
      LIMIT 1
    `).get(req.user.id, toUserId);

    if (!chat) {
      const cid = Number(db.prepare('INSERT INTO chats(title) VALUES(NULL)').run().lastInsertRowid);
      db.prepare('INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)').run(cid, req.user.id);
      db.prepare('INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)').run(cid, toUserId);
      chat = { id: cid };
    }

    const msgId = Number(db.prepare(
      'INSERT INTO messages(chat_id,user_id,text,gift_id,created_at) VALUES(?,?,?,?,?)'
    ).run(chat.id, req.user.id, `Подарок: ${gift.name}`, gift.id, now).lastInsertRowid);

    const msg = {
      id: msgId, chat_id: chat.id, user_id: req.user.id,
      user_name: req.user.name, text: `Подарок: ${gift.name}`,
      gift, created_at: now
    };
    io.to('chat:' + chat.id).emit('message', msg);
    io.to('user:' + req.user.id).emit('chat:update', { chatId: chat.id, lastText: `🎁 ${gift.name}`, lastAt: now });
    io.to('user:' + toUserId).emit('chat:update', { chatId: chat.id, lastText: `🎁 ${gift.name}`, lastAt: now });

    const meUpdated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json({ ok: true, stars: meUpdated.stars, chatId: chat.id });
  });

  app.post('/api/admin/grant', auth, (req, res) => {
    if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Нет прав' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const target = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

    const addStars = Number(req.body?.stars || 0);
    const username = String(req.body?.username || '').trim().replace(/^@/, '');
    const nft = String(req.body?.nft_username || '').trim().replace(/^@/, '');
    const verified = req.body?.verified ? 1 : 0;

    db.prepare(`
      UPDATE users SET
        stars = stars + ?,
        verified = ?,
        username = CASE WHEN ? != '' THEN ? ELSE username END,
        nft_username = CASE WHEN ? != '' THEN ? ELSE nft_username END
      WHERE id=?
    `).run(addStars, verified, username, username, nft, nft, target.id);

    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(target.id);
    res.json({ ok: true, user: pub(updated) });
  });

  app.get('/api/chats', auth, (req, res) => {
    const rows = db.prepare(`
      SELECT c.id, c.title,
        (SELECT text FROM messages m WHERE m.chat_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_text,
        (SELECT created_at FROM messages m WHERE m.chat_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_at
      FROM chats c
      JOIN chat_members cm ON cm.chat_id=c.id
      WHERE cm.user_id=?
      ORDER BY COALESCE(last_at,0) DESC
    `).all(req.user.id);

    res.json(rows.map(r => {
      const members = db.prepare(`
        SELECT u.* FROM users u
        JOIN chat_members cm ON cm.user_id=u.id WHERE cm.chat_id=?
      `).all(r.id);
      const other = members.find(m => m.id !== req.user.id);
      return {
        id: r.id,
        title: r.title || (other ? other.name : 'Чат'),
        peer: other ? pub(other) : null,
        lastText: r.last_text || '',
        lastAt: r.last_at || 0
      };
    }));
  });

  app.post('/api/chats', auth, (req, res) => {
    const q = String(req.body?.query || req.body?.email || '').trim().toLowerCase().replace(/^@/, '');
    const peer = db.prepare(
      'SELECT * FROM users WHERE LOWER(email)=? OR LOWER(username)=? OR LOWER(nft_username)=?'
    ).get(q, q, q);

    if (!peer) return res.status(404).json({ error: 'Пользователь не найден' });
    if (peer.id === req.user.id) return res.status(400).json({ error: 'Нельзя создать чат с собой' });

    const existing = db.prepare(`
      SELECT c.id FROM chats c
      JOIN chat_members a ON a.chat_id=c.id AND a.user_id=?
      JOIN chat_members b ON b.chat_id=c.id AND b.user_id=?
      LIMIT 1
    `).get(req.user.id, peer.id);
    if (existing) return res.json({ id: existing.id });

    const chatId = Number(db.prepare('INSERT INTO chats(title) VALUES(NULL)').run().lastInsertRowid);
    db.prepare('INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)').run(chatId, req.user.id);
    db.prepare('INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)').run(chatId, peer.id);
    res.json({ id: chatId });
  });

  app.get('/api/messages/:chatId', auth, (req, res) => {
    const chatId = Number(req.params.chatId);
    if (!db.prepare('SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?').get(chatId, req.user.id))
      return res.status(403).json({ error: 'Нет доступа' });

    const msgs = db.prepare(`
      SELECT m.id, m.text, m.gift_id, m.created_at, m.user_id, u.name AS user_name
      FROM messages m JOIN users u ON u.id=m.user_id
      WHERE m.chat_id=? ORDER BY m.id ASC
    `).all(chatId).map(m => ({ ...m, gift: m.gift_id ? GIFTS[m.gift_id] : null }));

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
      const ok = db.prepare('SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?')
        .get(chatId, socket.user.id);
      if (ok) socket.join('chat:' + chatId);
    });

    socket.on('message', ({ chatId, text }) => {
      chatId = Number(chatId);
      text = String(text || '').trim();
      if (!text || !chatId) return;

      const ok = db.prepare('SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?')
        .get(chatId, socket.user.id);
      if (!ok) return;

      const createdAt = Date.now();
      const id = Number(db.prepare('INSERT INTO messages(chat_id,user_id,text,created_at) VALUES(?,?,?,?)')
        .run(chatId, socket.user.id, text, createdAt).lastInsertRowid);

      const msg = { id, chat_id: chatId, user_id: socket.user.id, user_name: socket.user.name, text, created_at: createdAt };
      io.to('chat:' + chatId).emit('message', msg);

      const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id=?').all(chatId);
      for (const m of members) {
        io.to('user:' + m.user_id).emit('chat:update', {
          chatId, lastText: text, lastAt: createdAt
        });
      }
    });
  });

  server.listen(PORT, '0.0.0.0', () => console.log(`✅ http://192.168.1.54:${PORT}`));
}

start();
