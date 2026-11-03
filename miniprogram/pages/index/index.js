const protocol = require('../../utils/protocol');
const { LightClient, message } = require('../../utils/ble');
const MODES = [
  { id: 0, name: '常亮', note: '留住喜欢的颜色', symbol: '●' },
  { id: 1, name: '呼吸', note: '柔和地明暗起伏', symbol: '◉' },
  { id: 2, name: '彩虹', note: '让色彩缓缓流动', symbol: '◌' },
  { id: 3, name: '十秒变色', note: '红、绿、蓝依次亮起', symbol: '↻' }
];
const PALETTE = ['#FF4848', '#FF9F43', '#FFD166', '#6FE3A5', '#5BD8E8', '#658BFF', '#AA7DFF', '#FA86C4', '#FFFFFF'];

Page({
  data: {
    connected: false, scanning: false, connectingId: '', devices: [], deviceName: '',
    light: Object.assign({}, protocol.DEFAULT_STATE), colorHex: '#FF0000',
    modes: MODES, palette: PALETTE, modeName: '十秒变色', effectDuration: 4500,
    syncText: '', errorText: '', showPrivacy: false, privacyAgreePending: false,
    privacyName: '《用户隐私保护指引》'
  },
  onLoad() {
    this.draft = Object.assign({}, protocol.DEFAULT_STATE);
    this.confirmed = Object.assign({}, this.draft);
    this.revision = 0;
    this.pendingWrites = 0;
    this.privacyResolvers = new Set();
    this.scanAttempt = 0;
    this.client = new LightClient({
      onDevice: device => {
        if (this.unloaded) return;
        const devices = this.data.devices.slice();
        const index = devices.findIndex(item => item.deviceId === device.deviceId);
        if (index < 0) devices.push(device); else devices[index] = device;
        devices.sort((a, b) => (b.RSSI || -127) - (a.RSSI || -127));
        this.setData({ devices });
      },
      onScanEnd: () => { if (!this.unloaded) this.setData({ scanning: false }); },
      onState: state => {
        this.confirmed = state;
        if (!this.pendingWrites && !this.unloaded) {
          this.applyState(state);
          if (this.data.connected) this.setData({ syncText: '已同步', errorText: '' });
        }
      },
      onConnection: (connected, device) => {
        if (this.unloaded) return;
        this.setData({ connected, deviceName: device ? device.name : '', connectingId: '',
          syncText: connected ? '已同步' : '', errorText: connected ? '' : '连接已断开，点击搜索重新连接' });
      }
    });
    if (wx.onNeedPrivacyAuthorization) {
      this.privacyHandler = resolve => {
        if (typeof resolve !== 'function' || this.unloaded) return;
        // 多个接口可能同时申请授权，不能覆盖前一个仍在等待的回调。
        this.privacyResolvers.add(resolve);
        this.setData({ showPrivacy: true });
        if (wx.getPrivacySetting) wx.getPrivacySetting({ success: result => {
          if (!this.unloaded) this.setData({ privacyName: result.privacyContractName || this.data.privacyName });
        } });
      };
      wx.onNeedPrivacyAuthorization(this.privacyHandler);
    }
  },
  onShow() {
    if (this.client && this.client.ready) this.client.refresh().catch(error => {
      if (!this.unloaded) this.setData({ syncText: '未同步', errorText: message(error) });
    });
  },
  onHide() { if (this.client) this.client.stopScan(); },
  onUnload() {
    this.unloaded = true;
    this.settlePrivacy('disagree');
    if (wx.offNeedPrivacyAuthorization && this.privacyHandler) wx.offNeedPrivacyAuthorization(this.privacyHandler);
    if (this.client) this.client.destroy();
  },
  applyState(state) {
    this.draft = Object.assign({}, state);
    this.setData({ light: this.draft, colorHex: protocol.hex(state),
      modeName: MODES[state.mode].name, effectDuration: 8000 - state.speed * 70 });
  },
  async search() {
    if (this.data.scanning || this.data.connectingId) return;
    const attempt = ++this.scanAttempt;
    this.setData({ scanning: true, devices: [], errorText: '' });
    try { await this.client.scan(); }
    catch (error) {
      if (!this.unloaded && attempt === this.scanAttempt) this.setData({ scanning: false, errorText: message(error) });
    }
  },
  async connect(event) {
    if (this.data.connectingId) return;
    const device = this.data.devices.find(item => item.deviceId === event.currentTarget.dataset.id);
    if (!device) return;
    this.setData({ connectingId: device.deviceId, errorText: '' });
    try { this.applyState(await this.client.connect(device)); }
    catch (error) { this.setData({ connectingId: '', connected: false, errorText: message(error) }); }
  },
  async disconnect() {
    await this.client.disconnect();
    this.setData({ connected: false, deviceName: '', syncText: '', errorText: '' });
  },
  async commit(patch) {
    if (!this.data.connected) return;
    this.applyState(Object.assign({}, this.draft, patch));
    const revision = ++this.revision;
    this.pendingWrites++;
    this.setData({ syncText: '正在同步…', errorText: '' });
    try {
      await this.client.send(this.draft);
      if (!this.unloaded && revision === this.revision) {
        // 按键通知可能紧跟在指令确认之后到达，以最后收到的板端状态为准。
        this.applyState(this.confirmed);
        this.setData({ syncText: '已同步' });
      }
    } catch (error) {
      if (!this.unloaded && revision === this.revision) {
        this.applyState(this.confirmed);
        this.setData({ syncText: '未同步', errorText: message(error) });
      }
    } finally {
      this.pendingWrites--;
      if (!this.pendingWrites && !this.unloaded) this.applyState(this.confirmed);
    }
  },
  toggle(event) { this.commit({ on: event.detail.value }); },
  selectMode(event) { this.commit({ mode: Number(event.currentTarget.dataset.mode), on: true }); },
  selectColor(event) {
    const value = event.currentTarget.dataset.color.slice(1);
    this.commit({ red: parseInt(value.slice(0, 2), 16), green: parseInt(value.slice(2, 4), 16),
      blue: parseInt(value.slice(4, 6), 16), mode: 0, on: true });
  },
  previewSlider(event) {
    if (!this.data.connected) return;
    const field = event.currentTarget.dataset.field;
    const patch = { [field]: event.detail.value };
    if (['red', 'green', 'blue'].includes(field)) patch.mode = 0;
    this.applyState(Object.assign({}, this.draft, patch));
  },
  commitSlider(event) {
    const field = event.currentTarget.dataset.field;
    const patch = { [field]: event.detail.value };
    if (['red', 'green', 'blue'].includes(field)) { patch.mode = 0; patch.on = true; }
    this.commit(patch);
  },
  openSettings() { wx.openSetting({}); },
  openPrivacy() {
    wx.openPrivacyContract({ fail: () => wx.showToast({ title: '请先在小程序后台配置隐私指引', icon: 'none' }) });
  },
  preparePrivacyAgree() {
    if (!this.data.showPrivacy || this.data.privacyAgreePending) return;
    this.setData({ privacyAgreePending: true });
    // 普通 tap 只启动超时保护。真正同意必须等微信的原生授权事件。
    this.privacyTimer = setTimeout(() => {
      this.settlePrivacy('disagree', '微信未完成隐私授权，请重新搜索后再试；开发工具中请使用手机预览测试。');
    }, 3000);
  },
  settlePrivacy(event, reason = '') {
    clearTimeout(this.privacyTimer);
    const resolvers = Array.from(this.privacyResolvers);
    this.privacyResolvers.clear();
    let failed = false;
    try {
      resolvers.forEach(resolve => {
        try {
          resolve(event === 'agree' ? { event, buttonId: 'agree-privacy' } : { event });
        } catch (error) {
          failed = true;
          console.warn('Privacy authorization could not complete:', error);
        }
      });
    } finally {
      // 即使平台回调报错，也必须收起弹窗并让用户能够重试。
      const patch = { showPrivacy: this.privacyResolvers.size > 0, privacyAgreePending: false };
      if (event !== 'agree' || failed) {
        ++this.scanAttempt;
        patch.scanning = false;
        patch.errorText = reason || (failed ? '隐私授权未完成，请重新搜索后再试。' : '已取消连接，点击搜索可以重试。');
      }
      if (!this.unloaded) this.setData(patch);
    }
  },
  agreePrivacy() {
    this.settlePrivacy('agree');
  },
  rejectPrivacy() {
    this.settlePrivacy('disagree');
  },
  ignorePrivacyTap() {}
});
