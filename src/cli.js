#!/usr/bin/env node
// certkeeper run | renew [--force] | status

const { parseArgs } = require('util');
const { resolveOptions } = require('./options');
const { createManager, renewalReason } = require('./manager');
const { runHook } = require('./hook');

const HELP = `certkeeper: gets and renews Let's Encrypt certificates (Cloudflare DNS challenge) into a folder.

Usage:
  certkeeper run              keep the certificate current: check now, then every --interval-hours
  certkeeper renew [--force]  check once and renew if due (--force: renew anyway)
  certkeeper status           show what is in the folder

Options (each also reads the environment variable shown):
  --dir <path>               CERT_DIR              folder for key.pem and cert.pem (required)
  --domains <a,b>            CERT_DOMAINS          comma separated, wildcards allowed (required)
  --email <address>          CERT_EMAIL            Let's Encrypt expiry notices (required)
  --cloudflare-token <t>     CLOUDFLARE_API_TOKEN  Zone:Read + DNS:Edit; prefer the variable (flags show in process lists)
  --staging                  CERT_STAGING=true     use the Let's Encrypt staging server (untrusted test certificates)
  --renew-days <n>           CERT_RENEW_DAYS       renew when fewer days are left (default 30)
  --interval-hours <n>       CERT_CHECK_HOURS      how often "run" checks (default 12)
  --key-mode <octal>         CERT_KEY_MODE         permissions of key.pem (default 600; use 640 or 644 if another user reads it)
  --on-renew <command>       CERT_ON_RENEW         run after a new certificate is written, e.g. to reload an app.
                                                   Gets CERT_DIR, KEY_PATH, CERT_PATH and CERT_DOMAINS in its environment.
`;

const stamp = () => new Date().toISOString();
const log = message => console.log(`[${stamp()}] ${message}`);

function parse() {
    try {
        return parseArgs({
            allowPositionals: true,
            options: {
                dir: { type: 'string' },
                domains: { type: 'string' },
                email: { type: 'string' },
                'cloudflare-token': { type: 'string' },
                staging: { type: 'boolean' },
                'renew-days': { type: 'string' },
                'interval-hours': { type: 'string' },
                'key-mode': { type: 'string' },
                'on-renew': { type: 'string' },
                force: { type: 'boolean' },
                help: { type: 'boolean', short: 'h' },
            },
        });
    } catch (error) {
        console.error(`${error.message}\n\n${HELP}`);
        process.exit(1);
    }
}

function showStatus(options, manager) {
    const info = manager.status();
    if (!info) return console.log(`No certificate in ${options.dir} yet.`);
    const days = Math.floor((info.expires - Date.now()) / 86400000);
    console.log(`Folder:   ${options.dir}`);
    console.log(`Domains:  ${info.names.join(', ')}`);
    console.log(`Expires:  ${info.expires.toISOString().slice(0, 10)} (${days} day(s) left)`);
    if (options.domains.length) {
        const due = renewalReason(info, options.domains, options.renewDays);
        console.log(due ? `Renewal:  due now (${due})` : `Renewal:  not due until ${options.renewDays} day(s) before expiry`);
    }
}

async function renewOnce(options, manager, { force = false } = {}) {
    const { renewed } = await manager.ensure({ force });
    if (renewed && options.onRenew) await runHook(options.onRenew, { ...options, keyFile: manager.keyFile, certFile: manager.certFile }, log);
    return renewed;
}

// A failed check is retried sooner than the normal interval, but never within the 15 minute failure hold-off
async function daemon(options, manager) {
    const interval = options.intervalHours * 3600 * 1000;
    const retry = Math.min(interval, 60 * 60 * 1000);
    log(`Watching ${options.dir} for ${options.domains.join(', ')}; checking every ${options.intervalHours} hour(s)`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
    for (;;) {
        let wait = interval;
        try {
            const renewed = await renewOnce(options, manager);
            if (!renewed) log('Certificate is still valid');
        } catch (error) {
            log(`ERROR: ${error.message}. Retrying in ${Math.round(retry / 60000)} minute(s).`);
            wait = retry;
        }
        await new Promise(resolve => setTimeout(resolve, wait));
    }
}

async function main() {
    const { values, positionals } = parse();
    const command = positionals[0] || 'run';
    if (values.help || !['run', 'renew', 'status'].includes(command)) {
        console.log(HELP);
        process.exit(values.help ? 0 : 1);
    }

    let options;
    try {
        options = resolveOptions(values, process.env, { issuing: command !== 'status' });
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
    const manager = createManager(options, { log });

    if (command === 'status') return showStatus(options, manager);
    if (command === 'run') return daemon(options, manager);
    const renewed = await renewOnce(options, manager, { force: values.force });
    log(renewed ? 'Done.' : 'The certificate is still valid; use --force to renew anyway.');
}

main().catch(error => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
});
