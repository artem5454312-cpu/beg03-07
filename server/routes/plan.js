const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const agentService = require('../services/agentService');

const router = express.Router();
router.use(requireAuth);

async function getActiveGoalId(userId) {
  const r = await db.query(
    "SELECT id FROM goals WHERE user_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  if (r.rows.length) return r.rows[0].id;
  const g = await db.query(
    "INSERT INTO goals (user_id, title, status) VALUES ($1,'Общая цель','active') RETURNING id",
    [userId]
  );
  return g.rows[0].id;
}

// Тренировки за месяц: /api/plan/workouts?month=2026-07
router.get('/workouts', async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const r = await db.query(
    `SELECT w.id, w.date, w.type, w.status, w.source,
            wr.notes, wr.metrics
       FROM workouts w
       LEFT JOIN workout_results wr ON wr.workout_id = w.id
      WHERE w.user_id=$1 AND to_char(w.date, 'YYYY-MM')=$2
      ORDER BY w.date ASC`,
    [req.userId, month]
  );
  res.json(r.rows);
});

// Ручное добавление тренировки (кнопка "+")
router.post('/workouts', async (req, res) => {
  const { date, type, difficulty } = req.body;
  if (!date || !type) return res.status(400).json({ error: 'Укажите дату и тип тренировки.' });
  const goalId = await getActiveGoalId(req.userId);
  const r = await db.query(
    `INSERT INTO workouts (goal_id, user_id, date, type, status, source, difficulty)
     VALUES ($1,$2,$3,$4,'planned','manual',$5) RETURNING *`,
    [goalId, req.userId, date, type, ['easy','medium','hard'].includes(difficulty) ? difficulty : 'medium']
  );
  res.json(r.rows[0]);
});

// Отметить статус (выполнено / пропущено / отменено)
router.patch('/workouts/:id', async (req, res) => {
  const { status } = req.body;
  const allowed = ['planned', 'done', 'skipped', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Некорректный статус.' });

  const before = await db.query('SELECT status FROM workouts WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
  if (!before.rows.length) return res.status(404).json({ error: 'Тренировка не найдена.' });
  const wasDone = before.rows[0].status === 'done';

  const r = await db.query(
    'UPDATE workouts SET status=$1 WHERE id=$2 AND user_id=$3 RETURNING *',
    [status, req.params.id, req.userId]
  );
  res.json(r.rows[0]);

  // Тренировка только что стала "выполнена" (а не была ей раньше) — агент сам
  // проактивно спросит, как всё прошло. Не блокируем ответ пользователю — делаем в фоне.
  if (status === 'done' && !wasDone) {
    triggerWorkoutCheckIn(req.userId, r.rows[0]).catch(e => console.error('Ошибка проверки тренировки агентом:', e));
  }
});

async function triggerWorkoutCheckIn(userId, workout) {
  const instruction = `(Служебная пометка для тебя, пользователь её не видел и не писал: он только что ` +
    `отметил тренировку "${workout.type}" за ${workout.date} как выполненную через приложение, не в чате.) ` +
    `Проактивно, одним коротким сообщением поинтересуйся, как всё прошло: самочувствие, что получалось, ` +
    `что было тяжело. Будь тёплым, живым и поддерживающим, коротко похвали за то, что довёл до конца. ` +
    `Не занудствуй, не растягивай, без канцелярита — как хороший друг-тренер, а не бот с чек-листом.`;
  const reply = await agentService.sendMessage(userId, instruction);
  await db.query("INSERT INTO agent_messages (user_id, role, content) VALUES ($1,'agent',$2)", [userId, reply]);
}

// Прикрепить результат / файл к тренировке
router.post('/workouts/:id/result', async (req, res) => {
  const { notes, metrics, file_url } = req.body;
  const owns = await db.query('SELECT id, status FROM workouts WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
  if (!owns.rows.length) return res.status(404).json({ error: 'Тренировка не найдена.' });
  const wasDone = owns.rows[0].status === 'done';

  const r = await db.query(
    'INSERT INTO workout_results (workout_id, notes, metrics, file_url) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.params.id, notes || null, metrics || null, file_url || null]
  );
  const w = await db.query("UPDATE workouts SET status='done' WHERE id=$1 RETURNING *", [req.params.id]);
  res.json(r.rows[0]);

  if (!wasDone) {
    triggerWorkoutCheckIn(req.userId, w.rows[0]).catch(e => console.error('Ошибка проверки тренировки агентом:', e));
  }
});

// Карточка сверху экрана "План": заголовок и текст плана, которые задаёт агент,
// плюс сводка по датам, чтобы было видно охват (первая/последняя тренировка, сколько всего)
router.get('/goal', async (req, res) => {
  const goal = await db.query(
    "SELECT id, title, description, created_at FROM goals WHERE user_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1",
    [req.userId]
  );
  if (!goal.rows.length) return res.json(null);

  const stats = await db.query(
    `SELECT count(*) as total,
            count(*) FILTER (WHERE status='done') as done,
            min(date) as first_date, max(date) as last_date
       FROM workouts WHERE goal_id=$1`,
    [goal.rows[0].id]
  );

  res.json({ ...goal.rows[0], ...stats.rows[0] });
});

// Весь план, разбитый на блоки по целям (текущая цель сверху, дальше — архивные).
// Каждый блок несёт свои тренировки, чтобы бег и зал не путались в одном списке.
router.get('/overview', async (req, res) => {
  const goals = await db.query(
    `SELECT id, title, description, status, created_at
       FROM goals WHERE user_id=$1
      ORDER BY (status='active') DESC, created_at DESC`,
    [req.userId]
  );
  if (!goals.rows.length) return res.json([]);

  const workouts = await db.query(
    `SELECT w.id, w.goal_id, w.date, w.type, w.status, w.source, w.difficulty, wr.notes, wr.metrics
       FROM workouts w
       LEFT JOIN workout_results wr ON wr.workout_id = w.id
      WHERE w.user_id=$1
      ORDER BY w.date ASC`,
    [req.userId]
  );

  const byGoal = {};
  for (const w of workouts.rows) {
    (byGoal[w.goal_id] ||= []).push(w);
  }

  res.json(goals.rows.map(g => ({ ...g, workouts: byGoal[g.id] || [] })));
});

// Удалить блок целиком (цель + все её тренировки — каскадно через внешний ключ)
router.delete('/goals/:id', async (req, res) => {
  await db.query('DELETE FROM goals WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
  res.json({ ok: true });
});

// Удалить одну тренировку
router.delete('/workouts/:id', async (req, res) => {
  await db.query('DELETE FROM workouts WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
  res.json({ ok: true });
});

module.exports = router;
