#!/usr/bin/env python3
"""Forward 127.0.0.1:443 -> rpc.devnet.flop.network:443 via the VM egress proxy (HTTP CONNECT).

Why: the FLOP CLI (Node `ws` / polkadot.js) ignores the proxy env vars, so it
cannot reach the chain RPC directly from this VM (wss 1006 / https timeout).
curl proves the egress proxy tunnels wss fine (HTTP 101 on Upgrade).

Requires /etc/hosts entry (so the CLI keeps the real hostname for TLS/SNI):
    127.0.0.1 rpc.devnet.flop.network

Run (needs root for port 443):
    sudo python3 scripts/rpc-forward.py

Proxy credentials are read from the HTTPS_PROXY env var inside this script;
they never appear on a command line. Stop with Ctrl-C / pkill -f rpc-forward.py.
NOTE: /etc/hosts is wiped on VM replacement — re-add the entry if the VM resets.
"""
import base64
import os
import socket
import threading
import urllib.parse

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 443
TARGET_HOST = "rpc.devnet.flop.network"
TARGET_PORT = 443


def get_proxy():
    url = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or ""
    p = urllib.parse.urlparse(url)
    auth = ""
    if p.username:
        raw = f"{p.username}:{p.password or ''}"
        auth = "Basic " + base64.b64encode(raw.encode()).decode()
    return p.hostname, p.port or 3128, auth


def pipe(a, b):
    try:
        while True:
            data = a.recv(65536)
            if not data:
                break
            b.sendall(data)
    except OSError:
        pass
    finally:
        try:
            b.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def handle(client):
    up = None
    try:
        phost, pport, auth = get_proxy()
        up = socket.create_connection((phost, pport), timeout=15)
        req = (
            f"CONNECT {TARGET_HOST}:{TARGET_PORT} HTTP/1.1\r\n"
            f"Host: {TARGET_HOST}:{TARGET_PORT}\r\n"
        )
        if auth:
            req += f"Proxy-Authorization: {auth}\r\n"
        req += "\r\n"
        up.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = up.recv(4096)
            if not chunk:
                raise OSError("proxy closed during CONNECT")
            buf += chunk
        if b" 200 " not in buf.split(b"\r\n", 1)[0]:
            raise OSError(f"proxy CONNECT failed: {buf.splitlines()[0]!r}")
        t1 = threading.Thread(target=pipe, args=(client, up), daemon=True)
        t2 = threading.Thread(target=pipe, args=(up, client), daemon=True)
        t1.start()
        t2.start()
        t1.join()
        t2.join()
    except Exception as e:
        print(f"[forward] {e}", flush=True)
    finally:
        for s in (client, up):
            if s is not None:
                try:
                    s.close()
                except OSError:
                    pass


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((LISTEN_HOST, LISTEN_PORT))
    srv.listen(32)
    print(
        f"[forward] listening {LISTEN_HOST}:{LISTEN_PORT} -> "
        f"{TARGET_HOST}:{TARGET_PORT} via egress proxy",
        flush=True,
    )
    while True:
        client, _ = srv.accept()
        threading.Thread(target=handle, args=(client,), daemon=True).start()


if __name__ == "__main__":
    main()
