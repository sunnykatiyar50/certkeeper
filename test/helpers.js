const fs = require('fs');
const os = require('os');
const path = require('path');
const selfsigned = require('selfsigned');

exports.tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'certkeeper-test-'));

// A self-signed certificate valid for `days` days, covering `names`
exports.makeCert = async (names, days) => {
    const pems = await selfsigned.generate([{ name: 'commonName', value: names[0] }], {
        notAfterDate: new Date(Date.now() + days * 86400000),
        keySize: 2048,
        algorithm: 'sha256',
        extensions: [{ name: 'subjectAltName', altNames: names.map(value => ({ type: 2, value })) }],
    });
    return { key: pems.private, cert: pems.cert };
};

exports.options = (dir, overrides = {}) => ({
    dir,
    domains: ['mail.example.com', '*.example.com'],
    email: 'ops@example.com',
    cloudflareToken: 'token',
    staging: false,
    renewDays: 30,
    keyMode: 0o600,
    ...overrides,
});
