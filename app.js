/********************************************************************
 * app.js
 * Main logic for:
 *  - Camera initialization and device selection
 *  - ROI bounding box drawing
 *  - Preprocessing (OpenCV.js)
 *  - Real-time OCR (Tesseract.js)
 *  - UI modals and settings
 ********************************************************************/

/* -------------------- Global Variables & Elements -------------------- */
let video = null;
let stream = null;
let roiBox = null;

// ROI dimensions and position (will be set dynamically once video loads)
let roiX = 0, roiY = 0, roiW = 0, roiH = 0;

// Preprocessing flags & parameters
let enableGray = false;
let enableHighlight = false;
let highlightVal = 50;
let enableContrast = false;
let contrastVal = 50;
let enableBrightness = false;
let brightnessVal = 50;
let enableThreshold = false;
let thresholdVal = 128;
let enableEdge = false;
let edgeVal = 3;

// OCR settings
let workerCount = 1;       // 1-4
let confidenceThreshold = 70; // 0-100

// Tesseract Worker(s)
let isOcrRunning = false;  // To ensure we don't overlap OCR calls
let recognizedText = "";
let boundingBoxColor = "red";

// Canvas elements for processing
let hiddenCanvas = null;
let hiddenCtx = null;
let outputCanvas = null;
let outputCtx = null;

/* -------------------- On Load: Camera Permission Check -------------------- */
window.addEventListener("DOMContentLoaded", async () => {
  video = document.getElementById("video");
  roiBox = document.getElementById("roiBox");

  hiddenCanvas = document.createElement("canvas");
  hiddenCtx = hiddenCanvas.getContext("2d");

  outputCanvas = document.createElement("canvas");
  outputCtx = outputCanvas.getContext("2d");

  // If not yet granted or first time, request permission & reload
  const cameraGranted = localStorage.getItem("cameraGranted");
  if (!cameraGranted) {
    try {
      // Attempt to get camera permission quickly
      await navigator.mediaDevices.getUserMedia({ video: true });
      // If successful, store flag and reload
      localStorage.setItem("cameraGranted", "true");
      location.reload();
    } catch (err) {
      alert("Camera permission denied or error occurred. Please allow camera access.");
      console.error(err);
      return;
    }
  } else {
    // Already granted, set up stream with defaults
    initCameraStream();
  }

  // Setup event listeners for UI
  setupUI();
});

/* -------------------- Camera Stream Initialization -------------------- */
async function initCameraStream(deviceId = null, width = 640, height = 480) {
  try {
    if (stream) {
      // If there's an existing stream, stop tracks
      stream.getTracks().forEach(track => track.stop());
    }

    const constraints = {
      video: {
        width: { exact: width },
        height: { exact: height }
      }
    };

    // If a specific deviceId is given, include it
    if (deviceId) {
      constraints.video.deviceId = { exact: deviceId };
    }

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;

    // Once video loads metadata, set up ROI
    video.onloadedmetadata = () => {
      video.play();
      calculateROI();
    };
  } catch (err) {
    console.error("Error initializing camera stream:", err);
    alert("Could not access the camera with the chosen settings.");
  }
}

/* Calculate the ROI bounding box in the center of the video */
function calculateROI() {
  // Use 50% of the video dimension as ROI
  roiW = video.videoWidth * 0.5;
  roiH = video.videoHeight * 0.5;
  roiX = (video.videoWidth - roiW) / 2;
  roiY = (video.videoHeight - roiH) / 2;

  // Position the ROI box in the overlay
  // We need the displayed size from CSS, so read the actual offsetWidth/Height
  const displayWidth = video.offsetWidth;
  const displayHeight = video.offsetHeight;

  // Ratio from actual video size to display size
  const widthRatio = displayWidth / video.videoWidth;
  const heightRatio = displayHeight / video.videoHeight;

  // Convert ROI from video coords to display coords
  const roiDisplayX = roiX * widthRatio;
  const roiDisplayY = roiY * heightRatio;
  const roiDisplayW = roiW * widthRatio;
  const roiDisplayH = roiH * heightRatio;

  // Apply to the roiBox element
  roiBox.style.left = roiDisplayX + "px";
  roiBox.style.top = roiDisplayY + "px";
  roiBox.style.width = roiDisplayW + "px";
  roiBox.style.height = roiDisplayH + "px";

  // Kick off the scanning loop (e.g., every 800ms) once ROI is set
  startOcrLoop();
}

/* -------------------- OCR Loop -------------------- */
function startOcrLoop() {
  setInterval(() => {
    if (!isOcrRunning) {
      processFrameAndRunOCR();
    }
  }, 800);
}

/* Grab ROI frame, apply any chosen preprocessing with OpenCV, then pass to Tesseract */
async function processFrameAndRunOCR() {
  isOcrRunning = true;

  // 1) Draw current video frame onto hidden canvas at full resolution
  hiddenCanvas.width = video.videoWidth;
  hiddenCanvas.height = video.videoHeight;
  hiddenCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

  // 2) Extract ROI from hidden canvas
  const roiImageData = hiddenCtx.getImageData(roiX, roiY, roiW, roiH);

  // 3) Create an OpenCV mat from roiImageData
  let src = cv.matFromImageData(roiImageData);
  let dst = new cv.Mat();

  // 4) Apply preprocessing steps
  //   a) Grayscale
  if (enableGray) {
    cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
    src.delete();
    src = dst.clone();
  }

  //   b) Highlights (simple gain for lighter areas) => We'll approximate by brightening mid/high tones
  if (enableHighlight) {
    // Convert to a format we can manipulate
    // If already gray, skip color conversion
    if (!enableGray) {
      cv.cvtColor(src, dst, cv.COLOR_RGBA2RGB);
      src.delete();
      src = dst.clone();
    }
    // alpha blend - simplistic approach
    let alpha = highlightVal / 50.0; // scale factor
    src.convertTo(dst, -1, 1.0, alpha * 30); // simple brightening
    src.delete();
    src = dst.clone();
  }

  //   c) Contrast
  if (enableContrast) {
    let alpha = contrastVal / 50.0; // scale factor around 1
    src.convertTo(dst, -1, alpha, 0);
    src.delete();
    src = dst.clone();
  }

  //   d) Brightness
  if (enableBrightness) {
    let beta = (brightnessVal - 50) * 2; // range ~ -100 to +100
    src.convertTo(dst, -1, 1.0, beta);
    src.delete();
    src = dst.clone();
  }

  //   e) Threshold
  if (enableThreshold) {
    if (!enableGray) {
      // Must be gray to threshold
      cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
      src.delete();
      src = dst.clone();
    }
    cv.threshold(src, dst, thresholdVal, 255, cv.THRESH_BINARY);
    src.delete();
    src = dst.clone();
  }

  //   f) Edge Detection (Canny)
  if (enableEdge) {
    if (!enableGray) {
      // Must be gray to do canny
      cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
      src.delete();
      src = dst.clone();
    }
    cv.Canny(src, dst, edgeVal * 10, edgeVal * 20); // simple ratio
    src.delete();
    src = dst.clone();
  }

  // 5) Convert final mat back to ImageData for Tesseract
  let finalImageData = new ImageData(
    new Uint8ClampedArray(dst.data),
    dst.cols,
    dst.rows
  );

  // Cleanup
  dst.delete();
  src.delete();

  // 6) Draw to outputCanvas (optional to show user) - not displayed in this example
  outputCanvas.width = finalImageData.width;
  outputCanvas.height = finalImageData.height;
  outputCtx.putImageData(finalImageData, 0, 0);

  // 7) Run Tesseract on the processed ROI
  //    For brevity, we create a single worker each time (not very optimal).
  //    For production, you may create a Tesseract worker once and reuse it.
  Tesseract.recognize(
    outputCanvas,
    'eng', 
    {
      // For multiple workers, a more advanced approach is required
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@4.0.2/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@3.0.2/tesseract-core.wasm.js',
    }
  ).then(result => {
    let text = result.data.text.trim();
    recognizedText = text;

    // Evaluate confidence
    let anyHighConfidence = false;
    result.data.words.forEach(word => {
      if (word.confidence >= confidenceThreshold) {
        anyHighConfidence = true;
      }
    });

    // If there's any word above threshold or if text is not empty
    if (anyHighConfidence && text.length > 0) {
      boundingBoxColor = "green";
    } else {
      boundingBoxColor = "red";
    }

    roiBox.style.borderColor = boundingBoxColor;
  })
  .catch(err => {
    console.error("Tesseract error:", err);
    boundingBoxColor = "red";
    roiBox.style.borderColor = boundingBoxColor;
  })
  .finally(() => {
    isOcrRunning = false;
  });
}

/* -------------------- UI Setup & Modal Controls -------------------- */
function setupUI() {
  // Buttons
  const cameraSettingsBtn = document.getElementById("cameraSettingsBtn");
  const preprocessingBtn = document.getElementById("preprocessingBtn");
  const ocrSettingsBtn = document.getElementById("ocrSettingsBtn");
  const extractedTextBtn = document.getElementById("extractedTextBtn");

  // Modals
  const cameraSettingsModal = document.getElementById("cameraSettingsModal");
  const preprocessingModal = document.getElementById("preprocessingModal");
  const ocrModal = document.getElementById("ocrModal");
  const extractedTextModal = document.getElementById("extractedTextModal");

  // Close buttons
  document.getElementById("closeCameraSettings").onclick = () => {
    cameraSettingsModal.style.display = "none";
  };
  document.getElementById("closePreprocessing").onclick = () => {
    preprocessingModal.style.display = "none";
  };
  document.getElementById("closeOCR").onclick = () => {
    ocrModal.style.display = "none";
  };
  document.getElementById("closeExtractedText").onclick = () => {
    extractedTextModal.style.display = "none";
  };

  // Show/Hide modals
  cameraSettingsBtn.onclick = () => {
    cameraSettingsModal.style.display = "block";
    populateCameraDevices();
  };
  preprocessingBtn.onclick = () => {
    preprocessingModal.style.display = "block";
  };
  ocrSettingsBtn.onclick = () => {
    ocrModal.style.display = "block";
  };
  extractedTextBtn.onclick = () => {
    // Show recognized text in the text area
    document.getElementById("extractedTextArea").value = recognizedText;
    extractedTextModal.style.display = "block";
  };

  // When user clicks anywhere outside the modal, close it
  window.onclick = (event) => {
    if (event.target === cameraSettingsModal) {
      cameraSettingsModal.style.display = "none";
    }
    if (event.target === preprocessingModal) {
      preprocessingModal.style.display = "none";
    }
    if (event.target === ocrModal) {
      ocrModal.style.display = "none";
    }
    if (event.target === extractedTextModal) {
      extractedTextModal.style.display = "none";
    }
  };

  /* Preprocessing checkboxes & sliders */
  document.getElementById("enableGray").onchange = (e) => {
    enableGray = e.target.checked;
  };
  document.getElementById("enableHighlight").onchange = (e) => {
    enableHighlight = e.target.checked;
  };
  document.getElementById("highlightSlider").oninput = (e) => {
    highlightVal = parseInt(e.target.value, 10);
  };
  document.getElementById("enableContrast").onchange = (e) => {
    enableContrast = e.target.checked;
  };
  document.getElementById("contrastSlider").oninput = (e) => {
    contrastVal = parseInt(e.target.value, 10);
  };
  document.getElementById("enableBrightness").onchange = (e) => {
    enableBrightness = e.target.checked;
  };
  document.getElementById("brightnessSlider").oninput = (e) => {
    brightnessVal = parseInt(e.target.value, 10);
  };
  document.getElementById("enableThreshold").onchange = (e) => {
    enableThreshold = e.target.checked;
  };
  document.getElementById("thresholdSlider").oninput = (e) => {
    thresholdVal = parseInt(e.target.value, 10);
  };
  document.getElementById("enableEdge").onchange = (e) => {
    enableEdge = e.target.checked;
  };
  document.getElementById("edgeSlider").oninput = (e) => {
    edgeVal = parseInt(e.target.value, 10);
  };

  /* OCR settings */
  document.getElementById("workerCountSelect").onchange = (e) => {
    workerCount = parseInt(e.target.value, 10);
  };
  document.getElementById("confidenceThreshold").onchange = (e) => {
    confidenceThreshold = parseInt(e.target.value, 10);
  };

  /* Camera Settings apply */
  document.getElementById("applyCameraSettingsBtn").onclick = () => {
    const cameraSelect = document.getElementById("cameraSelect");
    const resolutionSelect = document.getElementById("resolutionSelect");

    const selectedDeviceId = cameraSelect.value;
    const [w, h] = resolutionSelect.value.split("x").map(Number);

    cameraSettingsModal.style.display = "none";
    initCameraStream(selectedDeviceId, w, h);
  };
}

/* -------------------- Camera Selection -------------------- */
async function populateCameraDevices() {
  const cameraSelect = document.getElementById("cameraSelect");
  cameraSelect.innerHTML = ""; // Clear out old entries

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === "videoinput");

    videoDevices.forEach((device, idx) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.text = device.label || `Camera ${idx + 1}`;
      cameraSelect.appendChild(option);
    });
  } catch (err) {
    console.error("Error enumerating devices:", err);
  }
}
