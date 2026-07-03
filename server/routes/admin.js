const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Точка входа не привязана к обычным пользователям и не видна в навигации приложения.
// Доступна только по прямому адресу /admin-panel (см. public/admin.html)
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Неверный пароль.' });
  }
  const token = jwt.sign({ admin: true }, process.env.JWT_SECRET + '_admin', { expiresIn: '2h' });
  db.query("INSERT INTO admin_logs (action) VALUES ('login')").catch(() => {});
  res.json({ token });
});

router.use(requireAdmin);

router.get('/stats', async (req, res) => {
  const users = await db.query('SELECT count(*) FROM users');
  const chats = await db.query('SELECT count(*) FROM city_chats');
  const messages = await db.query('SELECT count(*) FROM chat_messages');
  const reports = await db.query('SELECT count(*) FROM reports');
  res.json({
    users: parseInt(users.rows[0].count, 10),
    cityChats: parseInt(chats.rows[0].count, 10),
    chatMessages: parseInt(messages.rows[0].count, 10),
    pendingReports: parseInt(reports.rows[0].count, 10)
  });
});

router.get('/users', async (req, res) => {
  const r = await db.query(
    `SELECT u.id, u.username, u.is_blocked, u.created_at, p.name, p.city
       FROM users u LEFT JOIN profiles p ON p.user_id=u.id
      ORDER BY u.created_at DESC LIMIT 200`
  );
  res.json(r.rows);
});

router.post('/users/:id/ban', async (req, res) => {
  await db.query('UPDATE users SET is_blocked=true WHERE id=$1', [req.params.id]);
  await db.query('DELETE FROM refresh_tokens WHERE user_id=$1', [req.params.id]); // выкидываем со всех устройств
  await db.query("INSERT INTO admin_logs (action) VALUES ($1)", [`ban user ${req.params.id}`]);
  res.json({ ok: true });
});

router.post('/users/:id/unban', async (req, res) => {
  await db.query('UPDATE users SET is_blocked=false WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

router.get('/chats', async (req, res) => {
  const r = await db.query(
    `SELECT cc.id, cc.city_name, count(cm.*) as messages
       FROM city_chats cc LEFT JOIN chat_messages cm ON cm.chat_id=cc.id
      GROUP BY cc.id ORDER BY messages DESC`
  );
  res.json(r.rows);
});

router.get('/reports', async (req, res) => {
  const r = await db.query(
    `SELECT r.id, r.created_at, cm.content, u.username as message_author
       FROM reports r
       JOIN chat_messages cm ON cm.id = r.message_id
       JOIN users u ON u.id = cm.user_id
      ORDER BY r.created_at DESC LIMIT 100`
  );
  res.json(r.rows);
});

module.exports = router;
