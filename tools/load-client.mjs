// Load the browser half outside a browser.
// Why: the client bundle is a plain side-effect script with no imports, so the
// only way to unit-test its logic is to evaluate it against a stub module loader.
import { readFileSync } from 'node:fs';

const ROOT = 'D:/桌宠';

/** A React stub: enough to build an element tree, nothing more. */
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
};

/**
 * Evaluate lib/client.js and return its module.
 * @returns {{ module: any, id: string }}
 */
export function loadClient() {
  let captured;
  globalThis.window = { __ModuleLoader__: { load: (info) => { captured = info; } } };
  // eslint-disable-next-line no-new-func -- evaluating the shipped bundle is the point
  new Function(readFileSync(`${ROOT}/lib/client.js`, 'utf8'))();
  if (captured === undefined) throw new Error('client bundle never called __ModuleLoader__.load');
  const module = captured.factory((name) => {
    if (name === 'react') return ReactStub;
    throw new Error(`the client bundle required something unexpected: ${name}`);
  });
  return { module, id: captured.id };
}
