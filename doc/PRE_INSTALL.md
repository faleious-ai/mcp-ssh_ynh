## Critical privilege warning

This application is designed for autonomous administrative agents. It exposes the complete upstream MCP SSH Manager catalog in `unrestricted` mode.

Installation creates a dedicated system account and grants it `NOPASSWD: ALL` through sudo. The holder of the SSH key entered during installation can therefore obtain complete control of this YunoHost server through MCP tools, including deleting files, stopping services, changing the firewall, upgrading or removing applications, and executing arbitrary root commands.

Use a dedicated SSH key. Do not reuse your personal administrative key. Protect and revoke that key as you would protect the root account.
