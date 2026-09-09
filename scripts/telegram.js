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
//                                          a typed "R<n> <letter>" decides like a button press;
//                                          relay allowlisted texts (stop|status|focus G<n>|digest now) to
//                                          .orch/assistant-inbox.jsonl (coordinator `wait` wakes on them);
//                                          --once = one getUpdates then exit. One instance per repo:
//                                          .orch/telegram-poll.pid is the lock (exit 75 if another is alive)
//   digest [--file <path>]                 post a digest (file or stdin; ≤ 4000 chars per message, split);
//                                          the last message carries one button row per OPEN ruling
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

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const L = k => `<b>(${k})</b>`; // option letters in bold, no letter emoji (they render unevenly)
const when = iso => { const d = new Date(iso); return isNaN(d) ? iso : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; };
// Headline · one-paragraph question · options as a comparison · evidence · clock. HTML parse mode.
// Structure markers (letters, separators, labels) are bold; emoji only where they carry meaning.
function rulingMessage(r) {
  const head = `🧭 <b>Ruling ${esc(r.id)} · #${r.item}${r.goal ? ` · ${esc(r.goal)}` : ''}${r.feature ? ` · ${esc(r.feature)}` : ''}</b>`;
  const q = esc(r.q).replace(/\s+/g, ' ').trim();
  const opts = Object.entries(r.opt).map(([k, v]) => `${L(k)} ${esc(v).replace(/\s+/g, ' ').trim()}${k === r.rec ? ' <b>·</b> ✅ <i>recommended</i>' : ''}`);
  const clock = r.deadline ? `⏳ <b>auto-resolves ${when(r.deadline)}</b> → ${L(r.rec)} unless you press a button` : '🛑 <b>waits for you</b> — never auto-resolves';
  const text = [head, '', `❓ ${q}`, '', '<b>Options</b>', ...opts, '', r.evidence ? `📎 <code>${esc(r.evidence)}</code>` : null, clock].filter(x => x !== null).join('\n');
  const buttons = Object.keys(r.opt).map(k => ({ text: `(${k})`, callback_data: `${r.id}:${k}` }));
  return { text, parse_mode: 'HTML', reply_markup: { inline_keyboard: [buttons] } };
}

// One button row per OPEN ruling — the digest is one message, so its keyboard carries every
// open ruling; on a press the keyboard is rebuilt with the rows still open (not wiped).
const keyboardFor = (store, onlyMessageId) => store.rulings
  .filter(r => !r.decided && (onlyMessageId == null || r.telegramMessageId === onlyMessageId))
  .map(r => Object.keys(r.opt).map(k => ({ text: `${r.id} (${k})`, callback_data: `${r.id}:${k}` })));

async function main(argv, deps = {}) {
  const root = deps.root || process.cwd();
  const say = deps.stdout || (s => process.stdout.write(s + '\n'));
  const fetchFn = deps.fetch || globalThis.fetch;
  const secrets = Object.prototype.hasOwnProperty.call(deps, 'secrets') ? deps.secrets : loadSecrets();
  if (!secrets) { say('telegram: no ~/.claude/shepr-secrets.json with telegram.token + telegram.chatId — the operator creates the bot (BotFather) and writes the file'); return 78; }
  const verb = argv[0];
  const storeP = path.join(root, '.orch', 'owner-queue.json');
  const offP = path.join(root, '.orch', 'telegram-offset.json');
  const inboxP = path.join(root, '.orch', 'assistant-inbox.jsonl');
  const readStore = () => { try { return JSON.parse(fs.readFileSync(storeP, 'utf8')); } catch { return { next: 1, rulings: [] }; } };
  const writeStore = s => fs.writeFileSync(storeP, JSON.stringify(s, null, 2) + '\n');
  const send = async (text, extra) => api(secrets, 'sendMessage', { chat_id: secrets.chatId, text, ...(extra || {}) }, fetchFn);

  // --html: the text is Telegram HTML (<b>, <i>, <code>); default is plain text.
  const html = argv.includes('--html');
  const fmt = html ? { parse_mode: 'HTML' } : {};
  if (verb === 'send') { for (const c of chunk(argv.slice(1).filter(a => a !== '--html').join(' '))) await send(c, fmt); say('sent'); return 0; }
  if (verb === 'digest') {
    // --file <path>, or stdin: `owner-queue digest | telegram digest` is one command.
    const fi = argv.indexOf('--file'); const p = fi >= 0 ? argv[fi + 1] : null;
    if (p && !fs.existsSync(p)) { say('usage: telegram digest [--file <path>] [--html]  (no --file = stdin)'); return 64; }
    const text = p ? fs.readFileSync(p, 'utf8') : (deps.stdin ? deps.stdin() : fs.readFileSync(0, 'utf8'));
    if (!text.trim()) { say('digest: nothing to send'); return 0; }
    // The last chunk carries the buttons: one row per open ruling, so the phone answers from the digest itself.
    const store = readStore(); const rows = keyboardFor(store); const parts = chunk(text); let res = null;
    for (let i = 0; i < parts.length; i++) res = await send(parts[i], { ...fmt, ...(i === parts.length - 1 && rows.length ? { reply_markup: { inline_keyboard: rows } } : {}) });
    if (rows.length && res && res.message_id) { for (const r of store.rulings) if (!r.decided) r.telegramMessageId = res.message_id; writeStore(store); }
    say(`digest sent${rows.length ? ` · ${rows.length} ruling button row(s)` : ''}`); return 0;
  }
  if (verb === 'ruling' || verb === 'rulings') {
    const store = readStore();
    const targets = store.rulings.filter(r => !r.decided && (verb === 'rulings' ? !r.telegramMessageId : r.id === argv[1]));
    if (verb === 'ruling' && !targets.length) { say(`no open ruling ${argv[1]}`); return 64; }
    for (const r of targets) { const m = rulingMessage(r); const res = await send(m.text, { parse_mode: m.parse_mode, reply_markup: m.reply_markup }); r.telegramMessageId = res.message_id; }
    writeStore(store); say(`posted ${targets.length}`); return 0;
  }
  if (verb === 'poll') {
    const once = argv.includes('--once');
    // One poller per repo: Telegram serves getUpdates to a single consumer, and two instances
    // fight ("Conflict: terminated by other getUpdates") until one dies. The pid file is the lock.
    // ponytail: a recycled pid reads as busy; delete the pid file by hand if that ever bites.
    const pidP = path.join(root, '.orch', 'telegram-poll.pid');
    const isAlive = deps.isAlive || (pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } });
    let other = 0; try { other = Number(fs.readFileSync(pidP, 'utf8').trim()); } catch {}
    if (other && other !== process.pid && isAlive(other)) { say(`POLL-BUSY pid ${other} already polling this repo; stop it first or leave it be`); return 75; }
    fs.mkdirSync(path.dirname(pidP), { recursive: true });
    fs.writeFileSync(pidP, `${process.pid}\n`);
    let offset = 0; try { offset = JSON.parse(fs.readFileSync(offP, 'utf8')).offset || 0; } catch {}
    const queue = deps.queue || require('./owner-queue');
    // Button or typed answer → owner-queue decide; rebuild the pressed message's keyboard with what is still open; receipt under it.
    const decide = async (id, opt, messageId) => {
      let out = ''; const rc = queue.main(['decide', id, opt, '--by', 'telegram'], { root, stdout: s => { out += s; } });
      const fresh = rc === 0 && !/already decided/.test(out);
      if (fresh) {
        const st = readStore(); const carded = st.rulings.find(r => r.id === id && r.telegramMessageId);
        const target = carded ? carded.telegramMessageId : messageId;
        await api(secrets, 'editMessageReplyMarkup', { chat_id: secrets.chatId, message_id: target, reply_markup: { inline_keyboard: keyboardFor(st, target) } }, fetchFn).catch(() => {});
        // A visible receipt — the toast disappears in seconds.
        const woke = /onDecision ran/.test(out) ? ' · coordinator woken' : '';
        await api(secrets, 'sendMessage', { chat_id: secrets.chatId, reply_to_message_id: messageId, parse_mode: 'HTML',
          text: `✅ <b>${id} → (${opt})</b> recorded ${new Date().toISOString().slice(11, 16)} UTC${woke}` }, fetchFn).catch(() => {});
      }
      say(`${rc === 0 ? 'DECIDED' : 'REJECTED'} ${id} (${opt}) via telegram — ${out.trim()}`);
      return { fresh, rc };
    };
    let rounds = 0;
    do {
      let updates;
      try {
        updates = await api(secrets, 'getUpdates', { offset, timeout: once ? 0 : 25, allowed_updates: ['callback_query', 'message'] }, fetchFn);
      } catch (e) {
        // A persistent poller must survive a network blip: log, back off 15 s, try again. --once reports the failure.
        say(`POLL-ERROR ${String(e.message || e).slice(0, 120)}`);
        if (once) return 1;
        await new Promise(r => setTimeout(r, 15000));
        rounds++;
        continue;
      }
      for (const u of updates) {
        offset = u.update_id + 1;
        const cq = u.callback_query;
        if (cq) {
          const fromChat = String(cq.message && cq.message.chat && cq.message.chat.id);
          if (fromChat !== secrets.chatId) { say(`DROP callback from chat ${fromChat}`); await api(secrets, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'not allowed' }, fetchFn).catch(() => {}); continue; }
          const m = /^(R\d+):([a-z])$/.exec(cq.data || '');
          if (!m) { await api(secrets, 'answerCallbackQuery', { callback_query_id: cq.id }, fetchFn).catch(() => {}); continue; }
          const d = await decide(m[1], m[2], cq.message.message_id);
          await api(secrets, 'answerCallbackQuery', { callback_query_id: cq.id, text: d.fresh ? `${m[1]} → (${m[2]})` : 'already decided' }, fetchFn).catch(() => {});
          continue;
        }
        const msg = u.message;
        if (msg && msg.text) {
          const fromChat = String(msg.chat && msg.chat.id);
          if (fromChat !== secrets.chatId) { say(`DROP message from chat ${fromChat}`); continue; }
          const text = msg.text.trim();
          const ans = /^(R\d+)\s*[:\s]\s*([a-z])$/i.exec(text); // "R57 a" typed instead of pressed
          if (ans) { await decide(ans[1].toUpperCase(), ans[2].toLowerCase(), msg.message_id); continue; }
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

// exitCode, not process.exit(): on Windows, exiting while fetch's handles are
// still closing trips a libuv assertion (UV_HANDLE_CLOSING) after the work is done.
if (require.main === module) main(process.argv.slice(2)).then(c => { process.exitCode = c; }, e => { console.error(String(e.message || e)); process.exitCode = 1; });
module.exports = { main, rulingMessage, loadSecrets, RELAY, chunk };
