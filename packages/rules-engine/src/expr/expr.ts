import {
  ExprError,
  type ExprNode,
  type ExprRecord,
  type ExprScope,
  type ExprType,
  type ExprValue,
} from "./expr.ast.ts";
import { checkExpr, typeName } from "./expr.check.ts";
import { evaluate } from "./expr.eval.ts";
import { parseExpr } from "./expr.parser.ts";

/** An expression compiled at manifest load: its AST, static type and the scope paths it reads. */
export interface CompiledExpr {
  source: string;
  ast: ExprNode;
  type: ExprType;
  refs: string[];
}

export type CompileExprResult = { ok: true; expr: CompiledExpr } | { ok: false; error: string };

/** Parse and type-check. `expect` refuses an expression of the wrong result type (a derived value must be `int`). */
export function compileExpr({
  source,
  scope,
  expect,
}: {
  source: string;
  scope: ExprScope;
  expect?: ExprType;
}): CompileExprResult {
  try {
    const ast = parseExpr(source);
    const { type, refs } = checkExpr({ node: ast, scope });
    if (expect !== undefined && typeName(expect) !== typeName(type)) {
      return { ok: false, error: `must be ${typeName(expect)}, got ${typeName(type)}` };
    }
    return { ok: true, expr: { source, ast, type, refs } };
  } catch (err) {
    if (err instanceof ExprError) return { ok: false, error: err.message };
    throw err;
  }
}

export function evaluateExpr({ expr, scope }: { expr: CompiledExpr; scope: ExprRecord }): ExprValue {
  return evaluate({ node: expr.ast, scope });
}

/** Evaluate an expression the checker typed as `int`. */
export function evaluateInt({ expr, scope }: { expr: CompiledExpr; scope: ExprRecord }): number {
  const v = evaluate({ node: expr.ast, scope });
  if (typeof v !== "number") throw new ExprError(`"${expr.source}" did not give an integer`);
  return v;
}

export function evaluateBool({ expr, scope }: { expr: CompiledExpr; scope: ExprRecord }): boolean {
  const v = evaluate({ node: expr.ast, scope });
  if (typeof v !== "boolean") throw new ExprError(`"${expr.source}" did not give a boolean`);
  return v;
}
