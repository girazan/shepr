// board-gh init — adopt (--project N) or find-or-create the repo's
// Project; ensure Status options; read Priority (buckets) / Pipeline /
// Feature as they are, creating Priority/Pipeline only when absent;
// create orch:* labels; write .orch/board.json. Idempotent. --dry-run
// prints and writes nothing. Milestones are the operator's — never
// created. Priority options are never renamed here (operator's UI step).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const STATUS_OPTS = ['Todo', 'In progress', 'In review', 'Done'];
const DEFAULT_BUCKETS = ['Now', 'Next', 'Later'];
const LABELS = { 'orch:goal': '5319e7', 'orch:item': '0e8a16', 'orch:you': 'fbca04', 'orch:blocked': 'd93f0b', 'orch:needs_attention': 'e99695' };
const optInput = names => names.map(name => ({ name, color: 'GRAY', description: '' }));
const Q = {
  owner: 'query($o:String!){ repositoryOwner(login:$o){ id __typename ... on ProjectV2Owner { projectsV2(first:100){ nodes{ id number title } } } } }',
  createProject: 'mutation($o:ID!,$t:String!){ createProjectV2(input:{ownerId:$o,title:$t}){ projectV2{ id number } } }',
  fields: 'query($p:ID!){ node(id:$p){ ... on ProjectV2 { fields(first:50){ nodes{ ... on ProjectV2FieldCommon { id name } ... on ProjectV2SingleSelectField { id name options{ id name color description } } } } } } }',
  updateField: 'mutation($f:ID!,$opts:[ProjectV2SingleSelectFieldOptionInput!]!){ updateProjectV2Field(input:{fieldId:$f,singleSelectOptions:$opts}){ projectV2Field{ ... on ProjectV2SingleSelectField { id options{ id name color description } } } } }',
  createSelect: 'mutation($p:ID!,$name:String!,$opts:[ProjectV2SingleSelectFieldOptionInput!]!){ createProjectV2Field(input:{projectId:$p,dataType:SINGLE_SELECT,name:$name,singleSelectOptions:$opts}){ projectV2Field{ ... on ProjectV2SingleSelectField { id name options{ id name color description } } } } }',
};

function remoteRepo(cwd) {
  const url = execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const m = url.match(/[:/]([^/:]+)\/([^/]+?)(\.git)?\/?$/);
  if (!m) throw new Error(`cannot parse origin url: ${url}`);
  return { owner: m[1], repo: m[2] };
}
function domains(cwd) {
  try { const c = JSON.parse(fs.readFileSync(path.join(cwd, '.claude', 'orch.json'), 'utf8')); return Object.keys((c.contract && c.contract.domains) || {}); }
  catch { return []; }
}
function ensureOptions(gh, field, wanted, say, dry, label) {
  const have = field.options.map(x => x.name.toLowerCase());
  const missing = wanted.filter(s => !have.includes(s.toLowerCase()));
  if (!missing.length) return field;
  say(`DRY add ${label} options: ${missing.join(', ')}`);
  if (dry) return field;
  const preserved = field.options.map(x => ({ name: x.name, color: x.color || 'GRAY', description: x.description || '' }));
  const newOpts = optInput(missing);
  return gh.graphql(Q.updateField, { f: field.id, opts: [...preserved, ...newOpts] }).updateProjectV2Field.projectV2Field;
}
function createSelect(gh, project, name, opts, say, dry) {
  say(`DRY create ${name} field: ${opts.join(', ')}`);
  return dry ? { id: 'DRY', options: [] } : gh.graphql(Q.createSelect, { p: project.id, name, opts: optInput(opts) }).createProjectV2Field.projectV2Field;
}

function init({ opt, cwd, gh, stdout }) {
  const dry = !!opt['dry-run'];
  const say = s => stdout(s + '\n');
  if (opt.project === true) { say('init: --project requires a value'); return 1; }
  if (opt.owner === true) { say('init: --owner requires a value'); return 1; }
  const { owner: repoOwner, repo } = remoteRepo(cwd);
  const owner = typeof opt.owner === 'string' ? opt.owner : repoOwner;
  const title = `${repo} · orch board`;

  const o = gh.graphql(Q.owner, { o: owner }).repositoryOwner;
  let project;
  if (opt.project !== undefined) {
    project = o.projectsV2.nodes.find(p => p.number === Number(opt.project));
    if (!project) { say(`init: no project #${opt.project} under ${owner}`); return 1; }
  } else {
    project = o.projectsV2.nodes.find(p => p.title === title);
    if (!project) {
      say(`DRY create project "${title}" under ${owner}`);
      project = dry ? { id: 'DRY', number: 0 } : gh.graphql(Q.createProject, { o: o.id, t: title }).createProjectV2.projectV2;
    }
  }
  const fields = project.id === 'DRY' ? [] : gh.graphql(Q.fields, { p: project.id }).node.fields.nodes;
  const byName = n => fields.find(f => f.name === n);

  const adopted = opt.project !== undefined;
  const statusField = byName('Status');
  let status;
  if (adopted) {
    // Adopted project: never rewrite an existing field's options — the
    // operator owns that field already. Missing canonical options is a
    // hard stop (dry-run included), not a silent add.
    const have = (statusField ? statusField.options : []).map(o => o.name.toLowerCase());
    const missing = STATUS_OPTS.filter(s => !have.includes(s.toLowerCase()));
    if (missing.length) {
      say(`init: Status field on project #${project.number} is missing option(s): ${missing.join(', ')} — add them in the Project settings, then re-run`);
      return 1;
    }
    status = statusField;
  } else {
    status = ensureOptions(gh, statusField || { id: 'DRY', options: [] }, STATUS_OPTS, say, dry, 'Status');
  }
  // Priority IS the bucket axis. Present → read verbatim (operator renames
  // P0/P1/P2 → Now/Next/Later in the UI). Absent → create Now/Next/Later.
  const existingPriority = byName('Priority');
  const priority = existingPriority || createSelect(gh, project, 'Priority', DEFAULT_BUCKETS, say, dry);
  if (existingPriority && !existingPriority.options.length) { say('init: Priority field has no options — add at least one in the Project settings.'); return 1; }
  const doms = domains(cwd);
  // Pipeline is pass-through (operator's meaning): absent → one option so the field exists.
  const pipeline = byName('Pipeline') || createSelect(gh, project, 'Pipeline', ['general'], say, dry);
  // Feature options ARE the contract's domain names (spec d.18). Non-adopt: seed
  // when absent. Adopt: never create fields — hint instead.
  let feature = byName('Feature') || null;
  if (!feature) {
    if (adopted) say('init: no Feature field on the adopted project — add one whose options are your contract domain names, then run `sync-features`');
    else if (doms.length) feature = createSelect(gh, project, 'Feature', doms, say, dry);
  }

  const existing = new Set((gh.rest('GET', `repos/${repoOwner}/${repo}/labels?per_page=100`) || []).map(l => l.name));
  for (const [name, color] of Object.entries(LABELS)) {
    if (existing.has(name)) continue;
    say(`DRY create label ${name}`);
    if (!dry) gh.rest('POST', `repos/${repoOwner}/${repo}/labels`, { name, color });
  }
  if (dry) { say('DRY — nothing written.'); return 0; }

  const toMap = f => Object.fromEntries((f.options || []).map(x => [x.name, x.id]));
  const raw = toMap(status), optStatus = {};
  for (const s of STATUS_OPTS) { const k = Object.keys(raw).find(x => x.toLowerCase() === s.toLowerCase()); optStatus[s] = raw[k]; }
  const cfg = { owner: repoOwner, repo, projectOwner: owner, ownerType: o.__typename, projectNumber: project.number, projectId: project.id,
    fieldIds: { status: status.id, priority: priority.id, pipeline: pipeline.id, feature: feature ? feature.id : null },
    optionIds: { status: optStatus, priority: toMap(priority), pipeline: toMap(pipeline), feature: feature ? toMap(feature) : {} } };
  fs.mkdirSync(path.join(cwd, '.orch'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.orch', 'board.json'), JSON.stringify(cfg, null, 2) + '\n');
  say(`board-gh: wrote .orch/board.json (project #${project.number} under ${owner}; buckets = ${Object.keys(cfg.optionIds.priority).join(' → ')}) — commit it.`);
  return 0;
}

module.exports = { init, Q, optInput, domains, STATUS_OPTS, DEFAULT_BUCKETS };
