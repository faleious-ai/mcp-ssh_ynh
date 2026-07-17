# Rotate the MCP client identity key

1. Generate a new dedicated Ed25519 key on the MCP client.
2. Keep the private key on the client.
3. Replace only the external client public-key line in the application account's `authorized_keys` file.
4. Test a new MCP connection with the new private key.
5. Close existing MCP sessions and securely delete the old private key.

Existing SSH connections remain valid until they close. Rotation affects new connections.
