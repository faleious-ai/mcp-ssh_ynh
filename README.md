# MCP SSH Approval for YunoHost

A minimal, single-tool remote MCP server.

- Streamable HTTP at `/mcp`
- OAuth 2.1 Authorization Code + PKCE
- Dynamic client registration
- YunoHost SSO for OAuth consent and command approval
- Exactly one MCP tool: `ssh_execute`
- Every command, including reads, requires a separate one-time human approval
- Exact command binding: any change invalidates the approval
- Five-minute expiry and single-use approvals

The service executes approved commands over a loopback SSH connection to its dedicated YunoHost system account. That account intentionally has passwordless sudo so approved commands can administer the server.

## Migration from 3.x

Version 3.x exposed stdio over an external SSH key. Version 4 is a remote HTTPS/OAuth MCP and requires a dedicated domain and an approver account. Use a clean reinstall when migrating from 3.x.
