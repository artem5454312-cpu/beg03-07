// Единая точка подключения к базе данных.
// DATABASE_URL берётся из .env (см. .env.example)
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false
});

// Railway по умолчанию держит базу в UTC. Чтобы CURRENT_DATE и "сегодня" в фоновых
// задачах совпадали с реальным днём в Москве (а не сдвигались ночью на сутки), фиксируем
// часовой пояс сессии на каждом новом соединении из пула.
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'Europe/Moscow'").catch((e) => console.error('Не удалось выставить часовой пояс сессии БД:', e));
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
