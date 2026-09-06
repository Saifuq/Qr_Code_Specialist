// PC Master Dashboard Client Application
let socket = null;
let currentToken = null;
let currentConnectURL = null;
let tokenTimerInterval = null;
let pendingPairRequest = null;

// Initialize Dashboard
document.addEventListener("DOMContentLoaded", () => {
    fetchServerInfo();
    connectWebSocket();
});

let currentTheme = "cyan";
let currentMode = "local";

// Fetch Server Info & IP
async function fetchServerInfo() {
    try {
        const res = await fetch("/api/info");
        const data = await res.json();

        document.getElementById("pc-ip-display").innerText = data.local_ip;
        document.getElementById("pc-port-display").innerText = data.port;
        document.getElementById("pin-display").innerText = data.pin || "----";
        
        currentMode = data.network_mode || "local";
        updateNetworkModeUI(currentMode, data.base_url);

        currentToken = data.token;
        currentConnectURL = data.connect_url;

        startTokenCountdown(data.expires_in);
        logConsole(`Server running in ${currentMode.toUpperCase()} mode at ${data.base_url}`, "cmd");
    } catch (err) {
        console.error("Failed fetching server info:", err);
        logConsole("Failed to retrieve server local network IP.", "warn");
    }
}

function updateNetworkModeUI(mode, baseUrl) {
    const pill = document.getElementById("network-mode-pill");
    const btn = document.getElementById("mode-toggle-btn");
    
    if (mode === "global") {
        pill.innerText = "GLOBAL INTERNET 🌐";
        pill.style.color = "var(--accent-emerald)";
        btn.innerHTML = `<i class="fa-solid fa-house"></i> Switch to Local Wi-Fi`;
    } else {
        pill.innerText = "LOCAL WI-FI 🏠";
        pill.style.color = "var(--accent-cyan)";
        btn.innerHTML = `<i class="fa-solid fa-earth-americas"></i> Enable Global Mode`;
    }
}

async function toggleNetworkModePrompt() {
    const targetMode = currentMode === "local" ? "global" : "local";
    let customUrl = "";

    if (targetMode === "global") {
        customUrl = prompt("Enter your Public Tunnel / Domain URL (or leave blank to use pyngrok tunnel):\ne.g. https://xxxx.ngrok-free.app or https://xxxx.trycloudflare.com", "") || "";
    }

    try {
        const res = await fetch("/api/mode/toggle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: targetMode, public_url: customUrl })
        });
        
        if (!res.ok) {
            const errData = await res.json();
            alert(`Mode switch error: ${errData.detail || "Failed switching mode"}`);
            return;
        }

        const data = await res.json();
        currentMode = data.network_mode;
        currentConnectURL = data.connect_url;
        updateNetworkModeUI(currentMode, data.base_url);
        document.getElementById("qr-image").src = `/api/qr?token=${data.connect_url}&t=${Date.now()}`;
        
        logConsole(`Switched network mode to ${currentMode.toUpperCase()} (${data.base_url})`, "pair");
        alert(`Switched to ${currentMode.toUpperCase()} Mode!\nConnect URL: ${data.connect_url}`);
    } catch (e) {
        alert("Error toggling network mode.");
    }
}

function changeQRTheme(theme) {
    currentTheme = theme;
    document.getElementById("qr-image").src = `/api/qr?token=${currentToken}&theme=${theme}&t=${Date.now()}`;
}

// Token Countdown & Refresh
function startTokenCountdown(seconds) {
    clearInterval(tokenTimerInterval);
    let remaining = seconds;
    const total = 300;

    const timerText = document.getElementById("token-countdown");
    const timerBar = document.getElementById("token-timer-bar");

    function update() {
        if (remaining <= 0) {
            clearInterval(tokenTimerInterval);
            timerText.innerText = "EXPIRED";
            timerBar.style.width = "0%";
            logConsole("Pairing token expired. Refreshing QR Code...", "warn");
            refreshQRCode();
            return;
        }

        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        timerText.innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        
        const pct = (remaining / total) * 100;
        timerBar.style.width = `${pct}%`;
        remaining--;
    }

    update();
    tokenTimerInterval = setInterval(update, 1000);
}

// Refresh QR Code
async function refreshQRCode() {
    try {
        const res = await fetch("/api/token/refresh");
        const data = await res.json();
        
        currentToken = data.token;
        currentConnectURL = data.connect_url;
        document.getElementById("qr-image").src = `/api/qr?token=${data.token}&t=${Date.now()}`;
        startTokenCountdown(data.expires_in || 300);
        logConsole("New QR Code generated with fresh security token.", "cmd");
    } catch (err) {
        console.error("Error refreshing QR:", err);
    }
}

// Copy Direct Connection Link
function copyConnectURL() {
    if (!currentConnectURL) return;
    navigator.clipboard.writeText(currentConnectURL).then(() => {
        alert(`Copied Connect URL to clipboard!\n${currentConnectURL}`);
    }).catch(() => {
        prompt("Copy Connection Link:", currentConnectURL);
    });
}

// Connect WebSocket
function connectWebSocket() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${location.host}/ws/pc`;

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        document.getElementById("ws-status-badge").classList.remove("status-pending");
        document.getElementById("ws-status-badge").classList.add("status-approved");
        document.getElementById("ws-status-text").innerText = "WebSockets Connected";
        logConsole("WebSocket link established with backend.", "cmd");
    };

    socket.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleWebSocketMessage(msg);
        } catch (e) {
            console.error("JSON parse error:", e);
        }
    };

    socket.onclose = () => {
        document.getElementById("ws-status-badge").classList.add("status-rejected");
        document.getElementById("ws-status-text").innerText = "Disconnected";
        logConsole("WebSocket connection lost. Reconnecting in 3s...", "warn");
        setTimeout(connectWebSocket, 3000);
    };
}

// Handle Incoming WS Messages
function handleWebSocketMessage(msg) {
    const type = msg.type;
    const data = msg.data;

    switch (type) {
        case "init_pc_state":
            renderActiveDevices(data.active_devices || []);
            renderFilesList(data.recent_files || []);
            renderClipboardList(data.clipboard || []);
            break;

        case "system_stats":
            updateSystemMetrics(data);
            break;

        case "pair_request":
            showPairingModal(data);
            logConsole(`Pairing request received from ${data.info.name} (${data.info.ip})`, "pair");
            break;

        case "device_status_changed":
            logConsole(`Device ${data.info.name} paired successfully.`, "pair");
            refreshDevicesList();
            break;

        case "device_disconnected":
            logConsole(`Device disconnected: ${data.device_id}`, "warn");
            refreshDevicesList();
            break;

        case "file_received":
            logConsole(`File received: ${data.original_name} (${data.size_readable}) from ${data.uploaded_by}`, "file");
            addFileItem(data);
            playNotificationSound();
            break;

        case "clipboard_sync":
            logConsole(`Clipboard text synced from ${data.source}`, "cmd");
            addClipboardItem(data);
            break;

        case "command_executed":
            logConsole(`⚡ Command [${data.command}] executed by ${data.device_name}`, "cmd");
            playBeepSound();
            break;
            
        case "touchpad_event":
            logConsole(`🎮 Touchpad action [${data.action}] from ${data.device_name}`, "cmd");
            break;
    }
}

// Security Pairing Modal
function showPairingModal(reqData) {
    pendingPairRequest = reqData;
    document.getElementById("modal-dev-name").innerText = reqData.info.name || "Mobile Device";
    document.getElementById("modal-dev-os").innerText = `OS / Browser: ${reqData.info.os}`;
    document.getElementById("modal-dev-ip").innerText = `IP Address: ${reqData.info.ip}`;
    
    document.getElementById("pairing-modal-overlay").classList.add("active");
    playNotificationSound();
}

function acceptPairingRequest() {
    if (!pendingPairRequest) return;
    socket.send(JSON.stringify({
        type: "approve_device",
        data: { device_id: pendingPairRequest.device_id }
    }));
    document.getElementById("pairing-modal-overlay").classList.remove("active");
    logConsole(`Approved connection for ${pendingPairRequest.info.name}`, "pair");
    pendingPairRequest = null;
}

function rejectPairingRequest() {
    if (!pendingPairRequest) return;
    socket.send(JSON.stringify({
        type: "reject_device",
        data: { device_id: pendingPairRequest.device_id }
    }));
    document.getElementById("pairing-modal-overlay").classList.remove("active");
    logConsole(`Rejected connection request for ${pendingPairRequest.info.name}`, "warn");
    pendingPairRequest = null;
}

// Update System Metrics Gauges
function updateSystemMetrics(stats) {
    document.getElementById("cpu-val").innerText = `${stats.cpu_percent}%`;
    document.getElementById("cpu-bar").style.width = `${stats.cpu_percent}%`;

    document.getElementById("ram-val").innerText = `${stats.ram_percent}%`;
    document.getElementById("ram-bar").style.width = `${stats.ram_percent}%`;

    document.getElementById("disk-val").innerText = `${stats.disk_percent}%`;
    document.getElementById("disk-bar").style.width = `${stats.disk_percent}%`;

    document.getElementById("net-val").innerText = `▲ ${stats.net_sent_kbps} KB/s  ▼ ${stats.net_recv_kbps} KB/s`;
    document.getElementById("metrics-updated-at").innerText = `Updated at ${stats.timestamp}`;
}

// Render Active Devices
function renderActiveDevices(devices) {
    const container = document.getElementById("active-devices-container");
    document.getElementById("devices-count-pill").innerText = `${devices.length} Active`;

    if (!devices || devices.length === 0) {
        container.innerHTML = `<p style="text-align: center; color: var(--text-secondary); padding: 20px; font-size: 13px;">No devices connected. Scan QR code to pair.</p>`;
        return;
    }

    container.innerHTML = devices.map(d => `
        <div class="device-card">
            <div class="device-info-box">
                <div class="device-avatar">
                    <i class="fa-solid fa-mobile-screen-button"></i>
                </div>
                <div>
                    <div class="device-name">${escapeHtml(d.info.name)}</div>
                    <div class="device-sub">${escapeHtml(d.info.ip)} • ${escapeHtml(d.info.os)}</div>
                </div>
            </div>
            <button class="btn btn-danger" style="padding: 6px 12px; font-size: 12px;" onclick="disconnectDevice('${d.device_id}')">
                Disconnect
            </button>
        </div>
    `).join("");
}

function disconnectDevice(devId) {
    if (confirm("Disconnect this mobile device?")) {
        socket.send(JSON.stringify({
            type: "disconnect_device",
            data: { device_id: devId }
        }));
    }
}

async function refreshDevicesList() {
    try {
        const res = await fetch("/api/info");
        const data = await res.json();
        // Trigger list refresh
    } catch(e){}
}

// Files Receiver List
function renderFilesList(files) {
    const container = document.getElementById("files-list-container");
    document.getElementById("files-count").innerText = `${files.length} files`;

    if (!files || files.length === 0) {
        container.innerHTML = `<p style="text-align: center; color: var(--text-secondary); padding: 20px; font-size: 13px;">No files received yet. Upload files from paired phone.</p>`;
        return;
    }

    container.innerHTML = files.map(f => getFileHTML(f)).join("");
}

function addFileItem(fileRecord) {
    const container = document.getElementById("files-list-container");
    // If empty text placeholder present, clear it
    if (container.querySelector("p")) container.innerHTML = "";
    
    const div = document.createElement("div");
    div.innerHTML = getFileHTML(fileRecord);
    container.prepend(div.firstElementChild);
}

function getFileHTML(f) {
    let iconClass = "fa-file";
    if (f.content_type.includes("image")) iconClass = "fa-file-image";
    else if (f.content_type.includes("pdf")) iconClass = "fa-file-pdf";
    else if (f.content_type.includes("audio")) iconClass = "fa-file-audio";
    else if (f.content_type.includes("zip") || f.content_type.includes("rar")) iconClass = "fa-file-zipper";

    return `
        <div class="file-item">
            <div class="file-info">
                <div class="file-icon"><i class="fa-solid ${iconClass}"></i></div>
                <div class="file-details">
                    <h4>${escapeHtml(f.original_name)}</h4>
                    <p>${f.size_readable} • Uploaded by ${escapeHtml(f.uploaded_by)} at ${f.timestamp}</p>
                </div>
            </div>
            <a href="${f.download_url}" target="_blank" download class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;">
                <i class="fa-solid fa-download"></i> Download
            </a>
        </div>
    `;
}

// Clipboard Feed
function renderClipboardList(items) {
    const container = document.getElementById("clipboard-list-container");
    if (!items || items.length === 0) {
        container.innerHTML = `<p style="text-align: center; color: var(--text-secondary); padding: 16px; font-size: 13px;">Clipboard history empty. Text copied on phone will sync here automatically.</p>`;
        return;
    }
    container.innerHTML = items.map(i => getClipboardHTML(i)).join("");
}

function addClipboardItem(item) {
    const container = document.getElementById("clipboard-list-container");
    if (container.querySelector("p")) container.innerHTML = "";
    const div = document.createElement("div");
    div.innerHTML = getClipboardHTML(item);
    container.prepend(div.firstElementChild);
}

function getClipboardHTML(i) {
    return `
        <div class="clipboard-item">
            <div>
                <div class="clipboard-text">${escapeHtml(i.text)}</div>
                <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">Source: ${escapeHtml(i.source)} • ${i.timestamp}</div>
            </div>
            <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="copyToClipboard('${escapeHtml(i.text)}')">
                <i class="fa-solid fa-copy"></i>
            </button>
        </div>
    `;
}

function sendPCClipboard() {
    const text = prompt("Enter text to broadcast to paired mobile devices:");
    if (text && text.trim()) {
        socket.send(JSON.stringify({
            type: "clipboard_sync",
            data: { text: text.trim() }
        }));
    }
}

function copyToClipboard(str) {
    navigator.clipboard.writeText(str).then(() => {
        logConsole(`Copied to PC Clipboard: "${str.substring(0, 20)}..."`, "cmd");
    });
}

// Log to Visual Console
function logConsole(msg, type = "cmd") {
    const stream = document.getElementById("console-stream");
    const time = new Date().toLocaleTimeString();
    
    let typeClass = `console-type-${type}`;
    const line = document.createElement("div");
    line.className = "console-line";
    line.innerHTML = `<span class="console-time">[${time}]</span> <span class="${typeClass}">${escapeHtml(msg)}</span>`;
    
    stream.appendChild(line);
    stream.scrollTop = stream.scrollHeight;
}

function clearConsole() {
    document.getElementById("console-stream").innerHTML = "";
}

// Audio Feedback Helpers
function playNotificationSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
    } catch(e){}
}

function playBeepSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
    } catch(e){}
}

function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
