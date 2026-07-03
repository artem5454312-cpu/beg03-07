// Приводит название города к одному виду для сравнения (пока используется только для профиля).
function normalizeCity(city) {
  return (city || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Единый общий чат для вообще всех зарегистрированных пользователей — не по городам.
const GLOBAL_CHAT_KEY = '__global__';

module.exports = { normalizeCity, GLOBAL_CHAT_KEY };
