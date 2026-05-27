# Linux 系统中的数据加载、访问、传输与零拷贝机制研究

## 摘要

Linux 系统中的数据访问路径由进程虚拟地址空间、页表、物理页、页缓存、文件描述符、VFS、块设备与网络协议栈共同组成。应用程序看到的是虚拟地址和文件描述符，CPU 通过 MMU 和页表把虚拟地址翻译为物理地址，内核通过 `task_struct` 关联进程的地址空间、文件表和文件系统上下文；文件数据通常进入页缓存后再被用户态读取或被内核直接传输。Linux 官方文档说明，页表用于把 CPU 看到的虚拟地址映射为外部内存总线上看到的物理地址；VFS 文档说明，`address_space` 用于组织和管理页缓存中的页，并跟踪文件区间到进程地址空间的映射。([Linux内核文档][1])

本文围绕 Linux 数据如何被加载、访问、传输展开，说明虚拟内存与物理内存的映射关系，分析 `task_struct`、`mm_struct`、`files_struct`、`address_space` 等关键结构，并比较传统文件拷贝与三类零拷贝实现：Direct Memory、`sendfile`、`mmap + write`。

## 1. 引言

Linux 进程并不直接操作物理内存地址，也不直接管理磁盘块。进程通过虚拟地址访问内存，通过文件描述符访问文件、socket、pipe 等内核对象。Linux 内存管理文档指出，物理内存是有限且可能非连续的资源，不同 CPU 架构对物理地址范围的视图也不同，因此虚拟内存被用于屏蔽直接处理物理内存的复杂性。([Linux内核文档][2])

从应用程序视角看，数据访问通常表现为以下几类操作：读取文件、写入文件、访问已映射内存、通过 socket 发送网络数据。从内核视角看，这些操作最终会落到地址空间管理、页表转换、页缓存查找、VFS 文件对象、设备 I/O 或网络协议栈之上。Linux VFS 文档说明，`address_space` 位于存储与应用之间，数据以页为单位读入 address space，然后通过拷贝或内存映射提供给应用；写入也先进入 address space，再通过 writeback 写回存储。([Linux内核文档][3])

## 2. 数据如何被加载、访问与传输

Linux 中的数据加载可以分为两条主路径：一条是内存访问路径，另一条是文件 I/O 路径。

内存访问路径由 CPU 发起。程序执行机器指令访问某个虚拟地址时，CPU 的 MMU 根据页表完成虚拟地址到物理地址的转换。如果 TLB 命中，转换直接完成；如果 TLB 未命中，CPU 会执行页表遍历；如果页表项不存在或权限不满足，则产生缺页异常或访问异常。Linux 页表文档明确说明，页表把 CPU 看到的虚拟地址映射为外部内存总线看到的物理地址，并且 Linux 当前定义了五级页表层次，架构代码再映射到具体硬件限制。([Linux内核文档][1])

文件 I/O 路径由系统调用发起。应用调用 `read(fd, buf, count)` 时，文件描述符 `fd` 被内核解析为 `struct file`，再经 VFS 进入具体文件系统；文件系统从页缓存查找目标文件页，如果页不存在，则触发从块设备读取并填充页缓存；最后内核把页缓存中的数据复制到用户态 `buf`。`read(2)` 的官方手册定义了该系统调用从文件描述符读取最多 `count` 字节到用户缓冲区的语义。([man7.org][4])

写入路径与读取路径相反。应用调用 `write(fd, buf, count)` 时，内核从用户缓冲区复制数据进入内核侧缓存结构，通常会把对应页标记为 dirty，之后由回写机制写入底层存储。`write(2)` 官方手册定义了该系统调用从用户缓冲区向文件描述符写入最多 `count` 字节的语义；VFS 文档则说明，当数据写入页时，应设置 dirty 标志，dirty 状态通常持续到 `writepages` 请求写回。([man7.org][5])

网络传输路径与文件 I/O 路径可以组合。传统文件发送通常是 `read(file) -> write(socket)`；零拷贝发送则可以使用 `sendfile(out_fd, in_fd, offset, count)` 在内核中完成文件描述符之间的数据传输。`sendfile(2)` 官方手册明确说明，它在两个文件描述符之间复制数据，并且由于复制发生在内核中，因此比 `read(2)` + `write(2)` 更高效，因为后者需要在用户空间与内核空间之间传输数据。([man7.org][6])

## 3. 虚拟内存与物理内存的映射关系

虚拟内存的基本事实是：进程看到的是连续或近似连续的虚拟地址区间，物理内存可以是不连续的物理页框。Linux 页表文档说明，物理地址对应的物理页通常用 PFN 表示，PFN 是物理地址除以 `PAGE_SIZE` 的结果；在 4KB 页粒度下，页基地址使用地址中的高位部分，`PAGE_SHIFT` 通常为 12，`PAGE_SIZE` 通常定义为 `1 << PAGE_SHIFT`。([Linux内核文档][1])

映射关系可以抽象为：

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

这个映射不是一次性建立完整地址空间，而是按需建立。进程启动、`mmap`、堆扩展、栈增长等操作会创建或修改虚拟内存区域；真正访问某个尚未建立物理页映射的虚拟地址时，CPU 产生缺页异常，内核再根据 `mm_struct` 和 `vm_area_struct` 判断该地址是否合法，并分配匿名页、读取文件页或建立页表项。Linux 内存管理 API 文档中的 `vma_lookup(mm, addr)` 用于在进程地址空间中查找包含指定用户地址的 `vm_area_struct`，这对应了缺页处理时需要根据地址定位 VMA 的步骤。([Linux Kernel Archives][7])

文件映射场景中，虚拟地址可以直接映射到文件页缓存。`mmap(2)` 官方手册说明，文件映射的内容由文件描述符 `fd` 引用的文件中从 `offset` 开始的 `length` 字节初始化；`offset` 必须是页大小的倍数；`MAP_SHARED` 映射的更新对映射同一区域的其他进程可见，并会写回底层文件，而 `MAP_PRIVATE` 创建私有的 copy-on-write 映射。([man7.org][8])

## 4. task_struct 中的数据存储示例

Linux 中调度的基本实体是 task。Linux Kernel Labs 文档说明，Linux 使用 `struct task_struct` 同时表示线程和进程；资源并不全部嵌入 `task_struct`，而是通过指针指向资源结构，因此同一进程内的线程可以指向同一个资源结构实例。([Linux Kernel Labs][9])

与本文数据访问相关的关键字段可以抽象为：

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

Linux 主线源码 `include/linux/sched.h` 中的 `task_struct` 包含 `struct mm_struct *mm` 与 `struct mm_struct *active_mm` 字段；Linux Kernel Labs 文档也明确说明，打开文件需要访问 `task_struct` 的 file 字段，映射新文件需要访问 `task_struct` 的 mm 字段。([GitHub][10])

从数据访问角度看，`task_struct` 不是直接保存文件内容或页内容的地方。它保存的是指向资源描述符的入口：`mm` 进入进程虚拟地址空间，`files` 进入文件描述符表，`fs` 进入文件系统上下文。线程共享文件表或地址空间时，本质是多个 `task_struct` 指向相同的 `files_struct` 或 `mm_struct`；Linux Kernel Labs 文档在 `clone()` 语义中说明，`CLONE_FILES` 共享文件描述符表，`CLONE_VM` 共享地址空间，`CLONE_FS` 共享文件系统信息。([Linux Kernel Labs][9])

## 5. mm_struct、files_struct 与 file 结构中保存的内容

`mm_struct` 表示进程的用户态地址空间。它通常关联 VMA 集合、页表根、地址空间边界、引用计数、锁、统计信息等内容。Linux 内存管理 API 文档把 `mm_struct` 参数解释为 “the process address space”，并提供 `vma_lookup(mm, addr)` 在该地址空间中查找 VMA。([Linux Kernel Archives][7])

可以用如下简化结构表达其角色：

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

`files_struct` 表示进程或线程组看到的文件描述符表。Linux Kernel Labs 文档说明，`CLONE_FILES` 会让新 task 与父 task 共享文件描述符表；这意味着文件描述符表是可共享的进程资源，而不是每个 task 必然独占的对象。([Linux Kernel Labs][9])

可以用如下简化结构表达：

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

`struct file` 是内核中的打开文件描述对象，不等同于磁盘上的 inode。它保存当前打开实例的偏移、访问模式、文件操作函数表、路径、inode 映射关系等。VFS 文档说明，文件描述相关写回错误追踪会记录到 `struct file` 的错误游标中；同一文件可能存在多个打开文件描述，每个打开描述可以有自己的状态。([Linux内核文档][3])

可以用如下简化结构表达：

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

文件内容本身不存储在 `struct file` 中。普通文件的数据页由文件 inode 的 `address_space` 管理，并通过页缓存、回写和文件系统块映射与底层存储关联。VFS 文档明确说明，`address_space` 用于组织和管理页缓存中的页，也跟踪文件区间到进程地址空间的映射。([Linux内核文档][3])

## 6. 页缓存与通过 MMU 查找数据页

页缓存是 Linux 用于缓存文件数据页的内存机制。VFS 文档将 `address_space` 描述为用于组织和管理页缓存页的对象，它可以跟踪一个文件或其他对象的页，也可以跟踪文件区间映射到进程地址空间的情况；该对象还提供内存压力通信、按地址查找页、跟踪 dirty 或 writeback 页等服务。([Linux内核文档][3])

现代 Linux 中，页缓存通常围绕 `address_space`、`xarray`、`folio` 或 `struct page` 表达。VFS 文档说明，页通常按 `->index` 保存在 radix tree 中，并维护 dirty 与 writeback 状态标签；当前内核实现已经演进为 XArray/folio 体系，但抽象语义仍是“文件偏移到缓存页”的映射。([Linux内核文档][3])

通过 MMU 查找数据页可以分为两种情况。

第一种是用户态访问已经映射的虚拟地址。CPU 使用虚拟地址查 TLB；TLB 未命中则按页表层级查找 PTE；PTE 中包含 PFN 和权限位；最后由 PFN 加页内偏移得到物理地址。Linux 页表文档说明，页表把虚拟地址映射为物理地址，PFN 是物理地址除以 `PAGE_SIZE` 的结果。([Linux内核文档][1])

第二种是用户态访问尚未建立页表项的文件映射地址。此时产生缺页异常，内核通过 `mm_struct` 查找 VMA；若该 VMA 是文件映射，则通过 VMA 对应的文件和 `address_space` 查找页缓存；页缓存命中则建立 PTE 指向该物理页，页缓存未命中则从底层文件系统和块设备读取数据填充页缓存，再建立映射。VFS 文档说明，数据被读入 address space 后，可以通过拷贝或 memory-mapping 的方式提供给应用。([Linux内核文档][3])

## 7. 缺页异常及其发生条件

缺页异常是 CPU 访问虚拟地址时，由页表项缺失、权限不满足或需要特殊内存管理动作而触发的异常。它不必然表示程序错误。合法的缺页异常是 Linux 按需分页、文件映射、匿名页分配、copy-on-write 等机制的组成部分；非法的缺页异常则可能导致 `SIGSEGV`。Linux 内存管理 API 文档中的 `vma_lookup(mm, addr)` 说明内核可以根据用户地址查找 VMA；查不到 VMA 或权限不匹配时，该访问不能被正常解析为合法映射。([Linux Kernel Archives][7])

缺页异常通常发生在以下场景。

第一，首次访问匿名内存。例如堆内存、栈增长区域或匿名 `mmap` 区域在虚拟地址空间中已经存在，但尚未分配物理页；首次写入时，内核分配物理页并建立页表项。

第二，首次访问文件映射。例如 `mmap` 一个文件后，文件内容不会必然立即全部读入内存；访问某个页时，内核根据文件偏移查找页缓存，必要时读取磁盘并建立映射。`mmap(2)` 文档说明，文件映射内容由文件描述符引用的文件内容初始化；这为文件页按需映射提供了系统调用语义基础。([man7.org][8])

第三，copy-on-write。`fork()` 后父子进程可共享只读页表项；任一方写入共享页时，CPU 因写权限触发异常，内核复制物理页并更新页表项。

第四，页被换出或映射被回收。访问已换出页时，内核需要从 swap 或后备存储恢复数据，再恢复映射。

第五，权限异常。例如写只读映射、执行不可执行页、访问未映射地址等。这类异常如果无法由内核修复，会向进程发送信号。

## 8. 页缓存的大小、属性与源码结构

页缓存没有固定的全局静态大小。它使用系统空闲内存缓存文件数据，并在内存压力下由回收机制释放干净页或触发 dirty 页回写。Linux 内存管理文档说明，Linux 内存管理包含回收、OOM、压缩、页缓存等机制；VFS 文档说明，VM 可以释放 clean pages 以复用内存，而 dirty 页需要经过 writeback。([Linux内核文档][11])

页缓存的基本属性包括：

| 属性   | 含义                                                           |
| ---- | ------------------------------------------------------------ |
| 文件归属 | 页缓存页归属于某个 `address_space`，通常对应 inode。                        |
| 索引   | 文件偏移按页大小换算为页索引，例如 `index = offset / PAGE_SIZE`。              |
| 状态   | 页或 folio 可具有 uptodate、dirty、writeback、locked、referenced 等状态。 |
| 引用   | 页可被页表、页缓存、LRU、文件系统私有数据、pipe、direct I/O 等引用。                  |
| 回收   | clean 页可被释放；dirty 页通常需要写回后才能释放。                              |
| 映射   | 文件页可被复制到用户缓冲区，也可通过 `mmap` 映射进进程地址空间。                         |

Linux 内存管理 API 文档说明，folio 的引用计数可能来自页表、页缓存、文件系统私有数据、LRU list、pipes、direct I/O 等来源；这说明页缓存页不仅是文件系统缓存，也可能同时被进程页表或 I/O 路径引用。([Linux Kernel Archives][7])

源码层面的核心结构可以简化表达为：

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

VFS 文档把 `address_space` 定义为 cacheable、mappable object 的内容，并说明它可用于页缓存、dirty/writeback 跟踪、page lookup 和文件映射关系维护。GitHub 主线源码搜索结果也显示 `include/linux/fs.h` 中 `struct address_space` 注释为 “Contents of a cacheable, mappable object”，其字段包含 owner、cached pages、invalidate lock 等。([Linux内核文档][3])

## 9. 传统文件拷贝的数据路径

传统文件拷贝通常指应用使用 `read` 从文件读取数据到用户态缓冲区，再使用 `write` 写入 socket 或目标文件。以“文件发送到网络 socket”为例，典型路径如下：

```text
Disk / storage
   -> kernel page cache
   -> user-space byte[] / buffer
   -> kernel socket buffer
   -> NIC / network
```

如果文件页不在页缓存中，内核需要先从磁盘读取到页缓存。随后 `read()` 把页缓存内容复制到用户态缓冲区。应用再调用 `write()`，内核把用户态缓冲区内容复制到 socket send buffer。最后网络协议栈与网卡驱动把数据发送出去。`sendfile(2)` 官方手册正是以 `read(2)` + `write(2)` 需要在用户空间与内核空间之间传输数据作为对比，说明 `sendfile()` 在内核中完成复制更高效。([man7.org][6])

传统路径至少包含两类成本：

1. 用户态与内核态之间的数据复制。
2. `read` 与 `write` 两次系统调用及对应上下文切换。

在 Java 中，传统实现通常表现为：

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

该路径中的 `byte[]` 位于 Java 堆内存，内核无法直接把网卡 DMA 数据发送源设置为 Java 堆对象；因此网络 I/O 通常需要额外的本地内存或内核缓冲参与。

## 10. 零拷贝的三种实现方式

零拷贝不是单一技术，也不是“完全没有任何复制”。在工程语境中，它通常表示减少用户态与内核态之间的数据复制，或避免应用层显式搬运大块数据。本文按用户指定的三种方式说明：Direct Memory、`sendfile`、`mmap + write`。

### 10.1 用户态直接内存 Direct Memory

Direct Memory 指 Java `DirectByteBuffer` 或 Netty direct `ByteBuf` 使用的堆外内存。Netty 官方文档说明，`ByteBufAllocator.ioBuffer()` 会优先分配适合 I/O 的 direct buffer；`ByteBufAllocator.directBuffer()` 用于分配 direct `ByteBuf`。([netty.io][12])

Direct Memory 的关键事实是：它减少了 Java 堆内存与本地 I/O 内存之间的中间复制，并降低 GC 移动对象对 I/O 缓冲区的影响。它属于用户态内存组织优化，不等同于 Linux `sendfile` 那种“文件页缓存直接进入 socket 发送路径”的内核级文件传输优化。Netty 的 `Unpooled.wrappedBuffer(...)` 和 composite buffer 相关 API 也支持把多个 buffer 组合为一个逻辑 buffer，官方 API 说明 `wrappedBuffer(ByteBuf...)` 可创建包装指定 readable bytes 的 composite buffer，且不复制这些 buffer。([netty.io][12])

Netty 中的直接内存发送示例：

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

该方式适合网络框架内部使用，因为 socket I/O 与 native transport 更容易处理堆外内存。它不消除业务编码阶段的数据生成成本，也不保证从磁盘文件到 socket 的路径不经过用户态。

### 10.2 sendfile

`sendfile` 是典型的文件到 socket 或文件描述符之间的内核态传输接口。`sendfile(2)` 官方手册定义如下：

```c
ssize_t sendfile(int out_fd, int in_fd, off_t *offset, size_t count);
```

其中 `out_fd` 是写入端文件描述符，`in_fd` 是读取端文件描述符，`offset` 指定输入文件偏移，`count` 指定传输字节数。官方手册说明，`sendfile()` 在两个文件描述符之间复制数据，且该复制在内核中完成，因此相比 `read()` + `write()` 更高效；`in_fd` 必须对应支持 `mmap` 类操作的文件，不能是 socket。([man7.org][6])

Java 中对应的常用接口是 `FileChannel.transferTo`。示例：

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

该方式适合文件静态内容发送，例如大文件下载、静态资源服务、日志归档传输等。它的优势是避免把文件内容复制到用户态缓冲区；限制是输入端需要是支持对应操作的文件，且协议层如果需要对内容逐字节加密、压缩或业务改写，就无法完整保留 sendfile 路径。

### 10.3 mmap + write

`mmap + write` 的路径是先把文件映射进进程虚拟地址空间，再通过 `write` 或 channel 写出。`mmap(2)` 官方手册说明，文件映射内容由文件描述符引用的文件内容初始化，`MAP_SHARED` 更新对其他映射可见并写回底层文件，`MAP_PRIVATE` 创建私有 copy-on-write 映射。([man7.org][8])

Java 中对应的是 `MappedByteBuffer`：

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

`mmap + write` 减少了 `read` 把文件页缓存复制到用户态 byte array 的步骤。访问 mapped 区域时，缺页异常会按需把文件页载入页缓存并建立页表映射；写 socket 时，内核仍需要从用户地址读取数据进入 socket 发送路径。因此它通常被视为减少复制与系统调用开销的中间方案，而不是与 `sendfile` 完全相同的内核级文件传输路径。

## 11. 三种零拷贝方式的边界比较

| 实现方式                  | 数据源          | 主要减少的成本                           | 是否经过用户态地址空间    | 典型 Java/Netty 场景                            |
| --------------------- | ------------ | --------------------------------- | -------------- | ------------------------------------------- |
| Direct Memory         | 应用生成的数据、网络数据 | 减少 Java 堆与本地 I/O 内存之间的复制，降低 GC 干扰 | 是，属于用户态堆外内存    | Netty direct `ByteBuf`、native transport I/O |
| sendfile / transferTo | 文件           | 避免文件数据复制到用户态缓冲区                   | 不需要应用读入文件内容    | 静态文件发送、大文件网络传输                              |
| mmap + write          | 文件映射         | 避免 `read` 到用户态 byte array，按需分页    | 是，文件页映射进进程地址空间 | `MappedByteBuffer` 文件读取与发送                  |

这三类机制解决的问题不同。Direct Memory 主要优化应用与网络 I/O 缓冲区组织；`sendfile` 主要优化文件到 socket 的内核态传输；`mmap + write` 主要优化文件访问路径，把文件页作为虚拟内存访问。把这三者都称为“零拷贝”时，必须说明其减少的是哪一段复制，否则容易把用户态缓冲优化、文件页映射和内核态文件传输混为一谈。`sendfile(2)` 手册对其优势的定义非常明确：相对 `read` + `write`，它避免数据在用户空间和内核空间之间传输。([man7.org][6])

## 12. 结论

Linux 系统中的数据访问以虚拟内存和文件描述符为应用边界，以页表、页缓存、VFS 和文件系统为内核实现边界。进程通过 `task_struct` 指向 `mm_struct`、`files_struct`、`fs_struct` 等资源结构；`mm_struct` 表示地址空间，`files_struct` 表示文件描述符表，`struct file` 表示打开文件对象，`address_space` 管理文件页缓存。Linux 官方文档明确说明，页表完成虚拟地址到物理地址的映射，`address_space` 管理页缓存页并跟踪文件映射关系。([Linux内核文档][1])

传统文件传输路径通常需要磁盘到页缓存、页缓存到用户缓冲区、用户缓冲区到 socket buffer、socket buffer 到网卡的多个阶段。零拷贝技术并不是单一实现，而是围绕不同阶段减少复制：Direct Memory 减少 Java 堆与 native I/O 缓冲之间的搬运；`sendfile` 避免文件内容进入用户态；`mmap + write` 通过文件映射减少传统 `read` 带来的用户态缓冲复制。不同场景下应选择不同机制，而不是把“零拷贝”作为单一性能结论。

## 13. 项目推荐：java-zero-copy

本文涉及的 Java 传统拷贝、`FileChannel.transferTo`、`MappedByteBuffer` 等路径，可以通过 `stellhub/java-zero-copy` 项目进行实验验证。该仓库 README 说明，它用于对比 Java 网络传输过程中非零拷贝、`FileChannel.transferTo` 零拷贝、`MappedByteBuffer` 三种发送方式的差异，并支持输出客户端耗时、服务端接收耗时、吞吐量、CPU 使用率采样、CSV 汇总和 JSON 报告。([GitHub][13])

```text
https://github.com/stellhub/java-zero-copy
```

仓库适合用于以下实验：

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

如果需要把 Linux 页缓存、Java NIO、`transferTo`、`MappedByteBuffer` 和吞吐指标串起来做实验文章或面试展示，这个仓库可以直接作为代码样例与基准测试入口。

[1]: https://docs.kernel.org/mm/page_tables.html "Page Tables — The Linux Kernel  documentation"
[2]: https://docs.kernel.org/admin-guide/mm/concepts.html "Concepts overview — The Linux Kernel  documentation"
[3]: https://docs.kernel.org/filesystems/vfs.html "Overview of the Linux Virtual File System — The Linux Kernel  documentation"
[4]: https://man7.org/linux/man-pages/man2/read.2.html "read(2) - Linux manual page"
[5]: https://man7.org/linux/man-pages/man2/write.2.html "write(2) - Linux manual page"
[6]: https://man7.org/linux/man-pages/man2/sendfile.2.html "sendfile(2) - Linux manual page"
[7]: https://www.kernel.org/doc/html/v6.7/core-api/mm-api.html "Memory Management APIs — The Linux Kernel  documentation"
[8]: https://man7.org/linux/man-pages/man2/mmap.2.html "mmap(2) - Linux manual page"
[9]: https://linux-kernel-labs.github.io/refs/heads/master/lectures/processes.html "Processes — The Linux Kernel  documentation"
[10]: https://github.com/torvalds/linux/blob/master/include/linux/sched.h "linux/include/linux/sched.h at master · torvalds/linux · GitHub"
[11]: https://docs.kernel.org/admin-guide/mm/index.html?utm_source=chatgpt.com "Memory Management"
[12]: https://netty.io/4.0/api/io/netty/buffer/class-use/ByteBuf.html?utm_source=chatgpt.com "Uses of Class io.netty.buffer.ByteBuf"
[13]: https://github.com/stellhub/java-zero-copy "GitHub - stellhub/java-zero-copy: Java zero-copy examples and performance experiments for NIO, FileChannel, transferTo, mmap, and high-throughput network I/O. · GitHub"
