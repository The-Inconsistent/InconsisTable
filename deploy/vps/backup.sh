#!/bin/sh
# Nightly dump of both databases of the VPS stack (deploy/vps/compose.yaml), run by root's cron on the host:
#   0 3 * * * /srv/inconsis/backup.sh
# Keeps 7 days in /srv/inconsis/backups. The off-host copy is pulled from your own machine (docs/deploy.md, "VPS"),
# so this host holds no credentials to anywhere else.
set -eu

dir=/srv/inconsis/backups
keep_days=7
stamp=$(date -u +%Y%m%dT%H%M%SZ)

pg=$(docker ps -q -f label=com.docker.compose.project=inconsis -f label=com.docker.compose.service=postgres)
[ -n "$pg" ] || { echo "backup: the inconsis postgres container is not running" >&2; exit 1; }

mkdir -p "$dir"
chmod 700 "$dir"
for db in it it_auth; do
  out="$dir/$db-$stamp.dump"
  # Custom format: compressed, and pg_restore can restore one table. Written to .part first, so a failed dump never
  # looks like a good one.
  docker exec "$pg" pg_dump -U postgres -Fc "$db" > "$out.part"
  mv "$out.part" "$out"
done

find "$dir" -name '*.dump' -mtime +"$keep_days" -delete
find "$dir" -name '*.part' -delete
