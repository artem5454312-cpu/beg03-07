// Простой роутер на хэшах + рендер экранов в #app.
// Никаких фреймворков — чистый JS, чтобы было легко читать и менять.

const state = { regToken: null };

function showToast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// Тактильная отдача (вибрация). На iOS Safari API вибрации не поддерживается вообще —
// это ограничение самого iOS, а не наше; на Android и в большинстве других браузеров работает.
function haptic(pattern = 10) {
  try { navigator.vibrate?.(pattern); } catch {}
}
const HAPTIC = {
  tap: 8,           // лёгкое касание — обычные кнопки
  select: 15,        // выбор/переключение — статус, вкладка
  success: [12, 40, 12], // успех — отправлено, сохранено
  reaction: 20,       // реакция на сообщение
  warning: [20, 60, 20, 60, 20], // ошибка / предупреждение
  unlock: [10, 30, 10, 30, 40]   // разблокировка экрана тренировки
};

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
  if (window.__modalCleanup) { window.__modalCleanup(); window.__modalCleanup = null; }
  document.getElementById('modalOverlay')?.remove();
}

// Зажми и держи N миллисекунд, чтобы подтвердить — как разблокировка на спортивных часах.
// Случайное короткое касание (например, через ткань кармана) ничего не сделает.
function attachHoldToConfirm(btn, ms, onConfirm) {
  let timer = null, held = false;
  function start(e) {
    e.preventDefault();
    held = true;
    btn.classList.add('holding');
    btn.style.setProperty('--hold-ms', ms + 'ms');
    haptic(HAPTIC.tap);
    timer = setTimeout(() => { if (held) onConfirm(); }, ms);
  }
  function cancel() {
    held = false;
    btn.classList.remove('holding');
    clearTimeout(timer);
  }
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', cancel);
  btn.addEventListener('pointerleave', cancel);
  btn.addEventListener('pointercancel', cancel);
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

/* ---------------- НЕПРОЧИТАННОЕ (бейджи на вкладках + иконке приложения) ---------------- */

let unreadCounts = { chat: 0, agent: 0 };
let unreadPollingStarted = false;

function applyBadges() {
  const chatBadge = document.getElementById('badge-chats');
  const agentBadge = document.getElementById('badge-agent');
  if (chatBadge) {
    chatBadge.textContent = unreadCounts.chat > 99 ? '99+' : unreadCounts.chat;
    chatBadge.style.display = unreadCounts.chat > 0 ? 'flex' : 'none';
  }
  if (agentBadge) {
    agentBadge.textContent = unreadCounts.agent > 99 ? '99+' : unreadCounts.agent;
    agentBadge.style.display = unreadCounts.agent > 0 ? 'flex' : 'none';
  }
  const total = unreadCounts.chat + unreadCounts.agent;
  if ('setAppBadge' in navigator) {
    if (total > 0) navigator.setAppBadge(total).catch(() => {});
    else navigator.clearAppBadge?.().catch(() => {});
  }
}

async function refreshUnreadCounts() {
  try {
    unreadCounts = await Api.get('/notifications/unread');
    applyBadges();
  } catch { /* тихо игнорируем — не критично для работы приложения */ }
}

function startUnreadPolling() {
  if (unreadPollingStarted) return;
  unreadPollingStarted = true;
  refreshUnreadCounts();
  setInterval(refreshUnreadCounts, 20000);
}

/* ---------------- SHELL ---------------- */

const TAB_ICONS = {
  agent: '<circle cx="12" cy="11" r="8"/><path d="M9 11h.01M12 11h.01M15 11h.01"/>',
  plan: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  chats: '<circle cx="9" cy="9" r="3.2"/><circle cx="16.5" cy="10.5" r="2.6"/><path d="M3.5 19c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/>'
};

function renderShell(activeTab) {
  const tabs = ['agent', 'plan', 'chats', 'profile'];
  const topRightHtml = activeTab === 'agent'
    ? `<button class="btn ghost" id="topNewGoalBtn" style="padding:6px 10px;">+ Новая цель</button>`
    : `<button class="btn ghost" id="logoutBtn" style="padding:6px 10px;">Выйти</button>`;
  document.getElementById('app').innerHTML = `
    <div class="topbar">
      <span class="mark">PULSE</span>
      ${topRightHtml}
    </div>
    <main id="main"></main>
    <div class="tabbar">
      ${tabs.map(id => `
        <button data-tab="${id}" aria-label="${id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TAB_ICONS[id]}</svg>
          ${id === 'chats' || id === 'agent' ? `<span class="tab-badge" id="badge-${id}"></span>` : ''}
        </button>`).join('')}
    </div>
  `;
  document.querySelectorAll('.tabbar button').forEach(b => {
    if (b.dataset.tab === activeTab) b.classList.add('active');
    b.onclick = () => { haptic(HAPTIC.tap); location.hash = '#/' + b.dataset.tab; };
  });
  if (activeTab !== 'agent') {
    document.getElementById('logoutBtn').onclick = async () => {
      await Api.post('/auth/logout');
      location.hash = '#/login';
    };
  }
  applyBadges();
  startUnreadPolling();
}

/* ---------------- AUTH SCREENS ---------------- */

function viewIntro() {
  document.getElementById('app').innerHTML = `
    <div class="auth-wrap"><div class="auth-card" style="text-align:center;">
      <div class="display" style="font-size:54px;letter-spacing:-0.02em;margin-bottom:14px;">PULSE</div>
      <p class="screen-sub" style="font-size:16px;line-height:1.55;margin-bottom:40px;">
        Персональный ИИ-тренер: сам составляет план, следит за прогрессом
        и пишет тебе, когда пора на тренировку.
      </p>
      <button class="btn accent-lg block" id="goRegister">Регистрация</button>
      <p style="margin-top:16px;"><a href="#/login" class="eyebrow">Уже есть аккаунт →</a></p>
    </div></div>`;
  document.getElementById('goRegister').onclick = () => { location.hash = '#/promo'; };
}

// Определяем, запущено ли уже как установленное приложение — если да, шаг установки
// смысла не имеет и его нужно молча пропустить.
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function detectPlatform() {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

function viewInstallApp() {
  if (isStandalone()) { location.hash = '#/onboarding'; return; }
  const platform = detectPlatform();

  const bodies = {
    ios: `
      <ol class="install-steps">
        <li>Нажми на значок <b>«Поделиться»</b> внизу экрана в Safari (квадрат со стрелкой вверх).</li>
        <li>Прокрути вниз и выбери <b>«На экран «Домой»»</b>.</li>
        <li>Нажми <b>«Добавить»</b> в правом верхнем углу.</li>
      </ol>`,
    android: `<p class="screen-sub">В Chrome обычно само появляется баннер «Добавить на главный экран». Если нет — открой меню (три точки в углу) → <b>«Установить приложение»</b>.</p>`,
    desktop: `<p class="screen-sub">На компьютере этот шаг необязателен — он в первую очередь для телефона. Можно просто продолжить, а на телефоне установить позже.</p>`
  };

  document.getElementById('app').innerHTML = `
    <div class="auth-wrap"><div class="auth-card">
      <h1 class="display screen-title">Установи как приложение</h1>
      <p class="screen-sub">Тренер сможет писать тебе даже когда телефон заблокирован — уведомления работают только из установленного приложения, не из вкладки браузера.</p>
      ${bodies[platform]}
      <button class="btn accent-lg block" id="goNext" style="margin-top:22px;">Готово</button>
      <button class="btn ghost block" id="skipInstall" style="margin-top:10px;">Пропустить, сделаю позже</button>
    </div></div>`;

  document.getElementById('goNext').onclick = () => { location.hash = '#/onboarding'; };
  document.getElementById('skipInstall').onclick = () => { location.hash = '#/onboarding'; };
}

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
      location.hash = '#/install-app';
    } catch (e) { document.getElementById('err').textContent = e.message; }
  };
}

function viewOnboarding() {
  document.getElementById('app').innerHTML = `
    <div class="auth-wrap"><div class="auth-card">
      <h1 class="display screen-title">Профиль</h1>
      <p class="screen-sub">Это увидят другие в общем чате.</p>
      <div class="field"><label>Имя</label><input id="name" type="text"></div>
      <div class="field"><label>Профессия (необязательно)</label><input id="profession" type="text"></div>
      <div class="field"><label>Пол</label>
        <select id="gender"><option value="">Не указывать</option><option>Женский</option><option>Мужской</option></select>
      </div>
      <button class="btn block" id="go">Готово → к агенту</button>
    </div></div>`;
  document.getElementById('go').onclick = async () => {
    await Api.post('/auth/profile-setup', {
      name: document.getElementById('name').value,
      profession: document.getElementById('profession').value,
      gender: document.getElementById('gender').value
    });
    location.hash = '#/agent';
  };
}

/* ---------------- AGENT ---------------- */

// Универсальный "зажми и запиши" рекордер — как кнопка голосового в Telegram.
// Зажал (pointerdown) — пишет, отпустил (pointerup) — останавливает и отдаёт запись.
// Короткие случайные касания (<400мс) игнорируются, чтобы не улетали пустые сообщения.
function attachPressHoldRecorder(btn, { isEnabled, onDone, maxMs = 60000 }) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return;
  let mediaRecorder = null, chunks = [], stream = null, active = false, startedAt = 0, maxTimer = null;

  async function start(e) {
    if (!isEnabled() || active) return;
    e.preventDefault();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      showToast('Нет доступа к микрофону');
      return;
    }
    chunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
    mediaRecorder.start();
    active = true;
    startedAt = Date.now();
    btn.classList.add('recording');
    haptic(HAPTIC.select);
    maxTimer = setTimeout(stop, maxMs);
  }

  function stop() {
    if (!active) return;
    active = false;
    clearTimeout(maxTimer);
    btn.classList.remove('recording');
    const duration = Date.now() - startedAt;
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      // Меньше секунды — почти наверняка случайное касание (например, через карман),
      // а не осознанная запись. Молча игнорируем, не тревожим ни транскрибацию, ни агента.
      if (duration < 1000) return;
      haptic(HAPTIC.success);
      onDone(new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' }));
    };
    mediaRecorder.stop();
  }

  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('pointercancel', stop);
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

// Собирает textarea + одну кнопку "микрофон/отправить": пока поле пустое — кнопка это
// микрофон (зажми и говори), как только начал печатать — превращается в "отправить".
function setupComposer({ textarea, micSendBtn, onSend, onVoice }) {
  function hasText() { return textarea.value.trim().length > 0; }
  function updateIcon() {
    micSendBtn.innerHTML = hasText()
      ? `<svg viewBox="0 0 24 24" fill="currentColor">${SEND_ICON}</svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${MIC_ICON}</svg>`;
  }
  textarea.addEventListener('input', updateIcon);
  updateIcon();

  micSendBtn.addEventListener('click', () => {
    if (!hasText()) return; // в режиме микрофона клик ничего не делает — только зажатие
    haptic(HAPTIC.tap);
    const content = textarea.value.trim();
    textarea.value = '';
    updateIcon();
    onSend(content);
  });

  attachPressHoldRecorder(micSendBtn, {
    isEnabled: () => !hasText(),
    onDone: onVoice
  });
}

const MIC_ICON = '<path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z"/><path d="M19 11a7 7 0 01-14 0M12 19v3"/>';

async function viewAgent() {
  renderShell('agent');
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="chat-toolbar">
      <button id="clearChat">Очистить диалог</button>
    </div>
    <div class="chat-log" id="log"></div>
    <div class="chat-input">
      <input type="file" accept="image/*" id="agentPhotoFile" style="display:none;">
      <button class="btn icon" id="agentPhotoBtn" aria-label="Прикрепить фото"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="M21 15l-5-5-4 4-3-3-4 4"/></svg></button>
      <textarea id="text" placeholder="Напиши агенту…"></textarea>
      <button class="btn icon mic" id="micSend" aria-label="Голос или отправить"></button>
    </div>`;

  function scrollLogToBottom() {
    document.getElementById('main').scrollTop = document.getElementById('main').scrollHeight;
  }

  function renderAgentMsg(m) {
    const time = formatMskTime(m.created_at);
    if (m.role === 'user' && m.content.startsWith('IMG::')) {
      return `<div class="msg user"><img class="chat-photo" src="${m.content.slice(5)}" alt="фото"><div class="msg-time">${time}</div></div>`;
    }
    const body = m.role === 'agent' ? formatAgentText(m.content) : escapeHtml(m.content);
    return `<div class="msg ${m.role}">${body}<div class="msg-time">${time}</div></div>`;
  }

  function buildAgentTimeline(msgs) {
    let out = '', lastDay = null;
    for (const m of msgs) {
      const dayIso = mskDateStr(new Date(m.created_at));
      if (dayIso !== lastDay) {
        out += `<div class="date-divider"><span>${dayDividerLabel(dayIso)}</span></div>`;
        lastDay = dayIso;
      }
      out += renderAgentMsg(m);
    }
    return out;
  }

  async function loadHistory() {
    const msgs = await Api.get('/agent/messages');
    const log = document.getElementById('log');
    log.innerHTML = msgs.length ? buildAgentTimeline(msgs)
      : '<p class="screen-sub">Пока пусто — напиши что-нибудь, чтобы агент начал знакомство.</p>';
    document.querySelectorAll('#log .chat-photo').forEach(img => { img.onclick = () => openPhotoViewer(img.src); });
    scrollLogToBottom();
    Api.post('/notifications/mark-read', { scope: 'agent' }).then(refreshUnreadCounts).catch(() => {});
  }
  await loadHistory();

  async function sendToAgent(content) {
    const log = document.getElementById('log');
    log.innerHTML += `<div class="msg agent" id="pending">…</div>`;
    scrollLogToBottom();
    try {
      const reply = await Api.post('/agent/messages', { content });
      document.getElementById('pending').outerHTML = `<div class="msg agent">${formatAgentText(reply.content)}<div class="msg-time">${formatMskTime(reply.created_at)}</div></div>`;
    } catch (e) {
      document.getElementById('pending').outerHTML = `<div class="msg agent">Ошибка: ${escapeHtml(e.message)}</div>`;
    }
    scrollLogToBottom();
    Api.post('/notifications/mark-read', { scope: 'agent' }).then(refreshUnreadCounts).catch(() => {});
  }

  document.getElementById('agentPhotoBtn').onclick = () => document.getElementById('agentPhotoFile').click();
  document.getElementById('agentPhotoFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    let dataUrl;
    try {
      dataUrl = await resizePhotoToDataUrl(file, 1024);
    } catch { showToast('Не удалось прикрепить фото'); return; }

    const log = document.getElementById('log');
    log.innerHTML += `<div class="msg user"><img class="chat-photo" src="${dataUrl}" alt="фото"><div class="msg-time">${formatMskTime(new Date().toISOString())}</div></div>`;
    document.querySelectorAll('#log .chat-photo').forEach(img => { img.onclick = () => openPhotoViewer(img.src); });
    log.innerHTML += `<div class="msg agent" id="pending">…</div>`;
    scrollLogToBottom();
    try {
      const reply = await Api.post('/agent/messages', { content: '', image: dataUrl });
      document.getElementById('pending').outerHTML = `<div class="msg agent">${formatAgentText(reply.content)}<div class="msg-time">${formatMskTime(reply.created_at)}</div></div>`;
    } catch (err) {
      document.getElementById('pending').outerHTML = `<div class="msg agent">Ошибка: ${escapeHtml(err.message)}</div>`;
    }
    scrollLogToBottom();
    Api.post('/notifications/mark-read', { scope: 'agent' }).then(refreshUnreadCounts).catch(() => {});
  };

  setupComposer({
    textarea: document.getElementById('text'),
    micSendBtn: document.getElementById('micSend'),
    onSend: (content) => {
      const log = document.getElementById('log');
      log.innerHTML += `<div class="msg user">${escapeHtml(content)}<div class="msg-time">${formatMskTime(new Date().toISOString())}</div></div>`;
      scrollLogToBottom();
      sendToAgent(content);
    },
    onVoice: async (blob) => {
      // Голосовое уходит тихо в фон: пока распознаётся Whisper'ом, показываем тот же
      // индикатор "печатает…", что и для обычного ответа — без отдельных статусов.
      const dataUrl = await blobToDataUrl(blob);
      const log = document.getElementById('log');
      log.innerHTML += `<div class="msg agent" id="pending">…</div>`;
      scrollLogToBottom();
      try {
        const tr = await Api.post('/agent/transcribe', { audio: dataUrl });
        const text = (tr.text || '').trim();
        if (!text) {
          document.getElementById('pending').remove();
          showToast('Не удалось разобрать речь');
          return;
        }
        document.getElementById('pending').insertAdjacentHTML('beforebegin', `<div class="msg user">${escapeHtml(text)}<div class="msg-time">${formatMskTime(new Date().toISOString())}</div></div>`);
        const reply = await Api.post('/agent/messages', { content: text });
        document.getElementById('pending').outerHTML = `<div class="msg agent">${formatAgentText(reply.content)}<div class="msg-time">${formatMskTime(reply.created_at)}</div></div>`;
      } catch (e) {
        document.getElementById('pending').outerHTML = `<div class="msg agent">Ошибка: ${escapeHtml(e.message || 'не удалось распознать речь')}</div>`;
      }
      scrollLogToBottom();
      Api.post('/notifications/mark-read', { scope: 'agent' }).then(refreshUnreadCounts).catch(() => {});
    }
  });

  document.getElementById('topNewGoalBtn').onclick = async () => {
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
function difficultyLabel(d) { return { easy: 'Лёгкая', medium: 'Средняя', hard: 'Нужно постараться' }[d] || 'Средняя'; }

const MONTHS_RU = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const WEEKDAYS_RU = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];

// Показывает календарную дату (без времени) так, как она есть, не пропуская её
// через локальный часовой пояс телефона — раньше именно тут был источник сдвига на день.
function formatDateHuman(dateStr) {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return { date: `${dt.getUTCDate()} ${MONTHS_RU[dt.getUTCMonth()]}`, weekday: WEEKDAYS_RU[dt.getUTCDay()] };
}

// Сегодняшняя дата по МОСКВЕ (а не по часовому поясу телефона), формат YYYY-MM-DD.
// Специально не через toISOString() — та всегда в UTC и на положительных смещениях
// (Москва, +3) стабильно "откатывала" сегодняшний день на сутки назад.
function mskDateStr(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// Прибавляет/вычитает дни у календарной даты-строки без какой-либо зависимости
// от часового пояса устройства — чистая календарная арифметика через Date.UTC.
function addDaysToDateStr(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Разбивает текстовое описание плана от агента на два блока: логика плана и питание,
// чтобы показать их отдельными акцентными карточками, а не одной стеной текста.
function splitPlanSummary(raw) {
  if (!raw) return { logic: '', nutrition: '' };
  const idx = raw.search(/питание/i);
  if (idx === -1) return { logic: raw, nutrition: '' };
  let start = raw.lastIndexOf('\n\n', idx);
  start = start === -1 ? 0 : start + 2;
  return { logic: raw.slice(0, start).trim(), nutrition: raw.slice(start).trim() };
}

// Пытаемся вытащить примерную длительность (в минутах) из текста тренировки для таймера
function guessMinutes(typeText) {
  const m = String(typeText).match(/(\d{1,3})\s*мин/);
  if (m) return Math.min(180, parseInt(m[1], 10));
  return 30;
}

// Грубая категоризация типа тренировки для диаграммы «из чего состоит нагрузка».
function categorizeType(t) {
  const s = String(t).toLowerCase();
  if (/сил|зал|штанг|присед|отжим|планк|пресс|турник|гант|берпи|выпад/.test(s)) return 'Сила';
  if (/восстанов|растяж|йог|отдых|заминк|мобил|прогулк|плавани/.test(s)) return 'Восстановление';
  return 'Бег';
}

// Целочисленная разница в днях между двумя датами-строками (YYYY-MM-DD), без часовых поясов.
function daysBetweenStr(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

async function viewPlan() {
  renderShell('plan');
  const main = document.getElementById('main');
  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;">
      <h1 class="display screen-title" style="margin-bottom:0;">План</h1>
      <button class="btn" id="addBtn">+ Добавить</button>
    </div>
    <div id="goalHero"></div>
    <div id="goalExtra"></div>
    <div id="weekStrip"></div>
    <div id="blocks"></div>`;

  let cachedGoals = [];

  /* ---------- Хиро активной цели + инфографика ---------- */

  function renderGoalHero(g) {
    const total = g.workouts.length;
    const done = g.workouts.filter(w => w.status === 'done').length;
    const pct = total ? Math.round(done / total * 100) : 0;
    const remaining = total - done;

    const today = mskDateStr();
    const dates = g.workouts.map(w => w.date.slice(0, 10)).sort();
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    const daysLeft = lastDate ? Math.max(0, daysBetweenStr(today, lastDate)) : 0;

    // Баланс сложности
    const dc = { easy: 0, medium: 0, hard: 0 };
    g.workouts.forEach(w => { if (dc[w.difficulty] != null) dc[w.difficulty]++; else dc.medium++; });
    const dpct = k => total ? Math.round(dc[k] / total * 100) : 0;

    // Из чего состоит нагрузка
    const tc = { 'Бег': 0, 'Сила': 0, 'Восстановление': 0 };
    g.workouts.forEach(w => { tc[categorizeType(w.type)]++; });
    const tpct = k => total ? Math.round(tc[k] / total * 100) : 0;

    // Тренировок по неделям (реальный график объёма — по числу тренировок в неделю)
    let weeklyBars = '';
    if (firstDate) {
      const weeks = {};
      g.workouts.forEach(w => {
        const wi = Math.floor(daysBetweenStr(firstDate, w.date.slice(0, 10)) / 7);
        weeks[wi] = (weeks[wi] || 0) + 1;
      });
      const idxs = Object.keys(weeks).map(Number).sort((a, b) => a - b);
      const maxw = Math.max(1, ...idxs.map(i => weeks[i]));
      const curWeek = Math.floor(daysBetweenStr(firstDate, today) / 7);
      weeklyBars = idxs.map(i => {
        const h = Math.max(6, Math.round(weeks[i] / maxw * 40));
        const isCur = i === curWeek;
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;">
          <div style="width:100%;height:${h}px;background:${isCur ? '#cbfb45' : 'rgba(203,251,69,0.3)'};border-radius:4px 4px 0 0;"></div>
          ${isCur ? '<div style="font-size:9px;color:#cbfb45;margin-top:3px;font-weight:700;">сейчас</div>' : ''}
        </div>`;
      }).join('');
    }

    const { logic, nutrition } = splitPlanSummary(g.description);

    const heroInfographics = total ? `
      <!-- Логика плана -->
      <div class="card" style="border-radius:16px;padding:15px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <span style="width:3px;height:15px;border-radius:2px;background:#cbfb45;"></span>
          <span class="display" style="font-size:15px;">Логика плана</span>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:14px;">
          <div style="flex:1;background:rgba(203,251,69,0.1);border:1px solid rgba(203,251,69,0.25);border-radius:13px;padding:9px 6px;text-align:center;"><div class="display" style="font-size:20px;color:#cbfb45;">${dpct('easy')}%</div><div style="font-size:10.5px;color:var(--text-dim);margin-top:2px;">Лёгкие</div></div>
          <div style="flex:1;background:rgba(255,255,255,0.05);border:1px solid var(--line);border-radius:13px;padding:9px 6px;text-align:center;"><div class="display" style="font-size:20px;color:rgba(242,244,236,0.85);">${dpct('medium')}%</div><div style="font-size:10.5px;color:var(--text-dim);margin-top:2px;">Средние</div></div>
          <div style="flex:1;background:rgba(255,183,77,0.1);border:1px solid rgba(255,183,77,0.25);border-radius:13px;padding:9px 6px;text-align:center;"><div class="display" style="font-size:20px;color:var(--amber);">${dpct('hard')}%</div><div style="font-size:10.5px;color:var(--text-dim);margin-top:2px;">Тяжёлые</div></div>
        </div>
        <div class="summary-label">Из чего состоит нагрузка</div>
        <div style="display:flex;flex-direction:column;gap:9px;margin-top:8px;">
          <div><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px;"><span>Бег</span><b style="font-weight:700;">${tpct('Бег')}%</b></div><div style="height:9px;border-radius:999px;background:rgba(255,255,255,0.07);overflow:hidden;"><div style="width:${tpct('Бег')}%;height:100%;background:#cbfb45;border-radius:999px;"></div></div></div>
          <div><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px;"><span>Сила</span><b style="font-weight:700;">${tpct('Сила')}%</b></div><div style="height:9px;border-radius:999px;background:rgba(255,255,255,0.07);overflow:hidden;"><div style="width:${tpct('Сила')}%;height:100%;background:var(--blue);border-radius:999px;"></div></div></div>
          <div><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px;"><span>Восстановление</span><b style="font-weight:700;">${tpct('Восстановление')}%</b></div><div style="height:9px;border-radius:999px;background:rgba(255,255,255,0.07);overflow:hidden;"><div style="width:${tpct('Восстановление')}%;height:100%;background:rgba(242,244,236,0.4);border-radius:999px;"></div></div></div>
        </div>
        ${logic ? `<div class="summary-box" style="margin-top:14px;margin-bottom:0;"><div class="summary-label">Комментарий тренера</div>${formatAgentText(logic)}</div>` : ''}
      </div>

      <!-- Питание -->
      <div class="card" style="border-radius:16px;padding:15px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <span style="width:3px;height:15px;border-radius:2px;background:var(--blue);"></span>
          <span class="display" style="font-size:15px;">Питание на сегодня</span>
        </div>
        <div style="display:flex;gap:10px;">
          <div style="flex:1;background:rgba(122,182,255,0.08);border:1px solid rgba(122,182,255,0.25);border-radius:14px;padding:11px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:9px;">
              <span style="width:28px;height:28px;border-radius:50%;background:rgba(122,182,255,0.16);display:flex;align-items:center;justify-content:center;flex:0 0 auto;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7ab6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg></span>
              <div class="display" style="font-size:12px;color:#7ab6ff;">До · за 1.5–2 ч</div>
            </div>
            <div style="font-size:13px;line-height:1.5;color:#dfe3d6;">Овсянка + банан.<br>Медленные углеводы для энергии.</div>
          </div>
          <div style="flex:1;background:rgba(203,251,69,0.08);border:1px solid rgba(203,251,69,0.25);border-radius:14px;padding:11px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:9px;">
              <span style="width:28px;height:28px;border-radius:50%;background:rgba(203,251,69,0.16);display:flex;align-items:center;justify-content:center;flex:0 0 auto;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#cbfb45" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L5 13h6l-1 9 9-12h-7z"></path></svg></span>
              <div class="display" style="font-size:12px;color:#cbfb45;">После · 30 мин</div>
            </div>
            <div style="font-size:13px;line-height:1.5;color:#dfe3d6;">Творог / курица + рис.<br>Белок + углеводы для восстановления.</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;margin-top:10px;">
          <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--line);">
            <span style="width:28px;height:28px;border-radius:50%;background:rgba(122,182,255,0.14);display:flex;align-items:center;justify-content:center;flex:0 0 auto;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7ab6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z"></path></svg></span>
            <div style="font-size:13.5px;">Вода — <b style="font-weight:700;">2.5 л</b> в день, больше в дни бега</div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--line);">
            <span style="width:28px;height:28px;border-radius:50%;background:rgba(203,251,69,0.14);display:flex;align-items:center;justify-content:center;flex:0 0 auto;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cbfb45" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="8" height="8" rx="1"></rect><path d="M6.5 6.5l11 11M4 9l2-2M18 15l2 2M9 4l-2 2M15 18l2 2"></path></svg></span>
            <div style="font-size:13.5px;">Белок — <b style="font-weight:700;">1.6 г</b> на кг веса в сутки</div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--line);">
            <span style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;flex:0 0 auto;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(242,244,236,0.7)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14a8 8 0 1 1-9-11 6 6 0 0 0 9 11z"></path></svg></span>
            <div style="font-size:13.5px;">Сон <b style="font-weight:700;">8 ч</b> — база восстановления</div>
          </div>
        </div>
        ${nutrition ? `<div class="summary-box nutrition" style="margin-top:14px;margin-bottom:0;"><div class="summary-label">Комментарий тренера</div>${formatAgentText(nutrition)}</div>` : ''}
      </div>
    ` : '';

    const topHtml = `
      <!-- ЦЕЛЬ -->
      <div style="background:linear-gradient(150deg,#cbfb45,#a8e02f);color:#12140d;border-radius:18px;padding:15px 16px;margin-bottom:10px;box-shadow:0 16px 34px -22px rgba(203,251,69,0.5);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
          <div style="min-width:0;">
            <div class="display" style="font-size:10.5px;letter-spacing:.1em;opacity:.65;">Общая цель</div>
            <div class="display" style="font-size:21px;line-height:1.02;margin:4px 0 3px;">${escapeHtml(g.title || 'Общая цель')}</div>
            <div style="font-size:12px;opacity:.7;">${g.workouts.length ? `${g.workouts[0].date.slice(0,10)} → ${g.workouts[g.workouts.length-1].date.slice(0,10)}` : 'план ещё формируется'}</div>
          </div>
          <div class="display" style="font-size:32px;line-height:0.8;flex:0 0 auto;">${pct}<span style="font-size:17px;">%</span></div>
        </div>
        <div style="height:9px;border-radius:999px;background:rgba(18,20,13,0.18);overflow:hidden;margin-top:12px;">
          <div style="width:${pct}%;height:100%;background:#12140d;border-radius:999px;"></div>
        </div>
      </div>

      ${total ? `
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <div class="card" style="flex:1;margin-bottom:0;padding:11px 8px;text-align:center;border-radius:14px;"><div class="display" style="font-size:22px;">${daysLeft}</div><div style="font-size:10.5px;color:var(--text-dim);margin-top:2px;">дней до финиша</div></div>
        <div class="card" style="flex:1;margin-bottom:0;padding:11px 8px;text-align:center;border-radius:14px;"><div class="display" style="font-size:22px;">${done}</div><div style="font-size:10.5px;color:var(--text-dim);margin-top:2px;">выполнено</div></div>
        <div class="card" style="flex:1;margin-bottom:0;padding:11px 8px;text-align:center;border-radius:14px;"><div class="display" style="font-size:22px;">${remaining}</div><div style="font-size:10.5px;color:var(--text-dim);margin-top:2px;">осталось</div></div>
      </div>` : ''}
    `;
    return { top: topHtml, extra: heroInfographics };
  }

  /* ---------- Недельная полоска-календарь (без изменений) ---------- */

  function renderWeekStrip(goals) {
    const allWorkouts = goals.flatMap(g => g.workouts);
    const todayIso = mskDateStr();
    const short = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
    const days = Array.from({ length: 43 }, (_, i) => addDaysToDateStr(todayIso, i - 21));

    document.getElementById('weekStrip').innerHTML = `<div class="week-strip" id="weekStripInner">${days.map((iso) => {
      const [y, m, d] = iso.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      const match = allWorkouts.find(w => w.date.slice(0, 10) === iso);
      const dotClass = !match ? 'empty' : match.status === 'done' ? 'done' : match.status === 'skipped' ? 'skipped' : 'planned';
      return `
        <div class="week-day ${iso === todayIso ? 'today' : ''} ${match ? 'has-workout' : ''}" data-date="${iso}" data-workout="${match ? match.id : ''}">
          <div class="wd-label">${short[dt.getUTCDay()]}</div>
          <div class="wd-num">${dt.getUTCDate()}</div>
          <div class="wd-dot ${dotClass}"></div>
        </div>`;
    }).join('')}</div>`;

    const strip = document.getElementById('weekStripInner');
    const todayCell = strip.querySelector('.week-day.today');
    if (todayCell) {
      strip.parentElement.scrollLeft = todayCell.offsetLeft - strip.parentElement.clientWidth / 2 + todayCell.offsetWidth / 2;
    }
    strip.querySelectorAll('.week-day.has-workout').forEach(cell => {
      cell.onclick = () => openWorkoutDetail(cell.dataset.workout);
    });
    strip.querySelectorAll('.week-day:not(.has-workout)').forEach(cell => {
      cell.onclick = () => showToast('В этот день тренировки нет');
    });
  }

  /* ---------- Загрузка + список тренировок ---------- */

  async function load() {
    const goals = await Api.get('/plan/overview');
    cachedGoals = goals;

    if (!goals.length) {
      document.getElementById('goalHero').innerHTML = '';
      document.getElementById('goalExtra').innerHTML = '';
      document.getElementById('weekStrip').innerHTML = '';
      document.getElementById('blocks').innerHTML = '<p class="screen-sub">Пока нет ни одного плана — напиши агенту, и он его составит.</p>';
      return;
    }

    const activeGoal = goals.find(g => g.status === 'active') || goals[0];
    const hero = renderGoalHero(activeGoal);
    document.getElementById('goalHero').innerHTML = hero.top;
    document.getElementById('goalExtra').innerHTML = hero.extra;
    renderWeekStrip(goals);

    const box = document.getElementById('blocks');
    box.innerHTML = goals.map(g => {
      const done = g.workouts.filter(w => w.status === 'done').length;
      return `
      <div class="card plan-block ${g.status === 'archived' ? 'archived' : ''}" data-goal="${g.id}" style="border-radius:16px;padding:6px 16px 10px;">
        <div class="plan-block-head">
          <div class="info">
            <div class="eyebrow">${g.status === 'active' ? 'Тренировки цели' : 'Архив'} · ${escapeHtml(g.title || 'Общая цель')}</div>
            <div class="title">План занятий</div>
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
              <span class="diff-badge ${w.difficulty || 'medium'}">${difficultyLabel(w.difficulty)}</span>
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
    const isRunLike = /бег|пробежк|run|кросс/i.test(workout.type);
    showModal(`
      <div class="eyebrow" style="margin-bottom:6px;">${escapeHtml(goalTitle || 'План')}</div>
      <h2>${escapeHtml(workout.type)}</h2>
      <p class="screen-sub" style="margin:4px 0 8px;">${workout.date.slice(0,10)} · ${statusLabel(workout.status)}</p>
      <span class="diff-badge ${workout.difficulty || 'medium'}" style="margin-bottom:14px;">${difficultyLabel(workout.difficulty)}</span>
      ${workout.notes ? `<div class="card" style="box-shadow:none;margin-top:10px;"><div class="eyebrow" style="margin-bottom:6px;">Заметка</div><p>${escapeHtml(workout.notes)}</p></div>` : ''}
      ${isRunLike ? `<button class="btn accent-lg" id="startGps" style="margin-top:14px;">📍 Начать с GPS-трекером</button>` : ''}
      <button class="btn ${isRunLike ? 'ghost' : 'accent-lg'} block" id="startWorkout" style="margin-top:10px;">${isRunLike ? 'Простой таймер без GPS' : 'Начать тренировку'}</button>
      <button class="btn ghost block" id="deleteWorkout" style="margin-top:10px;color:var(--brick);border-color:var(--brick);">Удалить эту тренировку</button>
    `);
    if (isRunLike) document.getElementById('startGps').onclick = () => openGpsWorkout(workout);
    document.getElementById('startWorkout').onclick = () => openWorkoutTimer(workout);
    document.getElementById('deleteWorkout').onclick = async () => {
      if (!confirm('Удалить эту тренировку?')) return;
      await Api.del('/plan/workouts/' + workout.id);
      closeModal();
      load();
    };
  }

  const TIME_OPTIONS = [1,2,3,5,10,15,20,25,30,35,40,45,50,60,70,80,90,105,120];

  function openGpsWorkout(workout) {
    let watchId = null, points = [], totalDistance = 0;
    let startTime = null, elapsedBeforePause = 0, running = false, wakeLock = null;

    const overlay = showModal(`
      <div class="eyebrow" style="text-align:center;">Трекер · GPS</div>
      <p class="timer-now">${escapeHtml(workout.type)}</p>
      <div class="gps-warning" id="gpsWarning" style="display:none;">Слабый или потерянный сигнал GPS — держи телефон на виду, ждём точку получше</div>
      <div class="gps-grid">
        <div class="gps-stat"><div class="gps-num mono js-dist">0.00</div><div class="gps-label">км</div></div>
        <div class="gps-stat"><div class="gps-num mono js-time">00:00</div><div class="gps-label">время</div></div>
        <div class="gps-stat"><div class="gps-num mono js-pace">—</div><div class="gps-label">темп /км</div></div>
      </div>
      <p class="screen-sub" style="text-align:center;margin:10px 0 0;" id="gpsAccuracy">Жду сигнал GPS…</p>
      <div class="timer-controls" style="margin-top:16px;">
        <button class="btn" id="gpsToggle">Старт</button>
        <button class="btn ghost" id="gpsFinish">Завершить</button>
      </div>
      <button class="btn ghost block" id="gpsLock" style="margin-top:10px;">🔒 Заблокировать экран тренировки</button>
      <p class="screen-sub" style="margin-top:14px;">Держи вкладку открытой и экран включённым — веб-приложения физически не могут отслеживать GPS с заблокированным (системно) экраном. Пока идёт трекинг, экран специально не гаснет сам. Кнопка выше — это отдельная блокировка от случайных нажатий (для кармана), не системная блокировка телефона.</p>
    `);

    function haversineMeters(a, b) {
      const R = 6371000, toRad = x => x * Math.PI / 180;
      const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
      const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
    }
    function fmtClock(sec) {
      sec = Math.max(0, Math.floor(sec));
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
      return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }
    function currentElapsed() { return running ? elapsedBeforePause + (Date.now() - startTime) / 1000 : elapsedBeforePause; }
    function render() {
      document.querySelectorAll('.js-dist').forEach(el => el.textContent = (totalDistance / 1000).toFixed(2));
      document.querySelectorAll('.js-time').forEach(el => el.textContent = fmtClock(currentElapsed()));
      const elapsed = currentElapsed();
      if (totalDistance > 50 && elapsed > 20) {
        const paceSecPerKm = elapsed / (totalDistance / 1000);
        const paceText = `${Math.floor(paceSecPerKm / 60)}:${String(Math.round(paceSecPerKm % 60)).padStart(2,'0')}`;
        document.querySelectorAll('.js-pace').forEach(el => el.textContent = paceText);
      }
    }

    async function requestWakeLock() {
      try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* не критично */ }
    }
    function releaseWakeLock() { try { wakeLock?.release?.(); } catch {} wakeLock = null; }

    function onPosition(pos) {
      const { latitude, longitude, accuracy } = pos.coords;
      const warnEl = overlay.querySelector('#gpsWarning');
      const accEl = overlay.querySelector('#gpsAccuracy');
      if (accEl) accEl.textContent = `Точность сигнала: ±${Math.round(accuracy)} м`;
      if (accuracy > 30) { if (warnEl) warnEl.style.display = 'block'; return; }
      if (warnEl) warnEl.style.display = 'none';

      const point = { lat: latitude, lng: longitude, t: Date.now() };
      const last = points[points.length - 1];
      if (last) {
        const d = haversineMeters(last, point);
        const dt = (point.t - last.t) / 1000;
        const impliedSpeed = dt > 0 ? d / dt : 0;
        if (d > 2 && impliedSpeed < 7) totalDistance += d;
      }
      points.push(point);
      render();
    }
    function onGeoError(err) {
      showToast('GPS: ' + (err.message || 'сигнал потерян'));
    }

    function startTracking() {
      if (!('geolocation' in navigator)) { showToast('Геолокация недоступна в этом браузере'); return; }
      requestWakeLock();
      startTime = Date.now();
      running = true;
      const btn = overlay.querySelector('#gpsToggle');
      if (btn) btn.textContent = 'Пауза';
      window.__gpsInterval = setInterval(render, 1000);
      watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
    }
    function pauseTracking() {
      running = false;
      elapsedBeforePause = currentElapsed();
      const btn = overlay.querySelector('#gpsToggle');
      if (btn) btn.textContent = 'Продолжить';
      clearInterval(window.__gpsInterval);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
      releaseWakeLock();
    }

    function openLockScreen() {
      const lock = document.createElement('div');
      lock.className = 'gps-lock-overlay';
      lock.id = 'gpsLockOverlay';
      lock.innerHTML = `
        <div class="gps-lock-stats">
          <div class="gps-num mono js-dist">${(totalDistance/1000).toFixed(2)}</div><div class="gps-label">км</div>
          <div class="gps-num mono js-time" style="margin-top:14px;">${fmtClock(currentElapsed())}</div><div class="gps-label">время</div>
        </div>
        <p class="lock-hint">Экран заблокирован от случайных нажатий — держи телефон свободно в кармане</p>
        <button class="unlock-hold" id="unlockBtn">
          <span class="unlock-fill"></span>
          <span class="unlock-label">🔓 Держи, чтобы разблокировать</span>
        </button>
      `;
      document.body.appendChild(lock);
      attachHoldToConfirm(document.getElementById('unlockBtn'), 1200, () => lock.remove());
    }

    overlay.querySelector('#gpsLock').onclick = openLockScreen;

    window.__modalCleanup = () => {
      clearInterval(window.__gpsInterval);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      releaseWakeLock();
      document.getElementById('gpsLockOverlay')?.remove();
    };

    overlay.querySelector('#gpsToggle').onclick = () => { running ? pauseTracking() : startTracking(); };
    overlay.querySelector('#gpsFinish').onclick = async () => {
      if (running) pauseTracking();
      document.getElementById('gpsLockOverlay')?.remove();
      const elapsed = elapsedBeforePause;
      const distKm = +(totalDistance / 1000).toFixed(2);
      let paceText = '—';
      if (totalDistance > 50 && elapsed > 20) {
        const paceSecPerKm = elapsed / (totalDistance / 1000);
        paceText = `${Math.floor(paceSecPerKm / 60)}:${String(Math.round(paceSecPerKm % 60)).padStart(2,'0')}/км`;
      }
      const notes = `GPS-трекер: ${distKm} км за ${fmtClock(elapsed)}, средний темп ${paceText}.`;
      try {
        await Api.post(`/plan/workouts/${workout.id}/result`, {
          notes, metrics: { distanceKm: distKm, durationSec: Math.round(elapsed), pace: paceText }
        });
      } catch { /* статус done всё равно проставится */ }
      closeModal();
      showToast('Тренировка сохранена — тренер сейчас глянет на цифры 💪');
      load();
    };
  }

  function openWorkoutTimer(workout) {
    let remaining = guessMinutes(workout.type) * 60;
    let running = false;

    const overlay = showModal(`
      <div class="eyebrow" style="text-align:center;">Сейчас</div>
      <p class="timer-now">${escapeHtml(workout.type)}</p>
      <div class="timer-display" id="timerNum">${fmtTime(remaining)}</div>
      <div class="time-picker" id="tp">
        <div class="tp-track">${TIME_OPTIONS.map(m => `<div class="tp-item" data-min="${m}">${m}</div>`).join('')}</div>
      </div>
      <p class="screen-sub" style="text-align:center;margin:0 0 10px;">мин — прокрути, чтобы выбрать длительность</p>
      <div class="timer-controls">
        <button class="btn" id="toggle">Старт</button>
        <button class="btn ghost" id="finish">Завершить</button>
      </div>
    `);

    function render() { overlay.querySelector('#timerNum').textContent = fmtTime(remaining); }

    const tp = overlay.querySelector('#tp');
    const items = [...overlay.querySelectorAll('.tp-item')];
    function syncPickerActive() {
      const center = tp.scrollLeft + tp.clientWidth / 2;
      let closest = items[0], dist = Infinity;
      for (const it of items) {
        const d = Math.abs((it.offsetLeft + it.offsetWidth / 2) - center);
        if (d < dist) { dist = d; closest = it; }
      }
      items.forEach(i => i.classList.toggle('active', i === closest));
      if (!running) { remaining = parseInt(closest.dataset.min, 10) * 60; render(); }
    }
    let scrollTimer;
    tp.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(syncPickerActive, 90);
    });
    requestAnimationFrame(() => {
      const startMin = Math.round(remaining / 60);
      const closestOpt = TIME_OPTIONS.reduce((a, b) => Math.abs(b - startMin) < Math.abs(a - startMin) ? b : a);
      const idx = TIME_OPTIONS.indexOf(closestOpt);
      const target = items[idx];
      tp.scrollLeft = target.offsetLeft + target.offsetWidth / 2 - tp.clientWidth / 2;
      syncPickerActive();
    });

    const toggleBtn = overlay.querySelector('#toggle');
    toggleBtn.onclick = () => {
      running = !running;
      toggleBtn.textContent = running ? 'Пауза' : 'Продолжить';
      tp.classList.toggle('disabled', running);
      if (running) {
        window.__timerInterval = setInterval(() => {
          if (remaining <= 0) { clearInterval(window.__timerInterval); running = false; toggleBtn.textContent = 'Старт'; tp.classList.remove('disabled'); showToast('Время вышло!'); return; }
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
    const date = prompt('Дата (YYYY-MM-DD)', mskDateStr());
    if (!date) return;
    await Api.post('/plan/workouts', { type, date });
    load();
  };
}

/* ---------------- CHATS ---------------- */

const REACTION_EMOJIS = ['👍','❤️','😂','🔥','😮','😢'];

let ws;
async function viewChats() {
  renderShell('chats');
  const main = document.getElementById('main');
  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;gap:8px;">
      <h1 class="display screen-title" style="margin-bottom:0;">Общий чат</h1>
      <button class="btn ghost" id="memberCount" style="padding:6px 12px;white-space:nowrap;">…</button>
    </div>
    <p class="screen-sub">События и сообщения идут вместе, одной лентой.</p>
    <div id="joinBanner"></div>
    <div class="chat-log" id="log"></div>
    <div id="replyPreview"></div>
    <div id="composerBox"></div>`;

  let replyingTo = null;
  function cancelReply() { replyingTo = null; renderReplyPreview(); }
  function renderReplyPreview() {
    const box = document.getElementById('replyPreview');
    if (!replyingTo) { box.innerHTML = ''; return; }
    const author = replyingTo.name || replyingTo.username || 'Аноним';
    const snippet = replyingTo.content.startsWith('IMG::') ? '📷 Фото'
      : replyingTo.content.startsWith('AUD::') ? '🎤 Голосовое'
      : replyingTo.content;
    box.innerHTML = `
      <div class="reply-bar">
        <div class="reply-bar-text"><b>${escapeHtml(author)}</b>: ${escapeHtml(snippet).slice(0, 80)}</div>
        <button class="reply-bar-close" aria-label="Отменить ответ">✕</button>
      </div>`;
    box.querySelector('.reply-bar-close').onclick = cancelReply;
  }

  const data = await Api.get('/chats/city');
  let messages = data.messages;
  let events = await Api.get('/chats/city/events');
  let isMember = data.isMember;

  document.getElementById('memberCount').textContent = `${data.memberCount} ${pluralMembers(data.memberCount)}`;
  document.getElementById('memberCount').onclick = openMembersList;

  async function openMembersList() {
    const members = await Api.get('/chats/city/members');
    showModal(`
      <h2 style="margin-bottom:12px;">Участники (${members.length})</h2>
      ${members.map(m => `
        <div class="member-row">
          ${avatarHtml(m.name, m.username, m.photo_url)}
          <div>
            <div class="name">${escapeHtml(m.name || m.username)}</div>
            <div class="username">@${escapeHtml(m.username)}</div>
          </div>
        </div>`).join('') || '<p class="screen-sub">Пока никого нет.</p>'}
    `);
  }

  function renderComposer() {
    const box = document.getElementById('composerBox');
    if (!isMember) {
      document.getElementById('joinBanner').innerHTML = `
        <div class="join-banner card">
          <p>Вступи в общий чат, чтобы писать сообщения, реагировать и участвовать в событиях.</p>
          <button class="btn accent-lg" id="joinBtn">Вступить</button>
        </div>`;
      document.getElementById('joinBtn').onclick = async () => {
        await Api.post('/chats/city/join', {});
        isMember = true;
        const countBtn = document.getElementById('memberCount');
        countBtn.textContent = (parseInt(countBtn.textContent, 10) + 1) + ' ' + pluralMembers(parseInt(countBtn.textContent, 10) + 1);
        document.getElementById('joinBanner').innerHTML = '';
        renderComposer();
        connectSocket();
        showToast('Добро пожаловать в чат!');
      };
      box.innerHTML = '';
      return;
    }
    document.getElementById('joinBanner').innerHTML = '';
    box.innerHTML = `
      <div class="chat-input">
        <input type="file" accept="image/*" id="photoFile" style="display:none;">
        <button class="btn icon" id="plusBtn" aria-label="Добавить"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg></button>
        <textarea id="text" placeholder="Написать в чат…"></textarea>
        <button class="btn icon mic" id="micSend" aria-label="Голос или отправить"></button>
      </div>`;

    document.getElementById('plusBtn').onclick = () => {
      showModal(`
        <button class="btn block" id="actPhoto" style="margin-bottom:10px;">📷 Фото</button>
        <button class="btn ghost block" id="actEvent">📅 Событие</button>
      `);
      document.getElementById('actPhoto').onclick = () => { closeModal(); document.getElementById('photoFile').click(); };
      document.getElementById('actEvent').onclick = () => { closeModal(); createEventFlow(); };
    };
    document.getElementById('photoFile').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const dataUrl = await resizePhotoToDataUrl(file, 640);
        ws.send(JSON.stringify({ type: 'message', content: 'IMG::' + dataUrl, replyTo: replyingTo?.id || null }));
        cancelReply();
      } catch { showToast('Не удалось прикрепить фото'); }
      e.target.value = '';
    };

    setupComposer({
      textarea: document.getElementById('text'),
      micSendBtn: document.getElementById('micSend'),
      onSend: (content) => {
        ws.send(JSON.stringify({ type: 'message', content, replyTo: replyingTo?.id || null }));
        cancelReply();
      },
      onVoice: async (blob) => {
        // В общем чате голосовое отправляется как есть — остальные могут прослушать,
        // ничего не транскрибируется (в отличие от чата с агентом).
        const dataUrl = await blobToDataUrl(blob);
        ws.send(JSON.stringify({ type: 'message', content: 'AUD::' + dataUrl, replyTo: replyingTo?.id || null }));
        cancelReply();
      }
    });
  }

  // "Сегодня" / "Вчера" / "26 июля" — подпись-разделитель дня определена ниже как общая функция

  function timeline() {
    const items = [
      ...messages.map(m => ({ ts: new Date(m.created_at).getTime(), html: renderCityMsg(m) })),
      ...events.map(e => ({ ts: new Date(e.created_at || e.event_date).getTime(), html: renderEventCard(e) }))
    ];
    items.sort((a, b) => a.ts - b.ts);

    let out = '', lastDay = null;
    for (const item of items) {
      const dayIso = mskDateStr(new Date(item.ts));
      if (dayIso !== lastDay) {
        out += `<div class="date-divider"><span>${dayDividerLabel(dayIso)}</span></div>`;
        lastDay = dayIso;
      }
      out += item.html;
    }
    return out;
  }

  function renderLog(scrollToBottom = false) {
    const log = document.getElementById('log');
    const prevScrollTop = main.scrollTop;
    const prevScrollHeight = main.scrollHeight;
    log.innerHTML = timeline();
    wireLogInteractions();
    if (scrollToBottom) {
      main.scrollTop = main.scrollHeight;
    } else {
      // Реакция/правка/RSVP не должны утаскивать ленту вниз — сохраняем то же место чтения,
      // компенсируя изменение высоты контента выше текущей точки прокрутки.
      main.scrollTop = prevScrollTop + (main.scrollHeight - prevScrollHeight);
    }
    Api.post('/notifications/mark-read', { scope: 'chat' }).then(refreshUnreadCounts).catch(() => {});
  }

  function wireLogInteractions() {
    document.querySelectorAll('.chat-photo').forEach(img => {
      img.onclick = () => openPhotoViewer(img.src);
    });
    document.querySelectorAll('.msg-more').forEach(btn => {
      btn.onclick = () => {
        const msgId = btn.closest('[data-msg-id]').dataset.msgId;
        const msg = messages.find(m => String(m.id) === String(msgId));
        if (msg) openMessageActions(msg);
      };
    });
    document.querySelectorAll('.rsvp-btn').forEach(btn => {
      btn.onclick = async () => {
        const card = btn.closest('.event-card');
        try {
          await Api.post(`/chats/events/${card.dataset.event}/join`, { response: btn.dataset.response });
          events = await Api.get('/chats/city/events');
          renderLog();
        } catch (e) { showToast(e.message); }
      };
    });
    document.querySelectorAll('.delete-event').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Удалить это событие? Отменить будет нельзя.')) return;
        await Api.post(`/chats/events/${btn.dataset.event}/cancel`, {});
        events = events.filter(e => String(e.id) !== String(btn.dataset.event));
        renderLog();
      };
    });
    document.querySelectorAll('.reaction-pill').forEach(pill => {
      pill.onclick = () => {
        haptic(HAPTIC.reaction);
        const msgId = pill.closest('[data-msg-id]').dataset.msgId;
        ws.send(JSON.stringify({ type: 'react', id: msgId, emoji: pill.dataset.emoji }));
      };
    });
    // Тап по тексту сообщения — ответить (цитата), как в Telegram
    document.querySelectorAll('.city-bubble').forEach(el => {
      el.addEventListener('click', () => {
        const msgId = el.closest('[data-msg-id]').dataset.msgId;
        const msg = messages.find(m => String(m.id) === String(msgId));
        if (msg) { replyingTo = msg; renderReplyPreview(); document.getElementById('text')?.focus(); }
      });
    });
    // Зажми сообщение — реакции выскакивают прямо над ним, а не отдельным листом снизу
    document.querySelectorAll('.city-bubble-wrap').forEach(wrap => {
      attachLongPress(wrap, () => {
        const msgId = wrap.closest('[data-msg-id]').dataset.msgId;
        const msg = messages.find(m => String(m.id) === String(msgId));
        if (msg) {
          haptic(HAPTIC.select);
          showReactionPopup(wrap, (emoji) => {
            haptic(HAPTIC.reaction);
            ws.send(JSON.stringify({ type: 'react', id: msg.id, emoji }));
          });
        }
      });
    });
    wireVoicePlayers(document.getElementById('log'));
  }

  function openMessageActions(msg) {
    const isMedia = msg.content.startsWith('IMG::') || msg.content.startsWith('AUD::');
    showModal(`
      ${!isMedia ? '<button class="btn block" id="editMsg" style="margin-bottom:10px;">Изменить</button>' : ''}
      <button class="btn ghost block" id="deleteMsg" style="color:var(--brick);border-color:var(--brick);">Удалить у всех</button>
    `);
    if (!isMedia) {
      document.getElementById('editMsg').onclick = () => {
        closeModal();
        showModal(`
          <h2 style="margin-bottom:10px;">Изменить сообщение</h2>
          <textarea id="editText" style="width:100%;min-height:90px;border:1px solid var(--line);border-radius:12px;padding:10px;background:var(--surface);color:var(--text);">${escapeHtml(msg.content)}</textarea>
          <button class="btn block" id="saveEdit" style="margin-top:12px;">Сохранить</button>
        `);
        document.getElementById('saveEdit').onclick = () => {
          const val = document.getElementById('editText').value.trim();
          if (val) ws.send(JSON.stringify({ type: 'edit', id: msg.id, content: val }));
          closeModal();
        };
      };
    }
    document.getElementById('deleteMsg').onclick = () => {
      closeModal();
      if (confirm('Удалить сообщение у всех? Отменить будет нельзя.')) {
        ws.send(JSON.stringify({ type: 'delete', id: msg.id }));
      }
    };
  }

  async function createEventFlow() {
    showModal(`
      <h2 style="margin-bottom:14px;">Новое событие</h2>
      <div class="field"><label>Название</label><input id="evTitle" type="text" placeholder="Совместная пробежка"></div>
      <div class="field"><label>Дата и время</label><input id="evDate" type="datetime-local" value="${mskDateStr()}T19:00"></div>
      <div class="field">
        <label>Фото (необязательно)</label>
        <input type="file" accept="image/*" id="evPhotoFile" style="display:none;">
        <button class="btn ghost block" id="evPhotoBtn" type="button">📷 Добавить фото</button>
        <div id="evPhotoPreviewBox"></div>
      </div>
      <button class="btn accent-lg" id="evSubmit" style="margin-top:6px;">Создать</button>
    `);

    let photoDataUrl = null;
    document.getElementById('evPhotoBtn').onclick = () => document.getElementById('evPhotoFile').click();
    document.getElementById('evPhotoFile').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        photoDataUrl = await resizePhotoToDataUrl(file, 900);
        document.getElementById('evPhotoPreviewBox').innerHTML = `<img src="${photoDataUrl}" style="width:100%;border-radius:12px;margin-top:8px;display:block;">`;
      } catch { showToast('Не удалось прикрепить фото'); }
    };

    document.getElementById('evSubmit').onclick = async () => {
      const title = document.getElementById('evTitle').value.trim();
      const dateVal = document.getElementById('evDate').value;
      if (!title || !dateVal) { showToast('Заполни название и дату'); return; }
      try {
        await Api.post('/chats/city/events', { title, event_date: dateVal, photo_url: photoDataUrl });
        closeModal();
        showToast('Событие создано');
        events = await Api.get('/chats/city/events');
        renderLog(true);
      } catch (e) { showToast(e.message); }
    };
  }

  renderComposer();
  renderLog(true);

  function connectSocket() {
    const token = Api.getToken();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}&room=city:${data.chat.id}`);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'message') {
        messages.push(msg);
        renderLog(true);
      } else if (msg.type === 'edit') {
        const m = messages.find(x => String(x.id) === String(msg.id));
        if (m) { m.content = msg.content; renderLog(); }
      } else if (msg.type === 'delete') {
        messages = messages.filter(x => String(x.id) !== String(msg.id));
        renderLog();
      } else if (msg.type === 'reactions') {
        const m = messages.find(x => String(x.id) === String(msg.id));
        if (m) {
          const myId = String(Api.getUserId());
          m.reactions = msg.reactions.map(r => ({ emoji: r.emoji, count: r.count, mine: r.userIds.map(String).includes(myId) }));
          renderLog();
        }
      } else if (msg.type === 'error') {
        showToast(msg.error);
      }
    };
  }
  if (isMember) connectSocket();
}

function pluralMembers(n) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'участник';
  if ([2,3,4].includes(mod10) && ![12,13,14].includes(mod100)) return 'участника';
  return 'участников';
}

// Долгий тап (зажатие) — для вызова меню реакций на сообщении
function attachLongPress(el, callback, ms = 450) {
  let timer = null, moved = false, startX = 0, startY = 0, justFired = false;
  el.addEventListener('pointerdown', (e) => {
    moved = false;
    startX = e.clientX; startY = e.clientY;
    timer = setTimeout(() => { if (!moved) { justFired = true; callback(e); } }, ms);
  });
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointermove', (e) => {
    if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) { moved = true; cancel(); }
  });
  // Долгое нажатие уже открыло реакции — гасим последующий click, чтобы заодно
  // не сработал тап-ответ на том же жесте.
  el.addEventListener('click', (e) => {
    if (justFired) { e.stopPropagation(); e.preventDefault(); justFired = false; }
  }, true);
}

// Всплывающие реакции прямо над сообщением (не отдельный лист внизу экрана, как раньше)
function showReactionPopup(anchorEl, onPick) {
  document.querySelectorAll('.reaction-popup').forEach(el => el.remove());
  const rect = anchorEl.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.className = 'reaction-popup';
  popup.innerHTML = REACTION_EMOJIS.map(e => `<button class="reaction-opt" data-emoji="${e}">${e}</button>`).join('');
  document.body.appendChild(popup);

  const popupWidth = popup.offsetWidth, popupHeight = popup.offsetHeight;
  let left = rect.left + rect.width / 2 - popupWidth / 2;
  left = Math.min(Math.max(8, left), window.innerWidth - popupWidth - 8);
  let top = rect.top - popupHeight - 10;
  if (top < 8) top = rect.bottom + 10; // если сверху не влезает — показываем снизу
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';

  popup.querySelectorAll('.reaction-opt').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); onPick(btn.dataset.emoji); popup.remove(); };
  });
  setTimeout(() => {
    const closeOnOutside = (e) => {
      if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('pointerdown', closeOnOutside); }
    };
    document.addEventListener('pointerdown', closeOnOutside);
  }, 60);
}

function openPhotoViewer(url) {
  const ov = document.createElement('div');
  ov.className = 'photo-viewer';
  ov.innerHTML = `<img src="${url}" alt="фото">`;
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
}

// Псевдослучайные, но стабильные "столбики" волны — для декоративного плеера голосового
function voiceBars(seed) {
  let x = (seed || 1) % 100000 + 1, bars = '';
  for (let i = 0; i < 24; i++) {
    x = (x * 9301 + 49297) % 233280;
    bars += `<span class="vbar" style="height:${18 + Math.floor((x / 233280) * 82)}%"></span>`;
  }
  return bars;
}

const PLAY_ICON = '<path d="M7 5l12 7-12 7V5z"/>';
const PAUSE_ICON = '<path d="M7 5h3v14H7zM14 5h3v14h-3z"/>';

// Плеер голосового сообщения в стиле Telegram: своя "волна" вместо нативных браузерных контролов
function renderVoiceMsg(id, url) {
  return `
    <div class="voice-msg" data-audio-msg="${id}">
      <button class="voice-play" aria-label="Слушать"><svg viewBox="0 0 24 24" fill="currentColor">${PLAY_ICON}</svg></button>
      <div class="voice-wave">${voiceBars(id)}</div>
      <span class="voice-time mono">0:00</span>
      <audio preload="metadata" src="${url}"></audio>
    </div>`;
}

function wireVoicePlayers(root) {
  root.querySelectorAll('.voice-msg').forEach(el => {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    const audio = el.querySelector('audio');
    const btn = el.querySelector('.voice-play');
    const timeEl = el.querySelector('.voice-time');
    const bars = [...el.querySelectorAll('.vbar')];

    function fmt(s) {
      s = Math.max(0, Math.round(s || 0));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    audio.addEventListener('loadedmetadata', () => {
      if (isFinite(audio.duration)) timeEl.textContent = fmt(audio.duration);
    });
    audio.addEventListener('timeupdate', () => {
      timeEl.textContent = '-' + fmt(audio.duration - audio.currentTime);
      const activeCount = Math.round((audio.currentTime / (audio.duration || 1)) * bars.length);
      bars.forEach((b, i) => b.classList.toggle('played', i < activeCount));
    });
    audio.addEventListener('ended', () => {
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor">${PLAY_ICON}</svg>`;
      timeEl.textContent = fmt(audio.duration);
      bars.forEach(b => b.classList.remove('played'));
    });
    btn.onclick = () => {
      if (audio.paused) {
        document.querySelectorAll('.voice-msg audio').forEach(a => { if (a !== audio) a.pause(); });
        audio.play();
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor">${PAUSE_ICON}</svg>`;
      } else {
        audio.pause();
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor">${PLAY_ICON}</svg>`;
      }
    };
  });
}

function renderEventCard(ev) {
  const total = ev.going.length + ev.notGoing.length;
  const pct = total ? Math.round((ev.going.length / total) * 100) : 0;
  const d = new Date(ev.event_date);
  const when = `${d.getDate()} ${MONTHS_RU[d.getMonth()]} · ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  return `
  <div class="card event-card" data-event="${ev.id}">
    ${ev.photo_url ? `<img class="event-photo" src="${ev.photo_url}" alt="фото события">` : ''}
    <div class="event-head">
      <div>
        <div class="event-title">${escapeHtml(ev.title)}</div>
        <div class="event-when">${when} (${WEEKDAYS_RU[d.getDay()]})</div>
        ${ev.creatorName ? `<div class="event-organizer">Организатор: ${escapeHtml(ev.creatorName)}</div>` : ''}
      </div>
      ${ev.isMine ? `<button class="icon-btn delete-event" data-event="${ev.id}" title="Удалить событие">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>
      </button>` : ''}
    </div>
    <div class="rsvp-row">
      <button class="rsvp-btn going ${ev.myResponse === 'going' ? 'active' : ''}" data-response="going">Буду (${ev.going.length})</button>
      <button class="rsvp-btn not-going ${ev.myResponse === 'not_going' ? 'active' : ''}" data-response="not_going">Не буду (${ev.notGoing.length})</button>
    </div>
    ${total ? `<div class="rsvp-bar"><div class="rsvp-bar-fill" style="width:${pct}%;"></div></div>
    <div class="rsvp-names">${pct}% идут ${ev.going.length ? '· <b>Идут:</b> ' + ev.going.map(escapeHtml).join(', ') : ''}${ev.notGoing.length ? ' · <b>Не идут:</b> ' + ev.notGoing.map(escapeHtml).join(', ') : ''}</div>` : ''}
  </div>`;
}

// Сжимает фото для чата, сохраняя пропорции (в отличие от квадратного аватара)
function resizePhotoToDataUrl(file, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Подсвечивает @упоминания в тексте сообщения (после экранирования — безопасно)
function highlightMentions(escapedText) {
  return escapedText.replace(/(^|[\s(])@([a-zA-Zа-яА-Я0-9_]{2,32})/g, '$1<span class="mention">@$2</span>');
}

// "Сегодня" / "Вчера" / "26 июля" — подпись-разделитель дня, как в Telegram.
// Общая функция — используется и в общем чате, и в чате с агентом.
function dayDividerLabel(dayIso) {
  const today = mskDateStr();
  const yesterday = addDaysToDateStr(today, -1);
  if (dayIso === today) return 'Сегодня';
  if (dayIso === yesterday) return 'Вчера';
  const [y, m, d] = dayIso.split('-').map(Number);
  return `${d} ${MONTHS_RU[m - 1]}`;
}

function formatMskTime(isoTimestamp) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }).format(new Date(isoTimestamp));
}

function renderCityMsg(m) {
  const who = m.name || m.username || 'Аноним';
  const own = Api.getUserId() && String(m.user_id) === String(Api.getUserId());
  const isImage = m.content.startsWith('IMG::');
  const isAudio = m.content.startsWith('AUD::');
  let body;
  if (isImage) {
    body = `<img class="chat-photo" src="${m.content.slice(5)}" alt="фото">`;
  } else if (isAudio) {
    body = renderVoiceMsg(m.id, m.content.slice(5));
  } else {
    body = `<div class="city-bubble">${highlightMentions(escapeHtml(m.content))}</div>`;
  }
  const replyHtml = m.replyTo ? (() => {
    const snippet = m.replyTo.content.startsWith('IMG::') ? '📷 Фото'
      : m.replyTo.content.startsWith('AUD::') ? '🎤 Голосовое'
      : m.replyTo.content;
    return `<div class="reply-quote"><b>${escapeHtml(m.replyTo.author || 'Аноним')}</b><br>${escapeHtml(snippet).slice(0, 100)}</div>`;
  })() : '';
  const reactionsHtml = (m.reactions && m.reactions.length)
    ? `<div class="reaction-row">${m.reactions.map(r => `<span class="reaction-pill ${r.mine ? 'mine' : ''}" data-emoji="${r.emoji}">${r.emoji} ${r.count}</span>`).join('')}</div>`
    : '';
  return `
    <div class="city-row ${own ? 'own' : ''}" data-msg-id="${m.id}">
      ${avatarHtml(m.name, m.username, m.photo_url)}
      <div class="city-bubble-wrap">
        ${!own ? `<div class="city-who">${escapeHtml(who)}</div>` : ''}
        ${replyHtml}
        ${body}
        ${reactionsHtml}
        <div class="city-meta-row">
          <span class="city-username">@${escapeHtml(m.username || 'user')}</span>
          <span class="city-time">${formatMskTime(m.created_at)}</span>
          ${own ? '<button class="msg-more" aria-label="Действия">⋯</button>' : ''}
        </div>
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
        <span class="avatar-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.5-2h5L16 7"/><circle cx="12" cy="13" r="3.5"/></svg></span>
        <input type="file" accept="image/*" id="avatarFile" style="display:none;">
      </label>
      <div>
        <h1 class="display screen-title" style="margin-bottom:2px;">${escapeHtml(p.name || p.username)}</h1>
        <p class="screen-sub" style="margin-bottom:0;">${p.profession ? escapeHtml(p.profession) : '@' + escapeHtml(p.username)}</p>
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

    <button class="btn ghost block" id="pushBtn" style="margin-bottom:10px;">🔔 Включить уведомления</button>
    <button class="btn ghost block" id="logoutAll">Выйти со всех устройств</button>
  `;

  document.getElementById('pushBtn').onclick = enablePushNotifications;
  updatePushButtonLabel();

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

// Пуш-уведомления: работают даже на заблокированном экране / закрытом приложении,
// если пользователь один раз разрешил их браузеру. На iOS это требует установки
// приложения "На экран домой" — обычная вкладка Safari push не поддерживает вообще,
// это ограничение самого iOS.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function updatePushButtonLabel() {
  const btn = document.getElementById('pushBtn');
  if (!btn) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    btn.textContent = '🔔 Уведомления не поддерживаются в этом браузере';
    btn.disabled = true;
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    btn.textContent = sub ? '🔔 Уведомления включены' : '🔔 Включить уведомления';
  } catch { /* оставляем текст по умолчанию */ }
}

async function enablePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    showToast('Браузер не поддерживает push-уведомления');
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { showToast('Уведомления не разрешены'); return; }

    const { key } = await Api.get('/notifications/vapid-public-key');
    if (!key) { showToast('Push пока не настроен на сервере (нет VAPID-ключей)'); return; }

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key)
      });
    }
    await Api.post('/notifications/push-subscribe', sub.toJSON());
    showToast('Уведомления включены 🔔');
    updatePushButtonLabel();
  } catch (e) {
    showToast('Не удалось включить уведомления');
    console.error(e);
  }
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
  '#/intro': viewIntro,
  '#/promo': viewPromo,
  '#/login': viewLogin,
  '#/register': viewRegister,
  '#/install-app': viewInstallApp,
  '#/onboarding': viewOnboarding,
  '#/agent': viewAgent,
  '#/plan': viewPlan,
  '#/chats': viewChats,
  '#/profile': viewProfile
};

async function router() {
  let hash = location.hash || '#/intro';
  const entryRoutes = ['#/intro', '#/promo', '#/login', '#/register'];
  const protectedRoutes = ['#/agent', '#/plan', '#/chats', '#/profile', '#/onboarding', '#/install-app'];

  if (!Api.getToken()) {
    const ok = await Api.tryRefresh();
    if (ok && entryRoutes.includes(hash)) {
      // Сессия жива (например, приложение открыли заново с экрана домой) —
      // не показываем интро/PIN/вход заново, а сразу ведём внутрь приложения.
      location.hash = '#/agent';
      return;
    }
    if (!ok && protectedRoutes.includes(hash)) {
      location.hash = '#/login';
      return;
    }
  }
  (routes[hash] || viewIntro)();
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
