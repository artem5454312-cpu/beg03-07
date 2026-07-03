// Фоновые задачи: напоминания о тренировках, авто-статус "пропущено", напоминания о событиях.
// В проде на Railway это просто часть того же процесса (работает, пока сервис жив).
const cron = require('node-cron');
const db = require('./db');
const push = require('./services/push');

// Каждый час: смотрим тренировки на сегодня и присылаем разовое напоминание
async function remindTodayWorkouts() {
  const r = await db.query(`
    SELECT w.id, w.user_id, w.type
      FROM workouts w
     WHERE w.date = CURRENT_DATE AND w.status='planned'
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
          WHERE n.user_id = w.user_id AND n.type='workout_reminder'
            AND (n.payload->>'workout_id')::int = w.id
       )
  `);
  for (const row of r.rows) {
    await push.sendToUser(row.user_id, {
      type: 'workout_reminder',
      workout_id: row.id,
      title: 'Сегодня тренировка',
      body: `Не забудь: сегодня по плану — ${row.type}.`
    });
  }
}

// Раз в сутки: тренировки, которые прошли больше 2 дней назад и не отмечены — считаем пропущенными
async function autoMarkSkipped() {
  await db.query(`
    UPDATE workouts SET status='skipped'
     WHERE status='planned' AND date < CURRENT_DATE - INTERVAL '2 days'
  `);
}

// Раз в час: напоминания о ближайших городских событиях (за ~24 часа)
async function remindUpcomingEvents() {
  const r = await db.query(`
    SELECT e.id, e.title, e.event_date, ep.user_id
      FROM events e
      JOIN event_participants ep ON ep.event_id = e.id
     WHERE e.cancelled = false
       AND e.event_date BETWEEN now() + INTERVAL '23 hours' AND now() + INTERVAL '25 hours'
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
          WHERE n.user_id = ep.user_id AND n.type='event_reminder'
            AND (n.payload->>'event_id')::int = e.id
       )
  `);
  for (const row of r.rows) {
    await push.sendToUser(row.user_id, {
      type: 'event_reminder',
      event_id: row.id,
      title: 'Завтра событие',
      body: `Напоминаем: «${row.title}» уже завтра.`
    });
  }
}

function start() {
  cron.schedule('0 * * * *', () => {
    remindTodayWorkouts().catch(e => console.error('remindTodayWorkouts error', e));
    remindUpcomingEvents().catch(e => console.error('remindUpcomingEvents error', e));
  });
  cron.schedule('0 3 * * *', () => {
    autoMarkSkipped().catch(e => console.error('autoMarkSkipped error', e));
  });
  console.log('Планировщик задач запущен (напоминания раз в час, авто-статусы раз в сутки).');
}

module.exports = { start };
