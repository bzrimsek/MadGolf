/* An in-memory Firebase for MadGolf, swapped in at the network layer.
 *
 * Modelled on Bottlefolio's fake-firebase.js, with one difference that
 * matters: MadGolf imports the MODULAR v10 SDK as ES modules from
 * www.gstatic.com (firebase-app.js, firebase-auth.js, firebase-database.js),
 * not the compat bundle. So this serves three small ES modules in their place,
 * and index.html loads UNMODIFIED.
 *
 * All of MadGolf's data travels over the Realtime Database REST API (fbWrite /
 * fbLoad / admin registry / live boards / score.html), so the store lives HERE,
 * in Node, behind a Playwright route on the RTDB host. One store serves every
 * page - the app, live.html and score.html see the same tree, as they would
 * against the real database. The SDK's own ref/get/set are exposed by the app
 * but not called; the stub routes them to the same REST host so that, if they
 * ever are, they land in this store too and never on the network.
 *
 *   const fake = require('./fake-firebase.js');
 *   const store = fake.createStore(seedTree);      // nested object, not paths
 *   await page.route(fake.RTDB_ORIGIN + '/**', r => store.handleRest(r));
 *   await page.route(fake.SDK_PATTERN, r => fake.serveSdk(r));
 *   await page.addInitScript(fake.userInit({ uid, email, displayName }));
 *
 * store.log is every operation, in order: { seq, t, op, path, auth, bytes }.
 */
'use strict';

const RTDB_HOST = 'madgolf-c8789-default-rtdb.firebaseio.com';
const RTDB_ORIGIN = 'https://' + RTDB_HOST;
const SDK_PATTERN = /^https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/firebase-(app|auth|database)\.js$/;
const IDTK_PATTERN = /^https:\/\/identitytoolkit\.googleapis\.com\//;

// Firebase stores neither undefined nor null: a null write DELETES.
function clone(v) {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(clone);
  if (typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach(k => { if (v[k] !== undefined && v[k] !== null) o[k] = clone(v[k]); });
    return o;
  }
  return v;
}
const parts = p => String(p || '').split('/').filter(Boolean).map(decodeURIComponent);

function createStore(seed, opts) {
  const o = opts || {};
  const store = { data: clone(seed) || {}, log: [], seq: 0 };
  const t0 = Date.now();

  function readAt(path) {
    let node = store.data;
    for (const k of parts(path)) {
      if (node === null || typeof node !== 'object') return null;
      node = node[k];
      if (node === undefined) return null;
    }
    return node === undefined ? null : node;
  }
  function writeAt(path, value) {
    const ps = parts(path);
    if (!ps.length) { store.data = clone(value) || {}; return; }
    let node = store.data;
    for (let i = 0; i < ps.length - 1; i++) {
      if (node[ps[i]] === null || typeof node[ps[i]] !== 'object') node[ps[i]] = {};
      node = node[ps[i]];
    }
    const last = ps[ps.length - 1];
    if (value === null || value === undefined) delete node[last];
    else node[last] = clone(value);
  }
  const record = (op, path, extra) => {
    const e = Object.assign({ seq: ++store.seq, t: Date.now() - t0, op, path }, extra || {});
    store.log.push(e);
    return e;
  };

  /* The REST API: GET / PUT / PATCH / DELETE on <path>.json[?auth=...].
     A write without ?auth= is refused 401 the way the real rules would refuse
     it for every path the app writes, so a write that forgot its token fails
     here rather than passing. Reads of live/ are public (live.html reads
     without auth), everything else needs a token. */
  async function handleRest(route) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const path = url.pathname.replace(/\.json$/, '');
    const auth = url.searchParams.get('auth');
    const isLive = /^\/bz-apps\/golf\/live\//.test(path);
    if (method === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: cors() });
    }
    if (!auth && !(method === 'GET' && isLive)) {
      record('refused', path, { method, why: 'no auth token' });
      return route.fulfill({ status: 401, headers: cors(), contentType: 'application/json',
        body: JSON.stringify({ error: 'Permission denied' }) });
    }
    if (method === 'GET') {
      const e = record('get', path, { auth: !!auth });
      // Real latency on the read, so a write fired while the load is still in
      // flight is caught in the act rather than raced past.
      const delay = o.getDelay != null ? o.getDelay(path) : 0;
      if (delay) await new Promise(r => setTimeout(r, delay));
      e.servedSeq = ++store.seq;            // the moment the answer left
      e.servedAt = Date.now() - t0;
      return route.fulfill({ status: 200, headers: cors(), contentType: 'application/json',
        body: JSON.stringify(readAt(path)) });
    }
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (err) {
      record('bad-body', path, { method });
      return route.fulfill({ status: 400, headers: cors(), body: '{"error":"Invalid data"}' });
    }
    const bytes = (req.postData() || '').length;
    if (method === 'PUT') {
      record('put', path, { auth: !!auth, bytes });
      writeAt(path, body);
    } else if (method === 'PATCH') {
      record('patch', path, { auth: !!auth, bytes, keys: Object.keys(body || {}) });
      Object.keys(body || {}).forEach(k => writeAt(path + '/' + k, body[k]));
    } else if (method === 'DELETE') {
      record('delete', path, { auth: !!auth });
      writeAt(path, null);
    } else {
      record('unknown-method', path, { method });
      return route.fulfill({ status: 405, headers: cors(), body: '{}' });
    }
    return route.fulfill({ status: 200, headers: cors(), contentType: 'application/json',
      body: JSON.stringify(body) });
  }

  /* identitytoolkit accounts:signUp — the anonymous sign-in score.html does. */
  async function handleIdentity(route) {
    const url = route.request().url();
    record('identity', new URL(url).pathname);
    if (/accounts:signUp/.test(url)) {
      return route.fulfill({ status: 200, headers: cors(), contentType: 'application/json',
        body: JSON.stringify({ idToken: 'fake-anon-token-' + store.seq, localId: 'anon' + store.seq,
          refreshToken: 'r', expiresIn: '3600' }) });
    }
    return route.fulfill({ status: 200, headers: cors(), contentType: 'application/json', body: '{}' });
  }

  store.read = readAt;
  store.write = writeAt;
  store.handleRest = handleRest;
  store.handleIdentity = handleIdentity;
  return store;
}

function cors() {
  return { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,PATCH,DELETE,POST,OPTIONS',
    'access-control-allow-headers': 'content-type' };
}

/* The three SDK modules. Each reads the signed-in user from
   window.__FAKE_FB_USER, which userInit() plants before any script runs. */
const SDK = {
  app: `
export function initializeApp(config) { return { name: '[DEFAULT]', options: config }; }
export function getApp() { return { name: '[DEFAULT]' }; }
`,
  auth: `
const u = window.__FAKE_FB_USER || null;
const user = u ? Object.assign({}, u, {
  getIdToken: () => Promise.resolve('fake-id-token-' + u.uid),
}) : null;
const auth = { currentUser: user };
export function getAuth() { return auth; }
export function GoogleAuthProvider() { this.addScope = () => {}; this.setCustomParameters = () => {}; }
export function onAuthStateChanged(a, cb) {
  // Asynchronously, like the real one.
  setTimeout(() => cb(auth.currentUser), 0);
  return () => {};
}
export function signInWithPopup() { return Promise.resolve({ user: auth.currentUser }); }
export function signOut() { auth.currentUser = null; return Promise.resolve(); }
`,
  database: `
const BASE = '${RTDB_ORIGIN}';
export function getDatabase(app) { return { app }; }
export function ref(db, path) { return { path: String(path || '') }; }
async function call(r, method, v) {
  const res = await fetch(BASE + '/' + r.path.replace(/^\\/+/, '') + '.json?auth=sdk',
    method === 'GET' ? {} : { method, body: JSON.stringify(v) });
  const d = await res.json();
  return d;
}
export async function get(r) {
  const v = await call(r, 'GET');
  return { val: () => v, exists: () => v !== null && v !== undefined, key: r.path.split('/').pop() };
}
export function set(r, v) { return call(r, 'PUT', v).then(() => undefined); }
export function onDisconnect() { return { remove: () => Promise.resolve(), set: () => Promise.resolve(), cancel: () => Promise.resolve() }; }
`
};

function serveSdk(route) {
  const m = route.request().url().match(SDK_PATTERN);
  return route.fulfill({ status: 200, contentType: 'text/javascript',
    headers: { 'access-control-allow-origin': '*' }, body: SDK[m[1]] });
}

function userInit(user) {
  return 'window.__FAKE_FB_USER = ' + JSON.stringify(user || null) + ';';
}

module.exports = { createStore, serveSdk, userInit, RTDB_HOST, RTDB_ORIGIN, SDK_PATTERN, IDTK_PATTERN };
