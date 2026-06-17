const camera = document.querySelector("#camera");
const overlay = document.querySelector("#overlay");
const frame = document.querySelector(".camera-frame");
const emptyState = document.querySelector("#emptyState");
const toast = document.querySelector("#toast");
const modelStatus = document.querySelector("#modelStatus");
const startButton = document.querySelector("#startButton");
const stopButton = document.querySelector("#stopButton");
const captureButton = document.querySelector("#captureButton");
const clearButton = document.querySelector("#clearButton");
const confidenceRange = document.querySelector("#confidenceRange");
const confidenceValue = document.querySelector("#confidenceValue");
const speakToggle = document.querySelector("#speakToggle");
const mirrorToggle = document.querySelector("#mirrorToggle");
const fpsValue = document.querySelector("#fpsValue");
const objectCount = document.querySelector("#objectCount");
const topObject = document.querySelector("#topObject");
const detectionList = document.querySelector("#detectionList");
const captureStrip = document.querySelector("#captureStrip");
const captureCount = document.querySelector("#captureCount");

const ctx = overlay.getContext("2d");
const boxColors = ["#18c29c", "#f0b84f", "#ff6b6b", "#6bbcff", "#d58cff"];

let model = null;
let stream = null;
let running = false;
let detecting = false;
let animationId = 0;
let lastFrameTime = performance.now();
let lastSpoken = "";
let snapshots = 0;
let predictions = [];

function setToast(message) {
  toast.textContent = message;
}

function setModelStatus(message) {
  modelStatus.textContent = message;
}

function updateConfidenceLabel() {
  confidenceValue.textContent = `${confidenceRange.value}%`;
}

function setCameraButtons(isActive) {
  startButton.disabled = isActive;
  stopButton.disabled = !isActive;
  captureButton.disabled = !isActive;
}

function supported() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

async function loadModel() {
  if (model) {
    return model;
  }

  if (!window.cocoSsd) {
    throw new Error("The recognition library did not load. Check your internet connection and refresh.");
  }

  setModelStatus("Loading model");
  setToast("Loading recognition model...");
  model = await window.cocoSsd.load();
  setModelStatus("Model ready");
  return model;
}

async function startCamera() {
  if (!supported()) {
    setToast("Camera access is not available in this browser. Open this page from localhost in Chrome, Edge, or Firefox.");
    return;
  }

  try {
    setCameraButtons(true);
    await loadModel();
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
    camera.srcObject = stream;
    await camera.play();
    running = true;
    emptyState.classList.add("hidden");
    setToast("Camera active. Point it at objects to recognize them.");
    resizeCanvas();
    detectLoop();
  } catch (error) {
    setCameraButtons(false);
    stopCamera();
    setModelStatus(model ? "Model ready" : "Model idle");
    setToast(error.message || "Could not start the camera.");
  }
}

function stopCamera() {
  running = false;
  detecting = false;
  cancelAnimationFrame(animationId);

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  camera.srcObject = null;
  predictions = [];
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  emptyState.classList.remove("hidden");
  setCameraButtons(false);
  updateDetectionList([]);
  objectCount.textContent = "0";
  topObject.textContent = "None";
  fpsValue.textContent = "0";
  setToast("Camera stopped.");
}

function resizeCanvas() {
  const rect = frame.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  overlay.width = Math.round(rect.width * ratio);
  overlay.height = Math.round(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

async function detectLoop() {
  if (!running || detecting || !model) {
    return;
  }

  detecting = true;
  try {
    const threshold = Number(confidenceRange.value) / 100;
    predictions = await model.detect(camera);
    const filtered = predictions
      .filter((item) => item.score >= threshold)
      .sort((a, b) => b.score - a.score);

    renderDetections(filtered);
    updateDetectionList(filtered);
    updateStats(filtered);
    speakNewDetection(filtered);
  } catch (error) {
    setToast(error.message || "Recognition paused unexpectedly.");
  } finally {
    detecting = false;
    animationId = requestAnimationFrame(detectLoop);
  }
}

function renderDetections(items) {
  const rect = frame.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  const videoRatio = camera.videoWidth / camera.videoHeight;
  const frameRatio = rect.width / rect.height;
  let drawWidth = rect.width;
  let drawHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;

  if (videoRatio > frameRatio) {
    drawWidth = rect.height * videoRatio;
    offsetX = (rect.width - drawWidth) / 2;
  } else {
    drawHeight = rect.width / videoRatio;
    offsetY = (rect.height - drawHeight) / 2;
  }

  const scaleX = drawWidth / camera.videoWidth;
  const scaleY = drawHeight / camera.videoHeight;

  items.forEach((item, index) => {
    const [x, y, width, height] = item.bbox;
    const left = offsetX + x * scaleX;
    const top = offsetY + y * scaleY;
    const boxWidth = width * scaleX;
    const boxHeight = height * scaleY;
    const color = boxColors[index % boxColors.length];
    const label = `${item.class} ${Math.round(item.score * 100)}%`;

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(left, top, boxWidth, boxHeight);

    ctx.font = "700 14px Inter, system-ui, sans-serif";
    const labelWidth = Math.min(ctx.measureText(label).width + 18, rect.width - 12);
    const labelTop = Math.max(6, top - 30);

    ctx.fillStyle = color;
    ctx.fillRect(left, labelTop, labelWidth, 26);
    ctx.fillStyle = "#07100e";
    ctx.fillText(label, left + 9, labelTop + 18);
  });
}

function updateDetectionList(items) {
  if (!items.length) {
    detectionList.innerHTML = '<li class="muted">No objects detected yet.</li>';
    return;
  }

  const counts = new Map();
  items.forEach((item) => {
    const key = item.class;
    const existing = counts.get(key) || { count: 0, score: 0 };
    counts.set(key, {
      count: existing.count + 1,
      score: Math.max(existing.score, item.score)
    });
  });

  detectionList.innerHTML = Array.from(counts.entries())
    .map(([name, data]) => {
      const label = data.count > 1 ? `${name} x${data.count}` : name;
      return `<li><span>${label}</span><span class="confidence">${Math.round(data.score * 100)}%</span></li>`;
    })
    .join("");
}

function updateStats(items) {
  const now = performance.now();
  const fps = Math.round(1000 / Math.max(1, now - lastFrameTime));
  lastFrameTime = now;

  fpsValue.textContent = Number.isFinite(fps) ? String(fps) : "0";
  objectCount.textContent = String(items.length);
  topObject.textContent = items[0]?.class || "None";
}

function speakNewDetection(items) {
  if (!speakToggle.checked || !items.length || !window.speechSynthesis) {
    return;
  }

  const names = [...new Set(items.slice(0, 3).map((item) => item.class))].join(", ");
  if (!names || names === lastSpoken) {
    return;
  }

  lastSpoken = names;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(`Detected ${names}`));
}

function captureFrame() {
  if (!running) {
    return;
  }

  const capture = document.createElement("canvas");
  const captureContext = capture.getContext("2d");
  capture.width = camera.videoWidth;
  capture.height = camera.videoHeight;
  captureContext.drawImage(camera, 0, 0, capture.width, capture.height);

  predictions
    .filter((item) => item.score >= Number(confidenceRange.value) / 100)
    .forEach((item, index) => {
      const [x, y, width, height] = item.bbox;
      const color = boxColors[index % boxColors.length];
      captureContext.strokeStyle = color;
      captureContext.lineWidth = Math.max(4, capture.width / 250);
      captureContext.strokeRect(x, y, width, height);
      captureContext.fillStyle = color;
      captureContext.font = `700 ${Math.max(18, capture.width / 42)}px system-ui`;
      captureContext.fillText(item.class, x + 8, Math.max(28, y - 10));
    });

  const image = new Image();
  image.alt = "Captured camera frame";
  image.src = capture.toDataURL("image/jpeg", 0.82);
  captureStrip.prepend(image);
  snapshots += 1;
  captureCount.textContent = String(snapshots);

  while (captureStrip.children.length > 6) {
    captureStrip.lastElementChild.remove();
  }

  setToast("Snapshot captured.");
}

function clearSnapshots() {
  captureStrip.innerHTML = "";
  snapshots = 0;
  captureCount.textContent = "0";
  setToast("Snapshots cleared.");
}

confidenceRange.addEventListener("input", updateConfidenceLabel);
startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);
captureButton.addEventListener("click", captureFrame);
clearButton.addEventListener("click", clearSnapshots);
mirrorToggle.addEventListener("change", () => {
  frame.classList.toggle("is-mirrored", mirrorToggle.checked);
});

window.addEventListener("resize", () => {
  if (running) {
    resizeCanvas();
    renderDetections(predictions.filter((item) => item.score >= Number(confidenceRange.value) / 100));
  }
});

frame.classList.add("is-mirrored");
updateConfidenceLabel();
setCameraButtons(false);
