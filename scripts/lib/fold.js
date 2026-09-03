// Goal status is DERIVED from the goal issue + its sub-issues (spec §4.1
// fold). Nothing stores it, so nothing can drift. First match wins.
'use strict';
function has(x, label) { return (x.labels || []).includes(label); }

function foldStatus(goal, items) {
  if (goal.state === 'closed') return { status: 'merged', blocker: null };
  const blocked = items.find(i => has(i, 'orch:blocked'));
  if (blocked) return { status: 'blocked', blocker: blocked.blockerComment || null };
  if (has(goal, 'orch:needs_attention')) return { status: 'needs_attention', blocker: null };
  if (items.some(i => i.status === 'In review')) return { status: 'review', blocker: null };
  if (items.some(i => i.status === 'In progress')) return { status: 'running', blocker: null };
  return { status: 'ready', blocker: null };
}

module.exports = { foldStatus };
