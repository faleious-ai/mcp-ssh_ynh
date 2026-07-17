#!/bin/bash

app_home="${data_dir:-/home/yunohost.app/$app}"
sudoers_file="/etc/sudoers.d/$app"
log_dir="/var/log/$app"
entrypoint="${install_dir:-/opt/yunohost/$app}/bin/mcp-ssh-stdio"

validate_client_public_key() {
    client_ssh_public_key="$(printf '%s' "$client_ssh_public_key" | tr -d '\r\n')"

    if [[ ! "$client_ssh_public_key" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh.com|sk-ecdsa-sha2-nistp256@openssh.com)[[:space:]]+[A-Za-z0-9+/=]+([[:space:]].*)?$ ]]; then
        ynh_die "The provided value is not a supported single-line OpenSSH public key."
    fi
}

detect_sshd_port() {
    ssh_port="$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2; exit }')"
    ssh_port="${ssh_port:-22}"
}

install_upstream_package() {
    upstream_version="$(ynh_app_upstream_version)"
    ynh_app_setting_set --key="upstream_version" --value="$upstream_version"

    ynh_config_add --template="package.json" --destination="$install_dir/package.json"
    chown "$app:$app" "$install_dir/package.json"

    pushd "$install_dir" >/dev/null
        ynh_exec_as_app npm install \
            --omit=dev \
            --no-audit \
            --no-fund \
            --save-exact
    popd >/dev/null
}

configure_mcp_runtime() {
    detect_sshd_port

    install -d -m 0700 -o "$app" -g "$app" "$app_home/.ssh"
    install -d -m 0700 -o "$app" -g "$app" "$app_home/.ssh-manager"
    install -d -m 0750 -o "$app" -g "$app" "$install_dir/bin"
    install -d -m 0750 -o "$app" -g "$app" "$log_dir"
    touch "$log_dir/audit.jsonl"
    chown "$app:$app" "$log_dir/audit.jsonl"
    chmod 0640 "$log_dir/audit.jsonl"

    if [[ ! -f "$app_home/.ssh/target_ed25519" ]]; then
        ynh_exec_as_app ssh-keygen \
            -q \
            -t ed25519 \
            -N "" \
            -C "$app-local-target" \
            -f "$app_home/.ssh/target_ed25519"
    fi

    chmod 0600 "$app_home/.ssh/target_ed25519"
    chmod 0644 "$app_home/.ssh/target_ed25519.pub"
    chown "$app:$app" "$app_home/.ssh/target_ed25519" "$app_home/.ssh/target_ed25519.pub"

    ynh_config_add --template="env" --destination="$app_home/.ssh-manager/.env"
    chmod 0600 "$app_home/.ssh-manager/.env"
    chown "$app:$app" "$app_home/.ssh-manager/.env"

    ynh_config_add --template="entrypoint" --destination="$entrypoint"
    chmod 0750 "$entrypoint"
    chown "$app:$app" "$entrypoint"

    ynh_config_add --template="sudoers" --destination="$sudoers_file"
    chmod 0440 "$sudoers_file"
    chown root:root "$sudoers_file"
    visudo -cf "$sudoers_file" >/dev/null

    local internal_public_key
    internal_public_key="$(cat "$app_home/.ssh/target_ed25519.pub")"

    {
        printf 'restrict,command="%s" %s\n' "$entrypoint" "$client_ssh_public_key"
        printf 'from="127.0.0.1,::1",no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-user-rc,no-pty %s\n' "$internal_public_key"
    } > "$app_home/.ssh/authorized_keys"

    chmod 0600 "$app_home/.ssh/authorized_keys"
    chown "$app:$app" "$app_home/.ssh/authorized_keys"

    ssh-keyscan -p "$ssh_port" 127.0.0.1 > "$app_home/.ssh/known_hosts" 2>/dev/null || true
    chmod 0644 "$app_home/.ssh/known_hosts"
    chown "$app:$app" "$app_home/.ssh/known_hosts"

    ynh_app_setting_set --key="ssh_port" --value="$ssh_port"
    server_fqdn="$(hostname -f 2>/dev/null || hostname)"
    ynh_app_setting_set --key="server_fqdn" --value="$server_fqdn"
}

self_test_local_ssh() {
    ynh_exec_as_app ssh \
        -T \
        -o BatchMode=yes \
        -o IdentitiesOnly=yes \
        -o StrictHostKeyChecking=yes \
        -o UserKnownHostsFile="$app_home/.ssh/known_hosts" \
        -i "$app_home/.ssh/target_ed25519" \
        -p "$ssh_port" \
        "$app@127.0.0.1" \
        true
}
