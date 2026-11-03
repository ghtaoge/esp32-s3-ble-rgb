# esp32-s3-ble-rgb

使用 ESP32-S3 N16R8 开发板、Arduino 和微信小程序制作的蓝牙 RGB 彩灯。只需要开发板与 USB 供电，无需服务器或外接元件。

## 功能

- 小程序控制开关、RGB、亮度，以及常亮、呼吸、彩虹、每十秒变色四种模式。
- 短按 BOOT，按红、橙、黄、绿、青、蓝、紫、粉、白循环切色。
- 按键切色后进入常亮，保留亮度；亮度为零时恢复为 25%。按住不会连续切色。
- 自定义颜色或动画模式按键切色时，从当前色最接近的预设色继续向下切换。
- 开发板统一保存灯光状态，小程序指令和实体按钮共用同一份状态；最后执行的操作生效。
- 蓝牙通知更新手机界面；重连或回到前台时回读状态，避免旧界面覆盖板端设置。
- 停止调节约 1.5 秒后保存设置，重新上电恢复。

当前实现为 BLE 直连；Wi-Fi 配网、HTTP 客户端和小游戏尚未实现。

## 硬件与环境

| 项目 | 配置 |
| --- | --- |
| 开发板 | ESP32-S3 N16R8：16 MB Flash，8 MB OPI PSRAM |
| RGB 灯 | 可寻址 RGB，默认 GPIO48 |
| BOOT 按钮 | GPIO0，按下为低电平 |
| 固件 | VS Code + PlatformIO Core 6.2.0 + Arduino |
| 小程序测试 | Node.js 24 或更新版本 |
| 手机 | 微信及低功耗蓝牙支持 |

不同板型 RGB 接线可能不同。若灯接 GPIO38，请修改 `platformio.ini` 中的 `RGB_LED_PIN`。固定 UUID 是公开协议常量，不是访问密钥。

## 编译与烧录

用 VS Code 打开项目根目录并安装 PlatformIO 扩展。也可使用已加入 PATH 的 PlatformIO 命令：

```sh
pio run
pio device list
pio run --target upload
pio device monitor --baud 115200
```

如果连接了多个设备，在上传命令追加 `--upload-port <你的串口>`。首次烧录无法自动进入下载模式时，按住 BOOT，点按 RST/EN，再松开 BOOT。

## 微信小程序

公开的 `miniprogram/project.config.json` 只使用 `touristappid` 占位，不包含个人 AppID。模拟器可检查界面，BLE 功能需要手机真机预览。

为自己的 AppID 准备一个不进入 Git 的本地副本：

```sh
python tools/prepare_wechat.py
```

按提示输入你自己的小程序 AppID，然后在微信开发者工具中导入 `.local/wechat`，使用有该 AppID 开发权限的微信账号登录，编译并预览。手机打开蓝牙，在小程序中搜索名称以 `S3-RGB-` 开头的设备并连接；无需在系统蓝牙设置里提前配对。

源代码更新后重新运行准备脚本，再重新编译、预览。开发时修改公开的 `miniprogram/` 源码，不要只修改本地副本。正式使用所需的蓝牙权限和隐私保护指引由你在自己的小程序后台配置。

## 项目结构

```text
src/main.cpp                 固件及按键、动画、BLE 状态处理
platformio.ini               N16R8 构建配置
miniprogram/                 可公开的小程序源码与配置
miniprogram/tests/           蓝牙、授权、渲染和同步回归测试
tools/                       配置准备、公开内容检查和真板测试
examples/ten-second-cycle.cpp 原始十秒红绿蓝示例
```

## 测试

纯 JavaScript 测试不需要 npm 依赖或开发板：

```sh
npm test
npm run check:public
```

模板渲染测试需要微信开发者工具自带的 `wcc.exe`。设置 `WXML_COMPILER` 环境变量指向该文件后再运行 `npm test`。未配置时会明确跳过这三项渲染测试，不代表通过。

可选的真板测试需要电脑蓝牙及 Python 3.11+：

```sh
python -m pip install -r tools/requirements.txt
python tools/verify_ble.py --port <你的串口>
python tools/verify_button_sync.py
```

真板测试期间请先断开手机连接。第二个脚本需要按提示短按两次 BOOT，间隔约两秒。脚本会临时改变灯光，结束后恢复设置。BLE 完整测试还会复位开发板；它们不是纯软件测试，CI 不会自动运行。

## BLE 协议

| 特征 | UUID | 属性 |
| --- | --- | --- |
| Service | `a71b0001-6d6a-4b2e-ae8b-3d80b18a5100` | 服务 |
| Write | `a71b0002-6d6a-4b2e-ae8b-3d80b18a5100` | Write |
| Status | `a71b0003-6d6a-4b2e-ae8b-3d80b18a5100` | Read + Notify |

- 命令 10 字节：`A5 01 序号 开关 模式 R G B 亮度 速度`。
- 状态 11 字节：`5A 01 序号 开关 模式 R G B 亮度 速度 结果`。
- 模式：0 常亮、1 呼吸、2 彩虹、3 十秒变色；开关为 0/1，RGB 为 0–255，亮度为 0–100，速度为 1–100。
- 结果：0 成功、1 格式错误、2 参数范围错误。
- 手机指令使用序号 1–255；序号 0 表示板端主动更新，不用于确认手机指令。

本 Demo 没有 BLE 绑定或应用层身份验证，附近兼容客户端可连接控制灯光。它不适合直接作为门锁等敏感设备的控制方案。

## 提交到 GitHub

本地 AppID 副本、编辑器配置、构建产物、压缩包、环境文件及密钥文件已加入忽略规则。Git 仓库中的本地提交钩子可这样启用：

```sh
git config core.hooksPath .githooks
npm run check:public
git diff --cached --check
```

确认暂存内容后提交，在 GitHub 创建空仓库，再设置你自己的远程地址并推送：

```sh
git commit -m "Initial release"
git remote add origin <你的仓库地址>
git push -u origin main
```

检查脚本会阻止明显的 AppID、凭据、电脑用户路径及个人配置进入暂存内容，但不能代替人工检查。不要将本地副本或原始工作目录打包上传。

Git 提交作者姓名和邮箱属于提交元数据，不受文件检查覆盖。首次提交前检查自己的 Git 署名设置；希望隐藏个人邮箱时，使用 GitHub 账号提供的 noreply 邮箱。

## 许可证与参考

本项目源码使用 [MIT License](LICENSE)。Arduino ESP32、PlatformIO 和微信开发工具分别遵循其自身的许可；本仓库不分发这些依赖。

- [Arduino ESP32](https://github.com/espressif/arduino-esp32)
- [微信官方小程序示例](https://github.com/wechat-miniprogram/miniprogram-demo)
