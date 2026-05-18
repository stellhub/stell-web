## Abstract

Kubernetes and Docker appear to be a "container platform" and a "container tool," but what they truly depend on are Linux kernel capabilities that already exist: processes, namespaces, cgroups, mounts, capabilities, seccomp, file systems, and networking. My judgment is: **a container is not a virtual machine; in essence, a container is a group of processes whose runtime environment has been isolated, constrained, and reshaped by the Linux kernel**. Docker's documentation also states clearly that a container is a process running on the host, but with an isolated file system, network, process tree, and related views. ([Docker Documentation][1])

This article follows a paper-like structure along the path of **Kubernetes Pod lifecycle -> CRI -> containerd / Docker -> runc -> Linux kernel system calls -> syscall path of applications inside containers**. It focuses on the roles of `nsproxy`, namespaces, and cgroups during container creation, startup, runtime, and destruction, and gives the Linux system calls and key kernel functions usually involved when starting a Pod and a container.

**Keywords:** Kubernetes, Docker, containerd, runc, namespace, nsproxy, cgroup, clone3, setns, mount, execve, seccomp, OCI Runtime

---

## 1. Introduction: What Do Kubernetes and Docker Actually Run on Linux?

First, the conclusion: **Kubernetes does not directly "run containers," and Docker is not the container itself. Both ultimately drive Linux to create one or more ordinary processes, but these processes are placed into specific namespaces, cgroups, rootfs, capability sets, seccomp profiles, and network environments.**

In modern Kubernetes, kubelet communicates with the container runtime through CRI. CRI is the primary protocol between kubelet and the container runtime. kubelet acts as a gRPC client, connects to the container runtime, and the runtime is responsible for actually creating Pods and containers. ([Kubernetes][2]) Kubernetes also states that the built-in dockershim was removed starting from v1.24. Docker Engine itself does not implement CRI, so Kubernetes needs a CRI-compatible runtime such as containerd or CRI-O, or an additional cri-dockerd adapter for Docker. ([Kubernetes][3])

Therefore, when looking at container technology on Linux, the correct layering should be:

```text
Kubernetes API / PodSpec
        ↓
kubelet
        ↓ CRI gRPC
containerd / CRI-O / cri-dockerd
        ↓
containerd-shim / runtime shim
        ↓ OCI Runtime
runc
        ↓ Linux syscalls
clone3 / clone / unshare / setns / mount / pivot_root / execve / prctl / seccomp / kill / wait4
        ↓
Linux kernel
task_struct / nsproxy / cgroup / VFS / netns / scheduler / memory manager
```

The OCI Runtime Specification defines container configuration, execution environment, and lifecycle. `config.json` describes the fields needed to create a container, and the runtime is responsible for creating a consistent execution environment based on those fields. ([GitHub][4]) That is why Docker, containerd, and CRI-O can all eventually converge on runc or another OCI runtime.

---

## 2. Research Object and Scope

This article discusses the main path of Linux containers, especially the two common chains Kubernetes + containerd + runc and Docker Engine + containerd + runc. Different versions, different runtimes, different distributions, cgroup v1 versus v2, rootless mode, user namespaces, systemd cgroup driver, and CNI plugin implementations can all change details, but the trunk mechanism is consistent. containerd states that it manages the complete container lifecycle on the host, including image transfer, storage, container execution, supervision, low-level storage, and network attachments. ([containerd.io][5])

This article does not focus on the Kubernetes scheduler, controllers, or API Server. Instead, it focuses on what happens after a Pod has been scheduled to a Node: how kubelet translates a PodSpec into Linux processes. The Kubernetes Pod lifecycle documentation states that after a Pod is scheduled and bound to a Node, kubelet manages the containers and translates the Pod spec for the container runtime. ([Kubernetes][6])

---

## 3. Three Core Facts about Linux Containers

### 3.1 A Container Is First a Process

Java, Go, Nginx, and MySQL running in containers are still processes on the host Linux system. The difference is that the PID tree, network devices, mount tree, hostname, IPC objects, cgroup paths, and other views that these processes see are not the host's global view, but a view trimmed by namespaces. Docker's description of `docker run` is direct: the container process runs on the host and has its own file system, network, and isolated process tree. ([Docker Documentation][1])

### 3.2 Namespaces Decide "What Can Be Seen"

The responsibility of namespaces is to isolate views of kernel resources. For example:

| namespace | Purpose |
| --- | --- |
| PID namespace | The container sees its own PID 1 and PID tree |
| Mount namespace | The container sees its own rootfs and mount points |
| Network namespace | The container sees its own network interfaces, routing table, and port space |
| UTS namespace | The container sees its own hostname and domainname |
| IPC namespace | Isolates System V IPC and POSIX message queues |
| User namespace | Isolates UID/GID mappings |
| Cgroup namespace | Isolates the cgroup path shown by `/proc/self/cgroup` |
| Time namespace | Isolates part of the time view |

Linux man-pages explain that `setns(2)` lets the calling process join an existing namespace, and namespaces can usually be referenced through file descriptors under `/proc/pid/ns`. ([man7.org][7]) `clone(2)` / `clone3(2)` are key system-call interfaces for creating new processes, threads, and namespaces. ([man7.org][8])

### 3.3 cgroups Decide "How Much Can Be Used"

cgroups are not mainly responsible for "what can be seen." They are responsible for resource ownership, limits, accounting, and control. The official Linux cgroup v2 documentation states that it is the authoritative documentation for cgroup v2 design, interface, and conventions. ([Linux Kernel Documentation][9]) In cgroup v2, `cgroup.procs` can list the PIDs that belong to a cgroup, and processes can be migrated by writing a PID into the target cgroup's `cgroup.procs`. ([Linux Kernel Documentation][9])

cgroup controllers decide how resources are allocated. For example, the `cpu`, `memory`, and `io` controllers can control CPU, memory, and IO usage for child cgroups. A parent cgroup controls resource distribution for its children by enabling controllers. ([Linux Kernel Documentation][9]) Kubernetes CPU limits, memory limits, QoS, and Pod cgroup hierarchy ultimately land on these kernel interfaces.

---

## 4. nsproxy: the Kernel's "Pointer Set" for Namespaces

`nsproxy` is key to understanding container isolation. In the Linux kernel source, `struct nsproxy` contains pointers to multiple namespaces, such as `uts_ns`, `ipc_ns`, `mnt_ns`, `pid_ns_for_children`, `net_ns`, `time_ns`, and `cgroup_ns`. The source comment also states that tasks sharing all namespaces can share the same `nsproxy`; once a namespace is cloned or unshared, the `nsproxy` is copied. ([GitHub][10])

A simplified view:

```c
struct task_struct {
    // ...
    struct nsproxy *nsproxy;
    // ...
};

struct nsproxy {
    struct uts_namespace    *uts_ns;
    struct ipc_namespace    *ipc_ns;
    struct mnt_namespace    *mnt_ns;
    struct pid_namespace    *pid_ns_for_children;
    struct net              *net_ns;
    struct cgroup_namespace *cgroup_ns;
    // ...
};
```

This reveals an important fact: **container isolation is not implemented by putting a "container" tag on a process. It is implemented because `task_struct` indirectly references a set of namespace objects.** When runc creates a container init process, it passes flags such as `CLONE_NEWNS`, `CLONE_NEWPID`, `CLONE_NEWNET`, `CLONE_NEWUTS`, `CLONE_NEWIPC`, and `CLONE_NEWCGROUP` through `clone` / `clone3`. The kernel creates or copies namespace objects and then points the new process's `task_struct->nsproxy` to that namespace set. The `clone(2)` man page explicitly describes the glibc `clone()` wrapper, the underlying system call, and the newer `clone3()` system call. ([man7.org][8])

My judgment is: **nsproxy is the "index structure" for Linux container isolation, while namespace objects are the isolated views themselves.** Without `nsproxy`, it is hard to organize the fact that one process simultaneously belongs to multiple namespaces.

---

## 5. The Startup Path of a Pod in Kubernetes

Creating a Pod does not directly start the business container. It usually creates a Pod sandbox first. Kubernetes CRI standardizes the interaction between kubelet and the runtime, and kubelet communicates with the runtime through CRI gRPC. ([Kubernetes][2])

A typical call chain is:

```text
1. A user submits Pod YAML
2. API Server persists the PodSpec
3. Scheduler binds the Pod to a Node
4. kubelet on that Node discovers the pending Pod
5. kubelet calls CRI RuntimeService.RunPodSandbox
6. the runtime creates the Pod sandbox
7. CNI configures networking for the sandbox
8. kubelet calls CreateContainer
9. kubelet calls StartContainer
10. the business process starts through execve inside the container
11. kubelet continues probing, restarting, stopping, and deleting
```

The Kubernetes Pod lifecycle documentation states that a Pod starts from `Pending`, enters `Running` if at least one primary container starts successfully, and then moves to `Succeeded` or `Failed` depending on container termination. kubelet manages containers while the Pod is running and translates the Pod spec for the container runtime. ([Kubernetes][6])

The core role of the Pod sandbox is to establish a shared environment for the Pod, especially the network namespace. For ordinary Linux runtimes, the Pod sandbox usually corresponds to a pause container or similar infra container: it first creates and holds the Pod's network namespace, and later application containers join that namespace through `setns`. Kubernetes documentation does not hard-code the pause container implementation detail because CRI leaves some interpretation space to the runtime. CRI's core is the protocol between kubelet and runtime, not forcing one specific lower-level implementation. ([Kubernetes][2])

---

## 6. The OCI Lifecycle of a Container

The OCI Runtime Specification lifecycle is the main line for understanding runc. The OCI runtime's `create` command is invoked, then hooks run. After `start` is invoked, the runtime must run the user-specified program. Process exit may happen because of an error, normal exit, crash, or the runtime's kill operation. Finally, `delete` is called, and the container must be destroyed by undoing the steps performed during `create`. ([GitHub][11])

From an engineering perspective:

```text
Create phase:
  - prepare rootfs
  - prepare mount namespace
  - configure cgroup
  - configure namespaces
  - configure capabilities
  - configure seccomp / AppArmor / SELinux
  - create the process environment, but not necessarily run the user program immediately

Start phase:
  - release the container init process
  - execve the user-specified command
  - business process becomes the main process inside the container

Run phase:
  - business process issues syscalls
  - kernel handles them based on namespace/cgroup/security profile

Stop / Kill phase:
  - runtime / kubelet sends SIGTERM
  - sends SIGKILL after timeout
  - wait4 / waitid reaps exit state

Delete phase:
  - delete cgroup
  - unmount mounts
  - delete runtime state
  - clean network namespace / CNI configuration
```

The common misunderstanding is `create` versus `start`. `create` is not just forking a process. It prepares the Linux execution environment first. `start` is what truly lets the user-specified program run. OCI lifecycle documentation clearly separates create, start, running the user program, exit, and delete into different phases. ([GitHub][11])

---

## 7. System Calls Usually Involved When runc Creates a Container

The following are the most important Linux syscalls in container creation and startup. Different runtime versions may use `clone` or `clone3`, and different configurations may add or remove `unshare`, `setns`, `pivot_root`, `chroot`, `seccomp`, and other calls, but the trunk remains similar.

| Phase | Typical syscall | Purpose |
| --- | --- | --- |
| Process / namespace creation | `clone3()` / `clone()` | Create the container init process and specify namespace flags |
| Join existing namespace | `setns()` | Let an application container join the Pod sandbox netns and other namespaces |
| Split current namespace | `unshare()` | Detach the current process from selected namespaces |
| File-system isolation | `mount()` | Mount overlayfs, proc, sysfs, tmpfs, bind mounts |
| Root switch | `pivot_root()` / `chroot()` | Make the container rootfs become `/` |
| Working directory | `chdir()` | Switch to the configured cwd |
| Permission control | `setuid()` / `setgid()` / `setgroups()` / `capset()` | Set container user and capabilities |
| Security limits | `prctl()` / `seccomp()` | Set no_new_privs and seccomp filter |
| Resource control | `mkdir()` / `openat()` / `write()` | Create cgroup directories and write `cgroup.procs`, `memory.max`, `cpu.max`, etc. |
| Execute program | `execve()` / `execveat()` | Replace with the user's business process |
| Stop container | `kill()` / `pidfd_send_signal()` | Send SIGTERM / SIGKILL |
| Reap process | `wait4()` / `waitid()` | Wait for container init to exit |
| Clean resources | `umount2()` / `rmdir()` / `unlinkat()` | Unmount rootfs, delete cgroup, clean state |

`clone` is central because it can both create a process and create new namespaces through flags. Its man page explicitly discusses both `clone()` and `clone3()`. ([man7.org][8]) `setns` is used to join an existing namespace, which is the key mechanism for multiple containers in a Kubernetes Pod to share a network namespace. ([man7.org][7])

---

## 8. Looking at How clone Creates a Container Process from Kernel Functions

After user space calls `clone3()` / `clone()`, the kernel roughly enters the process creation path. Function details vary across kernel versions, but the typical main line can be abstracted as:

```text
sys_clone / sys_clone3
  → kernel_clone
    → copy_process
      → copy_namespaces
        → create_new_namespaces / copy_namespaces
          → copy_mnt_ns
          → copy_utsname
          → copy_ipcs
          → copy_pid_ns
          → copy_net_ns
          → copy_cgroup_ns
      → cgroup_can_fork / cgroup_post_fork
      → sched_fork
      → copy_files / copy_fs / copy_sighand / copy_mm
    → wake_up_new_task
```

The point is not memorizing function names, but understanding that `copy_process` copies or shares process resources. Linux Kernel Labs explains that the basic execution unit in Linux is a task, represented by `task_struct`. Threads and processes are both represented as tasks and reference shared or independent resource structures through pointers. ([Linux Kernel Labs][12])

When `clone` flags include `CLONE_NEWNET`, `CLONE_NEWPID`, `CLONE_NEWNS`, and similar flags, the kernel does not let the new process continue sharing the corresponding namespace with the parent. Instead, it creates new namespace objects and organizes them through a new `nsproxy`. The source comment in `nsproxy.h` states that tasks sharing all namespaces share the same `nsproxy`, and that the `nsproxy` is copied when a namespace is cloned or unshared. ([GitHub][10])

---

## 9. Namespace Relationship between Pod Sandbox and Business Containers

A Pod can contain multiple containers, but they usually share the same network namespace. This is why containers in the same Pod can access each other through `localhost`, and why ports cannot conflict inside one Pod.

A typical process is:

```text
RunPodSandbox:
  runc creates a pause / sandbox process
  the pause process owns new netns, utsns, ipcns, etc.
  CNI plugin places one end of a veth into the sandbox netns
  the Pod obtains an IP

CreateContainer / StartContainer:
  runc creates the business container process
  for namespaces that need to be shared, it opens /proc/<pause-pid>/ns/net
  calls setns(fd, CLONE_NEWNET)
  business container enters the same Pod network namespace
  execve starts the business command
```

The value of the pause / sandbox process is not executing business logic, but "holding namespaces." Namespace lifetime is usually reference-driven. As long as there is still a process or an open namespace fd referencing it, the namespace does not disappear. The cgroup namespace documentation also says that a cgroup namespace lives as long as there are processes or mounts inside it, and it is destroyed when the last use disappears. ([Linux Kernel Documentation][9])

---

## 10. The Role of cgroups in Pods and Containers

cgroups have at least five responsibilities in Kubernetes.

First, resource limits. Pod / container CPU, memory, pids, hugepages, IO, and other limits ultimately map to cgroup controller files. The cgroup v2 documentation states that when a controller is available, it exposes interface files so allocation of the target resource can be observed or controlled. ([Linux Kernel Documentation][9])

Second, resource accounting. Container CPU usage, memory usage, OOM events, IO, and similar metrics usually come from cgroup files or kernel statistics, then are collected by kubelet, container runtime, cAdvisor, or Prometheus.

Third, process ownership. The runtime writes the container init process PID into the corresponding cgroup's `cgroup.procs`. Child processes forked by that process are born in the parent's cgroup by default. The cgroup v2 documentation explicitly states that a child process created by `fork()` is born in the cgroup that the parent belongs to at the time of the operation. ([Linux Kernel Documentation][9])

Fourth, lifecycle cleanup. After a container exits, the runtime can check whether there are remaining processes in the cgroup. cgroup v2 also provides `cgroup.kill`; writing `1` to it sends SIGKILL to all processes in that cgroup and its descendants. ([Linux Kernel Documentation][9])

Fifth, view isolation. cgroup namespaces can make `/proc/self/cgroup` inside a container show only relative paths rather than full host cgroup paths. Kernel documentation states that without a cgroup namespace, `/proc/$PID/cgroup` shows the full path, which can leak system-level information; cgroup namespaces limit that visibility. ([Linux Kernel Documentation][9])

My judgment is: **namespaces make a container "look like an independent machine," while cgroups prevent it from consuming resources as if it actually owned an entire machine. Both are necessary.**

---

## 11. Container rootfs and Mount Namespace

A container file system is not magically isolated. The runtime usually prepares image layers first, for example an overlayfs merged directory, and then mounts inside a new mount namespace:

```text
/
├── bin
├── etc
├── proc
├── sys
├── dev
├── tmp
└── app
```

Typical operations include:

```text
mount("overlay", merged, "overlay", ...)
mount("proc", "/proc", "proc", ...)
mount("tmpfs", "/dev", "tmpfs", ...)
mount("/host/path", "/container/path", MS_BIND, ...)
pivot_root(new_root, put_old)
umount2(put_old, MNT_DETACH)
```

The meaning of the mount namespace is that the container sees its own mount tree. The host's global mount view is not polluted when the container mounts `/proc`, bind mounts a volume, or switches rootfs. The ability of `clone` / `unshare` to create new namespaces is the prerequisite for mount namespace isolation. ([man7.org][8])

One point needs emphasis: **rootfs isolation is not the entire security boundary.** Without appropriate capabilities, seccomp, read-only mounts, device cgroups, and LSM restrictions, a container may still escape through kernel attack surfaces or incorrect mounts.

---

## 12. What Happens When an Application inside a Container Executes a System Call?

When Java / Go / C code inside a container calls `open()`, `read()`, `socket()`, `connect()`, `fork()`, or `mmap()`, it does not call a "container-specific kernel." It calls the same host Linux kernel.

The path is roughly:

```text
Application code
  → libc wrapper / Go runtime syscall wrapper
  → CPU syscall instruction
  → enter kernel syscall entry
  → dispatch by syscall number to sys_openat / sys_socket / sys_clone / ...
  → seccomp check
  → capability / LSM permission check
  → namespace view translation
  → cgroup resource accounting and limits
  → VFS / network / memory / scheduler subsystem execution
  → return to user space
```

Linux man-pages state that system calls are the fundamental interface between applications and the Linux kernel. ([man7.org][13]) `syscall(2)` also explains that `syscall()` is a small library function that triggers the assembly-level system-call interface using a specified system call number and arguments. ([man7.org][14])

seccomp is an important layer for container syscall security. The `seccomp(2)` documentation says seccomp filtering is based on system call numbers. Applications usually do not call system calls directly; they call C library wrappers, which then trigger the real syscall. The documentation also warns that the same wrapper can call different underlying syscalls across glibc versions or architectures; for example, newer glibc may implement `open()` through `openat()`. ([man7.org][15]) Kubernetes also states that seccomp can restrict system calls that a process makes from userspace into the kernel and can be applied to Pods and containers. ([Kubernetes][16])

A few concrete examples:

### 12.1 Calling `gethostname()` inside a Container

```text
app gethostname()
  → syscall
  → kernel reads current->nsproxy->uts_ns
  → returns the hostname in that UTS namespace
```

So the container sees the container hostname, not the host hostname. The reason is not that the application is rewritten. It is that the kernel returns different data based on the current task's namespace pointer.

### 12.2 Calling `socket()` / `connect()` inside a Container

```text
app socket(AF_INET, ...)
  → kernel creates socket based on current->nsproxy->net_ns
  → socket belongs to the container's netns
  → routing table, iptables/nftables, and NICs are that netns view
```

So containers in the same Pod share the network namespace, localhost, and port space. Different Pods have different netns, so the same port can be listened on repeatedly across Pods.

### 12.3 Calling `fork()` or Creating Threads in Go

```text
fork / clone
  → kernel checks pids cgroup limit
  → if pids.max would be exceeded, returns error
  → child process inherits the parent's cgroup
```

The cgroup v2 documentation states that the pids controller prevents new forks or clones after a specified limit is reached. If creating a new process would violate the cgroup PID policy, `fork()` or `clone()` returns `-EAGAIN`. ([Linux Kernel Documentation][9])

### 12.4 Allocating Memory inside a Container

```text
malloc / mmap / brk
  → kernel allocates virtual memory
  → physical pages are allocated on actual page fault
  → memory cgroup accounts the usage
  → exceeding memory.max triggers reclaim / OOM
```

So "out of memory" inside a container often does not mean the host is truly out of memory. It often means the memory limit of the cgroup that the container belongs to has been reached.

---

## 13. Full Container Startup: from PodSpec to execve

The following timeline connects the whole path.

### 13.1 kubelet Receives the Pod

After a Pod is scheduled to a Node, kubelet discovers that the Pod should run on this machine through its watch / sync loop. Kubernetes documentation states that once a Pod has been scheduled and bound to a Node, Kubernetes tries to run that Pod on the Node. ([Kubernetes][6])

### 13.2 kubelet Calls CRI to Create the Pod Sandbox

```text
kubelet
  → RuntimeService.RunPodSandbox(PodSandboxConfig)
```

At this stage, the runtime creates the sandbox container and prepares Pod-level namespaces. CRI is the primary protocol for kubelet to communicate with the container runtime. kubelet needs a working container runtime on the Node to start Pods and containers. ([Kubernetes][2])

### 13.3 runtime Calls CNI to Configure Networking

```text
containerd / CRI-O
  → CNI ADD
    → create veth pair
    → place one end into Pod netns
    → configure IP, route, DNS, iptables / nftables
```

CNI itself is not a Linux syscall. It is a network plugin protocol called by the runtime. Internally, plugins still rely on Linux capabilities such as netlink, mount namespaces, and setns.

### 13.4 kubelet Creates the Business Container

```text
kubelet
  → RuntimeService.CreateContainer
  → RuntimeService.StartContainer
```

The runtime prepares an OCI bundle, including `config.json` and rootfs. The OCI spec defines container configuration, execution environment, and lifecycle. ([GitHub][4])

### 13.5 runc create

```text
runc create <container-id>
  → read config.json
  → clone / clone3 creates init process
  → configure namespaces
  → configure cgroup
  → configure rootfs mounts
  → configure capabilities / seccomp
  → wait for start
```

The most important pieces here are `clone3()` / `clone()`, `setns()`, `mount()`, `pivot_root()`, and writing cgroup files. The `clone(2)` documentation covers both `clone()` and `clone3()` interfaces. ([man7.org][8])

### 13.6 runc start

```text
runc start <container-id>
  → release init process
  → execve(argv[0], argv, envp)
  → user business process starts running
```

The OCI runtime lifecycle explicitly treats `start` and running the user-specified program as independent lifecycle steps. ([GitHub][11])

---

## 14. How Is Docker's Path Different from Kubernetes' Path?

Running Docker locally:

```bash
docker run nginx
```

roughly follows:

```text
docker CLI
  → dockerd
    → containerd
      → containerd-shim
        → runc
          → Linux kernel
```

Running a Pod in Kubernetes roughly follows:

```text
kubelet
  → CRI
    → containerd / CRI-O / cri-dockerd
      → containerd-shim / runtime shim
        → runc
          → Linux kernel
```

So, **the difference between Docker and Kubernetes is mainly in upper-layer orchestration, API, lifecycle management, network model, and runtime interface. At the lower Linux container creation layer, both ultimately converge on OCI runtime plus Linux kernel primitives.**

This is why Kubernetes removing dockershim did not change the Linux container mechanism. Kubernetes explains that CRI was introduced so Kubernetes could interoperate with multiple runtimes. Docker Engine does not implement CRI, so Kubernetes once maintained dockershim as a temporary solution, and later removed it in v1.24. ([Kubernetes][3])

---

## 15. Container Stop and Destruction

Destroying a container is not simply killing one process. A typical process is:

```text
1. kubelet receives a request to delete Pod / stop container
2. execute preStop hook
3. CRI StopContainer
4. runtime sends SIGTERM to the container init process
5. wait for terminationGracePeriodSeconds
6. send SIGKILL after timeout
7. wait4 / waitid reaps the process
8. CRI RemoveContainer
9. delete cgroup
10. unmount mounts
11. CNI DEL removes networking
12. RemovePodSandbox
```

The OCI lifecycle clearly states that a container process may exit because of an error, crash, or runtime kill operation. After that, runtime delete is called, and the container must be destroyed by undoing the steps performed during the create phase. ([GitHub][11])

On cgroup v2, cleanup must pay special attention to remaining processes. If a process has not exited, the cgroup directory usually cannot be deleted cleanly. cgroup v2 provides `cgroup.kill`; writing `1` to this file in a non-root cgroup sends SIGKILL to all processes in that cgroup and its descendants. ([Linux Kernel Documentation][9])

---

## 16. Summary of Key Functions and Structures

### 16.1 Key User-Space Components

| Layer | Representative component | Role |
| --- | --- | --- |
| Orchestration layer | Kubernetes API Server / Scheduler / Controller | Manage desired state |
| Node agent | kubelet | Translate PodSpec into runtime operations |
| CRI runtime | containerd / CRI-O / cri-dockerd | Implement CRI, manage images, sandboxes, containers |
| runtime shim | containerd-shim-runc-v2 | Decouple containerd from container process lifecycle |
| OCI runtime | runc | Create containers from OCI spec through Linux syscalls |
| Network plugin | CNI plugin | Configure Pod network namespace |
| Kernel | Linux kernel | Provide namespaces, cgroups, VFS, network stack, scheduler |

### 16.2 Linux syscalls

| syscall | Role in container lifecycle |
| --- | --- |
| `clone3` / `clone` | Create container init process and new namespaces |
| `unshare` | Detach current process from original namespaces |
| `setns` | Join existing namespaces of the Pod sandbox |
| `mount` | Build the container mount tree |
| `pivot_root` / `chroot` | Switch container root directory |
| `execve` | Execute business program |
| `prctl` | Set no_new_privs, dumpable, and related flags |
| `seccomp` | Install syscall filter |
| `capset` | Set Linux capabilities |
| `setuid` / `setgid` | Set container user identity |
| `kill` / `pidfd_send_signal` | Stop container process |
| `wait4` / `waitid` | Reap container process |
| `umount2` | Unmount container file system |
| `openat` / `write` | Write cgroup, proc, and sysfs configuration |

### 16.3 Key Kernel Structures

| Structure | Role |
| --- | --- |
| `task_struct` | Core structure for Linux process / thread |
| `nsproxy` | Aggregates namespace pointers for the current task |
| `mnt_namespace` | Mount view |
| `pid_namespace` | PID view |
| `net` / `net_namespace` | Network stack view |
| `uts_namespace` | hostname/domainname view |
| `ipc_namespace` | IPC view |
| `cgroup_namespace` | cgroup path view |
| `css_set` / cgroup-related structures | Associate processes with cgroup subsystem state |
| `cred` | UID/GID/capability credentials |
| `mm_struct` | Process memory space |
| `fs_struct` | File-system context such as root and pwd |
| `files_struct` | File descriptor table |

---

## 17. A Pseudocode Model for Starting a Minimal Container

The following is not the literal runc source code. It abstracts the main path into a model that is easier to understand:

```c
int start_container(struct oci_spec *spec) {
    // Create cgroup directory and configure resource limits.
    mkdir("/sys/fs/cgroup/kubepods/.../container-id", 0755);
    write_file("memory.max", spec->memory_limit);
    write_file("cpu.max", spec->cpu_quota);

    // Create container init process with namespace isolation.
    pid_t pid = clone3(CLONE_NEWNS |
                       CLONE_NEWPID |
                       CLONE_NEWUTS |
                       CLONE_NEWIPC |
                       CLONE_NEWCGROUP |
                       maybe(CLONE_NEWNET),
                       child_stack);

    if (pid == 0) {
        // Join pod network namespace if this is an app container.
        if (spec->join_pod_netns) {
            int fd = open("/proc/<pause-pid>/ns/net", O_RDONLY);
            setns(fd, CLONE_NEWNET);
        }

        // Build container filesystem view.
        mount("overlay", spec->rootfs, "overlay", 0, spec->overlay_opts);
        mount("proc", "/proc", "proc", 0, NULL);
        mount("tmpfs", "/dev", "tmpfs", 0, NULL);
        pivot_root(spec->rootfs, spec->oldroot);
        chdir("/");

        // Apply process credentials and security profile.
        setgroups(...);
        setgid(spec->gid);
        setuid(spec->uid);
        capset(spec->capabilities);
        prctl(PR_SET_NO_NEW_PRIVS, 1);
        seccomp(SECCOMP_SET_MODE_FILTER, 0, spec->seccomp_prog);

        // Replace init process image with the user command.
        execve(spec->argv[0], spec->argv, spec->envp);
        _exit(127);
    }

    // Move process into configured cgroup.
    write_file("cgroup.procs", pid);

    return pid;
}
```

The core judgment behind this model is: **container creation is not completed by one syscall. It is a state-construction process composed of multiple syscalls and kernel subsystems.**

---

## 18. Conclusion

When Kubernetes and Docker run containers on Linux, they are not creating virtual machines. They are creating groups of processes isolated and constrained by the kernel. Kubernetes drives a container runtime through kubelet and CRI; Docker drives containerd through dockerd; both can eventually land on an OCI runtime such as runc. The OCI Runtime Specification defines the container lifecycle, and runc implements that lifecycle as Linux system calls. ([GitHub][11])

`nsproxy` is the key connection point between a process and its namespace set. It aggregates mount, PID, network, UTS, IPC, cgroup, time, and other namespaces into a structure referenced by `task_struct`. The kernel source clearly shows that `nsproxy` contains these namespace pointers and is copied when a namespace is cloned or unshared. ([GitHub][10])

cgroup is the core of resource governance. It does not create "the world the container sees." Instead, it controls "how many resources the container can consume" and provides accounting, limits, migration, freezing, kill, and related capabilities. The cgroup v2 documentation states that processes can be migrated into a cgroup by writing `cgroup.procs`, child processes are born in the parent's cgroup by default, and controllers control allocation of CPU, memory, IO, and other resources. ([Linux Kernel Documentation][9])

When an application inside a container executes a system call, it calls the same host kernel. A so-called "syscall inside a container" is simply a syscall whose handling, after entering the kernel, is affected by the current task's namespace, cgroup, capabilities, seccomp, LSM, mount namespace, network namespace, and other contexts. Linux documentation states that system calls are the fundamental interface between applications and the Linux kernel, and seccomp filtering works based on system call numbers. ([man7.org][13])

Ultimately, the relationship can be summarized in one sentence: **Kubernetes declares and orchestrates, containerd / Docker manages runtime behavior, runc translates the OCI specification into Linux syscalls, and the Linux kernel decides what a process can see through namespaces, what it can consume through cgroups, and how every operation inside a container is actually executed through the syscall path.**

[1]: https://docs.docker.com/engine/containers/run/ "Running containers | Docker Docs"
[2]: https://kubernetes.io/docs/concepts/containers/cri/ "Container Runtime Interface (CRI) | Kubernetes"
[3]: https://kubernetes.io/blog/2022/02/17/dockershim-faq/ "Updated: Dockershim Removal FAQ | Kubernetes"
[4]: https://github.com/opencontainers/runtime-spec/blob/main/spec.md "runtime-spec/spec.md at main · opencontainers/runtime-spec · GitHub"
[5]: https://containerd.io/?utm_source=chatgpt.com "containerd - An industry-standard container runtime with an ..."
[6]: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/ "Pod Lifecycle | Kubernetes"
[7]: https://man7.org/linux/man-pages/man7/namespaces.7.html?utm_source=chatgpt.com "namespaces(7) - Linux manual page"
[8]: https://man7.org/linux/man-pages/man2/clone.2.html "clone(2) - Linux manual page"
[9]: https://docs.kernel.org/admin-guide/cgroup-v2.html "Control Group v2 - The Linux Kernel documentation"
[10]: https://github.com/torvalds/linux/blob/master/include/linux/nsproxy.h "linux/include/linux/nsproxy.h at master · torvalds/linux · GitHub"
[11]: https://github.com/opencontainers/runtime-spec/blob/master/runtime.md "runtime-spec/runtime.md at main · opencontainers/runtime-spec · GitHub"
[12]: https://linux-kernel-labs.github.io/refs/heads/master/lectures/processes.html?utm_source=chatgpt.com "Processes - The Linux Kernel documentation"
[13]: https://man7.org/linux/man-pages/man2/syscalls.2.html?utm_source=chatgpt.com "syscalls(2) - Linux manual page"
[14]: https://man7.org/linux/man-pages/man2/syscall.2.html?utm_source=chatgpt.com "syscall(2) - Linux manual page"
[15]: https://man7.org/linux/man-pages/man2/seccomp.2.html "seccomp(2) - Linux manual page"
[16]: https://kubernetes.io/docs/tutorials/security/seccomp/?utm_source=chatgpt.com "Restrict a Container's Syscalls with seccomp"
