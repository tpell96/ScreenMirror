# Screen Mirror

A specialized screen mirroring application designed for users with ultrawide monitors (like 32:9) who want to mirror content to a standard 16:9 display.

## Purpose

This application solves the aspect ratio problem when mirroring from an ultrawide monitor to a standard display by:

1. Letting you select any region of your screen directly (like the Windows Snipping Tool)
2. Mirroring only that selected region to your secondary display

## Features

- Snipping Tool-like interface to select any area on your screen
- Optional 16:9 aspect ratio lock (toggle with 'A' key during selection)
- Window detection to automatically select application windows
- High-quality mirroring with output resolution options (1080p, 2K, 4K)
- Simple control panel interface
- Works with multiple monitor setups

## Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Run the application:
   ```
   npm start
   ```

## Usage

1. Start the application. A small control panel will appear.
2. Click "Select Screen Area" to open the screen selection tool.
3. Click and drag to select the area you want to mirror.
   - Press 'A' to toggle 16:9 aspect ratio lock while selecting
   - Press 'Esc' to cancel selection
4. After selecting an area, click "Start Mirroring" to begin mirroring to your secondary display.
5. Alternatively, click "Detect Windows" and select a window from the dropdown to automatically set the capture area.
6. Select your desired output resolution from the dropdown (1080p, 2K, or 4K).
7. Click "Stop Mirroring" when finished.

## Building for Distribution

To create an executable:

```
npm run build
```

## Requirements

- Windows, macOS, or Linux
- A multi-monitor setup (ideally a 32:9 primary and 16:9 secondary)
- Node.js and npm

## License

ISC 