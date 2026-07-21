import { escapeHtml, page, safeStringEqual } from './core.mjs';

export function registerApprovalRoutes(app, store, requireSsoUser) {
  app.get('/', (_req, res) => res.redirect(303, '/approvals'));

  app.get('/approvals', requireSsoUser, async (req, res) => {
    const approvals = await store.get(state => Object.values(state.approvals)
      .filter(approval => approval.expiresAt >= Date.now() && approval.status !== 'executed')
      .sort((a, b) => b.createdAt - a.createdAt));
    const items = approvals.length
      ? approvals.map(approval => `<li><a href="/approvals/${encodeURIComponent(approval.id)}">${escapeHtml(approval.status)} — ${escapeHtml(approval.command.slice(0, 120))}</a></li>`).join('')
      : '<li>No pending requests.</li>';
    res.type('html').send(page('MCP SSH approvals', `<h1>MCP SSH approvals</h1><p>Signed in as ${escapeHtml(req.ssoUser)}.</p><ul>${items}</ul>`));
  });

  app.get('/approvals/:id', requireSsoUser, async (req, res) => {
    const approval = await store.get(state => state.approvals[req.params.id]);
    if (!approval) return res.status(404).type('html').send(page('Not found', '<p>Approval not found.</p>'));
    res.type('html').send(page('Approve SSH command', `
      <h1>SSH command approval</h1>
      <p><strong>Status:</strong> ${escapeHtml(approval.status)}</p>
      <p><strong>Requested by:</strong> ${escapeHtml(approval.user)}</p>
      <p><strong>Expires:</strong> ${escapeHtml(new Date(approval.expiresAt).toISOString())}</p>
      <pre>${escapeHtml(approval.command)}</pre>
      ${approval.status === 'pending' ? `<form method="post" action="/approvals/${encodeURIComponent(approval.id)}">
        <input type="hidden" name="csrf" value="${escapeHtml(approval.csrf)}">
        <button type="submit" name="decision" value="approve">Approve exact command</button>
        <button type="submit" name="decision" value="deny">Deny</button>
      </form>` : ''}`));
  });

  app.post('/approvals/:id', requireSsoUser, async (req, res) => {
    const decision = req.body?.decision === 'approve' ? 'approved' : 'denied';
    let updated = false;
    await store.mutate(state => {
      const approval = state.approvals[req.params.id];
      if (!approval || approval.status !== 'pending' || approval.expiresAt < Date.now()) return;
      if (!safeStringEqual(String(req.body?.csrf || ''), approval.csrf)) return;
      approval.status = decision;
      approval.decidedBy = req.ssoUser;
      approval.decidedAt = Date.now();
      updated = true;
    });
    if (!updated) {
      return res.status(400).type('html').send(page('Invalid request', '<p>The approval is invalid, expired, or already decided.</p>'));
    }
    res.redirect(303, `/approvals/${encodeURIComponent(req.params.id)}`);
  });
}
