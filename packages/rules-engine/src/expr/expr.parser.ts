import { BinaryOp, ExprError, FnName, MAX_EXPR_LENGTH, MAX_EXPR_NODES, type ExprNode } from "./expr.ast.ts";

type Token =
  | { t: "num"; v: number; at: number }
  | { t: "str"; v: string; at: number }
  | { t: "id"; v: string; at: number }
  | { t: "op"; v: string; at: number }
  | { t: "eof"; at: number };

// Longest first, so `<=` is not read as `<` then `=`.
const OPERATORS = [
  "&&",
  "||",
  "==",
  "!=",
  "<=",
  ">=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
  "!",
  "?",
  ":",
  ".",
  ",",
  "(",
  ")",
  "[",
  "]",
];

function lex(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i] ?? "";
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+/.exec(source.slice(i));
      const text = m?.[0] ?? "";
      if (/^[.a-zA-Z_]/.test(source.slice(i + text.length))) throw new ExprError(`bad number at ${i}: integers only`);
      const v = Number(text);
      if (!Number.isSafeInteger(v)) throw new ExprError(`number too large at ${i}`);
      out.push({ t: "num", v, at: i });
      i += text.length;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(source.slice(i));
      const text = m?.[0] ?? "";
      out.push({ t: "id", v: text, at: i });
      i += text.length;
      continue;
    }
    if (c === '"') {
      const end = source.indexOf('"', i + 1);
      if (end < 0) throw new ExprError(`unterminated string at ${i}`);
      const v = source.slice(i + 1, end);
      // No escapes: strings only name keys and enum values, which never need them.
      if (v.includes("\\")) throw new ExprError(`escapes are not allowed in strings (at ${i})`);
      out.push({ t: "str", v, at: i });
      i = end + 1;
      continue;
    }
    const op = OPERATORS.find((o) => source.startsWith(o, i));
    if (op === undefined) throw new ExprError(`unexpected character "${c}" at ${i}`);
    out.push({ t: "op", v: op, at: i });
    i += op.length;
  }
  out.push({ t: "eof", at: source.length });
  return out;
}

// Binding powers, loosest first. Postfix `.`, `[` bind tightest.
const INFIX_BP: Readonly<Record<string, number>> = {
  "?": 1,
  "||": 2,
  "&&": 3,
  "==": 4,
  "!=": 4,
  "<": 5,
  "<=": 5,
  ">": 5,
  ">=": 5,
  "+": 6,
  "-": 6,
  "*": 7,
  "/": 7,
  "%": 7,
  ".": 9,
  "[": 9,
};
const PREFIX_BP = 8;

class Parser {
  private pos = 0;
  private nodes = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): ExprNode {
    const node = this.expr(0);
    const tok = this.peek();
    if (tok.t !== "eof") throw new ExprError(`unexpected "${describe(tok)}" at ${tok.at}`);
    return node;
  }

  private peek(): Token {
    // The token list always ends with eof, and the parser never advances past it.
    return this.tokens[this.pos] ?? { t: "eof", at: 0 };
  }

  private next(): Token {
    const tok = this.peek();
    if (tok.t !== "eof") this.pos++;
    return tok;
  }

  private expectOp(op: string): void {
    const tok = this.next();
    if (tok.t !== "op" || tok.v !== op) throw new ExprError(`expected "${op}" at ${tok.at}, got "${describe(tok)}"`);
  }

  private node(n: ExprNode): ExprNode {
    this.nodes++;
    if (this.nodes > MAX_EXPR_NODES) throw new ExprError(`expression has more than ${MAX_EXPR_NODES} nodes`);
    return n;
  }

  private expr(minBp: number): ExprNode {
    let left = this.prefix();
    for (;;) {
      const tok = this.peek();
      if (tok.t !== "op") break;
      const bp = INFIX_BP[tok.v];
      if (bp === undefined || bp < minBp) break;
      this.next();
      left = this.infix(left, tok.v, bp);
    }
    return left;
  }

  private prefix(): ExprNode {
    const tok = this.next();
    switch (tok.t) {
      case "num":
        return this.node({ k: "num", v: tok.v });
      case "str":
        return this.node({ k: "str", v: tok.v });
      case "id": {
        if (tok.v === "true" || tok.v === "false") return this.node({ k: "bool", v: tok.v === "true" });
        const after = this.peek();
        if (after.t === "op" && after.v === "(") return this.call(tok.v, tok.at);
        return this.node({ k: "id", name: tok.v });
      }
      case "op":
        if (tok.v === "(") {
          const inner = this.expr(0);
          this.expectOp(")");
          return inner;
        }
        if (tok.v === "-" || tok.v === "!") return this.node({ k: "unary", op: tok.v, arg: this.expr(PREFIX_BP) });
        throw new ExprError(`unexpected "${tok.v}" at ${tok.at}`);
      case "eof":
        throw new ExprError("unexpected end of expression");
    }
  }

  private call(name: string, at: number): ExprNode {
    const fn = FnName.safeParse(name);
    if (!fn.success) throw new ExprError(`unknown function "${name}" at ${at}`);
    this.expectOp("(");
    const args: ExprNode[] = [];
    const close = this.peek();
    if (close.t === "op" && close.v === ")") this.next();
    else {
      for (;;) {
        args.push(this.expr(0));
        const sep = this.next();
        if (sep.t === "op" && sep.v === ")") break;
        if (sep.t !== "op" || sep.v !== ",") throw new ExprError(`expected "," or ")" at ${sep.at}`);
      }
    }
    return this.node({ k: "call", fn: fn.data, args });
  }

  private infix(left: ExprNode, op: string, bp: number): ExprNode {
    if (op === ".") {
      const key = this.next();
      if (key.t !== "id") throw new ExprError(`expected a name after "." at ${key.at}`);
      return this.node({ k: "get", obj: left, key: key.v });
    }
    if (op === "[") {
      const key = this.expr(0);
      this.expectOp("]");
      return this.node({ k: "index", obj: left, key });
    }
    if (op === "?") {
      const then = this.expr(0);
      this.expectOp(":");
      // Right-associative: `a ? b : c ? d : e` nests in the else branch.
      const otherwise = this.expr(bp);
      return this.node({ k: "cond", test: left, then, else: otherwise });
    }
    const parsed = BinaryOp.parse(op);
    // Left-associative: the right side binds one tighter.
    return this.node({ k: "binary", op: parsed, left, right: this.expr(bp + 1) });
  }
}

function describe(tok: Token): string {
  return tok.t === "eof" ? "end" : String(tok.v);
}

/** Source → JSON AST. Throws ExprError on bad syntax, an unknown function, or a breached cap. */
export function parseExpr(source: string): ExprNode {
  if (source.length > MAX_EXPR_LENGTH) throw new ExprError(`expression longer than ${MAX_EXPR_LENGTH} characters`);
  return new Parser(lex(source)).parse();
}
