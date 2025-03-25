# Screen Mirror

An Electron-based app that allows mirroring portions of your screen to another display, with flexible scaling and positioning options.

## Features

- Mirror your entire screen, a specific window, or a custom area to another display
- Select source and destination screens
- Scale output to 1080p, 1440p, or 4K resolution
- Capture specific windows with auto-detection
- Use area selection tool for custom regions
- Command line options for automation

## Usage

### GUI Method

1. Launch the app
2. Select a source screen from the dropdown menu
3. Select a destination screen where the mirrored content will be shown
4. Click "Start Mirroring" to begin
5. Use the "Select Screen Area" button to define a custom region to mirror
6. Use "Detect Windows" to capture a specific window

### Command Line Options

You can specify source and destination screens when launching the app:
```
electron . --source-screen=<screen-id> --dest-screen=<screen-id>
```

For example:
```
electron . --source-screen=1234567890 --dest-screen=9876543210
```

To find your screen IDs, launch the app normally first and hover over the screen options in the dropdown menu.

### Troubleshooting

If a specific screen goes black during mirroring:
- Try selecting a different output resolution
- Make sure both screens are active in your system settings
- Specify exact source and destination screens using the dropdown or command line options

## Installation

1. Clone this repository
2. Install dependencies with `npm install`
3. Run the app with `npm start`

## Building

To create a distributable package:
```
npm run make
```

## License

MIT 