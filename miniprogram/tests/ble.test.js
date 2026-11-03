const { test } = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../utils/protocol');

test('BLE client negotiates actual UUIDs, reads state, serializes writes and handles rejection/disconnection', async () => {
  const listeners = {};
  const writes = [];
  const service = protocol.SERVICE_UUID.toUpperCase();
  const statusId = protocol.STATUS_UUID.toUpperCase();
  let state = Object.assign({}, protocol.DEFAULT_STATE);
  let inFlight = 0;
  let maximumInFlight = 0;
  let rejectNext = false;
  let holdNextWrite = false;
  let heldWrite;
  const receivedStates = [];
  const status = (sequence, result = 0) => new Uint8Array([0x5A, 1, sequence,
    +state.on, state.mode, state.red, state.green, state.blue, state.brightness, state.speed, result]).buffer;
  const emit = value => listeners.value({ deviceId: 'device-ios-uuid', characteristicId: statusId, value });
  const ok = (options, result = {}) => queueMicrotask(() => options.success(result));
  global.wx = {
    onBluetoothDeviceFound: fn => { listeners.found = fn; },
    offBluetoothDeviceFound: () => { delete listeners.found; },
    onBLECharacteristicValueChange: fn => { listeners.value = fn; },
    offBLECharacteristicValueChange: () => { delete listeners.value; },
    onBLEConnectionStateChange: fn => { listeners.connection = fn; },
    offBLEConnectionStateChange: () => { delete listeners.connection; },
    requirePrivacyAuthorize: ok, authorize: ok, openBluetoothAdapter: ok,
    stopBluetoothDevicesDiscovery: ok, startBluetoothDevicesDiscovery: ok,
    getBluetoothDevices: options => ok(options, { devices: [
      { name: 'unrelated', deviceId: 'other' },
      { localName: 'S3-RGB-TEST', deviceId: 'device-ios-uuid', RSSI: -45 }
    ] }),
    createBLEConnection: ok,
    getBLEDeviceServices: options => ok(options, { services: [{ uuid: service }] }),
    getBLEDeviceCharacteristics: options => {
      assert.equal(options.serviceId, service);
      ok(options, { characteristics: [
        { uuid: protocol.WRITE_UUID.toUpperCase(), properties: { write: true } },
        { uuid: statusId, properties: { read: true, notify: true } }
      ] });
    },
    notifyBLECharacteristicValueChange: ok,
    readBLECharacteristicValue: options => { ok(options); queueMicrotask(() => emit(status(0))); },
    writeBLECharacteristicValue: options => {
      const packet = new Uint8Array(options.value);
      assert.equal(options.serviceId, service);
      assert.equal(packet.length, 10);
      writes.push(Array.from(packet));
      maximumInFlight = Math.max(maximumInFlight, ++inFlight);
      const complete = () => {
        const result = rejectNext ? 2 : 0;
        rejectNext = false;
        if (!result) state = { on: !!packet[3], mode: packet[4], red: packet[5], green: packet[6], blue: packet[7], brightness: packet[8], speed: packet[9] };
        inFlight--;
        options.success({});
        emit(status(packet[2], result));
      };
      if (holdNextWrite) { holdNextWrite = false; heldWrite = complete; }
      else setTimeout(complete, 5);
    },
    closeBLEConnection: ok, closeBluetoothAdapter: ok
  };
  const { LightClient } = require('../utils/ble');
  const devices = [];
  const client = new LightClient({ onDevice: d => devices.push(d), onState: s => receivedStates.push(s), onConnection() {}, onScanEnd() {} });
  try {
    await client.scan();
    assert.equal(devices.length, 1);
    assert.deepEqual(await client.connect(devices[0]), protocol.DEFAULT_STATE);
    const first = Object.assign({}, state, { mode: 0, red: 12, blue: 201 });
    const second = Object.assign({}, first, { brightness: 70 });
    const [one, two] = await Promise.all([client.send(first), client.send(second)]);
    assert.deepEqual(one, first);
    assert.deepEqual(two, second);
    assert.equal(maximumInFlight, 1);
    assert.notEqual(writes[0][2], writes[1][2]);
    holdNextWrite = true;
    let acknowledged = false;
    const pendingWrite = client.send(second).then(result => { acknowledged = true; return result; });
    const pendingRefresh = client.refresh();
    await new Promise(resolve => setImmediate(resolve));
    state = Object.assign({}, second, { red: 170, green: 125, blue: 255 });
    emit(status(0));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(acknowledged, false, 'a local button event must not acknowledge an outstanding phone command');
    assert.equal(receivedStates.at(-1).blue, 255);
    heldWrite();
    assert.deepEqual(await pendingWrite, second);
    assert.deepEqual(await pendingRefresh, second, 'refresh must wait until the write completes');
    rejectNext = true;
    await assert.rejects(client.send(first), /拒绝/);
    assert.deepEqual(await client.send(second), second);
    listeners.connection({ deviceId: 'device-ios-uuid', connected: false });
    await assert.rejects(client.send(first), /连接/);
    assert.equal(client.ready, false);
    assert.throws(() => protocol.decode(new Uint8Array([0x5A, 2]).buffer));
    assert.throws(() => protocol.encode(Object.assign({}, first, { brightness: 101 }), 1));
  } finally { await client.destroy(); }
  assert.equal(Object.keys(listeners).length, 0);
});
