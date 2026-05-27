---
title: "acme.sh + Nginx 接入 HTTPS 完整操作指南"
category: "安全运维"
summary: "基于 stellhub.top 的真实 HTTPS 接入过程，整理 acme.sh、Let's Encrypt、Nginx、HTTP-01 验证、证书安装、自动续期和常见故障排查流程。"
tags:
  - "HTTPS"
  - "acme.sh"
  - "Nginx"
  - "Let's Encrypt"
  - "TLS"
readingDirection: "适合在为自建网站、博客、API 网关或 SaaS 服务配置 HTTPS、申请 Let's Encrypt 证书、排查 ACME HTTP-01 验证或 Nginx TLS 配置问题时阅读。"
outline: deep
---

# acme.sh + Nginx 接入 HTTPS 完整操作指南

## 概览

基于 stellhub.top 的真实 HTTPS 接入过程，整理 acme.sh、Let's Encrypt、Nginx、HTTP-01 验证、证书安装、自动续期和常见故障排查流程。

> 本文基于一次真实的 `stellhub.top` HTTPS 接入过程整理，覆盖从 0 准备、申请证书、Nginx 接入 HTTPS、自动续期，到常见错误 FAQ。

---

## 1. 方案结论

使用 `acme.sh + Let's Encrypt + Nginx` 给自建网站接入 HTTPS 是完全可行的。

这套方案的特点：

* 免费
* 浏览器认可
* 自动续期
* 适合个人网站、博客、SaaS、自建 API、微服务网关
* 工程上足够稳定，不需要购买商业证书

需要强调一点：

`acme.sh` 不是 CA，它只是 ACME 客户端。

真正签发证书的是：

* Let's Encrypt
* ZeroSSL
* Google Trust Services

只要证书来自这些公开 CA，Chrome、Edge、Safari、Firefox 等主流浏览器都会信任。

---

## 2. 最终目标架构

最终访问链路如下：

```text
Browser
  ↓ HTTPS :443
Nginx
  ↓ HTTP :8080
Application
```

也就是说：

* HTTPS 证书配置在 Nginx 上
* Nginx 负责 TLS 终止
* 后端应用继续监听本地 HTTP 端口，例如 `127.0.0.1:8080`

这是最常见、最正确的部署方式。

---

## 3. 前置条件

以域名 `stellhub.top` 为例，需要先满足以下条件。

### 3.1 域名解析正确

你的域名需要解析到服务器公网 IP。

检查：

```bash
nslookup stellhub.top
nslookup www.stellhub.top
```

或者：

```bash
ping stellhub.top
```

确认解析结果是你的服务器公网 IP。

---

### 3.2 云服务器安全组放行端口

必须开放：

| 端口  | 作用              |
| --- | --------------- |
| 80  | ACME HTTP-01 验证 |
| 443 | HTTPS 访问        |

如果使用阿里云、腾讯云、华为云、AWS、Google Cloud，需要到安全组 / 防火墙规则里放行：

```text
TCP 80   0.0.0.0/0
TCP 443  0.0.0.0/0
```

---

### 3.3 服务器本机防火墙放行

如果启用了 `firewalld`：

```bash
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload
```

如果没有启用，可以忽略。

---

## 4. 安装 Nginx

CentOS / Rocky / AlmaLinux：

```bash
yum install -y nginx
```

启动并设置开机自启：

```bash
systemctl enable nginx
systemctl start nginx
```

检查状态：

```bash
systemctl status nginx
```

检查监听端口：

```bash
ss -lntp | grep nginx
```

---

## 5. 安装 acme.sh

安装：

```bash
curl https://get.acme.sh | sh
```

加载环境变量：

```bash
source ~/.bashrc
```

验证：

```bash
acme.sh --version
```

设置默认 CA 为 Let's Encrypt：

```bash
acme.sh --set-default-ca --server letsencrypt
```

---

## 6. 第一步：先配置 Nginx 支持 HTTP 验证

申请证书前，Let's Encrypt 需要通过 HTTP 访问你的服务器，验证你确实拥有这个域名。

它会访问类似地址：

```text
http://stellhub.top/.well-known/acme-challenge/xxxxx
```

所以 Nginx 必须先能正常提供 80 端口服务。

---

## 7. 可直接覆盖 `/etc/nginx/nginx.conf` 的 HTTP 验证配置

> 这是证书申请阶段使用的最小可用配置。

```nginx
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    keepalive_timeout 65;

    server {
        listen 80;
        server_name stellhub.top www.stellhub.top;

        root /usr/share/nginx/html;

        location /.well-known/acme-challenge/ {
            root /usr/share/nginx/html;
            try_files $uri =404;
        }

        location / {
            return 200 "acme ok\n";
        }
    }
}
```

保存后检查：

```bash
nginx -t
```

如果没问题，启动或重启 Nginx：

```bash
systemctl restart nginx
```

测试 HTTP：

```bash
curl http://stellhub.top
curl http://www.stellhub.top
```

期望返回：

```text
acme ok
```

---

## 8. 测试 ACME 验证目录

创建测试文件：

```bash
mkdir -p /usr/share/nginx/html/.well-known/acme-challenge

echo test > /usr/share/nginx/html/.well-known/acme-challenge/test.txt
```

访问：

```bash
curl http://stellhub.top/.well-known/acme-challenge/test.txt
curl http://www.stellhub.top/.well-known/acme-challenge/test.txt
```

期望返回：

```text
test
```

只有这一步通过，`acme.sh --issue --webroot` 才有意义。

---

## 9. 申请证书

执行：

```bash
acme.sh --issue -d stellhub.top -d www.stellhub.top \
  --webroot /usr/share/nginx/html
```

成功时会看到类似输出：

```text
Verifying: stellhub.top
Success
Verifying: www.stellhub.top
Success
Cert success.
```

证书默认生成在：

```text
/root/.acme.sh/stellhub.top_ecc/
```

目录中通常包含：

| 文件                 | 作用       |
| ------------------ | -------- |
| `stellhub.top.key` | 私钥       |
| `stellhub.top.cer` | 域名证书     |
| `ca.cer`           | 中间 CA 证书 |
| `fullchain.cer`    | 完整证书链    |

Nginx 最终应该使用：

```text
fullchain.cer
stellhub.top.key
```

---

## 10. 证书内容是否需要自己保存？

不需要。

`acme.sh` 输出的：

```text
-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----
```

不需要手动复制保存。

正确做法是用 `acme.sh --install-cert` 把证书安装到 Nginx 专用目录。

不要让 Nginx 直接依赖 `/root/.acme.sh/...` 目录。

原因：

* `/root` 目录权限不适合 Nginx 直接读取
* 路径不适合作为服务运行时依赖
* 不利于后续统一管理
* `--install-cert` 可以绑定自动续期后的 reload 动作

---

## 11. 安装证书到 Nginx 目录

创建证书目录：

```bash
mkdir -p /etc/nginx/ssl
```

安装证书：

```bash
acme.sh --install-cert -d stellhub.top \
  --key-file       /etc/nginx/ssl/stellhub.key \
  --fullchain-file /etc/nginx/ssl/stellhub.cer \
  --reloadcmd     "systemctl reload nginx"
```

这里的 `/etc/nginx/ssl/stellhub.cer` 实际上是 `fullchain.cer`。

后续证书自动续期时，acme.sh 会自动更新这里的文件，并执行：

```bash
systemctl reload nginx
```

---

## 12. 最终 HTTPS 版 Nginx 配置

证书安装完成后，可以把 `/etc/nginx/nginx.conf` 更新为下面的最终版本。

```nginx
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    keepalive_timeout 65;

    server {
        listen 80;
        server_name stellhub.top www.stellhub.top;

        location /.well-known/acme-challenge/ {
            root /usr/share/nginx/html;
            try_files $uri =404;
        }

        location / {
            return 301 https://$host$request_uri;
        }
    }

    server {
        listen 443 ssl http2;
        server_name stellhub.top www.stellhub.top;

        ssl_certificate     /etc/nginx/ssl/stellhub.cer;
        ssl_certificate_key /etc/nginx/ssl/stellhub.key;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;

        location / {
            proxy_pass http://127.0.0.1:8080;

            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

如果你的后端不是 `8080`，需要把下面这一行改成真实端口：

```nginx
proxy_pass http://127.0.0.1:8080;
```

如果你暂时没有后端应用，可以先改成：

```nginx
location / {
    return 200 "https ok\n";
}
```

---

## 13. 应用最终配置

检查 Nginx 配置：

```bash
nginx -t
```

重启 Nginx：

```bash
systemctl restart nginx
```

检查端口：

```bash
ss -lntp | grep nginx
```

应该看到：

```text
:80
:443
```

测试 HTTPS：

```bash
curl -I https://stellhub.top
curl -I https://www.stellhub.top
```

浏览器访问：

```text
https://stellhub.top
```

看到安全锁，才算真正接入成功。

---

## 14. 自动续期

Let's Encrypt 证书有效期通常是 90 天。

`acme.sh` 安装后会自动配置 cron。

检查：

```bash
crontab -l
```

通常会看到：

```bash
~/.acme.sh/acme.sh --cron --home ~/.acme.sh
```

手动模拟续期：

```bash
acme.sh --cron --force
```

查看证书列表：

```bash
acme.sh --list
```

---

# 15. FAQ：本次实际遇到的问题整理

## FAQ 1：执行 `acme.sh --issue` 报 `Connection refused`

### 现象

```text
Fetching http://stellhub.top/.well-known/acme-challenge/xxx: Connection refused
```

### 原因

Let's Encrypt 访问你的 80 端口失败。

这不是证书问题，也不是 acme.sh 命令问题，而是公网 HTTP 服务没有打通。

常见原因：

* Nginx 没启动
* Nginx 没监听 80 端口
* 云服务器安全组没放行 80
* 本机防火墙没放行 80
* 域名解析到了错误 IP

### 排查命令

```bash
ss -lntp | grep ':80'
systemctl status nginx
curl http://127.0.0.1
curl http://stellhub.top
```

### 解决方案

确保：

* Nginx 正常运行
* 监听 80 端口
* 安全组开放 TCP 80
* `curl http://stellhub.top` 能返回内容

---

## FAQ 2：`nginx -t` 报 `"server" directive is not allowed here`

### 现象

```text
nginx: [emerg] "server" directive is not allowed here in /etc/nginx/nginx.conf:1
```

### 原因

你把：

```nginx
server {
}
```

直接写在了 `/etc/nginx/nginx.conf` 顶层。

这是错误的。

Nginx 配置有层级：

```text
main
 ├── events
 └── http
      └── server
           └── location
```

`server {}` 必须写在 `http {}` 里面。

### 正确写法

```nginx
http {
    server {
        listen 80;
    }
}
```

---

## FAQ 3：执行 `nginx -s reload` 报 `/run/nginx.pid` 不存在

### 现象

```text
nginx: [error] open() "/run/nginx.pid" failed (2: No such file or directory)
```

### 原因

Nginx 根本没有运行。

`reload` 的前提是已经有 Nginx master 进程存在。

### 错误操作

```bash
nginx -s reload
```

但 Nginx 没启动。

### 正确操作

先检查配置：

```bash
nginx -t
```

再启动：

```bash
systemctl start nginx
```

之后修改配置才使用：

```bash
systemctl reload nginx
```

建议统一使用 systemctl，不要混用太多命令。

---

## FAQ 4：证书申请成功后，为什么浏览器还不是 HTTPS？

### 原因

证书申请成功只代表文件已经生成。

还需要：

* 安装证书到 Nginx 目录
* 配置 `listen 443 ssl`
* 配置 `ssl_certificate`
* 配置 `ssl_certificate_key`
* 重启 Nginx

### 正确流程

```bash
acme.sh --install-cert -d stellhub.top \
  --key-file       /etc/nginx/ssl/stellhub.key \
  --fullchain-file /etc/nginx/ssl/stellhub.cer \
  --reloadcmd     "systemctl reload nginx"
```

然后配置：

```nginx
server {
    listen 443 ssl http2;
    server_name stellhub.top www.stellhub.top;

    ssl_certificate     /etc/nginx/ssl/stellhub.cer;
    ssl_certificate_key /etc/nginx/ssl/stellhub.key;
}
```

---

## FAQ 5：acme.sh 输出的证书内容要不要手动保存？

不需要。

不要手动复制 PEM 文本。

证书已经保存到了：

```text
/root/.acme.sh/stellhub.top_ecc/
```

生产使用时通过 `--install-cert` 安装到：

```text
/etc/nginx/ssl/
```

---

## FAQ 6：Nginx 应该使用哪个证书文件？

应该使用 fullchain。

在本文方案中：

```nginx
ssl_certificate     /etc/nginx/ssl/stellhub.cer;
ssl_certificate_key /etc/nginx/ssl/stellhub.key;
```

其中：

```text
/etc/nginx/ssl/stellhub.cer
```

来自：

```text
fullchain.cer
```

不要只配置单独的域名证书，否则部分客户端可能因为缺少中间证书链而报错。

---

## FAQ 7：HTTP 是否还需要保留？

需要。

80 端口建议保留两个作用：

1. HTTP 自动跳转 HTTPS
2. 给后续 ACME 续期保留验证入口

推荐配置：

```nginx
server {
    listen 80;
    server_name stellhub.top www.stellhub.top;

    location /.well-known/acme-challenge/ {
        root /usr/share/nginx/html;
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
```

---

## FAQ 8：是否需要购买证书？

绝大多数情况不需要。

对于：

* 个人网站
* 技术博客
* SaaS
* 自建管理后台
* API 网关

Let's Encrypt 足够。

真正需要购买商业证书的场景通常是：

* 金融机构
* 政企客户强制要求
* 特殊合规要求
* 企业品牌型 OV / EV 证书需求

否则，买证书性价比很低。

---

## FAQ 9：可以用 IP 申请证书吗？

通常不行。

公开 HTTPS 证书一般基于域名签发。

应该使用：

```text
stellhub.top
www.stellhub.top
```

而不是：

```text
47.84.192.24
```

---

## FAQ 10：泛域名证书怎么申请？

如果后续你想支持：

```text
*.stellhub.top
```

需要使用 DNS-01 验证，而不是 HTTP-01。

示例：

```bash
acme.sh --issue -d stellhub.top -d '*.stellhub.top' --dns dns_cf
```

具体命令取决于 DNS 服务商，比如：

* Cloudflare
* 阿里云 DNS
* 腾讯云 DNSPod
* Route53

泛域名证书更适合多子域名场景，例如：

```text
api.stellhub.top
grafana.stellhub.top
prometheus.stellhub.top
blog.stellhub.top
```

---

## FAQ 11：`www.stellhub.top` 也需要单独配置吗？

需要。

如果申请证书时包含：

```bash
-d stellhub.top -d www.stellhub.top
```

那么 Nginx 的 `server_name` 也应该包含：

```nginx
server_name stellhub.top www.stellhub.top;
```

否则可能出现某个域名能访问，另一个域名行为不符合预期。

---

## FAQ 12：为什么建议不用 `/root/.acme.sh` 作为 Nginx 证书路径？

因为这是 acme.sh 的内部工作目录，不适合作为服务运行时配置路径。

更合理的路径是：

```text
/etc/nginx/ssl/
```

好处：

* 语义清晰
* 权限更可控
* 方便备份
* 方便排查
* 适合多站点管理

---

## FAQ 13：如何确认 Nginx 是否真的监听了 443？

执行：

```bash
ss -lntp | grep ':443'
```

如果没有输出，说明 HTTPS server 没有生效。

继续检查：

```bash
nginx -t
systemctl status nginx
journalctl -u nginx -n 100 --no-pager
```

---

## FAQ 14：后端服务没启动会不会影响 HTTPS？

会影响页面访问，但不影响 TLS 握手。

如果 Nginx 配置了：

```nginx
proxy_pass http://127.0.0.1:8080;
```

但 8080 没有服务，访问 HTTPS 时可能出现：

```text
502 Bad Gateway
```

这说明 HTTPS 层已经通了，但后端应用没起来。

临时测试可以改成：

```nginx
location / {
    return 200 "https ok\n";
}
```

---

## 16. 推荐的最终命令清单

完整流程可以浓缩为下面这组命令。

```bash
# Install acme.sh
curl https://get.acme.sh | sh
source ~/.bashrc

# Use Let's Encrypt
acme.sh --set-default-ca --server letsencrypt

# Check nginx config
nginx -t
systemctl restart nginx

# Issue cert
acme.sh --issue -d stellhub.top -d www.stellhub.top \
  --webroot /usr/share/nginx/html

# Install cert for nginx
mkdir -p /etc/nginx/ssl

acme.sh --install-cert -d stellhub.top \
  --key-file       /etc/nginx/ssl/stellhub.key \
  --fullchain-file /etc/nginx/ssl/stellhub.cer \
  --reloadcmd     "systemctl reload nginx"

# Reload nginx
nginx -t
systemctl restart nginx

# Verify
curl -I https://stellhub.top
curl -I https://www.stellhub.top
```

---
