import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class JsonStore {
  constructor(file) { this.file = file; this.queue = Promise.resolve(); }
  async init() {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    try { await readFile(this.file, 'utf8'); } catch { await this.write(initialState()); }
  }
  async read() {
    try { return { ...initialState(), ...JSON.parse(await readFile(this.file, 'utf8')) }; }
    catch { return initialState(); }
  }
  async write(state) {
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, this.file);
  }
  async get(fn) { await this.queue; return fn(await this.read()); }
  async mutate(fn) {
    this.queue = this.queue.then(async () => {
      const state = await this.read();
      await fn(state);
      await this.write(state);
    });
    return this.queue;
  }
}

export function initialState() {
  return { clients: {}, authRequests: {}, authCodes: {}, accessTokens: {}, refreshTokens: {}, approvals: {} };
}

export function cleanup(state) {
  const now = Date.now();
  for (const group of ['authRequests', 'authCodes', 'accessTokens', 'refreshTokens', 'approvals']) {
    for (const [key, value] of Object.entries(state[group])) {
      if (value.expiresAt && value.expiresAt < now) delete state[group][key];
    }
  }
}

export function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function requiredUrl(name) {
  return new URL(required(name)).toString().replace(/\/$/, '');
}

export function token(bytes) { return randomBytes(bytes).toString('base64url'); }
export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function pkceChallenge(value) { return createHash('sha256').update(value).digest('base64url'); }
export function safeHashEqual(a, b) {
  return /^[a-f0-9]{64}$/.test(a || '') && /^[a-f0-9]{64}$/.test(b || '') &&
    timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
export function safeStringEqual(a, b) {
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  return timingSafeEqual(ah, bh);
}
export function validRedirectUri(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  } catch { return false; }
}
export function shellQuote(value) { return `'${value.replaceAll("'", "'\\''")}'`; }
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}
export function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{font:16px system-ui;max-width:900px;margin:3rem auto;padding:0 1rem}pre{white-space:pre-wrap;background:#111;color:#eee;padding:1rem;overflow:auto}button{padding:.7rem 1rem;margin:.3rem}</style></head><body>${body}</body></html>`;
}
export function toolText(text) { return { content: [{ type: 'text', text }] }; }
export function toolError(text) { return { isError: true, content: [{ type: 'text', text }] }; }
export function formatResult(command, result) {
  return `COMMAND\n${command}\n\nEXIT CODE\n${result.exitCode}\n\nSTDOUT\n${result.stdout}\n\nSTDERR\n${result.stderr}${result.truncated ? '\n\n[output truncated]' : ''}`;
}

export function executeSsh(config, command, timeoutSeconds) {
  const remoteCommand = `bash -lc ${shellQuote(command)}`;
  const args = [
    '-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
    '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${config.knownHosts}`,
    '-i', config.sshKey, '-p', String(config.sshPort),
    `${config.sshUser}@${config.sshHost}`, remoteCommand
  ];
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' }
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    const append = (current, chunk) => {
      const room = config.maxOutputBytes - current.length;
      if (room <= 0) { truncated = true; return current; }
      if (chunk.length > room) { truncated = true; return Buffer.concat([current, chunk.subarray(0, room)]); }
      return Buffer.concat([current, chunk]);
    };
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    }, timeoutSeconds * 1000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`Timed out after ${timeoutSeconds} seconds`));
      resolve({ exitCode: code ?? 255, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), truncated });
    });
  });
}
