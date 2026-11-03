"""Interactive real-board test: press BOOT twice, about two seconds apart."""
import asyncio
from bleak import BleakClient, BleakScanner

SERVICE = "a71b0001-6d6a-4b2e-ae8b-3d80b18a5100"
WRITE = "a71b0002-6d6a-4b2e-ae8b-3d80b18a5100"
STATUS = "a71b0003-6d6a-4b2e-ae8b-3d80b18a5100"

async def main():
    device = await BleakScanner.find_device_by_filter(
        lambda device, adv: SERVICE in adv.service_uuids, timeout=12)
    if not device:
        raise RuntimeError("RGB light not found; disconnect the phone during this test")
    events = asyncio.Queue()
    sequence = 0
    async with BleakClient(device, timeout=15) as client:
        original = bytes(await client.read_gatt_char(STATUS))[3:10]
        await client.start_notify(STATUS, lambda _, data: events.put_nowait(bytes(data)))

        async def remote(settings):
            nonlocal sequence
            sequence = sequence % 255 + 1
            await client.write_gatt_char(WRITE, bytes([0xA5, 1, sequence, *settings]), response=True)
            while True:
                result = await asyncio.wait_for(events.get(), 4)
                if result[2] == sequence:
                    assert result[3:10] == bytes(settings) and result[10] == 0, result
                    return

        async def button(expected):
            while True:
                result = await asyncio.wait_for(events.get(), 60)
                if result[2] == 0:
                    assert result[3:10] == bytes(expected) and result[10] == 0, list(result)
                    read = bytes(await client.read_gatt_char(STATUS))
                    assert read[3:10] == bytes(expected), list(read)
                    return

        try:
            await remote([1, 0, 255, 255, 255, 25, 50])
            print("READY_FOR_BUTTON: press BOOT twice, approximately 2 seconds apart", flush=True)
            await button([1, 0, 255, 72, 72, 25, 50])
            print("PASS: white wraps to red; local notification and state read match", flush=True)
            await remote([1, 0, 101, 139, 255, 25, 50])
            print("REMOTE_BLUE_SET: press BOOT once more", flush=True)
            await button([1, 0, 170, 125, 255, 25, 50])
            print("PASS: remote blue -> button purple; both input sources share one state", flush=True)
        finally:
            await remote(original)
            await asyncio.sleep(1.8)
            print("RESTORED: original settings; phone can reconnect after test", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
