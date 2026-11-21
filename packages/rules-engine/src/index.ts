// The public API of @inconsistable/rules-engine: the ruleset manifest, its compiler, expressions, dice, the mechanic
// primitives and the viewer filter. Pure functions only; the web previews with them, the api decides with them.

export * from "./enums.ts";
export { formatPath, type Problem } from "./problem.ts";
export * from "./manifest.ts";
export * from "./field-value.ts";
export * from "./codex.ts";
export * from "./pack.ts";
export * from "./pack-hash.ts";
export * from "./creation.ts";
export {
  compileRuleset,
  fieldScope,
  PARTY_SCOPE,
  topoSort,
  type ActiveEntry,
  type CompiledDerived,
  type CompiledEffect,
  type CompiledEntity,
  type CompiledInitiative,
  type CompiledResource,
  type CompiledScoring,
  type CompiledRuleset,
  type CompiledTest,
  type CompiledLookup,
  type CompiledTableEffect,
  type CompileResult,
} from "./compile.ts";
export {
  actorScope,
  applyBaseEffects,
  campaignValues,
  deriveValues,
  healthStatesOf,
  instantDeathAt,
  nestFields,
  resetValue,
  resetValues,
  startValue,
  resourceBounds,
  type ActorValues,
  type FieldValue,
} from "./derived.ts";
export {
  BinaryOp,
  ExprError,
  FnName,
  MAX_EXPR_LENGTH,
  MAX_EXPR_NODES,
  UnaryOp,
  type ExprNode,
  type ExprRecord,
  type ExprScope,
  type ExprType,
  type ExprValue,
} from "./expr/expr.ast.ts";
export { checkExpr, typeName, type CheckResult } from "./expr/expr.check.ts";
export { evaluate } from "./expr/expr.eval.ts";
export { parseExpr } from "./expr/expr.parser.ts";
export {
  compileExpr,
  evaluateBool,
  evaluateExpr,
  evaluateInt,
  type CompiledExpr,
  type CompileExprResult,
} from "./expr/expr.ts";
export * from "./dice/dice.ts";
export * from "./primitives/primitive.ts";
export * from "./primitives/dice-sum-vs-target.ts";
export * from "./primitives/dice-pool-successes.ts";
export * from "./primitives/initiative-ranked.ts";
export { firstOf, initiativeSeated, nextFirst, sequence } from "./primitives/initiative-seated.ts";
export { initiativeSides, sideUp } from "./primitives/initiative-sides.ts";
export * from "./primitives/health-tracks.ts";
export * from "./primitives/health-harm.ts";
export * from "./primitives/resource-capped.ts";
export * from "./primitives/conditions-expire.ts";
export * from "./primitives/rest.ts";
export { declaredPrimitives, opInputKeys, PRIMITIVES, runOp, type RunOpResult } from "./primitives/registry.ts";
export * from "./spend.ts";
export * from "./scoring.ts";
export * from "./reminders.ts";
export * from "./view.ts";
export * from "./breakdown.ts";
export * from "./build/index.ts";
export * from "./world.ts";
export * from "./widgets.ts";
export {
  heldKeys,
  immuneTo,
  lookupInputs,
  planLookup,
  readLookup,
  rowOf,
  type LookupPlan,
  type LookupRefusal,
  type LookupStep,
} from "./lookups.ts";
