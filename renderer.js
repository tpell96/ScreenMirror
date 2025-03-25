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
const sourceScreenSelect = document.getElementById('sourceScreenSelect');
const destScreenSelect = document.getElementById('destScreenSelect');
const savePrefsBtn = document.getElementById('savePrefsBtn');
const loadPrefsBtn = document.getElementById('loadPrefsBtn');

// State variables
let isCapturing = false;
let captureStream = null;
let captureInterval = null;
let captureCanvas, captureCtx, video;
let windowList = [];
let screenInfo = null;
let screenList = [];
let currentSelection = null;

// Preferences storage key
const PREFERENCES_KEY = 'screenMirrorPreferences';

// Save preferences
function savePreferences() {
  const preferences = {
    sourceScreen: sourceScreenSelect.value,
    destinationScreen: destScreenSelect.value,
    resolution: resolutionSelect.value,
    lockAspect: lockAspect.checked,
    windowSelection: windowSelect.value
  };
  
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  status.textContent = 'Preferences saved';
  setTimeout(() => {
    status.textContent = 'Select a screen to mirror';
  }, 2000);
}

// Load preferences
function loadPreferences() {
  const savedPrefs = localStorage.getItem(PREFERENCES_KEY);
  if (!savedPrefs) {
    status.textContent = 'No saved preferences found';
    setTimeout(() => {
      status.textContent = 'Select a screen to mirror';
    }, 2000);
    return;
  }
  
  try {
    const preferences = JSON.parse(savedPrefs);
    
    // Set source screen
    if (preferences.sourceScreen) {
      sourceScreenSelect.value = preferences.sourceScreen;
      handleSourceScreenSelection();
    }
    
    // Set destination screen
    if (preferences.destinationScreen) {
      destScreenSelect.value = preferences.destinationScreen;
    }
    
    // Set resolution
    if (preferences.resolution) {
      resolutionSelect.value = preferences.resolution;
    }
    
    // Set aspect ratio lock
    if (typeof preferences.lockAspect === 'boolean') {
      lockAspect.checked = preferences.lockAspect;
    }
    
    // Set window selection if exists
    if (preferences.windowSelection) {
      windowSelect.value = preferences.windowSelection;
      setSelectionToWindow(preferences.windowSelection);
    }
    
    status.textContent = 'Preferences loaded';
    setTimeout(() => {
      status.textContent = 'Select a screen to mirror';
    }, 2000);
  } catch (error) {
    console.error('Error loading preferences:', error);
    status.textContent = 'Error loading preferences';
    setTimeout(() => {
      status.textContent = 'Select a screen to mirror';
    }, 2000);
  }
}

// Add event listeners for preference buttons
savePrefsBtn.addEventListener('click', savePreferences);
loadPrefsBtn.addEventListener('click', loadPreferences);

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
  // Check if we have a source screen selected
  const sourceScreenId = sourceScreenSelect.value;
  if (!sourceScreenId) {
    status.textContent = 'Please select a source screen first';
    status.style.color = 'red';
    return;
  }
  
  // Send message to main process to create selection window on the source screen
  ipcRenderer.send('start-selection', sourceScreenId);
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

// Get all available screens
async function getAllScreens() {
  try {
    screenList = await ipcRenderer.invoke('get-all-screens');
    
    // Populate source screen dropdown
    sourceScreenSelect.innerHTML = '<option value="">Select Source Screen...</option>';
    screenList.forEach((screen, index) => {
      const option = document.createElement('option');
      option.value = screen.id;
      option.textContent = `${screen.isPrimary ? 'Primary: ' : ''}${screen.description}`;
      option.title = `Screen ID: ${screen.id}, Scale: ${screen.scaleFactor}x`;
      sourceScreenSelect.appendChild(option);
    });
    
    // Populate destination screen dropdown
    destScreenSelect.innerHTML = '<option value="">Select Destination Screen...</option>';
    screenList.forEach((screen, index) => {
      const option = document.createElement('option');
      option.value = screen.id;
      option.textContent = `${screen.isPrimary ? 'Primary: ' : ''}${screen.description}`;
      option.title = `Screen ID: ${screen.id}, Scale: ${screen.scaleFactor}x`;
      destScreenSelect.appendChild(option);
    });
    
    // Load preferences after populating screens
    loadPreferences();
    
    console.log('Available screens:', screenList);
  } catch (error) {
    console.error('Error getting screens:', error);
  }
}

// Handle selection of source screen
function handleSourceScreenSelection() {
  const screenId = sourceScreenSelect.value;
  if (!screenId) return;
  
  const selectedScreen = screenList.find(s => s.id.toString() === screenId);
  if (!selectedScreen) return;
  
  // Store current selection based on the entire screen
  currentSelection = {
    x: 0,
    y: 0,
    width: selectedScreen.bounds.width,
    height: selectedScreen.bounds.height,
    screenId: selectedScreen.id
  };
  
  // Update UI with selection info
  updateSelectionDisplay();
  
  // Enable start button
  startBtn.disabled = false;
  status.textContent = `Ready to Mirror: ${selectedScreen.name}`;
}

// Handle screen selection change
sourceScreenSelect.addEventListener('change', handleSourceScreenSelection);

// Start screen capture for a specific screen
async function startCaptureScreen(screenId) {
  try {
    // Initialize capture elements with selected resolution
    initCaptureElements();
    
    // Get available screen sources
    const sources = await ipcRenderer.invoke('get-sources');
    
    // Find the source for the selected screen
    // Note: screen IDs from Electron don't directly match desktopCapturer IDs,
    // so we need to match by screen number or name
    const screenNumber = screenList.findIndex(s => s.id.toString() === screenId) + 1;
    const screenSource = sources.find(source => 
      source.name === `Screen ${screenNumber}` || 
      source.name === 'Entire Screen' ||
      source.name.includes(`Screen ${screenNumber}`)
    );
    
    if (!screenSource) {
      console.error(`Could not find screen source for screen ID: ${screenId}`);
      return false;
    }
    
    // Prompt user for screen sharing permission
    const constraints = {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: screenSource.id,
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
    
    return true;
  } catch (error) {
    console.error('Error capturing screen:', error);
    return false;
  }
}

// Modify startCapture to create the output window first
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
  
  // First create the output window on the destination screen
  const destScreen = destScreenSelect.value;
  if (!destScreen) {
    status.textContent = 'Please select a destination screen first';
    status.style.color = 'red';
    selectBtn.disabled = false;
    startBtn.disabled = false;
    return;
  }
  
  try {
    // Create the output window on the selected destination screen
    await ipcRenderer.invoke('create-output-window', destScreen);
    
    // Small delay to let the output window initialize
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Now proceed with capture
    let success = false;
    
    // If we have a screenId, try to capture that specific screen
    if (currentSelection.screenId) {
      console.log(`Attempting to capture screen: ${currentSelection.screenId}`);
      success = await startCaptureScreen(currentSelection.screenId);
    }
    // If we have a window ID, try to capture that specific window
    else if (currentSelection.windowId) {
      console.log(`Attempting to capture window: ${currentSelection.windowName}`);
      success = await startCaptureWindow(currentSelection.windowId);
    }
    
    // If specific capture failed or we don't have a specific target, fall back to screen capture
    if (!success) {
      // Existing fallback code
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
    
  } catch (error) {
    status.textContent = `Error creating output window: ${error.message}`;
    status.style.color = 'red';
    console.error('Error creating output window:', error);
    selectBtn.disabled = false;
    startBtn.disabled = false;
  }
}

// Update stopCapture to handle closing the output window
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
  
  // Signal main process to close the output window
  ipcRenderer.send('close-output-window');
  
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

// Update UI to display current selection
function updateSelectionDisplay() {
  if (!currentSelection) {
    selectionCoords.textContent = 'None';
    return;
  }
  
  // If we have a selected screen
  if (currentSelection.screenId) {
    const selectedScreen = screenList.find(s => s.id.toString() === currentSelection.screenId.toString());
    if (selectedScreen) {
      const { bounds, actualWidth, actualHeight, scaleFactor } = selectedScreen;
      selectionCoords.textContent = `Screen: ${selectedScreen.isPrimary ? 'Primary' : 'Secondary'} - ` +
        `${bounds.width}×${bounds.height} (${actualWidth}×${actualHeight} @ ${scaleFactor}x scale)`;
    } else {
      selectionCoords.textContent = `Screen ID ${currentSelection.screenId} - Full Screen`;
    }
    return;
  }
  
  // If we have a selected window
  if (currentSelection.windowId) {
    selectionCoords.textContent = `Window: ${currentSelection.windowName} - ${currentSelection.width}×${currentSelection.height}`;
    return;
  }
  
  // Otherwise, display area coordinates
  selectionCoords.textContent = `Area: ${currentSelection.x},${currentSelection.y} (${currentSelection.width}×${currentSelection.height})`;
}

// Handle selection result
function handleSelectionResult(selectionData) {
  // If the selection includes screen coordinates, use them to calculate the absolute position
  // This makes the selection coordinates correct regardless of which screen it was made on
  if (selectionData.screenX !== undefined && selectionData.screenY !== undefined) {
    // Adjust coordinates to be relative to the entire desktop
    selectionData.x += selectionData.screenX;
    selectionData.y += selectionData.screenY;
  }
  
  console.log('Selection data:', selectionData);
  
  // Store the selection
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

// Handle destination screen selection
destScreenSelect.addEventListener('change', () => {
  const screenId = destScreenSelect.value;
  if (!screenId) return;
  
  const selectedScreen = screenList.find(s => s.id.toString() === screenId);
  if (!selectedScreen) return;
  
  // Only update the status - don't create output window yet
  status.textContent = `Destination set to: ${selectedScreen.name}`;
});

// Add to setup event listeners
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize
  await getScreenInfo();
  await getAllScreens();
  
  // Check for initial configuration from main process
  ipcRenderer.on('initial-screen-config', (event, config) => {
    if (config.sourceScreenId) {
      sourceScreenSelect.value = config.sourceScreenId;
      handleSourceScreenSelection();
    }
    
    if (config.destScreenId) {
      destScreenSelect.value = config.destScreenId;
      // Trigger destination screen selection event but don't create output window yet
      const changeEvent = new Event('change');
      destScreenSelect.dispatchEvent(changeEvent);
    }
    
    // Don't auto-start capture - let user explicitly start it
    status.textContent = 'Ready to start mirroring';
  });
  
  // ... existing event listeners ...
}); 