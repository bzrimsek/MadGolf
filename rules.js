#!/usr/bin/env node
/* THE FIREBASE RULES, READ AND DEPLOYED WITHOUT A PASTE.
   Ported from Bottlefolio's rules.js on 2026-10-03.

   A Realtime Database has ONE rules document for the whole database, and
   this app owns one branch of it: rules -> bz-apps -> golf. Pasting the whole
   file over the console replaces everything else in it. So nothing here
   writes the whole document from the file: a deploy reads the LIVE rules,
   swaps in this app's branch and nothing else, writes that back, and reads
   it again to prove the branch matches the file and nothing else moved.

     node rules.js get       print the live rules
     node rules.js pull      write the live golf branch into firebase-rules.json
     node rules.js diff      what differs in this app's branch
     node rules.js deploy    swap this app's branch in, then confirm

   The key: FIREBASE_SA (the service account JSON, as the cloud gate passes
   it) or FIREBASE_SA_FILE (a path to it, as BZ's PC does:
   %USERPROFILE%\.madgolf\firebase-admin.json). Never in this folder - push.py
   refuses any key file.

   Exit 0 when the command did what it says; 1 otherwise, with the reason. */
const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');

/* THE DATABASE THE APP ACTUALLY USES, read from index.html's own Firebase
   config rather than typed here. Bottlefolio typed it, and its first rules
   deploy went to a database the app had stopped using - read back,
   "verified", and wrong. Read from the app, the two cannot disagree. */
const APP = (function () {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const db = html.match(/databaseURL:\s*["']([^"']+)["']/);
  const project = html.match(/projectId:\s*["']([^"']+)["']/);
  if (!db || !project) {
    console.log('  ✖ rules: no databaseURL or projectId in index.html');
    process.exit(1);
  }
  return { db: db[1].replace(/\/$/, ''), project: project[1] };
})();
const DB = APP.db;
const FILE = path.join(__dirname, 'firebase-rules.json');
const BRANCH = ['bz-apps', 'golf'];        // the only part this app owns

function fail(msg) {
  console.log('  ✖ rules: ' + msg);
  process.exit(1);
}

function credentials() {
  const raw = process.env.FIREBASE_SA
    || (process.env.FIREBASE_SA_FILE && fs.readFileSync(process.env.FIREBASE_SA_FILE, 'utf8'));
  if (!raw) fail('no key - set FIREBASE_SA (the JSON) or FIREBASE_SA_FILE (its path)');
  let key;
  try { key = JSON.parse(raw); } catch (e) { fail('the key is not valid JSON'); }
  // A key for another project would be refused by Firebase anyway - or,
  // worse, accepted by that other project's database. Stopped here, by name.
  if (key.project_id !== APP.project)
    fail('the key is for project "' + key.project_id + '" but the app uses "' + APP.project + '"');
  return key;
}

async function token() {
  const auth = new GoogleAuth({
    credentials: credentials(),
    scopes: ['https://www.googleapis.com/auth/firebase.database',
             'https://www.googleapis.com/auth/userinfo.email']
  });
  const client = await auth.getClient();
  const t = await client.getAccessToken();
  return (t && t.token) || t;
}

async function liveText(tok) {
  const r = await fetch(DB + '/.settings/rules.json',
    { headers: { Authorization: 'Bearer ' + tok } });
  if (!r.ok) fail('reading the live rules gave HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.text();
}

/* Rules may carry // and /* comments, which JSON does not allow. Removed
   outside strings only, so a "//" inside a rule expression survives. */
function stripComments(text) {
  let out = '', i = 0, inStr = false;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') { out += n || ''; i += 2; continue; }
      if (c === '"') inStr = false;
      i++;
    } else if (c === '"') { inStr = true; out += c; i++; }
    else if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; }
    else if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; }
    else { out += c; i++; }
  }
  return out;
}

function hasComments(text) {
  return stripComments(text).replace(/\s+/g, '') !== text.replace(/\s+/g, '');
}

function branchOf(doc) {
  let node = doc && doc.rules;
  for (const k of BRANCH) node = node && node[k];
  return node;
}

/* Sorted keys, so two documents that differ only in order compare equal. */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).sort().forEach(k => { o[k] = canon(v[k]); });
    return o;
  }
  return v;
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/* Every path where the two branches disagree, with both values. */
function differences(a, b, at, out) {
  if (same(a, b)) return out;
  const objs = a && b && typeof a === 'object' && typeof b === 'object';
  if (!objs) { out.push({ at, live: a, file: b }); return out; }
  new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k =>
    differences(a[k], b[k], at + '/' + k, out));
  return out;
}

function fileDoc() {
  const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  // The file must own exactly this app's branch and nothing else, or a
  // deploy would be deciding rules for somebody else.
  const top = Object.keys(doc.rules || {});
  const under = Object.keys((doc.rules || {})[BRANCH[0]] || {});
  if (top.join() !== BRANCH[0] || under.join() !== BRANCH[1])
    fail('firebase-rules.json must hold only rules → ' + BRANCH.join(' → ') + '; it holds ' + top.join(', ') + ' / ' + under.join(', '));
  return doc;
}

async function main() {
  const cmd = process.argv[2] || 'diff';
  const tok = await token();
  const text = await liveText(tok);
  let live;
  try { live = JSON.parse(stripComments(text)); } catch (e) { fail('the live rules could not be read as JSON: ' + e.message); }

  if (cmd === 'get') { console.log(text); return; }

  if (cmd === 'pull') {
    /* The live branch becomes the file. Used once, on 2026-10-03, because the
       file in the folder predated the live-scoring rules; and whenever the
       console has been edited by hand, so the file catches up rather than a
       deploy undoing the console edit. */
    const doc = { rules: {} };
    doc.rules[BRANCH[0]] = {};
    doc.rules[BRANCH[0]][BRANCH[1]] = branchOf(live);
    if (!doc.rules[BRANCH[0]][BRANCH[1]]) fail('the live rules have no ' + BRANCH.join('/') + ' branch');
    fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
    console.log('  ✓ firebase-rules.json now holds the live ' + BRANCH.join('/') + ' rules');
    return;
  }

  const file = fileDoc();
  const others = Object.keys(live.rules || {}).filter(k => k !== BRANCH[0])
    .map(k => 'rules → ' + k);
  const siblings = Object.keys((live.rules || {})[BRANCH[0]] || {}).filter(k => k !== BRANCH[1])
    .map(k => 'rules → ' + BRANCH[0] + ' → ' + k);
  console.log('  other rules in this database, never touched: ' + (others.concat(siblings).join(', ') || 'none'));
  console.log('  live rules carry comments: ' + (hasComments(text) ? 'yes' : 'no'));
  const diffs = differences(branchOf(live), branchOf(file), '/' + BRANCH.join('/'), []);

  if (cmd === 'diff') {
    if (!diffs.length) { console.log('  ✓ the live ' + BRANCH.join('/') + ' rules match firebase-rules.json exactly'); return; }
    console.log('  ' + diffs.length + ' difference(s), live → file:');
    diffs.forEach(d => console.log('    ' + d.at + '\n      live: ' + JSON.stringify(d.live) + '\n      file: ' + JSON.stringify(d.file)));
    process.exitCode = 1;
    return;
  }

  if (cmd === 'deploy') {
    if (!diffs.length) { console.log('  ✓ already live - nothing to deploy'); return; }
    // Writing the document back loses every comment in it, including in the
    // parts that are not this app's. Refused rather than done quietly.
    if (hasComments(text)) fail('the live rules carry comments that a deploy would erase - deploy by hand or remove them first');
    const merged = JSON.parse(JSON.stringify(live));
    merged.rules[BRANCH[0]] = merged.rules[BRANCH[0]] || {};
    merged.rules[BRANCH[0]][BRANCH[1]] = branchOf(file);
    const r = await fetch(DB + '/.settings/rules.json', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify(merged, null, 2)
    });
    if (!r.ok) fail('Firebase refused the rules (HTTP ' + r.status + '): ' + (await r.text()).slice(0, 300));
    const after = JSON.parse(stripComments(await liveText(tok)));
    if (!same(branchOf(after), branchOf(file))) fail('deployed, but the live branch does not read back as the file');
    const kept = Object.keys(live.rules).every(k => k === BRANCH[0] || same(live.rules[k], after.rules[k]))
      && Object.keys(live.rules[BRANCH[0]] || {}).every(k => k === BRANCH[1] || same(live.rules[BRANCH[0]][k], after.rules[BRANCH[0]][k]));
    if (!kept) fail('deployed, but something outside ' + BRANCH.join('/') + ' changed - check the Firebase console now');
    console.log('  ✓ deployed ' + diffs.length + ' change(s) to ' + BRANCH.join('/') + '; everything else unchanged');
    return;
  }
  fail('unknown command ' + cmd + ' - use get, pull, diff or deploy');
}

if (require.main === module) main().catch(e => fail(e.message));
module.exports = { token: token, DB: DB };
