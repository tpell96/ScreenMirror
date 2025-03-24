const { ipcRenderer } = require('electron');

// DOM Elements
const selectBtn = document.getElementById('selectBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const status = document.getElementById('status');
const resolutionSelect = document.getElementById('resolutionSelect');
const windowSelect = document.getElementById('windowSelect');
const detectWindowsBtn = document.getElementById('detectWindowsBtn');
const lockAspect = document.getElementById('lockAspect');
const selectionCoords = document.getElementById('selectionCoords');

// State variables
let isCapturing = false;
let captureStream = null;
let captureInterval = null;
let captureCanvas, captureCtx, video;
let windowList = [];
let screenInfo = null;
let currentSelection = null;

// Resolution presets (width for 16:9 aspect ratio)
const resolutions = {
  '1080': { width: 1920, height: 1080 },
  '1440': { width: 2560, height: 1440 },
  '2160': { width: 3840, height: 2160 }
};

// Initialize capture elements
function initCaptureElements() {
  // Create video element to process frames if not exists
  if (!video) {
    video = document.createElement('video');
  }
  
  // Create canvas for frame processing if not exists
  if (!captureCanvas) {
    captureCanvas = document.createElement('canvas');
    captureCtx = captureCanvas.getContext('2d', { alpha: false });
  }
  
  // Set canvas size based on selected resolution
  const resolution = resolutions[resolutionSelect.value];
  captureCanvas.width = resolution.width;
  captureCanvas.height = resolution.height;
}

// Get screen information
async function getScreenInfo() {
  try {
    // Get screen info from main process
    screenInfo = await ipcRenderer.invoke('get-screen-info');
  } catch (error) {
    console.error('Error getting screen info:', error);
  }
}

// Start selection process
function startSelection() {
  // Send message to main process to create selection window
  ipcRenderer.send('start-selection');
  status.textContent = 'Selecting area...';
}

// Process and send frame to output
function captureAndSendFrame() {
  if (!isCapturing || !video.readyState >= 2 || !currentSelection) return;
  
  try {
    // Use the screen coordinates from the selection
    const { x, y, width, height } = currentSelection;
    
    // Ensure coordinates are within bounds
    const safeX = Math.max(0, x);
    const safeY = Math.max(0, y);
    const safeWidth = Math.min(width, video.videoWidth - safeX);
    const safeHeight = Math.min(height, video.videoHeight - safeY);
    
    if (safeWidth <= 0 || safeHeight <= 0) {
      console.error('Invalid capture area dimensions');
      return;
    }
    
    // Draw only the selected area to capture canvas at full resolution
    captureCtx.drawImage(
      video, 
      safeX, safeY, safeWidth, safeHeight,
      0, 0, captureCanvas.width, captureCanvas.height
    );
    
    // Send high-quality frame to main process
    const frameData = captureCanvas.toDataURL('image/jpeg', 0.92);
    ipcRenderer.send('video-frame', frameData);
  } catch (error) {
    console.error('Error capturing frame:', error);
  }
}

// Set selection to match selected window
function setSelectionToWindow(windowIndex) {
  if (windowIndex === '' || !windowList[windowIndex]) return;
  
  const selectedWindow = windowList[windowIndex];
  
  if (!screenInfo) return;
  
  // For a window selection, we'll use bounds from the window list
  // but for actual capturing, we need to ensure we capture the actual window content
  
  // Store the window ID along with its bounds so we can use it during capture
  currentSelection = {
    x: selectedWindow.bounds.x,
    y: selectedWindow.bounds.y,
    width: selectedWindow.bounds.width,
    height: selectedWindow.bounds.height,
    windowId: selectedWindow.id,
    windowName: selectedWindow.name
  };
  
  // Update the UI to show details of the selected window
  updateSelectionDisplay();
  
  // Enable the start button
  startBtn.disabled = false;
  status.textContent = `Ready to Mirror: ${selectedWindow.name}`;
}

// Start screen capture and mirroring specifically for a selected window
async function startCaptureWindow(windowId) {
  try {
    // Initialize capture elements with selected resolution
    initCaptureElements();
    
    // Request to capture a specific window
    const constraints = {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: windowId
        }
      }
    };
    
    // Get the stream
    captureStream = await navigator.mediaDevices.getUserMedia(constraints);
    
    // Set up video element
    video.srcObject = captureStream;
    video.onloadedmetadata = () => {
      video.play();
      
      // Start capture loop for the window
      isCapturing = true;
      captureInterval = setInterval(() => {
        // For window capture, we want to capture the entire video feed
        // since we're directly capturing the window
        captureCtx.drawImage(
          video,
          0, 0, video.videoWidth, video.videoHeight,
          0, 0, captureCanvas.width, captureCanvas.height
        );
        
        // Send high-quality frame to main process
        const frameData = captureCanvas.toDataURL('image/jpeg', 0.92);
        ipcRenderer.send('video-frame', frameData);
      }, 1000 / 30); // 30 FPS
    };
    
    return true;
  } catch (error) {
    console.error('Error capturing window:', error);
    return false;
  }
}

// Start screen capture and mirroring
async function startCapture() {
  if (!currentSelection) {
    status.textContent = 'Please select an area first';
    return;
  }
  
  // Update UI immediately to show we're processing
  selectBtn.disabled = true;
  startBtn.disabled = true;
  status.textContent = 'Starting capture...';
  status.style.color = '#FFA500'; // Orange - processing
  
  let success = false;
  
  // If we have a window ID, try to capture that specific window first
  if (currentSelection.windowId) {
    console.log(`Attempting to capture window: ${currentSelection.windowName}`);
    success = await startCaptureWindow(currentSelection.windowId);
  }
  
  // If window capture failed or we don't have a window ID, fall back to screen capture
  if (!success) {
    try {
      // Initialize capture elements with selected resolution
      initCaptureElements();
      
      // Get available screen sources
      const sources = await ipcRenderer.invoke('get-sources');
      const mainSource = sources.find(source => source.name === 'Entire Screen' || source.name.includes('Screen 1'));
      
      if (!mainSource) {
        status.textContent = 'Error: Cannot find main display';
        status.style.color = 'red';
        selectBtn.disabled = false;
        return;
      }
      
      // Prompt user for screen sharing permission
      const constraints = {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: mainSource.id,
          }
        }
      };
      
      // Get the stream
      captureStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Set up video element
      video.srcObject = captureStream;
      video.onloadedmetadata = () => {
        video.play();
        
        // Start capture loop
        isCapturing = true;
        captureInterval = setInterval(captureAndSendFrame, 1000 / 30); // 30 FPS
      };
    } catch (error) {
      status.textContent = `Error: ${error.message}`;
      status.style.color = 'red';
      console.error('Error starting capture:', error);
      selectBtn.disabled = false;
      return;
    }
  }
  
  // Update UI
  stopBtn.disabled = false;
  resolutionSelect.disabled = true;
  windowSelect.disabled = true;
  detectWindowsBtn.disabled = true;
  status.textContent = 'Mirroring Active';
  status.style.color = '#4CAF50';
}

// Stop screen capture
function stopCapture() {
  isCapturing = false;
  
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }
  
  if (captureStream) {
    captureStream.getTracks().forEach(track => track.stop());
    captureStream = null;
  }
  
  // Update UI
  selectBtn.disabled = false;
  startBtn.disabled = !currentSelection;
  stopBtn.disabled = true;
  resolutionSelect.disabled = false;
  windowSelect.disabled = false;
  detectWindowsBtn.disabled = false;
  status.textContent = currentSelection ? 'Ready to Mirror' : 'Select an area to mirror';
  status.style.color = '#4CAF50';
}

// Detect available windows
async function detectWindows() {
  try {
    status.textContent = 'Detecting windows...';
    
    // Request window information from main process
    const windows = await ipcRenderer.invoke('get-windows');
    windowList = windows;
    
    // Clear and update window select dropdown
    windowSelect.innerHTML = '<option value="">Select a window to capture...</option>';
    
    windows.forEach((window, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = window.title;
      windowSelect.appendChild(option);
    });
    
    status.textContent = `Found ${windows.length} windows`;
  } catch (error) {
    status.textContent = `Error detecting windows: ${error.message}`;
    status.style.color = 'red';
    console.error('Error detecting windows:', error);
  }
}

// Update the selection display
function updateSelectionDisplay() {
  if (currentSelection) {
    const { x, y, width, height, windowName } = currentSelection;
    let displayText = `X: ${x}, Y: ${y}, Width: ${width}, Height: ${height} (${(width / height).toFixed(2)}:1)`;
    
    if (windowName) {
      displayText = `Window: "${windowName}" - ${displayText}`;
    }
    
    selectionCoords.textContent = displayText;
  } else {
    selectionCoords.textContent = 'None';
  }
}

// Handle selection result
function handleSelectionResult(selectionData) {
  currentSelection = selectionData;
  updateSelectionDisplay();
  startBtn.disabled = false;
  status.textContent = 'Ready to Mirror';
}

// Event Listeners
selectBtn.addEventListener('click', startSelection);
startBtn.addEventListener('click', startCapture);
stopBtn.addEventListener('click', stopCapture);
detectWindowsBtn.addEventListener('click', detectWindows);
windowSelect.addEventListener('change', (e) => setSelectionToWindow(e.target.value));
resolutionSelect.addEventListener('change', () => {
  if (isCapturing) {
    // Update resolution while capturing
    initCaptureElements();
  }
});

// Listen for selection results
ipcRenderer.on('selection-made', (event, selectionData) => {
  handleSelectionResult(selectionData);
});

// Listen for selection canceled
ipcRenderer.on('selection-canceled', () => {
  status.textContent = 'Selection canceled';
});

// Initialize the application
window.addEventListener('load', async () => {
  await getScreenInfo();
  initCaptureElements();
}); 