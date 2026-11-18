// Dependency-free room service and static file server. Room state is in memory.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Game, GameError } = require('./game');

const root = path.resolve(__dirname, '..');
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const lifetime = 12 * 60 * 60 * 1000;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

function createServer() {
  const rooms = new Map();
  function code() {
    let value;
    do { value = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); }
    while (rooms.has(value));
    return value;
  }
  function nameOf(value) {
    if (typeof value !== 'string') throw new GameError('Enter a player name.');
    const name = value.trim();
    if (!name || name.length > 24 || /[\x00-\x1f\x7f]/.test(name)) throw new GameError('Use a name of 1–24 characters.');
    return name;
  }
  function cleanRooms() {
    const cutoff = Date.now() - lifetime;
    for (const [key, room] of rooms) if (room.lastActive < cutoff) rooms.delete(key);
  }
  function reply(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(data));
  }
  function body(req) {
    return new Promise((resolve, reject) => {
      let text = '', bytes = 0;
      req.setEncoding('utf8');
      req.on('data', chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes <= 16384) text += chunk;
      });
      req.on('end', () => {
        if (bytes > 16384) return reject(new GameError('Request too large.'));
        try { const value = JSON.parse(text || '{}');
          if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
          resolve(value);
        } catch { reject(new GameError('Invalid request.')); }
      });
      req.on('error', reject);
    });
  }
  function view(room, player) {
    const pid = room.players.indexOf(player);
    return { code: room.code, playerId: pid, host: pid === 0, version: room.version,
      players: room.players.map(p => ({ name: p.name })), started: !!room.game,
      ...(room.game ? room.game.view(pid) : {}) };
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'OPTIONS') return reply(res, 204, {});
      cleanRooms();
      try {
        if (req.method === 'POST' && url.pathname === '/api/rooms') {
          const data = await body(req), name = nameOf(data.name);
          if (rooms.size >= 200) return reply(res, 503, { error: 'Room limit reached. Try again later.' });
          if (![2, 3].includes(data.radius)) throw new GameError('Invalid island size.');
          const player = { name, token: crypto.randomBytes(24).toString('hex') };
          const room = { code: code(), players: [player], radius: data.radius, game: null, version: 0, lastActive: Date.now() };
          rooms.set(room.code, room);
          return reply(res, 201, { token: player.token, ...view(room, player) });
        }
        const match = /^\/api\/rooms\/([A-Z2-9]{6})\/(join|state|start|action|leave)$/.exec(url.pathname);
        if (!match) return reply(res, 404, { error: 'Not found.' });
        const room = rooms.get(match[1]), operation = match[2];
        if (!room) return reply(res, 404, { error: 'Room not found or expired.' });
        if (operation === 'join' && req.method === 'POST') {
          const data = await body(req), name = nameOf(data.name);
          if (rooms.get(room.code) !== room) return reply(res, 404, { error: 'Room not found or expired.' });
          if (room.game) throw new GameError('This game has already started.');
          if (room.players.length >= 4) throw new GameError('This room is full.');
          if (room.players.some(p => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new GameError('Choose a different name.');
          const player = { name, token: crypto.randomBytes(24).toString('hex') };
          room.players.push(player); room.version++; room.lastActive = Date.now();
          return reply(res, 201, { token: player.token, ...view(room, player) });
        }
        const token = (req.headers.authorization || '').replace(/^Bearer /, '');
        const player = room.players.find(p => p.token === token);
        if (!player) return reply(res, 401, { error: 'Session not found. Join the room again.' });
        room.lastActive = Date.now();
        const pid = room.players.indexOf(player);
        if (operation === 'state' && req.method === 'GET') return reply(res, 200, view(room, player));
        if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed.' });
        if (operation === 'leave') {
          if (room.game) throw new GameError('A started game keeps its seats for reconnection.');
          room.players.splice(pid, 1); room.version++;
          if (!room.players.length) rooms.delete(room.code);
          return reply(res, 200, { ok: true });
        }
        const data = await body(req);
        if (rooms.get(room.code) !== room || !room.players.includes(player)) return reply(res, 404, { error: 'Room not found or expired.' });
        if (data.version !== room.version) return reply(res, 409, { error: 'The game changed. Try again.', ...view(room, player) });
        if (operation === 'start') {
          if (pid !== 0 || room.game || room.players.length < 2) throw new GameError('The host needs at least two players to start.');
          room.game = new Game(room.players.map(p => p.name), room.radius);
        } else if (operation === 'action') {
          if (!room.game) throw new GameError('The game has not started.');
          room.game.act(pid, data.action);
        } else return reply(res, 404, { error: 'Not found.' });
        room.version++;
        return reply(res, 200, view(room, player));
      } catch (err) {
        if (!(err instanceof GameError)) console.error('Room service error:', err);
        return reply(res, err instanceof GameError ? 400 : 500,
          { error: err instanceof GameError ? err.message : 'Server error.' });
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!(pathname === '/index.html' || /^\/(js|css|assets)\/[a-zA-Z0-9_.\/-]+$/.test(pathname)) || pathname.includes('..')) {
      res.writeHead(404); return res.end();
    }
    const file = path.join(root, pathname), type = mime[path.extname(file)];
    if (!type) { res.writeHead(404); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, '0.0.0.0', () => console.log(`Hex Haven room service listening on ${port}`));
}
module.exports = { createServer };
