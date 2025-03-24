const { app, BrowserWindow, ipcMain, screen, desktopCapturer } = require('electron');
const path = require('path');

let mainWindow;
let outputWindow;
let selectionWindow;

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
  
  // Find secondary display (16:9 TV)
  const secondaryDisplay = displays.find(d => !d.isPrimary);
  
  // If there's a secondary display, create output window on it
  if (secondaryDisplay) {
    outputWindow = new BrowserWindow({
      x: secondaryDisplay.bounds.x,
      y: secondaryDisplay.bounds.y,
      width: secondaryDisplay.bounds.width,
      height: secondaryDisplay.bounds.height,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
      fullscreen: true,
      frame: false,
    });
    
    outputWindow.loadFile('output.html');
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
  }
  
  mainWindow.on('closed', () => {
    app.quit();
  });
}

// Create transparent selection window for snipping tool-like functionality
function createSelectionWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  
  // Create a transparent, frameless window covering the entire primary display
  selectionWindow = new BrowserWindow({
    x: primaryDisplay.bounds.x,
    y: primaryDisplay.bounds.y,
    width: primaryDisplay.bounds.width,
    height: primaryDisplay.bounds.height,
    transparent: true,
    frame: false,
    fullscreen: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });
  
  selectionWindow.loadFile('selection.html');
  
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

// Create selection window when requested by renderer
ipcMain.on('start-selection', () => {
  if (selectionWindow) {
    selectionWindow.focus();
  } else {
    createSelectionWindow();
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

// Forward video frames from main window to output window
ipcMain.on('video-frame', (event, frameData) => {
  if (outputWindow && !outputWindow.isDestroyed()) {
    outputWindow.webContents.send('video-frame', frameData);
  }
});

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