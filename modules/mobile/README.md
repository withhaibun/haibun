# @haibun/mobile

Mobile testing stepper for Haibun.

## Prerequisites

### Android
- Android Studio with Android SDK
- Android emulator or device

### iOS (macOS only)
- Xcode with Command Line Tools
- iOS Simulator or device

### Appium drivers

`npx appium driver install uiautomator2`
`npx appium driver install xcuitest`

## Overview

Tests mobile apps using Appium/WebDriverIO. Elements are located using domain-based selectors (e.g., `mobile-testid`, `mobile-xpath`, `mobile-accessibility`) defined in background files.

Available steps can be discovered with `haibun --show-steppers`.

## Configuration

Configure via environment variables with format `HAIBUN_O_HAIBUNMOBILESTEPPER_<OPTION>=value`

### Platform Selection

**Android:**
- `PLATFORMNAME=Android`
- `APP_PACKAGE` - Package identifier (e.g., com.example.app)
- `APP_ACTIVITY` - Activity to launch (e.g., .MainActivity)
- `AUTOMATION_NAME=UiAutomator2`

**iOS:**
- `PLATFORMNAME=iOS`
- `APP_BUNDLE_ID` - Bundle identifier (e.g., com.example.app)
- `AUTOMATION_NAME=XCUITest`

### Device & Connection

- `DEVICE_NAME` - Emulator/simulator/device name (default: auto-detected)
- `UDID` - Device UDID for physical devices
- `APPIUM_HOST` - Appium server host (default: 127.0.0.1)
- `APPIUM_PORT` - Appium server port (default: 4723)

### App Installation

Use either installed app (via package/bundle ID) or install from file:

- `APP` - Path to .apk (Android) or .app (iOS) to install

### Behavior

- `TIMEOUT` - Element wait timeout in ms (default: 15000)
- `RESET_BEHAVIOR` - App reset between scenarios: `none`, `reset` (default)
- `STORAGE` - Required storage stepper name

### Example: Android

```bash
export HAIBUN_O_HAIBUNMOBILESTEPPER_PLATFORMNAME=Android
export HAIBUN_O_HAIBUNMOBILESTEPPER_APP_PACKAGE=com.haibuntest.expornapp
export HAIBUN_O_HAIBUNMOBILESTEPPER_APP_ACTIVITY=.MainActivity
export HAIBUN_O_HAIBUNMOBILESTEPPER_AUTOMATION_NAME=UiAutomator2
export HAIBUN_O_HAIBUNMOBILESTEPPER_STORAGE=STORAGEFS
```

### Example: iOS

```bash
export HAIBUN_O_HAIBUNMOBILESTEPPER_PLATFORMNAME=iOS
export HAIBUN_O_HAIBUNMOBILESTEPPER_APP_BUNDLE_ID=com.haibuntest.expornapp
export HAIBUN_O_HAIBUNMOBILESTEPPER_AUTOMATION_NAME=XCUITest
export HAIBUN_O_HAIBUNMOBILESTEPPER_STORAGE=STORAGEFS
```

## Example

See `expo-rn-app/` for test application and `tests/` for feature files.
