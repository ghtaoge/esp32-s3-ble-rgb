const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPage } = require('./helpers/page');

test('agree and cancel close the prompt even when WeChat resolution throws', () => {
  for (const method of ['agreePrivacy', 'rejectPrivacy']) {
    const { page, request } = createPage();
    page.data.scanning = true;
    request(() => { throw new Error('SDK resolver failed'); });
    assert.equal(page.data.showPrivacy, true);
    assert.doesNotThrow(() => page[method]());
    assert.equal(page.data.showPrivacy, false);
    assert.equal(page.data.scanning, false);
    assert.ok(page.data.errorText);
  }
});

test('native agreement resumes every pending privacy request exactly once', () => {
  const { page, request, timers } = createPage();
  const decisions = [];
  request(value => decisions.push(value));
  request(value => decisions.push(value));
  page.preparePrivacyAgree();
  assert.equal(decisions.length, 0, 'an ordinary tap must not grant platform authorization');
  assert.equal(page.data.showPrivacy, true);
  page.agreePrivacy();
  assert.equal(page.data.showPrivacy, false);
  assert.equal(decisions.length, 2);
  assert.ok(decisions.every(value => value.event === 'agree' && value.buttonId === 'agree-privacy'));
  assert.equal(timers.size, 0);
  page.agreePrivacy();
  assert.equal(decisions.length, 2);
});

test('a missing native authorization event closes with cancellation instead of hanging or granting access', () => {
  const { page, request, expireTimers } = createPage();
  const decisions = [];
  page.data.scanning = true;
  request(value => decisions.push(value));
  page.preparePrivacyAgree();
  expireTimers();
  assert.equal(page.data.showPrivacy, false);
  assert.equal(page.data.scanning, false);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].event, 'disagree');
  assert.ok(page.data.errorText);
  page.agreePrivacy();
  assert.equal(decisions.length, 1, 'late events cannot revive a cancelled request');
});

test('cancel and unload release all pending requests and clear timers', () => {
  for (const method of ['rejectPrivacy', 'onUnload']) {
    const { page, request, timers } = createPage();
    const decisions = [];
    request(value => decisions.push(value));
    request(value => decisions.push(value));
    page.preparePrivacyAgree();
    page[method]();
    assert.equal(timers.size, 0);
    assert.equal(decisions.length, 2);
    assert.ok(decisions.every(value => value.event === 'disagree'));
  }
});
