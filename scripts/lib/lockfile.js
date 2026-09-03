// Exclusive lockfile for board writes (spec §3.1 discipline, §4.3 use).
// O_EXCL create is the atomicity primitive; a lock whose owner PID is dead
// AND whose file is older than staleMs is taken over.
// ponytail: liveness = process.kill(pid, 0) only; PID reuse inside the
// stale window is accepted. Add the OS start-time check (spec §3.1) when
// the fleet roster lands and shares this file.
'use strict';
const fs = require('fs');
const path = require('path');

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

function withLock(lockPath, fn, { staleMs = 30000, waitMs = 10000 } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + waitMs;
  let fd;
  for (;;) {
    try { fd = fs.openSync(lockPath, 'wx'); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner = null;
      try { owner = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
      const stale = owner && typeof owner.t === 'number' && Date.now() - owner.t > staleMs;
      const dead = !owner || typeof owner.pid !== 'number' || !alive(owner.pid);
      if (stale && dead) { try { fs.unlinkSync(lockPath); } catch {} continue; }
      if (Date.now() >= deadline) throw new Error(`board lock held by pid ${owner ? owner.pid : '?'} (${lockPath})`);
      sleep(200);
    }
  }
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, t: Date.now() }));
    fs.fsyncSync(fd);
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

module.exports = { withLock };
