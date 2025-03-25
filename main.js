const { app, BrowserWindow, ipcMain, screen, desktopCapturer } = require('electron');
const path = require('path');

let mainWindow;
let outputWindow = null;
let selectionWindow;

// Add command line arguments support for screen selection
const sourceScreenId = app.commandLine.getSwitchValue('source-screen');
const destScreenId = app.commandLine.getSwitchValue('dest-screen');

function createWindows() {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  
  // Create main control window
  mainWindow = new BrowserWindow({
    width: 800,
    height: 350, // Increased from 180 to 220 for more space
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
    title: 'Screen Mirror - Control',
    resizable: false,
  });

  mainWindow.loadFile('index.html');
  
  // Send initial configuration to renderer if screen IDs were provided
  if (sourceScreenId || destScreenId) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('initial-screen-config', {
        sourceScreenId,
        destScreenId
      });
    });
  }
  
  mainWindow.on('closed', () => {
    app.quit();
  });
}

// Create output window on the selected display
function createOutputWindow(screenId = null) {
  // Close existing output window if it exists
  if (outputWindow && !outputWindow.isDestroyed()) {
    outputWindow.close();
    outputWindow = null;
  }
  
  const displays = screen.getAllDisplays();
  
  // Determine which display to use for output
  let outputDisplay = null;
  
  if (screenId) {
    // If screen ID was specified, use that screen
    outputDisplay = displays.find(d => d.id.toString() === screenId.toString());
  } else if (destScreenId) {
    // If destination screen ID was specified via command line, use that screen
    outputDisplay = displays.find(d => d.id.toString() === destScreenId);
  } else {
    // Default behavior: use first non-primary display
    outputDisplay = displays.find(d => !d.isPrimary);
  }
  
  // If a display was found, create output window
  if (outputDisplay) {
    outputWindow = new BrowserWindow({
      x: outputDisplay.bounds.x,
      y: outputDisplay.bounds.y,
      width: outputDisplay.bounds.width,
      height: outputDisplay.bounds.height,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
      fullscreen: true,
      frame: false,
    });
    
    outputWindow.loadFile('output.html');
    console.log(`Created output window on screen ${outputDisplay.id} (${outputDisplay.bounds.width}x${outputDisplay.bounds.height})`);
    
    // Return the display info
    return outputDisplay;
  } else {
    // For testing: If no secondary display, create a simulated one
    outputWindow = new BrowserWindow({
      width: 1280,
      height: 720,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
      title: 'Screen Mirror - Output',
    });
    
    outputWindow.loadFile('output.html');
    console.log('Created test output window (no secondary display found)');
    
    // Return null for test window
    return null;
  }
}

// Create transparent selection window for snipping tool-like functionality
function createSelectionWindow(screenId = null) {
  // Determine which display to use for selection
  let selectionDisplay = screen.getPrimaryDisplay();
  
  // If a specific screen ID was provided, use that instead
  if (screenId) {
    const displays = screen.getAllDisplays();
    const targetDisplay = displays.find(d => d.id.toString() === screenId.toString());
    if (targetDisplay) {
      selectionDisplay = targetDisplay;
      console.log(`Creating selection window on screen ${screenId} at ${targetDisplay.bounds.x},${targetDisplay.bounds.y} (${targetDisplay.bounds.width}×${targetDisplay.bounds.height})`);
    }
  }
  
  // Create a transparent, frameless window covering the selected display
  selectionWindow = new BrowserWindow({
    x: selectionDisplay.bounds.x,
    y: selectionDisplay.bounds.y,
    width: selectionDisplay.bounds.width,
    height: selectionDisplay.bounds.height,
    transparent: true,
    frame: false,
    fullscreen: false, // Use exact positioning instead of fullscreen
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });
  
  selectionWindow.loadFile('selection.html');
  
  // Pass the screen information to the selection window
  selectionWindow.webContents.on('did-finish-load', () => {
    selectionWindow.webContents.send('set-screen-bounds', {
      x: selectionDisplay.bounds.x,
      y: selectionDisplay.bounds.y,
      width: selectionDisplay.bounds.width,
      height: selectionDisplay.bounds.height,
      scaleFactor: selectionDisplay.scaleFactor
    });
  });
  
  // Close the selection window when it loses focus (clicked outside)
  selectionWindow.on('blur', () => {
    selectionWindow.close();
    selectionWindow = null;
  });
  
  // Let main window know when the selection window is closed
  selectionWindow.on('closed', () => {
    mainWindow.webContents.send('selection-canceled');
  });
}

// Handle getting screen sources for capturing
ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({ 
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 }
  });
  return sources;
});

// Get detailed screen information
ipcMain.handle('get-screen-info', () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  return {
    id: primaryDisplay.id,
    width: primaryDisplay.bounds.width,
    height: primaryDisplay.bounds.height,
    workAreaWidth: primaryDisplay.workArea.width,
    workAreaHeight: primaryDisplay.workArea.height,
    scaleFactor: primaryDisplay.scaleFactor,
    bounds: primaryDisplay.bounds
  };
});

// Get aspect ratio lock status from main window
ipcMain.handle('get-aspect-lock-status', async () => {
  if (!mainWindow) return true; // Default to true
  
  try {
    // Ask the main window for the current lock status
    const result = await mainWindow.webContents.executeJavaScript(
      'document.getElementById("lockAspect").checked'
    );
    return result;
  } catch (error) {
    console.error('Error getting aspect lock status:', error);
    return true; // Default to true
  }
});

// Handle getting all screens
ipcMain.handle('get-all-screens', () => {
  const displays = screen.getAllDisplays();
  return displays.map(display => {
    // Get accurate screen information
    // Some screens might report logical resolution (scaled) rather than physical resolution
    const actualWidth = Math.round(display.bounds.width * display.scaleFactor);
    const actualHeight = Math.round(display.bounds.height * display.scaleFactor);
    
    // Include both logical and physical resolutions
    return {
      id: display.id,
      name: display.isPrimary ? 
            `Primary Screen (${display.bounds.width}×${display.bounds.height})` : 
            `Screen ${display.id.toString().slice(-4)} (${display.bounds.width}×${display.bounds.height})`,
      isPrimary: display.isPrimary,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      actualWidth,
      actualHeight,
      colorDepth: display.colorDepth,
      description: `${display.bounds.width}×${display.bounds.height} (scaled: ${actualWidth}×${actualHeight})`
    };
  });
});

// Handle creating output window when starting mirroring
ipcMain.handle('create-output-window', (event, screenId) => {
  const outputDisplay = createOutputWindow(screenId);
  return outputDisplay ? {
    id: outputDisplay.id,
    bounds: outputDisplay.bounds
  } : null;
});

// Handle setting destination screen
ipcMain.on('set-destination-screen', (event, screenId) => {
  // We'll no longer create the output window here, just store the ID
  // The output window will be created when mirroring starts
  console.log(`Destination screen set to: ${screenId} (window will be created when mirroring starts)`);
});

// Forward video frames from main window to output window
ipcMain.on('video-frame', (event, frameData) => {
  if (outputWindow && !outputWindow.isDestroyed()) {
    outputWindow.webContents.send('video-frame', frameData);
  }
});

// Handle closing the output window
ipcMain.on('close-output-window', () => {
  if (outputWindow && !outputWindow.isDestroyed()) {
    outputWindow.close();
    outputWindow = null;
    console.log('Output window closed');
  }
});

// Create selection window when requested by renderer
ipcMain.on('start-selection', (event, sourceScreenId) => {
  if (selectionWindow) {
    selectionWindow.focus();
  } else {
    createSelectionWindow(sourceScreenId);
  }
});

// Receive selection info from selection window
ipcMain.on('selection-made', (event, selectionData) => {
  // Forward selection to main window
  mainWindow.webContents.send('selection-made', selectionData);
  
  // Close selection window
  if (selectionWindow) {
    selectionWindow.close();
    selectionWindow = null;
  }
});

// Get all visible windows for selection
ipcMain.handle('get-windows', async () => {
  try {
    // Get window sources with thumbnails to identify them
    const sources = await desktopCapturer.getSources({ 
      types: ['window'],
      thumbnailSize: { width: 150, height: 150 }
    });
    
    const primaryDisplay = screen.getPrimaryDisplay();
    const displayWidth = primaryDisplay.bounds.width;
    const displayHeight = primaryDisplay.bounds.height;
    
    // Format the window information
    const windows = sources.map(source => {
      // For debugging - log raw window titles
      console.log(`Window: ${source.name}`);
      
      // For each window, compute a reasonable position
      // This approach gives each window a standard position rather than
      // trying to guess its actual position (which is unreliable)
      let bounds = {
        // Center the window on the screen with a reasonable size
        width: Math.floor(displayWidth * 0.6),
        height: Math.floor(displayHeight * 0.6),
        x: Math.floor(displayWidth * 0.2),
        y: Math.floor(displayHeight * 0.2)
      };
      
      // If thumbnail exists, use its aspect ratio to adjust the height
      if (source.thumbnail) {
        try {
          const aspectRatio = source.thumbnail.getAspectRatio();
          bounds.height = Math.floor(bounds.width / aspectRatio);
          
          // Recenter vertically
          bounds.y = Math.floor((displayHeight - bounds.height) / 2);
        } catch (err) {
          console.error('Error calculating aspect ratio:', err);
        }
      }
      
      return {
        id: source.id,
        name: source.name,
        title: source.name,
        thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
        display: 'Primary',
        bounds: bounds
      };
    });
    
    return windows;
  } catch (error) {
    console.error('Error getting windows:', error);
    return [];
  }
});

// Try to extract window bounds from title
function extractBoundsFromTitle(title) {
  try {
    // Check if the title contains coordinates
    // Format might be like "Window Title - 123x456+78+90"
    const regex = /(\d+)x(\d+)\+(\d+)\+(\d+)/;
    const match = title.match(regex);
    
    if (match) {
      return {
        width: parseInt(match[1]),
        height: parseInt(match[2]),
        x: parseInt(match[3]),
        y: parseInt(match[4])
      };
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// Estimate window bounds based on common window sizes
function guessBoundsFromWindowId(id) {
  const displaySize = screen.getPrimaryDisplay().workAreaSize;
  const estimatedSizes = [
    // Common app window sizes
    { width: 1280, height: 720 },   // 720p window
    { width: 1024, height: 768 },   // Standard window
    { width: 800, height: 600 },    // Small window
    { width: displaySize.width * 0.7, height: displaySize.height * 0.8 } // Large window
  ];
  
  // Use the window ID as a seed for consistent random generation
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const rand = (max) => Math.floor((hash % 100) / 100 * max);
  
  // Pick a size based on the hash
  const sizeIndex = rand(estimatedSizes.length);
  const size = estimatedSizes[sizeIndex];
  
  // Estimate position to not overlap with screen edges
  const maxX = displaySize.width - size.width;
  const maxY = displaySize.height - size.height;
  
  return {
    x: rand(maxX),
    y: rand(maxY),
    width: size.width,
    height: size.height
  };
}

app.whenReady().then(createWindows);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindows();
  }
}); 