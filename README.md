# 🚀 QUICK GITHUB UPLOAD & USER GUIDE

================================================================================
PART 1: COMMANDS TO PUSH THIS PROJECT TO GITHUB
================================================================================

Open PowerShell or Terminal in C:\Users\SAIFUDDIN\Desktop\Pro and run:

# 1. Create a repository at https://github.com/new (do NOT check "Add a README file")
# 2. Run these commands (replace YOUR_GITHUB_USERNAME with your GitHub username):

git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/qr-code-specialist-connector.git
git push -u origin main


================================================================================
PART 2: COMPLETE STEP-BY-STEP USER GUIDE (HOW TO RUN & USE)
================================================================================

--- STEP 1: INSTALL DEPENDENCIES ---
Open terminal in project folder and run:
pip install -r requirements.txt

--- STEP 2: START SERVER ---
Run:
python main.py

Terminal output will show:
 [SERVER] QR CODE SPECIALIST CONNECTOR RUNNING
 [PC] Dashboard: http://localhost:8000
 [MOBILE] Connect URL: http://192.168.1.15:8000/connect?token=...
 [PIN] Pairing Code: 7186

--- STEP 3: OPEN PC DASHBOARD ---
Open PC web browser and go to:
http://localhost:8000

--- STEP 4: PAIR MOBILE PHONE ---
Choose any of these 3 pairing methods:

Method A (Scan QR Code):
- Open phone camera on the same Wi-Fi network and scan the QR code on PC screen.

Method B (Enter 4-Digit PIN):
- Open phone browser and go to: http://<YOUR_PC_IP>:8000/connect
- Enter the 4-digit PIN shown under the QR code (e.g. 7186) and tap "Pair with PIN".

Method C (Global Internet Mode / 4G Data):
- Click "Enable Global Mode" on the PC Dashboard top navbar.
- Scan the updated QR code to connect from anywhere in the world over 4G/5G!

--- STEP 5: ACCEPT CONNECTION & ENJOY ---
- A pop-up prompt will appear on your PC screen: "Device iPhone requests connection".
- Click "Accept Connection".
- You can now use Remote Media & Volume Controls, App Launcher, Soundboard Chimes, File Transfers, 2-Way Clipboard Sync, Live PC Screen Preview, and Touchpad Remote!
