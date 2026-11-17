import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import * as connection from '@deepseek-ai/dsh-client-connection';
import * as plugin from '../index.js';

/** In-memory credential store exposing the two calls BrowserAuth.create uses. */
function credentials() {
  const records = new Map();
  return {
    async modifyRecord(key, modify) {
      const next = await modify(records.get(key));
      if (next === undefined) records.delete(key);
      else records.set(key, next);
      return next;
    },
    async describeRecord(key) {
      return { configured: records.has(key) };
    },
  };
}

/** Minimal node:http response double for authorizeIndex / authorizeConnect. */
function response() {
  return {
    status: undefined,
    headers: {},
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    end() { this.ended = true; },
  };
}

function request(url, extra = {}) {
  return { method: 'GET', url, headers: { host: '127.0.0.1:4080', ...extra } };
}

async function boot(t, config) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  ctx.provide('credentials', credentials());
  await ctx.plugin(connection);
  const fiber = await ctx.plugin(plugin, config);
  return { ctx, fiber, auth: ctx.connection.browserAuth };
}

test('generateToken yields 43-character base64url tokens that pass validation', () => {
  const seen = new Set();
  for (let i = 0; i < 64; i++) {
    const token = plugin.generateToken();
    assert.equal(token.length, 43);
    assert.ok(plugin.isValidToken(token), token);
    seen.add(token);
  }
  assert.equal(seen.size, 64);
});

test('Config accepts empty or URL-safe 16+ character tokens only', () => {
  assert.equal(plugin.readConfiguredToken(plugin.Config({})), '');
  assert.equal(plugin.readConfiguredToken(plugin.Config({ token: 'abcdefghijklmnop' })), 'abcdefghijklmnop');
  for (const bad of ['short', 'has space inside!!', 'slash/not-allowed-x', '中文中文中文中文中文中文中文中文']) {
    assert.throws(() => plugin.Config({ token: bad }), undefined, bad);
  }
});

test('a configured token pins the printed URL, the index exchange and /connect', async (t) => {
  const token = 'my-fixed-token-0123456789';
  const { auth } = await boot(t, { token });
  assert.equal(auth.launchToken, token);
  assert.equal(new URL(auth.authenticatedUrl('http://127.0.0.1:4080/')).searchParams.get('token'), token);

  const ok = response();
  assert.equal(auth.authorizeIndex(request(`/?token=${token}`), ok), false);
  assert.equal(ok.status, 303);
  assert.match(String(ok.headers['set-cookie']), /^dsh-auth-/);

  const wrong = response();
  auth.authorizeIndex(request('/?token=not-the-fixed-token-000'), wrong);
  assert.equal(wrong.status, 401);

  const connect = response();
  auth.authorizeConnect(request(`/connect?token=${token}`), connect, false, () => 'peer-1');
  assert.equal(connect.status, 302);
  const rejected = response();
  auth.authorizeConnect(request('/connect?token=not-the-fixed-token-000'), rejected, false, () => 'peer-2');
  assert.equal(rejected.status, 401);
});

test('a live config change applies on the next exchange without remounting', async (t) => {
  // Same shape as a schemastery volatile reference: the plugin only calls get().
  let live = 'first-fixed-token-000000';
  const config = { token: { get: () => live } };
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  ctx.provide('credentials', credentials());
  await ctx.plugin(connection);
  await ctx.plugin({ ...plugin, Config: undefined }, config);
  const auth = ctx.connection.browserAuth;
  live = 'second-fixed-token-00000';
  const first = response();
  auth.authorizeIndex(request('/?token=first-fixed-token-000000'), first);
  assert.equal(first.status, 401);
  const second = response();
  auth.authorizeIndex(request('/?token=second-fixed-token-00000'), second);
  assert.equal(second.status, 303);
});

test('an empty config pins one generated token for the run', async (t) => {
  const { auth } = await boot(t, {});
  const pinned = auth.launchToken;
  assert.ok(plugin.isValidToken(pinned));
  const url = new URL(auth.authenticatedUrl('http://127.0.0.1:4080/'));
  assert.equal(url.searchParams.get('token'), pinned);
  const ok = response();
  auth.authorizeIndex(request(`/?token=${pinned}`), ok);
  assert.equal(ok.status, 303);
});

test('disposing the plugin restores the official token and methods', async (t) => {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  ctx.provide('credentials', credentials());
  await ctx.plugin(connection);
  const auth = ctx.connection.browserAuth;
  const official = auth.launchToken;
  const prototype = Object.getPrototypeOf(auth);
  const methods = plugin.PINNED_METHODS.map((name) => prototype[name]);
  const fiber = await ctx.plugin(plugin, { token: 'temporary-fixed-token-00' });
  assert.equal(auth.launchToken, 'temporary-fixed-token-00');
  await fiber.dispose();
  assert.equal(auth.launchToken, official);
  assert.deepEqual(plugin.PINNED_METHODS.map((name) => prototype[name]), methods);
  const old = response();
  auth.authorizeIndex(request('/?token=temporary-fixed-token-00'), old);
  assert.equal(old.status, 401);
});

test('a second live row is rejected instead of stacking wrappers', async (t) => {
  const { ctx, auth } = await boot(t, { token: 'only-one-row-token-00000' });
  const prototype = Object.getPrototypeOf(auth);
  const wrapped = plugin.PINNED_METHODS.map((name) => prototype[name]);
  assert.throws(() => plugin.pinPrototype(prototype, () => 'x'), /already pinned/);
  assert.deepEqual(plugin.PINNED_METHODS.map((name) => prototype[name]), wrapped);
  assert.equal(ctx.connection.browserAuth.launchToken, 'only-one-row-token-00000');
});

test('a hot-loaded activation saves its token after leaving the inherited HMR transaction', async (t) => {
  // dsh-hmr marks its reload transaction with an AsyncLocalStorage and refuses
  // a nested transaction (runExclusive). A plugin hot-loaded by `dsh plugin add`
  // activates inside that store; the Settings write must not inherit it.
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const executing = new AsyncLocalStorage();
  let operations = Promise.resolve();
  const runExclusive = (operation) => {
    if (executing.getStore()) return Promise.reject(new Error('HMR transactions cannot be nested'));
    const task = operations.then(() => executing.run(true, operation));
    operations = task.catch(() => {});
    return task;
  };
  const writes = [];
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  ctx.provide('credentials', credentials());
  ctx.provide('hmr', { executing });
  ctx.provide('loader', { await: () => Promise.resolve() });
  ctx.provide('settings', {
    configure: () => () => {},
    update: (ns, values) => runExclusive(async () => { writes.push({ ns, values }); }),
  });
  await ctx.plugin(connection);
  // Activate inside an open reload transaction, as dsh-hmr does.
  await runExclusive(() => ctx.plugin(plugin, {}));
  const deadline = Date.now() + 5000;
  while (writes.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(writes.length, 1, 'the generated token was written once');
  assert.equal(writes[0].ns, plugin.ROW_ID);
  assert.equal(writes[0].values.token, ctx.connection.browserAuth.launchToken, 'the saved token is the pinned one');
});

test('outsideHmrTransaction leaves the store only when one is active', async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const executing = new AsyncLocalStorage();
  const ctx = { get: (name) => (name === 'hmr' ? { executing } : undefined) };
  assert.equal(await plugin.outsideHmrTransaction(ctx, async () => executing.getStore()), undefined);
  assert.equal(await executing.run(true, () => plugin.outsideHmrTransaction(ctx, async () => executing.getStore())), undefined);
  assert.equal(await plugin.outsideHmrTransaction({ get: () => undefined }, async () => 'no hmr'), 'no hmr');
});

test('an incompatible BrowserAuth fails loudly', () => {
  assert.throws(() => plugin.browserAuthPrototype(undefined), /no longer exposes/);
  assert.throws(() => plugin.browserAuthPrototype({}), /no longer exposes/);
  class Partial { launchToken = 'x'; authenticatedUrl() {} authorizeIndex() {} }
  assert.throws(() => plugin.browserAuthPrototype(new Partial()), /authorizeConnect/);
});
