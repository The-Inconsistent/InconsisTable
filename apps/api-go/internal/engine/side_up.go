package engine

// SideUp is the side whose pick it is now, for the snapshot: the twin of `sideUp` in
// packages/rules-engine/src/primitives/initiative-sides.ts. params are the manifest's `initiative` block as normalized.
// It is false when no side has a pending member, or the params are not a sides order.
func SideUp(params any, t *TurnState) (string, bool) {
	p, refusal := parseSidesParams(params)
	if refusal != nil || t == nil {
		return "", false
	}
	return sideUpOf(p, t, snapOf(t))
}
