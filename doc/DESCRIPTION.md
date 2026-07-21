# MCP SSH Approval

A deliberately small remote MCP server for administering this YunoHost server.

It exposes exactly one tool: `ssh_execute`. The first call only creates an approval request and displays the exact command. The command runs only after the configured YunoHost user approves it in the web interface and the client repeats the same tool call with the one-time approval ID.

The MCP endpoint uses Streamable HTTP and OAuth 2.1 Authorization Code with PKCE. OAuth login and every command approval are bound to the configured YunoHost account through SSOwat.
