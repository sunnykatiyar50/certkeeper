# certkeeper

Gets and renews [Let's Encrypt](https://letsencrypt.org) certificates into a folder, for any app that reads PEM files. You give it a folder, the domains, an email and a Cloudflare API token; it keeps `key.pem` and `cert.pem` current.

- Proves domain ownership with a DNS record in Cloudflare, so nothing needs to be reachable from the internet (works for mail servers, internal hosts, wildcards).
- Checks every 12 hours and renews when fewer than 30 days are left, or when the domain list changed.
- Writes files atomically, so a reader never sees a half-written certificate.
- Optional `--on-renew` command to tell your app to reload.
- One dependency ([`acme-client`](https://www.npmjs.com/package/acme-client)). Node 22.13 or newer.

## Quick start

```
export CLOUDFLARE_API_TOKEN=...          # Zone:Read and DNS:Edit for the zone

npx certkeeper renew --staging --dir ./certs --domains mail.example.com --email you@example.com
```

Run it against the **staging** server first (certificates are not trusted, but nothing is rate limited). When that works, drop `--staging` and run it for real:

```
npx certkeeper run --dir ./certs --domains mail.example.com,*.example.com --email you@example.com
```

`run` stays in the foreground and keeps the certificate current. Your app reads `./certs/key.pem` and `./certs/cert.pem` (the certificate includes the chain).

## Commands

| Command | What it does |
|---------|--------------|
| `certkeeper run` | Check now, then every `--interval-hours`. A failed check is retried within an hour. |
| `certkeeper renew [--force]` | Check once and renew if due (`--force`: renew anyway). Exits 1 on failure; good for cron. |
| `certkeeper status` | Show domains, expiry and whether a renewal is due. Needs only `--dir`. |

## Options

Every option can be a flag or an environment variable. A flag wins.

| Flag | Variable | Default | |
|------|----------|---------|---|
| `--dir` | `CERT_DIR` | | Folder for the certificate files. Created if missing. **Required.** |
| `--domains` | `CERT_DOMAINS` | | Comma separated; wildcards like `*.example.com` work. The first one is the certificate's main name. **Required.** |
| `--email` | `CERT_EMAIL` | | Let's Encrypt sends expiry notices here. **Required.** |
| `--cloudflare-token` | `CLOUDFLARE_API_TOKEN` | | Prefer the variable: flags show up in process lists. **Required.** |
| `--staging` | `CERT_STAGING=true` | off | Use the Let's Encrypt staging server. |
| `--renew-days` | `CERT_RENEW_DAYS` | `30` | Renew when fewer days than this are left. |
| `--interval-hours` | `CERT_CHECK_HOURS` | `12` | How often `run` checks. |
| `--key-mode` | `CERT_KEY_MODE` | `600` | Permissions of `key.pem`. Use `640` or `644` when another user or container has to read it. |
| `--on-renew` | `CERT_ON_RENEW` | | Command to run after a new certificate is written. |

The Cloudflare token needs **Zone → Zone → Read** and **Zone → DNS → Edit** for the zone. The domain must use Cloudflare DNS.

## What it writes

In `--dir`:

| File | |
|------|---|
| `key.pem` | Private key (mode `--key-mode`) |
| `cert.pem` | Certificate and chain, ready for `ssl_certificate`, Node's `tls`, Postfix, and so on |
| `account.key` | Your Let's Encrypt account key. Keep it; it is reused on every renewal |
| `last-failure` | Present only after a failed attempt (see below) |

## Reloading your app

Many servers read the certificate once at startup. Use `--on-renew` to tell them about a new one. The command runs through the shell and gets `CERT_DIR`, `KEY_PATH`, `CERT_PATH` and `CERT_DOMAINS` in its environment. A failing command is logged and does not stop certkeeper.

```
--on-renew "systemctl reload nginx"
--on-renew "docker kill -s HUP my-proxy"
--on-renew "touch /srv/app/reload"
```

## Docker

```
docker build -t certkeeper .

docker run -d --name certkeeper --restart unless-stopped \
  -e CLOUDFLARE_API_TOKEN=... \
  -e CERT_DOMAINS=mail.example.com -e CERT_EMAIL=you@example.com \
  -e CERT_DIR=/certs -e CERT_KEY_MODE=640 \
  -v certs:/certs \
  certkeeper
```

Mount the same volume read-only into the app that needs the certificate. In Compose:

```yaml
services:
  certkeeper:
    build: ../certkeeper
    restart: unless-stopped
    environment:
      CERT_DIR: /certs
      CERT_DOMAINS: mail.example.com
      CERT_EMAIL: you@example.com
      CERT_KEY_MODE: "640"
      CLOUDFLARE_API_TOKEN: ${CLOUDFLARE_API_TOKEN}
    volumes:
      - certs:/certs

  app:
    image: my-app
    volumes:
      - certs:/certs:ro

volumes:
  certs:
```

The container runs as the unprivileged `node` user (UID 1000). The volume must be writable by it, and the app has to be able to read `key.pem` (hence `CERT_KEY_MODE`). Containers cannot reload other containers, so either have the app watch the files, restart it from outside, or run certkeeper on the host with `--on-renew`.

## When something goes wrong

- **Failed attempts are held off for 15 minutes** (a `last-failure` file records why), so a restart loop cannot trip Let's Encrypt's limit of 5 failed validations per hour. `renew --force` skips the hold-off.
- **A failed renewal never touches the existing files.** The old certificate stays in place until a new one is written in full.
- **`run` does not exit on failure.** It logs the error and tries again within the hour.
- Let's Encrypt also has [rate limits](https://letsencrypt.org/docs/rate-limits/) on real certificates; use `--staging` while testing.

## Use as a library

```js
const { createManager } = require('certkeeper');

const manager = createManager({
    dir: './certs', domains: ['mail.example.com'], email: 'you@example.com',
    cloudflareToken: process.env.CLOUDFLARE_API_TOKEN, staging: false, renewDays: 30, keyMode: 0o600,
}, { log: console.log });

const { renewed, info } = await manager.ensure();   // info: { expires, names, serial }
```

## Development

```
npm install
npm test
```

## License

MIT
