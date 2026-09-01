import { registerHooks } from 'node:module';

const navigationStubUrl = new URL('./next-navigation-test-stub.mjs', import.meta.url).href;
const cacheStubUrl = new URL('./next-cache-test-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/navigation') {
      return { shortCircuit: true, url: navigationStubUrl };
    }
    if (specifier === 'next/cache') {
      return { shortCircuit: true, url: cacheStubUrl };
    }
    return nextResolve(specifier, context);
  },
});
