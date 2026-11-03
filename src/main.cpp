#include <Arduino.h>
#if defined(CONFIG_BLUEDROID_ENABLED)
#include <BLE2902.h>
#endif
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <Preferences.h>
#include <atomic>
#include <cmath>
#include <cstring>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"

namespace {
// Keep in sync with miniprogram/utils/protocol.js. Packets fit the 20-byte BLE payload.
constexpr char kServiceUuid[] = "a71b0001-6d6a-4b2e-ae8b-3d80b18a5100";
constexpr char kWriteUuid[] = "a71b0002-6d6a-4b2e-ae8b-3d80b18a5100";
constexpr char kStatusUuid[] = "a71b0003-6d6a-4b2e-ae8b-3d80b18a5100";
constexpr uint8_t kBootPin = 0;
enum Mode : uint8_t { Solid, Breath, Rainbow, Cycle };
struct Color { uint8_t red, green, blue; };
// Same order and RGB values as PALETTE in miniprogram/pages/index/index.js.
constexpr Color kButtonColors[] = {
    {0xFF, 0x48, 0x48}, {0xFF, 0x9F, 0x43}, {0xFF, 0xD1, 0x66},
    {0x6F, 0xE3, 0xA5}, {0x5B, 0xD8, 0xE8}, {0x65, 0x8B, 0xFF},
    {0xAA, 0x7D, 0xFF}, {0xFA, 0x86, 0xC4}, {0xFF, 0xFF, 0xFF},
};
constexpr size_t kButtonColorCount = sizeof(kButtonColors) / sizeof(kButtonColors[0]);
struct LightState {
  uint8_t on = 1;
  uint8_t mode = Cycle;
  uint8_t red = 255;
  uint8_t green = 0;
  uint8_t blue = 0;
  uint8_t brightness = 25;
  uint8_t speed = 50;
};
static_assert(sizeof(LightState) == 7, "Stored settings must be seven bytes");
struct Packet { uint8_t length = 0; uint8_t bytes[10] = {}; };
LightState state;
Preferences preferences;
bool storageReady = false;
bool dirty = false;
uint32_t changedAt = 0;
uint32_t modeStartedAt = 0;
QueueHandle_t commands = nullptr;
BLECharacteristic* statusCharacteristic = nullptr;
std::atomic<bool> connected{false};

bool validState(const LightState& candidate) {
  return candidate.on <= 1 && candidate.mode <= Cycle && candidate.brightness <= 100 &&
         candidate.speed >= 1 && candidate.speed <= 100;
}
void publishStatus(uint8_t sequence, uint8_t result = 0, bool notify = true) {
  uint8_t bytes[] = {0x5A, 1, sequence, state.on, state.mode, state.red,
                           state.green, state.blue, state.brightness, state.speed, result};
  statusCharacteristic->setValue(bytes, sizeof(bytes));
  if (notify && connected.load()) statusCharacteristic->notify();
  // Error ACKs belong to that write only; a later phone read always gets valid state.
  if (result != 0) {
    bytes[10] = 0;
    statusCharacteristic->setValue(bytes, sizeof(bytes));
  }
}
void stateChanged() {
  changedAt = millis();
  dirty = true;
  Serial.printf("LIGHT on=%u mode=%u rgb=%u,%u,%u brightness=%u speed=%u\n",
                state.on, state.mode, state.red, state.green, state.blue, state.brightness, state.speed);
}
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { connected.store(true); }
  void onDisconnect(BLEServer*) override { connected.store(false); }
};
class WriteCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    const String value = characteristic->getValue();
    Packet packet;
    packet.length = value.length() == sizeof(packet.bytes) ? sizeof(packet.bytes) : 0;
    memcpy(packet.bytes, value.c_str(), min(value.length(), sizeof(packet.bytes)));
    // Render, notify and persist only in loop(), never inside the BLE task.
    xQueueOverwrite(commands, &packet);
  }
};
void processCommand() {
  Packet packet;
  if (xQueueReceive(commands, &packet, 0) != pdTRUE) return;
  const uint8_t sequence = packet.bytes[2];
  if (packet.length != 10 || packet.bytes[0] != 0xA5 || packet.bytes[1] != 1) {
    publishStatus(sequence, 1);
    return;
  }
  LightState candidate;
  memcpy(&candidate, packet.bytes + 3, sizeof(candidate));
  if (!validState(candidate)) { publishStatus(sequence, 2); return; }
  if (memcmp(&candidate, &state, sizeof(state)) != 0) {
    if (candidate.mode != state.mode || candidate.on != state.on) modeStartedAt = millis();
    state = candidate;
    stateChanged();
  }
  publishStatus(sequence);
}
Color currentColor(uint32_t now) {
  Color color{state.red, state.green, state.blue};
  const uint32_t elapsed = now - modeStartedAt;
  const uint32_t duration = 8000 - state.speed * 70;
  if (state.mode == Rainbow) {
    const uint16_t hue = static_cast<uint32_t>(elapsed % duration) * 768 / duration;
    const uint8_t step = hue % 256;
    if (hue < 256) color = {static_cast<uint8_t>(255 - step), step, 0};
    else if (hue < 512) color = {0, static_cast<uint8_t>(255 - step), step};
    else color = {step, 0, static_cast<uint8_t>(255 - step)};
  } else if (state.mode == Cycle) {
    const uint8_t index = (elapsed / 10000) % 3;
    color = {static_cast<uint8_t>(index == 0 ? 255 : 0),
             static_cast<uint8_t>(index == 1 ? 255 : 0),
             static_cast<uint8_t>(index == 2 ? 255 : 0)};
  }
  return color;
}
void nextButtonColor(uint32_t now) {
  const Color current = currentColor(now);
  size_t nearest = 0;
  uint32_t shortestDistance = UINT32_MAX;
  for (size_t i = 0; i < kButtonColorCount; ++i) {
    const int red = static_cast<int>(current.red) - kButtonColors[i].red;
    const int green = static_cast<int>(current.green) - kButtonColors[i].green;
    const int blue = static_cast<int>(current.blue) - kButtonColors[i].blue;
    const uint32_t distance = red * red + green * green + blue * blue;
    if (distance < shortestDistance) { nearest = i; shortestDistance = distance; }
  }
  const Color next = kButtonColors[(nearest + 1) % kButtonColorCount];
  state.red = next.red;
  state.green = next.green;
  state.blue = next.blue;
  state.mode = Solid;
  state.on = 1;
  if (state.brightness == 0) state.brightness = 25;
  modeStartedAt = now;
  stateChanged();
  // Sequence 0 is a local update, never an acknowledgment for a phone command.
  publishStatus(0);
}
void renderLight(uint32_t now) {
  static uint32_t lastFrameAt = 0;
  static uint32_t lastRgb = 0xFFFFFFFF;
  if (now - lastFrameAt < 20) return;
  lastFrameAt = now;
  Color color = currentColor(now);
  float level = state.on ? state.brightness / 100.0f : 0.0f;
  if (state.mode == Breath) {
    const uint32_t duration = 8000 - state.speed * 70;
    const float phase = ((now - modeStartedAt) % duration) / static_cast<float>(duration);
    level *= (1.0f - cosf(phase * 2.0f * PI)) / 2.0f;
  }
  const uint8_t red = static_cast<uint8_t>(color.red * level + 0.5f);
  const uint8_t green = static_cast<uint8_t>(color.green * level + 0.5f);
  const uint8_t blue = static_cast<uint8_t>(color.blue * level + 0.5f);
  const uint32_t rgb = (red << 16) | (green << 8) | blue;
  if (rgb != lastRgb) {
    rgbLedWrite(RGB_LED_PIN, red, green, blue);
    lastRgb = rgb;
  }
}
void pollButton(uint32_t now) {
  static int lastReading = HIGH;
  static int stableReading = HIGH;
  static uint32_t edgeAt = 0;
  const int reading = digitalRead(kBootPin);
  if (reading != lastReading) { lastReading = reading; edgeAt = now; }
  if (now - edgeAt >= 40 && reading != stableReading) {
    stableReading = reading;
    if (reading == LOW) {
      nextButtonColor(now);
    }
  }
}
}  // namespace

void setup() {
  Serial.begin(115200);
  pinMode(kBootPin, INPUT_PULLUP);
  storageReady = preferences.begin("s3-rgb-v1", false);
  LightState saved;
  if (storageReady && preferences.getBytesLength("light") == sizeof(saved) &&
      preferences.getBytes("light", &saved, sizeof(saved)) == sizeof(saved) && validState(saved)) state = saved;
  commands = xQueueCreate(1, sizeof(Packet));
  if (!commands) {
    Serial.println("ERROR: cannot create command queue");
    while (true) delay(1000);
  }
  const uint64_t mac = ESP.getEfuseMac();
  char deviceName[24];
  snprintf(deviceName, sizeof(deviceName), "S3-RGB-%04X", static_cast<unsigned>((mac >> 32) & 0xFFFF));
  if (!BLEDevice::init(deviceName)) {
    Serial.println("ERROR: BLE initialization failed");
    while (true) delay(1000);
  }
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  server->advertiseOnDisconnect(true);
  BLEService* service = server->createService(kServiceUuid);
  BLECharacteristic* command = service->createCharacteristic(kWriteUuid, BLECharacteristic::PROPERTY_WRITE);
  command->setCallbacks(new WriteCallbacks());
  statusCharacteristic = service->createCharacteristic(
      kStatusUuid, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
#if defined(CONFIG_BLUEDROID_ENABLED)
  statusCharacteristic->addDescriptor(new BLE2902());
#endif
  publishStatus(0, 0, false);
  service->start();
  // Service UUID in advertisement; device name in scan response (31-byte limit).
  BLEAdvertisementData advertisement;
  advertisement.setFlags(0x06);
  advertisement.setCompleteServices(BLEUUID(kServiceUuid));
  BLEAdvertisementData scanResponse;
  scanResponse.setName(deviceName);
  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->setAdvertisementData(advertisement);
  advertising->setScanResponseData(scanResponse);
  advertising->setMinPreferred(0x06);
  advertising->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();
  modeStartedAt = millis();
  Serial.printf("READY %s GPIO=%d Flash=%lu PSRAM=%lu\n", deviceName, RGB_LED_PIN,
                static_cast<unsigned long>(ESP.getFlashChipSize()),
                static_cast<unsigned long>(ESP.getPsramSize()));
}
void loop() {
  processCommand();
  pollButton(millis());
  // Sample after state changes so unsigned timer subtraction never sees a future timestamp.
  const uint32_t now = millis();
  renderLight(now);
  if (dirty && now - changedAt >= 1500 && storageReady) {
    if (preferences.putBytes("light", &state, sizeof(state)) == sizeof(state)) {
      dirty = false;
      Serial.println("SETTINGS saved");
    } else changedAt = now;
  }
  static bool previousConnection = false;
  if (previousConnection != connected.load()) {
    previousConnection = connected.load();
    Serial.println(previousConnection ? "BLE connected" : "BLE disconnected; advertising resumed");
  }
  delay(2);
}
