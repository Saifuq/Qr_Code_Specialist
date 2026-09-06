import asyncio
import io
import os
import socket
import secrets
import time
import ctypes
import subprocess
import webbrowser
from datetime import datetime
from typing import Dict, List, Set, Optional
from contextlib import asynccontextmanager

import psutil
import qrcode
from PIL import ImageGrab
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles

# Directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

# Ensure .gitkeep in uploads
gitkeep_path = os.path.join(UPLOADS_DIR, ".gitkeep")
if not os.path.exists(gitkeep_path):
    with open(gitkeep_path, "w") as f:
        f.write("")

# Server Constants & State
PORT = 8000
pair_tokens: Dict[str, dict] = {}
pin_to_token: Dict[str, str] = {}
uploaded_files_history: List[dict] = []
clipboard_history: List[dict] = []

# Windows API Virtual Key Codes for Media & System Controls
VK_VOLUME_MUTE = 0xAD
VK_VOLUME_DOWN = 0xAE
VK_VOLUME_UP = 0xAF
VK_MEDIA_NEXT = 0xB0
VK_MEDIA_PREV = 0xB1
VK_MEDIA_STOP = 0xB2
VK_MEDIA_PLAY_PAUSE = 0xCD
VK_PRIOR = 0x21  # Page Up (Prev Slide)
VK_NEXT = 0x22   # Page Down (Next Slide)
VK_F5 = 0x74     # F5 (Presentation Start)
VK_ESCAPE = 0x1B # ESC

KEYEVENTF_KEYUP = 0x0002
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010


def send_win_key(vk_code: int):
    """Simulate key press on Windows OS using ctypes."""
    try:
        ctypes.windll.user32.keybd_event(vk_code, 0, 0, 0)
        time.sleep(0.05)
        ctypes.windll.user32.keybd_event(vk_code, 0, KEYEVENTF_KEYUP, 0)
    except Exception as e:
        print(f"[WinAPI Key Error] {e}")


def move_win_mouse(dx: int, dy: int):
    """Move cursor relative to current position."""
    try:
        class POINT(ctypes.Structure):
            _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]
        pt = POINT()
        ctypes.windll.user32.GetCursorPos(ctypes.byref(pt))
        ctypes.windll.user32.SetCursorPos(pt.x + int(dx * 1.8), pt.y + int(dy * 1.8))
    except Exception as e:
        print(f"[WinAPI Mouse Move Error] {e}")


def win_mouse_click(action: str):
    """Simulate left or right click."""
    try:
        if action == "left_click":
            ctypes.windll.user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            time.sleep(0.02)
            ctypes.windll.user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        elif action == "right_click":
            ctypes.windll.user32.mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
            time.sleep(0.02)
            ctypes.windll.user32.mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
    except Exception as e:
        print(f"[WinAPI Click Error] {e}")


def get_local_ip() -> str:
    """Retrieve the primary local IP address of the host PC."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


LOCAL_IP = get_local_ip()


class ConnectionManager:
    """Manages active WebSockets for PC Dashboards and Mobile Clients."""

    def __init__(self):
        self.pc_connections: Set[WebSocket] = set()
        self.mobile_connections: Dict[str, dict] = {}

    async def connect_pc(self, websocket: WebSocket):
        await websocket.accept()
        self.pc_connections.add(websocket)
        print("[WS] PC Dashboard connected.")

    def disconnect_pc(self, websocket: WebSocket):
        self.pc_connections.discard(websocket)
        print("[WS] PC Dashboard disconnected.")

    async def connect_mobile(self, websocket: WebSocket, device_id: str, token: str, device_info: dict):
        await websocket.accept()
        self.mobile_connections[device_id] = {
            "ws": websocket,
            "token": token,
            "info": device_info,
            "approved": False,
            "connected_at": time.time()
        }
        print(f"[WS] Mobile device connected (Pending approval): {device_id} - {device_info.get('name', 'Unknown')}")

    def disconnect_mobile(self, device_id: str):
        if device_id in self.mobile_connections:
            info = self.mobile_connections.pop(device_id)
            print(f"[WS] Mobile device disconnected: {device_id}")
            return info
        return None

    async def broadcast_to_pc(self, message: dict):
        to_remove = set()
        for ws in list(self.pc_connections):
            try:
                await ws.send_json(message)
            except Exception as e:
                print(f"[WS Error] Failed sending to PC: {e}")
                to_remove.add(ws)
        self.pc_connections.difference_update(to_remove)

    async def broadcast_to_approved_mobiles(self, message: dict):
        to_remove = []
        for dev_id, dev_data in list(self.mobile_connections.items()):
            if dev_data.get("approved"):
                try:
                    await dev_data["ws"].send_json(message)
                except Exception as e:
                    print(f"[WS Error] Failed sending to Mobile {dev_id}: {e}")
                    to_remove.append(dev_id)
        for dev_id in to_remove:
            self.disconnect_mobile(dev_id)

    async def send_to_mobile(self, device_id: str, message: dict):
        if device_id in self.mobile_connections:
            try:
                await self.mobile_connections[device_id]["ws"].send_json(message)
            except Exception as e:
                print(f"[WS Error] Failed sending to target device {device_id}: {e}")
                self.disconnect_mobile(device_id)


manager = ConnectionManager()


# Token & PIN Helpers
def create_pairing_token() -> dict:
    """Generate a new secure pairing token with 4-digit PIN fallback."""
    token = secrets.token_urlsafe(16)
    pin = f"{secrets.randbelow(9000) + 1000}"
    created_at = time.time()
    expires_at = created_at + 300  # 5 minutes
    connect_url = f"http://{LOCAL_IP}:{PORT}/connect?token={token}"

    token_data = {
        "token": token,
        "pin": pin,
        "created_at": created_at,
        "expires_at": expires_at,
        "connect_url": connect_url,
        "status": "active"
    }
    pair_tokens[token] = token_data
    pin_to_token[pin] = token
    return token_data


current_token_data = create_pairing_token()


def generate_qr_image_bytes(url: str, color_theme: str = "cyan") -> bytes:
    """Generate a high-res QR code image as PNG bytes."""
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)

    fill_color = "#00f2fe"
    if color_theme == "green":
        fill_color = "#00f5a0"
    elif color_theme == "violet":
        fill_color = "#b5179e"
    elif color_theme == "amber":
        fill_color = "#ffb703"

    img = qr.make_image(fill_color=fill_color, back_color="#0d0f17")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# Background Task: System Metrics Monitor
async def system_metrics_loop():
    net_io_last = psutil.net_io_counters()
    time_last = time.time()

    while True:
        try:
            await asyncio.sleep(1.5)
            cpu_pct = psutil.cpu_percent(interval=None)
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage('/')

            net_io_now = psutil.net_io_counters()
            time_now = time.time()
            dt = max(time_now - time_last, 0.1)

            bytes_sent_sec = (net_io_now.bytes_sent - net_io_last.bytes_sent) / dt
            bytes_recv_sec = (net_io_now.bytes_recv - net_io_last.bytes_recv) / dt

            net_io_last = net_io_now
            time_last = time_now

            stats = {
                "type": "system_stats",
                "data": {
                    "cpu_percent": round(cpu_pct, 1),
                    "ram_percent": round(mem.percent, 1),
                    "ram_used_gb": round(mem.used / (1024 ** 3), 2),
                    "ram_total_gb": round(mem.total / (1024 ** 3), 2),
                    "disk_percent": round(disk.percent, 1),
                    "disk_free_gb": round(disk.free / (1024 ** 3), 2),
                    "net_sent_kbps": round(bytes_sent_sec / 1024, 1),
                    "net_recv_kbps": round(bytes_recv_sec / 1024, 1),
                    "active_devices": len([m for m in manager.mobile_connections.values() if m.get("approved")]),
                    "timestamp": datetime.now().strftime("%H:%M:%S")
                }
            }

            await manager.broadcast_to_pc(stats)
            await manager.broadcast_to_approved_mobiles(stats)

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[Metrics Loop Error] {e}")
            await asyncio.sleep(2)


# FastAPI Lifespan Handler
@asynccontextmanager
async def lifespan(app: FastAPI):
    metrics_task = asyncio.create_task(system_metrics_loop())
    print("==========================================================")
    print(" [SERVER] QR CODE SPECIALIST CONNECTOR SERVER RUNNING v2.0")
    print(f" [PC] Local IP: {LOCAL_IP}")
    print(f" [PC] Dashboard: http://localhost:{PORT}")
    print(f" [MOBILE] Connect URL: {current_token_data['connect_url']}")
    print(f" [PIN] Pairing Code: {current_token_data['pin']}")
    print("==========================================================")
    yield
    metrics_task.cancel()


# Initialize FastAPI App
app = FastAPI(
    title="QR Code Specialist Connector",
    description="Scan-to-Connect Device Synchronization & Real-time PC Controller Hub",
    version="2.0.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Static Files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


# HTTP Routes
@app.get("/")
async def get_dashboard():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/connect")
async def get_mobile_connect(token: str = Query(None)):
    return FileResponse(os.path.join(STATIC_DIR, "mobile.html"))


@app.get("/api/info")
async def get_server_info():
    global current_token_data
    if time.time() > current_token_data["expires_at"]:
        current_token_data = create_pairing_token()

    return {
        "local_ip": LOCAL_IP,
        "port": PORT,
        "connect_url": current_token_data["connect_url"],
        "token": current_token_data["token"],
        "pin": current_token_data["pin"],
        "expires_in": max(0, int(current_token_data["expires_at"] - time.time())),
        "active_devices_count": len(manager.mobile_connections)
    }


@app.get("/api/token/refresh")
async def refresh_token():
    global current_token_data
    current_token_data = create_pairing_token()
    await manager.broadcast_to_pc({
        "type": "token_refreshed",
        "data": {
            "token": current_token_data["token"],
            "pin": current_token_data["pin"],
            "connect_url": current_token_data["connect_url"],
            "expires_in": 300
        }
    })
    return current_token_data


@app.get("/api/pin/resolve")
async def resolve_pin(pin: str = Query(...)):
    token = pin_to_token.get(pin.strip())
    if not token or token not in pair_tokens or time.time() > pair_tokens[token]["expires_at"]:
        raise HTTPException(status_code=404, detail="Invalid or expired 4-digit PIN.")
    return {"token": token, "connect_url": pair_tokens[token]["connect_url"]}


@app.get("/api/qr")
async def get_qr_code(token: Optional[str] = None, theme: str = "cyan"):
    global current_token_data
    target_token = token if token and token in pair_tokens else current_token_data["token"]
    url = pair_tokens.get(target_token, current_token_data)["connect_url"]
    qr_bytes = generate_qr_image_bytes(url, color_theme=theme)
    return Response(content=qr_bytes, media_type="image/png")


@app.get("/api/screenshot")
async def get_pc_screenshot():
    try:
        img = ImageGrab.grab()
        img.thumbnail((960, 540))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=70)
        return Response(content=buf.getvalue(), media_type="image/jpeg")
    except Exception as e:
        print(f"[Screenshot Error] {e}")
        raise HTTPException(status_code=500, detail="Failed capturing PC screen.")


@app.post("/api/upload")
async def upload_file(
    file: UploadFile = File(...),
    device_id: str = Form(...),
    device_name: str = Form("Mobile Device")
):
    if device_id not in manager.mobile_connections or not manager.mobile_connections[device_id].get("approved"):
        raise HTTPException(status_code=403, detail="Device not paired or authorized.")

    file_name = file.filename
    safe_name = f"{int(time.time())}_{file_name}"
    file_path = os.path.join(UPLOADS_DIR, safe_name)

    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    file_size_bytes = len(content)
    file_size_readable = f"{round(file_size_bytes / (1024 * 1024), 2)} MB" if file_size_bytes >= 1024 * 1024 else f"{round(file_size_bytes / 1024, 1)} KB"

    file_record = {
        "id": secrets.token_hex(6),
        "original_name": file_name,
        "saved_name": safe_name,
        "size_readable": file_size_readable,
        "size_bytes": file_size_bytes,
        "content_type": file.content_type or "application/octet-stream",
        "download_url": f"/uploads/{safe_name}",
        "uploaded_by": device_name,
        "device_id": device_id,
        "timestamp": datetime.now().strftime("%H:%M:%S")
    }

    uploaded_files_history.insert(0, file_record)

    await manager.broadcast_to_pc({
        "type": "file_received",
        "data": file_record
    })

    return {"status": "success", "file": file_record}


@app.get("/api/files")
async def list_files():
    return uploaded_files_history


@app.get("/api/clipboard")
async def get_clipboard():
    return clipboard_history


@app.post("/api/clipboard")
async def update_clipboard(payload: dict):
    text = payload.get("text", "").strip()
    source = payload.get("source", "Device")
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    entry = {
        "id": secrets.token_hex(4),
        "text": text,
        "source": source,
        "timestamp": datetime.now().strftime("%H:%M:%S")
    }
    clipboard_history.insert(0, entry)
    if len(clipboard_history) > 30:
        clipboard_history.pop()

    event = {"type": "clipboard_sync", "data": entry}
    await manager.broadcast_to_pc(event)
    await manager.broadcast_to_approved_mobiles(event)

    return {"status": "success", "entry": entry}


# WebSockets Endpoints
@app.websocket("/ws/pc")
async def websocket_pc_endpoint(websocket: WebSocket):
    await manager.connect_pc(websocket)

    devices_list = [
        {
            "device_id": dev_id,
            "info": dev_data["info"],
            "approved": dev_data["approved"],
            "connected_at": datetime.fromtimestamp(dev_data["connected_at"]).strftime("%H:%M:%S")
        }
        for dev_id, dev_data in manager.mobile_connections.items()
    ]
    await websocket.send_json({
        "type": "init_pc_state",
        "data": {
            "token_info": current_token_data,
            "active_devices": devices_list,
            "recent_files": uploaded_files_history[:10],
            "clipboard": clipboard_history[:10]
        }
    })

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            payload = data.get("data", {})

            if msg_type == "approve_device":
                dev_id = payload.get("device_id")
                if dev_id in manager.mobile_connections:
                    manager.mobile_connections[dev_id]["approved"] = True
                    print(f"[Security] Device Approved by PC: {dev_id}")

                    await manager.send_to_mobile(dev_id, {
                        "type": "pairing_status",
                        "status": "approved",
                        "message": "Connection approved by PC!"
                    })

                    await manager.broadcast_to_pc({
                        "type": "device_status_changed",
                        "data": {
                            "device_id": dev_id,
                            "approved": True,
                            "info": manager.mobile_connections[dev_id]["info"]
                        }
                    })

            elif msg_type == "reject_device":
                dev_id = payload.get("device_id")
                if dev_id in manager.mobile_connections:
                    print(f"[Security] Device Rejected by PC: {dev_id}")
                    await manager.send_to_mobile(dev_id, {
                        "type": "pairing_status",
                        "status": "rejected",
                        "message": "Connection request rejected by PC."
                    })
                    manager.disconnect_mobile(dev_id)

                    await manager.broadcast_to_pc({
                        "type": "device_disconnected",
                        "data": {"device_id": dev_id}
                    })

            elif msg_type == "disconnect_device":
                dev_id = payload.get("device_id")
                if dev_id in manager.mobile_connections:
                    await manager.send_to_mobile(dev_id, {
                        "type": "pairing_status",
                        "status": "disconnected",
                        "message": "Session terminated by PC."
                    })
                    manager.disconnect_mobile(dev_id)

                    await manager.broadcast_to_pc({
                        "type": "device_disconnected",
                        "data": {"device_id": dev_id}
                    })

            elif msg_type == "clipboard_sync":
                entry = {
                    "id": secrets.token_hex(4),
                    "text": payload.get("text", ""),
                    "source": "PC Dashboard",
                    "timestamp": datetime.now().strftime("%H:%M:%S")
                }
                clipboard_history.insert(0, entry)
                await manager.broadcast_to_approved_mobiles({"type": "clipboard_sync", "data": entry})

    except WebSocketDisconnect:
        manager.disconnect_pc(websocket)


@app.websocket("/ws/mobile")
async def websocket_mobile_endpoint(websocket: WebSocket):
    token = websocket.query_params.get("token")
    device_id = websocket.query_params.get("device_id", secrets.token_hex(8))
    device_name = websocket.query_params.get("device_name", "Mobile Phone")
    os_info = websocket.query_params.get("os", "Mobile Web")

    device_info = {
        "name": device_name,
        "os": os_info,
        "ip": websocket.client.host if websocket.client else "Unknown",
        "device_id": device_id
    }

    if not token or token not in pair_tokens:
        await websocket.accept()
        await websocket.send_json({
            "type": "pairing_status",
            "status": "invalid_token",
            "message": "Invalid or expired QR code pairing token."
        })
        await websocket.close()
        return

    await manager.connect_mobile(websocket, device_id, token, device_info)

    await websocket.send_json({
        "type": "pairing_status",
        "status": "pending",
        "message": "Pairing request sent. Please approve on your PC screen.",
        "device_id": device_id
    })

    await manager.broadcast_to_pc({
        "type": "pair_request",
        "data": {
            "device_id": device_id,
            "info": device_info,
            "connected_at": datetime.now().strftime("%H:%M:%S")
        }
    })

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            payload = data.get("data", {})

            dev_data = manager.mobile_connections.get(device_id)
            if not dev_data or not dev_data.get("approved"):
                await websocket.send_json({
                    "type": "error",
                    "message": "Device not authorized yet. Please accept pairing on PC."
                })
                continue

            if msg_type == "remote_command":
                cmd = payload.get("command")
                val = payload.get("value")

                print(f"[Remote Command Received] From {device_name}: {cmd} ({val})")

                if cmd == "media_play_pause":
                    send_win_key(VK_MEDIA_PLAY_PAUSE)
                elif cmd == "media_next":
                    send_win_key(VK_MEDIA_NEXT)
                elif cmd == "media_prev":
                    send_win_key(VK_MEDIA_PREV)
                elif cmd == "volume_up":
                    send_win_key(VK_VOLUME_UP)
                elif cmd == "volume_down":
                    send_win_key(VK_VOLUME_DOWN)
                elif cmd == "volume_mute" or cmd == "mute_all":
                    send_win_key(VK_VOLUME_MUTE)
                elif cmd == "slide_next":
                    send_win_key(VK_NEXT)
                elif cmd == "slide_prev":
                    send_win_key(VK_PRIOR)
                elif cmd == "slide_start":
                    send_win_key(VK_F5)
                elif cmd == "slide_exit":
                    send_win_key(VK_ESCAPE)
                elif cmd == "lock_pc":
                    try:
                        ctypes.windll.user32.LockWorkStation()
                    except Exception as e:
                        print(f"[Lock Workstation Error] {e}")
                elif cmd == "open_browser":
                    webbrowser.open("https://google.com")
                elif cmd == "launch_app":
                    app_name = str(val).lower()
                    if app_name == "calc": subprocess.Popen(["calc.exe"])
                    elif app_name == "notepad": subprocess.Popen(["notepad.exe"])
                    elif app_name == "taskmgr": subprocess.Popen(["taskmgr.exe"])
                    elif app_name == "explorer": subprocess.Popen(["explorer.exe"])

                execution_event = {
                    "type": "command_executed",
                    "data": {
                        "device_name": device_name,
                        "device_id": device_id,
                        "command": cmd,
                        "value": val,
                        "timestamp": datetime.now().strftime("%H:%M:%S")
                    }
                }
                await manager.broadcast_to_pc(execution_event)

                await websocket.send_json({
                    "type": "command_ack",
                    "command": cmd,
                    "status": "executed"
                })

            elif msg_type == "clipboard_sync":
                entry = {
                    "id": secrets.token_hex(4),
                    "text": payload.get("text", ""),
                    "source": f"📱 {device_name}",
                    "timestamp": datetime.now().strftime("%H:%M:%S")
                }
                clipboard_history.insert(0, entry)
                sync_event = {"type": "clipboard_sync", "data": entry}
                await manager.broadcast_to_pc(sync_event)
                await manager.broadcast_to_approved_mobiles(sync_event)

            elif msg_type == "touchpad_event":
                action = payload.get("action")
                if action == "move":
                    move_win_mouse(payload.get("dx", 0), payload.get("dy", 0))
                elif action in ["left_click", "right_click"]:
                    win_mouse_click(action)

                await manager.broadcast_to_pc({
                    "type": "touchpad_event",
                    "data": {
                        "device_name": device_name,
                        "action": action,
                        "dx": payload.get("dx", 0),
                        "dy": payload.get("dy", 0)
                    }
                })

    except WebSocketDisconnect:
        info = manager.disconnect_mobile(device_id)
        if info:
            await manager.broadcast_to_pc({
                "type": "device_disconnected",
                "data": {"device_id": device_id, "name": device_info["name"]}
            })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
