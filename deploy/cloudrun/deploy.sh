#!/bin/sh
# Fills the ${NAME}s in one of this folder's files from the environment and applies it with gcloud:
#   deploy/cloudrun/deploy.sh table|auth|backup
# The values are in docs/deploy.md, "Cloud Run". Never run it while a session is open (table.yaml).
set -eu
name=${1:?usage: deploy.sh table|auth|backup}
here=$(dirname "$0")
[ -f "$here/$name.yaml" ] || { echo "no $here/$name.yaml" >&2; exit 1; }
out=$(mktemp)
trap 'rm -f -- "$out"' EXIT
# A missing variable stops it, rather than deploying an empty value.
perl -pe 's/\$\{(\w+)\}/defined $ENV{$1} ? $ENV{$1} : die "set $1\n"/ge' "$here/$name.yaml" > "$out"
case $name in
  backup) gcloud run jobs replace "$out" --project "$PROJECT" --region "$BACKUP_REGION" ;;
  *) gcloud run services replace "$out" --project "$PROJECT" --region "$REGION" ;;
esac
