const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createPage() {
  let definition;
  let privacyHandler;
  let nextTimer = 0;
  const timers = new Map();
  const wx = {
    onNeedPrivacyAuthorization(handler) { privacyHandler = handler; },
    offNeedPrivacyAuthorization() { privacyHandler = null; },
    getPrivacySetting(options) { options.success({ privacyContractName: '用户隐私保护指引' }); }
  };
  class FakeClient {
    constructor(events) { this.events = events; }
    stopScan() {}
    destroy() {}
    async scan() {}
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/index/index.js'), 'utf8'), {
    Page(page) { definition = page; }, wx,
    require(name) {
      if (name.endsWith('/protocol')) return require('../../utils/protocol');
      if (name.endsWith('/ble')) return { LightClient: FakeClient, message: e => e.message };
      throw new Error('Unexpected dependency');
    },
    console: { warn() {}, error() {} },
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); }
  });
  page.onLoad();
  return {
    page, timers,
    request(resolve) { privacyHandler(resolve); },
    expireTimers() { for (const [id, fn] of Array.from(timers)) { timers.delete(id); fn(); } }
  };
}
module.exports = { createPage };
