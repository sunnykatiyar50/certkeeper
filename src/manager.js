// Keeps one certificate in a folder current: issues it when missing, renews it before it expires or when the
// domain list changes. Files written to `dir`: key.pem, cert.pem (with chain), account.key, last-failure.

const fs = require('fs');
const path = require('path');
const { X509Certificate } = require('crypto');
const { issueCertificate } = require('./acme');

const DAY_MS = 24 * 60 * 60 * 1000;
// Let's Encrypt limits failed validations (5 per hour per hostname), so failures must not be retried at once
const RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;

// { serial, expires, names } for a PEM file, or null when it is missing or unreadable
function readCertInfo(file) {
    try {
        const cert = new X509Certificate(fs.readFileSync(file));
        const names = (cert.subjectAltName || '').split(',').map(s => s.trim()).filter(s => s.startsWith('DNS:')).map(s => s.slice(4).toLowerCase());
        return { serial: cert.serialNumber, expires: new Date(cert.validTo), names };
    } catch {
        return null;
    }
}

function renewalReason(info, domains, renewDays, now = Date.now()) {
    if (!info) return 'no certificate yet';
    if (domains.some(domain => !info.names.includes(domain))) return 'the domain list changed';
    if (info.expires.getTime() - now < renewDays * DAY_MS) return `it expires ${info.expires.toISOString().slice(0, 10)}`;
    return null;
}

function writeAtomic(file, content, mode) {
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, content, { mode });
    fs.chmodSync(temp, mode);
    fs.renameSync(temp, file);
}

// options: { dir, domains, email, cloudflareToken, staging, renewDays, keyMode }
function createManager(options, { issue = issueCertificate, log = () => {} } = {}) {
    const keyFile = path.join(options.dir, 'key.pem');
    const certFile = path.join(options.dir, 'cert.pem');
    const failureFile = path.join(options.dir, 'last-failure');

    function recentFailure(now) {
        try {
            const age = now - fs.statSync(failureFile).mtimeMs;
            if (age >= RETRY_AFTER_FAILURE_MS) return null;
            return { minutes: Math.ceil((RETRY_AFTER_FAILURE_MS - age) / 60000), message: fs.readFileSync(failureFile, 'utf8') };
        } catch {
            return null;
        }
    }

    // Issues or renews when due (or when forced). Throws if that is needed and fails.
    async function ensure({ force = false, now = Date.now() } = {}) {
        const info = readCertInfo(certFile);
        const reason = force ? 'forced' : renewalReason(info, options.domains, options.renewDays, now);
        if (!reason) return { renewed: false, info };

        const failure = !force && recentFailure(now);
        if (failure) throw new Error(`The last attempt failed (${failure.message}); not retrying for ${failure.minutes} more minute(s)`);

        log(`Requesting a certificate for ${options.domains.join(', ')} (${reason})${options.staging ? " from the Let's Encrypt staging server" : ''}`);
        fs.mkdirSync(options.dir, { recursive: true });
        try {
            const { key, cert } = await issue({ ...options, log });
            writeAtomic(keyFile, key, options.keyMode);
            writeAtomic(certFile, cert, 0o644);
            fs.rmSync(failureFile, { force: true });
        } catch (error) {
            fs.mkdirSync(options.dir, { recursive: true });
            fs.writeFileSync(failureFile, error.message);
            throw new Error(`Certificate request failed: ${error.message}`);
        }
        const issued = readCertInfo(certFile);
        log(`Certificate written to ${options.dir}, valid until ${issued.expires.toISOString().slice(0, 10)}`);
        return { renewed: true, info: issued };
    }

    return { ensure, status: () => readCertInfo(certFile), keyFile, certFile };
}

module.exports = { createManager, readCertInfo, renewalReason };
