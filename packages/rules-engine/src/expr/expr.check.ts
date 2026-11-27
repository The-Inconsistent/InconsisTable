import { own } from "../own.ts";
import { ExprError, type ExprNode, type ExprScope, type ExprType } from "./expr.ast.ts";

/** What checking found: the result type and every scope path read (`attr.str`, or `attr.*` for a computed index). */
export interface CheckResult {
  type: ExprType;
  refs: string[];
}

export function typeName(t: ExprType): string {
  if (typeof t === "string") return t;
  if ("list" in t) return `list<${typeName(t.list)}>`;
  if ("dict" in t) return `dict<${typeName(t.dict)}>`;
  return "record";
}

function sameType(a: ExprType, b: ExprType): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  if ("list" in a && "list" in b) return sameType(a.list, b.list);
  if ("dict" in a && "dict" in b) return sameType(a.dict, b.dict);
  return false;
}

/** The single type of a record's values, so a computed index (`attr[x]`) has one type to check against. */
function recordValueType(fields: Readonly<Record<string, ExprType>>): ExprType | null {
  let out: ExprType | null = null;
  for (const t of Object.values(fields)) {
    if (out === null) out = t;
    else if (!sameType(out, t)) return null;
  }
  return out;
}

/** The number a member id ends in (`f12` is 12), or null; at most 9 digits so the number is exact in both engines. */
export function trailingNumber(id: string): number | null {
  const m = /(\d{1,9})$/.exec(id);
  return m?.[1] === undefined || /\d/.test(id.charAt(id.length - m[1].length - 1)) ? null : Number(m[1]);
}

/** `attr.str` for a pure path node, `attr.*` when an index is computed; null when the node is not a path. */
export function pathOf(node: ExprNode): string | null {
  switch (node.k) {
    case "id":
      return node.name;
    case "get": {
      const base = pathOf(node.obj);
      return base === null ? null : `${base}.${node.key}`;
    }
    case "index": {
      const base = pathOf(node.obj);
      if (base === null) return null;
      return node.key.k === "str" ? `${base}.${node.key.v}` : `${base}.*`;
    }
    default:
      return null;
  }
}

class Checker {
  readonly refs = new Set<string>();
  private readonly scope: ExprScope;

  constructor(scope: ExprScope) {
    this.scope = scope;
  }

  /** `inPath`: this node is the object of an outer `.`/`[]`, so only the outermost path is recorded as a ref. */
  check(node: ExprNode, inPath = false): ExprType {
    const t = this.typeOf(node);
    if (!inPath && (node.k === "id" || node.k === "get" || node.k === "index")) {
      const p = pathOf(node);
      if (p !== null) this.refs.add(p);
    }
    return t;
  }

  private expect(node: ExprNode, want: ExprType, what: string): void {
    const got = this.check(node);
    if (!sameType(got, want)) throw new ExprError(`${what} must be ${typeName(want)}, got ${typeName(got)}`);
  }

  private typeOf(node: ExprNode): ExprType {
    switch (node.k) {
      case "num":
        return "int";
      case "str":
        return "text";
      case "bool":
        return "bool";
      case "id": {
        const t = own(this.scope, node.name);
        if (t === undefined) throw new ExprError(`unknown identifier "${node.name}"`);
        return t;
      }
      case "get": {
        const obj = this.check(node.obj, true);
        if (typeof obj !== "string" && "record" in obj) {
          const t = own(obj.record, node.key);
          if (t === undefined) throw new ExprError(`unknown identifier "${pathOf(node) ?? node.key}"`);
          return t;
        }
        if (typeof obj !== "string" && "dict" in obj) return obj.dict;
        throw new ExprError(`cannot read ".${node.key}" of ${typeName(obj)}`);
      }
      case "index": {
        const obj = this.check(node.obj, true);
        if (typeof obj === "string") throw new ExprError(`cannot index ${obj}`);
        if ("list" in obj) {
          this.expect(node.key, "int", "a list index");
          return obj.list;
        }
        if (node.key.k === "str") {
          if ("dict" in obj) return obj.dict;
          const t = own(obj.record, node.key.v);
          if (t === undefined) throw new ExprError(`unknown identifier "${pathOf(node) ?? node.key.v}"`);
          return t;
        }
        this.expect(node.key, "text", "a record key");
        if ("dict" in obj) return obj.dict;
        const t = recordValueType(obj.record);
        if (t === null)
          throw new ExprError(`"${pathOf(node.obj) ?? "record"}" mixes value types, so it cannot be indexed`);
        return t;
      }
      case "unary":
        this.expect(node.arg, node.op === "-" ? "int" : "bool", `the operand of "${node.op}"`);
        return node.op === "-" ? "int" : "bool";
      case "binary":
        switch (node.op) {
          case "+":
          case "-":
          case "*":
          case "/":
          case "%":
            this.expect(node.left, "int", `the left of "${node.op}"`);
            this.expect(node.right, "int", `the right of "${node.op}"`);
            return "int";
          case "<":
          case "<=":
          case ">":
          case ">=":
            this.expect(node.left, "int", `the left of "${node.op}"`);
            this.expect(node.right, "int", `the right of "${node.op}"`);
            return "bool";
          case "&&":
          case "||":
            this.expect(node.left, "bool", `the left of "${node.op}"`);
            this.expect(node.right, "bool", `the right of "${node.op}"`);
            return "bool";
          case "==":
          case "!=": {
            const l = this.check(node.left);
            if (typeof l !== "string") throw new ExprError(`"${node.op}" compares values, not ${typeName(l)}`);
            this.expect(node.right, l, `the right of "${node.op}"`);
            return "bool";
          }
        }
        break;
      case "cond": {
        this.expect(node.test, "bool", "a condition");
        const then = this.check(node.then);
        this.expect(node.else, then, "the else branch");
        return then;
      }
      case "call":
        return this.call(node);
    }
    throw new ExprError("unreachable");
  }

  private call(node: Extract<ExprNode, { k: "call" }>): ExprType {
    const { fn, args } = node;
    const arity = (min: number, max: number) => {
      if (args.length < min || args.length > max) {
        const want = min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min} or ${max}`;
        throw new ExprError(`${fn}() takes ${want} argument(s), got ${args.length}`);
      }
    };
    const first = (): ExprNode => {
      const a = args[0];
      if (a === undefined) throw new ExprError(`${fn}() needs an argument`);
      return a;
    };
    switch (fn) {
      case "min":
      case "max": {
        arity(1, Infinity);
        const [only] = args;
        if (args.length === 1 && only !== undefined) {
          this.expect(only, { list: "int" }, `${fn}() of one argument`);
          return "int";
        }
        args.forEach((a, i) => this.expect(a, "int", `${fn}() argument ${i + 1}`));
        return "int";
      }
      case "floor":
      case "ceil":
        arity(1, 2);
        args.forEach((a, i) => this.expect(a, "int", `${fn}() argument ${i + 1}`));
        return "int";
      case "clamp":
        arity(3, 3);
        args.forEach((a, i) => this.expect(a, "int", `clamp() argument ${i + 1}`));
        return "int";
      case "abs":
      case "mod":
        arity(1, 1);
        args.forEach((a) => this.expect(a, "int", `${fn}() argument`));
        return "int";
      case "count": {
        arity(1, 1);
        const t = this.check(first());
        if (typeof t === "string" || !("list" in t)) throw new ExprError(`count() takes a list, got ${typeName(t)}`);
        return "int";
      }
      case "sum":
        arity(1, 1);
        this.expect(first(), { list: "int" }, "sum() argument");
        return "int";
      case "at": {
        arity(2, 2);
        const [group = first(), n = first()] = args;
        const path = pathOf(group);
        const t = this.check(group, true);
        if (path === null || typeof t === "string" || !("record" in t))
          throw new ExprError(`at() takes a group of fields, got ${typeName(t)}`);
        // Like a computed index: the call may read any member, so every member is a reference.
        this.refs.add(`${path}.*`);
        const member = recordValueType(t.record);
        if (member === null) throw new ExprError(`"${path}" mixes value types, so at() cannot pick from it`);
        const seen = new Set<number>();
        for (const key of Object.keys(t.record).sort()) {
          const num = trailingNumber(key);
          if (num === null) throw new ExprError(`"${path}.${key}" does not end in a number, so at() cannot pick it`);
          if (seen.has(num)) throw new ExprError(`two members of "${path}" end in ${num}, so at() cannot pick one`);
          seen.add(num);
        }
        this.expect(n, "int", "at() argument 2");
        return member;
      }
      case "contains": {
        arity(2, 2);
        const [list = first(), item = first()] = args;
        const t = this.check(list);
        if (typeof t === "string" || !("list" in t)) throw new ExprError(`contains() takes a list, got ${typeName(t)}`);
        this.expect(item, t.list, "contains() argument 2");
        return "bool";
      }
      case "overlap": {
        arity(2, 2);
        const [a = first(), b = first()] = args;
        const t = this.check(a);
        if (typeof t === "string" || !("list" in t)) throw new ExprError(`overlap() takes a list, got ${typeName(t)}`);
        this.expect(b, t, "overlap() argument 2");
        return "int";
      }
      case "has": {
        arity(1, 1);
        const arg = first();
        if (pathOf(arg) === null) throw new ExprError("has() takes a path such as res.tempHp");
        // A resource another actor type carries is a value that is not there on this one (house decision #166):
        // `has(res.members)` reads false on a type without it, so one expression serves every type it is checked
        // against. Only such a resource: one the manifest does not declare (a `gm` resource cut from a seat's copy, #101)
        // must still refuse, so the part reading it is cut rather than served reading false.
        if (arg.k === "get" && arg.obj.k === "id" && arg.obj.name === "res") {
          const elsewhere = own(this.scope, RES_ELSEWHERE);
          if (typeof elsewhere !== "string" && elsewhere && "record" in elsewhere && own(elsewhere.record, arg.key)) {
            return "bool";
          }
        }
        this.check(arg);
        return "bool";
      }
    }
  }
}

/** The scope key, never an identifier, naming the resources an actor's scope lacks but another actor type carries. */
export const RES_ELSEWHERE = "#resElsewhere";

/** Type-check an AST against a scope: unknown identifiers and wrong types are refused here, at load, not at play. */
export function checkExpr({ node, scope }: { node: ExprNode; scope: ExprScope }): CheckResult {
  const checker = new Checker(scope);
  const type = checker.check(node);
  return { type, refs: [...checker.refs].sort() };
}
