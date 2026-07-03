// Разовый скрипт: создаёт все таблицы, если их ещё нет.
// Запускать: node server/initDb.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('База данных готова: все таблицы созданы (или уже существовали).');
  await pool.end();
}

run().catch((err) => {
  console.error('Ошибка при создании таблиц:', err);
  process.exit(1);
});
