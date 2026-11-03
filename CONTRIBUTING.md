# 参与开发

1. 固件在 `src/`，小程序在 `miniprogram/`。本地配置副本不是源码。
2. 运行 `npm test`、`npm run check:public` 和 `pio run`。
3. 修改模板时设置 `WXML_COMPILER`，运行实际模板渲染测试。
4. 修改 BLE 协议、颜色表或序号约定时同步更新两端实现、测试及 README。
5. 不提交个人 AppID、账号、凭据、设备地址、电脑绝对路径或生成文件。
6. PR 描述说明行为变化和实际执行的验证；真板按钮未测试时请明确说明。
