// Слой ИИ-агента: обычный вызов Claude API (никаких отдельных сервисов/песочниц не нужно),
// но с "инструментами" (tool use) — Claude сам решает, когда вызвать функцию,
// а функция просто пишет строку в твою же таблицу Postgres.
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ==== ГЛАВНЫЙ ПРОМПТ АГЕНТА ====
// Меняешь поведение агента — меняешь текст здесь. Перезапуск сервера — и всё применилось.
const SYSTEM_PROMPT = `Ты — персональный AI-тренер по фитнесу и питанию внутри приложения FitPulse.

Стиль: пиши живо, коротко, по-человечески, на "ты". Без канцелярита и шаблонных фраз.
Не выдумывай факты о пользователе, которых он сам не называл в этом разговоре.

ФОРМАТИРОВАНИЕ ТЕКСТА (обязательно, чтобы было удобно читать с телефона):
- Разбивай ответ на короткие абзацы (пустая строка между ними), а не одну стену текста.
- Важные цифры, сроки и ключевые рекомендации выделяй через **двойные звёздочки** — это
  превращается в жирный текст в приложении.
- Если перечисляешь несколько пунктов (вопросы, продукты, дни) — каждый с новой строки,
  начиная с "- ", а не всё подряд через точку с запятой в одном предложении.
- Вопросы к пользователю задавай по одному на строку, коротко, без длинных вступлений.

ГЛАВНОЕ ПРАВИЛО (не нарушай никогда):
Тебе ЗАПРЕЩЕНО писать фразы вроде "сохранил", "запомнил", "запланировал тренировки",
"добавил в план", "записал результат" и т.п., если ты в ЭТОМ ЖЕ ответе не вызвал
соответствующий инструмент (update_memory / create_workout / add_workout_result / set_plan_summary).
Если ты не вызвал инструмент — не утверждай, что действие выполнено. Обещание "сейчас сделаю"
не считается: делай сразу, вызовом инструмента, в том же ответе, где об этом пишешь.

ПРАВИЛО ПРО ГОРИЗОНТ ПЛАНИРОВАНИЯ:
Тебе всегда известны сегодняшняя дата и день недели (см. ниже). Если пользователь называет
срок (например "у меня 16 дней", "распиши на 2 недели", "на месяц") — ты обязан вызвать
create_workout ОТДЕЛЬНО для КАЖДОЙ тренировки на ВЕСЬ этот срок, а не на первые 2-3 дня.
Считай так: раздели срок на недели, в каждой неделе поставь тренировки в дни, которые
пользователь назвал доступными (или разумно распредели, если дни не уточнены — не подряд,
хотя бы через день, с учётом дня недели), и вызови create_workout для каждой даты отдельно.
16 дней и 3-4 раза в неделю — это значит около 7-9 тренировок, а не 3. Всегда считай реальное
количество тренировок = (срок в неделях) × (раз в неделю) и вызови create_workout ровно
столько раз. Каждая тренировка в create_workout должна быть содержательной, не одним словом:
например "силовая (верх тела: жим, тяга, плечи) + 15 мин кардио", а не просто "силовая".
После того как расписал все тренировки, вызови set_plan_summary с коротким текстом
(1-3 предложения), что за план и на сколько дней — он покажется пользователю в приложении
сверху на экране "План".

ЕСЛИ ПОЛЬЗОВАТЕЛЬ СТАВИТ НОВУЮ ЦЕЛЬ, ОТЛИЧНУЮ ОТ ПРЕДЫДУЩЕЙ (например раньше был бег,
теперь зал) — это отдельный блок плана, он не должен смешиваться со старыми тренировками
в голове пользователя. Явно скажи в тексте, что это новый, отдельный план, и дальше веди
его как самостоятельный набор тренировок (create_workout всё равно автоматически привяжет
их к новой активной цели после того как ты вызвал update_memory с новыми фактами).

Задачи:
1. Если пользователь новый и цели не обсуждались — задай по очереди 3-5 вопросов: цель,
   уровень подготовки, ограничения по здоровью, сколько времени/дней есть на тренировки.
   Как только получил ответы — В ЭТОМ ЖЕ ОТВЕТЕ вызови update_memory с фактами, затем
   создай через create_workout ВСЕ тренировки на весь заявленный срок (см. правило выше),
   затем вызови set_plan_summary. Не пиши "запланирую позже" — делай сразу.
2. Если пользователь рассказывает, как прошла тренировка — расспроси про самочувствие и нагрузку,
   запиши результат через add_workout_result, и при необходимости добавь следующую тренировку
   через create_workout (скорректировав нагрузку) — тоже сразу, в этом же ответе.
3. Если пользователь просит новую цель — вызови update_memory с новыми фактами и начни вопросы заново.
4. Темы про травмы/боль/хронические болезни — мягко порекомендуй врача, не ставь диагнозов.
5. Всегда, когда в разговоре появляется дата и тип тренировки — сразу вызывай create_workout,
   а не просто описывай план текстом. Пользователь должен увидеть тренировку в приложении сама,
   без ручного переноса.`;

const tools = [
  {
    name: 'update_memory',
    description: 'Сохранить факты о пользователе: цель, уровень подготовки, ограничения по здоровью, доступное время. Передавай полный набор известных фактов.',
    input_schema: {
      type: 'object',
      properties: {
        goal: { type: 'string' },
        level: { type: 'string' },
        constraints: { type: 'string' },
        available_time: { type: 'string' }
      }
    }
  },
  {
    name: 'create_workout',
    description: 'Добавить тренировку в план пользователя — она сразу появится в приложении на экране "План".',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Дата в формате YYYY-MM-DD' },
        type: { type: 'string', description: 'Например: бег, силовая, растяжка' }
      },
      required: ['date', 'type']
    }
  },
  {
    name: 'add_workout_result',
    description: 'Записать результат/самочувствие по тренировке пользователя и отметить её выполненной.',
    input_schema: {
      type: 'object',
      properties: {
        workout_id: { type: 'number', description: 'Если не знаешь ID — не указывай, возьмётся последняя тренировка' },
        notes: { type: 'string' }
      },
      required: ['notes']
    }
  },
  {
    name: 'set_plan_summary',
    description: 'Сохранить короткое текстовое описание текущего плана целиком: на сколько дней, логика нагрузки, и 1 короткая рекомендация по питанию под эту цель. Используй **жирный** для ключевых цифр и переносы строк между мыслями. Покажется пользователю сверху на экране "План".',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' }
      },
      required: ['summary']
    }
  }
];

async function getMemory(userId) {
  const r = await db.query('SELECT data FROM agent_memory WHERE user_id=$1', [userId]);
  return r.rows[0]?.data || {};
}

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

async function executeTool(userId, name, input) {
  if (name === 'update_memory') {
    const current = await getMemory(userId);
    const updated = { ...current, ...input };
    await db.query(
      `INSERT INTO agent_memory (user_id, data, updated_at) VALUES ($1,$2, now())
       ON CONFLICT (user_id) DO UPDATE SET data=$2, updated_at=now()`,
      [userId, updated]
    );
    return { ok: true, memory: updated };
  }

  if (name === 'create_workout') {
    const goalId = await getActiveGoalId(userId);
    const w = await db.query(
      `INSERT INTO workouts (goal_id, user_id, date, type, status, source)
       VALUES ($1,$2,$3,$4,'planned','agent') RETURNING id, date, type`,
      [goalId, userId, input.date, input.type]
    );
    return { ok: true, workout: w.rows[0] };
  }

  if (name === 'add_workout_result') {
    let workoutId = input.workout_id;
    if (!workoutId) {
      const last = await db.query(
        'SELECT id FROM workouts WHERE user_id=$1 ORDER BY date DESC LIMIT 1',
        [userId]
      );
      workoutId = last.rows[0]?.id;
    }
    if (!workoutId) return { ok: false, error: 'Нет тренировки для записи результата' };
    await db.query("UPDATE workouts SET status='done' WHERE id=$1", [workoutId]);
    await db.query('INSERT INTO workout_results (workout_id, notes) VALUES ($1,$2)', [workoutId, input.notes]);
    return { ok: true };
  }

  if (name === 'set_plan_summary') {
    const goalId = await getActiveGoalId(userId);
    await db.query('UPDATE goals SET description=$1 WHERE id=$2', [input.summary, goalId]);
    return { ok: true };
  }

  return { ok: false, error: 'unknown tool' };
}

const HISTORY_LIMIT = 20;
const WEEKDAYS_RU = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

async function sendMessage(userId, userText) {
  const memory = await getMemory(userId);
  const history = await db.query(
    'SELECT role, content FROM agent_messages WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2',
    [userId, HISTORY_LIMIT]
  );
  const recent = history.rows.reverse();

  const messages = [
    ...recent.map(m => ({ role: m.role === 'agent' ? 'assistant' : 'user', content: m.content })),
    { role: 'user', content: userText }
  ];

  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);
  const weekday = WEEKDAYS_RU[today.getDay()];

  const fullSystem = `${SYSTEM_PROMPT}\n\nСЕГОДНЯШНЯЯ ДАТА: ${dateStr} (${weekday})\n\nПАМЯТЬ О ПОЛЬЗОВАТЕЛЕ (JSON):\n${JSON.stringify(memory)}`;

  let response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4000,
    system: fullSystem,
    tools,
    messages
  });

  let guard = 0;
  while (response.stop_reason === 'tool_use' && guard < 8) {
    guard++;
    const toolResults = [];
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const result = await executeTool(userId, block.name, block.input);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      }
    }
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 4000,
      system: fullSystem,
      tools,
      messages
    });
  }

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock ? textBlock.text : '(агент не вернул текстовый ответ)';
}

module.exports = { sendMessage, getMemory };
