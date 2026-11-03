const SERVICE_UUID = 'a71b0001-6d6a-4b2e-ae8b-3d80b18a5100';
const WRITE_UUID = 'a71b0002-6d6a-4b2e-ae8b-3d80b18a5100';
const STATUS_UUID = 'a71b0003-6d6a-4b2e-ae8b-3d80b18a5100';
const DEFAULT_STATE = { on: true, mode: 3, red: 255, green: 0, blue: 0, brightness: 25, speed: 50 };
// 手机命令序号为 1~255；状态包序号 0 表示 BOOT 按键等板端主动更新。

function validState(s) {
  return typeof s.on === 'boolean' &&
    [s.mode, s.red, s.green, s.blue, s.brightness, s.speed].every(Number.isInteger) &&
    s.mode >= 0 && s.mode <= 3 && s.red >= 0 && s.red <= 255 &&
    s.green >= 0 && s.green <= 255 && s.blue >= 0 && s.blue <= 255 &&
    s.brightness >= 0 && s.brightness <= 100 && s.speed >= 1 && s.speed <= 100;
}
function encode(s, sequence) {
  if (!validState(s)) throw new Error('灯光设置超出范围');
  return new Uint8Array([0xA5, 1, sequence & 255, s.on ? 1 : 0, s.mode,
    s.red, s.green, s.blue, s.brightness, s.speed]).buffer;
}
function decode(buffer) {
  const b = new Uint8Array(buffer);
  if (b.length !== 11 || b[0] !== 0x5A || b[1] !== 1 || b[3] > 1) throw new Error('灯光数据格式不正确');
  const state = { on: !!b[3], mode: b[4], red: b[5], green: b[6], blue: b[7], brightness: b[8], speed: b[9] };
  if (!validState(state)) throw new Error('灯光数据超出范围');
  return { sequence: b[2], result: b[10], state };
}
function hex(s) {
  return '#' + [s.red, s.green, s.blue].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}
module.exports = { SERVICE_UUID, WRITE_UUID, STATUS_UUID, DEFAULT_STATE, encode, decode, hex };
