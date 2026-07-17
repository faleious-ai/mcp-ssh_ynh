# MCP SSH Manager for YunoHost

This repository packages the upstream [bvisible/mcp-ssh-manager](https://github.com/bvisible/mcp-ssh-manager) project as a YunoHost application.

It does not fork or patch the upstream runtime. The package installs the exact npm release declared in `manifest.toml`, configures one local target named `yunohost`, enables all upstream tools in unrestricted mode, and exposes MCP `stdio` through a forced SSH command.

## Install

For a public repository:

```bash
sudo yunohost app install https://github.com/faleious-ai/mcp-ssh_ynh
```

This repository is currently private. Until it is made public, clone it on the YunoHost server using GitHub credentials and install the local checkout:

```bash
git clone git@github.com:faleious-ai/mcp-ssh_ynh.git /root/mcp-ssh_ynh
sudo yunohost app install /root/mcp-ssh_ynh
```

During installation, provide a dedicated OpenSSH public key. Its private counterpart is used by the MCP client.

## Client example

```json
{
  "mcpServers": {
    "yunohost": {
      "command": "ssh",
      "args": [
        "-T",
        "-o", "BatchMode=yes",
        "-o", "IdentitiesOnly=yes",
        "-p", "22",
        "-i", "/absolute/path/to/mcp_yunohost_ed25519",
        "mcp-ssh@your-yunohost-host"
      ]
    }
  }
}
```

Adjust the port and hostname to the server. The forced command ignores any remote command supplied by the client and starts the MCP server directly.

## Security

This package intentionally grants the application account unrestricted passwordless sudo. Possession of the configured client private key is operationally equivalent to administrative access to the server.

The SSH key is restricted to the MCP entrypoint, but the MCP tool catalog itself can execute destructive and privileged operations. Use a dedicated key and enable this application only on a server you control.

## Upstream

- Code: https://github.com/bvisible/mcp-ssh-manager
- npm: https://www.npmjs.com/package/mcp-ssh-manager
- License: MIT
