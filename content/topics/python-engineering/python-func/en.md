# Research on Parameter Binding, Call Constraints, and Interface Evolution Mechanisms in Python Function Design

## Abstract

Python's function system centers on "formal parameter definition" and "argument binding", forming multiple parameter forms such as positional parameters, keyword parameters, default parameters, variable positional parameters, variable keyword parameters, positional-only parameters, and keyword-only parameters. Python official documentation describes function calls as a process of binding arguments to parameter slots: positional arguments first bind to formal parameter slots, keyword arguments then bind to corresponding slots by name, and unbound slots are filled by default values. If duplicate binding, missing required arguments, or unknown keyword arguments occur, a `TypeError` is raised. On this basis, PEP 3102 introduced keyword-only parameters, and PEP 570 introduced the positional-only parameter syntax `/`, allowing function authors to explicitly control call style at the function signature level. Based on Python official documentation, the language reference, and related PEPs, this article systematically explains why Python keeps both positional and keyword parameters, why `/` and `*` are designed as formal parameter call boundaries, and how this mechanism is used in the standard library, built-in functions, API evolution, readability constraints, and keyword forwarding scenarios.

**Keywords**: Python; Function Design; Positional Parameters; Keyword Parameters; Positional-Only Parameters; Keyword-Only Parameters; API Compatibility

## 1. Introduction

Functions are the basic unit for organizing logic, encapsulating behavior, and exposing interfaces in Python programs. A Python function is not only a reusable block of code, but also an object with a call protocol. Callers pass data to functions through positional arguments, keyword arguments, unpacked arguments, and variable arguments, while function authors use formal parameter lists to declare acceptable call shapes.

The special nature of Python function parameter design is that one function signature can simultaneously express many constraints: "pass by order", "pass by name", "only pass by order", "only pass by name", "accept arbitrary positional arguments", and "accept arbitrary keyword arguments". This design is not merely syntactic convenience. It is a language mechanism for describing function interface contracts, reducing call ambiguity, supporting API evolution, and remaining compatible with existing behavior of Python built-in functions and C extension modules.

From official materials, `*` and `/` do not have the same role. Parameters after `*` are keyword-only parameters and must be passed in the form `name=value`; parameters before `/` are positional-only parameters and cannot be passed by name. Together, they form call boundaries in Python function signatures, allowing function authors to precisely control whether parameter names become part of the public API.

## 2. Argument Binding Model of Python Function Calls

The Python language reference defines a function call as a call to a callable object. A call can include positional arguments, keyword arguments, `*` iterable unpacking, and `**` mapping unpacking. Before the call occurs, all argument expressions are evaluated first. Then the interpreter assigns arguments to formal parameters according to binding rules.

The basic process can be summarized as follows:

First, positional arguments bind first. If there are `N` positional arguments, they fill the first `N` formal parameter slots that can receive positional arguments in order.

Second, keyword arguments bind by name. Keyword names are used to match formal parameter names. If a slot has already been filled by a positional argument, binding it again by keyword causes a duplicate binding error.

Third, unbound parameters are filled by default values. If a required parameter receives no argument and has no default value, the call fails.

Fourth, if the function definition contains `*args`, extra positional arguments are collected into a tuple. If the function definition contains `**kwargs`, extra keyword arguments are collected into a dictionary.

Fifth, `*iterable` is expanded into additional positional arguments at the call site, and `**mapping` is expanded into additional keyword arguments at the call site.

For example:

```python
def connect(host, port=5432, *, timeout=3, **options):
    # Build connection config
    return {
        "host": host,
        "port": port,
        "timeout": timeout,
        "options": options,
    }


config = connect(
    "127.0.0.1",
    timeout=5,
    ssl=True,
    application_name="reporter",
)
```

In this example, `host` is bound by positional argument, `port` uses the default value, `timeout` is a keyword-only parameter, and `ssl` and `application_name` are collected into `options`. This example reflects the core feature of Python's function call model: position handles ordered binding, keywords handle named binding, and variable parameters extend the input set.

## 3. Why Positional and Keyword Parameters Both Exist

Python keeps both positional and keyword parameters because they express two different kinds of call information.

Positional parameters express inputs that naturally have ordering relationships. For functions such as mathematical operations, sequence operations, binary comparisons, and range construction, parameter order itself is part of the semantics. For example, in calls such as `pow(x, y)`, `divmod(x, y)`, and `range(start, stop, step)`, parameter meaning is determined by position.

```python
def distance(x1, y1, x2, y2):
    # Compute Euclidean distance between two points
    return ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5


d = distance(0, 0, 3, 4)
```

Keyword parameters express inputs whose names carry semantics. For configuration items, optional behavior, switches, callbacks, timeout settings, encoding formats, and similar scenarios, the parameter name directly explains the purpose of the value.

```python
def export_report(data, *, format="pdf", compress=False, timeout=30):
    # Export report with explicit options
    return {
        "data": data,
        "format": format,
        "compress": compress,
        "timeout": timeout,
    }


export_report(records, format="html", compress=True)
```

In this function, `format`, `compress`, and `timeout` should not rely on positional passing. If written as `export_report(records, "html", True, 60)`, the caller must remember parameter order. If written in keyword form, the call expression directly preserves parameter meaning.

Therefore, positional parameters and keyword parameters are not duplicate designs. Positional parameters serve ordered semantics and compact calls. Keyword parameters serve named semantics, readability, and configuration extension. Python combines both into one call system, allowing function authors to choose parameter forms according to interface semantics.

## 4. Formal Parameter Boundary Design of `/` and `*`

In Python function signatures, `/` and `*` are call restrictions in opposite directions.

`/` declares positional-only parameters. Parameters to the left of `/` can only be passed by positional arguments; callers cannot bind them using parameter names.

```python
def normalize(value, /, *, min_value=0, max_value=1):
    # Normalize a value into a target interval
    return (value - min_value) / (max_value - min_value)


normalize(5, min_value=0, max_value=10)
```

In this function, `value` is positional-only, while `min_value` and `max_value` are keyword-only. Callers can write `normalize(5, min_value=0, max_value=10)`, but should not write `normalize(value=5, min_value=0, max_value=10)`.

`*` declares keyword-only parameters. Parameters after a bare `*`, or after `*args`, can only be passed by keyword and cannot be passed positionally.

```python
def read_file(path, *, encoding="utf-8", errors="strict"):
    # Read text from a file using explicit text options
    with open(path, encoding=encoding, errors=errors) as file:
        return file.read()
```

Here, `path` can be passed positionally, while `encoding` and `errors` must be passed by name. This form avoids calls with weaker readability, such as `read_file("a.txt", "utf-8", "ignore")`.

The complete parameter partition form is:

```python
def f(pos1, pos2, /, pos_or_kwd, *, kwd1, kwd2):
    # Demonstrate all parameter regions
    return pos1, pos2, pos_or_kwd, kwd1, kwd2
```

This signature is divided into three regions:

`pos1, pos2` are to the left of `/` and can only be passed positionally.

`pos_or_kwd` is between `/` and `*`, and can be passed either positionally or by keyword.

`kwd1, kwd2` are to the right of `*` and can only be passed by keyword.

## 5. Design Purpose and Main Application Scenarios

### 5.1 Use `/` When Parameter Names Should Not Become Public API

PEP 570 states that positional-only parameters have no externally usable names. Callers can only pass them by position, so parameter names do not become part of the call contract. This is directly meaningful for library authors: if a parameter name has no stable external semantics, or may be renamed in the future, callers should not be allowed to depend on that name.

```python
def as_user_id(value, /):
    # Convert input to user id
    return int(value)
```

In this example, `value` is only an internal local name. If callers could write `as_user_id(value="1001")`, the name `value` would become part of the external API. If the internal parameter name is later changed to `raw`, callers depending on `value=` would be affected. With `/`, callers can only write `as_user_id("1001")`, and the internal parameter name can be adjusted safely.

### 5.2 Use `/` When Parameters Naturally Have Order

For inputs with fixed order, keyword form may create many equivalent but inconsistent call styles. For ranges, coordinates, binary operations, slice boundaries, and similar scenarios, parameter order is usually part of the semantic structure.

```python
def between(value, lower, upper, /):
    # Check whether value is within the closed interval
    return lower <= value <= upper


between(5, 1, 10)
```

In this function, `value`, `lower`, and `upper` depend on fixed order. Positional-only parameters can restrict the call style and avoid call expressions such as `between(upper=10, value=5, lower=1)`, which may be semantically valid but break the ordered structure.

### 5.3 Use `/` to Avoid Name Conflicts When a Function Accepts Arbitrary Keywords

One important scenario described by PEP 570 is a function that needs to receive one positional object and arbitrary keyword parameters. A typical pattern is similar to `dict.update`: the first input can be a mapping or key-value pair iterator, and the remaining input can be arbitrary keywords. If the first parameter is not positional-only, its parameter name conflicts with a same-named key in `**kwargs`.

```python
def merge(mapping=None, /, **items):
    # Merge a positional mapping and arbitrary keyword items
    result = {}

    if mapping is not None:
        result.update(mapping)

    result.update(items)
    return result


merge({"name": "Alice"}, name="Bob", age=18)
```

Here, `mapping` is only the internal name used to receive the first positional object. If `mapping=` were allowed as a keyword argument, the caller might intend either to pass the mapping to be merged or to set the `"mapping"` key in the result. With `/`, `mapping` does not occupy the keyword namespace, and `**items` can fully receive the data fields the caller wants to express.

### 5.4 Use `*` When Option Parameters Must Be Explicitly Named

One core motivation of PEP 3102 for introducing keyword-only parameters was to allow functions to define options that can only be passed by keyword while still accepting arbitrary positional arguments. This prevents options from being accidentally filled by positional arguments.

```python
def join_words(*words, separator=" "):
    # Join words with an explicit separator option
    return separator.join(words)


join_words("Python", "function", "design", separator="-")
```

This function can accept any number of words while using `separator` as a named option. Without keyword-only parameters, callers would have difficulty distinguishing whether the last positional argument is a word to be joined or a separator configuration.

### 5.5 Use Keyword-Only Parameters to Preserve Compatibility During API Extension

Keyword-only parameters are suitable for adding new configuration items. If existing callers use positional arguments, adding keyword-only options does not change existing positional binding.

```python
def fetch(url, *, timeout=3):
    # Fetch resource with timeout option
    return url, timeout
```

If retry count needs to be added later, a keyword-only parameter can be appended:

```python
def fetch(url, *, timeout=3, retries=0):
    # Fetch resource with timeout and retry options
    return url, timeout, retries
```

Existing calls such as `fetch("https://example.com", timeout=5)` remain valid. The new option is passed by name and does not change the original parameter order.

### 5.6 Use in the Standard Library and Built-In Functions

Python built-in function documentation already uses `/` extensively to mark positional-only parameters. For example, signatures such as `hex(integer, /)`, `id(object, /)`, and `input(prompt, /)` indicate that parameters to the left of `/` cannot be passed by keyword. The parameter names of these functions are usually documentation descriptions or internal implementation names, not external call interfaces intended to be depended upon.

The historical behavior of the standard library, built-in functions, and C extension modules is also an important reason `/` entered Python function definition syntax. PEP 570 points out that before language-level positional-only parameter syntax existed, many CPython built-in functions already had positional-only semantics, but pure Python functions could not express the same interface form. After `/` was introduced, pure Python implementations and C implementations could stay consistent at the interface level.

## 6. Other Mechanisms in Python Function Definitions and Calls

### 6.1 Default Parameters

Default parameters allow functions to omit some arguments during calls. Python official documentation states that default values are evaluated when the function definition is executed, not each time the function is called. Therefore, mutable objects used as default values are shared across calls.

Not recommended:

```python
def append_item(item, items=[]):
    # This default list is shared across calls
    items.append(item)
    return items
```

Recommended:

```python
def append_item(item, items=None):
    # Create a new list when no list is provided
    if items is None:
        items = []

    items.append(item)
    return items
```

This design means default parameters are not only a call convenience mechanism, but also part of function object creation. Default values are objects determined at function definition time, not dynamically created at call time.

### 6.2 Variable Positional Parameters `*args`

`*args` receives extra positional arguments that are not bound to ordinary parameters. Inside the function, it is a tuple.

```python
def total(*numbers):
    # Sum arbitrary positional numbers
    return sum(numbers)


total(1, 2, 3, 4)
```

This mechanism is suitable for aggregation, forwarding, wrappers, higher-order functions, and command-style interfaces.

### 6.3 Variable Keyword Parameters `**kwargs`

`**kwargs` receives extra keyword arguments that are not bound to ordinary parameters. Inside the function, it is a dictionary.

```python
def build_user(**fields):
    # Build a user dictionary from keyword fields
    return dict(fields)


build_user(name="Alice", age=18, active=True)
```

This mechanism is suitable for configuration forwarding, data object construction, plugin parameter passing, and decorator wrappers.

### 6.4 `*` and `**` Unpacking at the Call Site

`*` and `**` at the call site have the opposite direction from `*args` and `**kwargs` in function definitions. At the call site, `*` expands an iterable object into positional arguments, and `**` expands a mapping object into keyword arguments.

```python
def rectangle_area(width, height):
    # Compute rectangle area
    return width * height


size = (4, 5)
rectangle_area(*size)

options = {"width": 4, "height": 5}
rectangle_area(**options)
```

Call-site unpacking allows callers to construct argument sets at runtime and complete binding according to the function signature.

### 6.5 Lambda Expressions

`lambda` creates anonymous functions. The Python tutorial states that lambda is syntactic sugar for ordinary function definitions semantically, but can only contain a single expression.

```python
users = [
    {"name": "Alice", "score": 90},
    {"name": "Bob", "score": 80},
]

users.sort(key=lambda user: user["score"])
```

This mechanism is commonly used for sort keys, simple callbacks, and local higher-order function scenarios.

### 6.6 Docstrings

The first string literal in a function body is usually the function's docstring. A docstring can be accessed through `__doc__` and is used by tools such as `help()`.

```python
def add(a, b):
    """Return the sum of two values."""
    return a + b
```

Docstrings allow behavioral explanations outside the function signature to be attached structurally to function objects.

### 6.7 Function Annotations and Type Hints

Python supports annotations for function parameters and return values. The official `typing` documentation states that Python runtime does not enforce function and variable type annotations. These annotations are mainly used by type checkers, IDEs, linters, and similar tools.

```python
def scale(value: float, factor: float = 1.0) -> float:
    # Scale a numeric value
    return value * factor
```

Therefore, type annotations belong to interface information in static analysis and the tooling ecosystem, not to runtime argument binding rules themselves.

### 6.8 Decorators

Decorators are callables executed at function definition time. A decorator receives the original function object and returns a new object bound to the function name. Multiple decorators are applied in nested form.

```python
import functools


def log_call(func):
    # Wrap function to log calls
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        # Print function name before invocation
        print(f"calling {func.__name__}")
        return func(*args, **kwargs)

    return wrapper


@log_call
def greet(name):
    # Return greeting text
    return f"Hello, {name}"
```

Decorators are commonly used for cross-cutting logic such as logging, authentication, caching, retry, transactions, metric collection, and parameter validation.

### 6.9 Closures

Functions can be defined inside other functions, and the inner function can reference variables from the outer function scope.

```python
def make_multiplier(factor):
    # Return a closure that captures factor
    def multiply(value):
        # Use captured factor
        return value * factor

    return multiply


double = make_multiplier(2)
double(10)
```

Closures allow functions to carry environment state and are common in factory functions, callback construction, and decorator implementation.

### 6.10 Generator Functions

When `yield` appears in a function body, calling the function does not immediately execute the whole body. Instead, it returns a generator object. The generator yields values on demand.

```python
def count_up_to(limit):
    # Yield numbers from zero to limit - 1
    current = 0

    while current < limit:
        yield current
        current += 1
```

Generator functions are used for lazy sequences, stream processing, and large-scale data traversal.

### 6.11 Asynchronous Functions

`async def` defines a coroutine function. Calling it returns a coroutine object, which usually needs to be executed through `await` or an event loop.

```python
async def fetch_text(client, url, *, timeout=3):
    # Await asynchronous client request
    response = await client.get(url, timeout=timeout)
    return response.text
```

Asynchronous functions combine function calls with asynchronous scheduling and are commonly used for network I/O, database I/O, and concurrent task orchestration.

### 6.12 Callable Objects

Python's call protocol applies not only to functions, but also to objects implementing the `__call__()` method.

```python
class Prefixer:
    def __init__(self, prefix):
        # Store prefix for later calls
        self.prefix = prefix

    def __call__(self, value):
        # Make instances callable
        return f"{self.prefix}{value}"


add_user_prefix = Prefixer("user:")
add_user_prefix("1001")
```

This shows that "function call" in Python is a more general callable protocol, not limited to functions defined with `def`.

## 7. Engineering Examples of Function Signature Design

### 7.1 Data Access Interface

```python
def query(sql, /, *params, timeout=3, readonly=True, **driver_options):
    # Execute SQL with positional parameters and keyword-only options
    return {
        "sql": sql,
        "params": params,
        "timeout": timeout,
        "readonly": readonly,
        "driver_options": driver_options,
    }


query(
    "select * from user where id = ?",
    1001,
    timeout=5,
    readonly=True,
    trace_id="abc-123",
)
```

In this design, `sql` is positional-only because it is the main input; `params` receives SQL placeholder parameters; `timeout` and `readonly` are keyword-only configuration options; `driver_options` receives driver-level extension parameters. This signature reflects ordered input, explicit configuration, and extension parameter forwarding at the same time.

### 7.2 API Client Interface

```python
def request(method, url, /, *, headers=None, json=None, timeout=10, retries=0):
    # Build an HTTP request description
    return {
        "method": method,
        "url": url,
        "headers": headers or {},
        "json": json,
        "timeout": timeout,
        "retries": retries,
    }


request(
    "POST",
    "https://api.example.com/users",
    json={"name": "Alice"},
    timeout=5,
    retries=2,
)
```

`method` and `url` have fixed order and are the core request inputs. `headers`, `json`, `timeout`, and `retries` are configuration items and are suitable for keyword-only use. This design avoids unclear positional calls such as `request("POST", url, None, {"name": "Alice"}, 5, 2)`.

### 7.3 Data Model Construction Interface

```python
def make_record(kind, /, **fields):
    # Build a record with arbitrary user-defined fields
    return {
        "kind": kind,
        "fields": fields,
    }


make_record("event", kind="login", user_id=1001)
```

This example shows the key value of `/`: the first `kind` is an internal parameter name, but callers can still use `"kind"` as a business field in `**fields`. Without `/`, `kind="login"` would conflict with the first formal parameter.

### 7.4 Plugin Registration Interface

```python
def register_plugin(name, factory, /, *, enabled=True, priority=0, **metadata):
    # Register plugin with explicit options and arbitrary metadata
    return {
        "name": name,
        "factory": factory,
        "enabled": enabled,
        "priority": priority,
        "metadata": metadata,
    }
```

`name` and `factory` are the main inputs of the registration action. Using positional-only parameters prevents names from becoming a stable API burden in the future. `enabled` and `priority` are configuration items, and keyword-only form improves call clarity. `metadata` supports extension.

## 8. Discussion

In Python function design, `/` and `*` are not decorative syntax. They are part of the interface contract. `/` controls that parameter names do not leak externally, allowing function authors to change internal formal parameter names without breaking external calls. `*` controls that configuration items must be explicitly named, allowing call expressions to carry parameter meaning. Together with default parameters, `*args`, `**kwargs`, call-site unpacking, annotations, decorators, and the callable protocol, they form Python's function system.

Compared with language mechanisms centered on function overloading, static type signatures, or named parameters, Python's function design focuses more on runtime argument binding and call protocol expression. The Python parameter list is both a call entry point and an API compatibility boundary. Whether a parameter can be passed by name determines whether that parameter name becomes an external contract. Whether a parameter can only be passed by keyword determines whether callers must explicitly express configuration semantics.

## 9. Conclusion

Python designs positional and keyword parameters to support both ordered semantics and named semantics. Positional parameters are suitable for scenarios with natural order, weak external meaning of names, or clear primary inputs. Keyword parameters are suitable for configuration items, optional behavior, and scenarios with high readability requirements. `/` and `*` further solidify this parameter classification into function-signature-level interface constraints.

The main purposes of `/` include hiding internal parameter names, preventing parameter names from becoming public API, supporting safe API evolution, expressing existing positional-only semantics of built-in functions and C extensions, and avoiding conflicts with the keyword namespace of `**kwargs`. The main purposes of `*` include forcing explicit option passing, preventing callers from relying on option positions, supporting named options after variable positional parameters, and preserving compatibility space for adding future configuration items.

Therefore, Python function design is not only a question of "how to pass parameters", but a question of "how to define stable, clear, evolvable APIs". For library functions, framework interfaces, SDKs, data access layers, HTTP clients, plugin systems, decorators, and similar scenarios, properly using positional parameters, keyword parameters, `/`, `*`, `*args`, and `**kwargs` directly affects interface readability, compatibility, and extensibility.

## References

[1] Python Documentation. The Python Tutorial: More on Defining Functions.
[2] Python Documentation. The Python Language Reference: Function Definitions.
[3] Python Documentation. The Python Language Reference: Calls.
[4] PEP 3102. Keyword-Only Arguments.
[5] PEP 570. Python Positional-Only Parameters.
[6] Python Documentation. inspect - Inspect live objects.
[7] Python Documentation. typing - Support for type hints.
[8] Python Documentation. Built-in Functions.
