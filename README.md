# AlarmDuration — Lyrion Music Server Plugin

A plugin for [Lyrion Music Server (LMS)](https://lyrion.org) that adds per-alarm duration and volume settings.

## The Problem

LMS's built-in alarm system is great, but it has two limitations:

- **Duration:** Each player has a single fixed sleep duration that applies to all of its alarms. If the kitchen radio is set to 45 minutes, every alarm on that player — regardless of the time or day — will play for exactly 45 minutes before stopping. You cannot set one alarm to play for 30 minutes and another to play for 2 hours on the same player.
- **Volume:** Similarly, each player has a single default alarm volume. Every alarm on that player plays at the same level.

This means if you have multiple alarms on the same player — for example a weekday morning alarm and a weekend alarm — they will always play for the same duration and at the same volume.

## The Solution

AlarmDuration lets you set an individual **duration** and **volume** for each alarm on each player. When an alarm fires, the plugin:

1. Sets the player volume to the alarm's configured level
2. Schedules the player to power off after the alarm's configured duration
3. Restores the player's previous volume level when it powers off

## Features

- Per-alarm play duration (in minutes)
- Per-alarm volume level (0–100)
- Volume restore after alarm ends
- Settings page accessible from Material Skin via the player menu
- Duration and volume fields injected directly into Material Skin's Add/Edit Alarm dialog
- Works with any LMS player (Squeezelite, piCorePlayer, hardware Squeezebox devices)
- No external dependencies — uses only LMS internal APIs

## Requirements

- Lyrion Music Server 8.0 or later
- [Material Skin](https://github.com/CDrummond/lms-material) (recommended, for best UI integration)

## Installation

### Manual Installation

1. Copy the `AlarmDuration` folder to your LMS plugins directory:
   ```
   /var/lib/squeezeboxserver/Plugins/AlarmDuration/
   ```

2. Add the plugin directory to your LMS startup options. Edit `/etc/default/lyrionmusicserver`:
   ```
   SLIMOPTIONS="--quiet --plugindir /var/lib/squeezeboxserver/Plugins"
   ```

3. Restart LMS:
   ```bash
   sudo systemctl restart lyrionmusicserver
   ```

4. Verify the plugin is loaded in LMS under **Settings → Plugins**.

### Material Skin Integration (Optional but Recommended)

Two additional files enhance the experience in Material Skin:

**1. Add to player menu** — copy `material-skin/actions.json` to:
```
/var/lib/squeezeboxserver/prefs/material-skin/actions.json
```

Edit the file and replace `your-lms-hostname` with your LMS server hostname or IP address.

**2. Inject fields into alarm dialog** — copy `material-skin/custom.js` to:
```
/var/lib/squeezeboxserver/prefs/material-skin/custom.js
```

This adds Duration and Volume fields directly into Material Skin's Add/Edit Alarm popup.

## Usage

### Setting Duration and Volume

**Via the settings page (classic skin or Material Skin iframe):**

Navigate to **Settings → Plugins → Alarm Duration**, or click **Alarm Duration & Volume** in the player menu in Material Skin. You'll see all configured alarms for the selected player with Duration and Volume fields for each.

**Via the alarm dialog (Material Skin):**

When adding or editing an alarm in Material Skin's player settings, Duration (mins) and Volume fields appear below the Repeat toggle.

### How It Works

Set your alarms normally in LMS. Then use the Alarm Duration settings to assign a duration and volume to each alarm. When the alarm fires, the plugin automatically applies your settings.

If no duration is set for an alarm, it will play indefinitely (or until the global LMS sleep timer, if configured). If no volume is set, the player's current volume is used.

## Security

This plugin is self-contained and safe to use:

- Makes no external network calls
- Uses only LMS's internal Perl APIs
- Validates all user input before saving
- Uses LMS's built-in CSRF protection on the settings page
- Executes no shell commands or external binaries
- Has no third-party dependencies beyond core LMS modules

## File Structure

```
AlarmDuration/
├── install.xml          # Plugin manifest
├── Plugin.pm            # Core plugin logic
├── Settings.pm          # Web settings page handler
├── strings.txt          # Localisation strings
└── HTML/
    └── EN/
        └── plugins/
            └── AlarmDuration/
                └── settings/
                    └── basic.html   # Settings page template

material-skin/
├── actions.json         # Adds plugin to Material Skin player menu
└── custom.js            # Injects fields into Material Skin alarm dialog
```

## Tested With

- Lyrion Music Server 9.1.0
- Raspberry Pi OS (aarch64)
- Squeezelite / piCorePlayer endpoints
- Material Skin 6.3.2
- Internet radio streams (BBC Sounds, Absolute Radio)

## Known Issues

- The Duration and Volume fields injected into the Material Skin alarm dialog are visible but saving from the dialog is not yet fully implemented. Use the Alarm Duration settings page (accessible via the player menu) to set values after creating an alarm.

## Contributing

Contributions welcome — please open an issue or pull request.

## Licence

MIT
