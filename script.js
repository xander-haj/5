/********************************************
 * Global Variables
 ********************************************/
let videoStream = null;
let currentDeviceId = null;
let currentResolution = { width: 1280, height: 720 };

let localVideo = null;
let roiBox = null;

let preprocessingOptions = {
  grayscale: false,
  highlight: false,
  highlightStrength: 50,
  contrast: false,
  contrastValue: 0,
  brightness: false,
  brightnessValue: 0,
  threshold: false,
  thresholdValue: 128,
  edge: false,
  edgeValue: 1
};

let ocrConfig = {
  workerCount: 1,
  confidenceThreshold: 60 // in percentage
};

// To store the Tesseract worker instance:
let tesseractWorker = null;

// Canvas for processing
let offscreenCanvas = null;
let offscreenCtx = null;


/********************************************
 * On Window Load
 ********************************************/
window.addEventListener('load', async () => {
  // Check camera permission
  if (!localStorage.getItem('cameraPermissionGranted')) {
    try {
      // Prompt user for camera permission
      await navigator.mediaDevices.getUserMedia({ video: true });
      
      // If successful, store permission and reload
      localStorage.setItem('cameraPermissionGranted', 'true');
      alert('Camera permission granted. The page will now refresh.');
      location.reload();
    } catch (err) {
      alert('Camera permission is required to use this application.');
      return;
    }
  }

  // Initialize references
  localVideo = document.getElementById('video');
  roiBox = document.getElementById('roi-box');

  // Initialize camera with default settings
  await initCamera();

  // Prepare Tesseract Worker
  await initTesseractWorker();

  // Enumerate devices for camera settings modal
  await populateCameraDevices();

  // Attach UI events
  attachEventListeners();

  // Start the OCR loop
  startProcessingLoop();
});


/********************************************
 * Camera Initialization
 ********************************************/
async function initCamera() {
  // Close any existing stream
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
  }

  const constraints = {
    audio: false,
    video: {
      deviceId: currentDeviceId ? { exact: currentDeviceId } : undefined,
      width: { ideal: currentResolution.width },
      height: { ideal: currentResolution.height },
      facingMode: 'environment'
    }
  };

  try {
    videoStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = videoStream;
    await localVideo.play();
  } catch (err) {
    console.error('Error initializing camera:', err);
    alert('Could not access the camera. Please check permissions and try again.');
  }

  // Create offscreen canvas matching the ROI size
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas');
  }
  const roiRect = roiBox.getBoundingClientRect();
  offscreenCanvas.width = roiRect.width;
  offscreenCanvas.height = roiRect.height;
  offscreenCtx = offscreenCanvas.getContext('2d');
}


/********************************************
 * Tesseract Initialization
 ********************************************/
// --- initTesseractWorker (fixed code) ---
async function initTesseractWorker() {
  if (tesseractWorker) {
    await tesseractWorker.terminate();
  }

  tesseractWorker = Tesseract.createWorker({
    // Use an explicit, known working version (e.g., 4.0.2 or newer)
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@4.0.2/dist/worker.min.js',
    // Point to the correct tesseract-core.wasm.js in the tesseract.js-core package
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@2.3.0/tesseract-core.wasm.js',
    // Make sure this matches the same Tesseract version
    langPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@4.0.2/dist/lang',
    logger: m => {
      // console.log(m);
    }
  });

  // Now these calls will work as intended:
  await tesseractWorker.load();
  await tesseractWorker.loadLanguage('eng');
  await tesseractWorker.initialize('eng');
}



/********************************************
 * Main Processing Loop
 ********************************************/
function startProcessingLoop() {
  const processFrame = async () => {
    if (!localVideo || localVideo.readyState !== 4) {
      requestAnimationFrame(processFrame);
      return;
    }

    // We capture the portion of the video that corresponds to the ROI
    // 1) Calculate ROI in video space
    const videoRect = localVideo.getBoundingClientRect();
    const roiRect = roiBox.getBoundingClientRect();

    const cropX = roiRect.x - videoRect.x;
    const cropY = roiRect.y - videoRect.y;
    const cropWidth = roiRect.width;
    const cropHeight = roiRect.height;

    // 2) Draw onto offscreen canvas
    offscreenCtx.drawImage(localVideo,
      cropX, cropY, cropWidth, cropHeight,
      0, 0, offscreenCanvas.width, offscreenCanvas.height
    );

    // 3) Apply OpenCV preprocessing
    let src = cv.matFromImageData(offscreenCtx.getImageData(0, 0, cropWidth, cropHeight));
    let dst = new cv.Mat();

    // Grayscale
    if (preprocessingOptions.grayscale) {
      cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
      src.delete();
      src = dst.clone();
    }

    // Highlights (Simple approach: increase brightness) 
    if (preprocessingOptions.highlight) {
      const alpha = 1.0; // No contrast change
      const beta = parseInt(preprocessingOptions.highlightStrength, 10);
      dst = new cv.Mat();
      src.convertTo(dst, -1, alpha, beta);
      src.delete();
      src = dst.clone();
    }

    // Contrast
    if (preprocessingOptions.contrast) {
      const alpha = 1 + parseInt(preprocessingOptions.contrastValue, 10) / 100; 
      dst = new cv.Mat();
      src.convertTo(dst, -1, alpha, 0);
      src.delete();
      src = dst.clone();
    }

    // Brightness
    if (preprocessingOptions.brightness) {
      const beta = parseInt(preprocessingOptions.brightnessValue, 10);
      const alpha = 1.0;
      dst = new cv.Mat();
      src.convertTo(dst, -1, alpha, beta);
      src.delete();
      src = dst.clone();
    }

    // Threshold
    if (preprocessingOptions.threshold) {
      dst = new cv.Mat();
      cv.threshold(src, dst, preprocessingOptions.thresholdValue, 255, cv.THRESH_BINARY);
      src.delete();
      src = dst.clone();
    }

    // Edge detection (Canny)
    if (preprocessingOptions.edge) {
      dst = new cv.Mat();
      cv.Canny(src, dst, preprocessingOptions.edgeValue * 10, preprocessingOptions.edgeValue * 20);
      src.delete();
      src = dst.clone();
    }

    // Put result back to offscreen canvas for Tesseract
    const processedData = new ImageData(
      new Uint8ClampedArray(src.data),
      src.cols,
      src.rows
    );
    offscreenCtx.putImageData(processedData, 0, 0);

    // 4) Tesseract OCR
    try {
      const { data } = await tesseractWorker.recognize(offscreenCanvas);
      let textFound = false;
      if (data && data.words) {
        for (const w of data.words) {
          if (w.confidence >= ocrConfig.confidenceThreshold) {
            textFound = true;
            break;
          }
        }
      }
      // Update ROI box border
      roiBox.style.borderColor = textFound ? 'green' : 'red';
    } catch (err) {
      console.error('Tesseract error:', err);
    }

    // Cleanup
    src.delete();
    dst.delete();

    // Next frame
    requestAnimationFrame(processFrame);
  };

  requestAnimationFrame(processFrame);
}


/********************************************
 * Populate Camera Devices
 ********************************************/
async function populateCameraDevices() {
  const cameraSelect = document.getElementById('camera-select');
  cameraSelect.innerHTML = ''; // Clear existing options

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    
    videoDevices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.text = device.label || `Camera ${cameraSelect.length + 1}`;
      cameraSelect.appendChild(option);
    });

    // If currentDeviceId is not set, use first device
    if (!currentDeviceId && videoDevices.length > 0) {
      currentDeviceId = videoDevices[0].deviceId;
      cameraSelect.value = currentDeviceId;
    } else {
      cameraSelect.value = currentDeviceId;
    }
  } catch (err) {
    console.error('Error enumerating devices:', err);
  }
}


/********************************************
 * Attach Event Listeners for UI
 ********************************************/
function attachEventListeners() {
  // Modal toggles
  document.getElementById('preprocess-btn').addEventListener('click', () => {
    openModal('preprocess-modal');
  });
  document.getElementById('ocr-config-btn').addEventListener('click', () => {
    openModal('ocr-config-modal');
  });
  document.getElementById('camera-settings-btn').addEventListener('click', () => {
    openModal('camera-settings-modal');
  });
  document.getElementById('extract-text-btn').addEventListener('click', () => {
    openModal('text-modal');
  });

  // Close modals
  document.querySelectorAll('.close').forEach(closeBtn => {
    closeBtn.addEventListener('click', () => {
      const targetModal = closeBtn.getAttribute('data-close');
      closeModal(targetModal);
    });
  });

  window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
      e.target.style.display = 'none';
    }
  });

  // Preprocessing checkboxes and sliders
  document.getElementById('grayscale-check').addEventListener('change', e => {
    preprocessingOptions.grayscale = e.target.checked;
  });
  document.getElementById('highlight-check').addEventListener('change', e => {
    preprocessingOptions.highlight = e.target.checked;
  });
  document.getElementById('highlight-slider').addEventListener('input', e => {
    preprocessingOptions.highlightStrength = e.target.value;
  });
  document.getElementById('contrast-check').addEventListener('change', e => {
    preprocessingOptions.contrast = e.target.checked;
  });
  document.getElementById('contrast-slider').addEventListener('input', e => {
    preprocessingOptions.contrastValue = e.target.value;
  });
  document.getElementById('brightness-check').addEventListener('change', e => {
    preprocessingOptions.brightness = e.target.checked;
  });
  document.getElementById('brightness-slider').addEventListener('input', e => {
    preprocessingOptions.brightnessValue = e.target.value;
  });
  document.getElementById('threshold-check').addEventListener('change', e => {
    preprocessingOptions.threshold = e.target.checked;
  });
  document.getElementById('threshold-slider').addEventListener('input', e => {
    preprocessingOptions.thresholdValue = e.target.value;
  });
  document.getElementById('edge-check').addEventListener('change', e => {
    preprocessingOptions.edge = e.target.checked;
  });
  document.getElementById('edge-slider').addEventListener('input', e => {
    preprocessingOptions.edgeValue = e.target.value;
  });

  // OCR config
  const workerCountInput = document.getElementById('worker-count');
  workerCountInput.addEventListener('change', async e => {
    ocrConfig.workerCount = parseInt(e.target.value, 10);
    // Re-initialize Tesseract worker with updated worker count
    await initTesseractWorker();
  });

  const confidenceThreshold = document.getElementById('confidence-threshold');
  confidenceThreshold.addEventListener('input', e => {
    ocrConfig.confidenceThreshold = parseInt(e.target.value, 10);
    document.getElementById('confidence-value').innerText = e.target.value;
  });

  // Camera settings
  document.getElementById('camera-select').addEventListener('change', e => {
    currentDeviceId = e.target.value;
  });
  document.getElementById('resolution-select').addEventListener('change', e => {
    const [w, h] = e.target.value.split('x');
    currentResolution = { width: parseInt(w, 10), height: parseInt(h, 10) };
  });
  document.getElementById('apply-camera-settings').addEventListener('click', async () => {
    closeModal('camera-settings-modal');
    await initCamera();
  });

  // Extracted text display is updated on the fly in the OCR loop,
  // but we can fetch the final recognized text upon opening text modal.
  document.getElementById('extract-text-btn').addEventListener('click', async () => {
    let textResult = 'No text recognized yet.';
    try {
      const { data } = await tesseractWorker.recognize(offscreenCanvas);
      textResult = data.text.trim() || textResult;
    } catch (err) {
      console.error(err);
    }
    document.getElementById('extracted-text').textContent = textResult;
  });
}


/********************************************
 * Modal Helpers
 ********************************************/
function openModal(modalId) {
  document.getElementById(modalId).style.display = 'block';
}

function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
}
