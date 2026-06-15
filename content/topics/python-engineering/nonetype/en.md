# Research on the Design of NoneType in Python: Object Model, Return-Value Semantics, and Optional Type Expression

## Abstract

`None` is a constant object in Python's built-in namespace and is used to represent the absence of a value. The official Python documentation explicitly states that `None` is the only instance of `NoneType`; `types.NoneType` is the type name of `None`; and in the Python/C API, `Py_None` represents Python's `None` object and indicates lack of value. The Python language reference also specifies that a `return` statement without an explicit return expression returns `None`, and that procedural functions in Python return `None`. Based on the official Python data model, built-in constants, `types`, `typing`, Python/C API, the Java Language Specification, and the Go Language Specification, this article systematically explains what `NoneType` is, how it is used, and how it compares with Java `null` and Go `nil`. It further explains, from the perspective of static and dynamic languages, why Java and Go can declare functions with no return value while Python functions return `None` by default. Finally, it explains how `NoneType` is expressed in Type Hints as an optional type and a type-inference object.

**Keywords:** Python; None; NoneType; null; nil; Type Hints; Optional; dynamic language; static language

## 1. Introduction

In Python, `None` is frequently used to represent "no value", "value not provided", "no meaningful return value", or "lookup failure". At the syntax level, `None` is a built-in constant. At the object-model level, it is an object. At the type-system level, its type is `NoneType`. At the function-call semantic level, it is the default return object for functions without an explicit return value.

Unlike Java `null` and Go `nil`, Python `None` is not a null reference inside a reference variable, nor is it the zero value of several reference-like types. It is a globally unique object. The Python data model states that all data in a Python program is represented by objects or by relations between objects, and code itself is also represented by objects. Therefore, Python expresses "value absence" inside the object model rather than outside it as "no object" or "no reference".

It is worth noting that the statement "Python expressions must have return values" is not rigorous if written as an absolute proposition. A more precise specification-based statement is this: the Python language reference specifies that a `return` statement without an expression list substitutes `None`; the expression-statement section also states that procedural functions return `None` in Python. Therefore, the central role of `NoneType` comes from two facts: first, Python uses objects as its unified data abstraction; second, even when a function has no meaningful business return value, the function call still produces a specified return object.

## 2. Definition of NoneType

### 2.1 What None Is

`None` is a Python built-in constant. The official documentation defines it as an object often used to represent the absence of a value, for example when a function default parameter is not supplied. The official documentation also states that assignment to `None` is illegal and that `None` is the only instance of `NoneType` [1].

```python id="gle1jn"
value = None

print(value is None)       # True
print(type(value))         # <class 'NoneType'>
print(value == None)       # True, but identity check is preferred for singleton values
```

The core fact here is not that `None` looks like "empty", but that `None` itself is an object. It exists at runtime and has identity, type, and value. Its type object can be obtained with `type(None)`:

```python id="pwk0q4"
none_type = type(None)

print(none_type)           # <class 'NoneType'>
print(isinstance(None, none_type))  # True
```

Starting from Python 3.10, the standard-library `types` module explicitly provides `types.NoneType`, which is defined as the type of `None` [2].

```python id="1jw5b8"
import types

print(types.NoneType)                # <class 'NoneType'>
print(types.NoneType is type(None))  # True
```

### 2.2 None Is a Singleton Object

The Python/C API documentation states that `None` is a singleton, so it can be tested by object identity. `Py_None` represents Python's `None` object, is used to indicate lack of value, and has no methods [3]. At the Python level, the normalized way to check whether a value is `None` is identity comparison:

```python id="0xviff"
def handle(value):
    # Check for absence of value by identity
    if value is None:
        return "missing"

    return "present"
```

The reason to use `is None` is that the semantics of `None` are not "equal to some value", but "whether this is exactly the unique None object". This is consistent with identity in the Python object model. The Python data model states that every object has identity, type, and value, and that the `is` operator compares the identity of two objects [4].

## 3. Main Uses of NoneType

### 3.1 Representing Absence of Value

The most common use of `None` is to indicate that a position has no value. Typical scenarios include an omitted function argument, a missing query result, a parse failure, or an unavailable external resource.

```python id="fs8342"
def find_user(user_id: int) -> dict | None:
    # Return None when the user does not exist
    if user_id <= 0:
        return None

    return {"id": user_id, "name": "Alice"}


user = find_user(-1)

if user is None:
    print("user not found")
```

In this example, `dict | None` means that the function may return a user object or may return `None`. `None` does not mean an empty dictionary or an empty string. It separately means "there is no user object".

### 3.2 Acting as a Default-Parameter Sentinel

When a function parameter cannot use a mutable object as its default value, `None` is often used as the default sentinel. The purpose of this usage is not to treat `None` as a business value, but to use it as a marker meaning "the caller did not provide this argument".

```python id="bkqy16"
def append_item(item: str, items: list[str] | None = None) -> list[str]:
    # Create a new list when the caller does not provide one
    if items is None:
        items = []

    items.append(item)
    return items
```

This pattern avoids sharing the same default list object across multiple function calls. Here, `None` expresses "no list was provided", not "the list is empty".

### 3.3 Representing No Meaningful Function Return Value

In Python, even if a function has no explicit `return` statement, calling the function still produces `None`.

```python id="vsokxi"
def log_message(message: str) -> None:
    # Print message and return no meaningful result
    print(message)


result = log_message("hello")
print(result)              # None
print(type(result))        # <class 'NoneType'>
```

From the specification perspective, `log_message()` is not "having no return result at all"; it returns `None`. This is also the unified behavior of procedural functions in Python.

### 3.4 Explicit `return None`

A function can explicitly return `None` to clearly express that a branch has no result.

```python id="ru2he4"
def parse_int(text: str) -> int | None:
    # Return None when parsing fails
    try:
        return int(text)
    except ValueError:
        return None
```

In this example, `None` is a legal member of the function's return domain. The type annotation `int | None` means the return value may be `int` or `None`.

## 4. Comparison with Java null

The Java Language Specification divides Java types into primitive types and reference types, and also specifies a special null type. The type of the `null` expression is the null type. This type has no name, so variables of the null type cannot be declared and values cannot be converted to the null type. The null reference is the only possible value of an expression of the null type, and it can be assigned or converted to any reference type [5].

Java example:

```java id="6ejbum"
class UserService {
    User findUser(long id) {
        // Return null when the user does not exist
        if (id <= 0) {
            return null;
        }

        return new User(id);
    }
}
```

In Java, `null` is not an ordinary object. It is a special null reference that reference-type variables can hold. Java variables can be primitive types or reference types. A reference-type variable can hold a `null` reference or an object reference [5].

```java id="j6hafz"
String name = null;     // Valid: reference type
// int age = null;      // Invalid: primitive type
```

Therefore, Java `null` and Python `None` are fundamentally different:

| Comparison Item | Python `None` | Java `null` |
| --- | --- | --- |
| Runtime form | An object | A special null reference |
| Type name | `NoneType` | The null type has no name |
| Whether a variable of the type can be declared | Can be expressed through `None`, `type(None)`, and `types.NoneType` | Cannot declare a null type variable |
| Model | Unified object model | Special value in the reference type system |
| Check style | `value is None` | `value == null` |

Java also has `void` method results. The Java Language Specification states that a method declaration result is either a return type or `void`, indicating that the method returns no value [6]. Therefore, Java can explicitly distinguish "has a return value" from "has no return value" in method signatures.

```java id="l3h2of"
class Logger {
    void log(String message) {
        // Print message and return no value
        System.out.println(message);
    }

    String format(String message) {
        // Return a formatted value
        return "[" + message + "]";
    }
}
```

For `void` methods, a Java method invocation expression cannot be used in a context that requires a value. The Java Language Specification states that an expression invoking a `void` method denotes nothing and can only be used as an expression statement or in a specific lambda body. If a `void` method invocation appears in a context requiring a value, a compile-time error occurs [7].

## 5. Comparison with Go nil

The Go Language Specification states that the value of an uninitialized pointer is `nil`; the value of an uninitialized function-type variable is also `nil`; and under the zero-value rule, the zero value of pointers, functions, interfaces, slices, channels, and maps is `nil` [8][9].

Go example:

```go id="9zggnr"
package main

import "fmt"

func main() {
	var names []string
	var dict map[string]int
	var ptr *int

	fmt.Println(names == nil) // true
	fmt.Println(dict == nil)  // true
	fmt.Println(ptr == nil)   // true
}
```

Go `nil` is not the only instance of a single object type. It is the zero value for several families of types. It can be used with pointers, functions, interfaces, slices, channels, and maps, but it cannot be assigned to ordinary numeric types.

```go id="qv241p"
var p *int = nil
var s []int = nil
var m map[string]int = nil

// var n int = nil // Invalid: int zero value is 0, not nil
```

Go function signatures also differ from Python. A Go function type is determined by parameter types and result types, and the result section of the signature is optional. `func()` means a function type with no result parameters, while `func(x int) int` means a function type that returns an `int` [8].

```go id="k59y8g"
func log(message string) {
	// Print message and return no result
	fmt.Println(message)
}

func parseInt(text string) (int, error) {
	// Return value and error
	return 0, nil
}
```

Go does not use a default return value of `nil` to express functions with no return value. If a function signature declares result parameters, the function body must satisfy the return requirements. If a function declares no result parameters, the caller cannot obtain a return value from the function call.

## 6. Return-Value Differences from Static and Dynamic Language Perspectives

### 6.1 Java: Method Signatures Distinguish void and Non-void

Java is a statically typed language, and a method declaration must specify a method result. The result is either a concrete return type or `void`. Therefore, "no return value" in Java is part of the method signature and is checked by the compiler.

```java id="ktqz1x"
class Example {
    void writeLog() {
        // Valid: no value is returned
        return;
    }

    int getCode() {
        // Valid: int value is returned
        return 200;
    }
}
```

The following code is invalid in Java because a `void` method invocation does not produce a value that can be assigned:

```java id="qxj7m4"
class Example {
    void writeLog() {
        // Print log
        System.out.println("done");
    }

    void test() {
        // Invalid: writeLog() returns no value
        // Object result = writeLog();
    }
}
```

Java's design allows an "expression denotes nothing" case. This directly contrasts with Python's rule that procedural functions return `None`.

### 6.2 Go: Function Signatures Can Omit the Result Section

Go also expresses return values through function signatures. The result section of a function signature is optional. A function with no result section produces no return value. A function with a result section must return results consistent with the signature.

```go id="6dqgx9"
func notify(message string) {
	// This function has no result values
	fmt.Println(message)
}

func status() int {
	// This function returns an int
	return 200
}
```

Go also supports named result parameters. The specification states that named result parameters are initialized to their type's zero value when the function is entered, and an empty `return` returns the current values of those result parameters [10].

```go id="kxz614"
func split() (left int, right int) {
	// Named result values are initialized to zero values
	left = 1
	right = 2
	return
}
```

Therefore, "no return value" in Go is not necessarily bound to `nil`. `nil` is the zero value of several types; a function with no return value is a function whose signature has no result parameters.

### 6.3 Python: Returning None When There Is No Explicit Return Expression

Python function definitions do not enforce return types at runtime. Even if a function annotation is written as `-> None`, Python runtime does not enforce the annotation. The Python language reference specifies that if a `return` statement has an expression list, that expression list is evaluated; otherwise, `None` is substituted; the `return` statement leaves the current function call with the expression list or `None` as the return value [11].

```python id="aqlfgz"
def notify(message: str):
    # This function has no explicit return statement
    print(message)


result = notify("done")
print(result is None)      # True
```

This function "returns no meaningful result" in business semantics, but it still returns `None` in Python call semantics. Therefore, Python does not introduce `void` into the function signature. Instead, it uniformly uses `None` in function-call results to represent no meaningful result.

## 7. NoneType and Type Hints

### 7.1 `-> None`

When a function has no meaningful return value, its type annotation is usually written as `-> None`.

```python id="2zimnl"
def save_user(name: str) -> None:
    # Save user and return no meaningful value
    print(f"save {name}")
```

The official Python `typing` documentation states that Python runtime does not enforce function and variable type annotations. These annotations are available to third-party type checkers, IDEs, linters, and similar tools [12]. Therefore, the main purpose of `-> None` is static analysis and interface expression, not runtime enforcement.

### 7.2 `Optional[T]` and `T | None`

`typing.Optional[X]` is equivalent to `X | None`, and also to `Union[X, None]`. The official documentation also states that `Optional` does not mean "an optional parameter with a default value". It is appropriate only when `None` is explicitly allowed as a value [13].

```python id="g9o8v0"
from typing import Optional


def find_name(user_id: int) -> Optional[str]:
    # Return None when no name can be found
    if user_id <= 0:
        return None

    return "Alice"
```

In Python 3.10 and later, the more common form is:

```python id="jthqm2"
def find_name(user_id: int) -> str | None:
    # Return None when no name can be found
    if user_id <= 0:
        return None

    return "Alice"
```

This kind of annotation lets static type checkers know that callers must handle the `None` branch:

```python id="wcs9c5"
name = find_name(-1)

if name is not None:
    print(name.upper())
```

### 7.3 `None` Annotation and `NoneType` Inference

The `typing.get_type_hints()` examples show that when a function return annotation is written as `-> None`, the parsed return type is displayed as `<class 'NoneType'>` [14].

```python id="iugpbz"
from typing import get_type_hints


def close() -> None:
    # Close resource and return no meaningful value
    pass


print(get_type_hints(close))
# {'return': <class 'NoneType'>}
```

This shows that in the type-annotation system, `None` is not merely a writing convention. It maps to `NoneType` when type hints are resolved. From the perspective of static type checking, `str | None` means the return-value space contains two possibilities: `str` and `NoneType`.

## 8. Design Discussion: Consistency of NoneType

Python's `NoneType` mechanism can be understood at three levels.

First, the data-model level. Python states that all data is represented by objects or relations between objects. `None` is an object, so "missing value" is incorporated into the object system rather than existing as a special reference state outside the object system.

Second, the function-semantics level. Python does not have Java's `void` method result, nor does it distinguish "no-result functions" through the result section of function signatures as Go does. Python provides a unified return object for functions without explicit return values through `None`. Procedural functions return `None` in Python, as stated by the language reference.

Third, the type-expression level. Python Type Hints allow `-> None` to express no meaningful return value, and allow `T | None` or `Optional[T]` to express a value that may be missing. `get_type_hints()` can resolve `-> None` into `<class 'NoneType'>`, showing that `None` also corresponds to a definite type object in the type-hinting system.

Therefore, `NoneType` is not simply a copy of Java `null` or Go `nil`. Java `null` is a special null reference in the reference type system. Go `nil` is the zero value of several types. Python `None` is a unique runtime object, and `NoneType` is the type of that object. Python uses this mechanism to serve value absence, default parameters, function return semantics, and optional type expression at the same time.

## 9. Conclusion

`NoneType` is Python's object-oriented expression of "no value" semantics. `None` is the only instance of `NoneType` and is used to indicate absence of value. It is a built-in constant, cannot be reassigned, is a singleton object, and is best checked by identity. Python functions return `None` when they have no explicit return expression, and procedural functions also use `None` as the return object for no meaningful result.

Compared with Java, Python `None` is an object, while Java `null` is a special null reference. The null type has no name and cannot be used to declare variables. Compared with Go, Python `None` is a single object, while Go `nil` is the zero value of pointers, functions, interfaces, slices, channels, maps, and similar types. Java and Go can express "no return value" in function or method signatures. Python expresses "no meaningful return value" through its unified object model and the `None` return object.

In Type Hints, `-> None` expresses that a function has no meaningful return value, while `Optional[T]`, `T | None`, and `Union[T, None]` express that a value may be missing. Because Python runtime does not enforce type annotations, these annotations mainly serve static type checkers, IDEs, and linters. This shows that the design of `NoneType` keeps Python consistent across its object model, function-return semantics, and optional type expression.

## References

[1] Python Documentation. Built-in Constants: None.
[2] Python Documentation. types - Dynamic type creation and names for built-in types: types.NoneType.
[3] Python Documentation. Python/C API Reference Manual: The None Object.
[4] Python Documentation. The Python Language Reference: Data model - Objects, values and types.
[5] Java Language Specification, Chapter 4: Types, Values, and Variables.
[6] Java Language Specification, Chapter 8: Method Declarations - Method Result.
[7] Java Language Specification, Chapter 15: Expressions - Evaluation, Denotation, and Result.
[8] The Go Programming Language Specification: Function types.
[9] The Go Programming Language Specification: The zero value.
[10] The Go Programming Language Specification: Return statements and named result parameters.
[11] Python Documentation. The Python Language Reference: The return statement.
[12] Python Documentation. typing - Support for type hints.
[13] Python Documentation. typing.Optional.
[14] Python Documentation. typing.get_type_hints examples.
