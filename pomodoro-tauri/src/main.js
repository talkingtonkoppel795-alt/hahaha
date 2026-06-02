// ──────────────────────────────────────────────
// Pomodoro Timer — Tauri Desktop App
// ──────────────────────────────────────────────

const CIRCUMFERENCE = 2 * Math.PI * 92; // ~578.05

// Tauri API - import dynamically
let tauriApi = null;
let tauriAvailable = false;

async function initTauri() {
  try {
    tauriApi = await import("@tauri-apps/api/core");
    tauriAvailable = true;
    console.log("Tauri API loaded");

    // Set up tray and global shortcuts via Tauri commands
    await setupTauriFeatures();
  } catch (e) {
    console.log("Running in browser mode (no Tauri API)");
    tauriAvailable = false;
  }
}

async function setupTauriFeatures() {
  // We'll invoke commands from the Rust backend
  // for system tray updates and global shortcut handling
  try {
    await tauriApi.invoke("init_app");
  } catch (e) {
    console.log("Tauri backend init:", e);
  }
}

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────

const state = {
  mode: "work",
  isRunning: false,
  timeLeft: 25 * 60,
  totalTime: 25 * 60,
  completedSessions: 0,
  task: "",
  timerId: null,
  lastTickTime: null,
  alwaysOnTop: false,
};

// Settings with defaults
const settings = {
  workDuration: 25,
  shortBreakDuration: 5,
  longBreakDuration: 15,
  longBreakInterval: 4,
  volume: 0.5,
  alwaysOnTop: false,
};

// ──────────────────────────────────────────────
// Settings persistence
// ──────────────────────────────────────────────

function loadSettings() {
  try {
    const saved = localStorage.getItem("pomodoro-settings");
    if (saved) Object.assign(settings, JSON.parse(saved));
  } catch (e) { /* ignore */ }
}

function saveSettings() {
  try {
    localStorage.setItem("pomodoro-settings", JSON.stringify(settings));
  } catch (e) { /* ignore */ }
}

// ──────────────────────────────────────────────
// Audio — Web Audio API
// ──────────────────────────────────────────────

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playBeep(frequency, duration, type = "sine", gainVal = 0.3) {
  try {
    const ctx = getAudioContext();
    const gain = settings.volume;
    if (gain === 0) return;

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    gainNode.gain.setValueAtTime(gainVal * gain, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* Audio not supported */ }
}

function playStartSound() {
  playBeep(880, 0.15, "sine", 0.2);
  setTimeout(() => playBeep(1100, 0.2, "sine", 0.25), 150);
}

function playCompleteSound() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((freq, i) => {
    setTimeout(() => playBeep(freq, 0.4, "triangle", 0.25), i * 200);
  });
}

// ──────────────────────────────────────────────
// Notifications
// ──────────────────────────────────────────────

async function showNotification(title, body) {
  // Try Tauri notification plugin first
  if (tauriAvailable) {
    try {
      const { sendNotification, isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
      let granted = await isPermissionGranted();
      if (!granted) {
        const result = await requestPermission();
        granted = result === "granted";
      }
      if (granted) {
        sendNotification({ title, body });
        return;
      }
    } catch (e) { /* fall through to web notification */ }
  }

  // Fallback to Web Notification API
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "🍅", silent: true });
  }
}

async function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

// ──────────────────────────────────────────────
// Toast
// ──────────────────────────────────────────────

let toastTimeout;
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 2000);
}

// ──────────────────────────────────────────────
// UI Helpers
// ──────────────────────────────────────────────

function getModeLabel(mode) {
  switch (mode) {
    case "work": return "专注";
    case "shortBreak": return "短休息";
    case "longBreak": return "长休息";
    default: return "";
  }
}

function getModeAccentColor(mode) {
  switch (mode) {
    case "work": return "#ef5350";
    case "shortBreak": return "#66bb6a";
    case "longBreak": return "#42a5f5";
    default: return "#ef5350";
  }
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getDefaultTime(mode) {
  switch (mode) {
    case "work": return settings.workDuration * 60;
    case "shortBreak": return settings.shortBreakDuration * 60;
    case "longBreak": return settings.longBreakDuration * 60;
    default: return 25 * 60;
  }
}

// ──────────────────────────────────────────────
// UI Updates
// ──────────────────────────────────────────────

function updateTimerDisplay() {
  document.getElementById("timeDisplay").textContent = formatTime(state.timeLeft);

  const progress = state.timeLeft / state.totalTime;
  const offset = CIRCUMFERENCE * (1 - progress);
  const ring = document.getElementById("ringProgress");
  ring.setAttribute("stroke-dashoffset", offset);

  const color = getModeAccentColor(state.mode);
  document.documentElement.style.setProperty("--accent", color);
  ring.style.stroke = color;

  document.getElementById("timeLabel").textContent = getModeLabel(state.mode);

  const modeEmoji = state.mode === "work" ? "🍅" : state.mode === "shortBreak" ? "☕" : "🌿";
  document.title = `${formatTime(state.timeLeft)} ${modeEmoji} 番茄钟`;

  // Update tray if Tauri is available
  if (tauriAvailable) {
    updateTray();
  }
}

function updateModeButtons() {
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.remove("active");
    if (btn.dataset.mode === state.mode) btn.classList.add("active");
  });
}

function updateSessionDots() {
  const container = document.getElementById("sessions");
  const total = settings.longBreakInterval;
  let html = "";
  for (let i = 0; i < total; i++) {
    let cls = "session-dot";
    if (i < state.completedSessions) cls += " done";
    else if (i === state.completedSessions && state.mode === "work") cls += " current";
    html += `<div class="${cls}"></div>`;
  }
  container.innerHTML = html;
}

function updatePlayButton() {
  const btn = document.getElementById("btnPlay");
  const icon = document.getElementById("btnPlayIcon");
  if (state.isRunning) {
    icon.textContent = "⏸";
    btn.classList.add("paused");
    btn.title = "暂停";
  } else {
    icon.textContent = "▶";
    btn.classList.remove("paused");
    btn.title = "开始";
  }
}

function updateStatus(message, className) {
  const status = document.getElementById("status");
  status.textContent = message || "";
  status.className = "status";
  if (className) status.classList.add(className);
}

function updateTaskDisplay() {
  const el = document.getElementById("currentTask");
  if (state.task) {
    el.textContent = `📝 ${state.task}`;
    el.classList.add("has-task");
  } else {
    el.textContent = "";
    el.classList.remove("has-task");
  }
}

function updateResetButton() {
  const btn = document.getElementById("btnReset");
  const defaultTime = getDefaultTime(state.mode);
  btn.disabled = state.timeLeft === defaultTime && !state.isRunning;
}

function refreshAllUI() {
  updateTimerDisplay();
  updateModeButtons();
  updateSessionDots();
  updatePlayButton();
  updateResetButton();
  updateTaskDisplay();
}

// ──────────────────────────────────────────────
// System Tray
// ──────────────────────────────────────────────

async function updateTray() {
  if (!tauriAvailable) return;
  try {
    const timeStr = formatTime(state.timeLeft);
    const label = getModeLabel(state.mode);
    const emoji = state.mode === "work" ? "🍅" : state.mode === "shortBreak" ? "☕" : "🌿";
    await tauriApi.invoke("update_tray", {
      title: `${emoji} ${timeStr} - ${label}`,
      tooltip: `番茄钟 - ${label}\n${state.task ? "📝 " + state.task : "无任务"}`,
      running: state.isRunning,
    });
  } catch (e) { /* ignore */ }
}

// ──────────────────────────────────────────────
// Timer Logic
// ──────────────────────────────────────────────

function startTimer() {
  if (state.timeLeft <= 0) {
    resetTimer(false);
  }

  state.isRunning = true;
  state.lastTickTime = Date.now();
  playStartSound();

  updatePlayButton();
  updateResetButton();
  updateStatus(
    state.mode === "work" ? "专注中……保持专注！" : "休息中……放松一下~",
    state.mode === "work" ? "working" : "breaking"
  );

  scheduleTick();
}

function pauseTimer() {
  state.isRunning = false;
  if (state.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }
  updatePlayButton();
  updateResetButton();
  updateStatus("已暂停");
  updateTray();
}

function resetTimer(announce = true) {
  state.isRunning = false;
  if (state.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }
  state.timeLeft = getDefaultTime(state.mode);
  state.totalTime = state.timeLeft;
  refreshAllUI();
  if (announce) updateStatus("已重置");
  updateTray();
}

function skipSession() {
  state.isRunning = false;
  if (state.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }
  transitionToNextMode();
  refreshAllUI();
  updateStatus("已跳过 → " + getModeLabel(state.mode));
  updateTray();
}

function transitionToNextMode() {
  if (state.mode === "work") {
    state.completedSessions++;
    if (state.completedSessions >= settings.longBreakInterval) {
      state.mode = "longBreak";
      state.completedSessions = 0;
    } else {
      state.mode = "shortBreak";
    }
  } else {
    state.mode = "work";
  }
  state.timeLeft = getDefaultTime(state.mode);
  state.totalTime = state.timeLeft;
}

function onTimerComplete() {
  state.isRunning = false;
  if (state.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }

  playCompleteSound();

  const completedMode = state.mode;
  const completedLabel = getModeLabel(completedMode);

  if (completedMode === "work") {
    showNotification("🍅 番茄完成！", `一个${completedLabel}时段结束，该休息啦~`);
    showToast("🎉 番茄完成！休息一下吧~");
  } else {
    showNotification("⏰ 休息结束！", `${completedLabel}结束，准备开始下一个番茄吧！`);
    showToast("⏰ 休息结束！继续加油~");
  }

  const ring = document.getElementById("ringProgress");
  ring.classList.add("completed");
  setTimeout(() => ring.classList.remove("completed"), 2400);

  transitionToNextMode();
  refreshAllUI();
  updateStatus(
    completedMode === "work"
      ? `✅ ${completedLabel}完成！开始${getModeLabel(state.mode)}`
      : `✅ ${completedLabel}结束！开始新的${getModeLabel(state.mode)}`,
    state.mode === "work" ? "working" : "breaking"
  );
  updateTray();
}

function scheduleTick() {
  if (!state.isRunning) return;

  state.timerId = setTimeout(() => {
    if (!state.isRunning) return;

    const now = Date.now();
    const elapsed = Math.round((now - state.lastTickTime) / 1000);
    state.lastTickTime = now;

    const decrement = Math.min(elapsed, state.timeLeft);
    state.timeLeft -= decrement;

    updateTimerDisplay();
    updateResetButton();

    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      updateTimerDisplay();
      onTimerComplete();
    } else {
      scheduleTick();
    }
  }, 500);
}

// ──────────────────────────────────────────────
// Mode Switching
// ──────────────────────────────────────────────

function switchMode(newMode) {
  if (state.mode === newMode && state.isRunning) return;

  state.isRunning = false;
  if (state.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }

  state.mode = newMode;
  state.timeLeft = getDefaultTime(newMode);
  state.totalTime = state.timeLeft;

  refreshAllUI();
  updateStatus(`已切换到${getModeLabel(newMode)}模式`);
  updateTray();
}

// ──────────────────────────────────────────────
// Settings UI
// ──────────────────────────────────────────────

function populateSettingsUI() {
  document.getElementById("workDuration").value = settings.workDuration;
  document.getElementById("shortBreakDuration").value = settings.shortBreakDuration;
  document.getElementById("longBreakDuration").value = settings.longBreakDuration;
  document.getElementById("longBreakInterval").value = settings.longBreakInterval;
  document.getElementById("volume").value = Math.round(settings.volume * 100);
  document.getElementById("volumeLabel").textContent = Math.round(settings.volume * 100) + "%";
  document.getElementById("alwaysOnTop").checked = settings.alwaysOnTop;
}

function applySettingsFromUI() {
  settings.workDuration = clamp(1, 120, parseInt(document.getElementById("workDuration").value) || 25);
  settings.shortBreakDuration = clamp(1, 30, parseInt(document.getElementById("shortBreakDuration").value) || 5);
  settings.longBreakDuration = clamp(1, 60, parseInt(document.getElementById("longBreakDuration").value) || 15);
  settings.longBreakInterval = clamp(1, 10, parseInt(document.getElementById("longBreakInterval").value) || 4);
  settings.volume = clamp(0, 100, parseInt(document.getElementById("volume").value) || 50) / 100;
  settings.alwaysOnTop = document.getElementById("alwaysOnTop").checked;

  saveSettings();

  // Apply always-on-top via Tauri
  if (tauriAvailable) {
    tauriApi.invoke("set_always_on_top", { alwaysOnTop: settings.alwaysOnTop }).catch(() => {});
  }

  if (!state.isRunning) {
    state.timeLeft = getDefaultTime(state.mode);
    state.totalTime = state.timeLeft;
  }

  refreshAllUI();
  updateStatus("设置已保存");
}

function clamp(min, max, val) {
  return Math.max(min, Math.min(max, val));
}

function toggleSettings() {
  const panel = document.getElementById("settingsPanel");
  const overlay = document.getElementById("settingsOverlay");
  const isOpen = panel.classList.contains("open");
  if (isOpen) {
    panel.classList.remove("open");
    overlay.classList.remove("open");
  } else {
    populateSettingsUI();
    panel.classList.add("open");
    overlay.classList.add("open");
  }
}

// ──────────────────────────────────────────────
// Task
// ──────────────────────────────────────────────

function setTask() {
  const input = document.getElementById("taskInput");
  const task = input.value.trim();
  if (task) {
    state.task = task;
    input.value = "";
    updateTaskDisplay();
    showToast("📝 任务已记录");
    updateTray();
  }
}

// ──────────────────────────────────────────────
// Event Listeners
// ──────────────────────────────────────────────

document.getElementById("btnPlay").addEventListener("click", () => {
  getAudioContext();
  if (state.isRunning) pauseTimer();
  else startTimer();
});

document.getElementById("btnReset").addEventListener("click", () => resetTimer(true));
document.getElementById("btnSkip").addEventListener("click", () => skipSession());

document.getElementById("modes").addEventListener("click", (e) => {
  const btn = e.target.closest(".mode-btn");
  if (!btn) return;
  const mode = btn.dataset.mode;
  if (mode) switchMode(mode);
});

document.getElementById("settingsToggle").addEventListener("click", toggleSettings);
document.getElementById("settingsClose").addEventListener("click", toggleSettings);
document.getElementById("settingsOverlay").addEventListener("click", toggleSettings);
document.getElementById("settingsApply").addEventListener("click", () => {
  applySettingsFromUI();
  toggleSettings();
});

document.getElementById("taskBtn").addEventListener("click", setTask);
document.getElementById("taskInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") setTask();
});

document.getElementById("volume").addEventListener("input", (e) => {
  document.getElementById("volumeLabel").textContent = e.target.value + "%";
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;

  switch (e.code) {
    case "Space":
      e.preventDefault();
      getAudioContext();
      if (state.isRunning) pauseTimer();
      else startTimer();
      break;
    case "KeyR":
      if (!e.ctrlKey && !e.metaKey) resetTimer(true);
      break;
    case "KeyS":
      if (!e.ctrlKey && !e.metaKey) skipSession();
      break;
    case "Digit1":
      switchMode("work");
      break;
    case "Digit2":
      switchMode("shortBreak");
      break;
    case "Digit3":
      switchMode("longBreak");
      break;
  }
});

// ──────────────────────────────────────────────
// Listen for Tauri events (global shortcuts from backend)
// ──────────────────────────────────────────────

function setupTauriListeners() {
  if (!tauriAvailable) return;

  const { listen } = tauriApi;
  // We don't have listen from core, use a different approach
  // The global shortcuts will be handled via Rust backend invoking JS
  // Expose functions on window for Rust to call
  window.__pomodoro = {
    start: () => { if (!state.isRunning) startTimer(); },
    pause: () => { if (state.isRunning) pauseTimer(); },
    toggle: () => { if (state.isRunning) pauseTimer(); else startTimer(); },
    reset: () => resetTimer(true),
    skip: () => skipSession(),
    switchWork: () => switchMode("work"),
    switchShortBreak: () => switchMode("shortBreak"),
    switchLongBreak: () => switchMode("longBreak"),
    getState: () => JSON.parse(JSON.stringify(state)),
  };
}

// ──────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────

async function init() {
  loadSettings();
  state.timeLeft = getDefaultTime("work");
  state.totalTime = state.timeLeft;
  refreshAllUI();
  updateStatus("按空格键或点击 ▶ 开始");
  requestNotificationPermission();
  await initTauri();
  setupTauriListeners();
  updateTray();
  console.log("🍅 番茄钟已就绪！");
}

init();
