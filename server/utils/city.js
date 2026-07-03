// Приводит название города к одному виду для сравнения,
// чтобы "Алматы", "алматы" и "  Алматы " попадали в один и тот же городской чат.
function normalizeCity(city) {
  return (city || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

module.exports = { normalizeCity };
