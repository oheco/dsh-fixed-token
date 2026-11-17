/**
 * @oheco/dsh-fixed-token — pin the DSH Web launch token to a value kept in this
 * plugin's own configuration.
 *
 * `@deepseek-ai/dsh-client-connection` mints one random launch token per
 * process and stores it on the `BrowserAuth` instance field `launchToken`. Three
 * `BrowserAuth` methods read that field:
 *
 * - `authenticatedUrl(baseUrl)` — the `dsh web:` URL printed and opened at startup;
 * - `authorizeIndex(req, res)` — `GET /?token=` exchanged for the signed cookie;
 * - `authorizeConnect(req, res)` — `GET /connect?token=` exchanged for an API operator.
 *
 * Wrapping those three on the prototype so they write the current token first
 * pins every path at once, keeps the official cookie, HMAC, expiry and 401
 * handling untouched, and survives a Connection reload that builds a new
 * `BrowserAuth` from the same class.
 *
 * The token lives in the volatile `token` field, so a settings write (the
 * plugin page) applies on the next exchange without a restart. When the field
 * is empty — the first activation after install — the plugin generates 32
 * random bytes, pins them immediately (the startup URL already carries them)
 * and writes the value into the profile's own `cordis.patch.yml` through
 * `ctx.settings`, where the plugin page and every later start read it.
 *
 * The token itself is never written to the log.
 */
import { randomBytes } from 'node:crypto';
import Schema from '@deepseek-ai/schemastery';

/** Stable Cordis plugin name. */
export const name = 'oheco-fixed-token';

/** Connection owns the launch token; without it the row stays inactive instead of throwing. */
export const inject = ['connection'];

/** Row id the bundle patch declares; doubles as the settings namespace the plugin page edits. */
export const ROW_ID = 'oheco-fixed-token';

/** URL-unreserved characters only, so the token survives copy, paste and query encoding unchanged. */
export const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{16,256}$/;

/** The same rule, plus the empty string that means "not generated yet". */
const CONFIG_PATTERN = /^(?:[A-Za-z0-9._~-]{16,256})?$/;

/** BrowserAuth methods that read `launchToken`. */
export const PINNED_METHODS = ['authenticatedUrl', 'authorizeIndex', 'authorizeConnect'];

/** Marks a prototype this plugin has wrapped, so a second live copy fails loudly instead of stacking. */
const WRAPPED = Symbol.for('@oheco/dsh-fixed-token/wrapped');

/** Official per-process token of every instance this plugin pinned, restored on dispose. */
const ORIGINAL_TOKENS = new WeakMap();

/** How long and how often the first-run write retries while the composition settles. */
const PERSIST_ATTEMPTS = 40;
const PERSIST_RETRY_MS = 250;

export const Config = Schema.object({
  token: Schema.string()
    .pattern(CONFIG_PATTERN)
    .default('')
    .description('固定登录 token：16–256 位，只能包含 A-Z a-z 0-9 . _ ~ -。留空时插件会自动生成一个随机值并写回这里。')
    .volatile(),
});

/**
 * @param value - candidate token.
 * @returns whether the value may be used as the launch token.
 */
export function isValidToken(value) {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/** @returns a fresh 256-bit token in base64url (43 characters). */
export function generateToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Read the live token from the volatile Config reference; a plain value covers
 * callers that pass the field without the reference wrapper.
 * @param config - validated {@link Config}.
 * @returns the configured token, or '' when none is set.
 */
export function readConfiguredToken(config) {
  const field = config?.token;
  const value = typeof field?.get === 'function' ? field.get() : field;
  return typeof value === 'string' ? value : '';
}

/**
 * Check that this DSH still keeps the launch token where the plugin expects it.
 * @param auth - `ctx.connection.browserAuth`.
 * @returns the BrowserAuth prototype to wrap.
 * @throws when the field or one of the methods is gone, so an incompatible DSH
 *   fails at activation instead of silently answering 401.
 */
export function browserAuthPrototype(auth) {
  if (auth === null || typeof auth !== 'object' || !Object.hasOwn(auth, 'launchToken') || typeof auth.launchToken !== 'string') {
    throw new Error('oheco-fixed-token: this DSH version no longer exposes BrowserAuth.launchToken; the plugin needs an update');
  }
  const prototype = Object.getPrototypeOf(auth);
  for (const method of PINNED_METHODS) {
    if (typeof prototype?.[method] !== 'function') {
      throw new Error(`oheco-fixed-token: this DSH version no longer provides BrowserAuth.${method}(); the plugin needs an update`);
    }
  }
  return prototype;
}

/**
 * Write a token onto one BrowserAuth instance, remembering its official value once.
 * @param auth - BrowserAuth instance.
 * @param token - token to pin.
 */
export function pinInstance(auth, token) {
  if (!ORIGINAL_TOKENS.has(auth)) ORIGINAL_TOKENS.set(auth, auth.launchToken);
  auth.launchToken = token;
}

/**
 * Give one instance back its official per-process token.
 * @param auth - BrowserAuth instance pinned by {@link pinInstance}.
 */
export function unpinInstance(auth) {
  if (!ORIGINAL_TOKENS.has(auth)) return;
  auth.launchToken = ORIGINAL_TOKENS.get(auth);
  ORIGINAL_TOKENS.delete(auth);
}

/**
 * Wrap the token-reading methods so each call pins the current token first.
 * @param prototype - BrowserAuth prototype.
 * @param current - returns the token to pin at call time.
 * @returns disposer restoring the original methods.
 */
export function pinPrototype(prototype, current) {
  if (Object.hasOwn(prototype, WRAPPED)) {
    throw new Error('oheco-fixed-token: BrowserAuth is already pinned by another oheco-fixed-token row; keep a single row');
  }
  const originals = new Map();
  const wrappers = new Map();
  for (const method of PINNED_METHODS) {
    const original = prototype[method];
    const wrapper = function (...args) {
      pinInstance(this, current());
      return original.apply(this, args);
    };
    originals.set(method, original);
    wrappers.set(method, wrapper);
    prototype[method] = wrapper;
  }
  prototype[WRAPPED] = true;
  return () => {
    for (const [method, original] of originals) {
      if (prototype[method] === wrappers.get(method)) prototype[method] = original;
    }
    Reflect.deleteProperty(prototype, WRAPPED);
  };
}

/** @returns the Loader entry id this plugin instance runs under, falling back to {@link ROW_ID}. */
function entryIdOf(ctx) {
  const entry = ctx.fiber?.entry ?? ctx[Symbol.for('cordis.entry')];
  const id = entry?.options?.id;
  return typeof id === 'string' && id !== '' ? id : ROW_ID;
}

function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The Web profile exports no plugin logger to the terminal, so the two events
 * a user must notice also go to the console, like dsh-web-app's own
 * diagnostics. Neither message ever contains the token.
 */
function announce(ctx, level, message, ...args) {
  ctx.logger[level](message, ...args);
  const text = message.replace(/%[sdo]/g, () => String(args.shift()));
  (level === 'warn' ? console.warn : console.log)(`dsh fixed-token: ${text}`);
}

/**
 * Run `operation` outside any dsh-hmr transaction this activation inherited.
 *
 * A plugin hot-loaded while `dsh web` runs (for example right after
 * `dsh plugin add`) activates inside dsh-hmr's reload transaction, which is
 * tracked by an AsyncLocalStorage. Every continuation started from `apply()`
 * inherits that store, and a Settings write — itself an HMR transaction — is
 * then rejected as nested ("HMR transactions cannot be nested") no matter how
 * long it waits. Leaving the store lets the write queue behind the reload.
 * @param ctx - plugin context.
 * @param operation - async work to start.
 * @returns the operation's promise.
 */
export function outsideHmrTransaction(ctx, operation) {
  const executing = ctx.get('hmr')?.executing;
  if (typeof executing?.getStore === 'function' && typeof executing.exit === 'function' && executing.getStore()) {
    return executing.exit(operation);
  }
  return operation();
}

/**
 * Write the generated token into the profile's own patch layer once the
 * composition has settled. Settings only edits an active entry, so the write
 * waits for the Loader and retries while this entry finishes activating.
 */
async function persistGenerated(ctx, config, entryId, token, signal) {
  await ctx.get('loader')?.await?.();
  let lastError;
  for (let attempt = 0; attempt < PERSIST_ATTEMPTS && !signal.aborted; attempt++) {
    if (readConfiguredToken(config) !== '') return;
    const settings = ctx.get('settings');
    if (settings === undefined) {
      announce(ctx, 'warn', 'settings service is unavailable; the generated token is used for this run only and a new one is generated on the next start');
      return;
    }
    try {
      await settings.update(entryId, { token });
      if (!signal.aborted) announce(ctx, 'info', 'generated the initial fixed token and saved it to the %s row of the profile cordis.patch.yml; view or change it on the Plugins page', entryId);
      return;
    } catch (error) {
      lastError = error;
      await delay(PERSIST_RETRY_MS, signal);
    }
  }
  if (!signal.aborted) {
    announce(ctx, 'warn', 'could not save the generated token (%s); it is used for this run only and a new one is generated on the next start', messageOf(lastError));
  }
}

/**
 * Pin the launch token and make sure a persisted one exists.
 * @param ctx - plugin context carrying the `connection` service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx, config) {
  const auth = ctx.connection.browserAuth;
  const prototype = browserAuthPrototype(auth);
  const entryId = entryIdOf(ctx);
  const lifetime = new AbortController();

  /** In-memory token used while the configured one is empty (first run, or a failed write). */
  let generated;
  const current = () => {
    const configured = readConfiguredToken(config);
    if (isValidToken(configured)) return configured;
    generated ??= generateToken();
    return generated;
  };

  ctx.effect(() => {
    const restore = pinPrototype(prototype, current);
    // Pin the live instance too: the startup URL is printed after the Loader
    // settles and must already carry the fixed token.
    pinInstance(auth, current());
    return () => {
      lifetime.abort();
      restore();
      unpinInstance(auth);
    };
  }, 'oheco-fixed-token: pin the browser launch token');

  // The plugin page renders this row itself; keep a future schema-generated
  // page from duplicating it.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber), 'oheco-fixed-token: own settings page');
  });

  if (readConfiguredToken(config) === '') {
    const token = current();
    outsideHmrTransaction(ctx, () => persistGenerated(ctx, config, entryId, token, lifetime.signal)).catch((error) => {
      announce(ctx, 'warn', 'could not save the generated token: %s', messageOf(error));
    });
  }
}
