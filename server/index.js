require('dotenv').config();
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const db = require('./db');
const { attachWebSocket } = require('./ws');
const scheduler = require('./scheduler');

// Создаёт таблицы в базе автоматически при каждом запуске сервера.
// Это безопасно повторять — в schema.sql везде написано "CREATE TABLE IF NOT EXISTS",
// поэтому если таблицы уже есть, ничего не сломается и не задвоится.
async function ensureDatabaseReady() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.query(sql);
  console.log('База данных готова (таблицы созданы или уже существовали).');
}

const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN || true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Простой rate limit на чувствительные маршруты (промокод, логин) —
// без внешних библиотек, чтобы было видно и понятно, как это работает.
const attempts = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const rec = attempts.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + windowMs; }
    rec.count++;
    attempts.set(key, rec);
    if (rec.count > max) {
      return res.status(429).json({ error: 'Слишком много попыток. Подождите немного.' });
    }
    next();
  };
}

const authRoutes = require('./routes/auth');
const agentRoutes = require('./routes/agent');
const planRoutes = require('./routes/plan');
const chatsRoutes = require('./routes/chats');
const profileRoutes = require('./routes/profile');
const adminRoutes = require('./routes/admin');
const notificationsRoutes = require('./routes/notifications');
const ownerRoutes = require('./routes/owner');

app.use('/api/auth/promo', rateLimit(10, 10 * 60 * 1000));
app.use('/api/auth/login', rateLimit(15, 10 * 60 * 1000));

app.use('/api/auth', authRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/plan', planRoutes);
app.use('/api/chats', chatsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/owner', ownerRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Отдаём статику фронтенда (PWA)
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const server = http.createServer(app);
attachWebSocket(server);

const PORT = process.env.PORT || 3000;

ensureDatabaseReady()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`AI-тренер запущен: http://localhost:${PORT}`);
      scheduler.start();
    });
  })
  .catch((err) => {
    console.error('Не удалось подготовить базу данных при старте:', err);
    process.exit(1);
  });
