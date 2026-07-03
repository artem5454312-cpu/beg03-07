const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { GLOBAL_CHAT_KEY } = require('../utils/city');

const router = express.Router();
router.use(requireAuth);

// Достаёт (и при необходимости создаёт) единый общий чат, в котором состоят все пользователи.
async function getOrCreateGlobalChat(userId) {
  const chat = await db.query(
    `INSERT INTO city_chats (city_name) VALUES ($1)
     ON CONFLICT (city_name) DO UPDATE SET city_name=EXCLUDED.city_name RETURNING id, city_name`,
    [GLOBAL_CHAT_KEY]
  );
  await db.query(
    'INSERT INTO city_chat_members (chat_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [chat.rows[0].id, userId]
  );
  return chat.rows[0];
}

// Общий чат для всех зарегистрированных пользователей (не по городам)
router.get('/city', async (req, res) => {
  const chat = await getOrCreateGlobalChat(req.userId);

  const messages = await db.query(
    `SELECT cm.id, cm.content, cm.created_at, cm.user_id, p.name, p.photo_url, u.username
       FROM chat_messages cm
       JOIN users u ON u.id = cm.user_id
       LEFT JOIN profiles p ON p.user_id = u.id
      WHERE cm.chat_id=$1 ORDER BY cm.created_at DESC LIMIT 50`,
    [chat.id]
  );
  res.json({ chat, messages: messages.rows.reverse() });
});

router.post('/city/join', async (req, res) => {
  const chat = await getOrCreateGlobalChat(req.userId);
  res.json({ ok: true, chatId: chat.id });
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

// Создать событие в общем чате (например "Совместная пробежка")
router.post('/city/events', async (req, res) => {
  const { workout_id, title, event_date, max_participants } = req.body;
  if (!title || !event_date) return res.status(400).json({ error: 'Укажите название и дату.' });

  const chat = await getOrCreateGlobalChat(req.userId);
  const r = await db.query(
    `INSERT INTO events (chat_id, creator_id, workout_id, title, event_date, max_participants)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [chat.id, req.userId, workout_id || null, title, event_date, max_participants || null]
  );
  await db.query(
    "INSERT INTO event_participants (event_id, user_id, response) VALUES ($1,$2,'going')",
    [r.rows[0].id, req.userId]
  );
  res.json(r.rows[0]);
});

// Список предстоящих событий общего чата + кто идёт / не идёт (для опроса)
router.get('/city/events', async (req, res) => {
  const chat = await getOrCreateGlobalChat(req.userId);

  const events = await db.query(
    `SELECT id, title, event_date, creator_id FROM events
      WHERE chat_id=$1 AND cancelled=false
      ORDER BY event_date ASC`,
    [chat.id]
  );
  if (!events.rows.length) return res.json([]);

  const ids = events.rows.map(e => e.id);
  const responses = await db.query(
    `SELECT ep.event_id, ep.user_id, ep.response, coalesce(p.name, u.username) AS name
       FROM event_participants ep
       JOIN users u ON u.id = ep.user_id
       LEFT JOIN profiles p ON p.user_id = u.id
      WHERE ep.event_id = ANY($1::int[])`,
    [ids]
  );

  const byEvent = {};
  for (const r of responses.rows) (byEvent[r.event_id] ||= []).push(r);

  res.json(events.rows.map(e => {
    const rows = byEvent[e.id] || [];
    const going = rows.filter(r => r.response === 'going');
    const notGoing = rows.filter(r => r.response === 'not_going');
    const mine = rows.find(r => String(r.user_id) === String(req.userId));
    return {
      id: e.id,
      title: e.title,
      event_date: e.event_date,
      isMine: e.creator_id === req.userId,
      going: going.map(r => r.name),
      notGoing: notGoing.map(r => r.name),
      myResponse: mine ? mine.response : null
    };
  }));
});

// Ответить на опрос события: "Буду" (going) или "Не буду" (not_going)
router.post('/events/:id/join', async (req, res) => {
  const response = req.body?.response === 'not_going' ? 'not_going' : 'going';
  const ev = await db.query('SELECT * FROM events WHERE id=$1 AND cancelled=false', [req.params.id]);
  if (!ev.rows.length) return res.status(404).json({ error: 'Событие не найдено или отменено.' });

  if (response === 'going' && ev.rows[0].max_participants) {
    const count = await db.query(
      "SELECT count(*) FROM event_participants WHERE event_id=$1 AND response='going'",
      [req.params.id]
    );
    if (parseInt(count.rows[0].count, 10) >= ev.rows[0].max_participants) {
      return res.status(400).json({ error: 'Мест больше нет.' });
    }
  }
  await db.query(
    `INSERT INTO event_participants (event_id, user_id, response) VALUES ($1,$2,$3)
     ON CONFLICT (event_id, user_id) DO UPDATE SET response=EXCLUDED.response`,
    [req.params.id, req.userId, response]
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
