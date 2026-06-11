# Sorting Algorithm Research: Definition, Classification, Performance Boundaries, and Default Implementations in Mainstream Languages

## Abstract

Sorting is one of the most fundamental data-processing operations in computer science. Its goal is to rearrange a collection of data according to a predefined order. Sorting algorithms are widely used in retrieval, database queries, pagination, log analytics, leaderboards, deduplication and merging, scheduling priorities, index construction, algorithm preprocessing, and many other scenarios. Different sorting algorithms differ in time complexity, space complexity, stability, whether they sort in place, whether they are suitable for partially ordered data, and whether they are suitable for fixed-range integer keys. Based on the NIST Dictionary of Algorithms and Data Structures, official Java documentation, official Python documentation, and official Go documentation and source code, this article systematically summarizes the definition of sorting, common sorting algorithms, performance boundaries, space usage, and default sorting implementations in Java, Python, and Go. The research conclusion is that there is no sorting algorithm that is fastest for all inputs, all data types, and all runtime environments. Sorting algorithm selection must consider data size, data distribution, key range, stability requirements, memory limits, and language runtime implementation.

**Keywords:** sorting algorithm; stable sort; in-place sort; quicksort; merge sort; TimSort; Dual-Pivot Quicksort; pdqsort

## 1. Introduction

Sorting rearranges data elements according to a comparison rule or key rule. NIST defines sorting as arranging items into a predetermined order. Formally, the output sequence after sorting must satisfy two conditions: first, elements are arranged in the specified order; second, the output sequence must be a permutation of the input sequence, meaning elements cannot be lost, added, or changed. [1]

Sorting is not only used to directly produce ordered lists. It is also frequently used as a preprocessing step for other algorithms and system modules. For example, binary search requires the input sequence to already be sorted. Database `ORDER BY`, pagination, search-result ranking, leaderboards, merging multiple ordered streams, interval statistics, log auditing, and task-priority scheduling all depend on sorting or ordered structures. Sorting is therefore both a foundational problem in algorithm courses and a foundational component in engineering systems.

## 2. Basic Concepts of Sorting

### 2.1 Orderedness

Sorting first depends on a deterministic order relation. For numeric types, common orders are ascending and descending order. For strings, the common order is lexicographic order. For objects, the order is usually defined by a comparator or key function. As long as the comparison rule is deterministic, the goal of the sorting algorithm is to make every adjacent element in the output sequence satisfy that rule.

### 2.2 Stability

A stable sorting algorithm means that if two elements have equal sort keys, their relative order after sorting remains the same as before sorting. NIST defines stable as a sorting algorithm preserving the original order of elements that compare equal. [2]

Stability has practical value in multi-field sorting. For example, if data is first sorted by name and then by department, and the second sort is stable, then records within the same department still preserve the order produced by the previous name sort. Python's `list.sort()` and `sorted()` explicitly guarantee stability. Java object-array sorting and `Collections.sort` also explicitly require stability. Go's `sort.Sort` and `sort.Slice` do not guarantee stability by default, so `sort.Stable`, `sort.SliceStable`, or `slices.SortStableFunc` must be used explicitly. [5][6][7]

### 2.3 In-Place Sorting and Auxiliary Space

In-place sorting usually means that the sorting process uses only constant-level or very small additional auxiliary space. Insertion sort, selection sort, bubble sort, and common quicksort implementations can be completed in place. Merge sort, TimSort, counting sort, and radix sort usually require additional arrays, buffers, or bucket structures. Space consumption depends on the concrete implementation, so "most space-saving" cannot be discussed without implementation context.

### 2.4 Comparison Sorts and Non-Comparison Sorts

Comparison sorting determines order by comparing two elements. Typical algorithms include bubble sort, insertion sort, selection sort, quicksort, heap sort, merge sort, and TimSort. Non-comparison sorting does not fully rely on pairwise element comparisons. Instead, it uses the structure or range of keys. Typical algorithms include counting sort, bucket sort, and radix sort. Counting sort is suitable when the number of distinct key values is small relative to the number of elements. Radix sort processes different parts of keys through multiple distribution and collection rounds. [3]

## 3. Application Scenarios

Sorting application scenarios can be summarized as follows.

First, retrieval preprocessing. Binary search, range queries, and ordered-set retrieval usually require input data to already be sorted. Java `Collections.binarySearch` documentation explicitly requires the list to be sorted in ascending order according to the corresponding rule before calling; otherwise, the result is undefined. [5]

Second, display ordering. Admin systems, transaction flows, log platforms, search results, leaderboards, and reporting systems usually need sorting by time, score, weight, price, priority, or business fields.

Third, data processing. Deduplication, merging, grouping, Top-K, interval statistics, batch processing, and data cleaning often sort first and then perform a linear scan, reducing the complexity of later processing.

Fourth, system scheduling. Task scheduling, priority queues, rate-limiting windows, delayed tasks, and cache eviction strategies usually depend on ordered structures or partial sorting.

Fifth, algorithm construction. Many algorithms use sorting as a preprocessing step, such as greedy algorithms, sweep-line algorithms, minimum spanning tree algorithms, interval merging, discretization, and two-pointer algorithms.

## 4. Classification of Common Sorting Algorithms

### 4.1 Simple Quadratic Sorting Algorithms

Bubble sort repeatedly compares adjacent elements and swaps inverted pairs. NIST documentation explains that bubble sort is an in-place stable sort. It has O(n²) complexity on arbitrary data and can approach Θ(n) on nearly sorted data. [3]

Insertion sort repeatedly takes the next element and inserts it into the already sorted prefix. NIST documentation explains that insertion sort usually takes O(n²) time but can be done in place. [3] Insertion sort is often used for small arrays or as a subroutine in hybrid sorting algorithms.

Selection sort selects the smallest element from the unsorted portion in each round and places it in its final position. NIST documentation explains that selection sort has Θ(n²) time complexity, O(n) swaps, and can be implemented in place. Swap-based selection sort implementations are not stable. [3]

### 4.2 Quicksort and Its Variants

Quicksort selects a pivot, partitions data into elements smaller than and greater than the pivot, and then recursively processes the subsequences. NIST documentation explains that quicksort is usually an in-place sort, has Θ(n²) worst-case time complexity, and is O(n log n) in typical cases. The documentation also notes that tuned quicksort implementations can often outperform many algorithms with O(n log n) worst-case complexity in practice. [3]

Java uses Dual-Pivot Quicksort for primitive arrays. Oracle JDK documentation explains that the algorithm was provided by Vladimir Yaroslavskiy, Jon Bentley, and Joshua Bloch, offers O(n log n) performance on all datasets, and is typically faster than traditional one-pivot quicksort. [4]

In the current Go standard library source code, the ordered-element path of `slices.Sort` uses `pdqsortOrdered`. Its implementation includes insertion sort for small partitions, heap sort fallback for bad pivot cases, pattern breaking, and partially sorted data detection. [7]

### 4.3 Merge Sort and TimSort

Merge sort recursively or iteratively splits a sequence into subsequences, sorts them separately, and then merges them. Merge sort is usually stable, but it requires extra buffer space.

TimSort is a stable, adaptive hybrid sorting algorithm originally designed by Tim Peters for Python list sorting. Java object-array sorting documentation explains that its object-array sort implementation is a stable, adaptive, iterative merge sort adapted from Tim Peters's Python list sort. This implementation can reduce comparisons for partially sorted arrays, provides traditional merge-sort performance on random arrays, and uses temporary space ranging from small constant space for nearly sorted arrays to n/2 object references for random arrays. [4]

Python official documentation explicitly guarantees that `list.sort()` and `sorted()` are stable. Python official change notes also state that `list.sort()` and `sorted()` use TimSort. [6]

### 4.4 Heap Sort

Heap sort uses a heap structure to maintain the current maximum or minimum element and completes sorting by repeatedly extracting the heap top. Its typical characteristics are O(n log n) worst-case time complexity and in-place implementation. It is usually not stable. Go's `pdqsortOrdered` falls back to `heapSortOrdered` when there are too many bad pivots, showing the use of heap sort as a worst-case fallback strategy in standard-library implementations. [7]

### 4.5 Counting Sort, Bucket Sort, and Radix Sort

Counting sort counts the number of occurrences of each key and then determines element positions through prefix counts. NIST documentation explains that counting sort is suitable when the number of different key values is small relative to the number of elements. [3]

Radix sort completes sorting through multiple rounds of distribution and collection according to parts of the key. NIST documentation explains that radix sort can start from the least significant part, distribute elements into buckets in each round, collect them while preserving order, and then continue with more significant parts. [3]

Bucket sort distributes elements into multiple buckets, sorts elements within each bucket, and then merges the buckets. Bucket sort efficiency depends on data distribution, bucket count, and the sorting method used within buckets. For data with clear key structures such as integers, fixed-length strings, and fixed-range enum values, non-comparison sorting may achieve lower time complexity than general comparison sorting, but it usually requires extra space.

## 5. Which Sorting Algorithm Is Fastest?

There is no sorting algorithm that is fastest for all inputs, all data types, all stability requirements, and all hardware environments. NIST's description of sorting algorithm selection factors states that algorithm choice depends on element count, available working memory, the degree to which data is already ordered, key range, comparison cost, movement cost, and other factors. [1]

For ordinary comparison sorting, quicksort and its variants usually have strong practical performance. Java primitive arrays use Dual-Pivot Quicksort. The current Go `slices.Sort` source code uses a pdqsort-style implementation and handles small arrays, partially ordered data, and bad pivot cases separately. [4][7]

For object sorting or scenarios that require stability, TimSort or stable merge sort is more common. Java object arrays use stable, adaptive, iterative merge sort. Python's `list.sort()` and `sorted()` use TimSort and guarantee stability. [4][6]

When the key range is small or the key structure is clear, counting sort, bucket sort, and radix sort may be faster than comparison sorting. The precondition is that the key-value range, bucket count, or digit structure makes the extra space and multi-round distribution cost lower than the comparison sorting cost. [3]

For large arrays with multicore resources, Java `Arrays.parallelSort` uses a parallel sort-merge algorithm, splits the array into subarrays, sorts them, and then merges them. It requires working space no larger than the original array. [4]

Therefore, "fastest sorting algorithm" can only be defined under constraints. For Java primitive arrays, the official default implementation is Dual-Pivot Quicksort. For Python lists, the official implementation uses TimSort. For the current Go slices sorting path, the source code uses a pdqsort-style implementation. For small-range integer keys, counting sort or radix sort may be more suitable. In engineering, the default sorting implementation of the language standard library should be used as the baseline, and replacement should be decided based on real data distribution and performance tests.

## 6. Which Sorting Algorithm Saves the Most Space?

If only auxiliary space is considered, in-place sorting algorithms save the most space. Insertion sort, selection sort, and bubble sort can all be implemented in place, but their time complexity on general input is usually O(n²), making them unsuitable as default choices for large-scale general sorting. [3]

For general comparison sorting, heap sort is a typical representative when both O(n log n) worst-case time complexity and low auxiliary space are considered. Quicksort is also usually in-place, but recursive calls create stack space, and unprotected implementations have O(n²) worst-case time complexity. Merge sort and TimSort usually require additional buffer space. Java object-array sorting documentation states that temporary space may range from a small constant to n/2 object references. [4]

Counting sort, bucket sort, and radix sort rely on count arrays, buckets, or auxiliary arrays. Space consumption depends on key range, bucket count, digit count, and implementation. Therefore, they are not the most space-saving category of sorting algorithms, but under suitable data conditions they can trade space for lower time cost.

Therefore, if the question only asks "which saves the most auxiliary space," the answer is in-place sorting. If the requirement also includes large-scale general sorting and stable O(n log n)-level time, heap sort is a typical low-space comparison sort. If a language standard library is used, the official sorting implementation of that language should be treated as the baseline, because standard libraries usually balance speed, stability, space, and input distribution.

## 7. Default Sorting Implementations in Java, Python, and Go

### 7.1 Java

The Java standard library has several sorting entry points.

First, `Arrays.sort` uses Dual-Pivot Quicksort for primitive arrays. Oracle official documentation clearly states that the algorithm was provided by Vladimir Yaroslavskiy, Jon Bentley, and Joshua Bloch, offers O(n log n) performance on all datasets, and is usually faster than traditional one-pivot quicksort. [4]

Second, `Arrays.sort(Object[])` requires stable sorting for object arrays. Oracle official documentation explains that its implementation is a stable, adaptive, iterative merge sort adapted from Tim Peters's Python list sort. This implementation reduces comparisons on partially sorted input and provides traditional merge-sort performance on random input. [4]

Third, `Collections.sort(List)` explicitly guarantees stability, and current documentation explains that its implementation delegates to `List.sort(null)`; the comparator overload delegates to `List.sort(c)`. [5]

Fourth, `Arrays.parallelSort` uses a parallel sort-merge algorithm, splitting the array into subarrays, sorting them, and then merging them. Its working space does not exceed the size of the original array or specified range. [4]

It is important to note that Oracle documentation also explains that "implementation notes" are not part of the specification. As long as specification requirements are satisfied, implementations may replace algorithms. For example, object-array sorting does not have to always use a specific merge-sort implementation, but it must satisfy the stability requirement. [4]

### 7.2 Python

Python provides two main sorting entry points: `list.sort()` and the built-in function `sorted()`. `list.sort()` modifies the list in place; `sorted()` accepts any iterable and returns a new sorted list. Python official documentation clearly states that both sorts are stable. [6]

Python official documentation also notes that Python's sorting implementation uses TimSort. TimSort identifies existing ordered runs and merges them, making it suitable for real-world data that contains partially ordered structure. Because Python documents sorting stability as a guarantee, multi-key sorting can be implemented through multiple stable sorts or a key function. [6]

### 7.3 Go

Go provides the `sort` package and the newer `slices` package.

The `sort.Sort` documentation states that it performs O(n log n) calls to `Less` and `Swap` and does not guarantee stability. `sort.Slice` also does not guarantee stability. If stable sorting is required, `sort.Stable` or `sort.SliceStable` must be used. `sort.Stable` preserves the original order of equal elements. [7]

Starting with Go 1.22, functions such as `sort.Ints`, `sort.Float64s`, and `sort.Strings` call `slices.Sort`. `slices.Sort` sorts slices of ordered types. `slices.SortFunc` does not guarantee stability. `slices.SortStableFunc` guarantees that equal elements keep their original order. [7]

From the current Go standard library source code, the ordered-type sorting path of `slices.Sort` calls `pdqsortOrdered`. This implementation uses insertion sort for small partitions, falls back to heap sort when there are too many bad pivots, and performs partial insertion sort detection for data that may already be ordered. Therefore, Go's current default unstable sorting implementation is a pdqsort-style hybrid implementation. [7]

## 8. Comparison Summary

| Dimension | Objective Conclusion |
| --- | --- |
| Sorting definition | Arrange elements into a predetermined order; the output must be ordered and a permutation of the input |
| Common algorithms | Bubble, insertion, selection, quicksort, heap sort, merge sort, TimSort, counting, bucket, radix, and others |
| Global fastest algorithm | None; depends on data size, distribution, key range, stability, memory, and implementation |
| Common practical speed candidates | Quicksort variants, TimSort, pdqsort, parallel sorting, counting/radix sorting |
| Most space-saving | In-place sorting uses the least auxiliary space; heap sort is a typical representative when also considering general O(n log n) worst-case time |
| Java default sorting | Primitive arrays: Dual-Pivot Quicksort; object arrays/List: stable adaptive merge sort / TimSort style; parallelSort: parallel sort-merge |
| Python default sorting | `list.sort()` and `sorted()` use TimSort and guarantee stability |
| Go default sorting | `sort.Sort` and `sort.Slice` are unstable; stable sort must be called explicitly; current `slices.Sort` source path uses a pdqsort-style implementation |

## 9. Engineering Usage Principles

First, ordinary business development should prefer language standard-library sorting. Java, Python, and Go standard libraries have already chosen default implementations based on data type, stability, and runtime characteristics.

Second, stability requirements must be confirmed explicitly through API semantics. Python is stable by default. Java object arrays and List sorting are stable. Go's default `sort.Sort` and `sort.Slice` are unstable, so stable sorting APIs must be used.

Third, when data size is small or data is nearly sorted, insertion sort or the insertion-sort phase of a hybrid algorithm has practical value, but ordinary business code should not handwrite it to replace the standard library.

Fourth, when the key range is small and the type is clear, counting sort, bucket sort, or radix sort can be considered. These algorithms trade extra space for lower time cost.

Fifth, when memory limits are strict, pay attention to auxiliary space used by the sorting implementation. Merge sort, TimSort, counting sort, and radix sort usually require extra space; in-place sorting saves more space.

Sixth, if large-scale data sorting exceeds memory capacity, use external sorting, database sorting, search-engine sorting, or distributed computing frameworks instead of sorting directly in single-process memory.

## 10. Conclusion

There is no single optimal sorting algorithm. Sorting algorithm selection is jointly determined by data size, data distribution, key space, stability requirements, space limits, and language runtime implementation. Quicksort and its variants have strong practical performance in general in-memory sorting. TimSort is suitable for object sorting and partially ordered data and provides stability. Counting sort and radix sort are suitable for data with constrained key ranges or key structures. Heap sort is representative in low auxiliary space and O(n log n) worst-case time.

In mainstream language implementations, Java uses Dual-Pivot Quicksort for primitive arrays and provides stable sorting for object arrays and Lists. Python's `list.sort()` and `sorted()` use stable TimSort. Go's default unstable sorting currently uses a pdqsort-style implementation in source code and provides explicit stable sorting APIs. In engineering practice, standard-library sorting should be the default. Specialized sorting algorithms or replacement implementations are only needed when stability, space, key range, or data scale imposes special requirements.

## References

[1] NIST Dictionary of Algorithms and Data Structures: definition of `sort`, formal conditions, algorithm list, and sorting algorithm selection factors. ([XLinux][1])

[2] NIST definition of `stable`: stable sorting preserves the original relative order of elements with equal keys. ([XLinux][2])

[3] NIST definitions, complexity, or applicability notes for quicksort, insertion sort, selection sort, bubble sort, counting sort, and radix sort. ([XLinux][3])

[4] Oracle Java `Arrays` official documentation: primitive arrays use Dual-Pivot Quicksort; object-array sorting is stable, adaptive, iterative merge sort adapted from Tim Peters's Python list sort; `parallelSort` uses parallel sort-merge; implementation notes are not the specification itself. ([Oracle Documentation][4])

[5] Oracle Java `Collections.sort` official documentation: sorting is stable and delegates to `List.sort`; `binarySearch` requires the list to be sorted in ascending order under the corresponding rule. ([Oracle Documentation][5])

[6] Python official documentation: `list.sort()` sorts in place, `sorted()` returns a new list; both guarantee stability; Python sorting uses TimSort. ([Python documentation][6])

[7] Official Go `sort` and `slices` documentation and source code: `sort.Sort` and `sort.Slice` do not guarantee stability; stable sorting requires Stable APIs; starting with Go 1.22 some `sort` functions call `slices.Sort`; the current ordered-type sorting path in source uses `pdqsortOrdered` and includes insertion sort and heap sort fallback. ([pkg.go.dev][7])

[1]: https://xlinux.nist.gov/dads/HTML/sort.html "sort"
[2]: https://xlinux.nist.gov/dads/HTML/stable.html "stable"
[3]: https://xlinux.nist.gov/dads/HTML/quicksort.html "quicksort"
[4]: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html "Arrays (Java SE 25 & JDK 25)"
[5]: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html "Collections (Java SE 25 & JDK 25)"
[6]: https://docs.python.org/3/library/stdtypes.html?utm_source=chatgpt.com "Built-in Types - Python 3.14.5 documentation"
[7]: https://pkg.go.dev/sort "sort package - sort - Go Packages"
