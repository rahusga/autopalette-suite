# AutoPalette Studio

**AutoPalette Studio** is a PixInsight script designed to create and explore narrowband color palettes from OSC dual-band images or monochrome narrowband channels.

It provides an interactive workflow to generate HOO, SHO and creative narrowband palettes like Foraxx, with real-time previews, boosted variants and advanced color controls.

## Main Features

- Interactive palette generation inside PixInsight.
- Support for OSC dual-band images and monochrome narrowband channels.
- HOO, SHO and creative narrowband palette workflows.
- Real-time preview with tone and color controls.
- Boosted palette variants.
- Advanced controls for gold/cyan balance and local color emphasis.
- Designed for linear and non-linear workflows.
- Clean generation of final full-resolution images.

## Requirements

- PixInsight 1.8.9 or later.
- JavaScript Runtime compatible with PixInsight PJSR.
- Input data:
  - OSC dual-band image, or
  - separated Ha, OIII and optional SII monochrome channels.

## Installation

### Manual installation

1. Download `AutoPalette_Studio.js` from the latest release.
2. Copy it to your PixInsight scripts folder.
3. Open PixInsight.
4. Go to `SCRIPT > Feature Scripts...`
5. Click `Add` and select the folder containing the script.
6. Run AutoPalette Studio from the script menu.

### PixInsight update repository

A PixInsight update repository will be provided in a future release.

## Basic Workflow

1. Select your source image or narrowband channels.
2. Configure the palette mode.
3. Generate previews.
4. Adjust tone and color controls.
5. Optionally enable boosted or advanced settings.
6. Generate the final full-resolution image.

## Recommended Input Preparation

For best results, images should be calibrated, registered, integrated and background-corrected before using AutoPalette Studio.

Linear images are supported. The script can generate suitable previews while preserving the intended processing workflow.

## License

This project is distributed under the terms of the selected open-source license. See [LICENSE](LICENSE).

## Author

This script was developed by **Raúl Hussein**.

Astrocitas YouTube Channel: https://www.youtube.com/@astrocitas  
Instagram: https://www.instagram.com/rahusga/

## Acknowledgements

AutoPalette Studio evolved from previous AutoPalette experiments and was inspired by dynamic narrowband palette workflows used by the astrophotography community.

## Disclaimer

This script is provided as-is, without warranty. Always test new versions with copies of your data before using them in production workflows.