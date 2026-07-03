const jwt = require('jsonwebtoken');

// Проверяет access-токен из заголовка Authorization: Bearer <токен>
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Нет токена доступа. Войдите заново.' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Токен недействителен или истёк.' });
  }
}

// Отдельная проверка для админ-панели (свой пароль, не связан с пользователями)
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Нет доступа.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET + '_admin');
    if (!payload.admin) throw new Error('not admin');
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Нет доступа.' });
  }
}

module.exports = { requireAuth, requireAdmin };
