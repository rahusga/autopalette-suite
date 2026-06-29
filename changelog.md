# Changelog

## [1.0.8] - 2026-06-29

This release expands the Advanced workflow with a new Channel Lightness tool and several UI refinements based on tester feedback.

### Added
- Added **Channel Lightness** as a new Apply-only Advanced layer.
- Channel Lightness can use **Ha**, **SII** or **OIII** as the lightness source.
- Added a compact `gears` icon to the **Create Previews** button.

### Changed
- Advanced Controls are now ordered as **Channel Lightness**, **Gold Accent**, then **Structure Lift**.
- Advanced source selectors now use the order **Ha / SII / OIII**, with **Ha** as the default source.
- Channel Lightness response has been strengthened after tester validation.
- Generate Final Image has been restored to a standard button layout.
- Advanced Apply now more strictly follows the intended processing order: base palette, mask protection, Boosted controls, then Advanced layers.

### Fixed
- Improved consistency when applying Advanced layers after changing Boosted controls.
- Preserved the Apply-only behavior for computationally expensive Advanced operations.


## [1.0.7] - 2026-06-21

### Changed
- Preview quality now defaults to Balanced, providing sharper previews while keeping the workflow responsive.
- Changing preview quality now rebuilds preview sources and caches more safely, avoiding stale previews or mixed-resolution states.
- Advanced Controls return to a manual Apply-only workflow for better responsiveness and predictability.
- Added a clearer hint next to the Advanced Apply button to indicate that Advanced changes are applied after pressing Apply.

### Fixed
- Improved Advanced Undo/Redo state restoration, especially when using Structure Lift.
- Prevented preview-quality changes from resetting or corrupting active Boosted/Advanced control states.
- Improved consistency between the selected preview and the generated final image.

## [1.0.6] - 2026-06-21

### Added
- Added PixInsight reference documentation for AutoPalette Studio.
- Added integrated documentation access from the script interface.

## [1.0.1-5] - 2026-06-20

### Fixed
- Classic SHO moved to advanced combinations; Masks closed by default.
- Cosmetic Presets locked until previews are available.
- Boosted, Advanced and Mask controls locked until a preview is loaded.
- UX: Advanced starts collapsed and initial dialog width is compact.
- Per: cache mask preview bitmaps.

## [1.0.0] - 2026-06-20

### Added
- First public release of AutoPalette Studio.
- Interactive workflow for narrowband palette generation.
- Support for OSC dual-band and monochrome narrowband sources.
- Preview generation with real-time tone and color controls.
- Boosted palette variants.
- Advanced controls for refined color emphasis.
- Full-resolution final image generation.

### Changed
- Reworked user interface for a production-ready Studio workflow.
- Improved preview/final image consistency.
- Optimized preview calculation and intermediate image handling.

### Fixed
- Improved handling of linear and non-linear images.
- Improved cleanup of intermediate views.
- Reduced preview mismatch in final generated images.
