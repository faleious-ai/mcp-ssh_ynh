## Architecture

- Upstream package: `mcp-ssh-manager` __UPSTREAM_VERSION__ from npm
- Transport: MCP `stdio` carried by OpenSSH
- SSH login account: `__APP__`
- MCP target: `yunohost` at `127.0.0.1:__SSH_PORT__`
- Policy mode: `unrestricted`
- Tool selection: all upstream tools
- Audit log: `/var/log/__APP__/audit.jsonl`
- Runtime configuration: `__DATA_DIR__/.ssh-manager/.env`
- Entrypoint: `__INSTALL_DIR__/bin/mcp-ssh-stdio`

## Access model

The external client key in `authorized_keys` has a forced command that starts the MCP entrypoint. A separate automatically generated key is accepted only from loopback and lets the upstream MCP server establish the SSH connection to the local YunoHost account.

The application account has unrestricted passwordless sudo. Removing `/etc/sudoers.d/__APP__` immediately prevents new privileged commands, though unprivileged operations remain possible.

## Revocation

To revoke the MCP client without removing the app, remove or replace the first line of:

```text
__DATA_DIR__/.ssh/authorized_keys
```

The second line is the internal loopback key and must remain for the MCP target to work.

## Streamable HTTP

This package deliberately does not add an HTTP adapter. If SSH `stdio` proves incompatible with a target client, Streamable HTTP should be implemented as a separate, explicit packaging revision rather than silently exposing this unrestricted MCP server to the network.
