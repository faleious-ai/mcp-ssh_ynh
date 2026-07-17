## MCP client configuration

The installation exposes MCP over SSH `stdio`; it does not open an HTTP endpoint.

Configure the client that owns the private key corresponding to the public key entered during installation:

```json
{
  "mcpServers": {
    "yunohost": {
      "command": "ssh",
      "args": [
        "-T",
        "-o", "BatchMode=yes",
        "-o", "IdentitiesOnly=yes",
        "-p", "__SSH_PORT__",
        "-i", "/absolute/path/to/the/private/key",
        "__APP__@__SERVER_FQDN__"
      ]
    }
  }
}
```

The SSH key is restricted server-side to the MCP entrypoint. It cannot be used to request an ordinary interactive shell, port forwarding, agent forwarding or a PTY.

The configured upstream server name shown to the agent is `yunohost`.
