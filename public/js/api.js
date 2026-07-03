// Обёртка над fetch: сама подставляет токен и обновляет его при истечении.
const Api = (() => {
  let accessToken = null;
  let currentUserId = null;

  async function request(path, { method = 'GET', body, isForm } = {}) {
    const headers = {};
    if (!isForm) headers['Content-Type'] = 'application/json';
    if (accessToken) headers['Authorization'] = 'Bearer ' + accessToken;

    let res = await fetch('/api' + path, {
      method,
      headers,
      credentials: 'include',
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined
    });

    if (res.status === 401 && path !== '/auth/refresh') {
      const refreshed = await tryRefresh();
      if (refreshed) {
        headers['Authorization'] = 'Bearer ' + accessToken;
        res = await fetch('/api' + path, {
          method, headers, credentials: 'include',
          body: body ? (isForm ? body : JSON.stringify(body)) : undefined
        });
      }
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
  }

  async function tryRefresh() {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!res.ok) return false;
      const data = await res.json();
      accessToken = data.accessToken;
      currentUserId = data.userId;
      return true;
    } catch { return false; }
  }

  function setToken(t) { accessToken = t; }
  function getToken() { return accessToken; }
  function setUserId(id) { currentUserId = id; }
  function getUserId() { return currentUserId; }

  return {
    get: (p) => request(p),
    post: (p, body) => request(p, { method: 'POST', body }),
    patch: (p, body) => request(p, { method: 'PATCH', body }),
    del: (p) => request(p, { method: 'DELETE' }),
    tryRefresh, setToken, getToken, setUserId, getUserId
  };
})();
