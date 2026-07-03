// WebSocket-слой: городской чат и личные диалоги в реальном времени.
// Клиент подключается так: wss://.../ws?token=<accessToken>&room=city:5  или room=dm:12
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const db = require('./db');

function attachWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const rooms = new Map(); // roomKey -> Set(ws)

  function joinRoom(roomKey, ws) {
    if (!rooms.has(roomKey)) rooms.set(roomKey, new Set());
    rooms.get(roomKey).add(ws);
  }
  function leaveRoom(roomKey, ws) {
    rooms.get(roomKey)?.delete(ws);
  }
  function broadcast(roomKey, data) {
    const set = rooms.get(roomKey);
    if (!set) return;
    const msg = JSON.stringify(data);
    for (const client of set) {
      if (client.readyState === 1) client.send(msg);
    }
  }

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const room = url.searchParams.get('room'); // "city:5" или "dm:12"

    let userId;
    try {
      userId = jwt.verify(token, process.env.JWT_SECRET).userId;
    } catch {
      ws.close(4001, 'bad token');
      return;
    }
    if (!room) { ws.close(4002, 'no room'); return; }

    ws.userId = userId;
    ws.room = room;
    joinRoom(room, ws);

    ws.on('message', async (raw) => {
      let data;
      try { data = JSON.parse(raw); } catch { return; }
      if (data.type !== 'message' || !data.content?.trim()) return;

      const [kind, id] = room.split(':');
      let saved;
      if (kind === 'city') {
        const r = await db.query(
          'INSERT INTO chat_messages (chat_id, user_id, content) VALUES ($1,$2,$3) RETURNING id, content, created_at',
          [id, userId, data.content]
        );
        saved = r.rows[0];
      } else if (kind === 'dm') {
        const r = await db.query(
          'INSERT INTO direct_messages (direct_chat_id, sender_id, content) VALUES ($1,$2,$3) RETURNING id, content, created_at',
          [id, userId, data.content]
        );
        saved = r.rows[0];
      } else {
        return;
      }

      const author = await db.query(
        `SELECT u.username, p.name, p.photo_url FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=$1`,
        [userId]
      );

      broadcast(room, {
        type: 'message',
        id: saved.id,
        content: saved.content,
        created_at: saved.created_at,
        user_id: userId,
        username: author.rows[0]?.username,
        name: author.rows[0]?.name,
        photo_url: author.rows[0]?.photo_url
      });
    });

    ws.on('close', () => leaveRoom(room, ws));
  });

  return wss;
}

module.exports = { attachWebSocket };
