import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import callback from '../api/placetaid-callback.js';
import register from '../api/placetaid-register.js';
import { PRIVACY_VERSION, TERMS_VERSION } from '../api/_legal.js';

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
  process.env.NEXE_SESSION_SECRET = 'test-session-secret-that-is-long-enough';
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
    const stateSignature = crypto.createHmac('sha256', process.env.NEXE_SESSION_SECRET)
      .update(state)
      .digest('base64url');
    const callbackHeaders = {};
    const callbackResponse = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      setHeader(name, value) { callbackHeaders[name] = value; },
      send(body) { this.body = body; return this; },
      redirect(path) { this.redirectTo = path; this.statusCode = 302; return this; },
    };

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
    const makeResponse = () => ({
      statusCode: 200,
      headers: {},
      status(code) { this.statusCode = code; return this; },
      setHeader(name, value) { this.headers[name] = value; },
      json(value) { this.body = value; return this; },
    });
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

    const invalidOrigin = makeResponse();
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

    const declined = makeResponse();
    await register(makeRequest({
      fullName: 'Ana Pérez',
      acceptTerms: false,
      acknowledgePrivacy: true,
    }), declined);
    assert.equal(declined.statusCode, 400);
    assert.equal(declined.body.error, 'legal_acceptance_required');
    assert.equal(insertCount, 0);

    const created = makeResponse();
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
