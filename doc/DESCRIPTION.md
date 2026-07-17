MCP SSH Manager for YunoHost packages the upstream `mcp-ssh-manager` npm project without modifying its source code. It exposes the complete upstream MCP tool catalog through an MCP `stdio` session transported over SSH.

The single configured target is the local YunoHost server. The MCP process connects to the server's own OpenSSH service using an automatically generated internal key.
