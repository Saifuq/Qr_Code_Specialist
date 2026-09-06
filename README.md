# 📲 QR Code Specialist Connector

> A real-time, scan-to-connect device synchronization and remote control ecosystem for pairing mobile devices (phones/tablets) smoothly with your PC using dynamic QR codes, WebSockets, and secure token handshakes.

![Python Version](https://img.shields.io/badge/python-3.10%2B-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100%2B-009688.svg)
![WebSockets](https://img.shields.io/badge/WebSockets-Real--Time-ff69b4.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

---

## 🌟 Key Features

- **⚡ Scan-to-Connect QR Pairing**: Instant local network pairing via camera QR scan or 4-digit PIN code fallback.
- **🛡️ Security Gatekeeper**: PC Master Dashboard receives real-time **Accept** / **Reject** prompts for all incoming pairing requests.
- **📊 Real-Time PC Performance Monitor**: Live streaming of CPU %, RAM %, Disk space %, and Network IO speeds directly on phone and PC.
- **🖥️ Live PC Screen Snapshot**: View real-time JPEG screen capture previews of your PC on your smartphone (`/api/screenshot`).
- **🎛️ Native Windows Media & Volume Remote**: Controls master volume (Up, Down, Mute) and playback (Play/Pause, Next, Prev) using native WinAPI `ctypes`.
- **🚀 PC Quick App Launcher**: Open Windows apps (Calculator, Notepad, Task Manager, File Explorer) with 1 tap from your phone.
- **🔒 One-Tap Workstation Lock**: Instantly lock your Windows PC screen remotely.
- **🎮 Touchpad & Slide Presentation Remote**: Trackpad gesture surface for moving the mouse cursor + PageUp/PageDown presentation slide controls (`F5`, `ESC`).
- **📁 Drag-and-Drop File Receiver**: Upload photos, documents, audio, and archives from phone to PC with real-time transfer progress bars.
- **📋 Bidirectional Shared Clipboard**: Instant 2-way text clipboard synchronization between mobile devices and PC.

---

## 📐 System Architecture

```
                      ┌──────────────────────────────────────────────┐
                      │          PC Master Dashboard (FastAPI)       │
                      │  - Serves static UI & REST/WS Gateway        │
                      │  - Dynamic QR Generator + 4-Digit PIN        │
                      │  - Security Gatekeeper Modal (Accept/Reject) │
                      │  - Live Hardware Gauges & WebSocket Console  │
                      └──────────────────────┬───────────────────────┘
                                             │
                                       Wi-Fi / LAN
                                             │
                                   ┌─────────▼─────────┐
                                   │ SCAN QR / PIN 7186│
                                   └─────────┬─────────┘
                                             │
                      ┌──────────────────────▼───────────────────────┐
                      │            Mobile Web Controller             │
                      │  ⚡ Remote Media & System Action Deck       │
                      │  🚀 PC Quick App Launcher (Calc, Notepad)    │
                      │  📁 File Transfer with Progress Bar          │
                      │  📋 Bidirectional Clipboard Sync             │
                      │  🖥️ Live PC Screen Snapshot Stream           │
                      │  🎮 Touchpad & Slide Presentation Remote    │
                      └──────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Prerequisites

Ensure you have Python 3.10+ installed on your system.

### 2. Installation

Clone the repository and install required dependencies:

```bash
git clone https://github.com/Saifuq/streamlit-quantum-app.git
cd streamlit-quantum-app
pip install -r requirements.txt
```

### 3. Running the Server

Start the backend application server:

```bash
python main.py
```

You should see an output similar to:

```text
==========================================================
 [SERVER] QR CODE SPECIALIST CONNECTOR SERVER RUNNING v2.0
 [PC] Local IP: 192.168.1.15
 [PC] Dashboard: http://localhost:8000
 [MOBILE] Connect URL: http://192.168.1.15:8000/connect?token=...
 [PIN] Pairing Code: 7186
==========================================================
```

### 4. Connect Your Devices

1. **PC Dashboard**: Open `http://localhost:8000` in your PC browser.
2. **Mobile Device**: Make sure your phone is connected to the same Wi-Fi network:
   - **Option A**: Scan the QR code displayed on the PC screen.
   - **Option B**: Open `http://<YOUR_PC_IP>:8000/connect` and enter the 4-digit PIN code.
3. **Approve Pairing**: Click **Accept Connection** on the PC popup modal to pair.

---

## 📂 Project Structure

```text
qr-connect/
├── main.py                # FastAPI server, WebSockets, WinAPI integration, metrics loop
├── requirements.txt       # Dependencies (fastapi, uvicorn, qrcode, pillow, psutil, python-multipart)
├── .gitignore             # Git ignore configuration
├── README.md              # Project documentation
├── uploads/               # Storage directory for files transferred from mobile
└── static/
    ├── index.html         # PC Master Dashboard interface
    ├── mobile.html        # Responsive Mobile Web Controller app
    ├── css/
    │   ├── style.css      # Dark glassmorphism styling for PC Dashboard
    │   └── mobile.css     # Touch-first styling for Mobile Controller
    └── js/
        ├── app.js         # PC Dashboard client JavaScript & WebSocket client
        └── mobile.js      # Mobile Controller JavaScript & Touchpad gestures
```

---

## 🔌 API & WebSocket Reference

### HTTP Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Serves PC Master Dashboard (`index.html`) |
| `GET` | `/connect` | Serves Mobile Web Controller (`mobile.html`) |
| `GET` | `/api/info` | Returns server IP, port, active token, 4-digit PIN, and active devices count |
| `GET` | `/api/token/refresh` | Generates a new pairing token and updates QR code |
| `GET` | `/api/pin/resolve?pin=...` | Resolves a 4-digit PIN to a valid pairing token |
| `GET` | `/api/qr` | Serves dynamic PNG QR code image (`?theme=cyan\|green\|violet\|amber`) |
| `GET` | `/api/screenshot` | Returns real-time JPEG screen capture of the PC |
| `POST` | `/api/upload` | Multipart endpoint for file uploads from mobile |
| `GET` | `/api/clipboard` | Retrieves clipboard sync history |
| `POST` | `/api/clipboard` | Adds a new entry to the shared clipboard |

### WebSocket Endpoints

- `ws://<HOST>:8000/ws/pc`: WebSocket link for PC Master Dashboard.
- `ws://<HOST>:8000/ws/mobile?token=...`: WebSocket link for Mobile Clients.

---

## 📜 License

This project is open-source under the [MIT License](LICENSE).
