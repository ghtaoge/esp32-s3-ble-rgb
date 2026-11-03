const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPage } = require('./helpers/page');
const protocol = require('../utils/protocol');
const light = patch => Object.assign({}, protocol.DEFAULT_STATE, { mode: 0 }, patch);

test('a hardware notification updates color, mode and brightness without sending a command back', () => {
  const { page } = createPage();
  let writes = 0;
  page.client.send = () => { writes++; };
  page.client.events.onConnection(true, { name: 'S3-RGB-TEST' });
  page.client.events.onState(light({ red: 255, green: 159, blue: 67, brightness: 40 }));
  assert.equal(page.data.colorHex, '#FF9F43');
  assert.equal(page.data.modeName, '常亮');
  assert.equal(page.data.light.brightness, 40);
  assert.equal(page.data.light.on, true);
  assert.equal(page.data.syncText, '已同步');
  assert.equal(writes, 0, 'display updates must not echo back and overwrite the hardware');
});

test('a button pressed after a phone ACK remains the final displayed state', async () => {
  const { page } = createPage();
  page.client.events.onConnection(true, { name: 'S3-RGB-TEST' });
  let finishWrite;
  page.client.send = () => new Promise(resolve => { finishWrite = resolve; });
  const command = page.commit({ mode: 0, red: 0, green: 0, blue: 255 });
  const phoneState = light({ red: 0, green: 0, blue: 255 });
  const buttonState = light({ red: 170, green: 125, blue: 255 });
  page.client.events.onState(phoneState);
  page.client.events.onState(buttonState);
  finishWrite(phoneState);
  await command;
  assert.equal(page.data.colorHex, '#AA7DFF');
  assert.equal(page.pendingWrites, 0);
  assert.equal(page.data.syncText, '已同步');
});

test('returning to the foreground reads the current board state', async () => {
  const { page } = createPage();
  const buttonState = light({ red: 250, green: 134, blue: 196 });
  let refreshes = 0;
  page.client.ready = true;
  page.client.refresh = async () => {
    refreshes++;
    page.client.events.onState(buttonState);
    return buttonState;
  };
  page.onShow();
  await Promise.resolve();
  assert.equal(refreshes, 1);
  assert.equal(page.data.colorHex, '#FA86C4');
});
