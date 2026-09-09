"""Run in multiple terminals: python scripts/client.py demo"""
import argparse
import asyncio
import json
from urllib.parse import quote

import httpx
from websockets.asyncio.client import connect


def parse_input(text: str) -> dict:
    if text == "PING" or text.startswith("PING "):
        return {"type": "GAME_COMMAND", "command": "PING", "payload": {"message": text[4:].lstrip()}}
    if text.startswith("{"):
        return json.loads(text)
    return {"type": "MESSAGE", "payload": {"text": text}}


async def run(base_url: str, room: str) -> None:
    async with httpx.AsyncClient() as http:
        response = await http.post(f"{base_url}/auth/guest")
        response.raise_for_status()
        credentials = response.json()
    ws_base = base_url.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
    async with connect(f"{ws_base}/ws/rooms/{quote(room, safe='')}?token={credentials['token']}") as socket:
        print(await socket.recv())
        print("Type a message, PING hello, or a JSON envelope. /quit exits.")

        async def receive():
            async for message in socket:
                print(f"\nReceived: {message}")

        receiver = asyncio.create_task(receive())
        try:
            while True:
                try:
                    text = await asyncio.to_thread(input, "> ")
                except EOFError:
                    break
                if text == "/quit":
                    break
                try:
                    data = parse_input(text)
                except ValueError:
                    print("Invalid JSON. Try again.")
                    continue
                await socket.send(json.dumps(data))
        finally:
            receiver.cancel()
            await asyncio.gather(receiver, return_exceptions=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("room", nargs="?", default="demo")
    parser.add_argument("--server", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    try:
        asyncio.run(run(args.server.rstrip("/"), args.room))
    except KeyboardInterrupt:
        pass
