const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
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

module.exports = router;
