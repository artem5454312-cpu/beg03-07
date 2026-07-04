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
  const { content, image } = req.body; // image: data URL строка, необязательно
  if ((!content || !content.trim()) && !image) return res.status(400).json({ error: 'Пустое сообщение.' });

  const displayContent = image ? 'IMG::' + image : content;
  await db.query("INSERT INTO agent_messages (user_id, role, content) VALUES ($1,'user',$2)", [req.userId, displayContent]);

  let imagePayload = null;
  if (image) {
    const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (match) imagePayload = { mediaType: match[1], base64: match[2] };
  }

  try {
    const reply = await agentService.sendMessage(req.userId, content || '', { image: imagePayload });
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

// Голосовой ввод для чата с агентом: браузер записывает звук, а распознаёт его
// OpenAI Whisper (нужен отдельный ключ OPENAI_API_KEY в .env — см. .env.example).
router.post('/transcribe', async (req, res) => {
  const { audio } = req.body;
  if (!audio) return res.status(400).json({ error: 'Нет аудио.' });
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Голосовой ввод не настроен: нет переменной OPENAI_API_KEY.' });
  }

  const match = audio.match(/^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'Некорректный формат аудио.' });
  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const ext = mime.includes('webm') ? 'webm' : mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'wav';

  try {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime }), `audio.${ext}`);
    form.append('model', 'whisper-1');
    form.append('language', 'ru');

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });

    if (!resp.ok) {
      console.error('Whisper error:', await resp.text());
      return res.status(502).json({ error: 'Не удалось распознать речь.' });
    }
    const data = await resp.json();
    res.json({ text: data.text || '' });
  } catch (e) {
    console.error('Ошибка распознавания речи:', e);
    res.status(500).json({ error: 'Ошибка распознавания речи.' });
  }
});

module.exports = router;
