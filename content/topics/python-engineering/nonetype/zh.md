# Python 中 NoneType 的机制设计研究：对象模型、返回值语义与可选类型表达

## 摘要

`None` 是 Python 内置命名空间中的常量对象，用于表示值的缺失。Python 官方文档明确说明，`None` 是 `NoneType` 类型的唯一实例；`types.NoneType` 是 `None` 的类型名；在 Python/C API 中，`Py_None` 表示 Python 的 `None` 对象，并表示 lack of value。Python 语言参考手册同时规定：没有显式返回表达式的 `return` 语句会以 `None` 作为返回值；过程式函数在 Python 中返回 `None`。本文基于 Python 官方数据模型、内置常量、`types`、`typing`、Python/C API，以及 Java Language Specification 和 Go Language Specification，系统说明 `NoneType` 是什么、如何使用，并将其与 Java 的 `null`、Go 的 `nil` 进行比较。文章进一步从静态语言与动态语言的角度解释 Java/Go 可以声明“无返回值”函数，而 Python 函数默认返回 `None` 的机制差异，最后说明 `NoneType` 在 Type Hints 中作为可选类型和类型推导对象的表达方式。

**关键词**：Python；None；NoneType；null；nil；Type Hints；Optional；动态语言；静态语言

## 1 引言

在 Python 中，`None` 经常用于表示“没有值”“未提供值”“没有有意义返回值”或“查找失败”。从语法层面看，`None` 是一个内置常量；从对象模型层面看，它是一个对象；从类型系统层面看，它的类型是 `NoneType`；从函数调用语义看，它是无显式返回值函数的默认返回对象。

与 Java 的 `null` 和 Go 的 `nil` 不同，Python 的 `None` 不是某个引用变量中的空引用，也不是若干引用类类型的零值，而是一个全局唯一的对象。Python 的数据模型规定，Python 程序中的所有数据都由对象或对象之间的关系表示，代码本身也由对象表示。因此，Python 对“值缺失”的表达也落在对象模型之内，而不是落在“无对象”或“无引用”的模型之外。

需要注意的是，“Python 表达式必须有返回值”这一说法若写成绝对命题并不严谨。更精确的规范表述是：Python 语言参考手册规定，`return` 语句没有表达式列表时会替换为 `None`；表达式语句部分也说明，在 Python 中，过程式函数返回 `None`。因此，`NoneType` 的核心地位来自两个事实：第一，Python 数据模型以对象为统一抽象；第二，函数调用即使没有业务意义上的返回值，也会产生一个规范上的返回对象。

## 2 NoneType 的定义

### 2.1 None 是什么

`None` 是 Python 内置常量。官方文档将它定义为经常用于表示 absence of a value 的对象，例如函数默认参数未传入时可以使用 `None` 表示值缺失。官方文档同时说明，对 `None` 赋值是非法操作，并且 `None` 是 `NoneType` 类型的唯一实例 [1]。

```python id="gle1jn"
value = None

print(value is None)       # True
print(type(value))         # <class 'NoneType'>
print(value == None)       # True, but identity check is preferred for singleton values
```

这里的核心事实不是 `None` 看起来像“空”，而是 `None` 本身就是一个对象。它存在于运行时，有身份、有类型、有值。使用 `type(None)` 可以得到它的类型对象：

```python id="pwk0q4"
none_type = type(None)

print(none_type)           # <class 'NoneType'>
print(isinstance(None, none_type))  # True
```

从 Python 3.10 开始，标准库 `types` 模块显式提供 `types.NoneType`，其定义为 `None` 的类型 [2]。

```python id="1jw5b8"
import types

print(types.NoneType)              # <class 'NoneType'>
print(types.NoneType is type(None))  # True
```

### 2.2 None 是单例对象

Python/C API 文档说明，`None` 是 singleton，因此可以通过对象身份进行测试；`Py_None` 表示 Python 的 `None` 对象，用于表示 lack of value，并且该对象没有方法 [3]。在 Python 层，判断一个值是否为 `None` 时，规范化写法是使用身份判断：

```python id="0xviff"
def handle(value):
    # Check for absence of value by identity
    if value is None:
        return "missing"

    return "present"
```

使用 `is None` 的原因是：`None` 的语义不是“与某个值相等”，而是“是否就是那个唯一的 None 对象”。这与 Python 对象模型中的身份概念一致。Python 数据模型规定，每个对象都有 identity、type 和 value，`is` 操作符用于比较两个对象的身份 [4]。

## 3 NoneType 的主要使用方式

### 3.1 表示值缺失

`None` 最常见的用途是表示某个位置没有值。典型场景包括函数参数未传入、查询结果不存在、解析失败或外部资源不可用。

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

在该例中，`dict | None` 表示函数可能返回用户对象，也可能返回 `None`。`None` 不表示空字典，也不表示空字符串，而是单独表示“没有用户对象”。

### 3.2 作为默认参数哨兵

当函数参数的默认值不能使用可变对象时，`None` 常被用作默认哨兵。该用法的目的不是把 `None` 当作业务值，而是把它作为“调用者没有提供参数”的标记。

```python id="bkqy16"
def append_item(item: str, items: list[str] | None = None) -> list[str]:
    # Create a new list when the caller does not provide one
    if items is None:
        items = []

    items.append(item)
    return items
```

该写法能够避免多个函数调用共享同一个默认列表对象。这里的 `None` 表达的是“未提供列表”，而不是“列表为空”。

### 3.3 表示函数没有有意义返回值

Python 中即使函数没有显式 `return` 语句，调用该函数仍会得到 `None`。

```python id="vsokxi"
def log_message(message: str) -> None:
    # Print message and return no meaningful result
    print(message)


result = log_message("hello")
print(result)              # None
print(type(result))        # <class 'NoneType'>
```

从规范角度看，`log_message()` 不是“没有任何返回结果”，而是返回了 `None`。这也是 Python 中过程式函数的统一行为。

### 3.4 显式 `return None`

函数可以显式返回 `None`，以便清晰表达某个分支没有结果。

```python id="ru2he4"
def parse_int(text: str) -> int | None:
    # Return None when parsing fails
    try:
        return int(text)
    except ValueError:
        return None
```

在该例中，`None` 是函数返回域中的合法成员。类型注解 `int | None` 表示返回值可能是 `int`，也可能是 `None`。

## 4 与 Java null 的比较

Java 语言规范将 Java 类型分为 primitive types 和 reference types，同时规定存在一个特殊的 null type。`null` 表达式的类型是 null type；该类型没有名字，因此不能声明 null type 的变量，也不能转换为 null type。`null` reference 是 null type 表达式唯一可能的值，并且可以赋值或转换为任何 reference type [5]。

Java 示例：

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

在 Java 中，`null` 不是一个普通对象。它是引用类型变量可以持有的特殊空引用。Java 变量可以是 primitive type，也可以是 reference type；reference type 变量可以持有 `null` reference 或对象引用 [5]。

```java id="j6hafz"
String name = null;     // Valid: reference type
// int age = null;      // Invalid: primitive type
```

因此，Java 的 `null` 与 Python 的 `None` 有根本差异：

| 比较项        | Python `None`                               | Java `null`       |
| ---------- | ------------------------------------------- | ----------------- |
| 运行时形态      | 一个对象                                        | 特殊空引用             |
| 类型名称       | `NoneType`                                  | null type 无名称     |
| 是否可声明该类型变量 | 可通过 `None`、`type(None)`、`types.NoneType` 表达 | 不能声明 null type 变量 |
| 所属模型       | 统一对象模型                                      | 引用类型系统中的特殊值       |
| 判断方式       | `value is None`                             | `value == null`   |

Java 还具有 `void` 方法结果。Java 语言规范规定，方法声明的结果要么是返回值类型，要么使用 `void` 表示该方法不返回值 [6]。因此，Java 可以在方法签名中明确区分“有返回值”和“无返回值”。

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

对于 `void` 方法，Java 方法调用表达式在需要值的上下文中不能使用。Java 语言规范说明，调用 `void` 方法的表达式 denotes nothing，只能用作表达式语句或特定 lambda body；若 `void` 方法调用出现在需要值的上下文中，会发生编译期错误 [7]。

## 5 与 Go nil 的比较

Go 语言规范规定，未初始化指针的值是 `nil`；未初始化函数类型变量的值也是 `nil`；在零值规则中，指针、函数、接口、切片、channel 和 map 的零值为 `nil` [8][9]。

Go 示例：

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

Go 的 `nil` 不是单一对象类型的唯一实例，而是若干类型族的零值。它可用于指针、函数、接口、切片、channel 和 map，但不能赋给普通数值类型。

```go id="qv241p"
var p *int = nil
var s []int = nil
var m map[string]int = nil

// var n int = nil // Invalid: int zero value is 0, not nil
```

Go 的函数签名也与 Python 不同。Go 函数类型由参数类型和结果类型共同决定；签名中的结果部分是可选的。`func()` 表示没有结果参数的函数类型，`func(x int) int` 表示返回一个 `int` 的函数类型 [8]。

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

Go 没有通过默认返回 `nil` 来表达无返回值函数。若函数签名声明了结果参数，则函数体需要满足返回要求；若函数没有声明结果参数，则调用者不能从该函数调用中取得返回值。

## 6 静态语言与动态语言视角下的返回值差异

### 6.1 Java：方法签名区分 void 与非 void

Java 是静态类型语言，方法声明中必须给出方法结果。该结果要么是具体返回类型，要么是 `void`。因此，Java 的“没有返回值”是方法签名的一部分，并且由编译器检查。

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

以下代码在 Java 中不成立，因为 `void` 方法调用不产生可用于赋值的值：

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

Java 的设计允许“表达式 denotes nothing”。这与 Python 的“过程式函数返回 `None`”形成直接差异。

### 6.2 Go：函数签名可省略结果部分

Go 同样通过函数签名表达返回值。函数签名中的结果部分是可选的。无结果函数不产生返回值；有结果函数必须返回与签名一致的结果。

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

Go 还支持命名结果参数。规范规定，命名结果参数进入函数时会初始化为其类型的零值；空 `return` 会返回这些结果参数的当前值 [10]。

```go id="kxz614"
func split() (left int, right int) {
	// Named result values are initialized to zero values
	left = 1
	right = 2
	return
}
```

因此，Go 的“无返回值”与 `nil` 没有必然绑定。`nil` 是若干类型的零值；无返回值函数则是签名中没有结果参数。

### 6.3 Python：无显式返回表达式时返回 None

Python 的函数定义不在运行时强制声明返回类型。即使函数注解写成 `-> None`，Python 运行时也不会强制检查该注解。Python 语言参考手册规定：如果 `return` 语句有表达式列表，则计算该表达式列表；否则替换为 `None`；`return` 语句使当前函数调用带着表达式列表或 `None` 作为返回值离开 [11]。

```python id="aqlfgz"
def notify(message: str):
    # This function has no explicit return statement
    print(message)


result = notify("done")
print(result is None)      # True
```

该函数在业务语义上“不返回有意义结果”，但在 Python 调用语义上仍返回 `None`。因此，Python 的做法不是在函数签名中引入 `void`，而是在函数调用结果中统一使用 `None` 表示没有有意义结果。

## 7 NoneType 与 Type Hints

### 7.1 `-> None`

当函数没有有意义返回值时，类型注解通常写为 `-> None`。

```python id="2zimnl"
def save_user(name: str) -> None:
    # Save user and return no meaningful value
    print(f"save {name}")
```

Python `typing` 官方文档说明，Python 运行时不会强制执行函数和变量类型注解；这些注解可供第三方类型检查器、IDE、linter 等工具使用 [12]。因此，`-> None` 的主要作用是静态分析和接口表达，而不是运行时强制。

### 7.2 `Optional[T]` 与 `T | None`

`typing.Optional[X]` 等价于 `X | None`，也等价于 `Union[X, None]`。官方文档同时说明，`Optional` 不等同于“有默认值的可选参数”；只有当显式允许 `None` 作为值时，才适合使用 `Optional` [13]。

```python id="g9o8v0"
from typing import Optional


def find_name(user_id: int) -> Optional[str]:
    # Return None when no name can be found
    if user_id <= 0:
        return None

    return "Alice"
```

在 Python 3.10 及以后，更常见的写法是：

```python id="jthqm2"
def find_name(user_id: int) -> str | None:
    # Return None when no name can be found
    if user_id <= 0:
        return None

    return "Alice"
```

这类注解使静态类型检查器能够知道调用者必须处理 `None` 分支：

```python id="wcs9c5"
name = find_name(-1)

if name is not None:
    print(name.upper())
```

### 7.3 `None` 注解与 `NoneType` 推导

`typing.get_type_hints()` 示例显示，当函数返回注解写为 `-> None` 时，解析后的返回类型会显示为 `<class 'NoneType'>` [14]。

```python id="iugpbz"
from typing import get_type_hints


def close() -> None:
    # Close resource and return no meaningful value
    pass


print(get_type_hints(close))
# {'return': <class 'NoneType'>}
```

这说明在类型注解系统中，`None` 不只是一个书写习惯；它会在类型提示解析中对应到 `NoneType`。从静态类型检查角度看，`str | None` 表示返回值空间包含 `str` 与 `NoneType` 两种可能。

## 8 设计讨论：NoneType 的自洽性

Python 的 `NoneType` 机制可以从三个层次理解。

第一，数据模型层。Python 规定所有数据由对象或对象关系表示；`None` 是一个对象，因此“缺失值”也被纳入对象系统，而不是作为对象系统之外的特殊引用状态存在。

第二，函数语义层。Python 没有 Java 那样的 `void` 方法结果，也没有 Go 那样通过函数签名结果部分区分“无结果函数”。Python 通过 `None` 给无显式返回值函数提供统一返回对象。过程式函数在 Python 中返回 `None`，这一点由语言参考手册说明。

第三，类型表达层。Python 的 Type Hints 允许使用 `-> None` 表达无有意义返回值，允许使用 `T | None` 或 `Optional[T]` 表达可缺失值。`get_type_hints()` 能将 `-> None` 解析为 `<class 'NoneType'>`，说明 `None` 在类型提示体系中也对应到明确的类型对象。

因此，`NoneType` 不是简单地复制 Java 的 `null` 或 Go 的 `nil`。Java 的 `null` 是引用类型系统中的特殊空引用；Go 的 `nil` 是若干类型的零值；Python 的 `None` 是唯一的运行时对象，`NoneType` 是该对象的类型。Python 用该机制同时服务于值缺失、默认参数、函数返回语义和可选类型表达。

## 9 结论

`NoneType` 是 Python 对“无值”语义的对象化表达。`None` 是 `NoneType` 的唯一实例，用于表示值缺失；它是内置常量，不能被重新赋值；它是单例对象，适合通过身份判断。Python 函数在没有显式返回表达式时返回 `None`，过程式函数也以 `None` 作为无有意义结果的返回对象。

与 Java 相比，Python 的 `None` 是对象，而 Java 的 `null` 是特殊空引用，null type 没有名称且不能声明变量。与 Go 相比，Python 的 `None` 是单一对象，而 Go 的 `nil` 是指针、函数、接口、切片、channel 和 map 等类型的零值。Java 和 Go 能够在函数或方法签名中表达“无返回值”；Python 则通过统一的对象模型和 `None` 返回对象表达“无有意义返回值”。

在 Type Hints 中，`-> None` 表达函数没有有意义返回值，`Optional[T]`、`T | None` 或 `Union[T, None]` 表达值可以缺失。由于 Python 运行时不强制类型注解，这些注解主要服务于静态类型检查器、IDE 和 linter。由此可见，`NoneType` 的设计使 Python 在对象模型、函数返回语义和可选类型表达之间保持了一致性。

## 参考文献

[1] Python Documentation. Built-in Constants: None.
[2] Python Documentation. types — Dynamic type creation and names for built-in types: types.NoneType.
[3] Python Documentation. Python/C API Reference Manual: The None Object.
[4] Python Documentation. The Python Language Reference: Data model — Objects, values and types.
[5] Java Language Specification, Chapter 4: Types, Values, and Variables.
[6] Java Language Specification, Chapter 8: Method Declarations — Method Result.
[7] Java Language Specification, Chapter 15: Expressions — Evaluation, Denotation, and Result.
[8] The Go Programming Language Specification: Function types.
[9] The Go Programming Language Specification: The zero value.
[10] The Go Programming Language Specification: Return statements and named result parameters.
[11] Python Documentation. The Python Language Reference: The return statement.
[12] Python Documentation. typing — Support for type hints.
[13] Python Documentation. typing.Optional.
[14] Python Documentation. typing.get_type_hints examples.
