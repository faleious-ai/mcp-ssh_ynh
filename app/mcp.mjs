import { randomUUID } from 'node:crypto';
import { McpServer, isInitializeRequest } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
import { cleanup, executeSsh, formatResult, token, toolError, toolText } from './core.mjs';

export function registerMcpRoute(app, config, store, requireAccessToken) {
  const sessions = new Map();

  app.all('/mcp', requireAccessToken, async (req, res) => {
    try {
      const sessionId = String(req.headers['mcp-session-id'] || '');
      let entry = sessionId ? sessions.get(sessionId) : undefined;

      if (entry) {
        if (entry.clientId !== req.auth.clientId || entry.user !== req.auth.extra?.user) {
          return res.status(403).json({ error: 'session_owner_mismatch' });
        }
      } else if (req.method === 'POST' && !sessionId && isInitializeRequest(req.body)) {
        let server;
        const transport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: id => {
            sessions.set(id, { transport, server, clientId: req.auth.clientId, user: req.auth.extra?.user });
          }
        });
        server = createMcpServer(config, store, req.auth);
        transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
        transport.onerror = error => console.error('MCP transport error:', error);
        await server.connect(transport);
        entry = { transport, server, clientId: req.auth.clientId, user: req.auth.extra?.user };
      } else {
        return res.status(400).json({
          jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: missing or invalid MCP session' }, id: null
        });
      }
      await entry.transport.handleRequest(req, res, req.method === 'POST' ? req.body : undefined);
    } catch (error) {
      console.error('MCP request error:', error);
      if (!res.headersSent) res.status(500).json({ error: 'mcp_internal_error' });
    }
  });

  return async () => {
    await Promise.allSettled([...sessions.values()].map(async entry => {
      await entry.transport.close();
      await entry.server.close();
    }));
  };
}

function createMcpServer(config, store, authInfo) {
  const user = String(authInfo?.extra?.user || 'unknown');
  const server = new McpServer(
    { name: 'mcp-ssh-approval', version: '4.0.0' },
    { instructions: 'There is one tool. First call it without approval_id to create a human approval request. Show the exact command and approval URL to the user. After the user confirms approval in YunoHost, call the same tool again with the unchanged command and approval_id. Never alter a command after approval.' }
  );

  server.registerTool('ssh_execute', {
    title: 'Execute an approved SSH command',
    description: 'Runs one exact shell command on the YunoHost server over SSH. Every command, including reads, requires a separate human approval. The first call only creates an approval request and does not execute anything.',
    inputSchema: z.object({
      command: z.string().min(1).max(8192).describe('Exact shell command to display and, after approval, execute unchanged.'),
      approval_id: z.string().min(16).max(128).optional().describe('Approval ID returned by the first call. Omit it to request approval.'),
      timeout_seconds: z.number().int().min(1).max(300).default(60)
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async ({ command, approval_id: approvalId, timeout_seconds: timeoutSeconds }) => {
    if (!approvalId) {
      const id = token(24);
      const csrf = token(24);
      await store.mutate(state => {
        cleanup(state);
        state.approvals[id] = {
          id, csrf, user, command, timeoutSeconds, status: 'pending',
          createdAt: Date.now(), expiresAt: Date.now() + config.approvalTtlSeconds * 1000
        };
      });
      const approvalUrl = `${config.baseUrl}/approvals/${encodeURIComponent(id)}`;
      return toolText(`AUTHORIZATION REQUIRED\n\nExact command:\n${command}\n\nApproval URL:\n${approvalUrl}\n\nNo command has been executed. Open the URL, approve the exact command, then call ssh_execute again with approval_id=${id}.`);
    }

    let approval;
    await store.mutate(state => {
      cleanup(state);
      const candidate = state.approvals[approvalId];
      if (!candidate) return;
      approval = structuredClone(candidate);
      if (candidate.status === 'approved' && candidate.user === user &&
          candidate.command === command && candidate.timeoutSeconds === timeoutSeconds) {
        candidate.status = 'executing';
        candidate.executingAt = Date.now();
      }
    });
    if (!approval) return toolError('Approval not found or expired. Request a new approval.');
    if (approval.user !== user) return toolError('Approval belongs to another authenticated user.');
    if (approval.command !== command || approval.timeoutSeconds !== timeoutSeconds) {
      return toolError('Command or timeout differs from the approved request. Request a new approval.');
    }
    if (approval.status === 'pending') return toolText(`Still awaiting human approval: ${config.baseUrl}/approvals/${encodeURIComponent(approvalId)}`);
    if (approval.status === 'denied') return toolError('The command was denied.');
    if (approval.status === 'executed' || approval.status === 'executing') return toolError('This one-time approval has already been consumed.');
    if (approval.status !== 'approved') return toolError(`Approval is not executable: ${approval.status}`);

    try {
      const result = await executeSsh(config, command, timeoutSeconds);
      await store.mutate(state => {
        const current = state.approvals[approvalId];
        if (current) {
          current.status = 'executed';
          current.executedAt = Date.now();
          current.exitCode = result.exitCode;
        }
      });
      return {
        content: [{ type: 'text', text: formatResult(command, result) }],
        structuredContent: {
          command, exit_code: result.exitCode, stdout: result.stdout,
          stderr: result.stderr, truncated: result.truncated
        }
      };
    } catch (error) {
      await store.mutate(state => {
        const current = state.approvals[approvalId];
        if (current) {
          current.status = 'failed';
          current.failedAt = Date.now();
          current.error = String(error.message || error).slice(0, 500);
        }
      });
      return toolError(`Execution failed: ${error.message || error}`);
    }
  });
  return server;
}
