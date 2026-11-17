import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import ConfigEditor from '@deepseek-ai/dsh-config-editor';
import SettingsForms from '@deepseek-ai/dsh-settings';
import { mountRootInclude, readProfilePatches } from '@deepseek-ai/dsh-app-boot';
import * as connection from '@deepseek-ai/dsh-client-connection';
import * as plugin from '../index.js';
import { runtime } from './runtime-loader.js';

const NS = plugin.ROW_ID;

function memoryCredentials() {
  const records = new Map();
  return {
    async modifyRecord(key, modify) {
      const next = await modify(records.get(key));
      if (next === undefined) records.delete(key); else records.set(key, next);
      return next;
    },
    async describeRecord(key) { return { configured: records.has(key) }; },
  };
}

function response() {
  return {
    status: undefined, headers: {},
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; return this; },
    setHeader() {}, end() {},
  };
}

function exchange(auth, token) {
  const res = response();
  auth.authorizeIndex({ method: 'GET', url: `/?token=${encodeURIComponent(token)}`, headers: { host: '127.0.0.1:4080' } }, res);
  return res.status;
}

/** Boot a real Loader + ConfigEditor + Settings tree over a temporary profile, like `dsh` does. */
async function boot(root) {
  const profile = {
    name: 'fixture', dir: path.join(root, 'profile'), home: path.join(root, 'home'), cwd: root,
    patchPath: path.join(root, 'profile/cordis.patch.yml'), installAnchor: path.join(runtime, 'package.json'),
    startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
  };
  const ctx = new Context();
  ctx.provide('profileContext', profile);
  ctx.provide('credentials', memoryCredentials());
  await ctx.plugin({ name: 'fixture-loader-services', apply(c) {
    new Loader(c, { baseUrl: pathToFileURL(`${runtime}/`).href });
    new ConfigEditor(c);
    new SettingsForms(c);
  } });
  Object.assign(ctx.loader.builtins, { 'fixture-connection': connection, 'fixed-token': plugin });
  await mountRootInclude(ctx, path.join(root, 'base.yml'), readProfilePatches('dsh', profile));
  await ctx.loader.await();
  return ctx;
}

async function waitFor(predicate, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const storedToken = async (root) => (await readFile(path.join(root, 'profile/cordis.patch.yml'), 'utf8')).match(/token: ['"]?([A-Za-z0-9._~-]{16,256})/)?.[1];

test('first load generates a token, saves it in the profile patch, and reuses it after restart', { timeout: 60000 }, async (t) => {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), 'dsh-fixed-token-composition-'));
  const owned = await realpath(root);
  let first, second;
  t.after(async () => {
    await second?.fiber.dispose(); await first?.fiber.dispose();
    assert.ok(path.basename(owned).startsWith('dsh-fixed-token-composition-'));
    await rm(owned, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'profile')); await mkdir(path.join(root, 'home'));
  await writeFile(path.join(root, 'profile/package.json'), JSON.stringify({ name: 'fixture-profile', private: true, dsh: { profile: { bundles: [] } } }));
  await writeFile(path.join(root, 'base.yml'), '[]\n');
  // Mirrors the shipped bundle patch: the row is inserted with an empty config.
  await writeFile(path.join(root, 'profile/cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'connection', name: 'cordis:fixture-connection' },
    { id: NS, name: 'cordis:fixed-token', config: {} },
  ] }], null, 2));

  first = await boot(root);
  const auth = first.connection.browserAuth;
  const pinned = auth.launchToken;
  assert.ok(plugin.isValidToken(pinned), 'startup pins a generated token before anything is saved');
  assert.equal(new URL(auth.authenticatedUrl('http://127.0.0.1:4080/')).searchParams.get('token'), pinned);

  const saved = await waitFor(() => storedToken(root), 'the generated token in cordis.patch.yml');
  assert.equal(saved, pinned, 'the saved token is exactly the one already printed');
  const form = await waitFor(() => first.settings.describe().find((item) => item.ns === NS && item.value?.token === pinned), 'the settings form to show the token');
  assert.equal(form.autoGenerate, false, 'the plugin page replaces the schema-generated page');
  assert.equal(first.settings.writable, true);
  assert.equal(exchange(auth, pinned), 303);

  // A page write (same path the plugin page uses) applies immediately, without a restart.
  const edited = 'edited-from-plugin-page-01';
  await first.settings.mutate(NS, [{ op: 'set', path: ['token'], value: edited }], form.revision);
  assert.equal(exchange(auth, pinned), 401, 'the old token stops working');
  assert.equal(exchange(auth, edited), 303, 'the new token works on the next exchange');
  assert.equal(await storedToken(root), edited);
  await assert.rejects(first.settings.mutate(NS, [{ op: 'set', path: ['token'], value: 'bad token' }]), undefined, 'invalid values are refused by the schema');
  assert.equal(await storedToken(root), edited);

  await first.fiber.dispose();
  first = undefined;

  second = await boot(root);
  assert.equal(second.connection.browserAuth.launchToken, edited, 'a restart reuses the saved token');
  assert.equal(new URL(second.connection.browserAuth.authenticatedUrl('http://127.0.0.1:4080/')).searchParams.get('token'), edited);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(await storedToken(root), edited, 'a configured token is never regenerated');
});
