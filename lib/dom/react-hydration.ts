// React 18 and 19 attach a `__reactFiber$<random>` property to a DOM node when they claim it during
// hydration (and when they create it on the client). Server-rendered HTML React has not hydrated yet
// carries no such property. Script that edits React-owned DOM must wait for it: adding or removing an
// element inside a Suspense boundary that is still dehydrated makes React find markup it never
// rendered, reports "Hydration failed because the server rendered HTML didn't match the client", and
// throws the boundary away to re-render it on the client.
const REACT_INSTANCE_KEY_PREFIX = '__reactFiber$';

export function isReactManaged(node: object): boolean {
  for (const key of Object.keys(node)) {
    if (key.startsWith(REACT_INSTANCE_KEY_PREFIX)) return true;
  }
  return false;
}
