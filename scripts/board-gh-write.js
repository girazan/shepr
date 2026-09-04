// board-gh mutating verbs (spec §4.3). Each verb = ordered sub-effects.
// apply(rec): probe remote → already satisfied? journal done : do call →
// journal done. Pending intents from earlier crashes replay first.
//
// Every sub-effect record carries the whole verb invocation it belongs to
// (`actionId` + `action:{name,args}`), so a crash mid-verb is resumed by
// re-running the same ACTIONS[name] function — not just the one sub-effect
// that happened to be in flight — with deterministic per-call opIds
// (`${actionId}:${i}`) so every sub-effect it re-issues is found idempotently
// by FX's remote probes instead of re-created. The opId marker in an issue
// body / comment is the idempotency key.
'use strict';
const fs = require('fs');
const path = require('path');

function write(ctx) {
  const { verb, pos, opt, cfg, gh, stdout, commonDir, readBoard, bodyOf, MARK, STATUS_OPTS, openJournal, withLock, crypto } = ctx;
  const say = s => stdout(s + '\n');
  const lockCfg = ctx.lockCfg || require('../hooks/lib/config').loadConfig({ cwd: ctx.cwd || process.cwd() });
  if (lockCfg.__repoLocked && !(lockCfg.board && lockCfg.board.github === true)) {
    say('board-gh: this repo is locked and board.github is not enabled in ~/.claude/orch-lock.json — /orch:setup enables it.'); return 1;
  }
  const R = `repos/${cfg.owner}/${cfg.repo}`;
  const journal = openJournal(path.join(commonDir, 'orch', 'board-journal.jsonl'));
  const lockPath = path.join(commonDir, 'orch', 'board.lock');
  const opTag = id => `\n<!-- opId:${id} -->`;

  function issueNode(n) {
    return gh.graphql('query($o:String!,$r:String!,$n:Int!){ repository(owner:$o,name:$r){ issue(number:$n){ id databaseId state parent{ number } projectItems(first:10){ nodes{ id project{ id } } } } } }',
      { o: cfg.owner, r: cfg.repo, n }).repository.issue;
  }
  function projectItem(n) { const i = issueNode(n); const pi = i.projectItems.nodes.find(x => x.project.id === cfg.projectId); return { node: i, itemId: pi ? pi.id : null }; }

  // Identity of an orch-created issue is its opId marker in the BODY — nothing
  // else survives a crash between the POST and its journal `done` record. A
  // just-created item has no parent link yet, so readBoard (sub-issues only)
  // cannot see it; a name/text match is not identity either.
  // ponytail: 100-issue probe window (newest first); paginate when a repo has
  // >100 open+closed orch issues.
  // Item bodies must keep `<!-- orch-item -->` as their last line, so the opId
  // marker goes just above it; goal bodies simply get it appended.
  const stamp = (body, opId) => (body.endsWith(MARK) ? body.slice(0, -MARK.length) + opTag(opId).slice(1) + '\n' + MARK : body + opTag(opId));

  function createdBy(opId, label) {
    const seen = gh.rest('GET', `${R}/issues?state=all&labels=${label}&per_page=100&sort=created&direction=desc`) || [];
    const hit = seen.find(i => (i.body || '').includes(`<!-- opId:${opId} -->`));
    return hit ? hit.number : null;
  }

  const FX = {
    createGoal(d, opId) {
      const already = createdBy(opId, 'orch:goal');
      if (already) return already;
      const body = { title: d.title, body: stamp(d.body, opId), labels: ['orch:goal'] };
      if (d.milestoneNumber) body.milestone = d.milestoneNumber;
      return gh.rest('POST', `${R}/issues`, body).number;
    },
    createIssue(d, opId) {
      const already = createdBy(opId, 'orch:item');
      if (already) return already;
      const body = { title: d.title, body: stamp(d.body, opId), labels: d.labels };
      if (d.milestoneNumber) body.milestone = d.milestoneNumber;
      if (d.assignee) body.assignees = [d.assignee];
      return gh.rest('POST', `${R}/issues`, body).number;
    },
    addSubIssue(d) {
      const child = issueNode(d.issue);
      if (child.parent && child.parent.number === d.goal) return 'linked';
      gh.rest('POST', `${R}/issues/${d.goal}/sub_issues`, { sub_issue_id: child.databaseId }); return 'linked';
    },
    addToProject(d) {
      const { node, itemId } = projectItem(d.issue);
      if (itemId) return itemId;
      return gh.graphql('mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item{ id } } }', { p: cfg.projectId, c: node.id }).addProjectV2ItemById.item.id;
    },
    setField(d) {
      const { itemId } = projectItem(d.issue);
      if (!itemId) throw new Error(`issue #${d.issue} is not on the project`);
      gh.graphql('mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){ updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){ projectV2Item{ id } } }',
        { p: cfg.projectId, i: itemId, f: d.fieldId, o: d.optionId });
      return itemId; // same value twice is harmless
    },
    comment(d, opId) {
      const cs = gh.rest('GET', `${R}/issues/${d.issue}/comments?per_page=100`) || [];
      if (cs.some(c => (c.body || '').includes(`<!-- opId:${opId} -->`))) return 'exists';
      return gh.rest('POST', `${R}/issues/${d.issue}/comments`, { body: d.body + opTag(opId) }).id;
    },
    addLabel(d) { gh.rest('POST', `${R}/issues/${d.issue}/labels`, { labels: [d.label] }); return d.label; },
    removeLabel(d) { try { gh.rest('DELETE', `${R}/issues/${d.issue}/labels/${encodeURIComponent(d.label)}`); } catch (e) { if (!/404/.test(e.message)) throw e; } return d.label; },
    closeIssue(d) { if (issueNode(d.issue).state === 'CLOSED') return 'closed'; gh.rest('PATCH', `${R}/issues/${d.issue}`, { state: 'closed' }); return 'closed'; },
  };
  function apply(rec) { const remoteId = FX[rec.subEffect](rec.desired, rec.opId); journal.done(rec.opId, remoteId); return remoteId; }

  // Action-level resume (spec §4.3 ruling): every sub-effect record carries
  // the whole verb invocation (`action: {name,args}` + `actionId`), so a
  // crash mid-verb can be resumed by re-running the same ACTIONS[name] — not
  // just the one sub-effect that happened to be in flight. Sub-effect opIds
  // are deterministic (`${actionId}:${i}`, i in call order), so the re-run
  // re-issues the exact same opIds and FX's remote probes find what already
  // landed instead of re-creating it.
  function makeEffect(actionId, lane, action) {
    let i = 0;
    return (subEffect, desired, subLane) => {
      const rec = { opId: `${actionId}:${i++}`, actionId, lane: subLane || lane, subEffect, desired, action };
      journal.intent(rec); return apply(rec);
    };
  }
  function runAction(name, lane, args, actionId = crypto.randomUUID()) {
    return ACTIONS[name](args, makeEffect(actionId, lane, { name, args }));
  }
  function replay() {
    const pending = journal.pending();
    const withAction = pending.filter(r => r.action);
    if (withAction.length) say(`board-gh: resumed ${withAction.length} pending sub-effect(s) from a previous run`);
    const seen = new Set();
    for (const rec of pending) {
      if (!rec.action || seen.has(rec.actionId)) continue;
      seen.add(rec.actionId);
      runAction(rec.action.name, rec.lane, rec.action.args, rec.actionId);
    }
    for (const rec of journal.pending()) if (!rec.action) apply(rec);
  }

  const laneOf = s => { const m = /^G(\d+)$/i.exec(s || ''); return m ? Number(m[1]) : null; };
  function goal(n) { const g = readBoard(gh, cfg).goals.find(x => x.issue === n); if (!g) throw new Error(`no goal G${n}`); return g; }
  function findItem(n) { for (const g of readBoard(gh, cfg).goals) { const i = g.items.find(x => x.issue === n); if (i) return { g, i }; } throw new Error(`issue #${n} is not an orch item`); }
  const statusOpt = s => { const k = STATUS_OPTS.find(x => x.toLowerCase() === String(s).toLowerCase()); if (!k) throw new Error(`status must be one of ${STATUS_OPTS.join(' | ')}`); return { name: k, id: cfg.optionIds.status[k] }; };
  // Any pass-through single-select (priority = buckets, pipeline, feature): option must already exist.
  function optionId(field, value) {
    const map = cfg.optionIds[field] || {};
    const k = Object.keys(map).find(x => x.toLowerCase() === String(value).toLowerCase());
    if (!k || !cfg.fieldIds[field]) throw new Error(`unknown ${field} "${value}" — valid: ${Object.keys(map).join(', ') || '(field absent; re-run init)'}`);
    return map[k];
  }

  // ACTIONS[name](args, effect) — pure sub-effect sequencing, no validation,
  // no probing beyond what FX already does. Parsing/validation lives in
  // VERBS below and runs once, on the live call only.
  const ACTIONS = {
    'add-goal'(args, effect) {
      const issue = effect('createGoal', { title: args.name, body: args.body, milestoneNumber: args.milestoneNumber });
      const lane = `G${issue}`; // lane is unknown until createGoal returns
      effect('addToProject', { issue }, lane);
      effect('setField', { issue, fieldId: cfg.fieldIds.status, optionId: cfg.optionIds.status.Todo }, lane);
      return issue;
    },
    'add-item'(args, effect) {
      const issue = effect('createIssue', { goal: args.goal, title: args.title, text: args.text, body: args.body, labels: args.labels, milestoneNumber: args.milestoneNumber, assignee: args.assignee });
      effect('addSubIssue', { issue, goal: args.goal });
      effect('addToProject', { issue });
      effect('setField', { issue, fieldId: cfg.fieldIds.status, optionId: cfg.optionIds.status.Todo });
      effect('setField', { issue, fieldId: cfg.fieldIds.priority, optionId: optionId('priority', args.bucket) });
      if (args.pipeline) effect('setField', { issue, fieldId: cfg.fieldIds.pipeline, optionId: optionId('pipeline', args.pipeline) });
      if (args.feature) effect('setField', { issue, fieldId: cfg.fieldIds.feature, optionId: optionId('feature', args.feature) });
      return issue;
    },
    move(args, effect) { effect('setField', { issue: args.issue, fieldId: cfg.fieldIds.priority, optionId: optionId('priority', args.bucket) }); return args.issue; },
    'set-status'(args, effect) {
      effect('setField', { issue: args.issue, fieldId: cfg.fieldIds.status, optionId: cfg.optionIds.status[args.status] });
      effect('comment', { issue: args.issue, body: `status → ${args.status}` });
      return args.issue;
    },
    'set-blocker'(args, effect) {
      effect('addLabel', { issue: args.issue, label: 'orch:blocked' });
      effect('comment', { issue: args.issue, body: `blocked: ${args.text} · owner: ${args.owner}` });
      return args.issue;
    },
    'clear-blocker'(args, effect) {
      effect('comment', { issue: args.issue, body: 'unblocked' });
      effect('removeLabel', { issue: args.issue, label: 'orch:blocked' });
      return args.issue;
    },
    done(args, effect) {
      effect('setField', { issue: args.issue, fieldId: cfg.fieldIds.status, optionId: cfg.optionIds.status.Done });
      effect('closeIssue', { issue: args.issue });
      return args.issue;
    },
    'close-goal'(args, effect) {
      effect('comment', { issue: args.issue, body: `evidence: ${args.evidence}` });
      effect('setField', { issue: args.issue, fieldId: cfg.fieldIds.status, optionId: cfg.optionIds.status.Done });
      effect('closeIssue', { issue: args.issue });
      return args.issue;
    },
  };

  const VERBS = {
    'add-goal'() {
      const [ms, name] = pos;
      if (!ms || !name || typeof opt.brief !== 'string') throw new Error('usage: add-goal <milestone#|backlog|none> "<name>" --brief <file>');
      let milestoneNumber = null;
      if (ms !== 'none') {
        const all = gh.rest('GET', `${R}/milestones?state=open&per_page=100`) || [];
        const m = /^\d+$/.test(ms) ? all.find(x => x.number === Number(ms)) : all.find(x => x.title === ms);
        if (!m) { say(`add-goal: no open milestone "${ms}" — run \`board-gh milestones\``); return 1; }
        milestoneNumber = m.number;
      }
      const body = fs.readFileSync(opt.brief, 'utf8');
      const issue = runAction('add-goal', 'G?', { name, body, milestoneNumber });
      say(`G${issue}`);
    },
    'add-item'() {
      const gn = laneOf(pos[0]); const text = pos[1];
      if (!gn || !text) throw new Error('usage: add-item G<n> "<text>" [--you] [--bucket <Priority option>] [--pipeline <opt>] [--feature <opt>] [--outcome …] [--gate LABEL]');
      const g = goal(gn); const lane = g.lane;
      const bucket = typeof opt.bucket === 'string' ? opt.bucket : cfg.buckets[0];
      optionId('priority', bucket); // validate before any write
      if (typeof opt.pipeline === 'string') optionId('pipeline', opt.pipeline);
      if (typeof opt.feature === 'string') optionId('feature', opt.feature);
      const labels = ['orch:item']; if (opt.you) labels.push('orch:you');
      const args = { goal: gn, lane, title: text.slice(0, 120), text, body: bodyOf(text, { outcome: opt.outcome, gate: opt.gate }), labels,
        milestoneNumber: g.milestone ? g.milestone.number : null, bucket, pipeline: typeof opt.pipeline === 'string' ? opt.pipeline : null, feature: typeof opt.feature === 'string' ? opt.feature : null,
        assignee: opt.you ? gh.rest('GET', 'user').login : null };
      const issue = runAction('add-item', lane, args);
      say(String(issue));
    },
    move() {
      const n = Number(pos[0]); if (!n || !pos[1]) throw new Error('usage: move <issue#> <Priority option>');
      const { g } = findItem(n); optionId('priority', pos[1]);
      runAction('move', g.lane, { issue: n, lane: g.lane, bucket: pos[1] });
    },
    'set-status'() {
      const n = Number(pos[0]); const s = statusOpt(pos[1]); const { g } = findItem(n);
      runAction('set-status', g.lane, { issue: n, lane: g.lane, status: s.name });
    },
    'set-blocker'() {
      const n = Number(pos[0]); const text = pos[1];
      if (!text || typeof opt.owner !== 'string') throw new Error('usage: set-blocker <issue#> "<text>" --owner <who>');
      const { g } = findItem(n);
      runAction('set-blocker', g.lane, { issue: n, lane: g.lane, text, owner: opt.owner });
    },
    'clear-blocker'() { const n = Number(pos[0]); const { g } = findItem(n); runAction('clear-blocker', g.lane, { issue: n, lane: g.lane }); },
    done() { const n = Number(pos[0]); const { g } = findItem(n); runAction('done', g.lane, { issue: n, lane: g.lane }); },
    'close-goal'() {
      const gn = laneOf(pos[0]); if (!gn) throw new Error('usage: close-goal G<n> --evidence "<ledger line or artifact path>"');
      if (typeof opt.evidence !== 'string' || !opt.evidence.trim()) { say(`close-goal: --evidence required (ledger line or artifact path naming G${gn})`); return 1; }
      const g = goal(gn);
      const open = g.items.filter(i => !i.done);
      if (open.length) { say(`close-goal: ${g.lane} has ${open.length} open item(s): ${open.map(i => '#' + i.issue).join(' ')}`); return 1; }
      runAction('close-goal', g.lane, { issue: gn, lane: g.lane, evidence: opt.evidence.trim() });
      say(`${g.lane} merged`);
    },
  };
  if (!VERBS[verb]) { say(`board-gh: unknown verb ${verb}`); return 1; }
  try { return withLock(lockPath, () => { replay(); return VERBS[verb]() || 0; }); }
  catch (e) { say(`board-gh: ${verb} failed — ${e.message}`); return 1; }
}

module.exports = { write };
