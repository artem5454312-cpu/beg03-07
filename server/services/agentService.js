// Слой ИИ-агента: обычный вызов Claude API (никаких отдельных сервисов/песочниц не нужно),
// но с "инструментами" (tool use) — Claude сам решает, когда вызвать функцию,
// а функция просто пишет строку в твою же таблицу Postgres.
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
const { GLOBAL_CHAT_KEY } = require('../utils/city');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ==== ГЛАВНЫЙ ПРОМПТ АГЕНТА ====
// Меняешь поведение агента — меняешь текст здесь. Перезапуск сервера — и всё применилось.
const SYSTEM_PROMPT = `Ты — персональный AI-тренер по фитнесу и питанию внутри приложения FitPulse.

Стиль: пиши живо, коротко, по-человечески, на "ты". Без канцелярита и шаблонных фраз.
Не выдумывай факты о пользователе, которых он сам не называл в этом разговоре.

ХАРАКТЕР (важно, это черта, а не разовая фраза): ты не бездумный чирлидер. Когда узнаёшь
цель и срок — честно и трезво оцени, насколько это реально (например: "10 кг за 2 недели
физически не похудеть без вреда здоровью, реалистично — 3-4 кг, вот почему"), а не просто
"ты молодец, всё получится". Это касается не только первого сообщения, а вообще всех
ответов: хвали за реальный прогресс, но не хвали авансом и не смягчай неудобную правду
про сроки, нагрузку или нереалистичные ожидания. Честность — не грубость: говори это
по-доброму, как тренер, которому небезразличен результат, а не как критик.

ФОРМАТИРОВАНИЕ ТЕКСТА (обязательно, чтобы было удобно читать с телефона):
- Разбивай ответ на короткие абзацы (пустая строка между ними), а не одну стену текста.
- Важные цифры, сроки и ключевые рекомендации выделяй через **двойные звёздочки**.
- Списки — каждый пункт с новой строки, начиная с "- ".
- Вопросы к пользователю — по одному на строку, коротко.

ГЛАВНОЕ ПРАВИЛО (не нарушай никогда):
Тебе ЗАПРЕЩЕНО писать фразы вроде "отметил", "сохранил", "запланировал", "добавил в план",
"перенёс тренировку", "создал событие" и т.п., если ты в ЭТОМ ЖЕ ответе не вызвал
соответствующий инструмент (update_memory / create_workout / update_workout /
add_workout_result / set_plan_summary / create_event). Обещание "сейчас сделаю" не считается —
вызывай инструмент сразу, в том же ответе, где об этом пишешь. Если инструмент вернул
ok:false — не ври, что получилось, сообщи об ошибке.

ПРАВИЛО ПРО ГОРИЗОНТ ПЛАНИРОВАНИЯ:
Тебе всегда известны сегодняшняя дата, день недели и точное время (по Москве) — используй
время суток уместно (например, не предлагай "завтрак перед тренировкой", если уже вечер).
Если пользователь называет срок —
раздели его на недели и вызови create_workout ОТДЕЛЬНО для КАЖДОЙ тренировки на весь срок,
а не на первые 2-3 дня (16 дней и 3-4 раза в неделю = около 7-9 тренировок). Каждая
тренировка должна быть содержательной ("силовая: верх тела, жим/тяга/плечи + 15 мин кардио",
а не просто "силовая"), и у каждой обязательно указывай difficulty:
"easy" (лёгкая/восстановительная), "medium" (обычная нагрузка) или "hard" (тяжёлая,
нужно постараться — интервалы, темповая, длинная).
ВАЖНОЕ ОГРАНИЧЕНИЕ: если срок длиннее 5-6 недель (например "до 1 сентября" через два
месяца) — НЕ пытайся расписать всё сразу. Распиши только первые 5-6 недель, вызови
set_plan_summary с пометкой, что это первый блок, и явно скажи в тексте, что распишешь
следующие недели позже, когда пользователь снова напишет ("допиши план" или само собой,
когда дойдёт до конца текущего блока). Это нужно, чтобы не упереться в лимит одного ответа.
После — вызови set_plan_summary: 1-3 предложения логики плана отдельным абзацем, и отдельным
абзацем, начинающимся с "**Питание:**" — короткую рекомендацию по питанию под эту цель.

ЕСЛИ ПОЛЬЗОВАТЕЛЬ ПРОСИТ ИЗМЕНИТЬ/ПЕРЕНЕСТИ/СКОРРЕКТИРОВАТЬ уже существующую тренировку
(например "перенеси на завтра", "сделай полегче", "поменяй сегодняшнюю на растяжку") —
используй update_workout, а НЕ create_workout. create_workout — только для тренировок,
которых ещё нет в плане.

ГЛАВНОЕ ПРАВИЛО ПРОТИВ ДРОБЛЕНИЯ ТРЕНИРОВОК (жёсткое, без исключений в рамках одной
сессии): даже если ты расписываешь тренировку в несколько сообщений подряд (например
сначала называешь тип, потом перечисляешь упражнения по одному) — это ВСЁ РАВНО одна
запись в плане. Все упражнения одной тренировочной сессии идут в поле details ОДНОГО
create_workout (каждое упражнение с новой строки через "- "), а type — короткое общее
название сессии ("Силовая: низ тела", а не отдельно "присед", отдельно "жим ногами").
НИКОГДА не вызывай create_workout несколько раз для одной и той же сессии на одну дату —
только один раз с полным списком упражнений в details. Если что-то нужно добавить к уже
созданной тренировке позже — update_workout с details, куда входит и старое, и новое.
Если не уверен, есть ли уже тренировка на нужную дату — сначала вызови list_workouts и
посмотри, что там есть. Исключение — если на дату реально две РАЗНЫЕ по смыслу тренировки
(например утренняя пробежка и вечерняя силовая) — это можно оставить двумя записями,
это не дробление.

ЕСЛИ ПОЛЬЗОВАТЕЛЬ ПРОСИТ СОЗДАТЬ СОБЫТИЕ/СБОР/СОВМЕСТНУЮ ТРЕНИРОВКУ в общем чате
(например "создай событие сегодня в 12:00", "давай соберём пробежку в субботу") — вызови
create_event с названием и датой/временем в формате YYYY-MM-DDTHH:MM. Это отдельное от
личного плана событие — оно появится в общем чате как опрос "Буду / Не буду" для всех
пользователей приложения.

ЕСЛИ ПОЛЬЗОВАТЕЛЬ СТАВИТ НОВУЮ ЦЕЛЬ, ОТЛИЧНУЮ ОТ ПРЕДЫДУЩЕЙ — это отдельный блок плана.
Явно скажи, что это новый план, вызови update_memory с новыми фактами И новым goal_title,
дальше веди его самостоятельно (create_workout привяжет тренировки к новой активной цели).

Задачи:
1. Новый пользователь без цели — В ПЕРВУЮ ОЧЕРЕДЬ (одним из первых 1-2 вопросов) спроси
   уровень подготовки именно в этой теме — новичок, средний или продвинутый/профи — и
   дальше калибруй ПО НЕМУ и глубину плана, и тон общения:
   - Новичок: простой план (бег/ходьба, базовые движения), простой язык без жаргона,
     больше объяснений "зачем", более бережный тон.
   - Средний: разнообразие нагрузок (например для бега — не только темповый/кросс/интервалы,
     но и длинные, восстановительные), меньше объяснений матчасти.
   - Продвинутый/профи: используй профессиональную терминологию и реально разнообразный
     инструментарий — для бега это горки (hill repeats), фартлек, короткие интенсивные
     ускорения (strides), пороговые/темповые, длинные, интервалы разной длины — не только
     3 базовых типа тренировок. Не разжёвывай очевидное, общайся на равных, по существу.
   Дальше остальные вопросы (цель, ограничения по здоровью, доступное время/дни, вес/рост
   если важно для цели, что уже пробовал раньше) — по одному-два за раз, до 6 всего.
   Как только собрал достаточно фактов — в этом же ответе: update_memory (обязательно
   с goal_title — конкретным названием вроде "Похудеть на 10 кг" или "10 км быстрее
   6:00/км", никогда не "Общая цель", и с level) → create_workout на весь срок →
   set_plan_summary. Если в конце срока нужна отдельная неделя (например снижение
   нагрузки/тейпер перед стартом), которую рано расписывать по дням — всё равно создай
   для неё хотя бы один-два плейсхолдера через create_workout с пометкой в details
   "Точный план уточню ближе к дате, по самочувствию" — не оставляй эту неделю пустой
   и невидимой в плане, пользователь должен видеть, что она вообще существует.
2. Пользователь рассказывает, как прошла тренировка, которую он только что сделал — запиши
   через add_workout_result (без указания workout_id — по умолчанию возьмётся последняя
   тренировка, дата которой сегодня или раньше, а НЕ самая дальняя в будущем).
3. Пользователь просит перенести/изменить конкретную тренировку — update_workout.
4. Пользователь просит собрать событие в чате — create_event.
5. Пользователь просит новую цель — update_memory с новыми фактами, вопросы заново.
6. Темы про травмы/боль/хронические болезни — мягко порекомендуй врача, не ставь диагнозов.
7. Если пользователь прислал ФОТО (скриншот из другого приложения — Strava, Apple Health,
   Garmin, часов и т.п. с данными о пробежке/тренировке) — внимательно посмотри на цифры на
   картинке (дистанция, время, темп, пульс, дата) и, если это похоже на реальную тренировку,
   запиши её через create_workout (если такой тренировки ещё нет в плане) или add_workout_result
   (если это отчёт о тренировке, которая уже была запланирована) — с реальными цифрами из
   скриншота в описании, а не выдуманными. Если на фото что-то другое (не спортивные данные) —
   просто опиши, что видишь, и не вызывай инструменты зря.`;

const tools = [
  {
    name: 'update_memory',
    description: 'Сохранить факты о пользователе: цель, уровень подготовки, ограничения по здоровью, доступное время. Передавай полный набор известных фактов. ВАЖНО: как только цель понятна — обязательно передай goal_title (короткое, конкретное название, а не "общая цель").',
    input_schema: {
      type: 'object',
      properties: {
        goal: { type: 'string' },
        goal_title: { type: 'string', description: 'Короткое конкретное название цели для заголовка карточки, например "Похудеть на 10 кг" или "10 км с темпом ниже 6:00". Никогда не "Общая цель".' },
        level: { type: 'string' },
        constraints: { type: 'string' },
        available_time: { type: 'string' }
      }
    }
  },
  {
    name: 'create_workout',
    description: 'Добавить НОВУЮ тренировку в план — она сразу появится на экране "План". Не использовать для изменения уже существующей тренировки — для этого есть update_workout. ОДНА тренировочная сессия = ОДИН вызов create_workout, даже если в ней несколько упражнений — все они идут в details одним списком, а не отдельными вызовами.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Дата в формате YYYY-MM-DD' },
        type: { type: 'string', description: 'Короткое название сессии, например: "Силовая: низ тела", "Бег: интервалы", "Темповый бег"' },
        details: { type: 'string', description: 'Разбивка по упражнениям/отрезкам ВНУТРИ этой одной тренировки, каждый пункт с новой строки через "- " (например "- Присед 3x8\\n- Жим ногами 3x10\\n- Хип-трэст 3x10"). Если тренировка простая и без подпунктов — можно оставить пустым.' },
        difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: 'Сложность тренировки — обязательно указывай' }
      },
      required: ['date', 'type', 'difficulty']
    }
  },
  {
    name: 'update_workout',
    description: 'Изменить дату, описание, состав упражнений и/или сложность уже существующей тренировки (перенос, добавление упражнения, корректировка нагрузки). Если не знаешь workout_id — не указывай, возьмётся ближайшая предстоящая тренировка пользователя. Если пользователь просит добавить упражнение к уже обсуждённой тренировке — пришли details с ПОЛНЫМ обновлённым списком (старые + новое упражнение), а не только новую строку.',
    input_schema: {
      type: 'object',
      properties: {
        workout_id: { type: 'number' },
        date: { type: 'string', description: 'Новая дата YYYY-MM-DD, если нужно перенести' },
        type: { type: 'string', description: 'Новое короткое название сессии, если нужно изменить' },
        details: { type: 'string', description: 'Полный обновлённый список упражнений внутри тренировки, каждый пункт с новой строки через "- "' },
        difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: 'Новая сложность, если меняется нагрузка' }
      }
    }
  },
  {
    name: 'add_workout_result',
    description: 'Записать результат/самочувствие по тренировке и отметить её выполненной. Без workout_id по умолчанию берётся последняя тренировка с датой сегодня или раньше (не будущая).',
    input_schema: {
      type: 'object',
      properties: {
        workout_id: { type: 'number', description: 'Если не знаешь ID — не указывай' },
        notes: { type: 'string' }
      },
      required: ['notes']
    }
  },
  {
    name: 'list_workouts',
    description: 'Посмотреть уже существующие тренировки пользователя (ближайшие ~60 дней) — дата, описание, сложность, статус. Обязательно вызывай перед тем как добавлять/менять тренировки на дни, где что-то уже может быть, чтобы не создать дубликат.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'set_plan_summary',
    description: 'Сохранить короткое описание текущего плана целиком: логика нагрузки отдельным абзацем и питание отдельным абзацем, начинающимся с "**Питание:**". Покажется сверху на экране "План".',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' }
      },
      required: ['summary']
    }
  },
  {
    name: 'create_event',
    description: 'Создать событие-опрос в общем чате приложения (видно всем пользователям, с кнопками "Буду/Не буду").',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Например: Совместная пробежка' },
        event_date: { type: 'string', description: 'Дата и время в формате YYYY-MM-DDTHH:MM' }
      },
      required: ['title', 'event_date']
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

async function getOrCreateGlobalChat() {
  const chat = await db.query(
    `INSERT INTO city_chats (city_name) VALUES ($1)
     ON CONFLICT (city_name) DO UPDATE SET city_name=EXCLUDED.city_name RETURNING id`,
    [GLOBAL_CHAT_KEY]
  );
  return chat.rows[0].id;
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
    if (input.goal_title && input.goal_title.trim()) {
      const goalId = await getActiveGoalId(userId);
      await db.query('UPDATE goals SET title=$1 WHERE id=$2', [input.goal_title.trim(), goalId]);
    }
    return { ok: true, memory: updated };
  }

  if (name === 'create_workout') {
    const goalId = await getActiveGoalId(userId);
    const w = await db.query(
      `INSERT INTO workouts (goal_id, user_id, date, type, status, source, difficulty, details)
       VALUES ($1,$2,$3,$4,'planned','agent',$5,$6) RETURNING id, date, type, difficulty, details`,
      [goalId, userId, input.date, input.type, input.difficulty || 'medium', input.details || null]
    );
    return { ok: true, workout: w.rows[0] };
  }

  if (name === 'update_workout') {
    let workoutId = input.workout_id;
    if (!workoutId) {
      const upcoming = await db.query(
        "SELECT id FROM workouts WHERE user_id=$1 AND status='planned' AND date >= CURRENT_DATE ORDER BY date ASC LIMIT 1",
        [userId]
      );
      workoutId = upcoming.rows[0]?.id;
    }
    if (!workoutId) return { ok: false, error: 'Не нашёл подходящую тренировку для изменения' };
    const r = await db.query(
      `UPDATE workouts SET date=COALESCE($1,date), type=COALESCE($2,type), difficulty=COALESCE($3,difficulty), details=COALESCE($4,details)
       WHERE id=$5 AND user_id=$6 RETURNING id, date, type, difficulty, details`,
      [input.date || null, input.type || null, input.difficulty || null, input.details || null, workoutId, userId]
    );
    if (!r.rows.length) return { ok: false, error: 'Тренировка не найдена' };
    return { ok: true, workout: r.rows[0] };
  }

  if (name === 'add_workout_result') {
    let workoutId = input.workout_id;
    if (!workoutId) {
      // Берём последнюю тренировку с датой сегодня-или-раньше (а не самую дальнюю будущую!) —
      // именно тут раньше был баг: без этого условия хватало самую позднюю дату в плане.
      let last = await db.query(
        "SELECT id FROM workouts WHERE user_id=$1 AND date <= CURRENT_DATE ORDER BY date DESC LIMIT 1",
        [userId]
      );
      if (!last.rows.length) {
        last = await db.query('SELECT id FROM workouts WHERE user_id=$1 ORDER BY date ASC LIMIT 1', [userId]);
      }
      workoutId = last.rows[0]?.id;
    }
    if (!workoutId) return { ok: false, error: 'Нет тренировки для записи результата' };
    const upd = await db.query("UPDATE workouts SET status='done' WHERE id=$1 AND user_id=$2 RETURNING id", [workoutId, userId]);
    if (!upd.rows.length) return { ok: false, error: 'Тренировка не найдена' };
    await db.query('INSERT INTO workout_results (workout_id, notes) VALUES ($1,$2)', [workoutId, input.notes]);
    return { ok: true };
  }

  if (name === 'list_workouts') {
    const r = await db.query(
      `SELECT id, date, type, difficulty, status FROM workouts
        WHERE user_id=$1 AND date >= CURRENT_DATE - INTERVAL '3 days'
        ORDER BY date ASC LIMIT 80`,
      [userId]
    );
    return { ok: true, workouts: r.rows };
  }

  if (name === 'set_plan_summary') {
    const goalId = await getActiveGoalId(userId);
    await db.query('UPDATE goals SET description=$1 WHERE id=$2', [input.summary, goalId]);
    return { ok: true };
  }

  if (name === 'create_event') {
    const chatId = await getOrCreateGlobalChat();
    const r = await db.query(
      `INSERT INTO events (chat_id, creator_id, title, event_date) VALUES ($1,$2,$3,$4) RETURNING id, title, event_date`,
      [chatId, userId, input.title, input.event_date]
    );
    await db.query(
      "INSERT INTO event_participants (event_id, user_id, response) VALUES ($1,$2,'going')",
      [r.rows[0].id, userId]
    );
    return { ok: true, event: r.rows[0] };
  }

  return { ok: false, error: 'unknown tool' };
}

const HISTORY_LIMIT = 20;

// Возвращает сегодняшнюю дату и день недели строго по московскому времени,
// независимо от часового пояса самого сервера (на Railway это обычно UTC).
// Раньше здесь стоял голый new Date().toISOString(), который в UTC — из-за этого
// ночью по Москве агент мог "отставать" на день и путать даты тренировок.
function todayInMoscow() {
  const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' });
  const weekdayFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'long' });
  const timeFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hour12: false });
  const now = new Date();
  return { dateStr: dateFmt.format(now), weekday: weekdayFmt.format(now), timeStr: timeFmt.format(now) };
}

async function sendMessage(userId, userText, opts = {}) {
  const memory = await getMemory(userId);
  const history = await db.query(
    'SELECT role, content FROM agent_messages WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2',
    [userId, HISTORY_LIMIT]
  );
  const recent = history.rows.reverse();

  // Старые фото из истории не пересылаем повторно (дорого по токенам) — только пометка,
  // что тут было фото. Актуальное фото (если есть) идёт полноценно в текущем сообщении ниже.
  const messages = recent.map(m => ({
    role: m.role === 'agent' ? 'assistant' : 'user',
    content: m.content.startsWith('IMG::') ? '[пользователь отправлял фото — детали не сохранены]' : m.content
  }));

  let currentContent = userText || '';
  if (opts.image) {
    currentContent = [
      { type: 'image', source: { type: 'base64', media_type: opts.image.mediaType, data: opts.image.base64 } },
      { type: 'text', text: userText?.trim() ? userText : 'Посмотри на это фото. Если это скриншот тренировки из другого приложения (Strava, Apple Health, Garmin и т.п.) — извлеки данные и добавь тренировку в план.' }
    ];
  }
  messages.push({ role: 'user', content: currentContent });

  const { dateStr, weekday, timeStr } = todayInMoscow();

  const fullSystem = `${SYSTEM_PROMPT}\n\nСЕГОДНЯШНЯЯ ДАТА И ВРЕМЯ (Москва): ${dateStr} (${weekday}), ${timeStr}\n\nПАМЯТЬ О ПОЛЬЗОВАТЕЛЕ (JSON):\n${JSON.stringify(memory)}`;

  const MAX_TOKENS = 8000;
  const MAX_ROUNDS = 20;

  let response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: MAX_TOKENS,
    system: fullSystem,
    tools,
    messages
  });

  let guard = 0;
  let toolsRanAtAll = false;
  // Продолжаем, пока модель либо вызывает инструменты, либо упёрлась в потолок токенов
  // посреди генерации (раньше именно это молча обрывало ответ без текста — тот самый баг).
  while ((response.stop_reason === 'tool_use' || response.stop_reason === 'max_tokens') && guard < MAX_ROUNDS) {
    guard++;
    const toolResults = [];
    let hadToolUse = false;
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        hadToolUse = true;
        toolsRanAtAll = true;
        const result = await executeTool(userId, block.name, block.input);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      }
    }
    messages.push({ role: 'assistant', content: response.content });

    if (hadToolUse) {
      messages.push({ role: 'user', content: toolResults });
    } else {
      // Упёрлись в лимит токенов без единого завершённого вызова инструмента —
      // просим модель кратко подытожить то, что уже сделано, вместо того чтобы зависнуть.
      messages.push({ role: 'user', content: 'Заверши мысль коротким итоговым сообщением прямо сейчас.' });
    }

    response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: MAX_TOKENS,
      system: fullSystem,
      tools,
      messages
    });
  }

  const textBlock = response.content.find(b => b.type === 'text');
  if (textBlock) return textBlock.text;

  // Финального текста всё равно нет (редкий случай, план был очень длинным) —
  // не показываем пользователю сырую техническую ошибку, а даём осмысленный ответ.
  return toolsRanAtAll
    ? 'Готово — часть плана уже записана, глянь на экране «План». Если нужно продолжить дальше по срокам, просто напиши мне ещё раз.'
    : 'Не получилось сформулировать ответ с первого раза — попробуй переспросить чуть короче.';
}

module.exports = { sendMessage, getMemory };
