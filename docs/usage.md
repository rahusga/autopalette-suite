# Usage

**AutoPalette Studio** is a PixInsight script for creating and exploring narrowband color palettes from OSC dual-band data or monochrome narrowband channels.

It is designed as an interactive palette studio: select the source data, generate previews, refine tone and color, and then create the final full-resolution image.

## Recommended input data

For best results, start from calibrated and integrated data.

Recommended preprocessing before using AutoPalette Studio:

1. Calibration, registration and integration.
2. Gradient or background correction.
3. Channel extraction if working from separated narrowband channels.
4. Optional noise reduction before palette creation, depending on your workflow.

AutoPalette Studio can work with linear and non-linear images. Linear images are supported through preview-oriented auto-stretch behavior so that palettes can be evaluated visually without requiring a permanent stretch before using the script.

## Supported workflows

### OSC dual-band workflow

Use this mode when starting from a color OSC image acquired with a dual-band or multi-band filter.

Typical examples:

- Hα + OIII dual-band data.
- Data previously separated into Hα and OIII channels with another extraction tool.
- OSC narrowband images prepared for HOO-style palettes.

### Monochrome narrowband workflow

Use this mode when working with separate monochrome channels:

- Hα / Ha
- OIII
- SII, optional depending on the selected palette

This mode is suitable for classic SHO, HOO and creative narrowband combinations.

## Basic workflow

### 1. Select Image

Choose the source image or channel views that AutoPalette Studio will use.

Depending on the workflow, this can be:

- A color OSC image.
- Separated Hα and OIII channels.
- Separated Hα, OIII and SII channels.

If a required channel is missing, some palette modes may be disabled or internally adapted.

### 2. Palette configuration

Select the palette family or combination mode.

Common options include:

- HOO-style palettes.
- SHO-style palettes.
- Creative narrowband palettes.
- Palette variants designed to emphasize cyan, gold or mixed narrowband structures.

The available options can depend on whether SII data is available.

### 3. Create Previews

Generate preview candidates before creating the final image.

The preview stage is intended for fast visual exploration. Use it to compare palette candidates, evaluate contrast, and decide which rendering direction works best for the target.

### 4. Boosted

The Boosted section provides stronger variants of the selected palette style.

Use it when the initial palette is too conservative or when you want a more expressive color separation between nebular structures.

Boosted variants are especially useful for social/web presentation, but they should still be checked carefully to avoid clipping or excessive saturation in bright regions.

### 5. Advanced

The Advanced section provides finer control over the final palette behavior.

Typical uses:

- Increase or reduce gold/cyan emphasis.
- Refine the color balance after preview generation.
- Adjust the visual separation between emission structures.
- Fine-tune the final image before full-resolution generation.

Advanced controls should be applied progressively. Small changes can produce significant visual differences, especially with already stretched data.

### 6. Generate

Once the preview looks correct, generate the final full-resolution image.

The generated image is created as a new PixInsight view. The original source images are not modified.

## Linear versus non-linear data

AutoPalette Studio supports both linear and non-linear workflows.

For linear images, the preview is intended to be visually meaningful while preserving a practical palette exploration workflow. The final result should still be reviewed as part of your normal PixInsight processing sequence.

For non-linear images, the preview and final generation are intended to be visually closer, since the input data already contains a permanent stretch.

## Practical recommendations

- Start with clean background-corrected data.
- Avoid strong clipping before palette generation.
- Compare several previews before generating the final image.
- Use Boosted and Advanced controls only after selecting a good base palette.
- Keep the original channels open until you have verified the final result.
- Save the final image with a descriptive name that includes the palette type.

## Output images

AutoPalette Studio creates new PixInsight views for generated previews and final images.

Intermediate views may be created during processing and are normally managed automatically by the script. The script is designed to avoid modifying the original source views.

## Limitations

- The quality of the generated palette depends strongly on the quality and balance of the input channels.
- Very weak SII or OIII data may require additional manual processing after palette generation.
- Strong gradients, residual background, clipped highlights or aggressive previous stretching can reduce palette quality.
- Creative palettes are aesthetic tools and should not be interpreted as physically calibrated color representations.

## Suggested workflow after generation

After creating the final image, continue with your normal PixInsight processing workflow, for example:

1. Histogram or curves refinement.
2. Color saturation adjustment.
3. Local contrast enhancement.
4. Star reduction or star recombination, if applicable.
5. Final noise reduction and sharpening.

AutoPalette Studio is intended to help with palette creation and color exploration, not to replace the complete image processing workflow.
