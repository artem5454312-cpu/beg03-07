const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const p = await db.query(
    `SELECT u.username, u.created_at, pr.name, pr.photo_url, pr.profession, pr.gender, pr.city, pr.bio,
            s.theme, s.notify_agent, s.notify_chat, s.notify_workout
       FROM users u
       LEFT JOIN profiles pr ON pr.user_id = u.id
       LEFT JOIN settings s ON s.user_id = u.id
      WHERE u.id=$1`,
    [req.userId]
  );
  res.json(p.rows[0] || {});
});

router.patch('/', async (req, res) => {
  const { name, photo_url, profession, gender, city, bio } = req.body;
  await db.query(
    `UPDATE profiles SET name=COALESCE($1,name), photo_url=COALESCE($2,photo_url),
       profession=COALESCE($3,profession), gender=COALESCE($4,gender),
       city=COALESCE($5,city), bio=COALESCE($6,bio)
     WHERE user_id=$7`,
    [name, photo_url, profession, gender, city, bio, req.userId]
  );
  res.json({ ok: true });
});

router.patch('/settings', async (req, res) => {
  const { theme, notify_agent, notify_chat, notify_workout } = req.body;
  await db.query(
    `UPDATE settings SET theme=COALESCE($1,theme), notify_agent=COALESCE($2,notify_agent),
       notify_chat=COALESCE($3,notify_chat), notify_workout=COALESCE($4,notify_workout)
     WHERE user_id=$5`,
    [theme, notify_agent, notify_chat, notify_workout, req.userId]
  );
  res.json({ ok: true });
});

// Аналитика: и "за всё время", и "по текущей цели"
router.get('/analytics', async (req, res) => {
  const overall = await db.query(
    `SELECT count(*) FILTER (WHERE status='done') as done,
            count(*) FILTER (WHERE status='skipped') as skipped,
            count(*) as total
       FROM workouts WHERE user_id=$1`,
    [req.userId]
  );

  const currentGoal = await db.query(
    `SELECT g.id, g.title,
            count(w.*) FILTER (WHERE w.status='done') as done,
            count(w.*) as total
       FROM goals g
       LEFT JOIN workouts w ON w.goal_id = g.id
      WHERE g.user_id=$1 AND g.status='active'
      GROUP BY g.id, g.title`,
    [req.userId]
  );

  const events = await db.query(
    `SELECT count(*) FROM event_participants ep
       JOIN events e ON e.id = ep.event_id
      WHERE ep.user_id=$1`,
    [req.userId]
  );

  res.json({
    overall: overall.rows[0],
    currentGoal: currentGoal.rows[0] || null,
    sharedWorkouts: parseInt(events.rows[0].count, 10)
  });
});

module.exports = router;
