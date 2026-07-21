import path from 'node:path';
import express from 'express';
import { JsonStore, required, requiredUrl } from './core.mjs';
import { registerOAuthRoutes } from './oauth.mjs';
import { registerApprovalRoutes } from './approvals.mjs';
import { registerMcpRoute } from './mcp.mjs';

const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 8095),
  baseUrl: requiredUrl('BASE_URL'),
  dataDir: process.env.DATA_DIR || '/var/lib/mcp-ssh',
  approverUser: required('APPROVER_USER'),
  sshUser: process.env.SSH_USER || 'mcp-ssh',
  sshHost: process.env.SSH_HOST || '127.0.0.1',
  sshPort: Number(process.env.SSH_PORT || 22),
  sshKey: required('SSH_KEY'),
  knownHosts: required('KNOWN_HOSTS'),
  maxOutputBytes: Number(process.env.MAX_OUTPUT_BYTES || 262144),
  approvalTtlSeconds: Number(process.env.APPROVAL_TTL_SECONDS || 300),
  accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 3600),
  refreshTokenTtlSeconds: Number(process.env.REFRESH_TOKEN_TTL_SECONDS || 2592000)
};

const store = new JsonStore(path.join(config.dataDir, 'state.json'));
await store.init();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', ['loopback']);
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  next();
});
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const { requireSsoUser, requireAccessToken } = registerOAuthRoutes(app, config, store);
registerApprovalRoutes(app, store, requireSsoUser);
const closeMcpSessions = registerMcpRoute(app, config, store, requireAccessToken);

const httpServer = app.listen(config.port, config.host, () => {
  console.log(`mcp-ssh listening on ${config.host}:${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    httpServer.close();
    await closeMcpSessions();
    process.exit(0);
  });
}
