/****************************************************
 * Global Variables & State
 ****************************************************/
let videoStream = null;
let localCameraAccessRequested = false;
let selectedDeviceId = null;
let selectedResolution = { width: 640, height: 480 };

let workerCount = 1;
let confidenceThreshold = 60; // default

// Preprocessing Toggles
let enableGrayscale = false;
let enableHighlight = false;
let highlightValue = 50;
let enableContrast = false;
let contrastValue = 50;
let enableBrightness = false;
let brightnessValue = 50;
let enableThreshold = false;
let thresholdValue = 128;
let enableEdgeDetection = false;
let edgeValue = 50;

// DOM Elements
const video = document.getElementById('video');
const overlayCanvas = document.getElementById('overlayCanvas');
const roiBox = document.getElementById('roi-box');

const preprocessingModal = document.getElementById('preprocessingModal');
const closePreprocessingModal = document.getElementById('closePreprocessingModal');
const ocrModal = document.getElementById('ocrModal');
const closeOcrModal = document.getElementById('closeOcrModal');
const cameraModal = document.getElementById('cameraModal');
const closeCameraModal = document.getElementById('closeCameraModal');
const textModal = document.getElementById('textModal');
const closeTextModal = document.getElementById('closeTextModal');

const preprocessingBtn = document.getElementById('preprocessSettingsBtn');
const ocrSettingsBtn = document.getElementById('ocrSettingsBtn');
const cameraSettingsBtn = document.getElementById('cameraSettingsBtn');
const extractedTextBtn = document.getElementById('extractedTextBtn');

const cameraSelect = document.getElementById('cameraSelect');
const resolutionSelect = document.getElementById('resolutionSelect');
const applyCameraSettingsBtn = document.getElementById('applyCameraSettingsBtn');

const enableGrayscaleChk = document.getElementById('enableGrayscale');
const enableHighlightChk = document.getElementById('enableHighlight');
const highlightRange = document.getElementById('highlightValue');
const enableContrastChk = document.getElementById('enableContrast');
const contrastRange = document.getElementById('contrastValue');
const enableBrightnessChk = document.getElementById('enableBrightness');
const brightnessRange = document.getElementById('brightnessValue');
const enableThresholdChk = document.getElementById('enableThreshold');
const thresholdRange = document.getElementById('thresholdValue');
const enableEdgeDetectionChk = document.getElementById('enableEdgeDetection');
const edgeRange = document.getElementById('edgeValue');

const workerCountInput = document.getElementById('workerCount');
const confidenceThresholdInput = document.getElementById('confidenceThreshold');
const confidenceLabel = document.getElementById('confidenceLabel');
const applyOcrSettingsBtn = document.getElementById('applyOcrSettingsBtn');

const extractedTextOutput = document.getElementById('extractedTextOutput');


/****************************************************
 * Camera Permission & Initialization
 ****************************************************/

window.addEventListener('load', async () => {
  // Check if we have already requested camera access
  const cameraAccessGranted = localStorage.getItem('cameraAccessGranted');
  if (!cameraAccessGranted) {
    try {
      await requestCameraAccess();
      // If successful, store and reload
      localStorage.setItem('cameraAccessGranted', 'true');
      alert('Camera access granted. The page will now refresh to apply changes.');
      location.reload();
    } catch (error) {
      alert('Camera access is required. Please allow and refresh.');
    }
  } else {
    // We have permission, proceed with actual initialization
    initCameraList();
  }
});

/**
 * Requests camera access once without showing full interface.
 */
async function requestCameraAccess() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  // Immediately stop the stream, we only want to check permission
  stream.getTracks().forEach(track => track.stop());
}

/**
 * Initialize camera select list and default stream
 */
async function initCameraList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    cameraSelect.innerHTML = ''; // clear previous
    videoDevices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.text = device.label || `Camera ${cameraSelect.length + 1}`;
      cameraSelect.appendChild(option);
    });

    // Select the first device by default if not already selected
    if (!selectedDeviceId && videoDevices.length > 0) {
      selectedDeviceId = videoDevices[0].deviceId;
    }

    cameraSelect.value = selectedDeviceId;
    startVideoStream();
  } catch (error) {
    console.error('Error initializing camera list:', error);
  }
}

/**
 * Starts video stream based on selectedDeviceId and selectedResolution
 */
async function startVideoStream() {
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
  }
  const [width, height] = selectedResolution.width
    ? [selectedResolution.width, selectedResolution.height]
    : resolutionSelect.value.split('x').map(Number);

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: selectedDeviceId },
        width: { ideal: width },
        height: { ideal: height }
      }
    });
    video.srcObject = videoStream;

    video.onloadedmetadata = () => {
      // Set canvas size
      overlayCanvas.width = video.videoWidth;
      overlayCanvas.height = video.videoHeight;
      startProcessingLoop();
    };
  } catch (err) {
    console.error('Error starting video stream:', err);
  }
}


/****************************************************
 * Event Listeners: Buttons & Modal Toggles
 ****************************************************/

// Preprocessing Modal
preprocessingBtn.addEventListener('click', () => {
  preprocessingModal.style.display = 'block';
});
closePreprocessingModal.addEventListener('click', () => {
  preprocessingModal.style.display = 'none';
});

// OCR Modal
ocrSettingsBtn.addEventListener('click', () => {
  ocrModal.style.display = 'block';
});
closeOcrModal.addEventListener('click', () => {
  ocrModal.style.display = 'none';
});

// Camera Modal
cameraSettingsBtn.addEventListener('click', () => {
  cameraModal.style.display = 'block';
});
closeCameraModal.addEventListener('click', () => {
  cameraModal.style.display = 'none';
});

// Text Modal
extractedTextBtn.addEventListener('click', () => {
  textModal.style.display = 'block';
});
closeTextModal.addEventListener('click', () => {
  textModal.style.display = 'none';
});

// Close modals if user clicks outside
window.addEventListener('click', (event) => {
  if (event.target === preprocessingModal) {
    preprocessingModal.style.display = 'none';
  }
  if (event.target === ocrModal) {
    ocrModal.style.display = 'none';
  }
  if (event.target === cameraModal) {
    cameraModal.style.display = 'none';
  }
  if (event.target === textModal) {
    textModal.style.display = 'none';
  }
});

/****************************************************
 * Preprocessing Settings Updates
 ****************************************************/
enableGrayscaleChk.addEventListener('change', (e) => {
  enableGrayscale = e.target.checked;
});
enableHighlightChk.addEventListener('change', (e) => {
  enableHighlight = e.target.checked;
});
highlightRange.addEventListener('input', (e) => {
  highlightValue = parseInt(e.target.value, 10);
});
enableContrastChk.addEventListener('change', (e) => {
  enableContrast = e.target.checked;
});
contrastRange.addEventListener('input', (e) => {
  contrastValue = parseInt(e.target.value, 10);
});
enableBrightnessChk.addEventListener('change', (e) => {
  enableBrightness = e.target.checked;
});
brightnessRange.addEventListener('input', (e) => {
  brightnessValue = parseInt(e.target.value, 10);
});
enableThresholdChk.addEventListener('change', (e) => {
  enableThreshold = e.target.checked;
});
thresholdRange.addEventListener('input', (e) => {
  thresholdValue = parseInt(e.target.value, 10);
});
enableEdgeDetectionChk.addEventListener('change', (e) => {
  enableEdgeDetection = e.target.checked;
});
edgeRange.addEventListener('input', (e) => {
  edgeValue = parseInt(e.target.value, 10);
});

/****************************************************
 * OCR Settings
 ****************************************************/
confidenceThresholdInput.addEventListener('input', (e) => {
  confidenceThreshold = parseInt(e.target.value, 10);
  confidenceLabel.textContent = confidenceThreshold;
});
workerCountInput.addEventListener('change', (e) => {
  workerCount = parseInt(e.target.value, 10);
});
applyOcrSettingsBtn.addEventListener('click', () => {
  ocrModal.style.display = 'none';
});

/****************************************************
 * Camera Settings
 ****************************************************/
applyCameraSettingsBtn.addEventListener('click', () => {
  selectedDeviceId = cameraSelect.value;
  const resString = resolutionSelect.value;
  const [w, h] = resString.split('x');
  selectedResolution = { width: parseInt(w, 10), height: parseInt(h, 10) };
  cameraModal.style.display = 'none';
  startVideoStream();
});

/****************************************************
 * Main Processing Loop
 * - Preprocess ROI
 * - Perform OCR on ROI
 * - Update bounding box color
 ****************************************************/

async function startProcessingLoop() {
  const ctx = overlayCanvas.getContext('2d');
  const roiBoxRect = roiBox.getBoundingClientRect();
  const videoRect = video.getBoundingClientRect();

  // To continually process frames in real-time
  async function processFrame() {
    if (!video.paused && !video.ended) {
      // Calculate ROI position relative to video
      // ROI is visually in the center; we need normalized offsets
      const scaleX = video.videoWidth / videoRect.width;
      const scaleY = video.videoHeight / videoRect.height;

      const roiWidth = roiBoxRect.width * scaleX;
      const roiHeight = roiBoxRect.height * scaleY;

      // ROI top-left relative to the video frame
      const roiLeft = (roiBoxRect.left - videoRect.left) * scaleX;
      const roiTop = (roiBoxRect.top - videoRect.top) * scaleY;

      // Draw the current ROI frame onto the overlay canvas
      ctx.drawImage(
        video,
        roiLeft, roiTop, roiWidth, roiHeight, // source
        roiLeft, roiTop, roiWidth, roiHeight  // destination
      );

      // Preprocess (OpenCV.js)
      let src = cv.imread(overlayCanvas);
      // We only want the ROI portion
      let roi = src.roi(new cv.Rect(roiLeft, roiTop, roiWidth, roiHeight));

      // Apply preprocessing
      if (enableGrayscale) {
        cv.cvtColor(roi, roi, cv.COLOR_RGBA2GRAY, 0);
      }
      if (enableHighlight) {
        // Simple gamma correction as "highlight"
        let alpha = highlightValue / 50; // arbitrary scale
        roi.convertTo(roi, -1, alpha, 0);
      }
      if (enableContrast) {
        let alpha = contrastValue / 50; // scale
        roi.convertTo(roi, -1, alpha, 0);
      }
      if (enableBrightness) {
        let beta = (brightnessValue - 50) * 2; // shift
        roi.convertTo(roi, -1, 1, beta);
      }
      if (enableThreshold) {
        cv.threshold(roi, roi, thresholdValue, 255, cv.THRESH_BINARY);
      }
      if (enableEdgeDetection) {
        cv.Canny(roi, roi, edgeValue, edgeValue * 2, 3, false);
      }

      // Place processed ROI back on overlayCanvas
      cv.imshow(overlayCanvas, src);

      // Prepare a small canvas for Tesseract
      let tCanvas = document.createElement('canvas');
      tCanvas.width = roiWidth;
      tCanvas.height = roiHeight;
      cv.imshow(tCanvas, roi);

      roi.delete();
      src.delete();

      // Convert the ROI canvas to a blob for Tesseract
      tCanvas.toBlob(async (blob) => {
        if (!blob) {
          requestAnimationFrame(processFrame);
          return;
        }

        // Tesseract
        try {
          const result = await Tesseract.recognize(blob, 'eng', {
            workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@4.1.0/dist/worker.min.js',
            langPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@4.1.0/dist/lang/',
            corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@4.1.0/tesseract-core.wasm.js',
            workerBlobURL: false,
            numWorkers: workerCount
          });
          const { data } = result;
          // Evaluate confidence
          let maxConfidence = 0;
          let extractedText = '';
          data.words.forEach(word => {
            if (word.confidence > maxConfidence) {
              maxConfidence = word.confidence;
            }
            extractedText += word.text + ' ';
          });

          // Update bounding box color
          if (maxConfidence >= confidenceThreshold) {
            roiBox.style.borderColor = 'green';
          } else {
            roiBox.style.borderColor = 'red';
          }

          // We store extracted text in a global location, shown on demand:
          extractedTextOutput.textContent = extractedText.trim();
        } catch (error) {
          console.error('Tesseract error:', error);
          roiBox.style.borderColor = 'red';
        }

        requestAnimationFrame(processFrame);
      }, 'image/png');
    } else {
      requestAnimationFrame(processFrame);
    }
  }

  // Kick off the loop
  requestAnimationFrame(processFrame);
}
