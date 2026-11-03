#include <Arduino.h>

namespace {
constexpr uint32_t kColorIntervalMs = 10000;  // 每种颜色保持 10 秒。
constexpr uint8_t kBrightness = 64;          // 亮度范围 0~255。

struct Color {
  uint8_t red;
  uint8_t green;
  uint8_t blue;
  const char* name;
};

constexpr Color kColors[] = {
    {kBrightness, 0, 0, "RED"},    // 红
    {0, kBrightness, 0, "GREEN"},  // 绿
    {0, 0, kBrightness, "BLUE"},   // 蓝
};
constexpr size_t kColorCount = sizeof(kColors) / sizeof(kColors[0]);

size_t colorIndex = 0;
uint32_t lastColorChangeMs = 0;

void showColor(size_t index) {
  const Color& color = kColors[index];
  // 板载灯是可寻址 RGB 灯，使用 Arduino 自带的驱动，无需额外库。
  rgbLedWrite(RGB_LED_PIN, color.red, color.green, color.blue);
  Serial.printf("[%lu ms] RGB=%s (GPIO%d)\n",
                static_cast<unsigned long>(millis()), color.name, RGB_LED_PIN);
}
}  // namespace

void setup() {
  Serial.begin(115200);
  // 最多等待 1.5 秒连接串口；脱离电脑供电也能正常运行。
  const uint32_t serialStartMs = millis();
  while (!Serial && millis() - serialStartMs < 1500) {
    delay(10);
  }

  Serial.printf("ESP32-S3 RGB cycle: interval=%lu ms, Flash=%lu, PSRAM=%lu bytes\n",
                static_cast<unsigned long>(kColorIntervalMs),
                static_cast<unsigned long>(ESP.getFlashChipSize()),
                static_cast<unsigned long>(ESP.getPsramSize()));
  showColor(colorIndex);
  lastColorChangeMs = millis();
}

void loop() {
  const uint32_t nowMs = millis();
  // 无符号减法可在 millis() 溢出后继续正确计时。
  if (nowMs - lastColorChangeMs >= kColorIntervalMs) {
    lastColorChangeMs = nowMs;
    colorIndex = (colorIndex + 1) % kColorCount;
    showColor(colorIndex);
  }
  delay(1);
}
