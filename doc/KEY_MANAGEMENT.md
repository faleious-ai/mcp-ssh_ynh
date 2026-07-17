# MCP client key management

Use one dedicated Ed25519 identity key for this application. Generate it on the MCP client and provide only its public key to the YunoHost installer.

The SSH protocol negotiates independent encryption keys for each connection. Do not rotate the identity key on every connection. Rotate it after suspected exposure, when replacing a client, or during planned maintenance.

A Windows PowerShell helper is available at `tools/generate-client-key.ps1`.
