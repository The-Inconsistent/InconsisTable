import { z } from "zod";

export const BinaryOp = z.enum(["+", "-", "*", "/", "%", "<", "<=", ">", ">=", "==", "!=", "&&", "||"]);
export type BinaryOp = z.infer<typeof BinaryOp>;

export const UnaryOp = z.enum(["-", "!"]);
export type UnaryOp = z.infer<typeof UnaryOp>;

/**
 * The only functions an expression may call (design §4.3). `mod(score)` is named there; it is floor((score - 10) / 2).
 * `floor`/`ceil` take one integer (a no-op) or two, `floor(a, b)` = a / b rounded down, `ceil(a, b)` rounded up:
 * arithmetic is integer only, so rounding is chosen where the division happens.
 */
export const FnName = z.enum(["min", "max", "floor", "ceil", "clamp", "abs", "mod", "count", "sum", "has"]);
export type FnName = z.infer<typeof FnName>;

/** The JSON AST. Plain data, so a compiled manifest can be cached as JSONB and evaluated the same on web and api. */
export type ExprNode =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "id"; name: string }
  | { k: "get"; obj: ExprNode; key: string }
  | { k: "index"; obj: ExprNode; key: ExprNode }
  | { k: "unary"; op: UnaryOp; arg: ExprNode }
  | { k: "binary"; op: BinaryOp; left: ExprNode; right: ExprNode }
  | { k: "cond"; test: ExprNode; then: ExprNode; else: ExprNode }
  | { k: "call"; fn: FnName; args: ExprNode[] };

/** Static types the checker assigns. Scalars are strings; containers are tagged objects. */
export type ExprType =
  "int" | "bool" | "text" | { list: ExprType } | { record: Readonly<Record<string, ExprType>> } | { dict: ExprType };

/** The identifiers an expression may name, with their types. */
export type ExprScope = Readonly<Record<string, ExprType>>;

/** Runtime values an expression reads. */
export type ExprValue = number | boolean | string | readonly ExprValue[] | ExprRecord;
export interface ExprRecord {
  readonly [key: string]: ExprValue | null | undefined;
}

export class ExprError extends Error {
  override name = "ExprError";
}

/** Caps from design §4.3 / p0-plan: a manifest is user-written input, so every expression is bounded. */
export const MAX_EXPR_NODES = 500;
export const MAX_EXPR_LENGTH = 2000;
