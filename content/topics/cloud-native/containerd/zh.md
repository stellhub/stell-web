# 从 Linux 内核视角理解 Kubernetes 与 Docker：Pod / 容器的创建、运行、系统调用与销毁机制

## 摘要

Kubernetes 和 Docker 表面上是“容器平台”和“容器工具”，但它们真正依赖的是 Linux 内核已经存在的进程、namespace、cgroup、mount、capability、seccomp、文件系统和网络能力。我的判断是：**容器不是虚拟机，容器本质上是被 Linux 内核隔离、限制、改造过运行环境的一组进程**。Docker 官方也明确说，容器是在宿主机上运行的一个进程，只是拥有独立文件系统、网络和进程树等隔离视图。([Docker Documentation][1])

本文按论文式结构，沿着 **Kubernetes Pod 生命周期 → CRI → containerd / Docker → runc → Linux 内核系统调用 → 容器内应用 syscall 路径** 展开，重点解释 `nsproxy`、namespace、cgroup 在容器创建、启动、运行、销毁中的作用，并给出一个 Pod 和一个容器启动过程中通常涉及的 Linux 系统调用与关键内核函数。

**关键词**：Kubernetes，Docker，containerd，runc，namespace，nsproxy，cgroup，clone3，setns，mount，execve，seccomp，OCI Runtime

---

## 1. 引言：Kubernetes 和 Docker 到底在 Linux 上运行了什么？

先给结论：**Kubernetes 不直接“运行容器”，Docker 也不直接等于“容器本身”。它们最终都是在驱动 Linux 创建一个或多个普通进程，只是这些进程被放进了特定 namespace、cgroup、rootfs、capability、seccomp profile 和网络环境里。**

在现代 Kubernetes 中，kubelet 通过 CRI 和容器运行时通信；CRI 是 kubelet 与 container runtime 之间的主协议，kubelet 作为 gRPC 客户端连接容器运行时，运行时负责真正创建 Pod 和容器。([Kubernetes][2]) Kubernetes 官方也说明，从 v1.24 开始，内置 dockershim 已经移除；Docker Engine 本身不实现 CRI，因此 Kubernetes 需要通过 CRI 兼容运行时，例如 containerd、CRI-O，或者额外的 cri-dockerd 适配 Docker。([Kubernetes][3])

因此，在 Linux 上看容器技术，正确分层应该是：

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

OCI Runtime Specification 定义了容器配置、执行环境和生命周期，`config.json` 描述容器创建所需字段，runtime 负责基于这些字段创建一致的执行环境。([GitHub][4]) 这就是为什么 Docker、containerd、CRI-O 最终都可以落到 runc 或其他 OCI runtime 上。

---

## 2. 研究对象与边界

本文讨论的是 Linux 容器主路径，尤其是 Kubernetes + containerd + runc，以及 Docker Engine + containerd + runc 这两条常见链路。不同版本、不同 runtime、不同发行版、是否启用 cgroup v1 / v2、rootless、user namespace、systemd cgroup driver、CNI 插件实现，都会导致细节差异，但主干机制是一致的。containerd 官方说明它管理宿主机上的完整容器生命周期，包括镜像传输、存储、容器执行、监督、底层存储和网络附件等。([containerd.io][5])

本文不把 Kubernetes 的调度器、控制器、API Server 作为重点，而是聚焦在 Pod 已经调度到某个 Node 后，kubelet 如何把 PodSpec 转换为 Linux 进程。Kubernetes 官方 Pod 生命周期文档说明：Pod 被调度绑定到 Node 后，kubelet 会管理容器，并把 Pod spec 翻译给容器运行时。([Kubernetes][6])

---

## 3. Linux 容器的三个核心事实

### 3.1 容器首先是进程

容器里运行的 Java、Go、Nginx、MySQL，本质上仍然是宿主机 Linux 上的进程。区别在于，这些进程看到的 PID、网络设备、mount 树、hostname、IPC、cgroup 路径等不是宿主机全局视图，而是 namespace 裁剪后的视图。Docker 官方对 `docker run` 的描述非常直接：容器进程运行在宿主机上，并拥有自己的文件系统、网络和隔离的进程树。([Docker Documentation][1])

### 3.2 namespace 负责“看见什么”

namespace 的职责是隔离内核资源视图。比如：

| namespace         | 作用                                   |
| ----------------- | ------------------------------------ |
| PID namespace     | 容器内看到自己的 PID 1、PID 树                 |
| Mount namespace   | 容器内看到自己的 rootfs、挂载点                  |
| Network namespace | 容器内看到自己的网卡、路由表、端口空间                  |
| UTS namespace     | 容器内看到自己的 hostname、domainname         |
| IPC namespace     | 隔离 System V IPC、POSIX message queue  |
| User namespace    | 隔离 UID/GID 映射                        |
| Cgroup namespace  | 隔离 `/proc/self/cgroup` 看到的 cgroup 路径 |
| Time namespace    | 隔离部分时间视图                             |

Linux man-pages 说明，`setns(2)` 可以让调用进程加入已有 namespace，而 namespace 通常可以通过 `/proc/pid/ns` 文件描述符引用。([man7.org][7]) `clone(2)` / `clone3(2)` 则是创建新进程、线程以及新 namespace 的关键系统调用接口。([man7.org][8])

### 3.3 cgroup 负责“能用多少”

cgroup 不主要负责“看见什么”，而是负责资源归属、限制、统计和控制。Linux cgroup v2 官方文档明确说明，它是 cgroup v2 设计、接口和约定的权威文档。([Linux内核文档][9]) 在 cgroup v2 中，`cgroup.procs` 可以列出属于该 cgroup 的进程 PID，也可以通过向目标 cgroup 的 `cgroup.procs` 写入 PID 来迁移进程。([Linux内核文档][9])

cgroup controller 决定资源如何分配。例如 `cpu`、`memory`、`io` controller 可以控制子 cgroup 对 CPU、内存、IO 的使用；父 cgroup 通过开启 controller 来控制其子层级的资源分配。([Linux内核文档][9]) Kubernetes 的 CPU limit、memory limit、QoS、Pod cgroup 层级，本质都要落到这些内核接口上。

---

## 4. nsproxy：namespace 在内核里的“指针集合”

`nsproxy` 是理解容器隔离的关键。Linux 内核源码中的 `struct nsproxy` 包含多个 namespace 指针，例如 `uts_ns`、`ipc_ns`、`mnt_ns`、`pid_ns_for_children`、`net_ns`、`time_ns`、`cgroup_ns`。源码注释还说明：共享所有 namespace 的 task 可以共享同一个 `nsproxy`；一旦 clone 或 unshare 某个 namespace，`nsproxy` 就会被复制。([GitHub][10])

简化理解：

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

这说明一件很重要的事：**容器隔离不是靠给进程打一个“container”标签实现的，而是 task_struct 间接引用了一组 namespace 对象。** 当 runc 创建容器 init 进程时，它通过 `clone` / `clone3` 传入 `CLONE_NEWNS`、`CLONE_NEWPID`、`CLONE_NEWNET`、`CLONE_NEWUTS`、`CLONE_NEWIPC`、`CLONE_NEWCGROUP` 等 flags，内核创建或复制 namespace 对象，再把新进程的 `task_struct->nsproxy` 指向这组 namespace。`clone(2)` man page 明确说明它描述了 glibc `clone()` wrapper、底层系统调用以及较新的 `clone3()` 系统调用。([man7.org][8])

我的判断是：**nsproxy 是 Linux 容器隔离的“索引结构”，namespace 对象才是隔离视图本身。** 没有 `nsproxy`，你很难把“一个进程同时处于多个 namespace 中”这个事实组织起来。

---

## 5. Kubernetes 中一个 Pod 的启动路径

一个 Pod 的创建，不是直接启动业务容器，而是通常先创建 Pod sandbox。Kubernetes CRI 把 kubelet 与 runtime 的交互标准化，kubelet 通过 CRI gRPC 与 runtime 通信。([Kubernetes][2])

典型调用链如下：

```text
1. 用户提交 Pod YAML
2. API Server 持久化 PodSpec
3. Scheduler 把 Pod 绑定到某个 Node
4. 该 Node 上的 kubelet 发现待运行 Pod
5. kubelet 调用 CRI RuntimeService.RunPodSandbox
6. runtime 创建 Pod sandbox
7. CNI 为 sandbox 配置网络
8. kubelet 调用 CreateContainer
9. kubelet 调用 StartContainer
10. 容器内业务进程 execve 启动
11. kubelet 持续探测、重启、停止、删除
```

Kubernetes 官方文档描述 Pod 生命周期时说明：Pod 从 `Pending` 开始，如果至少一个主容器成功启动则进入 `Running`，之后根据容器是否失败进入 `Succeeded` 或 `Failed`；同时 kubelet 在 Pod 运行期间管理容器，并把 Pod spec 翻译给容器 runtime。([Kubernetes][6])

Pod sandbox 的核心作用是为 Pod 建立共享环境，尤其是 network namespace。对于普通 Linux runtime，Pod sandbox 通常对应 pause 容器或类似 infra 容器：它先创建并持有 Pod 的 network namespace，后续业务容器通过 `setns` 加入该 namespace。Kubernetes 文档没有把 pause 容器实现细节固定死，因为 CRI 留给 runtime 一定解释空间；CRI 的核心是 kubelet 与 runtime 的协议，而不是强制某一种底层实现。([Kubernetes][2])

---

## 6. 一个容器的 OCI 生命周期

OCI Runtime Specification 给出的生命周期是理解 runc 的主线。OCI runtime 的 `create` 命令会被调用，随后执行 hooks；`start` 命令被调用后，runtime 必须运行用户指定程序；进程退出可能来自错误、正常退出、崩溃或 runtime 的 kill 操作；最后 `delete` 被调用，容器必须通过撤销 create 阶段的步骤被销毁。([GitHub][11])

简化成工程视角：

```text
Create 阶段：
  - 准备 rootfs
  - 准备 mount namespace
  - 配置 cgroup
  - 配置 namespace
  - 配置 capabilities
  - 配置 seccomp / AppArmor / SELinux
  - 创建但不一定立即执行用户程序

Start 阶段：
  - 放行容器 init 进程
  - execve 用户指定 command
  - 业务进程成为容器内主进程

Run 阶段：
  - 业务进程发起 syscall
  - 内核基于 namespace/cgroup/security profile 处理

Stop / Kill 阶段：
  - runtime / kubelet 发送 SIGTERM
  - 超时后 SIGKILL
  - wait4 / waitid 回收退出状态

Delete 阶段：
  - 删除 cgroup
  - 卸载 mount
  - 删除 runtime state
  - 清理网络 namespace / CNI 配置
```

这里最容易误解的是 `create` 和 `start`。`create` 不是简单 fork 一个进程就完事，它要先把 Linux 执行环境准备好；`start` 才真正让用户指定的程序运行。OCI 生命周期文档明确把 create、start、运行用户程序、退出、delete 分成了不同阶段。([GitHub][11])

---

## 7. runc 创建容器时通常涉及的系统调用

下面是容器创建启动过程中最关键的一批 Linux syscall。不同 runtime 版本可能用 `clone` 或 `clone3`，不同配置可能增减 `unshare`、`setns`、`pivot_root`、`chroot`、`seccomp` 等调用，但主干不会变。

| 阶段               | 典型 syscall                                           | 作用                                                      |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| 创建进程 / namespace | `clone3()` / `clone()`                               | 创建容器 init 进程，并指定 namespace flags                        |
| 加入已有 namespace   | `setns()`                                            | 业务容器加入 Pod sandbox 的 netns 等                            |
| 拆分当前 namespace   | `unshare()`                                          | 当前进程脱离某些 namespace                                      |
| 文件系统隔离           | `mount()`                                            | 挂载 overlayfs、proc、sysfs、tmpfs、bind mount                |
| 根目录切换            | `pivot_root()` / `chroot()`                          | 把容器 rootfs 变成 `/`                                       |
| 工作目录             | `chdir()`                                            | 切到容器配置的 cwd                                             |
| 权限控制             | `setuid()` / `setgid()` / `setgroups()` / `capset()` | 设置容器内用户和 capability                                     |
| 安全限制             | `prctl()` / `seccomp()`                              | 设置 no_new_privs、seccomp 过滤                              |
| 资源控制             | `mkdir()` / `openat()` / `write()`                   | 创建 cgroup 目录、写入 `cgroup.procs`、`memory.max`、`cpu.max` 等 |
| 执行程序             | `execve()` / `execveat()`                            | 替换为用户业务进程                                               |
| 停止容器             | `kill()` / `pidfd_send_signal()`                     | 发送 SIGTERM / SIGKILL                                    |
| 回收进程             | `wait4()` / `waitid()`                               | 等待容器 init 退出                                            |
| 清理资源             | `umount2()` / `rmdir()` / `unlinkat()`               | 卸载 rootfs、删除 cgroup、清理状态                                |

`clone` 是这里的核心，因为它既能创建进程，也能通过 flags 创建新的 namespace；man page 明确把 `clone()` wrapper、底层 syscall 和 `clone3()` 放在同一页讨论。([man7.org][8]) `setns` 则用于加入已有 namespace，这正是 Kubernetes Pod 内多个容器共享网络 namespace 的关键机制。([man7.org][7])

---

## 8. 从内核函数看 clone 如何创建容器进程

用户态调用 `clone3()` / `clone()` 后，内核大致会走到进程创建路径。不同内核版本函数细节会变化，但典型主线可以抽象为：

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

这条路径的关键不是“函数名背诵”，而是理解 `copy_process` 会复制或共享进程资源。Linux Kernel Labs 对进程的讲解说明，Linux 的基本执行单元是 task，也就是 `task_struct`；线程和进程都用 task 表示，并通过指针引用共享或独立的资源结构。([Linux Kernel Labs][12])

当 `clone` flags 包含 `CLONE_NEWNET`、`CLONE_NEWPID`、`CLONE_NEWNS` 等标志时，内核不会让新进程继续共享父进程的对应 namespace，而是创建新的 namespace 对象，并通过新的 `nsproxy` 组织这些对象。`nsproxy.h` 源码注释明确说明，共享全部 namespace 的 task 共享 `nsproxy`；一旦某个 namespace 被 cloned 或 unshared，`nsproxy` 会被复制。([GitHub][10])

---

## 9. Pod sandbox 与业务容器的 namespace 关系

一个 Pod 里面可以有多个容器，但它们通常共享网络 namespace。这就是为什么同一个 Pod 里的容器可以通过 `localhost` 互相访问，也为什么同一个 Pod 内端口不能冲突。

典型过程如下：

```text
RunPodSandbox:
  runc 创建 pause / sandbox 进程
  pause 进程拥有新的 netns、utsns、ipcns 等
  CNI 插件把 veth 一端放入 sandbox netns
  Pod 获得 IP

CreateContainer / StartContainer:
  runc 创建业务容器进程
  对于需要共享的 namespace，打开 sandbox 的 /proc/<pause-pid>/ns/net
  调用 setns(fd, CLONE_NEWNET)
  业务容器进入同一个 Pod 网络命名空间
  execve 启动业务命令
```

这里 pause / sandbox 进程的价值不是执行业务，而是“持有 namespace”。namespace 的生命周期通常由引用决定，只要还有进程或打开的 namespace fd 引用它，namespace 就不会消失。cgroup namespace 文档也说明，cgroup namespace 只要内部还有进程或 mount 引用就存活，最后一个使用消失后 namespace 被销毁。([Linux内核文档][9])

---

## 10. cgroup 在 Pod / 容器中的作用

cgroup 在 Kubernetes 中至少承担五类职责：

第一，资源限制。Pod / container 的 CPU、memory、pids、hugepages、IO 等限制，最终都要落到 cgroup controller 文件。cgroup v2 文档说明，controller 可用时会暴露对应 interface files，使目标资源的分配可以被观察或控制。([Linux内核文档][9])

第二，资源统计。容器 CPU 使用量、内存使用量、OOM、IO 等指标，通常来自 cgroup 文件或内核统计，再被 kubelet、container runtime、cAdvisor、Prometheus 采集。

第三，进程归属。runtime 会把容器 init 进程 PID 写入对应 cgroup 的 `cgroup.procs`，子进程 fork 后默认出生在父进程所在 cgroup 中；cgroup v2 文档明确说明，进程 fork 出来的子进程会出生在 fork 时父进程所属的 cgroup。([Linux内核文档][9])

第四，生命周期清理。容器退出后，runtime 可以检查 cgroup 中是否还有残留进程；cgroup v2 还提供 `cgroup.kill` 机制，写入 `1` 可以对该 cgroup 及其后代发送 SIGKILL。([Linux内核文档][9])

第五，视图隔离。cgroup namespace 可以让容器内 `/proc/self/cgroup` 只看到相对路径，而不是宿主机完整 cgroup 路径；内核文档明确指出，没有 cgroup namespace 时 `/proc/$PID/cgroup` 会显示完整路径，这可能泄漏系统级信息，而 cgroup namespace 可以限制这种可见性。([Linux内核文档][9])

我的判断是：**namespace 让容器“像一台独立机器”，cgroup 让容器“不能像一台独立机器那样无限消耗资源”。二者缺一不可。**

---

## 11. 容器 rootfs 与 mount namespace

容器文件系统不是 magically isolated。runtime 通常先准备镜像层，例如 overlayfs merged 目录，然后在新的 mount namespace 中挂载：

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

典型操作包括：

```text
mount("overlay", merged, "overlay", ...)
mount("proc", "/proc", "proc", ...)
mount("tmpfs", "/dev", "tmpfs", ...)
mount("/host/path", "/container/path", MS_BIND, ...)
pivot_root(new_root, put_old)
umount2(put_old, MNT_DETACH)
```

Mount namespace 的意义是：容器里看到自己的挂载树，宿主机不会因为容器里 mount `/proc`、bind mount volume、切换 rootfs 而污染全局挂载视图。`clone` / `unshare` 创建新 namespace 的能力，是 mount namespace 生效的前提。([man7.org][8])

这里要强调：**rootfs 隔离不是安全边界的全部。** 如果没有合适的 capability、seccomp、只读挂载、device cgroup、LSM 限制，容器仍然可能通过内核攻击面或错误挂载逃逸。

---

## 12. 容器内应用执行系统调用时发生了什么？

容器内的 Java / Go / C 程序调用 `open()`、`read()`、`socket()`、`connect()`、`fork()`、`mmap()` 时，并不会调用什么“容器专用内核”。它调用的是同一个宿主机 Linux kernel。

路径大致是：

```text
应用代码
  → libc wrapper / Go runtime syscall wrapper
  → CPU syscall 指令
  → 进入内核 syscall entry
  → 根据 syscall number 分发到 sys_openat / sys_socket / sys_clone / ...
  → seccomp 检查是否允许
  → capability / LSM 权限检查
  → namespace 视图转换
  → cgroup 资源计费和限制
  → VFS / network / memory / scheduler 子系统执行
  → 返回用户态
```

Linux man-pages 明确说，system call 是应用程序和 Linux 内核之间的基本接口。([man7.org][13]) `syscall(2)` 也说明，`syscall()` 是一个小型库函数，用指定系统调用号和参数触发汇编层面的系统调用接口。([man7.org][14])

seccomp 是容器 syscall 安全的重要一层。`seccomp(2)` 文档指出，seccomp 过滤基于系统调用号；应用通常不会直接调用系统调用，而是调用 C library wrapper，再由 wrapper 触发真正的 syscall。文档还提醒，同一个 wrapper 在不同 glibc 版本或架构上可能调用不同底层 syscall，例如较新的 glibc 中 `open()` 可能走 `openat()`。([man7.org][15]) Kubernetes 官方也说明 seccomp 可以限制进程从 userspace 调入 kernel 的系统调用，并可应用到 Pod 和容器。([Kubernetes][16])

举几个具体例子：

### 12.1 容器内调用 `gethostname()`

```text
app gethostname()
  → syscall
  → kernel 读取 current->nsproxy->uts_ns
  → 返回该 UTS namespace 中的 hostname
```

所以容器里看到的是容器 hostname，不是宿主机 hostname。原因不是应用被改写了，而是内核根据当前 task 的 namespace 指针返回不同数据。

### 12.2 容器内调用 `socket()` / `connect()`

```text
app socket(AF_INET, ...)
  → kernel 根据 current->nsproxy->net_ns 创建 socket
  → socket 属于容器所在 netns
  → 路由表、iptables/nftables、网卡都是该 netns 视图
```

所以同一 Pod 内容器共享 network namespace 时，它们共享 localhost 和端口空间；不同 Pod 拥有不同 netns，所以同端口可以重复监听。

### 12.3 容器内调用 `fork()` / Go 创建线程

```text
fork / clone
  → 内核检查 pids cgroup 限制
  → 如果超过 pids.max，返回错误
  → 子进程继承父进程 cgroup
```

cgroup v2 文档说明，pids controller 用于在指定限制达到后阻止新的 fork 或 clone；如果创建新进程会违反 cgroup PID policy，`fork()` 或 `clone()` 会返回 `-EAGAIN`。([Linux内核文档][9])

### 12.4 容器内申请内存

```text
malloc / mmap / brk
  → 内核分配虚拟内存
  → 实际 page fault 时分配物理页
  → memory cgroup 计费
  → 超过 memory.max 触发 reclaim / OOM
```

所以容器内应用看到的“内存不足”，很多时候不是宿主机真的没内存，而是该容器所在 cgroup 的 memory limit 被打满。

---

## 13. 容器启动全过程：从 PodSpec 到 execve

下面用一个更完整的时间线串起来。

### 13.1 kubelet 接收 Pod

Pod 被调度到 Node 后，kubelet 通过 watch / sync loop 发现本机应运行该 Pod。Kubernetes 官方文档说明，Pod 一旦被调度并绑定到 Node，Kubernetes 会尝试在该 Node 上运行该 Pod。([Kubernetes][6])

### 13.2 kubelet 调用 CRI 创建 Pod sandbox

```text
kubelet
  → RuntimeService.RunPodSandbox(PodSandboxConfig)
```

这一阶段 runtime 会创建 sandbox 容器，并准备 Pod 级 namespace。CRI 是 kubelet 与 container runtime 通信的主协议；kubelet 需要 Node 上有可工作的 container runtime 才能启动 Pods 和 containers。([Kubernetes][2])

### 13.3 runtime 调用 CNI 配置网络

```text
containerd / CRI-O
  → CNI ADD
    → 创建 veth pair
    → 一端放入 Pod netns
    → 配置 IP、路由、DNS、iptables / nftables
```

CNI 本身不是 Linux syscall，而是 runtime 调用的网络插件协议；插件内部最终仍然使用 netlink、mount namespace、setns 等 Linux 能力。

### 13.4 kubelet 创建业务容器

```text
kubelet
  → RuntimeService.CreateContainer
  → RuntimeService.StartContainer
```

runtime 会准备 OCI bundle，其中包括 `config.json` 和 rootfs。OCI spec 明确规定了容器配置、执行环境和生命周期。([GitHub][4])

### 13.5 runc create

```text
runc create <container-id>
  → 读取 config.json
  → clone / clone3 创建 init 进程
  → 设置 namespace
  → 设置 cgroup
  → 设置 rootfs mount
  → 设置 capability / seccomp
  → 等待 start
```

这一步最关键的是 `clone3()` / `clone()`、`setns()`、`mount()`、`pivot_root()`、写 cgroup 文件。`clone(2)` 文档明确覆盖了 `clone()` 和 `clone3()` 两类接口。([man7.org][8])

### 13.6 runc start

```text
runc start <container-id>
  → 释放 init 进程
  → execve(argv[0], argv, envp)
  → 用户业务进程开始运行
```

OCI runtime lifecycle 明确把 `start` 与运行用户指定程序作为生命周期中的独立步骤。([GitHub][11])

---

## 14. Docker 的路径与 Kubernetes 的路径有什么不同？

Docker 本地执行：

```bash
docker run nginx
```

大致路径是：

```text
docker CLI
  → dockerd
    → containerd
      → containerd-shim
        → runc
          → Linux kernel
```

Kubernetes 执行 Pod，大致路径是：

```text
kubelet
  → CRI
    → containerd / CRI-O / cri-dockerd
      → containerd-shim / runtime shim
        → runc
          → Linux kernel
```

所以，**Docker 和 Kubernetes 的差异主要在上层编排、API、生命周期管理、网络模型和 runtime 接口；到底层 Linux 容器创建，最终都会收敛到 OCI runtime + Linux kernel primitives。**

这也是为什么 Kubernetes 移除 dockershim 并不意味着 Linux 容器机制改变了。Kubernetes 官方解释，CRI 是为了让 Kubernetes 可以和多种 runtime 互操作；Docker Engine 不实现 CRI，所以 Kubernetes 曾经维护 dockershim 作为临时方案，后来在 v1.24 移除。([Kubernetes][3])

---

## 15. 容器停止与销毁过程

容器销毁不是简单 kill 一个进程。典型过程如下：

```text
1. kubelet 收到删除 Pod / 停止容器需求
2. 执行 preStop hook
3. CRI StopContainer
4. runtime 向容器 init 进程发送 SIGTERM
5. 等待 terminationGracePeriodSeconds
6. 超时后发送 SIGKILL
7. wait4 / waitid 回收进程
8. CRI RemoveContainer
9. 删除 cgroup
10. 卸载 mount
11. CNI DEL 删除网络
12. RemovePodSandbox
```

OCI lifecycle 明确说明，容器进程退出可能由于错误、崩溃或 runtime kill 操作；之后 runtime delete 被调用，容器必须通过撤销 create 阶段执行的步骤被销毁。([GitHub][11])

在 cgroup v2 上，清理时要特别关注残留进程。如果进程没有退出，cgroup 目录通常无法正常删除。cgroup v2 提供 `cgroup.kill`，向非 root cgroup 的该文件写入 `1` 会导致该 cgroup 及其后代中的所有进程被 SIGKILL。([Linux内核文档][9])

---

## 16. 关键函数与关键结构总结

### 16.1 用户态关键组件

| 层级           | 代表组件                                           | 作用                                    |
| ------------ | ---------------------------------------------- | ------------------------------------- |
| 编排层          | Kubernetes API Server / Scheduler / Controller | 管理期望状态                                |
| Node agent   | kubelet                                        | 把 PodSpec 翻译为 runtime 操作              |
| CRI runtime  | containerd / CRI-O / cri-dockerd               | 实现 CRI，管理镜像、sandbox、容器                |
| runtime shim | containerd-shim-runc-v2                        | 解耦 containerd 与容器进程生命周期               |
| OCI runtime  | runc                                           | 根据 OCI spec 调 Linux syscall 创建容器      |
| 网络插件         | CNI plugin                                     | 配置 Pod network namespace              |
| 内核           | Linux kernel                                   | 提供 namespace、cgroup、VFS、net、scheduler |

### 16.2 Linux syscall

| syscall                      | 容器生命周期中的作用                  |
| ---------------------------- | --------------------------- |
| `clone3` / `clone`           | 创建容器 init 进程、新 namespace    |
| `unshare`                    | 当前进程脱离原 namespace           |
| `setns`                      | 加入 Pod sandbox 已有 namespace |
| `mount`                      | 构造容器挂载树                     |
| `pivot_root` / `chroot`      | 切换容器根目录                     |
| `execve`                     | 执行业务程序                      |
| `prctl`                      | 设置 no_new_privs、dumpable 等  |
| `seccomp`                    | 安装 syscall filter           |
| `capset`                     | 设置 Linux capabilities       |
| `setuid` / `setgid`          | 设置容器内用户身份                   |
| `kill` / `pidfd_send_signal` | 停止容器进程                      |
| `wait4` / `waitid`           | 回收容器进程                      |
| `umount2`                    | 卸载容器文件系统                    |
| `openat` / `write`           | 写 cgroup、proc、sysfs 配置      |

### 16.3 内核关键结构

| 结构                      | 作用                       |
| ----------------------- | ------------------------ |
| `task_struct`           | Linux 进程 / 线程的核心结构       |
| `nsproxy`               | 聚合当前 task 的 namespace 指针 |
| `mnt_namespace`         | mount 视图                 |
| `pid_namespace`         | PID 视图                   |
| `net` / `net_namespace` | 网络栈视图                    |
| `uts_namespace`         | hostname/domainname 视图   |
| `ipc_namespace`         | IPC 视图                   |
| `cgroup_namespace`      | cgroup 路径视图              |
| `css_set` / cgroup 相关结构 | 进程与 cgroup 子系统状态关联       |
| `cred`                  | UID/GID/capability 等凭证   |
| `mm_struct`             | 进程内存空间                   |
| `fs_struct`             | root、pwd 等文件系统上下文        |
| `files_struct`          | 文件描述符表                   |

---

## 17. 一个最小容器启动的伪代码模型

下面不是 runc 源码原文，而是把主路径抽象成可理解的模型：

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

这个模型的核心判断是：**容器创建不是一个 syscall 完成的，而是多个 syscall 和内核子系统协同完成的状态构造过程。**

---

## 18. 结论

Kubernetes 和 Docker 在 Linux 上运行容器，本质不是创建虚拟机，而是创建被内核隔离和约束的进程集合。Kubernetes 通过 kubelet 和 CRI 驱动 container runtime；Docker 通过 dockerd 驱动 containerd；二者最终都可以落到 OCI runtime，例如 runc。OCI Runtime Specification 定义容器生命周期，runc 则把生命周期落实为 Linux 系统调用。([GitHub][11])

`nsproxy` 是进程与 namespace 集合之间的关键连接点。它把 mount、PID、network、UTS、IPC、cgroup、time 等 namespace 聚合到 `task_struct` 可引用的结构中。内核源码明确显示，`nsproxy` 包含这些 namespace 指针，并且在 clone 或 unshare namespace 时会复制。([GitHub][10])

cgroup 是资源治理核心。它不负责制造“容器看到的世界”，而是负责控制“容器能消耗多少资源”，并提供统计、限制、迁移、冻结、kill 等能力。cgroup v2 官方文档说明，进程可以通过写 `cgroup.procs` 迁移到 cgroup，子进程默认出生在父进程所在 cgroup；controller 则控制 CPU、memory、IO 等资源分配。([Linux内核文档][9])

容器内应用执行系统调用时，调用的是同一个宿主机内核。所谓“容器内 syscall”，只是该 syscall 在进入内核后，会受到当前 task 的 namespace、cgroup、capability、seccomp、LSM、mount namespace、network namespace 等上下文影响。Linux 文档明确指出 system call 是应用与 Linux kernel 之间的基本接口，而 seccomp 过滤也是基于 syscall number 工作。([man7.org][13])

最终可以用一句话概括：**Kubernetes 负责声明和编排，containerd / Docker 负责运行时管理，runc 负责把 OCI 规范翻译成 Linux syscall，Linux 内核通过 namespace 决定进程“看见什么”，通过 cgroup 决定进程“能用多少”，通过 syscall 路径真正执行容器内应用的所有操作。**

[1]: https://docs.docker.com/engine/containers/run/ "Running containers | Docker Docs"
[2]: https://kubernetes.io/docs/concepts/containers/cri/ "Container Runtime Interface (CRI) | Kubernetes"
[3]: https://kubernetes.io/blog/2022/02/17/dockershim-faq/ "Updated: Dockershim Removal FAQ | Kubernetes"
[4]: https://github.com/opencontainers/runtime-spec/blob/main/spec.md "runtime-spec/spec.md at main · opencontainers/runtime-spec · GitHub"
[5]: https://containerd.io/?utm_source=chatgpt.com "containerd – An industry-standard container runtime with an ..."
[6]: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/ "Pod Lifecycle | Kubernetes"
[7]: https://man7.org/linux/man-pages/man7/namespaces.7.html?utm_source=chatgpt.com "namespaces(7) - Linux manual page"
[8]: https://man7.org/linux/man-pages/man2/clone.2.html "clone(2) - Linux manual page"
[9]: https://docs.kernel.org/admin-guide/cgroup-v2.html "Control Group v2 — The Linux Kernel  documentation"
[10]: https://github.com/torvalds/linux/blob/master/include/linux/nsproxy.h "linux/include/linux/nsproxy.h at master · torvalds/linux · GitHub"
[11]: https://github.com/opencontainers/runtime-spec/blob/master/runtime.md "runtime-spec/runtime.md at main · opencontainers/runtime-spec · GitHub"
[12]: https://linux-kernel-labs.github.io/refs/heads/master/lectures/processes.html?utm_source=chatgpt.com "Processes — The Linux Kernel documentation"
[13]: https://man7.org/linux/man-pages/man2/syscalls.2.html?utm_source=chatgpt.com "syscalls(2) - Linux manual page"
[14]: https://man7.org/linux/man-pages/man2/syscall.2.html?utm_source=chatgpt.com "syscall(2) - Linux manual page"
[15]: https://man7.org/linux/man-pages/man2/seccomp.2.html "seccomp(2) - Linux manual page"
[16]: https://kubernetes.io/docs/tutorials/security/seccomp/?utm_source=chatgpt.com "Restrict a Container's Syscalls with seccomp"
