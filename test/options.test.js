const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { resolveOptions } = require('../src/options');

const valid = {
    CERT_DIR: './out',
    CERT_DOMAINS: 'Mail.Example.com, *.example.com, mail.example.com',
    CERT_EMAIL: 'ops@example.com',
    CLOUDFLARE_API_TOKEN: 'token',
};

test('reads options from the environment with defaults, normalizing domains', () => {
    const options = resolveOptions({}, valid);
    assert.equal(options.dir, path.resolve('./out'));
    assert.deepEqual(options.domains, ['mail.example.com', '*.example.com']);
    assert.equal(options.renewDays, 30);
    assert.equal(options.intervalHours, 12);
    assert.equal(options.keyMode, 0o600);
    assert.equal(options.staging, false);
    assert.equal(options.onRenew, '');
});

test('flags win over environment variables', () => {
    const options = resolveOptions({ dir: './flag', domains: 'a.example.com', 'renew-days': '10', staging: true, 'key-mode': '640' }, valid);
    assert.equal(options.dir, path.resolve('./flag'));
    assert.deepEqual(options.domains, ['a.example.com']);
    assert.equal(options.renewDays, 10);
    assert.equal(options.staging, true);
    assert.equal(options.keyMode, 0o640);
});

test('lists everything that is missing or wrong', () => {
    assert.throws(() => resolveOptions({}, {}), /folder.*domains.*email.*Cloudflare/s);
    assert.throws(() => resolveOptions({}, { ...valid, CERT_DOMAINS: 'localhost' }), /"localhost" is not a valid domain/);
    assert.throws(() => resolveOptions({}, { ...valid, CERT_EMAIL: 'nope' }), /valid email/);
    assert.throws(() => resolveOptions({}, { ...valid, CERT_RENEW_DAYS: '0' }), /renew-days must be a positive number/);
    assert.throws(() => resolveOptions({}, { ...valid, CERT_KEY_MODE: '999' }), /octal/);
});

test('status only needs the folder', () => {
    const options = resolveOptions({}, { CERT_DIR: './out' }, { issuing: false });
    assert.deepEqual(options.domains, []);
});
