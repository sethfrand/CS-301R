----------- Usage ------------
Model: gpt-5-nano
Input (tokens): 26
Cached (tokens): 0
Output (tokens): 1733
Reasoning (tokens): 448
Total cost (USD): $0.000695

Here’s a small, self-contained Python example that treats a rational function as a quotient of two polynomials. It includes:

- A simple polynomial arithmetic helper (add, multiply, normalize)
- A RationalFunction class to hold numerator and denominator polynomials
- A function to combine two rational functions with an operation: add, sub, mul, div
- A usage example

Code:

```python
# Simple polynomial helpers
def normalize_poly(p):
    # remove trailing zeros
    i = len(p) - 1
    while i > 0 and p[i] == 0:
        i -= 1
    return p[:i+1]

def poly_add(a, b):
    n = max(len(a), len(b))
    res = [0] * n
    for i in range(n):
        av = a[i] if i < len(a) else 0
        bv = b[i] if i < len(b) else 0
        res[i] = av + bv
    return normalize_poly(res)

def poly_mul(a, b):
    res = [0] * (len(a) + len(b) - 1)
    for i, av in enumerate(a):
        for j, bv in enumerate(b):
            res[i + j] += av * bv
    return normalize_poly(res)

def poly_sub(a, b):
    # a - b
    neg_b = [-c for c in b]
    return poly_add(a, neg_b)

# Rational function class
class RationalFunction:
    def __init__(self, num, den):
        if not den:
            raise ValueError("Denominator polynomial cannot be empty.")
        self.num = normalize_poly(list(num))
        self.den = normalize_poly(list(den))

    def __str__(self):
        return f"({poly_to_str(self.num)}) / ({poly_to_str(self.den)})"

def poly_to_str(p):
    # Convert a polynomial list [a0, a1, a2, ...] to human-friendly string
    terms = []
    for i in range(len(p)-1, -1, -1):
        coef = p[i]
        if coef == 0:
            continue
        deg = i
        if deg == 0:
            term = f"{coef}"
        elif deg == 1:
            term = f"{coef}*x" if coef != 1 else "x"
        else:
            term = f"{coef}*x^{deg}" if coef != 1 else f"x^{deg}"
        terms.append(term)
    return " + ".join(terms) if terms else "0"

# Combine two rational functions
def combine_rationals(op, r1, r2):
    """
    op: one of 'add', 'sub', 'mul', 'div'
    r1, r2: RationalFunction instances
    Returns a new RationalFunction
    """
    if op == 'add':
        # (n1/d1) + (n2/d2) = (n1*d2 + n2*d1) / (d1*d2)
        new_num = poly_add(poly_mul(r1.num, r2.den), poly_mul(r2.num, r1.den))
        new_den = poly_mul(r1.den, r2.den)
    elif op == 'sub':
        # (n1/d1) - (n2/d2) = (n1*d2 - n2*d1) / (d1*d2)
        new_num = poly_sub(poly_mul(r1.num, r2.den), poly_mul(r2.num, r1.den))
        new_den = poly_mul(r1.den, r2.den)
    elif op == 'mul':
        # (n1/d1) * (n2/d2) = (n1*n2) / (d1*d2)
        new_num = poly_mul(r1.num, r2.num)
        new_den = poly_mul(r1.den, r2.den)
    elif op == 'div':
        # (n1/d1) / (n2/d2) = (n1*d2) / (d1*n2)
        new_num = poly_mul(r1.num, r2.den)
        new_den = poly_mul(r1.den, r2.num)
    else:
        raise ValueError("Unsupported operation. Use 'add', 'sub', 'mul', or 'div'.")

    return RationalFunction(new_num, new_den)

# Example usage
if __name__ == "__main__":
    # Define f(x) = (x + 1) / (x - 1)
    f = RationalFunction(num=[1, 1], den=[-1, 1])  # (1) + (1)*x  /  (-1) + (1)*x  which is (x+1)/(x-1)

    # Define g(x) = (2x + 3) / (x + 4)
    g = RationalFunction(num=[3, 2], den=[4, 1])   # (3) + (2)*x  /  (4) + (1)*x

    # Compute f + g
    sum_fg = combine_rationals('add', f, g)
    print("f(x) = ", f)
    print("g(x) = ", g)
    print("f(x) + g(x) = ", sum_fg)

    # You can try other operations as well:
    prod_fg = combine_rationals('mul', f, g)
    print("f(x) * g(x) = ", prod_fg)
```

Notes:
- Polynomials are represented as lists of coefficients in increasing powers order: [a0, a1, a2, ...] represents a0 + a1 x + a2 x^2 + ...
- This is a simple, dependency-free implementation suitable for small examples. It does not perform gcd-based simplification of rational functions (i.e., it won’t automatically cancel common factors). If you need that, you’d want to add a polynomial gcd step and cancel common factors.
