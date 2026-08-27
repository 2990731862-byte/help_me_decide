// Starts server.js in a child process against a throwaway SQLite file.
// server.js reads PORT / APPROVAL_DB_PATH at module load and has no exports,
// so a child process is the only way to get an isolated instance per test file.
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, child, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt made';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy in ${timeoutMs}ms: ${lastError}`);
}

// Returns { baseUrl, dbPath, stop, restart }. Always call stop() in an after() hook.
async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-test-'));
  const dbPath = path.join(dir, 'approval.sqlite');
  let child = null;
  let port = null;

  async function spawnOnce() {
    port = port || (await freePort());
    const next = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: String(port),
        APPROVAL_DB_PATH: dbPath,
        // Point the legacy-migration source at a path that will never exist,
        // so tests never inherit a developer's local data.json.
        APPROVAL_LEGACY_DATA: path.join(dir, 'absent-legacy.json'),
      },
    });
    let stderr = '';
    next.stderr.on('data', chunk => {
      stderr += chunk;
    });
    next.on('exit', code => {
      if (code && code !== 0 && stderr) process.stderr.write(`server stderr:\n${stderr}`);
    });
    await waitForHealth(`http://127.0.0.1:${port}`, next);
    return next;
  }

  async function stopChild() {
    if (!child) return;
    const dead = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    await Promise.race([dead, new Promise(resolve => setTimeout(resolve, 3000))]);
    child = null;
  }

  child = await spawnOnce();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    dbPath,
    // Proves data survives a process restart, which is what the SQLite work was for.
    async restart() {
      await stopChild();
      child = await spawnOnce();
    },
    async stop() {
      await stopChild();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { startServer };
