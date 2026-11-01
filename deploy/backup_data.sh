#!/bin/bash
# Nightly backup of the Piano Trainer data directory (catalog, uploaded scores,
# practice stats), same model as stellaris_build and my_finary:
#   - one tar.gz per run, last 7 kept locally
#   - mirrored to Google Drive with rclone (gdrive:backups/piano_trainer)
#   - alert email on failure (credentials in ~/.env_cron, same as the other projects)
#
# Usage:
#   deploy/backup_data.sh              # nightly backup (crontab)
#   deploy/backup_data.sh predeploy    # one-off copy before a deploy, kept apart
#                                      # (own folder, last 5) so it never evicts a nightly one
#
# Paths can be overridden with PIANO_TRAINER_DATA_DIR and PIANO_TRAINER_BACKUP_DIR.

set -uo pipefail

KIND="${1:-daily}"
DATA_DIR="${PIANO_TRAINER_DATA_DIR:-/home/arthur/apps/piano_trainer/shared/data}"
BACKUP_ROOT="${PIANO_TRAINER_BACKUP_DIR:-/home/arthur/apps/piano_trainer/shared/backups}"
DATE=$(date +%Y%m%d_%H%M%S)

case "$KIND" in
  daily)     BACKUP_DIR="$BACKUP_ROOT"; KEEP=7 ;;
  predeploy) BACKUP_DIR="$BACKUP_ROOT/predeploy"; KEEP=5 ;;
  *) echo "Usage: $0 [daily|predeploy]" >&2; exit 64 ;;
esac
BACKUP_FILE="$BACKUP_DIR/piano_data_$DATE.tar.gz"

ENV_FILE="/home/arthur/.env_cron"
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

send_alert() {
    if [[ -z "${GMAIL_USER:-}" || -z "${GMAIL_APP_PASSWORD:-}" ]]; then
        echo "GMAIL_USER/GMAIL_APP_PASSWORD not set, skipping alert email" >&2
        return
    fi
    curl -s --ssl-reqd \
        --url 'smtps://smtp.gmail.com:465' \
        --user "${GMAIL_USER}:${GMAIL_APP_PASSWORD}" \
        --mail-from "$GMAIL_USER" \
        --mail-rcpt "$GMAIL_USER" \
        --upload-file - <<EOF
From: Backup Monitor <${GMAIL_USER}>
To: ${GMAIL_USER}
Subject: [piano_trainer] $1
Content-Type: text/plain

$2
EOF
}

if [[ ! -f "$DATA_DIR/catalog.json" ]]; then
    send_alert "Backup FAILED" "No catalog.json in $DATA_DIR on $(date): wrong data directory?"
    echo "Backup failed: $DATA_DIR/catalog.json not found" >&2
    exit 1
fi

mkdir -p "$BACKUP_DIR"

# The server writes catalog.json / stats.json tmp-then-rename, so a plain tar never
# reads a half-written JSON file. Write to a temp name and rename, so a failed run
# never leaves a truncated archive that looks valid.
if ! tar -czf "$BACKUP_FILE.tmp" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")" \
   || ! tar -tzf "$BACKUP_FILE.tmp" >/dev/null; then
    rm -f "$BACKUP_FILE.tmp"
    send_alert "Backup FAILED" "tar of $DATA_DIR failed on $(date)."
    echo "Backup failed" >&2
    exit 1
fi
mv "$BACKUP_FILE.tmp" "$BACKUP_FILE"

cd "$BACKUP_DIR"
ls -t piano_data_*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm

echo "Backup completed: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# Mirror of the local backups (rotation included) to Google Drive.
if rclone sync "$BACKUP_ROOT" "gdrive:backups/piano_trainer" --exclude "*.log"; then
    echo "Synced to Google Drive"
else
    send_alert "Google Drive sync FAILED" "rclone sync to gdrive:backups/piano_trainer failed on $(date). The local backup still exists in $BACKUP_DIR but is no longer replicated."
    echo "Google Drive sync FAILED" >&2
    exit 1
fi
