import { own } from "../own.ts";
import { ExprError, type ExprNode, type ExprRecord, type ExprValue } from "./expr.ast.ts";
import { pathOf } from "./expr.check.ts";

type Maybe = ExprValue | null | undefined;

function isRecord(v: Maybe): v is ExprRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isList(v: Maybe): v is readonly ExprValue[] {
  return Array.isArray(v);
}

function int(v: Maybe, what: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new ExprError(`${what} is not an integer`);
  return v;
}

function bool(v: Maybe, what: string): boolean {
  if (typeof v !== "boolean") throw new ExprError(`${what} is not a boolean`);
  return v;
}

function safe(n: number): number {
  if (!Number.isSafeInteger(n)) throw new ExprError("integer overflow");
  return n;
}

/** Floored modulo, the partner of floor division: a = b * floorDiv(a, b) + floorMod(a, b). */
function floorMod(a: number, b: number): number {
  if (b === 0) throw new ExprError("modulo by zero");
  return ((a % b) + b) % b;
}

/** Exact floor division on integers, without a float detour that rounds wrong near 2^53. */
function floorDiv(a: number, b: number): number {
  if (b === 0) throw new ExprError("division by zero");
  return safe((a - floorMod(a, b)) / b);
}

function ceilDiv(a: number, b: number): number {
  return -floorDiv(-a, b);
}

class Evaluator {
  private readonly scope: ExprRecord;

  constructor(scope: ExprRecord) {
    this.scope = scope;
  }

  /** Reads a value that may be absent: only `has()` tolerates a missing one. */
  private lookup(node: ExprNode): Maybe {
    switch (node.k) {
      case "id":
        return own(this.scope, node.name);
      case "get": {
        const obj = this.lookup(node.obj);
        return isRecord(obj) ? own(obj, node.key) : undefined;
      }
      case "index": {
        const obj = this.lookup(node.obj);
        const key = this.eval(node.key);
        if (isList(obj) && typeof key === "number") return obj[key];
        if (isRecord(obj) && typeof key === "string") return own(obj, key);
        return undefined;
      }
      default:
        return this.eval(node);
    }
  }

  eval(node: ExprNode): ExprValue {
    switch (node.k) {
      case "num":
      case "str":
      case "bool":
        return node.v;
      case "id":
      case "get":
      case "index": {
        const v = this.lookup(node);
        if (v === undefined || v === null) throw new ExprError(`missing value "${pathOf(node) ?? "?"}"`);
        return v;
      }
      case "unary":
        return node.op === "-" ? safe(-int(this.eval(node.arg), "operand")) : !bool(this.eval(node.arg), "operand");
      case "binary":
        return this.binary(node);
      case "cond":
        return bool(this.eval(node.test), "condition") ? this.eval(node.then) : this.eval(node.else);
      case "call":
        return this.call(node);
    }
  }

  private binary(node: Extract<ExprNode, { k: "binary" }>): ExprValue {
    // Short-circuit first, so `has(x) && x > 0` never reads a missing x.
    if (node.op === "&&") return bool(this.eval(node.left), "left") && bool(this.eval(node.right), "right");
    if (node.op === "||") return bool(this.eval(node.left), "left") || bool(this.eval(node.right), "right");
    const l = this.eval(node.left);
    const r = this.eval(node.right);
    if (node.op === "==") return l === r;
    if (node.op === "!=") return l !== r;
    const a = int(l, `left of "${node.op}"`);
    const b = int(r, `right of "${node.op}"`);
    switch (node.op) {
      case "+":
        return safe(a + b);
      case "-":
        return safe(a - b);
      case "*":
        return safe(a * b);
      case "/":
        return floorDiv(a, b);
      case "%":
        return floorMod(a, b);
      case "<":
        return a < b;
      case "<=":
        return a <= b;
      case ">":
        return a > b;
      case ">=":
        return a >= b;
    }
  }

  private ints(nodes: readonly ExprNode[], fn: string): number[] {
    return nodes.map((n, i) => int(this.eval(n), `${fn}() argument ${i + 1}`));
  }

  private call(node: Extract<ExprNode, { k: "call" }>): ExprValue {
    const { fn, args } = node;
    switch (fn) {
      case "min":
      case "max": {
        const [only] = args;
        const list =
          args.length === 1 && only !== undefined ? listInts(this.eval(only), `${fn}()`) : this.ints(args, fn);
        if (list.length === 0) throw new ExprError(`${fn}() of an empty list`);
        return fn === "min" ? Math.min(...list) : Math.max(...list);
      }
      case "floor":
      case "ceil": {
        const [a = 0, b = 1] = this.ints(args, fn);
        return fn === "floor" ? floorDiv(a, b) : ceilDiv(a, b);
      }
      case "clamp": {
        const [x = 0, lo = 0, hi = 0] = this.ints(args, fn);
        // A max below the min collapses to the min, the same rule resource.capped applies.
        return Math.max(lo, Math.min(Math.max(lo, hi), x));
      }
      case "abs":
        return safe(Math.abs(this.ints(args, fn)[0] ?? 0));
      case "mod":
        return floorDiv((this.ints(args, fn)[0] ?? 0) - 10, 2);
      case "count": {
        const v = args[0] === undefined ? undefined : this.eval(args[0]);
        if (!isList(v)) throw new ExprError("count() of a non-list");
        return v.length;
      }
      case "sum":
        return safe(
          listInts(args[0] === undefined ? undefined : this.eval(args[0]), "sum()").reduce((s, n) => s + n, 0),
        );
      case "has": {
        const v = args[0] === undefined ? undefined : this.lookup(args[0]);
        return v !== undefined && v !== null;
      }
    }
  }
}

function listInts(v: Maybe, what: string): number[] {
  if (!isList(v)) throw new ExprError(`${what} needs a list`);
  return v.map((x, i) => int(x, `${what} item ${i + 1}`));
}

/** Evaluate an AST against runtime values. Pure; throws ExprError on a missing value, overflow or division by zero. */
export function evaluate({ node, scope }: { node: ExprNode; scope: ExprRecord }): ExprValue {
  return new Evaluator(scope).eval(node);
}
