// Mobile Web Controller Script
let socket = null;
let deviceId = localStorage.getItem("qr_device_id");
if (!deviceId) {
    deviceId = "dev_" + Math.random().toString(36).substr(2, 9);
    localStorage.setItem("qr_device_id", deviceId);
}

// Get device name & OS
function getDeviceName() {
    const ua = navigator.userAgent;
    if (/iPhone/i.test(ua)) return "iPhone";
    if (/iPad/i.test(ua)) return "iPad";
    if (/Android/i.test(ua)) return "Android Phone";
    if (/Windows/i.test(ua)) return "Windows Device";
    if (/Macintosh/i.test(ua)) return "Mac Device";
    return "Mobile Device";
}

const deviceName = getDeviceName();
const osInfo = navigator.platform || "Mobile Web";

// URL Token Extraction
const urlParams = new URLSearchParams(window.location.search);
let token = urlParams.get("token");

document.addEventListener("DOMContentLoaded", () => {
    if (!token) {
        showPinForm("Enter 4-Digit Pairing PIN displayed on PC screen:");
        return;
    }
    connectMobileWebSocket();
    setupTouchpad();
});

async function submitPinCode() {
    const pin = document.getElementById("pin-input").value.trim();
    if (!pin || pin.length !== 4) {
        alert("Please enter a valid 4-digit PIN code.");
        return;
    }
    try {
        const res = await fetch(`/api/pin/resolve?pin=${pin}`);
        if (!res.ok) {
            alert("Invalid or expired PIN code. Check PC screen.");
            return;
        }
        const data = await res.json();
        token = data.token;
        document.getElementById("pin-entry-box").style.display = "none";
        document.getElementById("pending-spinner").style.display = "block";
        connectMobileWebSocket();
        setupTouchpad();
    } catch (e) {
        alert("Error connecting with PIN code.");
    }
}

function showPinForm(msgText) {
    document.getElementById("pending-spinner").style.display = "none";
    document.getElementById("pending-title").innerText = "Enter PIN Code";
    document.getElementById("pending-msg").innerText = msgText;
    document.getElementById("pin-entry-box").style.display = "block";
    document.getElementById("pending-screen").style.display = "flex";
    document.getElementById("main-app-container").style.display = "none";
}

function refreshPCScreenShot() {
    const img = document.getElementById("pc-screen-img");
    if (img) {
        img.src = `/api/screenshot?t=${Date.now()}`;
        triggerVibration();
    }
}

// WebSocket Connection
function connectMobileWebSocket() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${location.host}/ws/mobile?token=${encodeURIComponent(token)}&device_id=${encodeURIComponent(deviceId)}&device_name=${encodeURIComponent(deviceName)}&os=${encodeURIComponent(osInfo)}`;

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log("Connected to mobile WebSocket gateway.");
    };

    socket.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleMobileWSMessage(msg);
        } catch(e) {
            console.error("WS Parse Error:", e);
        }
    };

    socket.onclose = () => {
        updateBadge("Disconnected", "status-rejected");
        showStatusError("Connection to PC lost. Reconnecting...");
        setTimeout(connectMobileWebSocket, 3000);
    };
}

// Handle Incoming WS Messages
function handleMobileWSMessage(msg) {
    const type = msg.type;

    if (type === "pairing_status") {
        const status = msg.status;
        if (status === "pending") {
            updateBadge("Pending PC Approval", "status-pending");
            document.getElementById("pending-screen").style.display = "flex";
            document.getElementById("main-app-container").style.display = "none";
        } else if (status === "approved") {
            updateBadge("🟢 Connected & Paired", "status-approved");
            document.getElementById("pending-screen").style.display = "none";
            document.getElementById("main-app-container").style.display = "block";
            triggerVibration();
        } else if (status === "rejected") {
            updateBadge("Pairing Rejected", "status-rejected");
            showStatusError("Connection request was rejected by PC user.");
        } else if (status === "invalid_token") {
            updateBadge("Token Expired", "status-rejected");
            showStatusError("QR Code token is invalid or expired. Scan a fresh QR code from your PC.");
        }
    } else if (type === "system_stats") {
        updateMobileStats(msg.data);
    } else if (type === "clipboard_sync") {
        addMobileClipboardItem(msg.data);
    }
}

function updateBadge(text, className) {
    const badge = document.getElementById("connection-badge");
    badge.className = `connection-banner ${className}`;
    badge.innerHTML = text;
}

function showStatusError(text) {
    document.getElementById("pending-spinner").style.display = "none";
    document.getElementById("pending-title").innerText = "Connection Alert";
    document.getElementById("pending-msg").innerText = text;
    document.getElementById("pending-screen").style.display = "flex";
    document.getElementById("main-app-container").style.display = "none";
}

// Send Remote Commands
function sendRemoteCommand(cmd, value = null) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
        type: "remote_command",
        data: { command: cmd, value: value }
    }));
    triggerVibration();
}

function sendVolumeChange(val) {
    sendRemoteCommand("set_volume", val);
}

// Tab Switching
function switchTab(tabId, el) {
    document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));

    document.getElementById(`tab-${tabId}`).classList.add("active");
    el.classList.add("active");
    triggerVibration();
}

// File Upload Handler with XHR Progress
function handleFileSelection(e) {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("device_id", deviceId);
    formData.append("device_name", deviceName);

    const progressBox = document.getElementById("file-progress-container");
    const progressFill = document.getElementById("upload-progress-fill");
    const progressPct = document.getElementById("upload-pct");
    const progressName = document.getElementById("upload-filename");

    progressName.innerText = file.name;
    progressFill.style.width = "0%";
    progressPct.innerText = "0%";
    progressBox.style.display = "block";

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload", true);

    xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
            const pct = Math.round((evt.loaded / evt.total) * 100);
            progressFill.style.width = `${pct}%`;
            progressPct.innerText = `${pct}%`;
        }
    };

    xhr.onload = () => {
        if (xhr.status === 200) {
            const res = JSON.parse(xhr.responseText);
            progressPct.innerText = "Upload Complete! ✅";
            progressFill.style.background = "var(--accent-emerald)";
            
            // Add to mobile file history log
            addMobileFileHistory(res.file);
            triggerVibration();
            setTimeout(() => {
                progressBox.style.display = "none";
            }, 3000);
        } else {
            alert("Upload failed. Make sure device is paired.");
        }
    };

    xhr.onerror = () => {
        alert("Network error during file upload.");
    };

    xhr.send(formData);
}

function addMobileFileHistory(file) {
    const log = document.getElementById("mobile-file-history");
    if (log.innerHTML.includes("Uploaded files will appear")) log.innerHTML = "";
    
    const div = document.createElement("div");
    div.style.padding = "8px 0";
    div.style.borderBottom = "1px solid var(--border-color)";
    div.innerHTML = `<strong>${escapeHtml(file.original_name)}</strong> (${file.size_readable}) <br><span style="font-size: 11px; color: var(--text-sub);">Uploaded at ${file.timestamp}</span>`;
    log.prepend(div);
}

// Clipboard Handler
function sendMobileClipboard() {
    const input = document.getElementById("mobile-clipboard-input");
    const text = input.value.trim();
    if (!text) return;

    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({
        type: "clipboard_sync",
        data: { text: text }
    }));

    input.value = "";
    triggerVibration();
}

function addMobileClipboardItem(item) {
    const feed = document.getElementById("mobile-clipboard-feed");
    if (feed.innerHTML.includes("No shared items")) feed.innerHTML = "";

    const div = document.createElement("div");
    div.style.background = "rgba(255,255,255,0.04)";
    div.style.borderRadius = "10px";
    div.style.padding = "10px";
    div.style.marginBottom = "8px";
    div.innerHTML = `
        <div style="font-family: monospace; word-break: break-all;">${escapeHtml(item.text)}</div>
        <div style="font-size: 11px; color: var(--text-sub); margin-top: 4px;">Source: ${escapeHtml(item.source)} • ${item.timestamp}</div>
    `;
    feed.prepend(div);
}

// Mobile Hardware Stats View
function updateMobileStats(stats) {
    document.getElementById("m-cpu-val").innerText = `${stats.cpu_percent}%`;
    document.getElementById("m-cpu-bar").style.width = `${stats.cpu_percent}%`;

    document.getElementById("m-ram-val").innerText = `${stats.ram_percent}%`;
    document.getElementById("m-ram-bar").style.width = `${stats.ram_percent}%`;

    document.getElementById("m-disk-val").innerText = `${stats.disk_percent}%`;
    document.getElementById("m-disk-bar").style.width = `${stats.disk_percent}%`;
}

// Touchpad Events
let lastX = 0, lastY = 0;
let isTouching = false;

function setupTouchpad() {
    const surface = document.getElementById("touchpad-area");
    if (!surface) return;

    surface.addEventListener("touchstart", (e) => {
        const touch = e.touches[0];
        lastX = touch.clientX;
        lastY = touch.clientY;
        isTouching = true;
    }, { passive: true });

    surface.addEventListener("touchmove", (e) => {
        if (!isTouching) return;
        const touch = e.touches[0];
        const dx = touch.clientX - lastX;
        const dy = touch.clientY - lastY;
        lastX = touch.clientX;
        lastY = touch.clientY;

        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: "touchpad_event",
                data: { action: "move", dx: dx, dy: dy }
            }));
        }
    }, { passive: true });

    surface.addEventListener("touchend", () => {
        isTouching = false;
    });

    surface.addEventListener("click", () => {
        sendTouchpadAction("left_click");
    });
}

function sendTouchpadAction(action) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
        type: "touchpad_event",
        data: { action: action }
    }));
    triggerVibration();
}

// Haptic feedback
function triggerVibration() {
    if (navigator.vibrate) {
        navigator.vibrate(30);
    }
}

function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
