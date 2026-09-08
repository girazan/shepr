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
  const { verb, pos, opt, cfg, gh, stdout, commonDir, env, readBoard, bodyOf, MARK, STATUS_OPTS, EXEC_RECIPES, openJournal, withLock, crypto } = ctx;
  const { pagedMilestones } = require('./board-gh');
  const say = s => stdout(s + '\n');
  // parseArgs stores a bare `--flag` as true; every value-taking option must reject that.
  const str = name => { const v = opt[name]; if (v === true) throw new Error(`--${name} requires a value`); return typeof v === 'string' ? v : null; };
  const lockCfg = ctx.lockCfg || require('../hooks/lib/config').loadConfig({ cwd: ctx.cwd || process.cwd() });
  if (lockCfg.__repoLocked && !(lockCfg.board && lockCfg.board.github === true)) {
    say('board-gh: this repo is locked and board.github is not enabled in ~/.claude/orch-lock.json — /shepr:setup enables it.'); return 1;
  }
  // Director-only verbs (spec §10): milestones and goal priority are scope.
  // ADVISORY — ORCH_ROLE is env, not a credential — but the refusal runs
  // before replay and before any remote call.
  const goalMove = verb === 'move' && /^G\d+$/i.test(pos[0] || '');
  if ((verb === 'add-milestone' || verb === 'close-milestone' || verb === 'add-objective' || goalMove) && env && env.ORCH_ROLE) {
    say(`${verb}: refused — ${goalMove ? 'goal priority' : 'milestones'} are the Director's (ORCH_ROLE=${env.ORCH_ROLE})`); return 1;
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
  // >100 open+closed shepr issues.
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
    createObjective(d, opId) {
      const already = createdBy(opId, 'orch:objective');
      if (already) return already;
      return gh.rest('POST', `${R}/issues`, { title: d.title, body: stamp(d.body, opId), labels: ['orch:objective'], milestone: d.milestoneNumber }).number;
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
    createMilestone(d) {
      const all = pagedMilestones(gh, R, 'all');
      const hit = all.find(m => m.title === d.title || m.title === `M${m.number} · ${d.title}`);
      if (hit) return hit.number;
      return gh.rest('POST', `${R}/milestones`, { title: d.title, description: d.description, due_on: d.due_on }).number;
    },
    retitleMilestone(d) {
      const m = pagedMilestones(gh, R, 'all').find(x => x.number === d.number);
      if (m && m.title === d.title) return d.number;
      gh.rest('PATCH', `${R}/milestones/${d.number}`, { title: d.title }); return d.number;
    },
    updateFeatureOptions(d) {
      const { Q, optInput } = require('./board-gh-init');
      const field = gh.graphql(Q.fields, { p: cfg.projectId }).node.fields.nodes.find(f => f.name === 'Feature');
      const have = field.options.map(x => x.name.toLowerCase());
      const missing = d.names.filter(n => !have.includes(n.toLowerCase()));
      if (!missing.length) return field.id; // already applied (resume) or nothing to add
      const preserved = field.options.map(x => ({ name: x.name, color: x.color || 'GRAY', description: x.description || '' }));
      return gh.graphql(Q.updateField, { f: field.id, opts: [...preserved, ...optInput(missing)] }).updateProjectV2Field.projectV2Field.id;
    },
    closeMilestone(d) {
      const m = pagedMilestones(gh, R, 'all').find(x => x.number === d.number);
      if (!m || m.state === 'closed') return 'closed';
      gh.rest('PATCH', `${R}/milestones/${d.number}`, { state: 'closed', description: `${m.description || ''}\nclosed: ${d.date} · summary: ${d.summary}` });
      return 'closed';
    },
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
  const DIRECTOR_ONLY = a => a && (a.name === 'add-milestone' || a.name === 'retitle-milestone' || a.name === 'close-milestone' || a.name === 'add-objective' || (a.name === 'move' && a.args && a.args.goalMove));
  function replay() {
    const pending = journal.pending();
    const roled = !!(env && env.ORCH_ROLE);
    const withAction = pending.filter(r => r.action && !(roled && DIRECTOR_ONLY(r.action)));
    const skipped = new Set(pending.filter(r => r.action && roled && DIRECTOR_ONLY(r.action)).map(r => r.actionId));
    if (withAction.length) say(`board-gh: resumed ${withAction.length} pending sub-effect(s) from a previous run`);
    if (skipped.size) say(`board-gh: skipped ${skipped.size} Director-only pending action(s) — run from an un-roled session to resume`);
    const seen = new Set();
    for (const rec of withAction) {
      if (seen.has(rec.actionId)) continue;
      seen.add(rec.actionId);
      runAction(rec.action.name, rec.lane, rec.action.args, rec.actionId);
    }
    for (const rec of journal.pending()) if (!rec.action && !skipped.has(rec.actionId)) apply(rec);
  }

  const laneOf = s => { const m = /^G(\d+)$/i.exec(s || ''); return m ? Number(m[1]) : null; };
  function goal(n) { const g = readBoard(gh, cfg).goals.find(x => x.issue === n); if (!g) throw new Error(`no goal G${n}`); return g; }
  function findItem(n) { for (const g of readBoard(gh, cfg).goals) { const i = g.items.find(x => x.issue === n); if (i) return { g, i }; } throw new Error(`issue #${n} is not an shepr item`); }
  const statusOpt = s => { const k = STATUS_OPTS.find(x => x.toLowerCase() === String(s).toLowerCase()); if (!k) throw new Error(`status must be one of ${STATUS_OPTS.join(' | ')}`); return { name: k, id: cfg.optionIds.status[k] }; };
  // Any pass-through single-select (priority = buckets, pipeline, feature): option must already exist.
  function optionId(field, value) {
    const map = cfg.optionIds[field] || {};
    const k = Object.keys(map).find(x => x.toLowerCase() === String(value).toLowerCase());
    if (!k || !cfg.fieldIds[field]) throw new Error(`unknown ${field} "${value}" — valid: ${Object.keys(map).join(', ') || '(field absent; re-run init)'}`);
    return map[k];
  }

  const featureOf = b => { const m = /^feature:\s*(.+)$/m.exec(b || ''); return m ? m[1].trim() : null; };

  // ACTIONS[name](args, effect) — pure sub-effect sequencing, no validation,
  // no probing beyond what FX already does. Parsing/validation lives in
  // VERBS below and runs once, on the live call only.
  // v0.10: Pipeline is derived from the goal's primary domain via orch.json `board.pipelineByDomain`
  // ({ numerics: "Engine", … }); nobody sets it by hand. An explicit --pipeline still wins.
  const pipelineMap = (lockCfg.board && lockCfg.board.pipelineByDomain) || {};
  const pipelineFor = feature => (cfg.fieldIds.pipeline && feature && pipelineMap[feature]) || null;
  const ACTIONS = {
    'add-objective'(args, effect) {
      const issue = effect('createObjective', { title: args.title, body: args.body, milestoneNumber: args.milestoneNumber }, 'O?');
      effect('addToProject', { issue }, `O${issue}`);
      effect('setField', { issue, fieldId: cfg.fieldIds.status, optionId: cfg.optionIds.status.Todo }, `O${issue}`);
      return issue;
    },
    'add-goal'(args, effect) {
      const issue = effect('createGoal', { title: args.name, body: args.body, milestoneNumber: args.milestoneNumber });
      const lane = `G${issue}`; // lane is unknown until createGoal returns
      if (args.objective) effect('addSubIssue', { issue, goal: args.objective }, lane); // the goal is a sub-issue of its objective
      effect('addToProject', { issue }, lane);
      effect('setField', { issue, fieldId: cfg.fieldIds.status, optionId: cfg.optionIds.status.Todo }, lane);
      // A record journaled before feature: existed carries no args.feature; parse the body so replay still sets the field.
      const fm = /^feature:\s*(.+)$/m.exec(args.body || '');
      const feature = args.feature || (cfg.fieldIds.feature && fm ? fm[1].trim() : null);
      if (feature) effect('setField', { issue, fieldId: cfg.fieldIds.feature, optionId: optionId('feature', feature) }, lane);
      const pipeline = args.pipeline || pipelineFor(feature);
      if (pipeline) effect('setField', { issue, fieldId: cfg.fieldIds.pipeline, optionId: optionId('pipeline', pipeline) }, lane);
      return issue;
    },
    'add-item'(args, effect) {
      // Inherit on replay too: a pre-upgrade record carries feature: null. A goal from adopt mode
      // (no Feature field then) has feature === null forever; fall back to its BRIEF line.
      const feature = args.feature || (cfg.fieldIds.feature ? (goal(args.goal).feature || featureOf(goal(args.goal).brief)) : null);
      const issue = effect('createIssue', { goal: args.goal, title: args.title, text: args.text, body: args.body, labels: args.labels, milestoneNumber: args.milestoneNumber, assignee: args.assignee });
      effect('addSubIssue', { issue, goal: args.goal });
      effect('addToProject', { issue });
      effect('setField', { issue, fieldId: cfg.fieldIds.status, optionId: cfg.optionIds.status.Todo });
      effect('setField', { issue, fieldId: cfg.fieldIds.priority, optionId: optionId('priority', args.bucket) });
      const pipeline = args.pipeline || pipelineFor(feature);
      if (pipeline) effect('setField', { issue, fieldId: cfg.fieldIds.pipeline, optionId: optionId('pipeline', pipeline) });
      if (feature) effect('setField', { issue, fieldId: cfg.fieldIds.feature, optionId: optionId('feature', feature) });
      return issue;
    },
    move(args, effect) { effect('setField', { issue: args.issue, fieldId: cfg.fieldIds.priority, optionId: optionId('priority', args.bucket) }); return args.issue; },
    'retitle-milestone'(args, effect) { effect('retitleMilestone', { number: args.number, title: args.title }, `M${args.number}`); return args.number; },
    'add-milestone'(args, effect) {
      const number = effect('createMilestone', { title: args.objective, description: args.description, due_on: args.due_on }, 'M?');
      effect('retitleMilestone', { number, title: `M${number} · ${args.objective}` }, `M${number}`);
      return number;
    },
    'sync-features'(args, effect) { effect('updateFeatureOptions', { names: args.missing }, 'board'); return 'synced'; },
    'close-milestone'(args, effect) { effect('closeMilestone', { number: args.number, summary: args.summary, date: args.date }, `M${args.number}`); return args.number; },
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
    attention(args, effect) {
      if (args.clear) {
        effect('comment', { issue: args.issue, body: 'attention cleared' });
        effect('removeLabel', { issue: args.issue, label: 'orch:needs_attention' });
      } else {
        effect('addLabel', { issue: args.issue, label: 'orch:needs_attention' });
        effect('comment', { issue: args.issue, body: `attention: ${args.why}` });
      }
      return args.issue;
    },
  };

  const VERBS = {
    'add-objective'() {
      const [ms, title] = pos; const done = str('done');
      if (!ms || !title || !done) throw new Error('usage: add-objective <milestone#> "<title>" --done "<observable>"');
      const all = gh.rest('GET', `${R}/milestones?state=open&per_page=100`) || [];
      const m = /^\d+$/.test(ms) ? all.find(x => x.number === Number(ms)) : all.find(x => x.title === ms);
      if (!m) { say(`add-objective: no open milestone "${ms}" — run \`board-gh milestones\``); return 1; }
      const seen = gh.rest('GET', `${R}/issues?state=all&labels=orch:objective&per_page=100&sort=created&direction=desc`) || [];
      const msNum = x => (x && typeof x === 'object') ? x.number : x; // REST gives an object; a journal/fake may give the number
      const dup = seen.find(i => i.title === title && msNum(i.milestone) === m.number);
      if (dup) { say(`O${dup.number}`); return 0; } // idempotent on (milestone, title)
      const body = `done: ${done}

Objective under M${m.number}. Goals attach as sub-issues. Close only when done: is demonstrated, never because the goals closed.`;
      say(`O${runAction('add-objective', 'O?', { title, body, milestoneNumber: m.number })}`);
    },
    'add-goal'() {
      const [ms, name] = pos;
      const brief = str('brief');
      if (!ms || !name || !brief) throw new Error('usage: add-goal <milestone#|backlog|none> "<name>" --brief <file> [--objective O<n>]');
      let objective = null;
      if (opt.objective !== undefined) {
        objective = Number(String(str('objective')).replace(/^O/i, ''));
        const o = objective ? gh.rest('GET', `${R}/issues/${objective}`) : null;
        if (!o || !(o.labels || []).some(l => l.name === 'orch:objective')) { say(`add-goal: --objective ${str('objective')} is not an orch:objective issue`); return 1; }
      }
      let milestoneNumber = null;
      if (ms !== 'none') {
        const all = gh.rest('GET', `${R}/milestones?state=open&per_page=100`) || [];
        const m = /^\d+$/.test(ms) ? all.find(x => x.number === Number(ms)) : all.find(x => x.title === ms);
        if (!m) { say(`add-goal: no open milestone "${ms}" — run \`board-gh milestones\``); return 1; }
        milestoneNumber = m.number;
      }
      const body = fs.readFileSync(brief, 'utf8');
      const fm = body.match(/^feature:\s*(.+)$/m); const feature = fm ? fm[1].trim() : null;
      const dm = body.match(/^domains:\s*(.+)$/m); const domains = dm ? dm[1].split(/[,\s]+/).filter(Boolean) : [];
      if (feature && domains.length && !domains.includes(feature)) { say(`add-goal: feature: ${feature} is not one of domains: ${domains.join(', ')} — the Feature is the goal's primary domain`); return 1; }
      const cdoms = lockCfg.contract && lockCfg.contract.domains ? Object.keys(lockCfg.contract.domains) : null;
      const ghost = cdoms ? domains.filter(d => !cdoms.includes(d)) : [];
      if (ghost.length) { say(`add-goal: domains: ${ghost.join(', ')} not in the contract (${cdoms.join(', ')}) — domains: names contract domains only (spec §4)`); return 1; }
      if (cfg.fieldIds.feature) {
        if (!feature) { say('add-goal: the BRIEF needs a `feature:` line (the Project has a Feature field = contract domains)'); return 1; }
        optionId('feature', feature); // validate before any write
      }
      const issue = runAction('add-goal', 'G?', { name, body, milestoneNumber, objective, feature: cfg.fieldIds.feature ? feature : null });
      say(`G${issue}`);
    },
    'add-item'() {
      const gn = laneOf(pos[0]); const text = pos[1];
      if (!gn || !text) throw new Error('usage: add-item G<n> "<text>" [--you] [--bucket <Priority option>] [--pipeline <opt>] [--feature <opt>] [--outcome …] [--gate LABEL] [--accept "<criterion>"] [--recipe <name>]');
      const g = goal(gn); const lane = g.lane;
      const bucket = str('bucket') || cfg.buckets[0]; const pipeline = str('pipeline');
      optionId('priority', bucket); // validate before any write
      if (pipeline) optionId('pipeline', pipeline);
      const feature = str('feature') || g.feature || featureOf(g.brief);
      if (feature) optionId('feature', feature);
      const accept = str('accept'); const recipe = str('recipe');
      if (recipe && !EXEC_RECIPES.includes(recipe)) throw new Error(`recipe must be one of ${EXEC_RECIPES.join(' | ')}`);
      // step: S<j> = max over ALL sub-issues (REST, paged) + 1 — the read query stops at 40.
      let maxStep = 0;
      for (let page = 1; ; page++) {
        const subs = gh.rest('GET', `${R}/issues/${gn}/sub_issues?per_page=100&page=${page}`) || [];
        for (const sub of subs) { const m = /^step:\s*S(\d+)/m.exec(sub.body || ''); if (m) maxStep = Math.max(maxStep, Number(m[1])); }
        if (subs.length < 100) break;
      }
      const step = `S${maxStep + 1}`;
      const labels = ['orch:item']; if (opt.you) labels.push('orch:you');
      const args = { goal: gn, lane, title: text.slice(0, 120), text, body: bodyOf(text, { step, outcome: str('outcome'), gate: str('gate'), accept, recipe }), labels,
        milestoneNumber: g.milestone ? g.milestone.number : null, bucket, pipeline, feature,
        assignee: opt.you ? gh.rest('GET', 'user').login : null };
      const issue = runAction('add-item', lane, args);
      say(String(issue));
    },
    'add-milestone'() {
      const objective = pos[0]; const target = str('target'); const done = str('done');
      if (!objective || !target || !done) throw new Error('usage: add-milestone "<objective>" --target YYYY-MM-DD --done "<observable>"');
      const d = new Date(`${target}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(target) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== target) throw new Error('--target must be a real date, YYYY-MM-DD');
      const all = pagedMilestones(gh, R, 'all');
      const malformed = all.find(m => /^M\d+ · /.test(m.title) && m.title.replace(/^M\d+ · /, '') === objective && m.title !== `M${m.number} · ${objective}`);
      if (malformed) { say(`add-milestone: malformed title on #${malformed.number} "${malformed.title}" — the ordinal must equal the milestone number; fix it on GitHub`); return 1; }
      const existing = all.find(m => m.title === `M${m.number} · ${objective}`);
      if (existing) { say(`add-milestone: exists: #${existing.number} ${existing.title}`); return 0; }
      const bare = all.find(m => m.title === objective); // created, crashed before the retitle intent was journaled
      if (bare) { runAction('retitle-milestone', 'M?', { number: bare.number, title: `M${bare.number} · ${objective}` }); say(`M${bare.number}`); return 0; }
      const number = runAction('add-milestone', 'M?', { objective, description: `target: ${target} · done: ${done}`, due_on: `${target}T00:00:00Z` });
      say(`M${number}`);
    },
    'sync-features'() {
      const { Q, domains } = require('./board-gh-init');
      const doms = domains(ctx.cwd || process.cwd());
      const field = gh.graphql(Q.fields, { p: cfg.projectId }).node.fields.nodes.find(f => f.name === 'Feature');
      if (!field) { say('sync-features: the Project has no Feature field — create one, then re-run'); return 1; }
      const have = field.options.map(x => x.name.toLowerCase());
      const missing = doms.filter(d => !have.includes(d.toLowerCase()));
      const unmapped = field.options.map(x => x.name).filter(n => !doms.some(d => d.toLowerCase() === n.toLowerCase()));
      if (missing.length) runAction('sync-features', 'board', { missing });
      const after = gh.graphql(Q.fields, { p: cfg.projectId }).node.fields.nodes.find(f => f.name === 'Feature');
      const p = path.join(ctx.cwd || process.cwd(), '.orch', 'board.json');
      const c = JSON.parse(fs.readFileSync(p, 'utf8'));
      c.fieldIds.feature = after.id; c.optionIds.feature = Object.fromEntries(after.options.map(x => [x.name, x.id]));
      fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
      say((missing.length ? `sync-features: added: ${missing.join(', ')}` : 'sync-features: in sync') + (unmapped.length ? ` · unmapped: ${unmapped.join(', ')}` : ''));
    },
    'close-milestone'() {
      const key = pos[0]; const summary = str('summary');
      if (!key) throw new Error('usage: close-milestone <milestone#|title> --summary "<line>"');
      if (!summary || !summary.trim()) { say('close-milestone: --summary "<one line against done:>" is required'); return 1; }
      const all = pagedMilestones(gh, R, 'open');
      const m = /^\d+$/.test(key) ? all.find(x => x.number === Number(key)) : all.find(x => x.title === key);
      if (!m) { say(`close-milestone: no open milestone "${key}" — run \`board-gh milestones\``); return 1; }
      const goals = readBoard(gh, cfg).goals.filter(g => g.milestone && g.milestone.number === m.number);
      if (!goals.length) { say(`close-milestone: ${m.title} has no goals — nothing was done under it`); return 1; }
      // Completeness: readBoard sees only the newest 50 orch:goal issues. Count the
      // milestone's goal issues by REST (paged) and refuse if the read window missed any.
      const restNumbers = [];
      for (let page = 1; ; page++) {
        const chunk = gh.rest('GET', `${R}/issues?milestone=${m.number}&labels=orch:goal&state=all&per_page=100&page=${page}`) || [];
        restNumbers.push(...chunk.map(i => i.number)); if (chunk.length < 100) break;
      }
      const readNumbers = goals.map(g => g.issue);
      const same = restNumbers.length === readNumbers.length && restNumbers.slice().sort((a, b) => a - b).every((n, i) => n === readNumbers.slice().sort((a, b) => a - b)[i]);
      if (!same) { say(`close-milestone: goal set differs — REST [${restNumbers.join(' ')}], board read [${readNumbers.join(' ')}] (read window too small, or a concurrent move); cannot prove completeness`); return 1; }
      const open = goals.filter(g => g.status !== 'merged');
      if (open.length) { say(`close-milestone: not merged: ${open.map(g => g.lane).join(' ')}`); return 1; }
      runAction('close-milestone', `M${m.number}`, { number: m.number, summary: summary.trim(), date: new Date().toISOString().slice(0, 10) });
      say(`${m.title} closed (${goals.length} goals)`);
    },
    move() {
      const gn = laneOf(pos[0]); const n = gn || Number(pos[0]);
      if (!n || !pos[1]) throw new Error('usage: move <issue#|G<n>> <Priority option>');
      optionId('priority', pos[1]);
      const lane = gn ? goal(gn).lane : findItem(n).g.lane;
      runAction('move', lane, { issue: n, lane, bucket: pos[1], goalMove: !!gn });
    },
    'set-status'() {
      const n = Number(pos[0]); const s = statusOpt(pos[1]); const { g } = findItem(n);
      runAction('set-status', g.lane, { issue: n, lane: g.lane, status: s.name });
    },
    'set-blocker'() {
      const n = Number(pos[0]); const text = pos[1];
      const owner = str('owner');
      if (!text || !owner) throw new Error('usage: set-blocker <issue#> "<text>" --owner <who>');
      const { g } = findItem(n);
      runAction('set-blocker', g.lane, { issue: n, lane: g.lane, text, owner });
    },
    'clear-blocker'() { const n = Number(pos[0]); const { g } = findItem(n); runAction('clear-blocker', g.lane, { issue: n, lane: g.lane }); },
    attention() {
      // "--clear" is a bare boolean flag, but parseArgs treats any flag
      // followed by a non-flag token as consuming it — so `--clear "<what
      // changed>"` lands the text in opt.clear, not pos[1]. Harmless: the
      // clear comment is the fixed string "attention cleared", so no text
      // is required on that path. Only the non-clear form needs "<why>".
      const gn = laneOf(pos[0]);
      if (!gn) throw new Error('usage: attention G<n> [--clear] "<why>"');
      if (!opt.clear && (typeof pos[1] !== 'string' || !pos[1].trim())) throw new Error('usage: attention G<n> "<why>" (required unless --clear)');
      const g = goal(gn);
      runAction('attention', g.lane, { issue: gn, lane: g.lane, clear: !!opt.clear, why: pos[1] });
    },
    done() {
      const n = Number(pos[0]); const gn = laneOf(str('goal')); const step = str('step');
      if (!n || !gn || !/^S\d+$/.test(step || '')) {
        say('done: use `done --goal G<n> --step S<j> <item#>` — a bare `done <item#>` is refused: the ship-gate evidence lint needs the goal and step ids, which an item number cannot give it offline (spec §5)'); return 1;
      }
      const { g, i } = findItem(n);
      if (g.issue !== gn) { say(`done: #${n} belongs to ${g.lane}, not G${gn}`); return 1; }
      if (i.step !== step) { say(`done: #${n} is step ${i.step || '(none)'}, not ${step}`); return 1; }
      runAction('done', g.lane, { issue: n, lane: g.lane });
    },
    'close-goal'() {
      const gn = laneOf(pos[0]); if (!gn) throw new Error('usage: close-goal G<n> --evidence "<ledger line or artifact path>"');
      const evidence = str('evidence');
      if (!evidence || !evidence.trim()) { say(`close-goal: --evidence required (ledger line or artifact path naming G${gn})`); return 1; }
      const g = goal(gn);
      if (!g.items.length) { say(`close-goal: ${g.lane} has no step — every goal has at least S1`); return 1; }
      const open = g.items.filter(i => !i.done);
      if (open.length) { say(`close-goal: ${g.lane} has ${open.length} open item(s): ${open.map(i => '#' + i.issue).join(' ')}`); return 1; }
      runAction('close-goal', g.lane, { issue: gn, lane: g.lane, evidence: evidence.trim() });
      say(`${g.lane} merged`);
    },
  };
  if (!VERBS[verb]) { say(`board-gh: unknown verb ${verb}`); return 1; }
  try { return withLock(lockPath, () => { replay(); return VERBS[verb]() || 0; }); }
  catch (e) { say(`board-gh: ${verb} failed — ${e.message}`); return 1; }
}

module.exports = { write };
