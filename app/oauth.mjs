import {
  escapeHtml, page, pkceChallenge, safeHashEqual, sha256, token, validRedirectUri, cleanup
} from './core.mjs';

export function registerOAuthRoutes(app, config, store) {
  const requireSsoUser = createSsoGuard(config);

  const protectedResourceMetadata = (_req, res) => res.json({
    resource: `${config.baseUrl}/mcp`,
    authorization_servers: [config.baseUrl],
    scopes_supported: ['mcp:use'],
    bearer_methods_supported: ['header']
  });

  app.get('/.well-known/oauth-protected-resource', protectedResourceMetadata);
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResourceMetadata);
  app.get('/.well-known/oauth-authorization-server', (_req, res) => res.json({
    issuer: config.baseUrl,
    authorization_endpoint: `${config.baseUrl}/oauth/authorize`,
    token_endpoint: `${config.baseUrl}/oauth/token`,
    registration_endpoint: `${config.baseUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['mcp:use']
  }));

  app.post('/oauth/register', async (req, res) => {
    const redirectUris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris : [];
    if (redirectUris.length < 1 || redirectUris.length > 10 || !redirectUris.every(validRedirectUri)) {
      return oauthJsonError(res, 400, 'invalid_redirect_uri');
    }
    if ((req.body?.token_endpoint_auth_method || 'none') !== 'none') {
      return oauthJsonError(res, 400, 'invalid_client_metadata');
    }
    const clientId = token(24);
    const client = {
      clientId,
      clientName: String(req.body?.client_name || 'MCP client').slice(0, 120),
      redirectUris,
      createdAt: Date.now()
    };
    await store.mutate(state => { state.clients[clientId] = client; });
    res.status(201).json({
      client_id: clientId,
      client_name: client.clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code']
    });
  });

  app.get('/oauth/authorize', requireSsoUser, async (req, res) => {
    const parsed = await validateAuthorizeRequest(store, req.query);
    if (!parsed.ok) return res.status(400).type('html').send(page('OAuth error', `<p>${escapeHtml(parsed.error)}</p>`));
    const requestId = token(24);
    const csrf = token(24);
    await store.mutate(state => {
      state.authRequests[requestId] = {
        ...parsed.value, requestId, csrfHash: sha256(csrf), user: req.ssoUser,
        expiresAt: Date.now() + 300000
      };
    });
    res.type('html').send(page('Authorize MCP client', `
      <h1>Authorize MCP access</h1>
      <p><strong>Client:</strong> ${escapeHtml(parsed.value.clientName)}</p>
      <p><strong>Scope:</strong> mcp:use</p>
      <p>This client may submit SSH commands, but every command still requires a separate approval in this YunoHost interface.</p>
      <form method="post" action="/oauth/authorize">
        <input type="hidden" name="request_id" value="${escapeHtml(requestId)}">
        <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
        <button type="submit" name="decision" value="allow">Authorize</button>
        <button type="submit" name="decision" value="deny">Deny</button>
      </form>`));
  });

  app.post('/oauth/authorize', requireSsoUser, async (req, res) => {
    const requestId = String(req.body?.request_id || '');
    const csrf = String(req.body?.csrf || '');
    const authRequest = await store.get(state => state.authRequests[requestId]);
    if (!authRequest || authRequest.expiresAt < Date.now() || authRequest.user !== req.ssoUser ||
        !safeHashEqual(authRequest.csrfHash, sha256(csrf))) {
      return res.status(400).type('html').send(page('Invalid request', '<p>The authorization request is invalid or expired.</p>'));
    }
    await store.mutate(state => { delete state.authRequests[requestId]; });
    const redirect = new URL(authRequest.redirectUri);
    if (req.body?.decision !== 'allow') {
      redirect.searchParams.set('error', 'access_denied');
      if (authRequest.state) redirect.searchParams.set('state', authRequest.state);
      return res.redirect(303, redirect.toString());
    }
    const code = token(32);
    await store.mutate(state => {
      state.authCodes[sha256(code)] = {
        clientId: authRequest.clientId,
        redirectUri: authRequest.redirectUri,
        codeChallenge: authRequest.codeChallenge,
        user: req.ssoUser,
        expiresAt: Date.now() + 300000
      };
    });
    redirect.searchParams.set('code', code);
    if (authRequest.state) redirect.searchParams.set('state', authRequest.state);
    res.redirect(303, redirect.toString());
  });

  app.post('/oauth/token', async (req, res) => {
    const grantType = String(req.body?.grant_type || '');
    if (grantType === 'authorization_code') return exchangeAuthorizationCode(config, store, req, res);
    if (grantType === 'refresh_token') return exchangeRefreshToken(config, store, req, res);
    return oauthJsonError(res, 400, 'unsupported_grant_type');
  });

  return {
    requireSsoUser,
    requireAccessToken: createAccessTokenGuard(config, store)
  };
}

export function createSsoGuard(config) {
  return (req, res, next) => {
    const user = String(req.headers['ynh-user'] || '');
    if (!user || user !== config.approverUser) {
      return res.status(403).type('html').send(page('Forbidden', '<p>This page requires the configured YunoHost approver account.</p>'));
    }
    req.ssoUser = user;
    next();
  };
}

function createAccessTokenGuard(config, store) {
  return async (req, res, next) => {
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(req.headers.authorization || '');
    if (!match) return bearerChallenge(config, res, 'invalid_token');
    const record = await store.get(state => state.accessTokens[sha256(match[1])]);
    if (!record || record.expiresAt < Date.now()) return bearerChallenge(config, res, 'invalid_token');
    req.auth = {
      token: match[1], clientId: record.clientId, scopes: ['mcp:use'],
      expiresAt: Math.floor(record.expiresAt / 1000),
      resource: new URL(`${config.baseUrl}/mcp`), extra: { user: record.user }
    };
    next();
  };
}

async function validateAuthorizeRequest(store, query) {
  const clientId = String(query.client_id || '');
  const redirectUri = String(query.redirect_uri || '');
  const client = await store.get(state => state.clients[clientId]);
  if (!client) return { ok: false, error: 'Unknown OAuth client.' };
  if (!client.redirectUris.includes(redirectUri)) return { ok: false, error: 'Unregistered redirect URI.' };
  if (query.response_type !== 'code') return { ok: false, error: 'Only response_type=code is supported.' };
  if (String(query.code_challenge_method || '') !== 'S256') return { ok: false, error: 'PKCE S256 is required.' };
  const codeChallenge = String(query.code_challenge || '');
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) return { ok: false, error: 'Invalid PKCE challenge.' };
  const scope = String(query.scope || 'mcp:use');
  if (scope.split(/\s+/).some(value => value !== 'mcp:use')) return { ok: false, error: 'Unsupported scope.' };
  return {
    ok: true,
    value: { clientId, clientName: client.clientName, redirectUri, codeChallenge, state: String(query.state || ''), scope: 'mcp:use' }
  };
}

async function exchangeAuthorizationCode(config, store, req, res) {
  const codeHash = sha256(String(req.body?.code || ''));
  const clientId = String(req.body?.client_id || '');
  const redirectUri = String(req.body?.redirect_uri || '');
  const verifier = String(req.body?.code_verifier || '');
  let record;
  await store.mutate(state => { record = state.authCodes[codeHash]; delete state.authCodes[codeHash]; });
  if (!record || record.expiresAt < Date.now() || record.clientId !== clientId ||
      record.redirectUri !== redirectUri || pkceChallenge(verifier) !== record.codeChallenge) {
    return oauthJsonError(res, 400, 'invalid_grant');
  }
  return issueTokens(config, store, res, record.clientId, record.user);
}

async function exchangeRefreshToken(config, store, req, res) {
  const refreshHash = sha256(String(req.body?.refresh_token || ''));
  const clientId = String(req.body?.client_id || '');
  let record;
  await store.mutate(state => { record = state.refreshTokens[refreshHash]; delete state.refreshTokens[refreshHash]; });
  if (!record || record.expiresAt < Date.now() || record.clientId !== clientId) {
    return oauthJsonError(res, 400, 'invalid_grant');
  }
  return issueTokens(config, store, res, record.clientId, record.user);
}

async function issueTokens(config, store, res, clientId, user) {
  const accessToken = token(32);
  const refreshToken = token(48);
  const now = Date.now();
  await store.mutate(state => {
    cleanup(state);
    state.accessTokens[sha256(accessToken)] = { clientId, user, expiresAt: now + config.accessTokenTtlSeconds * 1000 };
    state.refreshTokens[sha256(refreshToken)] = { clientId, user, expiresAt: now + config.refreshTokenTtlSeconds * 1000 };
  });
  res.json({
    access_token: accessToken, token_type: 'Bearer', expires_in: config.accessTokenTtlSeconds,
    refresh_token: refreshToken, scope: 'mcp:use'
  });
}

function bearerChallenge(config, res, error) {
  res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${config.baseUrl}/.well-known/oauth-protected-resource/mcp", error="${error}"`);
  return res.status(401).json({ error });
}
function oauthJsonError(res, status, error) { return res.status(status).json({ error }); }
