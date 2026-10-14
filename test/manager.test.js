const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createManager, readCertInfo, renewalReason } = require('../src/manager');
const { tempDir, makeCert, options } = require('./helpers');

describe('renewalReason', () => {
    test('decides by presence, domain list and days left', async () => {
        const dir = tempDir();
        fs.writeFileSync(path.join(dir, 'cert.pem'), (await makeCert(['mail.example.com'], 60)).cert);
        const info = readCertInfo(path.join(dir, 'cert.pem'));

        assert.match(renewalReason(null, ['mail.example.com'], 30), /no certificate/);
        assert.equal(renewalReason(info, ['mail.example.com'], 30), null);
        assert.match(renewalReason(info, ['mail.example.com', 'other.example.com'], 30), /domain list changed/);
        assert.match(renewalReason(info, ['mail.example.com'], 30, Date.now() + 40 * 86400000), /expires/);
    });
});

describe('manager', () => {
    test('issues when missing, writes key.pem and cert.pem, then leaves a valid certificate alone', async () => {
        const dir = tempDir();
        const opts = options(dir);
        const cert = await makeCert(opts.domains, 90);
        let calls = 0;
        const manager = createManager(opts, { issue: async () => { calls++; return cert; } });

        assert.equal((await manager.ensure()).renewed, true);
        assert.equal(fs.readFileSync(path.join(dir, 'key.pem'), 'utf8'), cert.key);
        assert.equal(fs.readFileSync(path.join(dir, 'cert.pem'), 'utf8'), cert.cert);
        assert.equal((await manager.ensure()).renewed, false);
        assert.equal(calls, 1);
    });

    test('creates the folder when it does not exist', async () => {
        const dir = path.join(tempDir(), 'nested', 'certs');
        const opts = options(dir);
        const cert = await makeCert(opts.domains, 90);
        await createManager(opts, { issue: async () => cert }).ensure();
        assert.ok(fs.existsSync(path.join(dir, 'cert.pem')));
    });

    test('renews inside the renewal window', async () => {
        const dir = tempDir();
        const opts = options(dir);
        const old = await makeCert(opts.domains, 10);
        const fresh = await makeCert(opts.domains, 90);
        fs.writeFileSync(path.join(dir, 'key.pem'), old.key);
        fs.writeFileSync(path.join(dir, 'cert.pem'), old.cert);

        const result = await createManager(opts, { issue: async () => fresh }).ensure();
        assert.equal(result.renewed, true);
        assert.equal(fs.readFileSync(path.join(dir, 'cert.pem'), 'utf8'), fresh.cert);
    });

    test('forces a renewal of a valid certificate', async () => {
        const dir = tempDir();
        const opts = options(dir);
        const cert = await makeCert(opts.domains, 90);
        let calls = 0;
        const manager = createManager(opts, { issue: async () => { calls++; return cert; } });
        await manager.ensure();
        assert.equal((await manager.ensure({ force: true })).renewed, true);
        assert.equal(calls, 2);
    });

    test('does not retry right after a failure, unless forced', async () => {
        const opts = options(tempDir());
        let calls = 0;
        const manager = createManager(opts, { issue: async () => { calls++; throw new Error('DNS says no'); } });

        await assert.rejects(manager.ensure(), /Certificate request failed: DNS says no/);
        await assert.rejects(manager.ensure(), /not retrying for/);
        assert.equal(calls, 1);
        await assert.rejects(manager.ensure({ force: true }), /DNS says no/);
        assert.equal(calls, 2);
    });

    test('a failed renewal leaves the existing files untouched', async () => {
        const dir = tempDir();
        const opts = options(dir);
        const old = await makeCert(opts.domains, 10);
        fs.writeFileSync(path.join(dir, 'cert.pem'), old.cert);
        await assert.rejects(createManager(opts, { issue: async () => { throw new Error('nope'); } }).ensure());
        assert.equal(fs.readFileSync(path.join(dir, 'cert.pem'), 'utf8'), old.cert);
    });
});
