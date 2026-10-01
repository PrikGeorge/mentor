#!/bin/sh
# Isolated short Unix socket path; never use or modify the operator's GnuPG home.
set -eu
test "$#" -eq 4 || { echo 'Expected mode, passphrase file, input and output paths.' >&2; exit 2; }
mode=$1
passphrase_file=$2
input_file=$3
output_file=$4
case "$mode" in encrypt|decrypt) ;; *) exit 2 ;; esac
command -v gpg >/dev/null
command -v gpgconf >/dev/null
gpg_dir=$(mktemp -d /tmp/mentor-gpg.XXXXXXXXXX)
case "$gpg_dir" in /tmp/mentor-gpg.*) ;; *) exit 2 ;; esac
chmod 700 "$gpg_dir"
cleanup() {
    gpgconf --homedir "$gpg_dir" --kill gpg-agent || true
    rm -rf -- "$gpg_dir"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
if [ "$mode" = encrypt ]; then
    gpg --homedir "$gpg_dir" --batch --yes --pinentry-mode loopback --no-symkey-cache --passphrase-file "$passphrase_file" --symmetric --cipher-algo AES256 --output "$output_file" "$input_file"
else
    gpg --homedir "$gpg_dir" --batch --yes --pinentry-mode loopback --no-symkey-cache --passphrase-file "$passphrase_file" --output "$output_file" --decrypt "$input_file"
fi
