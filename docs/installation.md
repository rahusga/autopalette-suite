# Installation

This guide explains how to install **AutoPalette Studio** in PixInsight.

## Requirements

- PixInsight 1.8.9 or later.
- A local folder where you keep third-party PixInsight scripts.
- AutoPalette Studio script file:
  - `AutoPalette_Studio.js`

## Recommended folder layout

You can keep the script in any local folder. A practical structure is:

```text
PixInsightScripts/
└─ AutoPaletteStudio/
   └─ AutoPalette_Studio.js
```

Avoid keeping the script only inside a compressed `.zip` file. PixInsight must be able to read the `.js` file directly from disk.

## Manual installation

1. Download the latest AutoPalette Studio release from GitHub.
2. Extract the release package if it is provided as a `.zip` file.
3. Copy `AutoPalette_Studio.js` to your preferred PixInsight scripts folder.
4. Open PixInsight.
5. Go to:

```text
SCRIPT > Feature Scripts...
```

6. Click **Add** and select the folder containing `AutoPalette_Studio.js`.
7. Click **Done** or **OK** to rescan the scripts.
8. AutoPalette Studio should appear in the PixInsight script menu, usually under:

```text
SCRIPT > Astrocitas > AutoPalette Studio
```

The exact menu location depends on the `#feature-id` declared inside the script.

## Updating manually

To update an existing manual installation:

1. Close PixInsight.
2. Replace the old `AutoPalette_Studio.js` file with the new version.
3. Reopen PixInsight.
4. If the script does not appear updated, run:

```text
SCRIPT > Feature Scripts...
```

and rescan the folder containing the script.

## PixInsight update repository

A PixInsight update repository can be used for easier installation and updates when available.

When a repository URL is published:

1. Open PixInsight.
2. Go to:

```text
Resources > Updates > Manage Repositories
```

3. Add the AutoPalette Studio repository URL.
4. Run:

```text
Resources > Updates > Check for Updates
```

5. Install or update the package from the update dialog.

## Troubleshooting

### The script does not appear in the menu

Check that:

- The `.js` file is not inside a compressed archive.
- The folder containing the script has been added with **Feature Scripts**.
- PixInsight has permission to read the folder.
- The script file has not been renamed with an unexpected extension such as `.txt`.

### PixInsight reports a syntax error

Make sure you downloaded the latest release file and not an incomplete copy from the browser. If the problem persists, open the PixInsight console and report the complete error message, including the line number.

### The script appears more than once

This usually means that several copies of the script are installed in different folders. Remove old copies or disable the duplicated script folders from **Feature Scripts**.

## Uninstalling

To uninstall AutoPalette Studio:

1. Remove `AutoPalette_Studio.js` from your local scripts folder, or remove the folder from PixInsight **Feature Scripts**.
2. Restart PixInsight or rescan the script directories.
