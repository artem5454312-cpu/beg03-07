// Базовый слой push-уведомлений (Web Push).
// Чтобы это реально заработало, нужно:
// 1) сгенерировать VAPID-ключи: npx web-push generate-vapid-keys
// 2) вставить их в .env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)
const webpush = require('web-push');
const db = require('../db');

function configured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

if (configured()) {
  webpush.setVapidDetails(
    process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

async function sendToUser(userId, notification) {
  // Всегда пишем в таблицу уведомлений — это работает даже без настроенного push
  await db.query(
    'INSERT INTO notifications (user_id, type, payload) VALUES ($1,$2,$3)',
    [userId, notification.type, notification]
  );

  if (!configured()) return; // push просто пропускаем, если ключи не заданы

  const subs = await db.query('SELECT subscription FROM push_subscriptions WHERE user_id=$1', [userId]);
  for (const row of subs.rows) {
    try {
      await webpush.sendNotification(row.subscription, JSON.stringify(notification));
    } catch (e) {
      // Подписка могла устареть — это ожидаемо, просто пропускаем
    }
  }
}

module.exports = { sendToUser, configured };
