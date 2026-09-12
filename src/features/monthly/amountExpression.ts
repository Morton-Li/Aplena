export type AmountExpressionError =
  | "EMPTY"
  | "INVALID_EXPRESSION"
  | "DIVISION_BY_ZERO"
  | "NON_POSITIVE"
  | "RESULT_TOO_SMALL"
  | "RESULT_OUT_OF_RANGE";

export type AmountExpressionResult =
  | { ok: true; amount: string }
  | { ok: false; error: AmountExpressionError };

interface Rational {
  numerator: bigint;
  denominator: bigint;
}

const MAX_EXPRESSION_LENGTH = 120;
const MAX_AMOUNT_CENTS = 9_223_372_036_854_775_807n;

class AmountExpressionFailure extends Error {
  constructor(readonly code: AmountExpressionError) {
    super(code);
  }
}

export function evaluateAmountExpression(expression: string): AmountExpressionResult {
  const source = normalizeOperators(expression.trim());
  if (!source) return { ok: false, error: "EMPTY" };
  if (source.length > MAX_EXPRESSION_LENGTH) return { ok: false, error: "INVALID_EXPRESSION" };

  try {
    const value = new AmountExpressionParser(source).parse();
    if (value.numerator <= 0n) return { ok: false, error: "NON_POSITIVE" };

    const cents = roundToCents(value);
    if (cents === 0n) return { ok: false, error: "RESULT_TOO_SMALL" };
    if (cents > MAX_AMOUNT_CENTS) return { ok: false, error: "RESULT_OUT_OF_RANGE" };

    return { ok: true, amount: centsToDecimal(cents) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof AmountExpressionFailure ? error.code : "INVALID_EXPRESSION",
    };
  }
}

class AmountExpressionParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): Rational {
    const value = this.parseExpression();
    this.skipWhitespace();
    if (this.index !== this.source.length) this.fail("INVALID_EXPRESSION");
    return value;
  }

  private parseExpression(): Rational {
    let value = this.parseTerm();
    while (true) {
      const operator = this.peek();
      if (operator !== "+" && operator !== "-") return value;
      this.index += 1;
      const right = this.parseTerm();
      value = operator === "+" ? add(value, right) : subtract(value, right);
    }
  }

  private parseTerm(): Rational {
    let value = this.parseFactor();
    while (true) {
      const operator = this.peek();
      if (operator !== "*" && operator !== "/") return value;
      this.index += 1;
      const right = this.parseFactor();
      value = operator === "*" ? multiply(value, right) : divide(value, right);
    }
  }

  private parseFactor(): Rational {
    const operator = this.peek();
    if (operator === "+" || operator === "-") {
      this.index += 1;
      const value = this.parseFactor();
      return operator === "-" ? rational(-value.numerator, value.denominator) : value;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Rational {
    if (this.peek() === "(") {
      this.index += 1;
      const value = this.parseExpression();
      if (this.peek() !== ")") this.fail("INVALID_EXPRESSION");
      this.index += 1;
      return value;
    }

    this.skipWhitespace();
    const match = /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})/.exec(this.source.slice(this.index));
    if (!match) this.fail("INVALID_EXPRESSION");
    this.index += match[0].length;
    return decimalToRational(match[0]);
  }

  private peek(): string | undefined {
    this.skipWhitespace();
    return this.source[this.index];
  }

  private skipWhitespace() {
    while (/\s/.test(this.source[this.index] ?? "")) this.index += 1;
  }

  private fail(code: AmountExpressionError): never {
    throw new AmountExpressionFailure(code);
  }
}

function normalizeOperators(value: string) {
  return value
    .replaceAll("＋", "+")
    .replaceAll("－", "-")
    .replaceAll("−", "-")
    .replaceAll("×", "*")
    .replaceAll("÷", "/")
    .replaceAll("（", "(")
    .replaceAll("）", ")");
}

function decimalToRational(value: string): Rational {
  const [integer = "0", fraction = ""] = value.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  return rational(BigInt(`${integer || "0"}${fraction}`), denominator);
}

function add(left: Rational, right: Rational) {
  return rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function subtract(left: Rational, right: Rational) {
  return rational(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function multiply(left: Rational, right: Rational) {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

function divide(left: Rational, right: Rational) {
  if (right.numerator === 0n) throw new AmountExpressionFailure("DIVISION_BY_ZERO");
  return rational(left.numerator * right.denominator, left.denominator * right.numerator);
}

function rational(numerator: bigint, denominator: bigint): Rational {
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return {
    numerator: (numerator / divisor) * sign,
    denominator: (denominator / divisor) * sign,
  };
}

function greatestCommonDivisor(left: bigint, right: bigint) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1n;
}

function roundToCents(value: Rational) {
  const scaled = value.numerator * 100n;
  const cents = scaled / value.denominator;
  const remainder = scaled % value.denominator;
  return remainder * 2n >= value.denominator ? cents + 1n : cents;
}

function centsToDecimal(cents: bigint) {
  const integer = cents / 100n;
  const fraction = String(cents % 100n).padStart(2, "0");
  return `${integer}.${fraction}`;
}
