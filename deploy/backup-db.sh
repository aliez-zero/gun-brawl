#!/usr/bin/env bash
# Back up the SQLite match database out of the app data volume.
#
# Usage:  ./deploy/backup-db.sh
# Cron:   0 4 * * * /srv/gun-brawl/deploy/backup-db.sh >> /srv/gun-brawl/backups/backup.log 2>&1
#
# The runtime image has no sqlite3 CLI, so the backup runs in a throwaway container
# that mounts the same volume. `.backup` is WAL-safe: no need to stop the game.
set -euo pipefail
cd "$(dirname "$0")/.."

volume="${GUNBRAWL_VOLUME:-gun-brawl_data}"
dir="${BACKUP_DIR:-$PWD/backups}"
keep="${BACKUP_KEEP_DAYS:-14}"

mkdir -p "$dir"
stamp="$(date +%F)"

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$volume":/data \
  -v "$dir":/backup \
  keinos/sqlite3 sh -c "sqlite3 /data/gunbrawl.db \".backup /backup/gunbrawl-$stamp.db\""

find "$dir" -name 'gunbrawl-*.db' -type f -mtime +"$keep" -delete
echo "$(date -Is) backed up $volume/gunbrawl.db -> $dir/gunbrawl-$stamp.db"
