import { isTyping } from "./keys.js";

/* ==========================================================================
   Scientific calculator

   A real parser, not eval(). Three reasons, in order of how much they
   matter:

   eval() cannot read what this needs to read - sin(30), 5!, 2π, 3(4+1) are
   not JavaScript. Half the calculator would have to be rewritten into
   JavaScript before handing it over, and at that point the rewriting is the
   parser, just a worse one made of regular expressions.

   eval() runs whatever it is given. Nothing here is remote, so this is not
   an exploit waiting to happen - but a text box wired to the language
   runtime is a habit worth not forming.

   And errors: a parser can say "unbalanced bracket" and point at it.
   eval() says SyntaxError.

   Recursive descent, one function per precedence level, each calling the
   one below it. Reading the grammar downwards tells you exactly what binds
   tighter than what:

     expression := term (('+' | '-') term)*
     term       := unary (('*' | '/') unary)*      and implicit multiply
     unary      := ('-' | '+') unary | power
     power      := postfix ('^' unary)?            right associative
     postfix    := primary ('!' | '%')*

   Unary minus sits ABOVE power, not below it, and that ordering is the whole
   reason -3^2 is -9 rather than 9: the power binds to the 3, and the minus
   applies to what comes out. Having it the other way round squares the
   negative. Putting unary back as the exponent is what keeps 2^-3 working.
     primary    := number | constant | function '(' expression ')'
                 | '(' expression ')'

   The whole thing evaluates as it parses. There is no tree, because nothing
   here needs one - no simplification, no rewriting, just a number.
   ========================================================================== */

const CONSTANTS = { "π": Math.PI, pi: Math.PI, e: Math.E, Ans: 0 };

/* Trig is the only place the degree switch matters, so it is the only place
   that asks. Everything else is unit-free. */
const FUNCTIONS = {
  sin: (x, deg) => Math.sin(deg ? (x * Math.PI) / 180 : x),
  cos: (x, deg) => Math.cos(deg ? (x * Math.PI) / 180 : x),
  tan: (x, deg) => Math.tan(deg ? (x * Math.PI) / 180 : x),
  asin: (x, deg) => (deg ? (Math.asin(x) * 180) / Math.PI : Math.asin(x)),
  acos: (x, deg) => (deg ? (Math.acos(x) * 180) / Math.PI : Math.acos(x)),
  atan: (x, deg) => (deg ? (Math.atan(x) * 180) / Math.PI : Math.atan(x)),
  ln: (x) => Math.log(x),
  log: (x) => Math.log10(x),
  "√": (x) => Math.sqrt(x),
  sqrt: (x) => Math.sqrt(x),
  cbrt: (x) => Math.cbrt(x),
  abs: (x) => Math.abs(x),
  exp: (x) => Math.exp(x),
};

const NAMES = Object.keys(FUNCTIONS).concat(Object.keys(CONSTANTS));
// Longest first, so "asin" is not read as "a" followed by "sin".
NAMES.sort((a, b) => b.length - a.length);

function factorial(n) {
  if (n < 0 || !Number.isInteger(n)) {
    throw new Error("Factorial needs a whole number, 0 or more");
  }
  if (n > 170) return Infinity; // beyond a double; saying so beats looping
  let out = 1;
  for (let i = 2; i <= n; i++) out *= i;
  return out;
}

/* --------------------------------------------------------------------------
   Reading the text
   -------------------------------------------------------------------------- */

function tokenize(text) {
  const tokens = [];
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (char === " ") {
      i += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      let number = "";
      while (i < text.length && /[0-9.]/.test(text[i])) number += text[i++];
      if ((number.match(/\./g) || []).length > 1) {
        throw new Error("That number has two decimal points");
      }
      tokens.push({ type: "number", value: Number(number) });
      continue;
    }

    const name = NAMES.find((candidate) => text.startsWith(candidate, i));
    if (name) {
      tokens.push({
        type: name in FUNCTIONS ? "function" : "constant",
        value: name,
      });
      i += name.length;
      continue;
    }

    // The keypad writes the typographic ones; a keyboard writes the plain
    // ones. They mean the same thing, so they are flattened here rather than
    // in five places below.
    const operator = { "×": "*", "÷": "/", "−": "-", "–": "-" }[char] || char;
    if ("+-*/^()!%".includes(operator)) {
      tokens.push({ type: "op", value: operator });
      i += 1;
      continue;
    }

    throw new Error("I do not understand " + JSON.stringify(char));
  }

  return tokens;
}

/* --------------------------------------------------------------------------
   Reading the tokens
   -------------------------------------------------------------------------- */

function makeParser(tokens, degrees, answer) {
  let at = 0;

  const peek = () => tokens[at];
  const next = () => tokens[at++];

  function expression() {
    let left = term();
    for (;;) {
      const token = peek();
      if (!token || token.type !== "op") break;
      if (token.value !== "+" && token.value !== "-") break;
      next();
      const right = term();
      left = token.value === "+" ? left + right : left - right;
    }
    return left;
  }

  /* Implicit multiplication lives here: 2π, 3(4), (1+2)(3+4), 2sin(0). The
     test is simply whether the next token could begin a value, because two
     values in a row can only have meant a product. */
  function startsValue(token) {
    if (!token) return false;
    if (token.type === "number") return true;
    if (token.type === "constant" || token.type === "function") return true;
    return token.type === "op" && token.value === "(";
  }

  function term() {
    let left = unary();
    for (;;) {
      const token = peek();
      if (token && token.type === "op" && (token.value === "*" || token.value === "/")) {
        next();
        const right = unary();
        if (token.value === "/" && right === 0) throw new Error("Cannot divide by zero");
        left = token.value === "*" ? left * right : left / right;
        continue;
      }
      if (startsValue(token)) {
        // startsValue already ruled out a sign, so this cannot swallow the
        // minus of "2-3" and turn it into a product.
        left = left * unary();
        continue;
      }
      break;
    }
    return left;
  }

  function unary() {
    const token = peek();
    if (token && token.type === "op" && (token.value === "-" || token.value === "+")) {
      next();
      const value = unary();
      return token.value === "-" ? -value : value;
    }
    return power();
  }

  function power() {
    const base = postfix();
    const token = peek();
    if (token && token.type === "op" && token.value === "^") {
      next();
      /* Right associative, so 2^3^2 is 2^9 rather than 8^2 - and the exponent
         is a unary, so 2^-3 reads the sign instead of stopping at it. */
      return Math.pow(base, unary());
    }
    return base;
  }

  function postfix() {
    let value = primary();
    for (;;) {
      const token = peek();
      if (!token || token.type !== "op") break;
      if (token.value === "!") {
        next();
        value = factorial(value);
        continue;
      }
      if (token.value === "%") {
        next();
        value = value / 100;
        continue;
      }
      break;
    }
    return value;
  }

  function primary() {
    const token = next();
    if (!token) throw new Error("The expression stops early");

    if (token.type === "number") return token.value;

    if (token.type === "constant") {
      return token.value === "Ans" ? answer : CONSTANTS[token.value];
    }

    if (token.type === "function") {
      const open = peek();
      if (!open || open.type !== "op" || open.value !== "(") {
        throw new Error(token.value + " needs a bracket after it");
      }
      next();
      const argument = expression();
      const close = next();
      if (!close || close.value !== ")") throw new Error("Missing a closing bracket");
      return FUNCTIONS[token.value](argument, degrees);
    }

    if (token.value === "(") {
      const inner = expression();
      const close = next();
      if (!close || close.value !== ")") throw new Error("Missing a closing bracket");
      return inner;
    }

    throw new Error("Unexpected " + JSON.stringify(token.value));
  }

  return {
    run() {
      const value = expression();
      if (at < tokens.length) {
        throw new Error("Unexpected " + JSON.stringify(tokens[at].value));
      }
      return value;
    },
  };
}

export function calculate(text, degrees, answer) {
  const tokens = tokenize(text);
  if (!tokens.length) throw new Error("Nothing to work out");
  return makeParser(tokens, degrees, answer).run();
}

/* --------------------------------------------------------------------------
   Showing the answer

   Binary floating point cannot hold 0.1, so 0.1 + 0.2 lands on
   0.30000000000000004. Every calculator ever made hides this the same way:
   round to fewer digits than a double actually carries. Twelve keeps real
   precision while swallowing the noise, which always appears past the
   fifteenth.
   -------------------------------------------------------------------------- */

export function formatNumber(value) {
  if (Number.isNaN(value)) return "Undefined";
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "-∞";

  const rounded = Number(value.toPrecision(12));
  if (Number.isInteger(rounded) && Math.abs(rounded) < 1e15) return String(rounded);

  const size = Math.abs(rounded);
  if (size !== 0 && (size >= 1e12 || size < 1e-6)) {
    return rounded.toExponential(6).replace("e", "×10^");
  }
  return String(rounded);
}

/* --------------------------------------------------------------------------
   The keypad
   -------------------------------------------------------------------------- */

const panel = document.querySelector('.panel[data-panel="calculator"]');
const inputEl = document.getElementById("calc-input");
const resultEl = document.getElementById("calc-result");
const keysEl = document.getElementById("calc-keys");
const degBtn = document.getElementById("calc-deg");
const secondBtn = document.getElementById("calc-second");

let expression = "";
let answer = 0;
let degrees = true;
let second = false;
let settled = false; // true right after =, so the next digit starts fresh

function render() {
  inputEl.textContent = expression || "0";

  if (!expression) {
    resultEl.textContent = "";
    resultEl.classList.remove("is-error");
    return;
  }

  try {
    const value = calculate(expression, degrees, answer);
    resultEl.textContent = formatNumber(value);
    resultEl.classList.remove("is-error");
  } catch (error) {
    /* A half-typed expression is not a mistake, it is a person mid-thought.
       The preview simply goes quiet until it parses again; only pressing =
       is worth an error message. */
    resultEl.textContent = "";
    resultEl.classList.remove("is-error");
  }
}

function insert(text) {
  /* After =, a digit means a new sum but an operator means "carry on from
     that answer" - which is what every calculator does and nobody notices
     until it is missing. */
  if (settled) {
    settled = false;
    if (/^[0-9.(]/.test(text) || /^[a-zπ√]/i.test(text)) expression = "";
    else expression = formatNumber(answer);
  }
  expression += text;
  render();
}

function equals() {
  if (!expression) return;
  try {
    const value = calculate(expression, degrees, answer);
    answer = value;
    CONSTANTS.Ans = value;
    expression = formatNumber(value);
    settled = true;
    resultEl.textContent = "";
    resultEl.classList.remove("is-error");
    inputEl.textContent = expression;
  } catch (error) {
    resultEl.textContent = error.message;
    resultEl.classList.add("is-error");
  }
}

function clearAll() {
  expression = "";
  settled = false;
  render();
}

function backspace() {
  if (settled) {
    settled = false;
    expression = "";
  } else {
    /* Delete a whole name rather than a letter of one: backspacing "sin("
       one character at a time leaves "si", which is not anything. */
    const name = NAMES.find((candidate) => expression.endsWith(candidate + "("));
    if (name) expression = expression.slice(0, -(name.length + 1));
    else expression = expression.slice(0, -1);
  }
  render();
}

function applySecond() {
  keysEl.querySelectorAll("[data-insert-second]").forEach((key) => {
    const label = key.querySelector(".calc-key-label");
    if (!label) return;
    /* The second label is the insert text without its bracket - "asin(" is
       already the word, so carrying a separate label attribute for every key
       would just be the same string written twice and able to disagree. */
    const alternate = key.dataset.insertSecond.replace(/\($/, "");
    label.textContent = second ? alternate : key.dataset.first;
    key.dataset.active = second ? key.dataset.insertSecond : key.dataset.insert;
  });
  secondBtn.classList.toggle("is-active", second);
  secondBtn.setAttribute("aria-pressed", String(second));
}

const ACTIONS = {
  equals,
  clear: clearAll,
  back: backspace,
  deg() {
    degrees = !degrees;
    degBtn.textContent = degrees ? "DEG" : "RAD";
    degBtn.setAttribute("aria-label", degrees ? "Degrees" : "Radians");
    render();
  },
  second() {
    second = !second;
    applySecond();
  },
};

/* Keyboard, but only while the panel is open - otherwise typing "8" would
   reach the page's own shortcuts, and the calculator would be quietly
   stealing keys from a page it is not even showing on. */
const KEYS = {
  Enter: equals,
  "=": equals,
  Escape: clearAll,
  Backspace: backspace,
  Delete: clearAll,
};

function onKeyDown(event) {
  if (!panel || !panel.classList.contains("is-open")) return;
  if (isTyping(event)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  const action = KEYS[event.key];
  if (action) {
    event.preventDefault();
    event.stopPropagation();
    action();
    return;
  }

  if (/^[0-9.+\-*/^()!%]$/.test(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    insert(event.key);
  }
}

export function initCalculator() {
  if (!panel || !keysEl) return;

  keysEl.querySelectorAll("button").forEach((key) => {
    if (key.dataset.insert) key.dataset.first = key.querySelector(".calc-key-label")
      ? key.querySelector(".calc-key-label").textContent
      : key.textContent;
    key.addEventListener("click", () => {
      const action = key.dataset.action;
      if (action && ACTIONS[action]) {
        ACTIONS[action]();
        return;
      }
      const text = key.dataset.active || key.dataset.insert;
      if (text) insert(text);
    });
  });

  /* These two sit above the keypad rather than inside it, so the loop over
     #calc-keys does not reach them - they need wiring by hand. */
  if (secondBtn) secondBtn.addEventListener("click", ACTIONS.second);
  if (degBtn) degBtn.addEventListener("click", ACTIONS.deg);

  applySecond();
  render();

  // Capture, so this runs before the page's own shortcut handling.
  document.addEventListener("keydown", onKeyDown, true);
}
