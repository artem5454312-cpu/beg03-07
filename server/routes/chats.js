const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { normalizeCity } = require('../utils/city');

const router = express.Router();
router.use(requireAuth);

// Городской чат текущего пользователя (по городу из профиля).
// Если чата с таким (нормализованным) названием ещё нет — создаём и сразу подключаем.
router.get('/city', async (req, res) => {
  const profile = await db.query('SELECT city FROM profiles WHERE user_id=$1', [req.userId]);
  const city = profile.rows[0]?.city;
  if (!city) return res.json({ chat: null, messages: [] });

  const cityKey = normalizeCity(city);
  const chat = await db.query(
    `INSERT INTO city_chats (city_name) VALUES ($1)
     ON CONFLICT (city_name) DO UPDATE SET city_name=EXCLUDED.city_name RETURNING id, city_name`,
    [cityKey]
  );
  await db.query(
    'INSERT INTO city_chat_members (chat_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [chat.rows[0].id, req.userId]
  );

  const messages = await db.query(
    `SELECT cm.id, cm.content, cm.created_at, cm.user_id, p.name, p.photo_url, u.username
       FROM chat_messages cm
       JOIN users u ON u.id = cm.user_id
       LEFT JOIN profiles p ON p.user_id = u.id
      WHERE cm.chat_id=$1 ORDER BY cm.created_at DESC LIMIT 50`,
    [chat.rows[0].id]
  );
  res.json({ chat: chat.rows[0], messages: messages.rows.reverse() });
});

router.post('/city/join', async (req, res) => {
  const profile = await db.query('SELECT city FROM profiles WHERE user_id=$1', [req.userId]);
  const city = profile.rows[0]?.city;
  if (!city) return res.status(400).json({ error: 'Сначала укажите город в профиле.' });

  const chat = await db.query(
    `INSERT INTO city_chats (city_name) VALUES ($1)
     ON CONFLICT (city_name) DO UPDATE SET city_name=EXCLUDED.city_name RETURNING id`,
    [normalizeCity(city)]
  );
  await db.query(
    'INSERT INTO city_chat_members (chat_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [chat.rows[0].id, req.userId]
  );
  res.json({ ok: true, chatId: chat.rows[0].id });
});

// Пожаловаться на сообщение (минимальная модерация на старте)
router.post('/city/report', async (req, res) => {
  const { chat_id, message_id } = req.body;
  await db.query(
    'INSERT INTO reports (chat_id, message_id, reported_by) VALUES ($1,$2,$3)',
    [chat_id, message_id, req.userId]
  );
  res.json({ ok: true });
});

// Событие внутри городского чата (создаётся из тренировки или с нуля)
router.post('/city/events', async (req, res) => {
  const { chat_id, workout_id, title, event_date, max_participants } = req.body;
  if (!chat_id || !title || !event_date) return res.status(400).json({ error: 'Укажите название, дату и чат.' });
  const r = await db.query(
    `INSERT INTO events (chat_id, creator_id, workout_id, title, event_date, max_participants)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [chat_id, req.userId, workout_id || null, title, event_date, max_participants || null]
  );
  await db.query('INSERT INTO event_participants (event_id, user_id) VALUES ($1,$2)', [r.rows[0].id, req.userId]);
  res.json(r.rows[0]);
});

router.post('/events/:id/join', async (req, res) => {
  const ev = await db.query('SELECT * FROM events WHERE id=$1 AND cancelled=false', [req.params.id]);
  if (!ev.rows.length) return res.status(404).json({ error: 'Событие не найдено или отменено.' });

  if (ev.rows[0].max_participants) {
    const count = await db.query('SELECT count(*) FROM event_participants WHERE event_id=$1', [req.params.id]);
    if (parseInt(count.rows[0].count, 10) >= ev.rows[0].max_participants) {
      return res.status(400).json({ error: 'Мест больше нет.' });
    }
  }
  await db.query(
    'INSERT INTO event_participants (event_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [req.params.id, req.userId]
  );
  res.json({ ok: true });
});

router.post('/events/:id/cancel', async (req, res) => {
  await db.query(
    'UPDATE events SET cancelled=true WHERE id=$1 AND creator_id=$2',
    [req.params.id, req.userId]
  );
  res.json({ ok: true });
});

// Личные диалоги
router.get('/direct', async (req, res) => {
  const r = await db.query(
    `SELECT dc.id, u.username, p.name,
            (SELECT content FROM direct_messages WHERE direct_chat_id=dc.id ORDER BY created_at DESC LIMIT 1) as last_message
       FROM direct_chats dc
       JOIN users u ON u.id = (CASE WHEN dc.user_a=$1 THEN dc.user_b ELSE dc.user_a END)
       LEFT JOIN profiles p ON p.user_id = u.id
      WHERE dc.user_a=$1 OR dc.user_b=$1
      ORDER BY dc.created_at DESC`,
    [req.userId]
  );
  res.json(r.rows);
});

router.post('/direct/:username', async (req, res) => {
  const other = await db.query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!other.rows.length) return res.status(404).json({ error: 'Пользователь не найден.' });
  const otherId = other.rows[0].id;
  if (otherId === req.userId) return res.status(400).json({ error: 'Нельзя написать самому себе.' });

  const [a, b] = [req.userId, otherId].sort((x, y) => x - y);
  const r = await db.query(
    `INSERT INTO direct_chats (user_a, user_b) VALUES ($1,$2)
     ON CONFLICT (user_a, user_b) DO UPDATE SET user_a=EXCLUDED.user_a RETURNING id`,
    [a, b]
  );
  res.json({ chatId: r.rows[0].id });
});

router.get('/direct/:id/messages', async (req, res) => {
  const r = await db.query(
    'SELECT id, sender_id, content, created_at FROM direct_messages WHERE direct_chat_id=$1 ORDER BY created_at ASC LIMIT 100',
    [req.params.id]
  );
  res.json(r.rows);
});

module.exports = router;
