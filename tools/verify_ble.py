"""Real-device BLE integration test. Restores the original light settings."""
import asyncio
import argparse
import os
import shutil
from pathlib import Path
from bleak import BleakClient, BleakScanner

SERVICE = "a71b0001-6d6a-4b2e-ae8b-3d80b18a5100"
WRITE = "a71b0002-6d6a-4b2e-ae8b-3d80b18a5100"
STATUS = "a71b0003-6d6a-4b2e-ae8b-3d80b18a5100"
def esptool_path():
    if os.environ.get("ESPTOOL"):
        return os.environ["ESPTOOL"]
    detected = shutil.which("esptool") or shutil.which("esptool.exe")
    if detected:
        return detected
    core = Path(os.environ.get("PLATFORMIO_CORE_DIR", Path.home() / ".platformio"))
    executable = "esptool.exe" if os.name == "nt" else "esptool"
    candidate = core / "packages/tool-esptool" / executable
    if not candidate.is_file():
        raise RuntimeError("Install esptool or set ESPTOOL to its executable path")
    return str(candidate)

async def find_device():
    device = await BleakScanner.find_device_by_filter(
        lambda device, advertisement: SERVICE in advertisement.service_uuids, timeout=12)
    if not device:
        raise RuntimeError("S3 RGB light not found")
    return device

async def main(port):
    device = await find_device()
    print("FOUND", device.name, flush=True)
    notifications = asyncio.Queue()
    original = None
    sequence = 0

    async def command(client, settings, expected_result=0, raw=None):
        nonlocal sequence
        sequence = (sequence % 255) + 1
        packet = bytes([0xA5, 1, sequence, *settings]) if raw is None else bytes([0xA5, 1, sequence, *raw])
        await client.write_gatt_char(WRITE, packet, response=True)
        while True:
            result = await asyncio.wait_for(notifications.get(), timeout=4)
            assert len(result) == 11 and result[:2] == b"\x5a\x01", result
            if result[2] == sequence:
                assert result[10] == expected_result, result
                if not expected_result:
                    assert result[3:10] == bytes(settings), result
                return result

    async def subscribe(client):
        await client.start_notify(STATUS, lambda _, data: notifications.put_nowait(bytes(data)))

    async with BleakClient(device, timeout=15) as client:
        initial = bytes(await client.read_gatt_char(STATUS))
        assert len(initial) == 11 and initial[:2] == b"\x5a\x01", initial
        original = initial[3:10]
        print("INITIAL", list(original), flush=True)
        await subscribe(client)
        try:
            for settings in [
                [1, 0, 255, 0, 0, 25, 50],
                [1, 0, 0, 255, 0, 40, 50],
                [1, 0, 0, 0, 255, 10, 50],
                [1, 1, 255, 80, 160, 30, 20],
                [1, 2, 255, 80, 160, 30, 80],
                [1, 3, 255, 0, 0, 25, 50],
                [0, 0, 120, 45, 220, 0, 61],
                [1, 0, 120, 45, 220, 32, 61],
            ]:
                await command(client, settings)
            saved = bytes(settings)
            invalid = list(saved)
            invalid[5] = 101
            rejected = await command(client, invalid, expected_result=2)
            assert rejected[3:10] == saved
            rejected = await command(client, saved, expected_result=1, raw=[1])
            assert rejected[3:10] == saved
            readable = bytes(await client.read_gatt_char(STATUS))
            assert readable[10] == 0 and readable[3:10] == saved, readable
            print("PASS: colors, brightness, power, all modes, ACKs, invalid packets", flush=True)
            # Leave the desired state as the readable status before reboot.
            await command(client, saved)
            await asyncio.sleep(1.8)
        except BaseException:
            await command(client, original)
            await asyncio.sleep(1.8)
            raise

    # Verify that the controller advertises after disconnect and survives a reset.
    await find_device()
    process = await asyncio.create_subprocess_exec(
        esptool_path(), "--chip", "esp32s3", "--port", port, "--after", "watchdog-reset", "read-mac",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    output, _ = await process.communicate()
    if process.returncode:
        raise RuntimeError(output.decode(errors="replace"))
    await asyncio.sleep(2)
    device = await find_device()
    async with BleakClient(device, timeout=15) as client:
        restored = bytes(await client.read_gatt_char(STATUS))
        try:
            assert restored[3:10] == saved, (restored, saved)
            print("PASS: advertising restart, reconnect, settings persisted across hardware reset", flush=True)
        finally:
            await subscribe(client)
            await command(client, original)
            await asyncio.sleep(1.8)
    print("PASS: original light settings restored; device ready for WeChat", flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True, help="Serial port for the reset/persistence test")
    asyncio.run(main(parser.parse_args().port))
