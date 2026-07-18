#!/usr/bin/env bash
set -euo pipefail

key_path="${1:-$HOME/.ssh/mcp-ssh-yunohost-ed25519}"
comment="${2:-mcp-ssh-yunohost}"
rotate="${ROTATE:-0}"

if ! command -v ssh-keygen >/dev/null 2>&1; then
    echo "ssh-keygen was not found. Install the OpenSSH client first." >&2
    exit 1
fi

mkdir -p "$(dirname "$key_path")"
chmod 0700 "$(dirname "$key_path")"

if [[ -e "$key_path" || -e "$key_path.pub" ]]; then
    if [[ "$rotate" != "1" ]]; then
        echo "Key files already exist at $key_path. Run with ROTATE=1 to create a timestamped key without deleting the current identity." >&2
        exit 1
    fi

    key_path="${key_path}-$(date +%Y%m%d-%H%M%S)"
fi

ssh-keygen -q -t ed25519 -N "" -C "$comment" -f "$key_path"
chmod 0600 "$key_path"
chmod 0644 "$key_path.pub"

printf 'Dedicated MCP SSH key generated.\n'
printf 'Private key: %s\n' "$key_path"
printf 'Public key:  %s\n\n' "$key_path.pub"
printf 'Paste this public key into the YunoHost application installer or configuration panel:\n'
cat "$key_path.pub"
printf '\nKeep the private key only on this client. Do not copy it to the YunoHost server.\n'

if [[ "$rotate" == "1" ]]; then
    printf 'The previous key was preserved. Remove it only after the new MCP connection has been tested.\n'
fi
