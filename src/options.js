// Turns command line flags and environment variables into validated options. A flag wins over its variable.

const path = require('path');

const DOMAIN_RE = /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// issuing: false for `status`, which only needs the folder (and the domains, to say whether a renewal is due)
function resolveOptions(flags, env = process.env, { issuing = true } = {}) {
    const pick = (flag, variable) => (flags[flag] !== undefined ? flags[flag] : env[variable]);
    const problems = [];

    const dir = String(pick('dir', 'CERT_DIR') || '').trim();
    if (!dir) problems.push('the certificate folder is not set (--dir or CERT_DIR)');

    const domains = [...new Set(String(pick('domains', 'CERT_DOMAINS') || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean))];
    if (issuing && !domains.length) problems.push('no domains (--domains or CERT_DOMAINS, comma separated)');
    for (const domain of domains) {
        if (!DOMAIN_RE.test(domain)) problems.push(`"${domain}" is not a valid domain`);
    }

    const email = String(pick('email', 'CERT_EMAIL') || '').trim();
    if (issuing && !EMAIL_RE.test(email)) problems.push("a valid email is needed for Let's Encrypt expiry notices (--email or CERT_EMAIL)");

    const cloudflareToken = String(pick('cloudflare-token', 'CLOUDFLARE_API_TOKEN') || '').trim();
    if (issuing && !cloudflareToken) problems.push('no Cloudflare API token with Zone:Read and DNS:Edit (CLOUDFLARE_API_TOKEN)');

    const number = (flag, variable, fallback) => {
        const raw = pick(flag, variable);
        if (raw === undefined || raw === '') return fallback;
        const value = Number(raw);
        if (!Number.isFinite(value) || value <= 0) problems.push(`--${flag} must be a positive number`);
        return value;
    };
    const renewDays = number('renew-days', 'CERT_RENEW_DAYS', 30);
    const intervalHours = number('interval-hours', 'CERT_CHECK_HOURS', 12);

    const keyModeRaw = String(pick('key-mode', 'CERT_KEY_MODE') || '600');
    if (!/^[0-7]{3,4}$/.test(keyModeRaw)) problems.push('--key-mode must be an octal file mode such as 600 or 640');

    if (problems.length) throw new Error(`Invalid options:\n  - ${problems.join('\n  - ')}`);

    return {
        dir: path.resolve(dir),
        domains,
        email,
        cloudflareToken,
        staging: flags.staging === true || env.CERT_STAGING === 'true',
        renewDays,
        intervalHours,
        keyMode: parseInt(keyModeRaw, 8),
        onRenew: String(pick('on-renew', 'CERT_ON_RENEW') || '').trim(),
    };
}

module.exports = { resolveOptions };
