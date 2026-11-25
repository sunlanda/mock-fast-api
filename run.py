"""Start MockFast and open it in the browser."""

from __future__ import annotations

import argparse
import os
import socket
import sys
import threading
import time
import webbrowser

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)


def _force_utf8_stdio() -> None:
    """Avoid cp1252 crashes on Windows when stdout is redirected to a log file."""
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (AttributeError, OSError, ValueError):
                pass


_force_utf8_stdio()


def port_available(host: str, port: int) -> bool:
    bind_host = host if host not in ("0.0.0.0", "::") else "127.0.0.1"
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((bind_host, port))
            return True
        except OSError:
            return False


def main() -> int:
    parser = argparse.ArgumentParser(description="MockFast — local API mock studio")
    parser.add_argument("--host", default=os.getenv("MOCKFAST_HOST", "127.0.0.1"))
    parser.add_argument(
        "--port", type=int, default=int(os.getenv("MOCKFAST_PORT", "8787"))
    )
    parser.add_argument("--reload", action="store_true", help="开发模式热重载")
    parser.add_argument("--open", action="store_true", help="启动后打开浏览器")
    args = parser.parse_args()

    os.environ["MOCKFAST_HOST"] = args.host
    os.environ["MOCKFAST_PORT"] = str(args.port)

    try:
        import fastapi  # noqa: F401
        import uvicorn
    except ImportError:
        print("依赖未安装。请先运行：")
        print("  python -m pip install -r requirements.txt")
        return 1

    if not port_available(args.host, args.port):
        print(f"端口 {args.port} 已被占用。请换一个端口，例如：")
        print(f"  python run.py --port {args.port + 1}")
        return 1

    display_host = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
    url = f"http://{display_host}:{args.port}"
    print("")
    print("  ███╗   ███╗ ██████╗  ██████╗██╗  ██╗███████╗ █████╗ ███████╗████████╗")
    print("  ████╗ ████║██╔═══██╗██╔════╝██║ ██╔╝██╔════╝██╔══██╗██╔════╝╚══██╔══╝")
    print("  ██╔████╔██║██║   ██║██║     █████╔╝ █████╗  ███████║███████╗   ██║")
    print("  ██║╚██╔╝██║██║   ██║██║     ██╔═██╗ ██╔══╝  ██╔══██║╚════██║   ██║")
    print("  ██║ ╚═╝ ██║╚██████╔╝╚██████╗██║  ██╗██║     ██║  ██║███████║   ██║")
    print("  ╚═╝     ╚═╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚══════╝   ╚═╝")
    print("")
    print(f"  MockFast  →  {url}")
    print(f"  API Docs   →  {url}/api/docs")
    print("  数据库策略 →  默认仅本机，远程需在设置中显式开启")
    print("  停止服务   →  Ctrl+C")
    print("")

    if args.open:
        def open_later() -> None:
            time.sleep(1.2)
            webbrowser.open(url)

        threading.Thread(target=open_later, daemon=True).start()

    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
