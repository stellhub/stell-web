## Abstract

The data-access path in Linux is built from process virtual address spaces, page tables, physical pages, the page cache, file descriptors, VFS, block devices, and the network protocol stack. Applications see virtual addresses and file descriptors; the CPU translates virtual addresses into physical addresses through the MMU and page tables; the kernel uses `task_struct` to connect a process to its address space, file table, and filesystem context. File data usually enters the page cache before being read by user space or transmitted directly by the kernel. The official Linux documentation explains that page tables map CPU-visible virtual addresses to physical addresses visible on the external memory bus; the VFS documentation explains that `address_space` organizes and manages pages in the page cache and tracks mappings from file ranges into process address spaces. ([Linux Kernel Documentation][1])

This article studies how data is loaded, accessed, and transferred in Linux. It explains the mapping between virtual memory and physical memory, analyzes key structures such as `task_struct`, `mm_struct`, `files_struct`, and `address_space`, and compares traditional file copying with three zero-copy implementations: Direct Memory, `sendfile`, and `mmap + write`.

## 1. Introduction

Linux processes do not directly operate on physical memory addresses and do not directly manage disk blocks. A process accesses memory through virtual addresses and accesses files, sockets, pipes, and other kernel objects through file descriptors. The Linux memory-management documentation points out that physical memory is limited and may be non-contiguous, and different CPU architectures may have different views of the physical address range; therefore, virtual memory is used to hide the complexity of directly handling physical memory. ([Linux Kernel Documentation][2])

From the application perspective, data access usually appears as reading a file, writing a file, accessing mapped memory, or sending network data through a socket. From the kernel perspective, these operations eventually land on address-space management, page-table translation, page-cache lookup, VFS file objects, device I/O, or the network protocol stack. The Linux VFS documentation explains that `address_space` sits between storage and applications: data is read into an address space in page-sized units and is then provided to applications through copying or memory mapping; writes also enter the address space first and are later written back to storage. ([Linux Kernel Documentation][3])

## 2. How Data Is Loaded, Accessed, and Transferred

Data loading in Linux can be divided into two main paths: the memory-access path and the file-I/O path.

The memory-access path is initiated by the CPU. When program instructions access a virtual address, the CPU's MMU uses page tables to translate the virtual address into a physical address. If the TLB hits, translation completes directly; if it misses, the CPU performs a page-table walk; if the page-table entry does not exist or permissions are insufficient, a page fault or access exception occurs. The Linux page-table documentation clearly states that page tables map CPU-visible virtual addresses to physical addresses visible on the external memory bus, and Linux currently defines a five-level page-table hierarchy, with architecture code mapping it to concrete hardware limits. ([Linux Kernel Documentation][1])

The file-I/O path is initiated by system calls. When an application calls `read(fd, buf, count)`, the kernel resolves file descriptor `fd` into a `struct file`, enters the concrete filesystem through VFS, looks up the target file page in the page cache, reads from the block device and fills the page cache if the page is absent, and finally copies data from the page cache into the user-space `buf`. The official `read(2)` manual defines the semantics of reading up to `count` bytes from a file descriptor into a user buffer. ([man7.org][4])

The write path is the reverse of the read path. When an application calls `write(fd, buf, count)`, the kernel copies data from the user buffer into kernel-side cache structures, usually marks the corresponding page dirty, and later writes it to the underlying storage through writeback. The official `write(2)` manual defines the semantics of writing up to `count` bytes from a user buffer to a file descriptor; the VFS documentation explains that when data is written to a page, the dirty flag should be set, and the dirty state usually lasts until `writepages` requests writeback. ([man7.org][5])

The network-transfer path can be combined with the file-I/O path. Traditional file sending is usually `read(file) -> write(socket)`. Zero-copy sending can use `sendfile(out_fd, in_fd, offset, count)` to transfer data between file descriptors in the kernel. The official `sendfile(2)` manual states that it copies data between two file descriptors, and because the copy happens in the kernel, it is more efficient than `read(2)` plus `write(2)`, which requires data transfer between user space and kernel space. ([man7.org][6])

## 3. Mapping between Virtual Memory and Physical Memory

The basic fact about virtual memory is that a process sees continuous or nearly continuous virtual address ranges, while physical memory may consist of non-contiguous physical page frames. The Linux page-table documentation explains that the physical page corresponding to a physical address is usually represented by a PFN, which is the physical address divided by `PAGE_SIZE`; with 4 KB pages, the page base address uses the high-order bits of the address, `PAGE_SHIFT` is usually 12, and `PAGE_SIZE` is usually defined as `1 << PAGE_SHIFT`. ([Linux Kernel Documentation][1])

The mapping relationship can be abstracted as:

```text
Process virtual address
        |
        |  MMU + page table walk
        v
Page table entry
        |
        |  PFN + page offset
        v
Physical page frame
        |
        v
DRAM / device memory / file-backed page cache page
```

This mapping is not established for the entire address space all at once. Process startup, `mmap`, heap expansion, stack growth, and similar operations create or modify virtual memory areas. When a process actually accesses a virtual address whose physical mapping has not yet been established, the CPU raises a page fault; the kernel then uses `mm_struct` and `vm_area_struct` to decide whether the address is valid and either allocates an anonymous page, reads a file page, or creates a page-table entry. The Linux memory-management API documentation describes `vma_lookup(mm, addr)` as a function that finds the `vm_area_struct` containing a specified user address in a process address space, which corresponds to locating a VMA during page-fault handling. ([Linux Kernel Archives][7])

In file-mapping scenarios, virtual addresses can map directly to file page-cache pages. The official `mmap(2)` manual states that the contents of a file mapping are initialized from `length` bytes starting at `offset` in the file referenced by file descriptor `fd`; `offset` must be a multiple of the page size; updates to `MAP_SHARED` mappings are visible to other processes mapping the same region and are written back to the underlying file, while `MAP_PRIVATE` creates a private copy-on-write mapping. ([man7.org][8])

## 4. Example of Data Stored in task_struct

The basic schedulable entity in Linux is a task. Linux Kernel Labs explains that Linux uses `struct task_struct` to represent both threads and processes; resources are not all embedded in `task_struct`, but referenced through pointers to resource structures, so threads in the same process can point to the same resource-structure instances. ([Linux Kernel Labs][9])

The fields related to data access can be abstracted as:

```c
struct task_struct {
    // Memory descriptor of the process address space.
    struct mm_struct *mm;

    // Active memory descriptor, also used for kernel threads.
    struct mm_struct *active_mm;

    // File descriptor table of this task or thread group.
    struct files_struct *files;

    // Filesystem context, such as root and current working directory.
    struct fs_struct *fs;
};
```

The mainline Linux source file `include/linux/sched.h` contains the `struct mm_struct *mm` and `struct mm_struct *active_mm` fields in `task_struct`; Linux Kernel Labs also states that opening files requires access to the file field of `task_struct`, and mapping new files requires access to the mm field of `task_struct`. ([GitHub][10])

From the data-access perspective, `task_struct` is not where file contents or page contents are stored directly. It stores entry points to resource descriptors: `mm` enters the process virtual address space, `files` enters the file-descriptor table, and `fs` enters the filesystem context. When threads share a file table or address space, multiple `task_struct`s point to the same `files_struct` or `mm_struct`; Linux Kernel Labs explains in the semantics of `clone()` that `CLONE_FILES` shares the file-descriptor table, `CLONE_VM` shares the address space, and `CLONE_FS` shares filesystem information. ([Linux Kernel Labs][9])

## 5. What mm_struct, files_struct, and struct file Store

`mm_struct` represents a process's user-space address space. It usually relates to the VMA collection, page-table root, address-space boundaries, reference counts, locks, statistics, and other data. The Linux memory-management API documentation describes the `mm_struct` parameter as "the process address space" and provides `vma_lookup(mm, addr)` to find a VMA in that address space. ([Linux Kernel Archives][7])

Its role can be expressed with this simplified structure:

```c
struct mm_struct {
    // Root of the process page table hierarchy.
    pgd_t *pgd;

    // Virtual memory areas, such as code, heap, stack, mmap regions.
    struct maple_tree mm_mt;

    // Address space lock used by memory management operations.
    struct rw_semaphore mmap_lock;

    // Common process memory layout boundaries.
    unsigned long start_code, end_code;
    unsigned long start_data, end_data;
    unsigned long start_brk, brk;
    unsigned long start_stack;
};
```

`files_struct` represents the file-descriptor table seen by a process or thread group. Linux Kernel Labs explains that `CLONE_FILES` makes a new task share the file-descriptor table with its parent task; this means the file-descriptor table is a shareable process resource rather than an object necessarily owned by each task. ([Linux Kernel Labs][9])

It can be expressed as:

```c
struct files_struct {
    // Reference count for sharing between tasks.
    atomic_t count;

    // File descriptor table.
    struct fdtable *fdt;

    // Lock protecting file table updates.
    spinlock_t file_lock;
};

struct fdtable {
    // Maximum number of file descriptors.
    unsigned int max_fds;

    // Array indexed by fd, each entry points to struct file.
    struct file **fd;
};
```

`struct file` is the kernel's opened-file object and is not the same as an inode on disk. It stores the current open instance's offset, access mode, file-operation table, path, inode mapping relationship, and other state. The VFS documentation explains that writeback error tracking related to file descriptors records errors in `struct file`'s error cursor; the same file can have multiple open file descriptions, and each open description can have its own state. ([Linux Kernel Documentation][3])

It can be expressed as:

```c
struct file {
    // Current file position.
    loff_t f_pos;

    // Access mode and status flags.
    fmode_t f_mode;
    unsigned int f_flags;

    // File operations, such as read_iter and write_iter.
    const struct file_operations *f_op;

    // Path and inode-related mapping.
    struct path f_path;
    struct address_space *f_mapping;

    // Private data used by drivers or filesystems.
    void *private_data;
};
```

File contents themselves are not stored in `struct file`. Data pages of ordinary files are managed by the inode's `address_space` and connected to underlying storage through the page cache, writeback, and filesystem block mapping. The VFS documentation explicitly states that `address_space` organizes and manages pages in the page cache and tracks mappings from file ranges into process address spaces. ([Linux Kernel Documentation][3])

## 6. Page Cache and Finding Data Pages through the MMU

The page cache is Linux's in-memory mechanism for caching file data pages. The VFS documentation describes `address_space` as the object used to organize and manage page-cache pages. It can track pages belonging to a file or another object, track mappings from file ranges into process address spaces, and provide services such as memory-pressure communication, page lookup by address, and tracking dirty or writeback pages. ([Linux Kernel Documentation][3])

In modern Linux, the page cache is commonly represented through `address_space`, `xarray`, `folio`, or `struct page`. The VFS documentation explains that pages are usually stored by `->index` in a radix tree and maintain dirty and writeback tags; current kernel implementations have evolved toward XArray/folio, but the abstract semantics remain a mapping from file offsets to cached pages. ([Linux Kernel Documentation][3])

There are two cases when finding data pages through the MMU.

The first case is user-space access to an already mapped virtual address. The CPU uses the virtual address to look up the TLB; if the TLB misses, it walks the page-table hierarchy to find the PTE; the PTE contains the PFN and permission bits; the physical address is finally obtained from the PFN plus the page offset. The Linux page-table documentation explains that page tables map virtual addresses to physical addresses, and PFN is the physical address divided by `PAGE_SIZE`. ([Linux Kernel Documentation][1])

The second case is user-space access to a file-mapped address whose page-table entry has not been established. A page fault occurs. The kernel uses `mm_struct` to find the VMA. If the VMA is file-backed, the kernel uses the corresponding file and `address_space` to look up the page cache. If the page cache hits, it creates a PTE pointing to that physical page; if it misses, the kernel reads data from the underlying filesystem and block device into the page cache, then establishes the mapping. The VFS documentation explains that after data is read into an address space, it can be provided to applications through copying or memory mapping. ([Linux Kernel Documentation][3])

## 7. Page Faults and When They Occur

A page fault is an exception triggered when the CPU accesses a virtual address and the page-table entry is missing, permissions are insufficient, or a special memory-management action is required. It does not necessarily indicate a program error. Legal page faults are part of Linux mechanisms such as demand paging, file mapping, anonymous-page allocation, and copy-on-write; illegal page faults may lead to `SIGSEGV`. The Linux memory-management API documentation for `vma_lookup(mm, addr)` shows that the kernel can find a VMA from a user address; if no VMA is found or permissions do not match, the access cannot be resolved as a valid mapping. ([Linux Kernel Archives][7])

Page faults commonly occur in the following scenarios.

First, the initial access to anonymous memory. Heap memory, stack-growth regions, or anonymous `mmap` regions may already exist in the virtual address space, but no physical page has been allocated yet. On first write, the kernel allocates a physical page and creates a page-table entry.

Second, the initial access to a file mapping. After a file is mapped with `mmap`, its contents are not necessarily read into memory immediately. When a page is accessed, the kernel uses the file offset to look up the page cache, reads from disk if necessary, and creates the mapping. The `mmap(2)` documentation states that file-mapping contents are initialized from the file referenced by the file descriptor, which provides the system-call semantic basis for on-demand mapping of file pages. ([man7.org][8])

Third, copy-on-write. After `fork()`, parent and child processes can share read-only page-table entries. When either side writes to a shared page, the CPU raises an exception due to write permissions, and the kernel copies the physical page and updates the page-table entry.

Fourth, pages may be swapped out or mappings reclaimed. When an evicted page is accessed, the kernel needs to restore data from swap or backing storage and then restore the mapping.

Fifth, permission exceptions may occur, such as writing to a read-only mapping, executing a non-executable page, or accessing an unmapped address. If the kernel cannot repair the exception, it sends a signal to the process.

## 8. Page-Cache Size, Properties, and Source Structures

The page cache does not have a fixed global static size. It uses available system memory to cache file data and, under memory pressure, releases clean pages or triggers writeback for dirty pages. The Linux memory-management documentation explains that Linux memory management includes reclaim, OOM, compaction, the page cache, and other mechanisms; the VFS documentation explains that the VM can release clean pages for memory reuse, while dirty pages usually need writeback first. ([Linux Kernel Documentation][11])

Basic page-cache properties include:

| Property | Meaning |
| --- | --- |
| File ownership | Page-cache pages belong to an `address_space`, usually corresponding to an inode. |
| Index | File offsets are converted to page indexes, for example `index = offset / PAGE_SIZE`. |
| State | A page or folio may have states such as uptodate, dirty, writeback, locked, and referenced. |
| References | A page can be referenced by page tables, the page cache, LRU lists, filesystem-private data, pipes, direct I/O, and more. |
| Reclaim | Clean pages can be released; dirty pages usually need to be written back before release. |
| Mapping | File pages can be copied to user buffers or mapped into process address spaces through `mmap`. |

The Linux memory-management API documentation explains that a folio's reference count may come from page tables, the page cache, filesystem-private data, LRU lists, pipes, direct I/O, and other sources. This shows that a page-cache page is not only filesystem cache; it may also be referenced by process page tables or I/O paths. ([Linux Kernel Archives][7])

At the source level, the core structures can be simplified as:

```c
struct address_space {
    // Owner inode or block device.
    struct inode *host;

    // Cached pages indexed by file offset.
    struct xarray i_pages;

    // Lock for page cache invalidation and coherency.
    struct rw_semaphore invalidate_lock;

    // Filesystem-specific address space operations.
    const struct address_space_operations *a_ops;
};

struct folio {
    // Page flags, reference count, mapping and index are conceptually stored here.
    unsigned long flags;
    struct address_space *mapping;
    pgoff_t index;
};
```

The VFS documentation defines `address_space` as the contents of a cacheable, mappable object and states that it can be used for page-cache management, dirty/writeback tracking, page lookup, and maintaining file-mapping relationships. Mainline Linux source search results also show that `struct address_space` in `include/linux/fs.h` is commented as "Contents of a cacheable, mappable object" and includes fields such as owner, cached pages, and invalidate lock. ([Linux Kernel Documentation][3])

## 9. Traditional File-Copy Data Path

Traditional file copy usually means that an application uses `read` to read data from a file into a user-space buffer and then uses `write` to write it to a socket or destination file. For "sending a file to a network socket", the typical path is:

```text
Disk / storage
   -> kernel page cache
   -> user-space byte[] / buffer
   -> kernel socket buffer
   -> NIC / network
```

If the file page is not in the page cache, the kernel first reads it from disk into the page cache. Then `read()` copies the page-cache contents into a user-space buffer. The application then calls `write()`, and the kernel copies the user-space buffer into the socket send buffer. Finally, the network protocol stack and NIC driver send the data. The `sendfile(2)` manual uses exactly the contrast with `read(2)` plus `write(2)`, which requires data transfer between user space and kernel space, to explain why `sendfile()` is more efficient when copying happens in the kernel. ([man7.org][6])

The traditional path contains at least two types of cost:

1. Data copies between user space and kernel space.
2. Two system calls, `read` and `write`, plus their context switches.

In Java, a traditional implementation usually looks like this:

```java
try (InputStream in = new BufferedInputStream(new FileInputStream(file));
     OutputStream out = socket.getOutputStream()) {
    byte[] buffer = new byte[64 * 1024];
    int n;
    while ((n = in.read(buffer)) >= 0) {
        // Copy data from the Java heap buffer to the socket output stream.
        out.write(buffer, 0, n);
    }
}
```

The `byte[]` in this path resides in the Java heap. The kernel cannot directly set a Java heap object as the DMA data source for the NIC, so network I/O usually requires additional native memory or kernel buffers.

## 10. Three Zero-Copy Implementations

Zero copy is not a single technology, and it does not mean "absolutely no copy at all". In engineering contexts, it usually means reducing data copies between user space and kernel space, or avoiding explicit movement of large data blocks by application code. This article follows the three mechanisms specified here: Direct Memory, `sendfile`, and `mmap + write`.

### 10.1 User-Space Direct Memory

Direct Memory refers to off-heap memory used by Java `DirectByteBuffer` or Netty direct `ByteBuf`. Netty documentation explains that `ByteBufAllocator.ioBuffer()` preferably allocates direct buffers suitable for I/O, and `ByteBufAllocator.directBuffer()` allocates direct `ByteBuf`s. ([netty.io][12])

The key fact about Direct Memory is that it reduces intermediate copying between Java heap memory and native I/O memory, and reduces the impact of GC moving objects on I/O buffers. It is a user-space memory-organization optimization, not the same as a kernel-level file-transfer optimization such as Linux `sendfile`, where file page-cache pages enter the socket send path directly. Netty's `Unpooled.wrappedBuffer(...)` and composite-buffer APIs also support combining multiple buffers into one logical buffer. The official API states that `wrappedBuffer(ByteBuf...)` can create a composite buffer that wraps the specified readable bytes without copying those buffers. ([netty.io][12])

Example of direct-memory sending in Netty:

```java
ByteBuf direct = ctx.alloc().directBuffer(1024);

try {
    // Write application data into off-heap memory.
    direct.writeBytes(payload);

    // Netty writes a direct buffer to the transport.
    ctx.writeAndFlush(direct.retain());
} finally {
    // Release the local reference.
    direct.release();
}
```

This mechanism is suitable inside network frameworks because socket I/O and native transports can handle off-heap memory more easily. It does not remove the cost of application-level data generation and does not guarantee that the disk-file-to-socket path avoids user space.

### 10.2 sendfile

`sendfile` is a typical kernel-space transfer interface between a file and a socket, or between file descriptors. The official `sendfile(2)` manual defines it as:

```c
ssize_t sendfile(int out_fd, int in_fd, off_t *offset, size_t count);
```

Here, `out_fd` is the destination file descriptor, `in_fd` is the source file descriptor, `offset` specifies the input-file offset, and `count` specifies the number of bytes to transfer. The official manual states that `sendfile()` copies data between two file descriptors and that the copy happens in the kernel, making it more efficient than `read()` plus `write()`; `in_fd` must correspond to a file that supports `mmap`-like operations and cannot be a socket. ([man7.org][6])

The common Java counterpart is `FileChannel.transferTo`:

```java
try (FileChannel source = FileChannel.open(file, StandardOpenOption.READ);
     SocketChannel target = SocketChannel.open(remoteAddress)) {

    long position = 0;
    long size = source.size();

    while (position < size) {
        // Transfer bytes from the file channel to the socket channel.
        long transferred = source.transferTo(position, size - position, target);
        if (transferred <= 0) {
            break;
        }
        position += transferred;
    }
}
```

This mechanism is suitable for sending static file contents, such as large-file downloads, static-resource services, and log-archive transfer. Its advantage is avoiding copying file contents into a user-space buffer. Its limitation is that the input must be a file supporting the corresponding operation; if the protocol layer needs byte-by-byte encryption, compression, or business rewriting, the full sendfile path cannot be preserved.

### 10.3 mmap + write

The `mmap + write` path first maps the file into the process virtual address space and then writes through `write` or a channel. The official `mmap(2)` manual states that file-mapping contents are initialized from the file referenced by the file descriptor; `MAP_SHARED` updates are visible to other mappings and are written back to the underlying file, while `MAP_PRIVATE` creates a private copy-on-write mapping. ([man7.org][8])

In Java, the corresponding type is `MappedByteBuffer`:

```java
try (FileChannel source = FileChannel.open(file, StandardOpenOption.READ);
     SocketChannel target = SocketChannel.open(remoteAddress)) {

    MappedByteBuffer mapped = source.map(
        FileChannel.MapMode.READ_ONLY,
        0,
        source.size()
    );

    while (mapped.hasRemaining()) {
        // Write mapped memory to the socket channel.
        target.write(mapped);
    }
}
```

`mmap + write` removes the step where `read` copies file page-cache data into a user-space byte array. When the mapped region is accessed, page faults load file pages into the page cache on demand and establish page-table mappings. When writing to a socket, the kernel still needs to read data from user addresses into the socket send path. Therefore, it is usually considered an intermediate solution that reduces copy and system-call overhead, not the same kernel-level file-transfer path as `sendfile`.

## 11. Boundary Comparison of Three Zero-Copy Mechanisms

| Implementation | Data source | Main cost reduced | Goes through user address space | Typical Java/Netty scenario |
| --- | --- | --- | --- | --- |
| Direct Memory | Application-generated data, network data | Reduces copying between Java heap and native I/O memory and lowers GC interference | Yes, as user-space off-heap memory | Netty direct `ByteBuf`, native transport I/O |
| sendfile / transferTo | File | Avoids copying file data into user-space buffers | The application does not need to read file contents | Static file sending and large-file network transfer |
| mmap + write | File mapping | Avoids `read` into a user-space byte array and uses demand paging | Yes, file pages are mapped into the process address space | `MappedByteBuffer` file reading and sending |

These three mechanisms solve different problems. Direct Memory mainly optimizes application and network I/O buffer organization; `sendfile` mainly optimizes kernel-space transfer from files to sockets; `mmap + write` mainly optimizes the file-access path by treating file pages as virtual memory. When all three are called "zero copy", the reduced copy segment must be stated explicitly; otherwise, user-space buffer optimization, file-page mapping, and kernel-space file transfer are easily conflated. The `sendfile(2)` manual defines its advantage very clearly: compared with `read` plus `write`, it avoids transferring data between user space and kernel space. ([man7.org][6])

## 12. Conclusion

Data access in Linux uses virtual memory and file descriptors as the application boundary, and page tables, the page cache, VFS, and filesystems as the kernel implementation boundary. A process points through `task_struct` to resource structures such as `mm_struct`, `files_struct`, and `fs_struct`; `mm_struct` represents the address space, `files_struct` represents the file-descriptor table, `struct file` represents an opened-file object, and `address_space` manages the file page cache. The official Linux documentation states that page tables translate virtual addresses into physical addresses, and `address_space` manages page-cache pages and tracks file-mapping relationships. ([Linux Kernel Documentation][1])

The traditional file-transfer path usually includes multiple stages: disk to page cache, page cache to user buffer, user buffer to socket buffer, and socket buffer to NIC. Zero-copy techniques are not one single implementation. They reduce copying at different stages: Direct Memory reduces movement between the Java heap and native I/O buffers; `sendfile` avoids bringing file contents into user space; `mmap + write` reduces the user-space buffer copy introduced by traditional `read` through file mapping. Different mechanisms should be selected for different scenarios rather than treating "zero copy" as one universal performance conclusion.

## 13. Project Recommendation: java-zero-copy

The Java traditional-copy, `FileChannel.transferTo`, and `MappedByteBuffer` paths discussed in this article can be experimentally verified with the `stellhub/java-zero-copy` project. The repository README explains that it compares three Java network-transfer modes: non-zero-copy, `FileChannel.transferTo` zero copy, and `MappedByteBuffer`. It supports outputting client duration, server receive duration, throughput, CPU usage sampling, CSV summaries, and JSON reports. ([GitHub][13])

```text
https://github.com/stellhub/java-zero-copy
```

The repository is suitable for the following experiments:

```bash
# Run all modes in local mode.
mvn compile exec:java

# Run only zero-copy mode.
mvn exec:java "-Dexec.args=--mode=zero-copy"

# Run only traditional copy mode.
mvn exec:java "-Dexec.args=--mode=traditional"

# Run only mapped-buffer mode.
mvn exec:java "-Dexec.args=--mode=mapped-buffer"
```

If you need to connect Linux page cache, Java NIO, `transferTo`, `MappedByteBuffer`, and throughput metrics into an experiment article or interview demonstration, this repository can serve directly as the code sample and benchmark entry point.

[1]: https://docs.kernel.org/mm/page_tables.html "Page Tables - The Linux Kernel documentation"
[2]: https://docs.kernel.org/admin-guide/mm/concepts.html "Concepts overview - The Linux Kernel documentation"
[3]: https://docs.kernel.org/filesystems/vfs.html "Overview of the Linux Virtual File System - The Linux Kernel documentation"
[4]: https://man7.org/linux/man-pages/man2/read.2.html "read(2) - Linux manual page"
[5]: https://man7.org/linux/man-pages/man2/write.2.html "write(2) - Linux manual page"
[6]: https://man7.org/linux/man-pages/man2/sendfile.2.html "sendfile(2) - Linux manual page"
[7]: https://www.kernel.org/doc/html/v6.7/core-api/mm-api.html "Memory Management APIs - The Linux Kernel documentation"
[8]: https://man7.org/linux/man-pages/man2/mmap.2.html "mmap(2) - Linux manual page"
[9]: https://linux-kernel-labs.github.io/refs/heads/master/lectures/processes.html "Processes - The Linux Kernel documentation"
[10]: https://github.com/torvalds/linux/blob/master/include/linux/sched.h "linux/include/linux/sched.h at master"
[11]: https://docs.kernel.org/admin-guide/mm/index.html?utm_source=chatgpt.com "Memory Management"
[12]: https://netty.io/4.0/api/io/netty/buffer/class-use/ByteBuf.html?utm_source=chatgpt.com "Uses of Class io.netty.buffer.ByteBuf"
[13]: https://github.com/stellhub/java-zero-copy "GitHub - stellhub/java-zero-copy"
