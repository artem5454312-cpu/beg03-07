const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const agentService = require('../services/agentService');

const router = express.Router();
router.use(requireAuth);

router.get('/messages', async (req, res) => {
  const r = await db.query(
    'SELECT id, role, content, created_at FROM agent_messages WHERE user_id=$1 ORDER BY created_at ASC LIMIT 50',
    [req.userId]
  );
  res.json(r.rows);
});

router.post('/messages', async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Пустое сообщение.' });

  await db.query("INSERT INTO agent_messages (user_id, role, content) VALUES ($1,'user',$2)", [req.userId, content]);

  try {
    const reply = await agentService.sendMessage(req.userId, content);
    const saved = await db.query(
      "INSERT INTO agent_messages (user_id, role, content) VALUES ($1,'agent',$2) RETURNING id, role, content, created_at",
      [req.userId, reply]
    );
    res.json(saved.rows[0]);
  } catch (e) {
    console.error('Ошибка агента:', e);
    res.status(500).json({ error: 'Агент временно недоступен. Проверьте переменную ANTHROPIC_API_KEY.' });
  }
});

// Очистить только ленту диалога — память фактов (agent_memory) не трогаем
router.delete('/messages', async (req, res) => {
  await db.query('DELETE FROM agent_messages WHERE user_id=$1', [req.userId]);
  res.json({ ok: true });
});

router.post('/new-goal', async (req, res) => {
  await db.query(
    "UPDATE goals SET status='archived', archived_at=now() WHERE user_id=$1 AND status='active'",
    [req.userId]
  );
  const kickoff = 'Пользователь запросил новую цель. Задай вводные вопросы заново (цель, уровень, ограничения, доступное время).';
  await db.query("INSERT INTO agent_messages (user_id, role, content) VALUES ($1,'user',$2)", [req.userId, kickoff]);

  const reply = await agentService.sendMessage(req.userId, kickoff);
  const saved = await db.query(
    "INSERT INTO agent_messages (user_id, role, content) VALUES ($1,'agent',$2) RETURNING id, role, content, created_at",
    [req.userId, reply]
  );
  res.json(saved.rows[0]);
});

module.exports = router;
