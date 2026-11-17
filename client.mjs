/**
 * @oheco/dsh-fixed-token — browser half.
 *
 * Shows the fixed launch token on the plugin's own page in the Plugins sidebar
 * (`plugins.bundle.config`, keyed by package name) and on its row page
 * (`plugins.row.config`). Values and writes go through the shared settings form
 * of the Host row (`ctx.configForms.get('oheco-fixed-token')`), the same
 * transport the official settings pages use, so a save lands in the profile's
 * own cordis.patch.yml and applies on the next login without a restart.
 *
 * Plain-JS bundle in the client module format: the factory registers at script
 * execution and only `react` is taken from the shared module table.
 */
window.__ModuleLoader__.load({
  id: '@oheco/dsh-fixed-token',
  factory(require) {
    const React = require('react'), h = React.createElement;

    const PACKAGE = '@oheco/dsh-fixed-token';
    /** Row id of the Host half; also its settings namespace. */
    const NS = 'oheco-fixed-token';
    const FIELD = 'token';
    const LOCALE = 'oheco.fixedToken';
    /** Mirrors the Host schema so an invalid write is never sent. */
    const PATTERN = /^[A-Za-z0-9._~-]{16,256}$/;

    const labels = {
      zh: {
        summary: '固定 DSH Web 登录 token',
        title: '固定登录 token',
        intro: '每次启动 dsh web 打印和打开的登录链接都使用这个 token。它只用于浏览器首次登录；登录后浏览器靠 Cookie（默认 30 天）保持登录。',
        loading: '正在读取配置…',
        unavailable: '读取不到本插件的配置：Host 侧插件没有运行，或者当前页面不能读写本机设置（例如通过非本机地址打开）。',
        notSaved: '还没有保存的 token。插件通常会在加载时自动生成并保存；如果一直停在这里，点下面的按钮生成。',
        initialize: '生成并保存 token',
        token: '登录 token',
        loginUrl: '登录链接',
        save: '保存',
        saving: '保存中…',
        revert: '撤销修改',
        regenerate: '重新生成',
        confirmRegenerate: '重新生成后，旧 token 和旧登录链接立即失效（已经登录的浏览器不受影响）。继续吗？',
        copyToken: '复制 token',
        copyUrl: '复制登录链接',
        copied: '已复制',
        copyFailed: '复制失败，请手动选中文本复制',
        saved: '已保存，新 token 立即生效；下次启动 dsh web 时打印的也是它。',
        regenerated: '已生成并保存新的 token。',
        refused: 'Host 拒绝了这次写入（可能被优先级更高的配置层覆盖）。',
        failed: '写入失败：',
        invalid: 'token 需 16–256 位，只能包含 A-Z a-z 0-9 . _ ~ -',
        readOnly: '当前配置不可写。',
        note: '修改或重新生成后：正在运行的 dsh web 之前打印的旧链接失效；已经登录的浏览器继续有效。token 保存在 profile 的 cordis.patch.yml 里，请勿分享。',
      },
      en: {
        summary: 'Fixed DSH Web login token',
        title: 'Fixed login token',
        intro: 'Every dsh web start prints and opens its login URL with this token. It is only used for a browser’s first sign-in; afterwards the browser stays signed in with its cookie (30 days by default).',
        loading: 'Reading configuration…',
        unavailable: 'This plugin’s configuration is not readable: the Host half is not running, or this page cannot read or write local settings (for example when opened through a non-loopback address).',
        notSaved: 'No token is saved yet. The plugin normally generates and saves one when it loads; if this stays, generate one with the button below.',
        initialize: 'Generate and save a token',
        token: 'Login token',
        loginUrl: 'Login URL',
        save: 'Save',
        saving: 'Saving…',
        revert: 'Discard changes',
        regenerate: 'Regenerate',
        confirmRegenerate: 'After regenerating, the old token and login URL stop working immediately (browsers already signed in are not affected). Continue?',
        copyToken: 'Copy token',
        copyUrl: 'Copy login URL',
        copied: 'Copied',
        copyFailed: 'Copy failed; select the text and copy it manually',
        saved: 'Saved. The new token applies immediately, and the next dsh web start prints it.',
        regenerated: 'A new token was generated and saved.',
        refused: 'The Host refused this write (a higher-priority configuration layer may override it).',
        failed: 'Write failed: ',
        invalid: 'A token needs 16–256 characters from A-Z a-z 0-9 . _ ~ -',
        readOnly: 'This configuration is read-only.',
        note: 'After a change, the URL a running dsh web printed earlier stops working; browsers already signed in keep working. The token is stored in the profile’s cordis.patch.yml; do not share it.',
      },
    };

    /** @returns a fresh 256-bit base64url token, the same shape the Host generates. */
    function generateToken() {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
    }

    /** The login URL for this GUI's own origin; the Host exchanges the token only on `GET /`. */
    function loginUrl(token) {
      const url = new URL('/', location.origin);
      url.searchParams.set('token', token);
      return url.href;
    }

    const UNAVAILABLE = { status: 'unavailable', value: undefined, user: undefined, base: undefined, revision: undefined, writable: false };
    const NOOP_FORM = { getSnapshot: () => UNAVAILABLE, subscribe: () => () => {}, mutate: () => Promise.resolve(false) };

    const STYLE = '.oheco-fixed-token{display:grid;gap:14px;color:var(--dsw-alias-label-primary)}'
      + '.oheco-fixed-token h3{font-size:14px;line-height:22px;margin:0;font-weight:500}'
      + '.oheco-fixed-token p{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}'
      + '.oheco-fixed-token label{display:grid;gap:6px;font-size:13px}'
      + '.oheco-fixed-token input,.oheco-fixed-token code{box-sizing:border-box;width:100%;min-width:0;max-width:640px;border:1px solid var(--dsw-alias-label-caption);border-radius:6px;padding:8px 10px;font:13px/20px ui-monospace,SFMono-Regular,Menlo,monospace;color:inherit;background:transparent}'
      + '.oheco-fixed-token code{display:block;word-break:break-all;user-select:all}'
      + '.oheco-fixed-token input[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}'
      + '.oheco-fixed-token .actions{display:flex;gap:8px;flex-wrap:wrap}'
      + '.oheco-fixed-token button{color:inherit;background:transparent;border:1px solid var(--dsw-alias-label-caption);border-radius:6px;padding:7px 12px;font:inherit;font-size:13px;cursor:pointer}'
      + '.oheco-fixed-token button:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}'
      + '.oheco-fixed-token button:disabled{opacity:.5;cursor:default}'
      + '.oheco-fixed-token :focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}'
      + '.oheco-fixed-token .error{color:var(--dsw-alias-state-error-primary)}'
      + '.oheco-fixed-token .ok{color:var(--dsw-alias-state-success-primary)}';

    function FixedTokenPanel({ view, t, tokenForm }) {
      const form = tokenForm ?? NOOP_FORM;
      // ConfigForm methods read `this`; never hand them out unbound.
      const subscribe = React.useCallback((listener) => form.subscribe(listener), [form]);
      const getSnapshot = React.useCallback(() => form.getSnapshot(), [form]);
      const snapshot = React.useSyncExternalStore(subscribe, getSnapshot);
      const [draft, setDraft] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [notice, setNotice] = React.useState(null);
      const mounted = React.useRef(true);
      React.useEffect(() => () => { mounted.current = false; }, []);

      if (view === 'summary') return h('span', null, t('summary'));
      if (view !== 'page') return null;

      const shell = (...children) => h('section', { className: 'oheco-fixed-token', 'aria-label': t('title'), 'data-oheco-fixed-token': snapshot.status },
        h('style', null, STYLE), h('h3', null, t('title')), h('p', null, t('intro')), ...children);

      if (snapshot.status === 'loading') return shell(h('p', { role: 'status' }, t('loading')));
      if (snapshot.status !== 'ready') return shell(h('p', { role: 'status' }, t('unavailable')));

      const stored = typeof snapshot.value?.[FIELD] === 'string' ? snapshot.value[FIELD] : '';
      const writable = snapshot.writable === true;

      const write = async (token, okText) => {
        setBusy(true);
        setNotice(null);
        try {
          const accepted = await form.mutate([{ op: 'set', path: [FIELD], value: token }], snapshot.revision);
          if (!mounted.current) return;
          if (accepted === true) { setDraft(null); setNotice({ kind: 'ok', text: okText }); }
          else setNotice({ kind: 'error', text: t('refused') });
        } catch (error) {
          if (mounted.current) setNotice({ kind: 'error', text: t('failed') + String(error?.message ?? error) });
        } finally {
          if (mounted.current) setBusy(false);
        }
      };
      const copy = async (text) => {
        try {
          if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('clipboard');
          await navigator.clipboard.writeText(text);
          if (mounted.current) setNotice({ kind: 'ok', text: t('copied') });
        } catch {
          if (mounted.current) setNotice({ kind: 'error', text: t('copyFailed') });
        }
      };
      const regenerate = () => {
        if (!window.confirm(t('confirmRegenerate'))) return;
        write(generateToken(), t('regenerated'));
      };
      const noticeLine = () => (notice === null ? null : h('p', { className: notice.kind, role: notice.kind === 'error' ? 'alert' : 'status' }, notice.text));

      // The Host normally saves a generated token on its own; if none is saved
      // (that write failed, or is still settling), let the user save one here.
      // A page write is an ordinary request, so it never runs into the Host's
      // activation-time constraints.
      if (stored === '') {
        return shell(
          h('p', { role: 'status' }, t('notSaved')),
          writable
            ? h('div', { className: 'actions' }, h('button', { type: 'button', 'data-action': 'initialize', disabled: busy, onClick: () => write(generateToken(), t('regenerated')) }, busy ? t('saving') : t('initialize')))
            : h('p', { role: 'status' }, t('readOnly')),
          noticeLine());
      }

      const value = draft ?? stored;
      const dirty = draft !== null && draft !== stored;
      const valid = PATTERN.test(value);
      const url = loginUrl(valid ? value : stored);

      return shell(
        h('label', null, t('token'),
          h('input', {
            'aria-label': t('token'), 'aria-invalid': valid ? 'false' : 'true', 'data-field': 'token',
            type: 'text', value, readOnly: !writable || busy, spellCheck: false, autoComplete: 'off',
            onChange: (event) => { setDraft(event.target.value); setNotice(null); },
            onKeyDown: (event) => { if (event.key === 'Enter' && dirty && valid && writable && !busy) write(value, t('saved')); },
          })),
        valid ? null : h('p', { className: 'error', role: 'alert' }, t('invalid')),
        writable ? null : h('p', { role: 'status' }, t('readOnly')),
        h('div', { className: 'actions' },
          dirty ? h('button', { type: 'button', 'data-action': 'save', disabled: busy || !valid || !writable, onClick: () => write(value, t('saved')) }, busy ? t('saving') : t('save')) : null,
          dirty ? h('button', { type: 'button', 'data-action': 'revert', disabled: busy, onClick: () => { setDraft(null); setNotice(null); } }, t('revert')) : null,
          h('button', { type: 'button', 'data-action': 'copy-token', disabled: dirty, onClick: () => copy(stored) }, t('copyToken')),
          h('button', { type: 'button', 'data-action': 'regenerate', disabled: busy || !writable, onClick: regenerate }, t('regenerate'))),
        h('label', null, t('loginUrl'), h('code', { 'data-field': 'login-url' }, url)),
        h('div', { className: 'actions' },
          h('button', { type: 'button', 'data-action': 'copy-url', disabled: dirty, onClick: () => copy(url) }, t('copyUrl'))),
        noticeLine(),
        h('p', null, t('note')));
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(LOCALE, labels), 'oheco-fixed-token: dictionaries');
        const tokenForm = ctx.configForms.get(NS);
        const props = () => ({ tokenForm });
        // `inject` follows each declaration lifetime of a slot, so registering
        // before the Plugins page declares it still works.
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: PACKAGE, locale: LOCALE, inject: props }, FixedTokenPanel));
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({ name: 'plugins.row.config', key: `${PACKAGE}#${NS}`, locale: LOCALE, inject: props }, FixedTokenPanel));
      },
    };
  },
});
