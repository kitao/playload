import { registerHooks } from 'node:module';

// Browser cache versions are the same source; Node coverage otherwise counts them twice.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (result.url.startsWith('file:')) {
      const url = new URL(result.url);
      if (url.searchParams.has('v')) {
        url.searchParams.delete('v');
        return { ...result, url: url.href };
      }
    }
    return result;
  },
});
