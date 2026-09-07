"""Send one JSON command directly to a running Blender MCP add-on socket."""

import argparse
import json
import socket


parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, required=True)
source = parser.add_mutually_exclusive_group(required=True)
source.add_argument("--code")
source.add_argument("--code-file")
args = parser.parse_args()

code = args.code
if args.code_file:
    with open(args.code_file, "r", encoding="utf-8") as handle:
        code = handle.read()

command = {"type": "execute_code", "params": {"code": code}}
with socket.create_connection(("127.0.0.1", args.port), timeout=5) as client:
    client.settimeout(30)
    client.sendall(json.dumps(command).encode("utf-8"))
    chunks = []
    while True:
        chunk = client.recv(8192)
        if not chunk:
            break
        chunks.append(chunk)
        try:
            response = json.loads(b"".join(chunks).decode("utf-8"))
            break
        except json.JSONDecodeError:
            continue

print(json.dumps(response, indent=2))
