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
      const [kind, id] = room.split(':');

      if (data.type === 'message' && data.content?.trim()) {
        let saved;
        if (kind === 'city') {
          const isMember = await db.query(
            'SELECT 1 FROM city_chat_members WHERE chat_id=$1 AND user_id=$2',
            [id, userId]
          );
          if (!isMember.rows.length) {
            ws.send(JSON.stringify({ type: 'error', error: 'Сначала вступи в чат.' }));
            return;
          }
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
        return;
      }

      // Редактирование, удаление и реакции сейчас поддержаны только в общем чате
      if (kind !== 'city') return;

      if (data.type === 'edit' && data.id && typeof data.content === 'string' && data.content.trim()) {
        const r = await db.query(
          'UPDATE chat_messages SET content=$1 WHERE id=$2 AND user_id=$3 AND chat_id=$4 RETURNING id, content',
          [data.content, data.id, userId, id]
        );
        if (r.rows.length) broadcast(room, { type: 'edit', id: r.rows[0].id, content: r.rows[0].content });
        return;
      }

      if (data.type === 'delete' && data.id) {
        const r = await db.query(
          'DELETE FROM chat_messages WHERE id=$1 AND user_id=$2 AND chat_id=$3 RETURNING id',
          [data.id, userId, id]
        );
        if (r.rows.length) broadcast(room, { type: 'delete', id: r.rows[0].id });
        return;
      }

      if (data.type === 'react' && data.id && typeof data.emoji === 'string' && data.emoji) {
        const emoji = data.emoji.slice(0, 8);
        const existing = await db.query(
          'SELECT emoji FROM message_reactions WHERE message_id=$1 AND user_id=$2',
          [data.id, userId]
        );
        if (existing.rows.length && existing.rows[0].emoji === emoji) {
          // Повторный тап по своей же реакции — снимаем её
          await db.query('DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2', [data.id, userId]);
        } else {
          await db.query(
            `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)
             ON CONFLICT (message_id, user_id) DO UPDATE SET emoji=EXCLUDED.emoji`,
            [data.id, userId, emoji]
          );
        }
        const agg = await db.query(
          `SELECT emoji, count(*)::int AS count, array_agg(user_id) AS user_ids
             FROM message_reactions WHERE message_id=$1 GROUP BY emoji`,
          [data.id]
        );
        broadcast(room, {
          type: 'reactions',
          id: data.id,
          reactions: agg.rows.map(r => ({ emoji: r.emoji, count: r.count, userIds: r.user_ids }))
        });
        return;
      }
    });

    ws.on('close', () => leaveRoom(room, ws));
  });

  return wss;
}

module.exports = { attachWebSocket };
