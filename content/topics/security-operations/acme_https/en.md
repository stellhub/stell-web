> This article is based on a real HTTPS rollout for `stellhub.top`. It covers preparation from zero, certificate issuance, Nginx HTTPS integration, automatic renewal, and common error FAQ.

---

## 1. Solution Summary

Using `acme.sh + Let's Encrypt + Nginx` to enable HTTPS for a self-hosted website is fully feasible.

This solution is:

* Free
* Trusted by browsers
* Automatically renewable
* Suitable for personal websites, blogs, SaaS, self-hosted APIs, and microservice gateways
* Stable enough in engineering practice without purchasing commercial certificates

One point must be emphasized:

`acme.sh` is not a CA. It is only an ACME client.

The actual certificate issuers are:

* Let's Encrypt
* ZeroSSL
* Google Trust Services

As long as the certificate comes from these public CAs, mainstream browsers such as Chrome, Edge, Safari, and Firefox will trust it.

---

## 2. Final Target Architecture

The final access path is:

```text
Browser
  ↓ HTTPS :443
Nginx
  ↓ HTTP :8080
Application
```

That is:

* The HTTPS certificate is configured on Nginx
* Nginx performs TLS termination
* The backend application continues listening on a local HTTP port, such as `127.0.0.1:8080`

This is the most common and most correct deployment approach.

---

## 3. Prerequisites

Using the domain `stellhub.top` as an example, the following conditions must be satisfied first.

### 3.1 Domain DNS Resolution Is Correct

Your domain needs to resolve to the server's public IP.

Check:

```bash
nslookup stellhub.top
nslookup www.stellhub.top
```

Or:

```bash
ping stellhub.top
```

Confirm that the resolved result is your server's public IP.

---

### 3.2 Cloud Server Security Group Allows Ports

The following ports must be open:

| Port | Purpose |
| --- | --- |
| 80 | ACME HTTP-01 validation |
| 443 | HTTPS access |

If you use Alibaba Cloud, Tencent Cloud, Huawei Cloud, AWS, or Google Cloud, allow these rules in the security group or firewall rules:

```text
TCP 80   0.0.0.0/0
TCP 443  0.0.0.0/0
```

---

### 3.3 Local Server Firewall Allows Traffic

If `firewalld` is enabled:

```bash
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload
```

If it is not enabled, you can ignore this step.

---

## 4. Install Nginx

CentOS / Rocky / AlmaLinux:

```bash
yum install -y nginx
```

Start Nginx and enable it on boot:

```bash
systemctl enable nginx
systemctl start nginx
```

Check status:

```bash
systemctl status nginx
```

Check listening ports:

```bash
ss -lntp | grep nginx
```

---

## 5. Install acme.sh

Install:

```bash
curl https://get.acme.sh | sh
```

Load environment variables:

```bash
source ~/.bashrc
```

Verify:

```bash
acme.sh --version
```

Set the default CA to Let's Encrypt:

```bash
acme.sh --set-default-ca --server letsencrypt
```

---

## 6. Step One: Configure Nginx for HTTP Validation First

Before issuing the certificate, Let's Encrypt needs to access your server through HTTP to verify that you really control the domain.

It will access a URL similar to:

```text
http://stellhub.top/.well-known/acme-challenge/xxxxx
```

Therefore, Nginx must first provide normal service on port 80.

---

## 7. HTTP Validation Configuration That Can Directly Replace `/etc/nginx/nginx.conf`

> This is the minimum usable configuration for the certificate issuance phase.

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

After saving, check:

```bash
nginx -t
```

If there is no problem, start or restart Nginx:

```bash
systemctl restart nginx
```

Test HTTP:

```bash
curl http://stellhub.top
curl http://www.stellhub.top
```

Expected response:

```text
acme ok
```

---

## 8. Test the ACME Validation Directory

Create a test file:

```bash
mkdir -p /usr/share/nginx/html/.well-known/acme-challenge

echo test > /usr/share/nginx/html/.well-known/acme-challenge/test.txt
```

Access it:

```bash
curl http://stellhub.top/.well-known/acme-challenge/test.txt
curl http://www.stellhub.top/.well-known/acme-challenge/test.txt
```

Expected response:

```text
test
```

Only after this step succeeds does `acme.sh --issue --webroot` make sense.

---

## 9. Issue the Certificate

Run:

```bash
acme.sh --issue -d stellhub.top -d www.stellhub.top \
  --webroot /usr/share/nginx/html
```

On success, you will see output similar to:

```text
Verifying: stellhub.top
Success
Verifying: www.stellhub.top
Success
Cert success.
```

The certificate is generated by default under:

```text
/root/.acme.sh/stellhub.top_ecc/
```

The directory usually contains:

| File | Purpose |
| --- | --- |
| `stellhub.top.key` | Private key |
| `stellhub.top.cer` | Domain certificate |
| `ca.cer` | Intermediate CA certificate |
| `fullchain.cer` | Full certificate chain |

Nginx should ultimately use:

```text
fullchain.cer
stellhub.top.key
```

---

## 10. Do You Need to Save the Certificate Content Manually?

No.

The PEM content printed by `acme.sh`:

```text
-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----
```

does not need to be manually copied and saved.

The correct approach is to use `acme.sh --install-cert` to install the certificate into an Nginx-specific directory.

Do not let Nginx directly depend on `/root/.acme.sh/...`.

Reasons:

* `/root` permissions are not suitable for direct Nginx reads
* The path is not suitable as a service runtime dependency
* It is inconvenient for unified management
* `--install-cert` can bind a reload action after automatic renewal

---

## 11. Install the Certificate into the Nginx Directory

Create the certificate directory:

```bash
mkdir -p /etc/nginx/ssl
```

Install the certificate:

```bash
acme.sh --install-cert -d stellhub.top \
  --key-file       /etc/nginx/ssl/stellhub.key \
  --fullchain-file /etc/nginx/ssl/stellhub.cer \
  --reloadcmd     "systemctl reload nginx"
```

Here, `/etc/nginx/ssl/stellhub.cer` is actually `fullchain.cer`.

When the certificate is automatically renewed later, acme.sh will automatically update these files and run:

```bash
systemctl reload nginx
```

---

## 12. Final HTTPS Nginx Configuration

After the certificate is installed, you can update `/etc/nginx/nginx.conf` to the final version below.

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

If your backend is not on `8080`, change this line to the real port:

```nginx
proxy_pass http://127.0.0.1:8080;
```

If you temporarily do not have a backend application, you can first change it to:

```nginx
location / {
    return 200 "https ok\n";
}
```

---

## 13. Apply the Final Configuration

Check the Nginx configuration:

```bash
nginx -t
```

Restart Nginx:

```bash
systemctl restart nginx
```

Check ports:

```bash
ss -lntp | grep nginx
```

You should see:

```text
:80
:443
```

Test HTTPS:

```bash
curl -I https://stellhub.top
curl -I https://www.stellhub.top
```

Open in a browser:

```text
https://stellhub.top
```

Seeing the security lock means HTTPS has truly been enabled.

---

## 14. Automatic Renewal

Let's Encrypt certificates are usually valid for 90 days.

After installation, `acme.sh` automatically configures cron.

Check:

```bash
crontab -l
```

You will usually see:

```bash
~/.acme.sh/acme.sh --cron --home ~/.acme.sh
```

Simulate renewal manually:

```bash
acme.sh --cron --force
```

List certificates:

```bash
acme.sh --list
```

---

# 15. FAQ: Issues Encountered in This Rollout

## FAQ 1: `acme.sh --issue` Reports `Connection refused`

### Symptom

```text
Fetching http://stellhub.top/.well-known/acme-challenge/xxx: Connection refused
```

### Cause

Let's Encrypt failed to access your port 80.

This is not a certificate problem, nor an acme.sh command problem. It means the public HTTP service is not reachable.

Common causes:

* Nginx is not started
* Nginx is not listening on port 80
* The cloud server security group does not allow port 80
* The local firewall does not allow port 80
* The domain resolves to the wrong IP

### Troubleshooting Commands

```bash
ss -lntp | grep ':80'
systemctl status nginx
curl http://127.0.0.1
curl http://stellhub.top
```

### Solution

Ensure that:

* Nginx is running normally
* Port 80 is being listened on
* TCP 80 is open in the security group
* `curl http://stellhub.top` returns content

---

## FAQ 2: `nginx -t` Reports `"server" directive is not allowed here`

### Symptom

```text
nginx: [emerg] "server" directive is not allowed here in /etc/nginx/nginx.conf:1
```

### Cause

You placed:

```nginx
server {
}
```

directly at the top level of `/etc/nginx/nginx.conf`.

This is incorrect.

Nginx configuration has hierarchy:

```text
main
 ├── events
 └── http
      └── server
           └── location
```

`server {}` must be written inside `http {}`.

### Correct Form

```nginx
http {
    server {
        listen 80;
    }
}
```

---

## FAQ 3: `nginx -s reload` Reports `/run/nginx.pid` Does Not Exist

### Symptom

```text
nginx: [error] open() "/run/nginx.pid" failed (2: No such file or directory)
```

### Cause

Nginx is not running at all.

`reload` requires an existing Nginx master process.

### Wrong Operation

```bash
nginx -s reload
```

when Nginx is not started.

### Correct Operation

Check configuration first:

```bash
nginx -t
```

Then start:

```bash
systemctl start nginx
```

After configuration changes, use:

```bash
systemctl reload nginx
```

It is recommended to use `systemctl` consistently instead of mixing too many commands.

---

## FAQ 4: Why Is the Browser Still Not HTTPS after Certificate Issuance Succeeds?

### Cause

Successful certificate issuance only means the files have been generated.

You still need to:

* Install the certificate into the Nginx directory
* Configure `listen 443 ssl`
* Configure `ssl_certificate`
* Configure `ssl_certificate_key`
* Restart Nginx

### Correct Process

```bash
acme.sh --install-cert -d stellhub.top \
  --key-file       /etc/nginx/ssl/stellhub.key \
  --fullchain-file /etc/nginx/ssl/stellhub.cer \
  --reloadcmd     "systemctl reload nginx"
```

Then configure:

```nginx
server {
    listen 443 ssl http2;
    server_name stellhub.top www.stellhub.top;

    ssl_certificate     /etc/nginx/ssl/stellhub.cer;
    ssl_certificate_key /etc/nginx/ssl/stellhub.key;
}
```

---

## FAQ 5: Should the Certificate Content Printed by acme.sh Be Saved Manually?

No.

Do not manually copy PEM text.

The certificate has already been saved to:

```text
/root/.acme.sh/stellhub.top_ecc/
```

For production use, install it with `--install-cert` into:

```text
/etc/nginx/ssl/
```

---

## FAQ 6: Which Certificate File Should Nginx Use?

Use the fullchain.

In this solution:

```nginx
ssl_certificate     /etc/nginx/ssl/stellhub.cer;
ssl_certificate_key /etc/nginx/ssl/stellhub.key;
```

where:

```text
/etc/nginx/ssl/stellhub.cer
```

comes from:

```text
fullchain.cer
```

Do not configure only the standalone domain certificate, or some clients may fail because the intermediate certificate chain is missing.

---

## FAQ 7: Should HTTP Still Be Kept?

Yes.

Port 80 is recommended for two purposes:

1. Redirect HTTP to HTTPS automatically
2. Keep the validation entry for future ACME renewals

Recommended configuration:

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

## FAQ 8: Do You Need to Buy a Certificate?

In most cases, no.

For:

* Personal websites
* Technical blogs
* SaaS
* Self-hosted admin consoles
* API gateways

Let's Encrypt is enough.

Scenarios that truly require commercial certificates are usually:

* Financial institutions
* Mandatory requirements from government or enterprise customers
* Special compliance requirements
* Enterprise brand-oriented OV / EV certificate needs

Otherwise, buying a certificate has low cost-effectiveness.

---

## FAQ 9: Can You Issue a Certificate for an IP Address?

Usually no.

Public HTTPS certificates are generally issued for domain names.

Use:

```text
stellhub.top
www.stellhub.top
```

instead of:

```text
47.84.192.24
```

---

## FAQ 10: How Do You Issue a Wildcard Certificate?

If you later want to support:

```text
*.stellhub.top
```

you need DNS-01 validation instead of HTTP-01.

Example:

```bash
acme.sh --issue -d stellhub.top -d '*.stellhub.top' --dns dns_cf
```

The exact command depends on the DNS provider, such as:

* Cloudflare
* Alibaba Cloud DNS
* Tencent Cloud DNSPod
* Route53

Wildcard certificates are more suitable for multi-subdomain scenarios, such as:

```text
api.stellhub.top
grafana.stellhub.top
prometheus.stellhub.top
blog.stellhub.top
```

---

## FAQ 11: Does `www.stellhub.top` Need Separate Configuration?

Yes.

If the certificate request includes:

```bash
-d stellhub.top -d www.stellhub.top
```

then Nginx `server_name` should also include:

```nginx
server_name stellhub.top www.stellhub.top;
```

Otherwise, one domain may work while the other behaves unexpectedly.

---

## FAQ 12: Why Is `/root/.acme.sh` Not Recommended as the Nginx Certificate Path?

Because it is acme.sh's internal working directory and is not suitable as a service runtime configuration path.

A more reasonable path is:

```text
/etc/nginx/ssl/
```

Benefits:

* Clear semantics
* More controllable permissions
* Easier backup
* Easier troubleshooting
* Suitable for multi-site management

---

## FAQ 13: How Do You Confirm Nginx Is Really Listening on 443?

Run:

```bash
ss -lntp | grep ':443'
```

If there is no output, the HTTPS server has not taken effect.

Continue checking:

```bash
nginx -t
systemctl status nginx
journalctl -u nginx -n 100 --no-pager
```

---

## FAQ 14: Does a Stopped Backend Service Affect HTTPS?

It affects page access, but not the TLS handshake.

If Nginx is configured with:

```nginx
proxy_pass http://127.0.0.1:8080;
```

but no service is running on 8080, HTTPS access may return:

```text
502 Bad Gateway
```

This means the HTTPS layer is working, but the backend application is not running.

For temporary testing, you can change it to:

```nginx
location / {
    return 200 "https ok\n";
}
```

---

## 16. Recommended Final Command List

The full process can be condensed into the following commands.

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
