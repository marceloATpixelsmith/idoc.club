import { registerHooks } from 'node:module';

const stubUrl = new URL('./next-navigation-test-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/navigation') {
      return { shortCircuit: true, url: stubUrl };
    }
    return nextResolve(specifier, context);
  },
});
