'use strict';
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const PC_TOKEN = 'pc_test_token_123456789012345';
const ROBLOX_TOKEN = 'rbx_test_token_12345678901234';
const PORT = 32481;
const child = spawn(process.execPath, ['server.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(PORT), PC_TOKEN, ROBLOX_TOKEN },
  stdio: 'ignore',
});
async function post(path, payload) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  return [res.status, await res.json()];
}
(async () => {
  try {
    let ready = false;
    for (let i = 0; i < 40; ++i) {
      try { const r = await fetch(`http://127.0.0.1:${PORT}`); ready = r.ok; if (ready) break; }
      catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(ready, true);
    const frame = Buffer.alloc(96 * 54, 0xff).toString('base64');
    assert.equal((await post('/api/pc/frame', { token: 'bad', frame }))[0], 403);
    assert.equal((await post('/api/pc/frame', { token: PC_TOKEN, frame: 'bad' }))[0], 400);
    assert.equal((await post('/api/pc/frame', { token: PC_TOKEN, frame }))[0], 200);
    const [status, reply] = await post('/api/roblox/sync', {
      token: ROBLOX_TOKEN, lastSeq: -1, controls: { up: true, jump: true },
    });
    assert.equal(status, 200);
    assert.equal(reply.frame, frame);
    assert.equal(reply.online, true);
    const [status2, reply2] = await post('/api/roblox/sync', {
      token: ROBLOX_TOKEN, lastSeq: reply.seq, controls: { up: false },
    });
    assert.equal(status2, 200);
    assert.equal(reply2.frame, null);
    const [status3, reply3] = await post('/api/pc/controls', { token: PC_TOKEN });
    assert.equal(status3, 200);
    assert.equal(reply3.controls.up, false);
    assert.equal(reply3.controls.jump, false);
    console.log('OK: upload, token checks, sync, control changes, frame deduplication.');
  } finally { child.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
