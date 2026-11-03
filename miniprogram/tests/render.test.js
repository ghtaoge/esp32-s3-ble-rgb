const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { createPage } = require('./helpers/page');

// Exercise the actual output of WeChat's template compiler, including event bindings.
const compiler = process.env.WXML_COMPILER || '';
let render;
if (fs.existsSync(compiler)) {
  const miniRoot = path.resolve(__dirname, '..');
  const output = path.resolve(miniRoot, '../.tools/render-tests/index.js');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const compiled = spawnSync(compiler, ['-o', output, 'pages/index/index.wxml'], { cwd: miniRoot, encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(output, 'utf8'), sandbox);
  const context = {};
  sandbox.$gwx(undefined, context);
  render = sandbox.$gwx(Object.keys(context.entrys)[0], context);
}
const options = { skip: render ? false : 'Set WXML_COMPILER to the installed WeChat wcc executable' };
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (predicate(tree)) return tree;
  for (const child of tree.children || []) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
const byClass = (tree, name) => find(tree, node => (node.attr?.class || '').split(' ').includes(name));

test('compiled privacy prompt is absent initially and disappears after cancel', options, () => {
  const { page, request } = createPage();
  assert.equal(byClass(render(page.data), 'privacy-mask'), undefined);
  request(() => {});
  const tree = render(page.data);
  assert.ok(byClass(tree, 'privacy-mask'));
  const cancel = byClass(tree, 'privacy-cancel');
  page[cancel.attr.bindtap]();
  assert.equal(page.data.showPrivacy, false);
  assert.equal(byClass(render(page.data), 'privacy-mask'), undefined);
});

test('compiled agree button hides the prompt after the native authorization event', options, () => {
  const { page, request } = createPage();
  const decisions = [];
  request(decision => decisions.push(decision));
  const button = find(render(page.data), node => node.attr?.id === 'agree-privacy');
  page[button.attr.bindtap]();
  assert.ok(byClass(render(page.data), 'privacy-mask'));
  page[button.attr.bindagreeprivacyauthorization]();
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].event, 'agree');
  assert.equal(byClass(render(page.data), 'privacy-mask'), undefined);
});

test('compiled connection, error and animation controls follow their state', options, () => {
  const { page } = createPage();
  let tree = render(page.data);
  assert.ok(find(tree, node => node.attr?.bindtap === 'search'));
  assert.equal(byClass(tree, 'error'), undefined);
  page.setData({ connected: true, errorText: 'test error', light: Object.assign({}, page.data.light, { mode: 0 }) });
  tree = render(page.data);
  assert.equal(find(tree, node => node.attr?.bindtap === 'search'), undefined);
  assert.ok(find(tree, node => node.attr?.bindtap === 'disconnect'));
  assert.ok(byClass(tree, 'error'));
  assert.equal(byClass(tree, 'speed-control'), undefined);
  for (const mode of [1, 2]) {
    page.setData({ light: Object.assign({}, page.data.light, { mode }) });
    assert.ok(byClass(render(page.data), 'speed-control'));
  }
  page.setData({ light: Object.assign({}, page.data.light, { mode: 3 }) });
  assert.equal(byClass(render(page.data), 'speed-control'), undefined);
});
