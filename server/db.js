// Единая точка подключения к базе данных.
// DATABASE_URL берётся из .env (см. .env.example)
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
