// Room transport. Credentials are kept in browser storage for reconnection
// and sent in an Authorization header, never in the room code or URL.
const ONLINE = (() => {
  const storageKey = 'hexhaven-online-session';
  const recoveryKey = 'hexhaven-online-recovery';
  let session = null, state = null, timer = null, generation = 0, pending = false;
  let onState = () => {}, onConnection = () => {}, onError = () => {}, onExpired = () => {};

  function saved() {
    try { return JSON.parse(sessionStorage.getItem(storageKey) || 'null'); }
    catch { return null; }
  }
  function recoveries() {
    try {
      const items = JSON.parse(localStorage.getItem(recoveryKey) || '[]');
      return Array.isArray(items) ? items.filter(item => item && typeof item.server === 'string' &&
        typeof item.code === 'string' && typeof item.name === 'string' && typeof item.token === 'string') : [];
    } catch { return []; }
  }
  function sameSeat(a, b) {
    return a.server === b.server && a.code === b.code && a.name && b.name &&
      a.name.toLocaleLowerCase() === b.name.toLocaleLowerCase();
  }
  function save() {
    try { sessionStorage.setItem(storageKey, JSON.stringify(session)); } catch { /* storage may be disabled */ }
    if (!session || !session.name) return;
    try {
      const items = recoveries().filter(item => !sameSeat(item, session));
      items.push(session);
      localStorage.setItem(recoveryKey, JSON.stringify(items.slice(-10)));
    } catch { /* storage may be disabled */ }
  }
  function forget(current, clearTab = true) {
    if (clearTab) try { sessionStorage.removeItem(storageKey); } catch { /* storage may be disabled */ }
    if (!current) return;
    try { localStorage.setItem(recoveryKey, JSON.stringify(recoveries().filter(item => !sameSeat(item, current)))); }
    catch { /* storage may be disabled */ }
  }
  function endpoint(value) {
    const url = new URL(value || location.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
        (url.pathname !== '/' && url.pathname !== '')) throw new Error('Enter a server origin such as https://example.com.');
    return url.origin;
  }
  async function request(path, method, data, current = session) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch((current ? current.server : '') + path, {
        method, signal: controller.signal, cache: 'no-store',
        headers: { ...(data ? { 'Content-Type': 'application/json' } : {}),
          ...(current && current.token ? { Authorization: 'Bearer ' + current.token } : {}) },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
      let json;
      try { json = await response.json(); }
      catch { throw new Error('Room service unavailable at this address.'); }
      if (!response.ok) {
        const error = new Error(json.error || 'Room request failed.');
        error.status = response.status;
        if (response.status === 409 && json.version !== undefined) error.snapshot = json;
        throw error;
      }
      return json;
    } finally { clearTimeout(timeout); }
  }
  function apply(next) {
    if (state && next.version < state.version) return;
    state = next;
    if (session && next.players && next.players[next.playerId]) {
      session.name = next.players[next.playerId].name;
      save();
    }
    onState(next);
  }
  async function poll(id) {
    if (!session || id !== generation) return;
    const current = session;
    try {
      const result = await request('/api/rooms/' + current.code + '/state', 'GET', null, current);
      if (id !== generation) return;
      onConnection(true);
      if (!state || result.version !== state.version) apply(result);
    } catch (error) {
      if (id !== generation) return;
      onConnection(false);
      if (error.status === 401 || error.status === 404) {
        suspend(true);
        onExpired(error.message);
        return;
      }
    }
    if (id === generation) timer = setTimeout(() => poll(id), 1200);
  }
  function begin(nextSession, initial) {
    suspend(false);
    session = nextSession; state = null; save();
    const id = ++generation;
    if (initial) { onConnection(true); apply(initial); }
    poll(id);
  }
  async function create(server, name, radius) {
    const origin = endpoint(server);
    const result = await request('/api/rooms', 'POST', { name, radius }, { server: origin });
    begin({ server: origin, code: result.code, token: result.token }, result);
  }
  async function join(server, code, name) {
    const origin = endpoint(server), room = String(code).trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(room)) throw new Error('Enter the six-character room code.');
    const seat = { server: origin, code: room, name: String(name).trim() };
    const previous = recoveries().find(item => sameSeat(item, seat));
    if (previous && previous.token) {
      try {
        const result = await request('/api/rooms/' + room + '/state', 'GET', null, previous);
        begin(previous, result);
        return;
      } catch (error) {
        if (error.status !== 401 && error.status !== 404) throw error;
        forget(previous, false);
      }
    }
    const result = await request('/api/rooms/' + room + '/join', 'POST', { name }, { server: origin });
    begin({ server: origin, code: room, token: result.token }, result);
  }
  function resume() {
    const previous = saved();
    if (!previous || !previous.server || !previous.code || !previous.token) return false;
    begin(previous, null);
    return true;
  }
  async function send(operation, action) {
    if (!session || !state || pending) return false;
    const id = generation, current = session;
    pending = true;
    try {
      const result = await request('/api/rooms/' + current.code + '/' + operation, 'POST',
        { version: state.version, ...(action ? { action } : {}) }, current);
      if (id !== generation) return false;
      onConnection(true); apply(result); return true;
    } catch (error) {
      if (id === generation) {
        if (error.snapshot) apply(error.snapshot);
        if (!error.status) onConnection(false);
        onError(error.status ? error.message : 'Connection lost. Reconnecting…');
      }
      return false;
    } finally { if (id === generation) pending = false; }
  }
  async function leave() {
    if (!session) return;
    if (state && !state.started) {
      try { await request('/api/rooms/' + session.code + '/leave', 'POST', {}, session); }
      catch (error) { onError(error.message); return false; }
      suspend(true);
    } else suspend(false); // retain this tab's credential for reconnecting
    return true;
  }
  function suspend(remove) {
    const previous = session;
    generation++; clearTimeout(timer); timer = null; session = null; state = null; pending = false;
    if (remove) forget(previous);
  }
  return {
    configure(callbacks) { ({ onState, onConnection, onError, onExpired } = callbacks); },
    create, join, resume, start: () => send('start'), act: action => send('action', action),
    leave, suspend, hasSaved: () => !!saved(), current: () => state, server: () => session && session.server,
  };
})();
