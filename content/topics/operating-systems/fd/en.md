## Abstract

A file descriptor, usually abbreviated as fd, is one of the most fundamental and most easily underestimated abstractions in Linux and Unix system programming. On the surface, it is only a non-negative integer inside a process. Behind it, however, is a chain of kernel objects: the process file descriptor table, the system-wide open file description, the VFS `struct file`, dentries, inodes, concrete file systems, device drivers, sockets, pipes, eventfd, epoll, and more.

Linux's "everything is a file" idea does not mean that everything in the system is a disk file. It means that Linux tries to abstract many kinds of resources behind a unified file I/O interface. Interfaces such as `read()`, `write()`, `close()`, `fcntl()`, `poll()`, and `epoll()` can operate on regular files, pipes, FIFOs, sockets, terminals, device files, and other object types. The Linux Programming Interface describes the universal I/O model this way: all system calls that perform I/O refer to open files through file descriptors; file descriptors can refer to regular files, pipes, FIFOs, sockets, terminals, devices, and other kinds of open files; and every process has its own set of file descriptors. ([Man7][1])

This article studies where Linux fds come from, what they do, what kernel structures they connect to, how they are used, and what engineers should watch in production. The central point is simple: an fd is not just an `int`; it is the user-space handle exposed by Linux's unified resource-access model.

**Keywords:** Linux; file descriptor; fd; VFS; open file description; inode; socket; epoll; close-on-exec; everything is a file

---

## 1. Introduction: Why fd Is an Entry Point for Understanding Linux

In Java, Go, C, Rust, Python, Node.js, and other languages, developers frequently encounter concepts such as connections, files, sockets, pipes, log files, standard input and output, epoll, and event loops. They look different at the language level, but once they reach the Linux kernel, many of them enter the unified I/O management model through fds.

For example:

```text
Open a log file        -> fd
Create a TCP connection -> fd
Create a pipe          -> two fds
Create an epoll instance -> fd
Visit /proc/pid/fd     -> inspect process fds
Standard input/output/error -> fd 0 / 1 / 2
```

An fd is therefore the basic handle that connects a user-space program with kernel resource objects. It is a system-call argument, a boundary for process resource isolation, a foundation for high-performance network programming, and a core metric in production troubleshooting.

---

## 2. The Real Meaning of "Everything Is a File"

"Everything is a file" is a famous Unix/Linux design idea, but it is often misunderstood.

It does not mean:

```text
All resources are regular files on disk.
```

A more accurate meaning is:

```text
Linux tries to abstract different resources as objects that can be operated through file interfaces.
```

Regular files, directories, character devices, block devices, terminals, pipes, sockets, procfs, sysfs, eventfd, timerfd, signalfd, epoll instances, and many other resources can be referenced by a process through fds. After a process obtains an fd, it does not need to directly know whether the object behind it is a disk file, a network connection, or a kernel event object. It can operate through unified system-call interfaces.

The value of this model is:

```text
Unified access interface
Unified permission model
Unified lifecycle management
Unified event notification mechanism
Unified resource limits and accounting
```

The Linux VFS layer is one of the key layers that carries this idea. Linux Kernel Labs describes VFS as the kernel component that handles file and file-system-related system calls. It provides a common interface between users and concrete file systems, simplifying file-system implementation and making many file systems easier to integrate. ([Linux Kernel Labs][2])

In other words, applications see fds and read/write/open/close, while the kernel uses VFS to dispatch those operations to the concrete implementation for each object type.

---

## 3. Where fd Comes From: Starting with `open()`

The most classic source of an fd is `open()`.

The `open(2)` manual states that a call to `open()` creates a new open file description, which is an entry in the system-wide table of open files. The open file description records the file offset and file status flags. A file descriptor is a reference to that open file description. ([Man7][3])

This sentence is crucial. It means that an fd is not the file itself and is not the inode itself. It is a reference stored in the process file descriptor table.

The relationship can be simplified into three layers:

```text
User-space process
  fd = 3

Kernel: process file descriptor table
  fd 3 -> open file description

Kernel: system-wide open file object
  open file description -> file offset / status flags / struct file

File-system layer
  struct file -> dentry -> inode -> concrete file or device
```

A call such as `open("/tmp/a.log", O_RDWR)` roughly does the following:

```text
1. User space calls open()
2. The kernel resolves dentries from the path
3. VFS finds the corresponding inode
4. The kernel creates a struct file / open file description
5. The current process fd table allocates the lowest available fd
6. The fd points to that open file description
7. open() returns the fd to user space
```

The Linux kernel VFS documentation explains that after a path lookup finds an inode, VFS can perform operations such as `open(2)` and `stat(2)`. Older VFS documentation also describes that the `file` structure is placed into the process file descriptor table, and later VFS operations such as read, write, and close use the user-space fd to find the corresponding `file` structure. ([Linux Kernel Documentation][4])

---

## 4. fd, Open File Description, and inode Are Not the Same Thing

This is the most important point for understanding fd.

Many production problems come from this misunderstanding:

```text
fd == file
```

That is inaccurate.

The more accurate relationship is:

```text
fd is a process-local integer handle
open file description is system-wide open-file state
inode is metadata for a file-system object
```

The relationship looks like this:

```text
process A fd table
  fd 3 ─┐
        ├── open file description ─── struct file ─── dentry ─── inode
process B fd table
  fd 8 ─┘
```

### 4.1 fd Is Process-Local

The same integer fd can point to completely different objects in different processes:

```text
Process A fd 3 -> /tmp/a.log
Process B fd 3 -> socket:[12345]
```

Therefore, seeing only `fd=3` in logs is not very useful. You must combine it with the PID to know what it points to.

### 4.2 Open File Description Stores Shared State

`open(2)` clearly says that an open file description stores the file offset and file status flags. ([Man7][3])

That means if two fds point to the same open file description, they share the file offset and status flags.

The `dup(2)` manual says the same thing: after `dup()`, the old and new file descriptors can be used interchangeably because they refer to the same open file description. They share the file offset and file status flags. If one fd changes the offset through `lseek()`, the other fd is affected as well. ([Man7][5])

Diagram:

```text
fd 3 ─┐
      ├── same open file description
fd 4 ─┘

Shared:
  file offset
  file status flags
```

### 4.3 inode Represents a File-System Object

An inode describes an object in a file system, such as a regular file, directory, or device node. It contains metadata such as permissions, owner, size, timestamps, and block locations. VFS resolves paths and locates concrete objects through dentries and inodes. Linux VFS documentation explains that finding an inode requires VFS to call the parent directory inode's `lookup()` method. Once VFS obtains the dentry and inode, it can perform operations such as open and stat. ([Linux Kernel Documentation][4])

Therefore, deleting or renaming a path does not immediately invalidate an already opened fd. `open(2)` also states that a file descriptor's reference to an open file description is not affected by later removal of the path or by later changes that make the path point to a different file. ([Man7][3])

This is why Linux often shows this pattern:

```text
The file has been rm'ed
The process still holds an fd
Disk space has not been released
```

The real data object is still referenced by the open file description.

---

## 5. What fd Does: Unifying Different Resources into I/O Handles

The core role of an fd is to serve as a system-call input parameter.

Common system calls include:

```c
read(fd, buf, size);
write(fd, buf, size);
close(fd);
fcntl(fd, ...);
ioctl(fd, ...);
poll(... fd ...);
epoll_ctl(epfd, ..., fd, ...);
send(fd, ...);
recv(fd, ...);
```

From a design perspective, fd provides several capabilities.

First, fd hides the resource type. Applications can use similar I/O calls for regular files, sockets, and pipes.

Second, fd isolates process resources. Every process has its own fd table, and an fd number only has meaning inside that process.

Third, fd supports reuse across system calls. A process first obtains an fd through `open()`, then uses that fd with read/write/fcntl/ioctl/epoll and other interfaces.

Fourth, fd supports event notification. `poll()`, `select()`, and `epoll()` all monitor fds. `epoll(7)` explains that the epoll API monitors multiple file descriptors, identifies which descriptors are ready for I/O, and scales to large numbers of monitored fds. ([Man7][6])

---

## 6. Typical fd Usage Scenarios

### 6.1 Regular Files

The most direct use case is reading and writing regular files:

```c
int fd = open("/var/log/app.log", O_WRONLY | O_APPEND);
write(fd, buf, len);
close(fd);
```

Here the fd points to an open file description, and the open file description records the offset and status flags. With `O_APPEND`, the kernel handles writes in append mode.

### 6.2 Standard Input, Standard Output, and Standard Error

Unix/Linux convention is:

```text
fd 0 -> stdin
fd 1 -> stdout
fd 2 -> stderr
```

The `proc_pid_fd(5)` manual also states that each entry in `/proc/pid/fd/` corresponds to one open fd in the process, where 0 is standard input, 1 is standard output, and 2 is standard error. ([Man7][7])

This is the foundation of shell redirection:

```bash
command > out.log 2> err.log
```

At its core, shell redirection changes what the process fds point to when the process starts.

### 6.3 socket

Network connections are also represented by fds in Linux:

```c
int fd = socket(AF_INET, SOCK_STREAM, 0);
connect(fd, ...);
send(fd, ...);
recv(fd, ...);
close(fd);
```

This reflects the "everything is a file" idea: a TCP connection is not a disk file, but it can be managed through fd-based read/write/poll/epoll interfaces.

### 6.4 pipe and FIFO

`pipe()` returns two fds: one read end and one write end. The Linux Programming Interface chapter on pipes explains that after `pipe()` succeeds, it returns two open file descriptors in an array: `filedes[0]` is the read end and `filedes[1]` is the write end. They can be used with `read()` and `write()` like other fds. ([Fenix Tecnico Lisboa][8])

```text
pipefd[0] -> read end
pipefd[1] -> write end
```

This brings inter-process communication into the fd model as well.

### 6.5 An epoll Instance Is Also an fd

`epoll_create()` returns an fd that refers to an epoll instance. That fd is then used with epoll APIs. When all fds referring to the epoll instance are closed, the kernel destroys the instance and releases its resources. ([Linux Documentation][9])

This shows that fds are not only handles for files and sockets. They can also be handles for kernel event objects.

### 6.6 Observing fds through `/proc`

Linux provides `/proc/<pid>/fd` to inspect the fds currently opened by a process. `proc_pid_fd(5)` explains that every entry in this directory is named by fd number and is a symbolic link to the actual file. For pipes and sockets, these links show strings such as `type:[inode]`. ([Man7][7])

Common troubleshooting commands:

```bash
ls -l /proc/<pid>/fd
readlink /proc/<pid>/fd/<fd>
lsof -p <pid>
```

---

## 7. fork, exec, dup, and fd Inheritance

fd affects not only I/O but also process creation and program replacement.

### 7.1 fds Are Inherited after `fork()`

The `fork(2)` manual states that the child process inherits copies of the parent's set of open fds. Each fd in the child refers to the same open file description as the corresponding fd in the parent. Therefore, parent and child share open file status flags, file offset, and signal-driven I/O attributes. ([Man7][10])

That means:

```text
Parent fd 3 ─┐
             ├── same open file description
Child fd 3 ──┘
```

Shared offset has real effects. For example, if parent and child read from the same fd at the same time, they affect each other's read position.

### 7.2 `dup()` Shares the Open File Description

`dup()`, `dup2()`, and `dup3()` create new fds, but they do not create new open file descriptions. The old and new fds point to the same open file description, so they share offset and status flags. ([Man7][5])

This is also the foundation of shell redirection, log redirection, and standard-output duplication.

### 7.3 `exec()` and close-on-exec

By default, fds may survive across `exec()`. The `fcntl(3p)` description of `FD_CLOEXEC` says that if the `FD_CLOEXEC` flag is 0, the fd remains open after an exec function; otherwise it is closed during a successful exec. ([Man7][11])

This is a common source of security issues and resource leaks.

Bad example:

```text
Parent process opens a database connection socket
fork + exec starts a child process
The child accidentally inherits that socket fd
The parent closes the socket
The connection is still held by the child
The server cannot observe connection closure for a long time
```

In engineering practice, prefer APIs with atomic close-on-exec support such as `O_CLOEXEC`, `SOCK_CLOEXEC`, and `EPOLL_CLOEXEC`. This avoids the race that can occur when a program opens an fd first and then sets close-on-exec through `fcntl`.

---

## 8. fd and VFS: How Linux Unifies Different Objects

The Linux VFS layer is the key to understanding "everything is a file."

A simplified VFS object relationship is:

```text
fd
 └── file descriptor table entry
      └── struct file
           ├── file operations
           ├── file offset
           ├── file flags
           └── dentry
                └── inode
                     └── filesystem / device / socket implementation
```

The value of VFS is that it provides a unified interface for different file systems and object types. Kernel documentation describes VFS as the common interface between users and concrete file systems. ([Linux Kernel Labs][2])

For regular files, `read()` may eventually execute the read logic of a concrete file system.

For character devices, `read()` may call the device driver's `file_operations.read`.

For sockets, `read()` / `recv()` enters the network protocol stack.

For pipes, `read()` retrieves data from the pipe buffer.

In short:

```text
User space sees fd
VFS sees struct file
The concrete implementation sees its own file_operations
```

That is the essence of the Linux unified I/O model.

---

## 9. What Engineers Should Watch

### 9.1 fd Leaks

fd leaks are one of the most common problems in Linux server programs.

Typical causes:

```text
An exception path after open does not close
A socket accepted from accept is not closed
An HTTP response body is not closed
A file stream is not closed
A child process inherits fds it should not inherit after fork/exec
epoll fd, eventfd, or timerfd is not closed
```

Symptoms:

```text
Too many open files
accept fails
open fails
socket creation fails
abnormal server connections
```

Troubleshooting:

```bash
ulimit -n
cat /proc/<pid>/limits
ls /proc/<pid>/fd | wc -l
lsof -p <pid>
```

Mitigation:

```text
Every fd must have a clear owner
Exception paths must close fds
Use try-with-resources / defer / RAII
Set close-on-exec
Monitor per-process fd count
During load tests, verify that fd count does not grow monotonically over time
```

### 9.2 fd Limits

Linux has several layers of fd limits:

```text
Per-process limit: ulimit -n
System-wide limit: fs.file-max
systemd LimitNOFILE
Container runtime limits
Application framework connection limits
```

Production services should watch:

```bash
cat /proc/<pid>/limits
cat /proc/sys/fs/file-max
cat /proc/sys/fs/file-nr
```

If connection count is large, such as in gateways, registry centers, long-connection services, message queues, and push systems, fd limits must be part of capacity planning.

### 9.3 fd Inheritance and Security

fd inheritance problems are often subtle but harmful.

Typical problems:

```text
A child process inherits a listening socket
A child process inherits a sensitive file fd
A child process inherits a database connection
A child process inherits the write end of a pipe, so the read end never sees EOF
```

Mitigation:

```text
Use O_CLOEXEC by default
Use SOCK_CLOEXEC by default
Use EPOLL_CLOEXEC by default
Close unnecessary fds in the child process after fork
Audit /proc/<pid>/fd
```

### 9.4 Side Effects of Shared Offset

After `dup()` and `fork()`, fds can share the same open file description and therefore share file offset. ([Man7][5])

If multiple execution flows concurrently read or write through the same open file description, problems can include:

```text
Read positions affect each other
Write positions are not what you expect
Log output becomes disordered
File processing repeats or misses data
```

Solutions:

```text
If independent offsets are needed, open the file separately
For concurrent logging, use O_APPEND or a logging framework
For position-specific reads and writes, use pread/pwrite
```

### 9.5 socket fd and Connection Lifecycle

Each TCP connection usually corresponds to one socket fd. Long-connection systems should watch:

```text
Connection count
fd count
CLOSE-WAIT
TIME-WAIT
ESTABLISHED
send queue / recv queue
```

If there are many `CLOSE-WAIT` sockets, the usual meaning is that the peer has closed the connection, but the local application has not closed the fd in time.

Troubleshooting:

```bash
ss -antp
ss -s
lsof -p <pid> -i
```

### 9.6 epoll and fd Lifecycle

epoll monitors kernel objects related to fds. `epoll_ctl(2)` explains that `epoll_ctl()` adds, modifies, or removes target fds in the interest list of an epoll instance. ([Man7][12])

Engineering concerns:

```text
Whether an fd is removed from epoll in time after close
Whether connection-object lifecycle matches fd lifecycle
Whether fd number reuse causes business-object mismatch
Whether EPOLLONESHOT / EPOLLET is handled correctly
```

The kernel can reuse fd numbers. Therefore, application code must not treat the integer fd as a long-term unique identity by itself. High-concurrency network frameworks usually bind fd with a connection object, generation, or channel id to avoid incorrect operations caused by fd reuse.

### 9.7 A Deleted File Does Not Release Disk Space

A common symptom is:

```text
After rm'ing a large log file, df still shows that disk space is not released
```

The usual reason is that a process still holds an fd for that file. Because the fd references an open file description and the open file description still references the underlying file object, disk space is not released immediately.

Troubleshooting:

```bash
lsof | grep deleted
ls -l /proc/<pid>/fd | grep deleted
```

Mitigation:

```text
Make the process close the fd
Restart the process
Trigger a logging-framework reload
Use logrotate copytruncate or a correct reopen mechanism
```

### 9.8 Nonblocking fd and Event-Driven Programming

High-performance network services usually set socket fds to nonblocking mode and hand them to epoll.

Key concerns:

```text
Whether O_NONBLOCK is set correctly
Whether EAGAIN / EWOULDBLOCK is handled correctly
Whether edge-triggered mode reads until EAGAIN
Whether write events are registered when the write buffer is full
Whether slow clients cause send queues to expand
```

fd is the core of the event-driven model. epoll only tells you which fd is readable or writable. The real state machine still has to be managed correctly by the application.

---

## 10. Common fd Troubleshooting Commands in Production

### 10.1 See Which fds a Process Has Opened

```bash
ls -l /proc/<pid>/fd
```

Each entry in `/proc/pid/fd` corresponds to one fd opened by the process. ([Man7][7])

### 10.2 Inspect fd Details

```bash
cat /proc/<pid>/fdinfo/<fd>
```

`/proc/pid/fdinfo` provides information for the corresponding fd, and its contents vary by fd type. ([Ubuntu Manpages][13])

### 10.3 Count fds

```bash
ls /proc/<pid>/fd | wc -l
```

### 10.4 Inspect socket Connection State

```bash
ss -antp
ss -s
```

### 10.5 Find Deleted Files

```bash
lsof | grep deleted
```

### 10.6 Inspect Process Limits

```bash
cat /proc/<pid>/limits
ulimit -n
```

---

## 11. Engineering Lessons from fd Design

The fd design unifies complex resources into small integer handles. This brings enormous simplicity, but also engineering responsibility.

First, an fd is a resource and must be closed. It cannot reliably express lifecycle only through language-level garbage collection like an ordinary memory object. File objects and socket objects in many languages still ultimately hold fds. If the application does not close them, kernel resources still leak.

Second, an fd is process-local. Passing an fd number across processes is meaningless unless a real fd reference is transferred through a mechanism such as SCM_RIGHTS over a Unix domain socket.

Third, the object behind an fd may not be a regular file. It may be a socket, pipe, eventfd, epoll instance, device, or procfs node. When troubleshooting fds, do not look only at the number. Check what `/proc/<pid>/fd/<n>` points to.

Fourth, fd lifecycle often crosses fork, exec, dup, epoll, thread pools, and connection pools. Many server stability problems, such as connections not being released, deleted logs still occupying disk space, slow process exit, and abnormal client connections, eventually trace back to fd lifecycle management.

Fifth, "everything is a file" is not a slogan. It is the practice of unifying Linux kernel interfaces. It allows regular files, network connections, pipes, terminals, devices, and event-notification objects to cooperate through a common set of system calls.

---

## 12. Conclusion

The Linux file descriptor is the most direct user-space expression of the "everything is a file" idea. On the surface, an fd is a non-negative integer. In essence, it is an index in the current process file descriptor table, pointing to a system-wide open file description, and then further to the VFS `struct file`, dentry, inode, and concrete resource implementation.

The value of fd is unification. Regular files, sockets, pipes, terminals, devices, epoll, eventfd, and other resources can be opened, read, written, closed, monitored, and passed through similar interfaces. VFS acts as the adaptation layer in the kernel, dispatching unified fd operations to the concrete implementation of each object.

In engineering practice, fd is a key resource for service stability. Engineers should watch fd leaks, fd limits, close-on-exec, fork/dup sharing of open file descriptions, connection-pool reuse, epoll lifecycle, CLOSE-WAIT, deleted files still occupying disk space, and related issues.

Ultimately, fd can be understood in one sentence:

```text
An fd is the unified handle through which a Linux process accesses kernel resources.
The engineering endpoint of "everything is a file" is that almost every I/O-capable resource can be referenced by an fd, managed by VFS, and operated through unified system calls.
```

[1]: https://man7.org/tlpi/download/TLPI-04-File_IO_The_Universal_IO_Model.pdf?utm_source=chatgpt.com "FILE I/O: THE UNIVERSAL I/O MODEL"
[2]: https://linux-kernel-labs.github.io/refs/pull/189/merge/labs/filesystems_part1.html?utm_source=chatgpt.com "File system drivers (Part 1)"
[3]: https://man7.org/linux/man-pages/man2/open.2.html?utm_source=chatgpt.com "open(2) - Linux manual page"
[4]: https://docs.kernel.org/filesystems/vfs.html?utm_source=chatgpt.com "Overview of the Linux Virtual File System"
[5]: https://man7.org/linux/man-pages/man2/dup.2.html?utm_source=chatgpt.com "dup(2) - Linux manual page"
[6]: https://man7.org/linux/man-pages/man7/epoll.7.html?utm_source=chatgpt.com "epoll(7) - Linux manual page"
[7]: https://man7.org/linux/man-pages/man5/proc_pid_fd.5.html?utm_source=chatgpt.com "proc_pid_fd(5) - Linux manual page"
[8]: https://fenix.tecnico.ulisboa.pt/downloadFile/1126518382330349/Lab%205%20-%20the-linux-programming-interface-44.pdf?utm_source=chatgpt.com "The Linux Programming Interface"
[9]: https://linux.die.net/man/2/epoll_create?utm_source=chatgpt.com "epoll_create(2): open epoll file descriptor - Linux man page"
[10]: https://man7.org/linux/man-pages/man2/fork.2.html?utm_source=chatgpt.com "fork(2) - Linux manual page"
[11]: https://man7.org/linux/man-pages/man3/fcntl.3p.html?utm_source=chatgpt.com "fcntl(3p) - Linux manual page"
[12]: https://man7.org/linux/man-pages/man2/epoll_ctl.2.html?utm_source=chatgpt.com "epoll_ctl(2) - Linux manual page"
[13]: https://manpages.ubuntu.com/manpages/noble/man5/proc_pid_fdinfo.5.html?utm_source=chatgpt.com "proc/pid/fdinfo/ - information about file descriptors"
