import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import handler from '../api/banco-nominas.js';

const sessionSecret = 'test-session-secret-that-is-long-enough';

function responseMock() {
  return {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
}

function signedCookie(dip) {
  const payload = Buffer.from(JSON.stringify({ dip, iat: Date.now() })).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return `nexe_session=${payload}.${signature}`;
}

function supabaseProfile(role, dip = '12345678Z') {
  return async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.href || input.url);
    if (url.pathname !== '/rest/v1/nexe_profiles') throw new Error(`Unexpected request ${url.href}`);
    return new Response(JSON.stringify([{
      id: 'profile-uuid',
      dip,
      nombre: 'Test User',
      rol: role,
      activo: true,
    }]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

async function withEnvironment(values, fn) {
  const names = ['NEXE_SESSION_SECRET', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'BANCO_NOMINAS_URL', 'BANCO_API_URL', 'BANK_URL', 'BANCO_CRM_KEY', 'CRM_READ_KEY', 'BANK_CRM_KEY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, values);
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('payroll endpoint requires a valid PlacetaID-backed Nexe session', async () => {
  await withEnvironment({
    NEXE_SESSION_SECRET: sessionSecret,
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SECRET_KEY: 'server-secret-test',
  }, async () => {
    const res = responseMock();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'missing_session');
    assert.equal(res.headers['Cache-Control'], 'no-store');
  });
});

test('payroll endpoint identifies a malformed Bank URL as configuration error', async () => {
  await withEnvironment({
    NEXE_SESSION_SECRET: sessionSecret,
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SECRET_KEY: 'server-secret-test',
    BANCO_NOMINAS_URL: 'not a valid url',
    BANCO_CRM_KEY: 'private-crm-test-key',
  }, async () => {
    globalThis.fetch = async input => {
      const url = new URL(typeof input === 'string' ? input : input.href || input.url);
      return supabaseProfile('presidencia')(input);
    };
    const res = responseMock();
    await handler({
      method: 'GET',
      headers: { cookie: signedCookie('12345678Z') },
      query: {},
    }, res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { error: 'bank_url_invalid' });
  });
});

test('payroll endpoint reports a Supabase session lookup failure separately', async () => {
  await withEnvironment({
    NEXE_SESSION_SECRET: sessionSecret,
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SECRET_KEY: 'server-secret-test',
  }, async () => {
    globalThis.fetch = async () => new Response('{"message":"database unavailable"}', {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
    const res = responseMock();
    await handler({
      method: 'GET',
      headers: { cookie: signedCookie('12345678Z') },
      query: {},
    }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'session_unavailable');
  });
});

test('payroll GET defaults to the Bank API and restricts employees to their own data', async () => {
  await withEnvironment({
    NEXE_SESSION_SECRET: sessionSecret,
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SECRET_KEY: 'server-secret-test',
    CRM_READ_KEY: 'private-crm-test-key',
  }, async () => {
    const calls = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.href || input.url);
      if (url.hostname === 'supabase.example') return supabaseProfile('aspirante')(input);
      calls.push({ url, init });
      return new Response('{"periodos":[],"contratos":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const res = responseMock();
    await handler({
      method: 'GET',
      headers: { cookie: signedCookie('12345678Z') },
      query: { action: 'config', employeeDip: '99999999Z', companyAccountId: 'arbitrary' },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.href, 'https://api.banco.laplaceta.org/api/nominas?action=estado&employeeDip=12345678Z');
    assert.equal(calls[0].init.headers['x-crm-key'], 'private-crm-test-key');
  });
});

test('payroll endpoint preserves upstream authentication errors for diagnosis', async () => {
  await withEnvironment({
    NEXE_SESSION_SECRET: sessionSecret,
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SECRET_KEY: 'server-secret-test',
    BANCO_CRM_KEY: 'private-crm-test-key',
  }, async () => {
    globalThis.fetch = async (input) => {
      const url = new URL(typeof input === 'string' ? input : input.href || input.url);
      if (url.hostname === 'supabase.example') return supabaseProfile('presidencia')(input);
      return new Response('{"error":"invalid_crm_key"}', {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    };
    const res = responseMock();
    await handler({
      method: 'GET',
      headers: { cookie: signedCookie('12345678Z') },
      query: { action: 'estado' },
    }, res);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(JSON.parse(res.body), { error: 'invalid_crm_key' });
  });
});

test('administration can persist payroll configuration through the Bank API', async () => {
  await withEnvironment({
    NEXE_SESSION_SECRET: sessionSecret,
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SECRET_KEY: 'server-secret-test',
    BANCO_CRM_KEY: 'private-crm-test-key',
  }, async () => {
    let bankRequest;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.href || input.url);
      if (url.hostname === 'supabase.example') return supabaseProfile('presidencia')(input);
      bankRequest = { url, init };
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const config = {
      action: 'config',
      guardar: true,
      cutoffDay: 20,
      autoPago: false,
      retencionPct: 10,
      ial: { empleadorPct: 12, trabajadorPct: 12 },
    };
    const res = responseMock();
    await handler({
      method: 'POST',
      headers: { cookie: signedCookie('12345678Z'), host: 'nexe.example', origin: 'https://nexe.example' },
      body: config,
      query: {},
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(bankRequest.url.href, 'https://api.banco.laplaceta.org/api/nominas');
    assert.equal(bankRequest.init.headers['x-crm-key'], 'private-crm-test-key');
    assert.deepEqual(JSON.parse(bankRequest.init.body), config);
  });
});

test('payroll mutations are restricted to administration and presidency', async () => {
  await withEnvironment({
    NEXE_SESSION_SECRET: sessionSecret,
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SECRET_KEY: 'server-secret-test',
    BANCO_CRM_KEY: 'private-crm-test-key',
  }, async () => {
    let bankCalled = false;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.href || input.url);
      if (url.hostname === 'supabase.example') return supabaseProfile('aspirante')(input);
      bankCalled = true;
      return new Response('{}', { status: 200 });
    };

    const res = responseMock();
    await handler({
      method: 'POST',
      headers: { cookie: signedCookie('12345678Z'), host: 'nexe.example', origin: 'https://nexe.example' },
      body: { action: 'cerrar', periodo: '2026-10', pagar: true },
      query: {},
    }, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'forbidden');
    assert.equal(bankCalled, false);
  });
});

test('only presidency can close a period and request immediate payment', async () => {
  await withEnvironment({
    NEXE_SESSION_SECRET: sessionSecret,
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SECRET_KEY: 'server-secret-test',
    BANCO_CRM_KEY: 'private-crm-test-key',
  }, async () => {
    let bankRequest;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.href || input.url);
      if (url.hostname === 'supabase.example') return supabaseProfile('presidencia')(input);
      bankRequest = { url, init };
      return new Response('{"periodo":"2026-10","pagar":true,"resultados":[]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const res = responseMock();
    await handler({
      method: 'POST',
      headers: { cookie: signedCookie('12345678Z'), host: 'nexe.example', origin: 'https://nexe.example' },
      body: { action: 'cerrar', periodo: '2026-10', pagar: true, autor: 'forged' },
      query: {},
    }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(bankRequest.init.body), {
      action: 'cerrar',
      periodo: '2026-10',
      pagar: true,
      autor: '12345678Z',
    });
  });
});

test('a person with an awarded place can only view their own payout accounts', async () => {
  await withEnvironment({
    NEXE_SESSION_SECRET: sessionSecret,
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SECRET_KEY: 'server-secret-test',
    BANCO_CRM_KEY: 'private-crm-test-key',
  }, async () => {
    let bankRequest;
    let readPlace = true;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.href || input.url);
      if (url.hostname === 'supabase.example' && url.pathname === '/rest/v1/nexe_profiles') return supabaseProfile('aspirante')(input);
      if (url.hostname === 'supabase.example' && url.pathname === '/rest/v1/nexe_documents') {
        return new Response(JSON.stringify(readPlace ? [{ payload: { estado: 'plaza' } }] : []), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      bankRequest = { url, init };
      return new Response('{"accounts":[{"id":"account-1","iban":"GDLP-AP01-001"}]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const own = responseMock();
    await handler({
      method: 'GET',
      headers: { cookie: signedCookie('12345678Z') },
      query: { action: 'cuentas', employeeDip: '12345678Z' },
    }, own);
    assert.equal(own.statusCode, 200);
    assert.equal(bankRequest.url.searchParams.get('employeeDip'), '12345678Z');
    assert.equal(bankRequest.url.searchParams.get('action'), 'cuentas');

    const otherPerson = responseMock();
    await handler({
      method: 'GET',
      headers: { cookie: signedCookie('12345678Z') },
      query: { action: 'cuentas', employeeDip: '87654321X' },
    }, otherPerson);
    assert.equal(otherPerson.statusCode, 403);
    assert.equal(bankRequest.url.searchParams.get('employeeDip'), '12345678Z');

    readPlace = false;
    const noPlace = responseMock();
    await handler({
      method: 'GET',
      headers: { cookie: signedCookie('12345678Z') },
      query: { action: 'cuentas', employeeDip: '12345678Z' },
    }, noPlace);
    assert.equal(noPlace.statusCode, 403);
  });
});

test('cross-origin payroll payment requests are rejected before reaching the Bank', async () => {
  await withEnvironment({
    NEXE_SESSION_SECRET: sessionSecret,
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SECRET_KEY: 'server-secret-test',
    BANCO_CRM_KEY: 'private-crm-test-key',
  }, async () => {
    let bankCalled = false;
    globalThis.fetch = async input => {
      const url = new URL(typeof input === 'string' ? input : input.href || input.url);
      if (url.hostname === 'supabase.example') return supabaseProfile('presidencia')(input);
      bankCalled = true;
      return new Response('{}', { status: 200 });
    };
    const res = responseMock();
    await handler({
      method: 'POST',
      headers: { cookie: signedCookie('12345678Z'), host: 'nexe.example', origin: 'https://attacker.example' },
      body: { action: 'cerrar', periodo: '2026-10', pagar: true },
      query: {},
    }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'invalid_origin');
    assert.equal(bankCalled, false);
  });
});
