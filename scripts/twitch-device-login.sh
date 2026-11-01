#!/bin/bash
# Twitch OAuth Device Code Flow. Usage: TWITCH_CLIENT_ID=... scripts/twitch-device-login.sh /path/to/token.json
# Requires curl and jq. Never prints the token.
set -euo pipefail
OUT=${1:?token file path}; : "${TWITCH_CLIENT_ID:?set TWITCH_CLIENT_ID}"
R=$(curl -s -X POST https://id.twitch.tv/oauth2/device -d "client_id=$TWITCH_CLIENT_ID" --data-urlencode "scopes=user:read:chat user:write:chat moderator:manage:chat_messages")
DC=$(jq -r .device_code <<<"$R"); IV=$(jq -r '.interval // 5' <<<"$R")
echo "Open $(jq -r .verification_uri <<<"$R") and enter code $(jq -r .user_code <<<"$R")"
while sleep "$IV"; do
  T=$(curl -s -X POST https://id.twitch.tv/oauth2/token -d "client_id=$TWITCH_CLIENT_ID" -d "device_code=$DC" -d "grant_type=urn:ietf:params:oauth:grant-type:device_code")
  if jq -e .access_token >/dev/null <<<"$T"; then (umask 077; printf '%s\n' "$T" > "$OUT"); chmod 600 "$OUT"; echo "Token saved to $OUT"; exit 0; fi
  M=$(jq -r .message <<<"$T"); [ "$M" = "authorization_pending" ] || { echo "Stopped: $M"; exit 1; }
done
