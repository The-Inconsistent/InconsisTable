#!/usr/bin/env bash
# Breaks the seat view one way at a time and requires the seat-secrets check to fail on each break; restores the code
# after every mutant, even on Ctrl-C. Exit 0 means every mutant was caught.
set -u
cd "$(dirname "$0")/../../../apps/api-go" || exit 2
files=(internal/view/sight.go internal/engine/view.go internal/view/seat.go)
if ! git diff --quiet -- "${files[@]}"; then
  echo "refusing: ${files[*]} have uncommitted changes; commit or stash them first" >&2
  exit 2
fi
trap 'git checkout -q -- "${files[@]}"' EXIT

# name # file # sed expression # property that must fail
mutants=(
  'no-gm-branch-removed#internal/view/sight.go#s/^\tif !c.HasGM() {$/\tif false {/#hidden'
  'owner-ignores-holder#internal/engine/view.go#s/slices.Contains(viewer.CharacterIDs, actorID)$/(slices.Contains(viewer.CharacterIDs, actorID) || true)/#owner'
  'ledger-kept#internal/view/seat.go#s/^\t\t\tout.Ledger = nil$/\t\t\t_ = 0/#private'
  'gm-side-served-as-player#internal/view/seat.go#s/^\t\tif ActorGmSide(c, a.Kind) {$/\t\tif false \&\& ActorGmSide(c, a.Kind) {/#served'
)

caught=0
for m in "${mutants[@]}"; do
  IFS='#' read -r name file expr prop <<<"$m"
  sed -i "$expr" "$file"
  if git diff --quiet -- "$file"; then
    echo "STALE  $name: the sed no longer matches $file; update this mutant"
    continue
  fi
  out=$(go test ./internal/view -run TestEverySeatReceivesOnlyItsActorValues -count=1 2>&1)
  git checkout -q -- "$file"
  if grep -q "^ *seat_secrets_test.go:[0-9]*: $prop:" <<<"$out"; then
    echo "caught $name ($prop)"
    caught=$((caught + 1))
  else
    echo "MISSED $name: expected a '$prop:' failure"
    echo "$out" | tail -5
  fi
done
echo "$caught of ${#mutants[@]} mutants caught"
[ "$caught" -eq "${#mutants[@]}" ]
