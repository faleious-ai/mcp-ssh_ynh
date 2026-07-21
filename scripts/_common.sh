#!/bin/bash

package_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_home="${data_dir:-/home/yunohost.app/$app}"
sudoers_file="/etc/sudoers.d/$app"

install_application_files() {
    rsync -a --delete "$package_root/app/" "$install_dir/"
    chown -R "$app:$app" "$install_dir"
    ynh_exec_as_app bash -c "cd '$install_dir' && npm install --omit=dev --ignore-scripts --no-audit --no-fund --save-exact"
}

configure_internal_ssh() {
    install -d -m 0700 -o "$app" -g "$app" "$app_home/.ssh"
    if [[ ! -f "$app_home/.ssh/target_ed25519" ]]; then
        ynh_exec_as_app ssh-keygen -q -t ed25519 -N "" -C "$app-loopback" -f "$app_home/.ssh/target_ed25519"
    fi
    chmod 0600 "$app_home/.ssh/target_ed25519"
    chmod 0644 "$app_home/.ssh/target_ed25519.pub"
    chown "$app:$app" "$app_home/.ssh/target_ed25519" "$app_home/.ssh/target_ed25519.pub"

    printf 'from="127.0.0.1,::1",restrict %s\n' "$(cat "$app_home/.ssh/target_ed25519.pub")" > "$app_home/.ssh/authorized_keys"
    chmod 0600 "$app_home/.ssh/authorized_keys"
    chown "$app:$app" "$app_home/.ssh/authorized_keys"

    ssh_port="$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2; exit }')"
    ssh_port="${ssh_port:-22}"
    ssh-keyscan -p "$ssh_port" 127.0.0.1 > "$app_home/.ssh/known_hosts" 2>/dev/null || true
    chmod 0644 "$app_home/.ssh/known_hosts"
    chown "$app:$app" "$app_home/.ssh/known_hosts"
    ynh_app_setting_set --key=ssh_port --value="$ssh_port"
}

configure_privileges() {
    ynh_config_add --template="sudoers" --destination="$sudoers_file"
    chmod 0440 "$sudoers_file"
    chown root:root "$sudoers_file"
    visudo -cf "$sudoers_file" >/dev/null
}

configure_runtime() {
    base_url="https://$domain"
    ssh_port="$(ynh_app_setting_get --key=ssh_port)"
    ynh_config_add --template="env" --destination="$install_dir/.env"
    chmod 0600 "$install_dir/.env"
    chown "$app:$app" "$install_dir/.env"

    install -d -m 0700 -o "$app" -g "$app" "$app_home/runtime"
    if [[ ! -f "$app_home/runtime/state.json" ]]; then
        printf '%s\n' '{"clients":{},"authRequests":{},"authCodes":{},"accessTokens":{},"refreshTokens":{},"approvals":{}}' > "$app_home/runtime/state.json"
    fi
    chmod 0600 "$app_home/runtime/state.json"
    chown "$app:$app" "$app_home/runtime/state.json"

    ynh_config_add_systemd
    ynh_config_add_nginx
    yunohost service add "$app" --description="MCP SSH Approval" --log="/var/log/$app/$app.log" 2>/dev/null || true
    ynh_systemctl --service="$app" --action="restart" --log_path="systemd"
}

self_test() {
    ynh_local_curl "/health" | grep -q '"status":"ok"'
}
