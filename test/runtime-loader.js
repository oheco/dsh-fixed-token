import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Resolve @deepseek-ai/* from the installed dsh CLI, so the tests run against
// the exact runtime this plugin is loaded into, without downloading another.
export const runtime = process.env.DSH_TEST_RUNTIME
  ?? path.resolve(path.dirname(process.execPath), '../lib/node_modules/@deepseek-ai/dsh');
const parentURL = pathToFileURL(path.join(runtime, 'package.json')).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@deepseek-ai/')) return next(specifier, { ...context, parentURL });
    return next(specifier, context);
  },
});
