// Раздел "Управление приложением" — доступен ТОЛЬКО пользователю с ником Artem1,
// прямо внутри обычного приложения (не отдельный пароль, как /admin-panel.html —
// тот тоже остался и работает как запасной вариант).
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { GLOBAL_CHAT_KEY } = require('../utils/city');

const router = express.Router();
router.use(requireAuth);

const OWNER_USERNAME = 'Artem1';

async function requireOwner(req, res, next) {
  const r = await db.query('SELECT username FROM users WHERE id=$1', [req.userId]);
  if (!r.rows.length || r.rows[0].username !== OWNER_USERNAME) {
    return res.status(403).json({ error: 'Доступ только для владельца приложения.' });
  }
  next();
}
router.use(requireOwner);

router.get('/stats', async (req, res) => {
  const users = await db.query('SELECT count(*)::int AS c FROM users');
  const completed = await db.query("SELECT count(*)::int AS c FROM workouts WHERE status='done'");
  const events = await db.query('SELECT count(*)::int AS c FROM events WHERE cancelled=false');
  res.json({
    users: users.rows[0].c,
    completedWorkouts: completed.rows[0].c,
    activeEvents: events.rows[0].c
  });
});

router.get('/users', async (req, res) => {
  const r = await db.query(
    `SELECT u.id, u.username, u.is_blocked, u.created_at, p.name,
            count(w.*) FILTER (WHERE w.status='done') AS done_workouts
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN workouts w ON w.user_id = u.id
      GROUP BY u.id, u.username, u.is_blocked, u.created_at, p.name
      ORDER BY u.created_at DESC`
  );
  res.json(r.rows);
});

router.post('/users/:id/ban', async (req, res) => {
  await db.query('UPDATE users SET is_blocked=true WHERE id=$1', [req.params.id]);
  await db.query('DELETE FROM refresh_tokens WHERE user_id=$1', [req.params.id]);
  res.json({ ok: true });
});

router.post('/users/:id/unban', async (req, res) => {
  await db.query('UPDATE users SET is_blocked=false WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// События (забеги) — Artem добавляет их вручную, все пользователи видят на вкладке "События"
router.get('/events', async (req, res) => {
  const r = await db.query(
    `SELECT id, title, event_date, city, distance_info, link_url, photo_url, cancelled, created_at
       FROM events ORDER BY event_date DESC LIMIT 100`
  );
  res.json(r.rows);
});

router.post('/events', async (req, res) => {
  const { title, event_date, city, distance_info, link_url, photo_url } = req.body;
  if (!title || !event_date) return res.status(400).json({ error: 'Укажите название и дату.' });

  const chat = await db.query(
    `INSERT INTO city_chats (city_name) VALUES ($1)
     ON CONFLICT (city_name) DO UPDATE SET city_name=EXCLUDED.city_name RETURNING id`,
    [GLOBAL_CHAT_KEY]
  );
  const r = await db.query(
    `INSERT INTO events (chat_id, creator_id, title, event_date, city, distance_info, link_url, photo_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [chat.rows[0].id, req.userId, title, event_date, city || null, distance_info || null, link_url || null, photo_url || null]
  );
  res.json(r.rows[0]);
});

router.post('/events/:id/cancel', async (req, res) => {
  await db.query('UPDATE events SET cancelled=true WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
