// Фоновые задачи: напоминания о тренировках, авто-статус "пропущено", напоминания о событиях,
// утренний брифинг от агента. В проде на Railway это часть того же процесса (пока сервис жив).
const cron = require('node-cron');
const db = require('./db');
const push = require('./services/push');
const agentService = require('./services/agentService');

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

// Раз в сутки в 7 утра (по времени сервера — см. примечание в README про часовой пояс):
// агент сам пишет каждому пользователю утреннее сообщение — план на день или советы,
// если тренировки сегодня нет.
async function sendMorningBriefing() {
  const users = await db.query('SELECT user_id FROM profiles');
  for (const { user_id } of users.rows) {
    try {
      const todays = await db.query(
        "SELECT type, difficulty FROM workouts WHERE user_id=$1 AND date=CURRENT_DATE AND status NOT IN ('cancelled','skipped')",
        [user_id]
      );

      const instruction = todays.rows.length
        ? `(Служебная утренняя пометка, пользователь её не видел и не писал.) Сегодня по плану: ` +
          `${todays.rows.map(w => `${w.type} (сложность: ${w.difficulty})`).join('; ')}. Напиши короткое доброе ` +
          `утреннее сообщение: поздоровайся, напомни план на сегодня, дай 1-2 практичных совета — что съесть ` +
          `перед тренировкой и как подготовиться. Живо, тепло, без канцелярита, одно сообщение.`
        : `(Служебная утренняя пометка, пользователь её не видел и не писал.) Сегодня тренировки по плану нет. ` +
          `Напиши короткое доброе утреннее сообщение с 1-2 советами по питанию или восстановлению на сегодня. ` +
          `Живо, тепло, без канцелярита, одно сообщение.`;

      const reply = await agentService.sendMessage(user_id, instruction);
      await db.query("INSERT INTO agent_messages (user_id, role, content) VALUES ($1,'agent',$2)", [user_id, reply]);
    } catch (e) {
      console.error('Ошибка утреннего брифинга для пользователя', user_id, e);
    }
  }
}

function start() {
  const MSK = { timezone: 'Europe/Moscow' };
  cron.schedule('0 * * * *', () => {
    remindTodayWorkouts().catch(e => console.error('remindTodayWorkouts error', e));
    remindUpcomingEvents().catch(e => console.error('remindUpcomingEvents error', e));
  }, MSK);
  cron.schedule('0 3 * * *', () => {
    autoMarkSkipped().catch(e => console.error('autoMarkSkipped error', e));
  }, MSK);
  cron.schedule('0 7 * * *', () => {
    sendMorningBriefing().catch(e => console.error('sendMorningBriefing error', e));
  }, MSK);
  console.log('Планировщик задач запущен по московскому времени (напоминания раз в час, авто-статусы и утренний брифинг раз в сутки).');
}

module.exports = { start };
