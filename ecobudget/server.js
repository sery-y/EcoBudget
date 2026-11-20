// server.js — Serveur EcoBudget (Node.js, aucune dépendance externe)
// - Sert le site statique du dossier /public
// - Authentification : inscription, connexion, déconnexion (cookie de session signé)
// - API  GET/PUT /api/state : lit/écrit les données de l'utilisateur connecté (data/users/<id>.json)
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // local uniquement par défaut (données personnelles)
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== 'false'; // ALLOW_SIGNUP=false : plus aucune nouvelle inscription
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const USER_DATA_DIR = path.join(DATA_DIR, 'users');
const LEGACY_FILE = path.join(DATA_DIR, 'data.json'); // ancien fichier unique (avant l'authentification)
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const MAX_BODY = 25 * 1024 * 1024; // 25 Mo (les icônes de catégories sont stockées en base64)
const SESSION_DAYS = 30;
const COOKIE_NAME = 'ecobudget_session';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
};

// ---------- Réponses HTTP ----------
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    ...headers
  });
  res.end(body);
}
function sendJson(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', ...headers });
}

// ---------- Écriture de fichiers ----------
let writeQueue = Promise.resolve(); // sérialise toutes les écritures pour éviter toute corruption
function enqueue(task) {
  const result = writeQueue.then(task);
  writeQueue = result.catch(() => {});
  return result;
}
async function atomicWrite(file, text, mode = 0o644) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, text, { encoding: 'utf8', mode });
  await fsp.rename(tmp, file); // écriture atomique : le fichier n'est jamais à moitié écrit
}
async function readFileOrNull(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(httpError(413, 'Corps de requête trop volumineux'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJsonBody(req) {
  if (!(req.headers['content-type'] || '').includes('application/json')) {
    throw httpError(415, 'Content-Type application/json requis');
  }
  const body = await readBody(req);
  try { return JSON.parse(body || '{}'); } catch { throw httpError(400, 'JSON invalide'); }
}

// ---------- Utilisateurs ----------
let users = []; // [{ id, username, name, passwordHash, createdAt }]
async function loadUsers() {
  const raw = await readFileOrNull(USERS_FILE);
  users = raw ? (JSON.parse(raw).users || []) : []; // si le fichier est corrompu, on s'arrête : on ne veut rien écraser
}
const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name });
const userFile = (id) => path.join(USER_DATA_DIR, `${id}.json`);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const [, saltHex, keyHex] = stored.split('$');
  const expected = Buffer.from(keyHex, 'hex');
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(key, expected);
}
let DUMMY_HASH = ''; // sert à garder le même temps de réponse quand l'identifiant n'existe pas

// ---------- Sessions (cookie signé, sans état côté serveur) ----------
let SECRET = null;
async function loadSecret() {
  if (process.env.SESSION_SECRET) { SECRET = Buffer.from(process.env.SESSION_SECRET); return; }
  const raw = await readFileOrNull(SECRET_FILE);
  if (raw && raw.trim().length >= 64) { SECRET = Buffer.from(raw.trim(), 'hex'); return; }
  SECRET = crypto.randomBytes(32);
  await atomicWrite(SECRET_FILE, SECRET.toString('hex'), 0o600);
}
function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
function createToken(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_DAYS * 86400000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}
function currentUser(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!uid || !(exp > Date.now())) return null;
    return users.find(u => u.id === uid) || null;
  } catch { return null; }
}
function cookieHeader(req, value, maxAgeSeconds) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  return `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

// ---------- Limitation des tentatives (anti force brute) ----------
const failures = new Map(); // ip -> { count, since }
const MAX_FAILURES = 10;
const FAILURE_WINDOW = 10 * 60 * 1000;
function clientIp(req) { return req.socket.remoteAddress || 'unknown'; }
function checkRateLimit(req) {
  const entry = failures.get(clientIp(req));
  if (!entry) return;
  if (Date.now() - entry.since > FAILURE_WINDOW) { failures.delete(clientIp(req)); return; }
  if (entry.count >= MAX_FAILURES) throw httpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
}
function recordFailure(req) {
  const ip = clientIp(req);
  const entry = failures.get(ip);
  if (!entry || Date.now() - entry.since > FAILURE_WINDOW) failures.set(ip, { count: 1, since: Date.now() });
  else entry.count += 1;
}
setInterval(() => {
  for (const [ip, entry] of failures) if (Date.now() - entry.since > FAILURE_WINDOW) failures.delete(ip);
}, 60 * 1000).unref();

// ---------- Routes d'authentification ----------
function validateCredentials(body, { signup }) {
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (signup) {
    if (!/^[a-z0-9_.@-]{3,40}$/.test(username)) {
      throw httpError(400, 'Identifiant invalide : 3 à 40 caractères (lettres, chiffres, . _ - @).');
    }
    if (password.length < 8) throw httpError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
  }
  if (!username || !password || password.length > 200) throw httpError(400, 'Identifiant et mot de passe requis.');
  return { username, password };
}

async function handleRegister(req, res) {
  if (!ALLOW_SIGNUP && users.length > 0) throw httpError(403, 'Les inscriptions sont fermées.');
  checkRateLimit(req);
  const body = await readJsonBody(req);
  const { username, password } = validateCredentials(body, { signup: true });
  const name = String(body.name || '').trim().slice(0, 40) || username;
  const passwordHash = await hashPassword(password);

  const user = await enqueue(async () => {
    if (!ALLOW_SIGNUP && users.length > 0) throw httpError(403, 'Les inscriptions sont fermées.');
    if (users.some(u => u.username === username)) throw httpError(409, 'Cet identifiant est déjà utilisé.');
    const created = { id: crypto.randomUUID(), username, name, passwordHash, createdAt: new Date().toISOString() };
    // Le tout premier compte récupère les données de l'ancienne version sans authentification (data/data.json)
    if (users.length === 0 && await readFileOrNull(LEGACY_FILE) !== null) {
      await fsp.mkdir(USER_DATA_DIR, { recursive: true });
      await fsp.copyFile(LEGACY_FILE, userFile(created.id));
      await fsp.rename(LEGACY_FILE, `${LEGACY_FILE}.migrated`);
    }
    await atomicWrite(USERS_FILE, JSON.stringify({ users: [...users, created] }, null, 2), 0o600);
    users = [...users, created];
    return created;
  });

  sendJson(res, 201, { user: publicUser(user) }, {
    'Set-Cookie': cookieHeader(req, createToken(user.id), SESSION_DAYS * 86400)
  });
}

async function handleLogin(req, res) {
  checkRateLimit(req);
  const body = await readJsonBody(req);
  const { username, password } = validateCredentials(body, { signup: false });
  const user = users.find(u => u.username === username);
  const valid = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !valid) {
    recordFailure(req);
    throw httpError(401, 'Identifiant ou mot de passe incorrect.');
  }
  failures.delete(clientIp(req));
  sendJson(res, 200, { user: publicUser(user) }, {
    'Set-Cookie': cookieHeader(req, createToken(user.id), SESSION_DAYS * 86400)
  });
}

function handleLogout(req, res) {
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
}

// ---------- API des données ----------
async function handleState(req, res, user) {
  const file = userFile(user.id);

  if (req.method === 'GET') {
    const raw = await readFileOrNull(file);
    if (raw === null) return send(res, 204, '');
    try { JSON.parse(raw); } catch {
      return sendJson(res, 500, { error: 'Le fichier de données est corrompu. Corrigez-le ou supprimez-le.' });
    }
    return send(res, 200, raw, { 'Content-Type': 'application/json; charset=utf-8' });
  }

  if (req.method === 'PUT' || req.method === 'POST') { // POST : utilisé par sendBeacon à la fermeture de la page
    const data = await readJsonBody(req);
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.transactions)) {
      throw httpError(400, 'Structure de données invalide');
    }
    await enqueue(() => atomicWrite(file, JSON.stringify(data, null, 2)));
    return sendJson(res, 200, { ok: true });
  }

  res.setHeader('Allow', 'GET, PUT, POST');
  throw httpError(405, 'Méthode non autorisée');
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function handleApi(req, res, pathname) {
  if (req.method !== 'GET' && !sameOrigin(req)) throw httpError(403, 'Origine non autorisée');

  if (pathname === '/api/auth/register' && req.method === 'POST') return handleRegister(req, res);
  if (pathname === '/api/auth/login' && req.method === 'POST') return handleLogin(req, res);
  if (pathname === '/api/auth/logout' && req.method === 'POST') return handleLogout(req, res);

  const user = currentUser(req);
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    if (!user) throw httpError(401, 'Non connecté');
    return sendJson(res, 200, { user: publicUser(user) });
  }
  if (pathname === '/api/auth/config' && req.method === 'GET') {
    return sendJson(res, 200, { signupOpen: ALLOW_SIGNUP || users.length === 0, firstUser: users.length === 0 });
  }
  if (pathname === '/api/state') {
    if (!user) throw httpError(401, 'Non connecté');
    return handleState(req, res, user);
  }
  throw httpError(404, 'Introuvable');
}

// ---------- Fichiers statiques ----------
async function handleStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return send(res, 405, 'Méthode non autorisée');
  }
  const loggedIn = Boolean(currentUser(req));
  if ((pathname === '/' || pathname === '/index.html') && !loggedIn) return send(res, 302, '', { Location: '/login.html' });
  if (pathname === '/login.html' && loggedIn) return send(res, 302, '', { Location: '/' });

  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return send(res, 400, 'Requête invalide'); }
  if (decoded.includes('\0')) return send(res, 400, 'Requête invalide');

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 403, 'Accès refusé'); // protection contre ../
  }
  try {
    const content = await fsp.readFile(filePath);
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    return send(res, 200, req.method === 'HEAD' ? '' : content, { 'Content-Type': type });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return send(res, 404, 'Introuvable');
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    return await handleStatic(req, res, pathname);
  } catch (error) {
    if (!error.status) console.error(error);
    if (!res.headersSent) sendJson(res, error.status || 500, { error: error.status ? error.message : 'Erreur interne du serveur' });
    else res.end();
  }
});

async function main() {
  await fsp.mkdir(USER_DATA_DIR, { recursive: true });
  await loadSecret();
  await loadUsers();
  DUMMY_HASH = await hashPassword(crypto.randomBytes(8).toString('hex'));
  server.listen(PORT, HOST, () => {
    console.log(`EcoBudget démarré : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`Données : ${DATA_DIR} (${users.length} compte${users.length > 1 ? 's' : ''}, inscriptions ${ALLOW_SIGNUP ? 'ouvertes' : 'fermées'})`);
  });
}
main().catch(error => { console.error('Démarrage impossible :', error.message); process.exit(1); });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    // laisse finir les écritures en cours avant de quitter
    writeQueue.finally(() => server.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
