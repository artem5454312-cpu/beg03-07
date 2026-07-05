const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { GLOBAL_CHAT_KEY } = require('../utils/city');

const router = express.Router();

// Публичный VAPID-ключ нужен браузеру для подписки на push — отдаём его без авторизации,
// это не секрет (секретный ключ VAPID_PRIVATE_KEY остаётся только на сервере).
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

router.use(requireAuth);

router.get('/', async (req, res) => {
  const r = await db.query(
    'SELECT id, type, payload, is_read, created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
    [req.userId]
  );
  res.json(r.rows);
});

router.post('/:id/read', async (req, res) => {
  await db.query('UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
  res.json({ ok: true });
});

// Браузер присылает сюда подписку на push после разрешения уведомлений
router.post('/push-subscribe', async (req, res) => {
  await db.query(
    'INSERT INTO push_subscriptions (user_id, subscription) VALUES ($1,$2)',
    [req.userId, req.body]
  );
  res.json({ ok: true });
});

// Счётчики непрочитанного для красных кружков на вкладках и на иконке приложения
router.get('/unread', async (req, res) => {
  const chat = await db.query(
    `SELECT count(*)::int AS c
       FROM chat_messages cm
       JOIN city_chats cc ON cc.id = cm.chat_id AND cc.city_name = $2
       LEFT JOIN chat_read_state crs ON crs.chat_id = cm.chat_id AND crs.user_id = $1
      WHERE cm.user_id != $1 AND cm.created_at > COALESCE(crs.last_read_at, 'epoch')`,
    [req.userId, GLOBAL_CHAT_KEY]
  );

  const agent = await db.query(
    `SELECT count(*)::int AS c
       FROM agent_messages am
       LEFT JOIN agent_read_state ars ON ars.user_id = $1
      WHERE am.user_id = $1 AND am.role='agent' AND am.created_at > COALESCE(ars.last_read_at, 'epoch')`,
    [req.userId]
  );

  res.json({ chat: chat.rows[0].c, agent: agent.rows[0].c });
});

// Отметить прочитанным: scope = 'chat' | 'agent'
router.post('/mark-read', async (req, res) => {
  const { scope } = req.body;
  if (scope === 'chat') {
    const chat = await db.query('SELECT id FROM city_chats WHERE city_name=$1', [GLOBAL_CHAT_KEY]);
    if (chat.rows.length) {
      await db.query(
        `INSERT INTO chat_read_state (user_id, chat_id, last_read_at) VALUES ($1,$2, now())
         ON CONFLICT (user_id, chat_id) DO UPDATE SET last_read_at = now()`,
        [req.userId, chat.rows[0].id]
      );
    }
  } else if (scope === 'agent') {
    await db.query(
      `INSERT INTO agent_read_state (user_id, last_read_at) VALUES ($1, now())
       ON CONFLICT (user_id) DO UPDATE SET last_read_at = now()`,
      [req.userId]
    );
  } else {
    return res.status(400).json({ error: 'Некорректный scope.' });
  }
  res.json({ ok: true });
});

module.exports = router;
