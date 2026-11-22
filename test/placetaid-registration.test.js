import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import callback from '../api/placetaid-callback.js';
import records from '../api/nexe-records.js';
import sessionHandler from '../api/placetaid-session.js';
import register from '../api/placetaid-register.js';
import { PRIVACY_VERSION, TERMS_VERSION } from '../api/_legal.js';
import { PRESIDENTE_DIP } from '../api/_roles.js';

const sessionSecret = 'test-session-secret-that-is-long-enough';

function responseMock() {
  return {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(value) { this.body = value; return this; },
    send(body) { this.body = body; return this; },
    redirect(path) { this.redirectTo = path; this.statusCode = 302; return this; },
  };
}

function signedSessionCookie(dip = '12345678Z') {
  const payload = Buffer.from(JSON.stringify({ dip, iat: Date.now() })).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return `nexe_session=${payload}.${signature}`;
}

test('new PlacetaID identity must accept Nexe legal texts before account creation', async () => {
  const originalFetch = globalThis.fetch;
  const oldEnvironment = {
    NEXE_SESSION_SECRET: process.env.NEXE_SESSION_SECRET,
    PLACETAID_CLIENT_ID: process.env.PLACETAID_CLIENT_ID,
    PLACETAID_CLIENT_SECRET: process.env.PLACETAID_CLIENT_SECRET,
    PLACETAID_URL: process.env.PLACETAID_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  };
  process.env.NEXE_SESSION_SECRET = sessionSecret;
  process.env.PLACETAID_CLIENT_ID = 'client-test';
  process.env.PLACETAID_CLIENT_SECRET = 'client-secret-test';
  process.env.PLACETAID_URL = 'https://placetaid.example';
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'server-secret-test';

  let insertedProfile;
  let insertCount = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.href || input.url);
    if (url.pathname === '/api/public/exchange') {
      return new Response(JSON.stringify({
        login_correct: true,
        claims: { dip: '12345678Z', name: 'Ana <script>alert(1)</script>', surname: 'Pérez' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/rest/v1/nexe_profiles' && init.method === 'GET') {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/rest/v1/nexe_profiles' && init.method === 'POST') {
      insertCount += 1;
      insertedProfile = JSON.parse(init.body);
      return new Response(JSON.stringify({
        id: 'profile-uuid',
        dip: insertedProfile.dip,
        nombre: insertedProfile.nombre,
        rol: insertedProfile.rol,
        activo: insertedProfile.activo,
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected ${init.method || 'GET'} request ${url.href}`);
  };

  try {
    const state = 'oauth-state-test';
    const stateSignature = crypto.createHmac('sha256', sessionSecret).update(state).digest('base64url');
    const callbackHeaders = {};
    const callbackResponse = responseMock();
    callbackResponse.setHeader = (name, value) => { callbackHeaders[name] = value; };
    await callback({
      method: 'GET',
      query: { state, code: 'oauth-code' },
      headers: { cookie: `nexe_oauth_state=${state}.${stateSignature}` },
    }, callbackResponse);

    assert.equal(callbackResponse.statusCode, 200);
    assert.match(callbackResponse.body, /Crear tu cuenta de Nexe/);
    assert.match(callbackResponse.body, /value="Ana &lt;script&gt;alert\(1\)&lt;\/script&gt; Pérez"/);
    assert.match(callbackResponse.body, /legal\/terminos\.html/);
    assert.match(callbackResponse.body, /legal\/privacidad\.html/);

    const registrationCookie = callbackHeaders['Set-Cookie']
      .find(value => value.startsWith('nexe_registration='))
      .split(';')[0];
    const makeRequest = body => ({
      method: 'POST',
      headers: {
        host: 'nexe.example',
        origin: 'https://nexe.example',
        cookie: registrationCookie,
        'content-type': 'application/json',
      },
      body,
    });

    const invalidOrigin = responseMock();
    const forgedRequest = makeRequest({
      fullName: 'Ana Pérez',
      acceptTerms: true,
      acknowledgePrivacy: true,
    });
    forgedRequest.headers.origin = 'https://attacker.example';
    await register(forgedRequest, invalidOrigin);
    assert.equal(invalidOrigin.statusCode, 403);
    assert.equal(invalidOrigin.body.error, 'invalid_origin');
    assert.equal(insertCount, 0);

    const declined = responseMock();
    await register(makeRequest({
      fullName: 'Ana Pérez',
      acceptTerms: false,
      acknowledgePrivacy: true,
    }), declined);
    assert.equal(declined.statusCode, 400);
    assert.equal(declined.body.error, 'legal_acceptance_required');
    assert.equal(insertCount, 0);

    const created = responseMock();
    await register(makeRequest({
      fullName: 'Ana Pérez',
      acceptTerms: true,
      acknowledgePrivacy: true,
    }), created);
    assert.equal(created.statusCode, 200);
    assert.deepEqual(created.body, { ok: true });
    assert.equal(insertCount, 1);
    assert.equal(insertedProfile.dip, '12345678Z');
    assert.equal(insertedProfile.nombre, 'Ana Pérez');
    assert.equal(insertedProfile.rol, 'aspirante');
    assert.equal(insertedProfile.activo, true);
    assert.equal(insertedProfile.terminos_version, TERMS_VERSION);
    assert.equal(insertedProfile.privacidad_version, PRIVACY_VERSION);
    assert.ok(insertedProfile.terminos_accepted_at);
    assert.ok(insertedProfile.privacidad_acknowledged_at);
    assert.ok(created.headers['Set-Cookie'].some(value => value.startsWith('nexe_session=')));
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(oldEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('Nexe restores PlacetaID session and serves user-scoped collections', async () => {
  const originalFetch = globalThis.fetch;
  const oldEnvironment = {
    NEXE_SESSION_SECRET: process.env.NEXE_SESSION_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  };
  process.env.NEXE_SESSION_SECRET = sessionSecret;
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'server-secret-test';
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.href || input.url);
    if (url.pathname === '/rest/v1/nexe_profiles') {
      return new Response(JSON.stringify([{
        id: 'profile-uuid',
        dip: '12345678Z',
        nombre: 'Ana Pérez',
        rol: 'aspirante',
        activo: true,
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/rest/v1/nexe_documents') {
      assert.equal(init.method || 'GET', 'GET');
      assert.equal(url.searchParams.get('collection_path'), 'eq.convocatorias');
      assert.equal(url.searchParams.has('owner_id'), false);
      return new Response(JSON.stringify([{
        document_id: 'call-1',
        payload: { titulo: 'Convocatoria' },
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected request ${init.method || 'GET'} ${url.href}`);
  };

  try {
    const cookie = signedSessionCookie();
    const sessionResponse = responseMock();
    await sessionHandler({ method: 'GET', headers: { cookie } }, sessionResponse);
    assert.equal(sessionResponse.statusCode, 200);
    assert.deepEqual(sessionResponse.body, {
      authenticated: true,
      user: { id: '12345678Z', dip: '12345678Z', name: 'Ana Pérez', role: 'aspirante' },
    });

    const recordsResponse = responseMock();
    await records({
      method: 'GET',
      query: { path: 'convocatorias' },
      headers: { cookie },
    }, recordsResponse);
    assert.equal(recordsResponse.statusCode, 200);
    assert.deepEqual(recordsResponse.body.data, [{
      document_id: 'call-1',
      payload: { titulo: 'Convocatoria' },
    }]);

    const forbiddenResponse = responseMock();
    await records({
      method: 'GET',
      query: { path: 'keys' },
      headers: { cookie },
    }, forbiddenResponse);
    assert.equal(forbiddenResponse.statusCode, 403);
    assert.deepEqual(forbiddenResponse.body, { error: 'forbidden' });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(oldEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('an aspirant can write only their own profile document', async () => {
  const originalFetch = globalThis.fetch;
  const oldEnvironment = {
    NEXE_SESSION_SECRET: process.env.NEXE_SESSION_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  };
  process.env.NEXE_SESSION_SECRET = sessionSecret;
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'server-secret-test';
  let documentInsertCount = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.href || input.url);
    if (url.pathname === '/rest/v1/nexe_profiles') {
      return new Response(JSON.stringify([{
        id: 'profile-uuid',
        dip: '12345678Z',
        nombre: 'Ana Pérez',
        rol: 'aspirante',
        activo: true,
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/rest/v1/nexe_documents' && init.method === 'POST') {
      documentInsertCount += 1;
      const row = JSON.parse(init.body);
      assert.equal(row.collection_path, 'aspirantes');
      assert.equal(row.document_id, '12345678Z');
      assert.equal(row.owner_id, 'profile-uuid');
      return new Response(JSON.stringify({
        document_id: row.document_id,
        payload: row.payload,
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected ${init.method || 'GET'} request ${url.href}`);
  };

  try {
    const cookie = signedSessionCookie();
    const allowed = responseMock();
    await records({
      method: 'PUT',
      query: { path: 'aspirantes', id: '12345678Z' },
      headers: { cookie },
      body: { data: { nombre: 'Ana Pérez' } },
    }, allowed);
    assert.equal(allowed.statusCode, 200);
    assert.equal(documentInsertCount, 1);

    const forbidden = responseMock();
    await records({
      method: 'PUT',
      query: { path: 'aspirantes', id: '87654321X' },
      headers: { cookie },
      body: { data: { nombre: 'No autorizado' } },
    }, forbidden);
    assert.equal(forbidden.statusCode, 403);
    assert.equal(documentInsertCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(oldEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('missing Nexe documents table returns actionable setup error', async () => {
  const originalFetch = globalThis.fetch;
  const oldEnvironment = {
    NEXE_SESSION_SECRET: process.env.NEXE_SESSION_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  };
  process.env.NEXE_SESSION_SECRET = sessionSecret;
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'server-secret-test';
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.href || input.url);
    if (url.pathname === '/rest/v1/nexe_profiles') {
      return new Response(JSON.stringify([{
        id: 'profile-uuid',
        dip: '12345678Z',
        nombre: 'Ana Pérez',
        rol: 'aspirante',
        activo: true,
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/rest/v1/nexe_documents') {
      return new Response(JSON.stringify({
        code: 'PGRST205',
        message: "Could not find the table 'public.nexe_documents' in the schema cache",
      }), { status: 404, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected ${init.method || 'GET'} request ${url.href}`);
  };

  try {
    const result = responseMock();
    await records({
      method: 'GET',
      query: { path: 'convocatorias' },
      headers: { cookie: signedSessionCookie() },
    }, result);
    assert.equal(result.statusCode, 503);
    assert.deepEqual(result.body, { error: 'database_schema_missing' });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(oldEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('only the reserved PlacetaID identity with current legal acceptance is promoted', async () => {
  const originalFetch = globalThis.fetch;
  const oldEnvironment = {
    NEXE_SESSION_SECRET: process.env.NEXE_SESSION_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  };
  process.env.NEXE_SESSION_SECRET = sessionSecret;
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'server-secret-test';
  let promotionCount = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.href || input.url);
    if (url.pathname === '/rest/v1/nexe_profiles' && (!init.method || init.method === 'GET')) {
      return new Response(JSON.stringify([{
        id: 'president-profile-uuid',
        dip: PRESIDENTE_DIP,
        nombre: 'Presidencia',
        rol: 'aspirante',
        activo: true,
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/rest/v1/nexe_profiles' && init.method === 'PATCH') {
      promotionCount += 1;
      assert.deepEqual(JSON.parse(init.body), { rol: 'presidencia' });
      assert.equal(url.searchParams.get('dip'), `eq.${PRESIDENTE_DIP}`);
      assert.equal(url.searchParams.get('activo'), 'eq.true');
      assert.equal(url.searchParams.get('terminos_version'), `eq.${TERMS_VERSION}`);
      assert.equal(url.searchParams.get('privacidad_version'), `eq.${PRIVACY_VERSION}`);
      return new Response(JSON.stringify([{ rol: 'presidencia' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected ${init.method || 'GET'} request ${url.href}`);
  };

  try {
    const result = responseMock();
    await sessionHandler({
      method: 'GET',
      headers: { cookie: signedSessionCookie(PRESIDENTE_DIP) },
    }, result);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.user.role, 'presidencia');
    assert.equal(promotionCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(oldEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
