const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCloudflare } = require('../src/cloudflare');

test('finds the parent zone and adds and removes the TXT record', async () => {
    const requests = [];
    const fetchImpl = async (url, options) => {
        requests.push(`${options.method} ${url.replace('https://api.cloudflare.com/client/v4', '')}`);
        let result = [];
        if (url.includes('/zones?name=example.com')) result = [{ id: 'zone1' }];
        if (url.includes('dns_records') && options.method === 'POST') result = { id: 'rec1' };
        return { ok: true, json: async () => ({ success: true, result }) };
    };
    const cloudflare = createCloudflare('token', fetchImpl);
    const record = await cloudflare.addTxt('_acme-challenge.mail.example.com', 'value');
    await cloudflare.removeRecord(record);

    assert.deepEqual(record, { zoneId: 'zone1', id: 'rec1' });
    assert.ok(requests.includes('GET /zones?name=_acme-challenge.mail.example.com'));
    assert.ok(requests.includes('GET /zones?name=mail.example.com'));
    assert.ok(requests.includes('POST /zones/zone1/dns_records'));
    assert.ok(requests.includes('DELETE /zones/zone1/dns_records/rec1'));
});

test('says so when no zone matches', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ success: true, result: [] }) });
    await assert.rejects(createCloudflare('t', fetchImpl).addTxt('_acme-challenge.example.com', 'x'), /No Cloudflare zone found/);
});

test('reports API errors', async () => {
    const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ success: false, errors: [{ message: 'Invalid token' }] }) });
    await assert.rejects(createCloudflare('bad', fetchImpl).addTxt('_acme-challenge.example.com', 'x'), /Invalid token/);
});
