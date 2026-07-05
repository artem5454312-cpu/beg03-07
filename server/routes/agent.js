const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const agentService = require('../services/agentService');
const push = require('../services/push');

const router = express.Router();
router.use(requireAuth);

router.get('/messages', async (req, res) => {
  // Раньше тут был баг: ORDER BY ... ASC LIMIT 50 брал первые 50 сообщений с начала
  // переписки, а не последние — после 50-го сообщения все новые переставали
  // показываться (хотя в базе оставались целыми). Теперь берём последние 300 и
  // сортируем их по времени для отображения.
  const r = await db.query(
    `SELECT id, role, content, created_at FROM (
       SELECT id, role, content, created_at FROM agent_messages
        WHERE user_id=$1 ORDER BY created_at DESC LIMIT 300
     ) recent ORDER BY created_at ASC`,
    [req.userId]
  );
  res.json(r.rows);
});

router.post('/messages', async (req, res) => {
  const { content, image } = req.body; // image: data URL строка, необязательно
  if ((!content || !content.trim()) && !image) return res.status(400).json({ error: 'Пустое сообщение.' });

  const displayContent = image ? 'IMG::' + image : content;
  const userMsg = await db.query(
    "INSERT INTO agent_messages (user_id, role, content) VALUES ($1,'user',$2) RETURNING created_at",
    [req.userId, displayContent]
  );

  // Отвечаем сразу же, не дожидаясь ответа Клода. Если план большой (много тренировок
  // за раз), обработка может занять больше времени, чем терпит мобильная сеть/браузер
  // в рамках одного запроса — раньше это иногда обрывалось ошибкой "Failed to fetch".
  // Теперь телефон просто спрашивает "готово?" отдельными короткими запросами.
  res.json({ pending: true, since: userMsg.rows[0].created_at });

  let imagePayload = null;
  if (image) {
    const marker = ';base64,';
    const idx = image.indexOf(marker);
    if (image.startsWith('data:') && idx !== -1) {
      const mediaType = image.slice('data:'.length, idx).split(';')[0] || 'image/jpeg';
      imagePayload = { mediaType, base64: image.slice(idx + marker.length) };
    }
  }

  try {
    const reply = await agentService.sendMessage(req.userId, content || '', { image: imagePayload });
    await db.query("INSERT INTO agent_messages (user_id, role, content) VALUES ($1,'agent',$2)", [req.userId, reply]);
    push.sendToUser(req.userId, {
      type: 'agent_message',
      title: 'Тренер написал',
      body: reply.length > 140 ? reply.slice(0, 140) + '…' : reply
    }).catch(e => console.error('push error:', e));
  } catch (e) {
    console.error('Ошибка агента:', e);
    await db.query(
      "INSERT INTO agent_messages (user_id, role, content) VALUES ($1,'agent',$2)",
      [req.userId, 'Не получилось обработать сообщение (проверь ANTHROPIC_API_KEY на сервере). Попробуй написать ещё раз.']
    );
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
  const userMsg = await db.query(
    "INSERT INTO agent_messages (user_id, role, content) VALUES ($1,'user',$2) RETURNING created_at",
    [req.userId, kickoff]
  );
  res.json({ pending: true, since: userMsg.rows[0].created_at });

  try {
    const reply = await agentService.sendMessage(req.userId, kickoff);
    await db.query("INSERT INTO agent_messages (user_id, role, content) VALUES ($1,'agent',$2)", [req.userId, reply]);
    push.sendToUser(req.userId, { type: 'agent_message', title: 'Тренер написал', body: reply.slice(0, 140) }).catch(() => {});
  } catch (e) {
    console.error('Ошибка агента (new-goal):', e);
    await db.query(
      "INSERT INTO agent_messages (user_id, role, content) VALUES ($1,'agent',$2)",
      [req.userId, 'Не получилось начать новую цель — попробуй ещё раз через минуту.']
    );
  }
});

// Голосовой ввод для чата с агентом: браузер записывает звук, а распознаёт его
// OpenAI Whisper (нужен отдельный ключ OPENAI_API_KEY в .env — см. .env.example).
router.post('/transcribe', async (req, res) => {
  const { audio } = req.body;
  if (!audio) return res.status(400).json({ error: 'Нет аудио.' });
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Голосовой ввод не настроен: нет переменной OPENAI_API_KEY.' });
  }

  // Разбираем вручную, а не одним регулярным выражением: Android часто пишет тип вида
  // "audio/webm;codecs=opus" — между типом и ";base64," оказывается ещё один параметр,
  // и жёсткий регэксп на это падал ("Некорректный формат аудио" на Android).
  const marker = ';base64,';
  const markerIdx = audio.indexOf(marker);
  if (!audio.startsWith('data:') || markerIdx === -1) {
    return res.status(400).json({ error: 'Некорректный формат аудио.' });
  }
  const header = audio.slice('data:'.length, markerIdx); // например "audio/webm;codecs=opus"
  const mime = header.split(';')[0] || 'audio/webm';      // берём только сам тип, без ;codecs=...
  const base64 = audio.slice(markerIdx + marker.length);
  const buffer = Buffer.from(base64, 'base64');
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
