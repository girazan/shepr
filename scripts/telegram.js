#!/usr/bin/env node
// telegram.js — the assistant role's channel (owner-confirmed design
// 2026-09-06). Bot API over fetch, no dependency. Token + chat allowlist
// live OUTSIDE any repo in ~/.claude/shepr-secrets.json:
//   { "telegram": { "token": "123:abc", "chatId": "42" } }
//
//   send "<text>"                          plain message to the owner chat
//   ruling R<n>                            post one open ruling with a/b/c inline buttons
//   rulings                                post every open ruling not yet posted
//   poll [--once]                          drain button presses → owner-queue decide … --by telegram;
//                                          relay allowlisted texts (stop|status|focus G<n>|digest now) to
//                                          .orch/assistant-inbox.jsonl; --once = one getUpdates then exit
//   digest --file <path>                   post a digest file (≤ 4000 chars per message, split)
//
// Only the allowlisted chat can press buttons or be heard; anything else
// is dropped and audited. Offsets persist in .orch/telegram-offset.json.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const RELAY = [/^stop$/i, /^status$/i, /^focus G\d+$/i, /^digest now$/i];

function loadSecrets(home = os.homedir()) {
  const p = path.join(home, '.claude', 'shepr-secrets.json');
  try { const t = JSON.parse(fs.readFileSync(p, 'utf8')).telegram; if (t && t.token && t.chatId) return { ...t, chatId: String(t.chatId) }; } catch {}
  return null;
}

async function api(secrets, method, body, fetchFn) {
  const r = await fetchFn(`https://api.telegram.org/bot${secrets.token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json();
  if (!j.ok) throw new Error(`telegram ${method}: ${j.description || 'error'}`);
  return j.result;
}

const chunk = (s, n = 4000) => { const out = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out.length ? out : ['']; };

function rulingMessage(r) {
  const text = [`🧭 ${r.id} · #${r.item}${r.goal ? ` (${r.goal})` : ''} · ${r.feature || 'no feature'}`, r.q, '',
    ...Object.entries(r.opt).map(([k, v]) => `(${k}) ${v}${k === r.rec ? '  ← recommended' : ''}`),
    r.evidence ? `evidence: ${r.evidence}` : null,
    r.deadline ? `auto-resolves ${r.deadline} → (${r.rec})` : 'waits for you (never auto-resolves)'].filter(x => x !== null).join('\n');
  const buttons = Object.keys(r.opt).map(k => ({ text: `(${k})`, callback_data: `${r.id}:${k}` }));
  return { text, reply_markup: { inline_keyboard: [buttons] } };
}

async function main(argv, deps = {}) {
  const root = deps.root || process.cwd();
  const say = deps.stdout || (s => process.stdout.write(s + '\n'));
  const fetchFn = deps.fetch || globalThis.fetch;
  const secrets = deps.secrets || loadSecrets();
  if (!secrets) { say('telegram: no ~/.claude/shepr-secrets.json with telegram.token + telegram.chatId — the operator creates the bot (BotFather) and writes the file'); return 78; }
  const verb = argv[0];
  const storeP = path.join(root, '.orch', 'owner-queue.json');
  const offP = path.join(root, '.orch', 'telegram-offset.json');
  const inboxP = path.join(root, '.orch', 'assistant-inbox.jsonl');
  const readStore = () => { try { return JSON.parse(fs.readFileSync(storeP, 'utf8')); } catch { return { next: 1, rulings: [] }; } };
  const writeStore = s => fs.writeFileSync(storeP, JSON.stringify(s, null, 2) + '\n');
  const send = async (text, extra) => api(secrets, 'sendMessage', { chat_id: secrets.chatId, text, ...(extra || {}) }, fetchFn);

  if (verb === 'send') { for (const c of chunk(argv.slice(1).join(' '))) await send(c); say('sent'); return 0; }
  if (verb === 'digest') {
    const fi = argv.indexOf('--file'); const p = fi >= 0 ? argv[fi + 1] : null;
    if (!p || !fs.existsSync(p)) { say('usage: telegram digest --file <path>'); return 64; }
    for (const c of chunk(fs.readFileSync(p, 'utf8'))) await send(c);
    say('digest sent'); return 0;
  }
  if (verb === 'ruling' || verb === 'rulings') {
    const store = readStore();
    const targets = store.rulings.filter(r => !r.decided && (verb === 'rulings' ? !r.telegramMessageId : r.id === argv[1]));
    if (verb === 'ruling' && !targets.length) { say(`no open ruling ${argv[1]}`); return 64; }
    for (const r of targets) { const m = rulingMessage(r); const res = await send(m.text, { reply_markup: m.reply_markup }); r.telegramMessageId = res.message_id; }
    writeStore(store); say(`posted ${targets.length}`); return 0;
  }
  if (verb === 'poll') {
    const once = argv.includes('--once');
    let offset = 0; try { offset = JSON.parse(fs.readFileSync(offP, 'utf8')).offset || 0; } catch {}
    const queue = deps.queue || require('./owner-queue');
    let rounds = 0;
    do {
      const updates = await api(secrets, 'getUpdates', { offset, timeout: once ? 0 : 25, allowed_updates: ['callback_query', 'message'] }, fetchFn);
      for (const u of updates) {
        offset = u.update_id + 1;
        const cq = u.callback_query;
        if (cq) {
          const fromChat = String(cq.message && cq.message.chat && cq.message.chat.id);
          if (fromChat !== secrets.chatId) { say(`DROP callback from chat ${fromChat}`); await api(secrets, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'not allowed' }, fetchFn).catch(() => {}); continue; }
          const m = /^(R\d+):([a-z])$/.exec(cq.data || '');
          if (!m) { await api(secrets, 'answerCallbackQuery', { callback_query_id: cq.id }, fetchFn).catch(() => {}); continue; }
          let out = ''; const rc = queue.main(['decide', m[1], m[2], '--by', 'telegram'], { root, stdout: s => { out += s; } });
          await api(secrets, 'answerCallbackQuery', { callback_query_id: cq.id, text: rc === 0 ? `${m[1]} → (${m[2]})` : 'not accepted' }, fetchFn).catch(() => {});
          if (rc === 0) await api(secrets, 'editMessageReplyMarkup', { chat_id: secrets.chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }, fetchFn).catch(() => {});
          say(`${rc === 0 ? 'DECIDED' : 'REJECTED'} ${m[1]} (${m[2]}) via telegram — ${out.trim()}`);
          continue;
        }
        const msg = u.message;
        if (msg && msg.text) {
          const fromChat = String(msg.chat && msg.chat.id);
          if (fromChat !== secrets.chatId) { say(`DROP message from chat ${fromChat}`); continue; }
          const text = msg.text.trim();
          if (RELAY.some(re => re.test(text))) {
            fs.mkdirSync(path.dirname(inboxP), { recursive: true });
            fs.appendFileSync(inboxP, JSON.stringify({ ts: new Date().toISOString(), text, by: 'telegram' }) + '\n');
            say(`RELAY ${text}`);
          } else say(`IGNORED text (not on the relay allowlist): ${text.slice(0, 60)}`);
        }
      }
      fs.mkdirSync(path.dirname(offP), { recursive: true });
      fs.writeFileSync(offP, JSON.stringify({ offset }) + '\n');
      rounds++;
    } while (!once && rounds < (deps.maxRounds || Infinity));
    return 0;
  }
  say('usage: telegram <send|ruling|rulings|poll|digest> …'); return 64;
}

if (require.main === module) main(process.argv.slice(2)).then(c => process.exit(c), e => { console.error(String(e.message || e)); process.exit(1); });
module.exports = { main, rulingMessage, loadSecrets, RELAY, chunk };
