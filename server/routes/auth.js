const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const agentService = require('../services/agentService');

const router = express.Router();

const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = 30;

function signAccessToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: ACCESS_TTL });
}

function makeRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueSession(res, userId) {
  const accessToken = signAccessToken(userId);
  const refreshToken = makeRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
    [userId, hashToken(refreshToken), expiresAt]
  );

  // httpOnly cookie -> JS на фронте его не видит, это и есть "постоянная сессия"
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000
  });

  return accessToken;
}

// Шаг 1: проверка промокода закрытого теста
router.post('/promo', (req, res) => {
  const { code } = req.body;
  if (!code || code !== process.env.PROMO_CODE) {
    return res.status(400).json({ error: 'Неверный промокод.' });
  }
  const regToken = jwt.sign({ promoOk: true }, process.env.JWT_SECRET, { expiresIn: '30m' });
  res.json({ regToken });
});

// Шаг 2: создание аккаунта (логин + пароль), только если промокод подтверждён
router.post('/register', async (req, res) => {
  const { regToken, username, password } = req.body;
  if (!regToken || !username || !password) {
    return res.status(400).json({ error: 'Заполните логин и пароль.' });
  }
  try {
    const payload = jwt.verify(regToken, process.env.JWT_SECRET);
    if (!payload.promoOk) throw new Error('bad token');
  } catch {
    return res.status(400).json({ error: 'Сессия регистрации истекла, начните заново.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов.' });
  }

  const existing = await db.query('SELECT id FROM users WHERE username=$1', [username]);
  if (existing.rows.length) {
    return res.status(409).json({ error: 'Это имя пользователя уже занято.' });
  }

  const hash = await bcrypt.hash(password, 10);
  const result = await db.query(
    'INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id',
    [username, hash]
  );
  const userId = result.rows[0].id;
  await db.query('INSERT INTO settings (user_id) VALUES ($1)', [userId]);
  await db.query('INSERT INTO agent_memory (user_id, data) VALUES ($1, $2)', [userId, {}]);

  const accessToken = await issueSession(res, userId);
  res.json({ accessToken, userId });
});

// Проверка занятости username в реальном времени (для формы регистрации)
router.get('/username-available', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ available: false });
  const r = await db.query('SELECT id FROM users WHERE username=$1', [username]);
  res.json({ available: r.rows.length === 0 });
});

// Шаг 3: заполнение профиля
router.post('/profile-setup', requireAuth, async (req, res) => {
  const { name, photo_url, profession, gender, city } = req.body;
  await db.query(
    `INSERT INTO profiles (user_id, name, photo_url, profession, gender, city)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id) DO UPDATE SET name=$2, photo_url=$3, profession=$4, gender=$5, city=$6`,
    [req.userId, name, photo_url || null, profession || null, gender || null, city || null]
  );
  // Вступление в общий чат теперь отдельное явное действие (кнопка "Вступить" на вкладке "Чаты"),
  // не происходит автоматически при регистрации.

  // Агент сам начинает разговор: генерируем и сохраняем первое сообщение сразу, чтобы на
  // экране "Агент" пользователь увидел готовое приветствие с первым вопросом, а не пустой чат.
  try {
    const kickoff = `(Служебная пометка, пользователь её не видел и не писал.) Это твоё первое обращение — ` +
      `пользователь только что зарегистрировался и заполнил профиль${name ? ` (имя: ${name})` : ''}. ` +
      `Поздоровайся тепло, коротко представься как персональный AI-тренер, скажи, что расскажешь честно и ` +
      `объективно, насколько реальна его цель по срокам, а не будешь просто хвалить, и задай первый вопрос ` +
      `(или два) из серии вводных — всего их будет до 6 подряд (цель, уровень подготовки, ограничения по ` +
      `здоровью, сколько дней/времени есть на тренировки и т.п.). Не задавай всё сразу, начни с одного-двух. ` +
      `В самом конце этого же сообщения (не как отдельный вопрос, просто короткой припиской) невзначай ` +
      `напомни: "Кстати, зайди в Профиль и включи уведомления — тогда я смогу писать тебе, даже если телефон ` +
      `заблокирован". Один раз, без занудства.`;
    const reply = await agentService.sendMessage(req.userId, kickoff);
    await db.query("INSERT INTO agent_messages (user_id, role, content) VALUES ($1,'agent',$2)", [req.userId, reply]);
  } catch (e) {
    console.error('Ошибка первого сообщения агента:', e);
    // Не блокируем регистрацию, если агент недоступен — пользователь просто напишет первым сам.
  }

  res.json({ ok: true });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const r = await db.query('SELECT id, password_hash, is_blocked FROM users WHERE username=$1', [username]);
  if (!r.rows.length) return res.status(401).json({ error: 'Неверный логин или пароль.' });
  const user = r.rows[0];
  if (user.is_blocked) return res.status(403).json({ error: 'Аккаунт заблокирован.' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Неверный логин или пароль.' });

  const accessToken = await issueSession(res, user.id);
  res.json({ accessToken, userId: user.id });
});

// Обновление access-токена по refresh-cookie (чтобы не разлогинивало)
router.post('/refresh', async (req, res) => {
  const token = req.cookies.refresh_token;
  if (!token) return res.status(401).json({ error: 'Нет сессии.' });

  const hash = hashToken(token);
  const r = await db.query(
    'SELECT user_id FROM refresh_tokens WHERE token_hash=$1 AND expires_at > now()',
    [hash]
  );
  if (!r.rows.length) return res.status(401).json({ error: 'Сессия истекла, войдите заново.' });

  const accessToken = signAccessToken(r.rows[0].user_id);
  res.json({ accessToken, userId: r.rows[0].user_id });
});

router.post('/logout', async (req, res) => {
  const token = req.cookies.refresh_token;
  if (token) {
    await db.query('DELETE FROM refresh_tokens WHERE token_hash=$1', [hashToken(token)]);
  }
  res.clearCookie('refresh_token');
  res.json({ ok: true });
});

// Выход со всех устройств
router.post('/logout-all', requireAuth, async (req, res) => {
  await db.query('DELETE FROM refresh_tokens WHERE user_id=$1', [req.userId]);
  res.clearCookie('refresh_token');
  res.json({ ok: true });
});

module.exports = router;
