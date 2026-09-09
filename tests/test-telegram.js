// telegram.js with a fake Bot API (injected fetch) and the real owner-queue store.
'use strict';
const fs = require('fs');
const path = require('path');
const tg = require('../scripts/telegram');
const queue = require('../scripts/owner-queue');

const ROOT = path.join(__dirname, 'scratch-telegram');
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(ROOT, 'tmp', 'worklogs'), { recursive: true });
let pass = 0, fail = 0, n = 0;
function check(name, cond) { n++; if (cond) { pass++; console.log(`  ok ${n}. ${name}`); } else { fail++; console.log(`FAIL ${n}. ${name}`); } }

const secrets = { token: 'T', chatId: '42' };
const calls = [];
let updates = [];
const fakeFetch = async (url, init) => {
  const method = url.split('/').pop();
  const body = JSON.parse(init.body);
  calls.push({ method, body });
  if (method === 'getUpdates') { const u = updates; updates = []; return { json: async () => ({ ok: true, result: u }) }; }
  if (method === 'sendMessage') return { json: async () => ({ ok: true, result: { message_id: 100 + calls.length } }) };
  return { json: async () => ({ ok: true, result: true }) };
};
const board = { loadCfg: () => ({}), readBoard: () => ({ goals: [{ lane: 'G1', issue: 1, feature: null, items: [{ issue: 7, feature: 'Numerics core' }, { issue: 8, feature: 'Plant Editor' }] }] }) };
const cfg = { rulings: { autoResolveHours: 4, never: ['Plant Editor'] } };
queue.main(['park', '--item', '7', '--q', 'merge order?', '--opt', 'a=A', '--opt', 'b=B', '--rec', 'b'], { root: ROOT, cfg, board, stdout: () => {} });
queue.main(['park', '--item', '8', '--q', 'vent?', '--opt', 'a=live', '--opt', 'c=keep'], { root: ROOT, cfg, board, stdout: () => {} });

(async () => {
  let out = '';
  const run = (argv, extra = {}) => { out = ''; return tg.main(argv, { root: ROOT, secrets, fetch: fakeFetch, stdout: s => { out += s + '\n'; }, ...extra }); };

  check('no secrets → exit 78 with the BotFather hint', (await tg.main(['send', 'x'], { root: ROOT, secrets: null, fetch: fakeFetch, stdout: () => {} })) === 78);
  check('send posts to the owner chat', (await run(['send', 'hello', 'world'])) === 0 && calls.at(-1).method === 'sendMessage' && calls.at(-1).body.chat_id === '42' && calls.at(-1).body.text === 'hello world');
  calls.length = 0;
  check('rulings posts both open rulings with inline buttons and records message ids', (await run(['rulings'])) === 0 && calls.length === 2 && calls[0].body.reply_markup.inline_keyboard[0].map(b => b.callback_data).join(',') === 'R1:a,R1:b' && calls[0].body.parse_mode === 'HTML' && /^🧭 <b>Ruling R1 · #7 · G1 · Numerics core<\/b>/.test(calls[0].body.text) && /<b>\(b\)<\/b> B <b>·<\/b> ✅ <i>recommended<\/i>/.test(calls[0].body.text) && /⏳ <b>auto-resolves/.test(calls[0].body.text) && /🛑 <b>waits for you<\/b>/.test(calls[1].body.text) && calls[0].body.reply_markup.inline_keyboard[0][0].text === '(a)' && JSON.parse(fs.readFileSync(path.join(ROOT, '.orch', 'owner-queue.json'), 'utf8')).rulings.every(r => r.telegramMessageId));
  calls.length = 0;
  check('rulings again posts nothing new', (await run(['rulings'])) === 0 && calls.length === 0);

  updates = [
    { update_id: 10, callback_query: { id: 'c1', data: 'R1:a', message: { message_id: 101, chat: { id: 42 } } } },
    { update_id: 11, callback_query: { id: 'c2', data: 'R2:c', message: { message_id: 102, chat: { id: 99 } } } },
    { update_id: 12, message: { chat: { id: 42 }, text: 'focus G142' } },
    { update_id: 13, message: { chat: { id: 42 }, text: 'merge everything now' } },
    { update_id: 14, message: { chat: { id: 7 }, text: 'stop' } },
  ];
  const rc = await run(['poll', '--once']);
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, '.orch', 'owner-queue.json'), 'utf8'));
  check('poll --once: button from the owner chat decides R1 (a) by telegram', rc === 0 && store.rulings[0].decided && store.rulings[0].decided.opt === 'a' && store.rulings[0].decided.by === 'telegram' && /DECIDED R1 \(a\)/.test(out));
  check('button from another chat is dropped, R2 untouched', !store.rulings[1].decided && /DROP callback from chat 99/.test(out));
  check('buttons removed after a decision (editMessageReplyMarkup)', calls.some(c => c.method === 'editMessageReplyMarkup' && c.body.message_id === 101));
  check('visible receipt replied under the card', calls.some(c => c.method === 'sendMessage' && c.body.reply_to_message_id === 101 && /^✅ <b>R1 → \(a\)<\/b> recorded/.test(c.body.text)));
  check('answerCallbackQuery sent for the accepted press', calls.some(c => c.method === 'answerCallbackQuery' && c.body.callback_query_id === 'c1' && /R1/.test(c.body.text)));
  const inbox = fs.readFileSync(path.join(ROOT, '.orch', 'assistant-inbox.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  check('allowlisted text relayed to the inbox; free text and foreign chat ignored', inbox.length === 1 && inbox[0].text === 'focus G142' && /IGNORED text/.test(out) && /DROP message from chat 7/.test(out));
  check('offset persisted past the last update', JSON.parse(fs.readFileSync(path.join(ROOT, '.orch', 'telegram-offset.json'), 'utf8')).offset === 15);
  updates = [{ update_id: 15, callback_query: { id: 'c3', data: 'R1:b', message: { message_id: 101, chat: { id: 42 } } } }];
  await run(['poll', '--once']);
  check('a second press on a decided ruling is rejected, decision unchanged', /REJECTED|already decided/.test(out) && JSON.parse(fs.readFileSync(path.join(ROOT, '.orch', 'owner-queue.json'), 'utf8')).rulings[0].decided.opt === 'a');
  fs.writeFileSync(path.join(ROOT, 'digest.md'), 'x'.repeat(9000));
  calls.length = 0;
  check('digest splits at 4000 chars', (await run(['digest', '--file', path.join(ROOT, 'digest.md')])) === 0 && calls.filter(c => c.method === 'sendMessage').length === 3);

  // v0.11.1: one poller per repo. A live pid in .orch/telegram-poll.pid refuses a second instance (75); a dead one is replaced.
  const pidP = path.join(ROOT, '.orch', 'telegram-poll.pid');
  fs.writeFileSync(pidP, '4242\n');
  calls.length = 0;
  check('poll refuses to start while another live poller holds the pid file, without touching Telegram', (await run(['poll', '--once'], { isAlive: p => p === 4242 })) === 75 && /POLL-BUSY pid 4242/.test(out) && calls.length === 0);
  check('a dead pid is replaced by this process', (await run(['poll', '--once'], { isAlive: () => false })) === 0 && fs.readFileSync(pidP, 'utf8').trim() === String(process.pid));
  // digest with no --file reads stdin, so `owner-queue digest | telegram digest` is one command
  calls.length = 0;
  check('digest reads stdin when --file is absent', (await run(['digest'], { stdin: () => 'from stdin' })) === 0 && calls.at(-1).body.text === 'from stdin');

  console.log(`\n${pass}/${pass + fail} pass`);
  process.exit(fail ? 1 : 0);
})();
