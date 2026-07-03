// Простой роутер на хэшах + рендер экранов в #app.
// Никаких фреймворков — чистый JS, чтобы было легко читать и менять.

const state = { regToken: null };

function showToast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function showModal(innerHtml) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = `<div class="modal-card"><button class="modal-close" aria-label="Закрыть"></button>${innerHtml}</div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  overlay.querySelector('.modal-close').onclick = closeModal;
  document.body.appendChild(overlay);
  return overlay;
}
function closeModal() {
  if (window.__timerInterval) { clearInterval(window.__timerInterval); window.__timerInterval = null; }
  document.getElementById('modalOverlay')?.remove();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Лёгкое форматирование текста агента: **жирный**, абзацы, списки через "- ".
function formatAgentText(raw) {
  const escaped = escapeHtml(raw);
  const paragraphs = escaped.split(/\n{2,}/);
  return paragraphs.map(block => {
    const lines = block.split('\n').filter(l => l.trim().length);
    if (!lines.length) return '';
    const isList = lines.every(l => /^[-•]\s+/.test(l.trim()));
    if (isList) {
      return '<ul>' + lines.map(l => `<li>${boldify(l.trim().replace(/^[-•]\s+/, ''))}</li>`).join('') + '</ul>';
    }
    return `<p>${lines.map(boldify).join('<br>')}</p>`;
  }).join('');
}
function boldify(s) { return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }

function avatarHtml(name, username, photoUrl) {
  if (photoUrl) return `<div class="avatar"><img src="${photoUrl}" alt=""></div>`;
  const letter = (name || username || '?').trim().charAt(0).toUpperCase() || '?';
  return `<div class="avatar">${letter}</div>`;
}

const SEND_ICON = '<path d="M3 11l18-7-7 18-2.5-7.5L3 11z"/>';

/* ---------------- SHELL ---------------- */

const TAB_ICONS = {
  agent: '<circle cx="12" cy="11" r="8"/><path d="M9 11h.01M12 11h.01M15 11h.01"/>',
  plan: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  chats: '<circle cx="9" cy="9" r="3.2"/><circle cx="16.5" cy="10.5" r="2.6"/><path d="M3.5 19c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/>'
};

function renderShell(activeTab) {
  const tabs = ['agent', 'plan', 'chats', 'profile'];
  document.getElementById('app').innerHTML = `
    <div class="topbar">
      <span class="mark">AI Тренер</span>
      <button class="btn ghost" id="logoutBtn" style="padding:6px 10px;">Выйти</button>
    </div>
    <main id="main"></main>
    <div class="tabbar">
      ${tabs.map(id => `
        <button data-tab="${id}" aria-label="${id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TAB_ICONS[id]}</svg>
        </button>`).join('')}
    </div>
  `;
  document.querySelectorAll('.tabbar button').forEach(b => {
    if (b.dataset.tab === activeTab) b.classList.add('active');
    b.onclick = () => location.hash = '#/' + b.dataset.tab;
  });
  document.getElementById('logoutBtn').onclick = async () => {
    await Api.post('/auth/logout');
    location.hash = '#/login';
  };
}

/* ---------------- AUTH SCREENS ---------------- */

function viewPromo() {
  document.getElementById('app').innerHTML = `
    <div class="auth-wrap"><div class="auth-card">
      <div class="eyebrow" style="opacity:.5;">Приложение в разработке</div>
      <h1 class="display screen-title">Введите PIN</h1>
      <p class="screen-sub">Доступ пока только по PIN-коду от команды разработки.</p>
      <div id="err" class="error-box"></div>
      <div class="field"><input id="code" class="pin-input" type="tel" inputmode="numeric" maxlength="4" autocomplete="off"></div>
      <button class="btn block" id="go">Продолжить</button>
      <p style="margin-top:16px;"><a href="#/login" class="eyebrow">Уже есть аккаунт →</a></p>
    </div></div>`;
  document.getElementById('go').onclick = async () => {
    try {
      const r = await Api.post('/auth/promo', { code: document.getElementById('code').value });
      state.regToken = r.regToken;
      location.hash = '#/register';
    } catch (e) { document.getElementById('err').textContent = e.message; }
  };
}

function viewLogin() {
  document.getElementById('app').innerHTML = `
    <div class="auth-wrap"><div class="auth-card">
      <h1 class="display screen-title">Вход</h1>
      <div id="err" class="error-box"></div>
      <div class="field"><label>Логин</label><input id="u" type="text"></div>
      <div class="field"><label>Пароль</label><input id="p" type="password"></div>
      <button class="btn block" id="go">Войти</button>
      <p style="margin-top:16px;"><a href="#/promo" class="eyebrow">Нет аккаунта →</a></p>
    </div></div>`;
  document.getElementById('go').onclick = async () => {
    try {
      const r = await Api.post('/auth/login', {
        username: document.getElementById('u').value,
        password: document.getElementById('p').value
      });
      Api.setToken(r.accessToken);
      Api.setUserId(r.userId);
      location.hash = '#/agent';
    } catch (e) { document.getElementById('err').textContent = e.message; }
  };
}

function viewRegister() {
  if (!state.regToken) { location.hash = '#/promo'; return; }
  document.getElementById('app').innerHTML = `
    <div class="auth-wrap"><div class="auth-card">
      <h1 class="display screen-title">Аккаунт</h1>
      <div id="err" class="error-box"></div>
      <div class="field">
        <label>Имя пользователя</label>
        <input id="u" type="text">
        <div class="hint" id="uHint"></div>
      </div>
      <div class="field"><label>Пароль (мин. 6 символов)</label><input id="p" type="password"></div>
      <button class="btn block" id="go">Создать аккаунт</button>
    </div></div>`;
  const uField = document.getElementById('u');
  let timer;
  uField.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!uField.value) return;
      const r = await Api.get('/auth/username-available?username=' + encodeURIComponent(uField.value));
      const hint = document.getElementById('uHint');
      hint.textContent = r.available ? 'Свободно' : 'Занято';
      hint.className = 'hint ' + (r.available ? 'ok' : 'err');
    }, 350);
  };
  document.getElementById('go').onclick = async () => {
    try {
      const r = await Api.post('/auth/register', {
        regToken: state.regToken,
        username: uField.value,
        password: document.getElementById('p').value
      });
      Api.setToken(r.accessToken);
      Api.setUserId(r.userId);
      location.hash = '#/onboarding';
    } catch (e) { document.getElementById('err').textContent = e.message; }
  };
}

function viewOnboarding() {
  document.getElementById('app').innerHTML = `
    <div class="auth-wrap"><div class="auth-card">
      <h1 class="display screen-title">Профиль</h1>
      <p class="screen-sub">Это увидят в городском чате.</p>
      <div class="field"><label>Имя</label><input id="name" type="text"></div>
      <div class="field"><label>Профессия (необязательно)</label><input id="profession" type="text"></div>
      <div class="field"><label>Пол</label>
        <select id="gender"><option value="">Не указывать</option><option>Женский</option><option>Мужской</option></select>
      </div>
      <div class="field"><label>Город</label><input id="city" type="text" placeholder="Например: Алматы"></div>
      <button class="btn block" id="go">Готово → к агенту</button>
    </div></div>`;
  document.getElementById('go').onclick = async () => {
    await Api.post('/auth/profile-setup', {
      name: document.getElementById('name').value,
      profession: document.getElementById('profession').value,
      gender: document.getElementById('gender').value,
      city: document.getElementById('city').value
    });
    location.hash = '#/agent';
  };
}

/* ---------------- AGENT ---------------- */

async function viewAgent() {
  renderShell('agent');
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="chat-toolbar">
      <button id="newGoal">+ Новая цель</button>
      <button id="clearChat">Очистить диалог</button>
    </div>
    <div class="chat-log" id="log"></div>
    <div class="chat-input">
      <textarea id="text" placeholder="Напиши агенту…"></textarea>
      <button class="btn icon" id="send" aria-label="Отправить"><svg viewBox="0 0 24 24" fill="currentColor">${SEND_ICON}</svg></button>
    </div>`;

  function scrollLogToBottom() {
    document.getElementById('main').scrollTop = document.getElementById('main').scrollHeight;
  }

  async function loadHistory() {
    const msgs = await Api.get('/agent/messages');
    const log = document.getElementById('log');
    log.innerHTML = msgs.map(m => `<div class="msg ${m.role}">${m.role === 'agent' ? formatAgentText(m.content) : escapeHtml(m.content)}</div>`).join('')
      || '<p class="screen-sub">Пока пусто — напиши что-нибудь, чтобы агент начал знакомство.</p>';
    scrollLogToBottom();
  }
  await loadHistory();

  document.getElementById('send').onclick = async () => {
    const ta = document.getElementById('text');
    const content = ta.value.trim();
    if (!content) return;
    ta.value = '';
    const log = document.getElementById('log');
    log.innerHTML += `<div class="msg user">${escapeHtml(content)}</div>`;
    log.innerHTML += `<div class="msg agent" id="pending">…</div>`;
    scrollLogToBottom();
    try {
      const reply = await Api.post('/agent/messages', { content });
      document.getElementById('pending').outerHTML = `<div class="msg agent">${formatAgentText(reply.content)}</div>`;
    } catch (e) {
      document.getElementById('pending').outerHTML = `<div class="msg agent">Ошибка: ${escapeHtml(e.message)}</div>`;
    }
    scrollLogToBottom();
  };

  document.getElementById('newGoal').onclick = async () => {
    await Api.post('/agent/new-goal', {});
    showToast('Начинаем новую цель');
    loadHistory();
  };
  document.getElementById('clearChat').onclick = async () => {
    if (!confirm('Очистить ленту диалога? Память о тебе агент не забудет.')) return;
    await Api.del('/agent/messages');
    loadHistory();
  };
}

/* ---------------- PLAN ---------------- */

function statusLabel(s) { return { planned: 'В процессе', done: 'Выполнено', skipped: 'Пропущено', cancelled: 'Отменено' }[s] || s; }
function nextStatus(s) { return s === 'planned' ? 'done' : s === 'done' ? 'skipped' : 'planned'; }

const MONTHS_RU = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const WEEKDAYS_RU = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
function formatDateHuman(dateStr) {
  const d = new Date(dateStr + (dateStr.length <= 10 ? 'T00:00:00' : ''));
  return { date: `${d.getDate()} ${MONTHS_RU[d.getMonth()]}`, weekday: WEEKDAYS_RU[d.getDay()] };
}

// Пытаемся вытащить примерную длительность (в минутах) из текста тренировки для таймера
function guessMinutes(typeText) {
  const m = String(typeText).match(/(\d{1,3})\s*мин/);
  if (m) return Math.min(180, parseInt(m[1], 10));
  return 30;
}

async function viewPlan() {
  renderShell('plan');
  const main = document.getElementById('main');
  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;">
      <h1 class="display screen-title">План</h1>
      <button class="btn" id="addBtn">+ Добавить</button>
    </div>
    <p class="screen-sub">Тренировки собраны блоками — по каждой цели свой набор.</p>
    <div id="blocks"></div>`;

  let cachedGoals = [];

  async function load() {
    const goals = await Api.get('/plan/overview');
    cachedGoals = goals;
    const box = document.getElementById('blocks');
    if (!goals.length) {
      box.innerHTML = '<p class="screen-sub">Пока нет ни одного плана — напиши агенту, и он его составит.</p>';
      return;
    }

    box.innerHTML = goals.map(g => {
      const done = g.workouts.filter(w => w.status === 'done').length;
      const range = g.workouts.length
        ? `${g.workouts[0].date.slice(0,10)} → ${g.workouts[g.workouts.length-1].date.slice(0,10)}`
        : '';
      return `
      <div class="plan-block ${g.status === 'archived' ? 'archived' : ''}" data-goal="${g.id}">
        <div class="plan-block-head">
          <div class="info">
            <div class="eyebrow">${g.status === 'active' ? 'Текущий план' : 'Архив'} ${range ? '· ' + range : ''}</div>
            <div class="title">${escapeHtml(g.title || 'Общая цель')}</div>
            ${g.description ? `<div class="desc">${formatAgentText(g.description)}</div>` : ''}
          </div>
          <div style="display:flex;gap:4px;align-items:center;">
            <span class="eyebrow" style="white-space:nowrap;">${done}/${g.workouts.length}</span>
            <button class="icon-btn delete-block" data-goal="${g.id}" title="Удалить блок">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>
            </button>
          </div>
        </div>
        ${g.workouts.map((w, i) => {
          const dh = formatDateHuman(w.date);
          return `
          <div class="lap-row" data-workout="${w.id}">
            <div class="lap-num mono">${String(i + 1).padStart(2, '0')}</div>
            <div>
              <div class="lap-title">${escapeHtml(w.type)}</div>
              <div class="lap-meta">${w.source === 'agent' ? 'агент' : 'вручную'}</div>
            </div>
            <div class="lap-right">
              <div class="lap-date">${dh.date}</div>
              <div class="lap-weekday">(${dh.weekday})</div>
              <button class="status-pill" data-id="${w.id}" data-status="${w.status}">${statusLabel(w.status)}</button>
            </div>
          </div>`;
        }).join('') || '<p class="screen-sub" style="padding:8px 4px;">В этом блоке пока нет тренировок.</p>'}
      </div>`;
    }).join('');

    box.querySelectorAll('.status-pill').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const next = nextStatus(btn.dataset.status);
        await Api.patch('/plan/workouts/' + btn.dataset.id, { status: next });
        load();
      };
    });

    box.querySelectorAll('.delete-block').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm('Удалить весь этот блок тренировок? Отменить будет нельзя.')) return;
        await Api.del('/plan/goals/' + btn.dataset.goal);
        load();
      };
    });

    box.querySelectorAll('.lap-row').forEach(row => {
      row.onclick = () => openWorkoutDetail(row.dataset.workout);
    });
  }

  function findWorkout(workoutId) {
    for (const g of cachedGoals) {
      const found = g.workouts.find(w => String(w.id) === String(workoutId));
      if (found) return { workout: found, goalTitle: g.title };
    }
    return null;
  }

  function openWorkoutDetail(workoutId) {
    const hit = findWorkout(workoutId);
    if (!hit) return;
    const { workout, goalTitle } = hit;
    showModal(`
      <div class="eyebrow" style="margin-bottom:6px;">${escapeHtml(goalTitle || 'План')}</div>
      <h2>${escapeHtml(workout.type)}</h2>
      <p class="screen-sub" style="margin:4px 0 16px;">${workout.date.slice(0,10)} · ${statusLabel(workout.status)}</p>
      ${workout.notes ? `<div class="card" style="box-shadow:none;"><div class="eyebrow" style="margin-bottom:6px;">Заметка</div><p>${escapeHtml(workout.notes)}</p></div>` : ''}
      <button class="btn accent-lg" id="startWorkout" style="margin-top:6px;">Начать тренировку</button>
      <button class="btn ghost block" id="deleteWorkout" style="margin-top:10px;color:var(--brick);border-color:var(--brick);">Удалить эту тренировку</button>
    `);
    document.getElementById('startWorkout').onclick = () => openWorkoutTimer(workout);
    document.getElementById('deleteWorkout').onclick = async () => {
      if (!confirm('Удалить эту тренировку?')) return;
      await Api.del('/plan/workouts/' + workout.id);
      closeModal();
      load();
    };
  }

  function openWorkoutTimer(workout) {
    let totalSeconds = guessMinutes(workout.type) * 60;
    let remaining = totalSeconds;
    let running = false;

    const overlay = showModal(`
      <div class="eyebrow" style="text-align:center;">Сейчас</div>
      <p class="timer-now">${escapeHtml(workout.type)}</p>
      <div class="timer-display" id="timerNum">${fmtTime(remaining)}</div>
      <div class="timer-adjust">
        <button id="minus">−1 мин</button>
        <button id="plus">+1 мин</button>
      </div>
      <div class="timer-controls">
        <button class="btn" id="toggle">Старт</button>
        <button class="btn ghost" id="finish">Завершить</button>
      </div>
    `);

    function render() { overlay.querySelector('#timerNum').textContent = fmtTime(remaining); }

    overlay.querySelector('#minus').onclick = () => { remaining = Math.max(0, remaining - 60); render(); };
    overlay.querySelector('#plus').onclick = () => { remaining += 60; render(); };

    const toggleBtn = overlay.querySelector('#toggle');
    toggleBtn.onclick = () => {
      running = !running;
      toggleBtn.textContent = running ? 'Пауза' : 'Продолжить';
      if (running) {
        window.__timerInterval = setInterval(() => {
          if (remaining <= 0) { clearInterval(window.__timerInterval); running = false; toggleBtn.textContent = 'Старт'; showToast('Время вышло!'); return; }
          remaining -= 1;
          render();
        }, 1000);
      } else {
        clearInterval(window.__timerInterval);
      }
    };

    overlay.querySelector('#finish').onclick = async () => {
      clearInterval(window.__timerInterval);
      await Api.patch('/plan/workouts/' + workout.id, { status: 'done' });
      closeModal();
      showToast('Тренировка завершена 💪');
      load();
    };
  }

  function fmtTime(totalSeconds) {
    const s = Math.max(0, totalSeconds);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  await load();

  document.getElementById('addBtn').onclick = async () => {
    const type = prompt('Тип тренировки (например: бег)');
    if (!type) return;
    const date = prompt('Дата (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
    if (!date) return;
    await Api.post('/plan/workouts', { type, date });
    load();
  };
}

/* ---------------- CHATS ---------------- */

let ws;
async function viewChats() {
  renderShell('chats');
  const main = document.getElementById('main');
  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
      <h1 class="display screen-title">Общий чат</h1>
      <button class="btn" id="addEvent">+ Событие</button>
    </div>
    <div id="events"></div>
    <div class="chat-log" id="log"></div>
    <div class="chat-input">
      <textarea id="text" placeholder="Написать в чат…"></textarea>
      <button class="btn icon" id="send" aria-label="Отправить"><svg viewBox="0 0 24 24" fill="currentColor">${SEND_ICON}</svg></button>
    </div>`;

  async function loadEvents() {
    const events = await Api.get('/chats/city/events');
    const box = document.getElementById('events');
    if (!events.length) { box.innerHTML = ''; return; }
    box.innerHTML = events.map(ev => {
      const total = ev.going.length + ev.notGoing.length;
      const pct = total ? Math.round((ev.going.length / total) * 100) : 0;
      const d = new Date(ev.event_date);
      const when = `${d.getDate()} ${MONTHS_RU[d.getMonth()]} · ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      return `
      <div class="card event-card" data-event="${ev.id}">
        <div class="event-head">
          <div>
            <div class="event-title">${escapeHtml(ev.title)}</div>
            <div class="event-when">${when} (${WEEKDAYS_RU[d.getDay()]})</div>
          </div>
        </div>
        <div class="rsvp-row">
          <button class="rsvp-btn going ${ev.myResponse === 'going' ? 'active' : ''}" data-response="going">Буду (${ev.going.length})</button>
          <button class="rsvp-btn not-going ${ev.myResponse === 'not_going' ? 'active' : ''}" data-response="not_going">Не буду (${ev.notGoing.length})</button>
        </div>
        ${total ? `<div class="rsvp-bar"><div class="rsvp-bar-fill" style="width:${pct}%;"></div></div>
        <div class="rsvp-names">${pct}% идут ${ev.going.length ? '· <b>Идут:</b> ' + ev.going.map(escapeHtml).join(', ') : ''}${ev.notGoing.length ? ' · <b>Не идут:</b> ' + ev.notGoing.map(escapeHtml).join(', ') : ''}</div>` : ''}
      </div>`;
    }).join('');

    box.querySelectorAll('.rsvp-btn').forEach(btn => {
      btn.onclick = async () => {
        const card = btn.closest('.event-card');
        await Api.post(`/chats/events/${card.dataset.event}/join`, { response: btn.dataset.response });
        loadEvents();
      };
    });
  }
  await loadEvents();

  document.getElementById('addEvent').onclick = async () => {
    const title = prompt('Название события (например: Совместная пробежка)');
    if (!title) return;
    const dateStr = prompt('Дата и время (YYYY-MM-DD HH:MM)', new Date().toISOString().slice(0,16).replace('T',' '));
    if (!dateStr) return;
    const iso = dateStr.replace(' ', 'T');
    try {
      await Api.post('/chats/city/events', { title, event_date: iso });
      showToast('Событие создано');
      loadEvents();
    } catch (e) { showToast(e.message); }
  };

  const data = await Api.get('/chats/city');
  const log = document.getElementById('log');
  log.innerHTML = data.messages.map(renderCityMsg).join('');
  main.scrollTop = main.scrollHeight;

  const token = Api.getToken();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}&room=city:${data.chat.id}`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    log.innerHTML += renderCityMsg(msg);
    main.scrollTop = main.scrollHeight;
  };

  document.getElementById('send').onclick = () => {
    const ta = document.getElementById('text');
    if (!ta.value.trim()) return;
    ws.send(JSON.stringify({ type: 'message', content: ta.value.trim() }));
    ta.value = '';
  };
}
function renderCityMsg(m) {
  const who = m.name || m.username || 'Аноним';
  const own = Api.getUserId() && String(m.user_id) === String(Api.getUserId());
  return `
    <div class="city-row ${own ? 'own' : ''}">
      ${avatarHtml(m.name, m.username, m.photo_url)}
      <div class="city-bubble-wrap">
        ${!own ? `<div class="city-who">${escapeHtml(who)}</div>` : ''}
        <div class="city-bubble">${escapeHtml(m.content)}</div>
      </div>
    </div>`;
}

/* ---------------- PROFILE ---------------- */

async function viewProfile() {
  renderShell('profile');
  const main = document.getElementById('main');
  const [p, a] = await Promise.all([Api.get('/profile'), Api.get('/profile/analytics')]);
  main.innerHTML = `
    <div class="avatar-picker">
      <label class="avatar-big" id="avatarPreviewWrap" style="cursor:pointer;">
        ${p.photo_url ? `<img src="${p.photo_url}" id="avatarImg">` : `<span id="avatarImg">${(p.name||p.username||'?').charAt(0).toUpperCase()}</span>`}
        <input type="file" accept="image/*" id="avatarFile" style="display:none;">
      </label>
      <div>
        <h1 class="display screen-title" style="margin-bottom:2px;">${escapeHtml(p.name || p.username)}</h1>
        <p class="screen-sub" style="margin-bottom:0;">${escapeHtml(p.city || 'Город не указан')} ${p.profession ? '· ' + escapeHtml(p.profession) : ''}</p>
      </div>
    </div>

    <div class="card">
      <div class="eyebrow" style="margin-bottom:10px;">За всё время</div>
      <div class="stat-row"><span>Тренировок выполнено</span><span class="v">${a.overall.done}/${a.overall.total}</span></div>
      <div class="stat-row"><span>Пропущено</span><span class="v">${a.overall.skipped}</span></div>
      <div class="stat-row"><span>Совместных тренировок</span><span class="v">${a.sharedWorkouts}</span></div>
    </div>

    ${a.currentGoal ? `
    <div class="card">
      <div class="eyebrow" style="margin-bottom:10px;">Текущая цель: ${escapeHtml(a.currentGoal.title)}</div>
      <div class="stat-row"><span>Прогресс</span><span class="v">${a.currentGoal.done}/${a.currentGoal.total}</span></div>
    </div>` : ''}

    <button class="btn ghost block" id="logoutAll">Выйти со всех устройств</button>
  `;

  document.getElementById('avatarFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await resizeImageToDataUrl(file, 240);
    document.getElementById('avatarImg').outerHTML = `<img src="${dataUrl}" id="avatarImg">`;
    try {
      await Api.patch('/profile', { photo_url: dataUrl });
      showToast('Аватар обновлён');
    } catch {
      showToast('Не удалось сохранить аватар');
    }
  };

  document.getElementById('logoutAll').onclick = async () => {
    await Api.post('/auth/logout-all');
    location.hash = '#/login';
  };
}

// Сжимает картинку на клиенте (canvas) до маленького квадрата, чтобы не хранить мегабайты в базе
function resizeImageToDataUrl(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------- ROUTER ---------------- */

const routes = {
  '#/promo': viewPromo,
  '#/login': viewLogin,
  '#/register': viewRegister,
  '#/onboarding': viewOnboarding,
  '#/agent': viewAgent,
  '#/plan': viewPlan,
  '#/chats': viewChats,
  '#/profile': viewProfile
};

async function router() {
  let hash = location.hash || '#/promo';
  const entryRoutes = ['#/promo', '#/login', '#/register'];
  const protectedRoutes = ['#/agent', '#/plan', '#/chats', '#/profile', '#/onboarding'];

  if (!Api.getToken()) {
    const ok = await Api.tryRefresh();
    if (ok && entryRoutes.includes(hash)) {
      // Сессия жива (например, приложение открыли заново с экрана домой) —
      // не показываем PIN/вход заново, а сразу ведём внутрь приложения.
      location.hash = '#/agent';
      return;
    }
    if (!ok && protectedRoutes.includes(hash)) {
      location.hash = '#/login';
      return;
    }
  }
  (routes[hash] || viewPromo)();
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
