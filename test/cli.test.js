const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runHook } = require('../src/hook');
const { tempDir, makeCert } = require('./helpers');

const cli = path.join(__dirname, '..', 'src', 'cli.js');
const run = (args, env = {}) => spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
});

test('prints help', () => {
    const result = run(['--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /certkeeper run/);
});

test('refuses to run without the required options and says which', () => {
    const result = run(['renew']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /folder.*domains.*email.*Cloudflare/s);
});

test('rejects unknown commands and flags', () => {
    assert.equal(run(['bogus']).status, 1);
    assert.equal(run(['status', '--nope']).status, 1);
});

test('status reports an empty folder', () => {
    const result = run(['status', '--dir', tempDir()]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /No certificate/);
});

test('status shows domains, expiry and whether a renewal is due', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'cert.pem'), (await makeCert(['mail.example.com'], 90)).cert);
    const result = run(['status', '--dir', dir, '--domains', 'mail.example.com']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Domains:\s+mail\.example\.com/);
    assert.match(result.stdout, /Renewal:\s+not due/);

    const changed = run(['status', '--dir', dir, '--domains', 'mail.example.com,other.example.com']);
    assert.match(changed.stdout, /due now \(the domain list changed\)/);
});

test('on-renew command gets the certificate paths in its environment', async () => {
    const dir = tempDir();
    const out = path.join(dir, 'hook-output.txt');
    const script = `require('fs').writeFileSync(${JSON.stringify(out)}, [process.env.CERT_PATH, process.env.KEY_PATH, process.env.CERT_DOMAINS].join('|'))`;
    const code = await runHook(`"${process.execPath}" -e "${script.replace(/"/g, '\\"')}"`, {
        dir, keyFile: path.join(dir, 'key.pem'), certFile: path.join(dir, 'cert.pem'), domains: ['a.example.com', 'b.example.com'],
    });
    assert.equal(code, 0);
    assert.equal(fs.readFileSync(out, 'utf8'), `${path.join(dir, 'cert.pem')}|${path.join(dir, 'key.pem')}|a.example.com,b.example.com`);
});

test('a failing on-renew command is reported, not thrown', async () => {
    const logs = [];
    const code = await runHook(`"${process.execPath}" -e "process.exit(3)"`, { dir: '.', keyFile: 'k', certFile: 'c', domains: [] }, m => logs.push(m));
    assert.equal(code, 3);
    assert.ok(logs.some(m => /exited with code 3/.test(m)));
});
