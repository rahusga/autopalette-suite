/******************************************************************************
 * AutoPalette Studio version 1.1.0 (Jun 2026)
 *
 * Visual narrowband palette studio for PixInsight.
 * Creates and compares HOO/SHO/Foraxx-inspired palettes from OSC dualband
 * images or mono Ha/OIII/SII sources, with fast previews, full-resolution
 * final output, boosted/advanced apply layers and mask-assisted refinement.
 *
 * Developed by Raúl Hussein.
 * Inspired by Marcelo Muñoz dynamic Foraxx PixelMath combinations.
 *
 * Release notes:
 * 1.0 - First production release of AutoPalette Studio.
 *       Studio UI, base palette previews, Cosmetic Presets, Boosted Apply/Undo/Redo,
 *       Advanced Apply/Undo/Redo, mask protection, linear-input preview/final parity,
 *       selectable preview quality, output-id control and temporary-view cleanup.
 * 1.0.1 - Hotfix: Classic SHO moved to advanced combinations; Masks closed by default.
 * 1.0.2 - Hotfix: Cosmetic Presets locked until previews are available.
 * 1.0.3 - Hotfix: Boosted, Advanced and Mask controls locked until a preview is loaded.
 * 1.0.4 - UX: Advanced starts collapsed and initial dialog width is compact.
 * 1.0.4.1 - UI: Advanced combination preview rows use the same aligned grid layout.
 * 1.0.5 - Perf/UI: cache mask preview bitmaps and align large preview width to the thumbnail grid.
 * 1.0.6 - UI: add documentation button and Suite Astrocitas SVG feature icon.
 * 1.0.7 - Tester build: Balanced preview by default, safer preview-quality
 *       rebuilds, improved Advanced Undo/Redo state, Apply-only Advanced
 *       controls and improved linear preview/final consistency.
 * 1.0.10 - Mask performance: add LRU caches, enable layered masked preview pipeline, and make Channel Lightness mask-aware.
 * 1.0.8 - Advanced: add Channel Lightness apply layer with Ha/SII/OIII source selector,
 *       Ha default source, stronger response, apply-only workflow and compact source dropdowns.
 * 1.0.9 - Fix: restore the Foraxx Utility-compatible 3-channel Classic Foraxx
 *       PIP formula using both O and HO maps; keep bicolor Classic Foraxx unchanged.
 *
 *****************************************************************************/

// Copyright (C) 2026 Raúl Hussein
// SPDX-License-Identifier: GPL-3.0-only
//
// This file is part of AutoPalette Studio.
//
// AutoPalette Studio is free software: you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the
// Free Software Foundation, version 3 of the License.
//
// AutoPalette Studio is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
// or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License
// for more details.
//
// You should have received a copy of the GNU General Public License along
// with this program. If not, see <https://www.gnu.org/licenses/>.

#feature-id AutoPaletteStudio : Suite Astrocitas > AutoPalette Studio
#feature-icon icons/AutoPaletteStudio.svg
#feature-info AutoPalette Studio v1.1.0<br/><br/>Visual narrowband palette studio for OSC dualband and monochrome Ha/OIII/SII images. Create base palette previews, refine them with Cosmetic Presets, Boosted and Advanced apply layers, use mask protection, and generate full-resolution RGB outputs with preview/final parity.

#include <pjsr/DataType.jsh>
#include <pjsr/FrameStyle.jsh>
#include <pjsr/Interpolation.jsh>
#include <pjsr/NumericControl.jsh>
#include <pjsr/SampleType.jsh>
#include <pjsr/Sizer.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/StdCursor.jsh>
#include <pjsr/UndoFlag.jsh>
#include <pjsr/SectionBar.jsh>

#define VERSION "1.1.0"
#define TITLE "AutoPalette Studio"

// SCC-like section body background colors for compact visual grouping.
#define SECTION_BODY_BG 0xffd8d7d3
#define SECTION_HINT_BG 0xffd8d7d3
#define SETUP_SECTION_BODY_BG 0xffd7dee5

#define HA_NAME "_HA"
#define S2_NAME "_SII"
#define O3_NAME "_OIII"
#define SHO_NAME "_APS_SHO"
#define LEFTWIDTH 420
#define PREVIEW_PREFIX "_APS_"
#define PREVIEW_DOWNSAMPLE 2
#define PREVIEW_DOWNSAMPLE_MIN_DIM 2600
#define PREVIEW_QUALITY_FAST 0
#define PREVIEW_QUALITY_BALANCED 1
#define PREVIEW_QUALITY_QUALITY 2
#define BOOST_RANGE_FINE 0
#define BOOST_RANGE_BALANCED 1
#define BOOST_RANGE_AGGRESSIVE 2
#define APS_PROFILE false
#define APS_REALTIME_PREVIEW_DEBOUNCE_SECONDS 1.00
#define APS_LARGE_IMAGE_FAST_WIDTH 6248
#define APS_LARGE_IMAGE_FAST_HEIGHT 4176
#define APS_BOOSTED_EDIT_WIDTH 46
#define APS_OSC_HA_NAME "_APS_OSC_HA"
#define APS_OSC_SII_NAME "_APS_OSC_SII"
#define APS_OSC_OIII_NAME "_APS_OSC_OIII"

// v0.13.49: Use unique transient large-preview ids to avoid reusing a
// window that PixInsight may still have locked after a recent PixelMath pass.
// The last id is used by Apply Advanced to freeze the rendered Advanced base.
var gLargePreviewRefinedSerial = 0;

// Debug/diagnostic switches. Keep all disabled for tester builds unless
// explicit preview/final diagnostics are required during development.
var APS_DEBUG_PREVIEW_FINAL_PARITY = false;
var APS_DEBUG_KEEP_PREVIEW_WINDOWS = false;
var APS_DEBUG_SHOW_CONSOLE = false;

function apsDebugEnabled()
{
   return APS_DEBUG_PREVIEW_FINAL_PARITY || data.previewDebugWindows || data.previewFinalDebug;
}

function apsShowConsoleIfDebug()
{
   if ( APS_DEBUG_SHOW_CONSOLE && (APS_PROFILE || apsDebugEnabled()) )
      Console.show();
}

function apsTryProcessEvents()
{
   try { processEvents(); } catch ( e ) {}
}

function apsUpdateFinalProgress( dialog, percent, message )
{
   if ( dialog != null && dialog.setFinalGenerationStatus )
      dialog.setFinalGenerationStatus( message, percent );
   apsTryProcessEvents();
}

function apsClearFinalProgress( dialog )
{
   if ( dialog != null && dialog.clearFinalGenerationStatus )
      dialog.clearFinalGenerationStatus();
   apsTryProcessEvents();
}
var gLastLargePreviewRefinedViewId = "";
var gLargePreviewColorBaseViewId = "";
var gLargePreviewColorBaseKey = "";
var gLargePreviewStructuralBaseViewId = "";
var gLargePreviewStructuralBaseKey = "";
var gLargePreviewToneSatBaseViewId = "";
var gLargePreviewToneSatBaseKey = "";
var gLargePreviewWarmMaskViewId = "";
var gLargePreviewWarmMaskKey = "";
var gStarMaskSerial = 0;
var gActiveStarMaskViewId = "";
// v0.13.76: Star mask generation is the expensive part of Mask Protection
// (PixelMath luminance + MLT + curves + convolution). Cache the generated
// mask for the current preview source and mask amount so realtime Boosted /
// Advanced tweaks can reuse it instead of rebuilding it on every slider move.
var gStarMaskCacheKey = "";
var gStarMaskCacheViewId = "";
var gStarMaskComputationInProgress = false;
// v1.0.10: keep a small LRU of generated masks. Star Protection masks are
// expensive (CIEL + MLT + curves + blur), and users often alternate between
// palettes, mask preview and Boosted/Advanced adjustments. A single-entry cache
// forced unnecessary recalculation; this LRU keeps recent mask/source/amount
// combinations alive while still limiting hidden _APS_ windows.
var STAR_MASK_CACHE_LIMIT = 8;
var gStarMaskCacheEntries = [];
// v1.0.10: the rendered mask-preview bitmap also uses a small LRU. This avoids
// repainting mask previews when returning to a recently used palette/amount.
var MASK_PREVIEW_BITMAP_CACHE_LIMIT = 8;
var gMaskPreviewBitmapCacheEntries = [];
var gExternalMaskCacheKey = "";
var gExternalMaskCacheViewId = "";

function starMaskCacheKeyForView( sourceView )
{
   if ( !isValidView( sourceView ) )
      return "";
   var img = sourceView.image;
   return sourceView.id + "|" + img.width + "x" + img.height + "|c" +
          img.numberOfChannels + "|preset=" + (data.previewMaskPreset || 0) +
          "|amount=" + formatFloat( data.previewStarProtectionAmount || 0.0, 4 ) +
          "|invert=" + (data.previewInvertMask ? "1" : "0");
}

function removeStarMaskCacheEntryAt( index, closeWindow )
{
   if ( index < 0 || index >= gStarMaskCacheEntries.length )
      return;
   var entry = gStarMaskCacheEntries[index];
   gStarMaskCacheEntries.splice( index, 1 );
   if ( closeWindow && entry != null && entry.viewId != null && entry.viewId.length > 0 )
      safeForceCloseWindowById( entry.viewId );
}

function promoteStarMaskCacheEntry( index )
{
   if ( index <= 0 || index >= gStarMaskCacheEntries.length )
      return;
   var entry = gStarMaskCacheEntries[index];
   gStarMaskCacheEntries.splice( index, 1 );
   gStarMaskCacheEntries.unshift( entry );
}

function getCachedStarMaskViewForKey( key )
{
   if ( key == null || key.length == 0 )
      return null;

   for ( var i = 0; i < gStarMaskCacheEntries.length; ++i )
   {
      var entry = gStarMaskCacheEntries[i];
      if ( entry != null && entry.key == key && entry.viewId != null && entry.viewId.length > 0 )
      {
         var mv = View.viewById( entry.viewId );
         if ( isValidView( mv ) )
         {
            promoteStarMaskCacheEntry( i );
            gActiveStarMaskViewId = entry.viewId;
            gStarMaskCacheKey = entry.key;
            gStarMaskCacheViewId = entry.viewId;
            apsProfileCacheNote( "mask view", true );
            return mv;
         }
         removeStarMaskCacheEntryAt( i, false );
         break;
      }
   }

   apsProfileCacheNote( "mask view", false );
   gStarMaskCacheKey = "";
   gStarMaskCacheViewId = "";
   gActiveStarMaskViewId = "";
   return null;
}

function storeStarMaskCacheViewForKey( key, viewId )
{
   if ( key == null || key.length == 0 || viewId == null || viewId.length == 0 )
      return;

   for ( var i = gStarMaskCacheEntries.length-1; i >= 0; --i )
      if ( gStarMaskCacheEntries[i].key == key || gStarMaskCacheEntries[i].viewId == viewId )
         removeStarMaskCacheEntryAt( i, false );

   gStarMaskCacheEntries.unshift( { key: key, viewId: viewId } );
   gStarMaskCacheKey = key;
   gStarMaskCacheViewId = viewId;
   gActiveStarMaskViewId = viewId;

   while ( gStarMaskCacheEntries.length > STAR_MASK_CACHE_LIMIT )
      removeStarMaskCacheEntryAt( gStarMaskCacheEntries.length-1, true );
}

function clearMaskPreviewBitmapCache()
{
   gMaskPreviewBitmapCacheEntries = [];
}

function maskPreviewBitmapCacheKeyForView( sourceView )
{
   if ( !isValidView( sourceView ) )
      return "";
   return "maskPreview|" + starMaskCacheKeyForView( sourceView );
}

function getCachedMaskPreviewBitmapForView( sourceView )
{
   var key = maskPreviewBitmapCacheKeyForView( sourceView );
   if ( key.length == 0 )
      return null;

   for ( var i = 0; i < gMaskPreviewBitmapCacheEntries.length; ++i )
   {
      var entry = gMaskPreviewBitmapCacheEntries[i];
      if ( entry != null && entry.key == key && entry.bitmap != null )
      {
         gMaskPreviewBitmapCacheEntries.splice( i, 1 );
         gMaskPreviewBitmapCacheEntries.unshift( entry );
         apsProfileCacheNote( "mask preview bitmap", true );
         return entry.bitmap;
      }
   }

   apsProfileCacheNote( "mask preview bitmap", false );
   return null;
}

function storeMaskPreviewBitmapCacheForView( sourceView, bitmap )
{
   var key = maskPreviewBitmapCacheKeyForView( sourceView );
   if ( key.length == 0 || bitmap == null )
      return;

   for ( var i = gMaskPreviewBitmapCacheEntries.length-1; i >= 0; --i )
      if ( gMaskPreviewBitmapCacheEntries[i].key == key )
         gMaskPreviewBitmapCacheEntries.splice( i, 1 );

   gMaskPreviewBitmapCacheEntries.unshift( { key: key, bitmap: bitmap } );
   while ( gMaskPreviewBitmapCacheEntries.length > MASK_PREVIEW_BITMAP_CACHE_LIMIT )
      gMaskPreviewBitmapCacheEntries.pop();
}

function invertMaskViewInPlace( view )
{
   if ( !isValidView( view ) )
      return false;

   try
   {
      view.beginProcess();
      var P = new PixelMath;
      P.expression = "1-$T";
      P.useSingleExpression = true;
      P.symbols = "";
      P.clearImageCacheAndExit = false;
      P.cacheGeneratedImages = false;
      P.generateOutput = true;
      P.singleThreaded = false;
      P.optimization = true;
      P.use64BitWorkingImage = false;
      P.rescale = false;
      P.truncate = true;
      P.truncateLower = 0;
      P.truncateUpper = 1;
      P.createNewImage = false;
      P.executeOn( view, false );
      view.endProcess();
      return true;
   }
   catch ( e )
   {
      try { view.endProcess(); } catch ( ee ) {}
      Console.warningln( "Mask inversion skipped: ", e );
      return false;
   }
}

function applyMaskInversionIfRequested( view )
{
   if ( data.previewInvertMask )
      return invertMaskViewInPlace( view );
   return true;
}

function invalidateStarMaskCache()
{
   // v1.0.10: Do not destroy the LRU cache on every slider/preset change.
   // The mask key includes source/preset/amount/invert, so stale masks are not
   // reused accidentally. Clearing only the active pointer allows recent masks
   // to be reused when the user returns to a previous setting.
   gStarMaskCacheKey = "";
   gStarMaskCacheViewId = "";
   gActiveStarMaskViewId = "";
   if ( gExternalMaskCacheViewId != null && gExternalMaskCacheViewId.length > 0 )
      safeForceCloseWindowById( gExternalMaskCacheViewId );
   gExternalMaskCacheKey = "";
   gExternalMaskCacheViewId = "";
}

function clearAllStarMaskCaches()
{
   for ( var i = 0; i < gStarMaskCacheEntries.length; ++i )
      if ( gStarMaskCacheEntries[i] != null && gStarMaskCacheEntries[i].viewId != null )
         safeForceCloseWindowById( gStarMaskCacheEntries[i].viewId );
   gStarMaskCacheEntries = [];
   gStarMaskCacheKey = "";
   gStarMaskCacheViewId = "";
   gActiveStarMaskViewId = "";
   clearMaskPreviewBitmapCache();
}

function isStarMaskCacheReadyForView( sourceView )
{
   var key = starMaskCacheKeyForView( sourceView );
   return isValidView( getCachedStarMaskViewForKey( key ) );
}

function nextLargePreviewRefinedId()
{
   ++gLargePreviewRefinedSerial;
   return PREVIEW_PREFIX + "LARGE_PREVIEW_REFINED_" + gLargePreviewRefinedSerial;
}

function cleanupOldLargePreviewRefinedWindows( keepId )
{
   var windows = ImageWindow.windows;
   var prefix = PREVIEW_PREFIX + "LARGE_PREVIEW_REFINED_";
   for ( var i = windows.length-1; i >= 0; --i )
   {
      var id = "";
      try { id = windows[i].mainView.id; } catch ( e0 ) { continue; }
      if ( id.indexOf( prefix ) == 0 && id != keepId )
         safeForceCloseWindowById( id );
   }
}

function closeLayeredLargePreviewCacheViews()
{
   /* RC5.2: Centralised cleanup for hidden full-size/preview-size working
    * views used by the ImageBlend-style layered preview cache.  Keeping this
    * in one place avoids stale hidden windows when the user changes source,
    * recreates previews or switches between fundamentally different tiles.
    */
   if ( gLargePreviewColorBaseViewId.length > 0 )
      safeForceCloseWindowById( gLargePreviewColorBaseViewId );
   if ( gLargePreviewStructuralBaseViewId.length > 0 )
      safeForceCloseWindowById( gLargePreviewStructuralBaseViewId );
   if ( gLargePreviewToneSatBaseViewId.length > 0 )
      safeForceCloseWindowById( gLargePreviewToneSatBaseViewId );
   if ( gLargePreviewWarmMaskViewId.length > 0 )
      safeForceCloseWindowById( gLargePreviewWarmMaskViewId );

   gLargePreviewColorBaseViewId = "";
   gLargePreviewColorBaseKey = "";
   gLargePreviewStructuralBaseViewId = "";
   gLargePreviewStructuralBaseKey = "";
   gLargePreviewToneSatBaseViewId = "";
   gLargePreviewToneSatBaseKey = "";
   gLargePreviewWarmMaskViewId = "";
   gLargePreviewWarmMaskKey = "";
}

function cleanupAllLargePreviewRefinedWindows()
{
   cleanupOldLargePreviewRefinedWindows( "" );
   gLastLargePreviewRefinedViewId = "";
}

function isValidView( view )
{
   return view != null && !view.isNull && view.id != null && view.id.length > 0;
}

function isValidWindow( window )
{
   try
   {
      return window != null && !window.isNull;
   }
   catch ( e )
   {
      return false;
   }
}

function getViewId( view )
{
   return isValidView( view ) ? view.id : "";
}

function getActiveViewOrNull()
{
   var window = ImageWindow.activeWindow;
   if ( window != null && !window.isNull )
      return window.currentView;
   return null;
}

function formatFloat( value, precision )
{
   if ( value == null || !isFinite(value) )
      value = 0;
   return Number(value).toFixed( precision == null ? 6 : precision );
}

function factorExpression( expr, factor )
{
   if ( expr == null || expr.length == 0 )
      return expr;
   if ( factor == null || !isFinite(factor) )
      factor = 1.0;
   if ( Math.abs( factor - 1.0 ) < 1e-6 )
      return expr;
   return "(" + formatFloat(factor, 4) + "*(" + expr + "))";
}

function pipMapExpression( expr, strength )
{
   if ( expr == null || expr.length == 0 )
      return expr;
   if ( strength == null || !isFinite(strength) )
      strength = 1.0;

   var base = "((" + expr + ")^~(" + expr + "))";
   if ( Math.abs( strength - 1.0 ) < 1e-6 )
      return base;
   return "((" + base + ")^" + formatFloat(strength, 4) + ")";
}

function applyBandEmphasisToIds( data, ids )
{
   return {
      HA: factorExpression( ids.HA, data.haEmphasis ),
      OIII: factorExpression( ids.OIII, data.oiiiEmphasis ),
      SII: factorExpression( ids.SII, data.siiEmphasis )
   };
}


/*
 * PALETTE REGISTRY
 * -------------------------------------------------------------------------
 * Stage 1 of AutoPalette Studio keeps the original generation behaviour, but
 * routes palette creation through a central registry. This makes the engine
 * reusable for the next stage, where the same palette definitions will be used
 * to generate downsampled previews and final full-resolution images.
 */

#define PALETTE_ORIGINAL -1
#define PALETTE_CLASSIC_HOO 0
#define PALETTE_CLASSIC_SHO 1
#define PALETTE_CLASSIC_HSO 2
#define PALETTE_CLASSIC_FORAXX 3
#define PALETTE_FORAXX_SHO 4
#define PALETTE_FORAXX_HOS 5
#define PALETTE_FORAXX_OHS 6
#define PALETTE_FORAXX_HOO 7
#define PALETTE_FORAXX_HSO 8
#define PALETTE_FORAXX_OSH 9
#define PALETTE_FORAXX_SOH 10

#define NORMALIZATION_NONE 0
#define NORMALIZATION_HA 1
#define NORMALIZATION_SII 2
#define NORMALIZATION_OIII 3
#define NORMALIZATION_AUTO 4


var PALETTE_DEFINITIONS = [
   { id: "CLASSIC_HOO",    name: "Classic HOO",              group: "classic", requiresSII: false, needsPIPMaps: false },
   { id: "CLASSIC_SHO",    name: "Classic SHO",              group: "classic", requiresSII: true,  needsPIPMaps: false },
   { id: "CLASSIC_HSO",    name: "Classic Hubble (HSO)",     group: "classic", requiresSII: true,  needsPIPMaps: false },
   { id: "CLASSIC_FORAXX", name: "Foraxx Classic",           group: "pip",     requiresSII: true,  needsPIPMaps: true  },
   { id: "FORAXX_SHO",     name: "Foraxx SHO",  group: "pip",     requiresSII: true,  needsPIPMaps: true  },
   { id: "FORAXX_HOS",     name: "Foraxx HOS",  group: "pip",     requiresSII: true,  needsPIPMaps: true  },
   { id: "FORAXX_OHS",     name: "Foraxx OHS",  group: "pip",     requiresSII: true,  needsPIPMaps: true  },
   { id: "FORAXX_HOO",     name: "Foraxx HOO",  group: "pip",     requiresSII: true,  needsPIPMaps: true  },
   { id: "FORAXX_HSO",     name: "Foraxx HSO",  group: "pip",     requiresSII: true,  needsPIPMaps: true  },
   { id: "FORAXX_OSH",     name: "Foraxx OSH",  group: "pip",     requiresSII: true,  needsPIPMaps: true  },
   { id: "FORAXX_SOH",     name: "Foraxx SOH",  group: "pip",     requiresSII: true,  needsPIPMaps: true  }
];

var DEFAULT_CLASSIC_PALETTE_INDICES = [
   PALETTE_ORIGINAL,
   PALETTE_CLASSIC_HOO,
   PALETTE_CLASSIC_FORAXX,
   PALETTE_FORAXX_HOS
];

function getPaletteDefinitionByIndex( index )
{
   if ( index == PALETTE_ORIGINAL )
      return { id: "ORIGINAL", name: "Original", group: "source", requiresSII: false, needsPIPMaps: false };
   if ( index == null || index < 0 || index >= PALETTE_DEFINITIONS.length )
      return PALETTE_DEFINITIONS[0];
   return PALETTE_DEFINITIONS[index];
}

function getPreviewPaletteName( paletteIndex, boostedVariant )
{
   var base = getPaletteDefinitionByIndex( paletteIndex ).name;
   if ( boostedVariant )
      base += " Boosted";
   return base;
}

function isSyntheticHOOBoostWorkflow()
{
   /* RC3.7: Detect Ha/OIII-only DBXtract/mono workflows both for linear and
    * non-linear inputs. The missing SII can be replaced by an internal
    * synthetic view, so checking only referenceSII is not enough.
    */
   try
   {
      if ( typeof data == "undefined" || data.isOSC )
         return false;
      if ( data.syntheticSII === true )
         return true;
      return !isValidView( data.referenceSII );
   }
   catch ( e )
   {
      return false;
   }
}

function isLinearSyntheticHOOBoostWorkflow()
{
   var linear = false;
   try
   {
      linear = (typeof data != "undefined") &&
               (data.linearInputAutoStretchEnabled === true || data.previewAutoStretch === true);
   }
   catch ( e )
   {
      linear = false;
   }

   return linear && isSyntheticHOOBoostWorkflow();
}

function getSoftBoostedPreset()
{
   /*
    * v0.14.12: When linear input has been detected, the preview/final
    * pipeline already works from internally stretched temporary copies.  The
    * normal Boosted preset was designed for already non-linear data and is too
    * aggressive after this internal stretch, so we use a conservative
    * micro-boost.
    */
   var linearGuardrails = false;
   try { linearGuardrails = (typeof data != "undefined" && data.linearInputAutoStretchEnabled === true); } catch ( e ) { linearGuardrails = false; }

   var syntheticHOO = isSyntheticHOOBoostWorkflow();

   if ( linearGuardrails )
   {
      if ( syntheticHOO )
         return {
            scnr: 0.000,
            oiii: 1.120,
            sii: 1.160,
            shadow: 1.000,
            highlight: 1.004,
            brightness: 0.995,
            contrast: 1.065,
            saturation: 1.140,
            cyanGold: 0.120,
            redYellow: 0.060
         };

      return {
         scnr: 0.000,
         oiii: 1.080,
         sii: 1.100,
         shadow: 1.000,
         highlight: 1.000,
         brightness: 1.000,
         contrast: 1.030,
         saturation: 1.080,
         cyanGold: 0.080,
         redYellow: 0.040
      };
   }

   if ( syntheticHOO )
      return {
         scnr: 0.000,
         oiii: 1.160,
         sii: 1.220,
         shadow: 1.000,
         highlight: 1.000,
         brightness: 0.880,
         contrast: 1.055,
         saturation: 1.140,
         cyanGold: 0.160,
         redYellow: 0.080
      };

   return {
      scnr: 0.000,
      oiii: 1.250,
      sii: 1.350,
      shadow: 1.000,
      highlight: 1.012,
      brightness: 1.025,
      contrast: 1.075,
      saturation: 1.200,
      cyanGold: 0.250,
      redYellow: 0.120
   };
}

function getCosmeticPresetDefinition( index )
{
   var p = {
      name: "Natural Boost",
      boosted: {
         scnr: 0.000, oiii: 1.160, sii: 1.180,
         shadow: 1.000, highlight: 1.006, brightness: 1.010, contrast: 1.040,
         saturation: 1.100, cyanGold: 0.100, redYellow: 0.040
      },
      enableGold: false, goldAmount: 0.000,
      enableStructure: false, structureSource: 0, structureAmount: 0.000,
      hint: "Light global enhancement. No Advanced layer is prepared."
   };

   switch ( index )
   {
   case 1: // Blue Core
      p.name = "Blue Core";
      p.boosted = {
         scnr: 0.000, oiii: 1.300, sii: 1.180,
         shadow: 1.000, highlight: 1.010, brightness: 1.020, contrast: 1.075,
         saturation: 1.180, cyanGold: 0.120, redYellow: 0.000
      };
      p.enableStructure = true;
      p.structureSource = 1; // OIII
      p.structureAmount = 0.450;
      p.hint = "Boosts OIII/cyan-blue and prepares OIII Structure Lift. Press Apply in Advanced to stack it.";
      break;

   case 2: // Warm Sulfur
      p.name = "Warm Sulfur";
      p.boosted = {
         scnr: 0.000, oiii: 1.120, sii: 1.380,
         shadow: 1.000, highlight: 1.010, brightness: 1.020, contrast: 1.070,
         saturation: 1.180, cyanGold: 0.280, redYellow: 0.160
      };
      p.enableStructure = true;
      p.structureSource = 0; // SII
      p.structureAmount = 0.420;
      p.hint = "Warmer sulfur/dust look and prepares SII Structure Lift. Press Apply in Advanced to stack it.";
      break;

   case 3: // Balanced Detail
      p.name = "Balanced Detail";
      p.boosted = {
         scnr: 0.000, oiii: 1.180, sii: 1.220,
         shadow: 1.000, highlight: 1.008, brightness: 1.015, contrast: 1.055,
         saturation: 1.120, cyanGold: 0.100, redYellow: 0.050
      };
      p.enableStructure = true;
      p.structureSource = 2; // Ha
      p.structureAmount = 0.400;
      p.hint = "Neutral structure enhancement and prepares Ha Structure Lift. Press Apply in Advanced to stack it.";
      break;

   case 4: // Deep Contrast
      p.name = "Deep Contrast";
      p.boosted = {
         scnr: 0.000, oiii: 1.220, sii: 1.260,
         shadow: 0.960, highlight: 1.015, brightness: 1.010, contrast: 1.140,
         saturation: 1.160, cyanGold: 0.140, redYellow: 0.080
      };
      p.hint = "Stronger boosted contrast/saturation. No Advanced layer is prepared.";
      break;

   case 5: // Foraxx Pop
      p.name = "Foraxx Pop";
      p.boosted = {
         scnr: 0.000, oiii: 1.280, sii: 1.320,
         shadow: 1.000, highlight: 1.014, brightness: 1.025, contrast: 1.100,
         saturation: 1.260, cyanGold: 0.260, redYellow: 0.120
      };
      p.enableGold = true;
      p.goldAmount = 0.300;
      p.enableStructure = true;
      p.structureSource = 1; // OIII
      p.structureAmount = 0.350;
      p.hint = "Color-pop preset. Prepares Gold Accent + OIII Structure Lift; press Apply in Advanced if desired.";
      break;
   }
   return p;
}

function getBoostedWorkflowPresetDefinition( index )
{
   var p = {
      name: "None",
      boosted: {
         scnr: 0.000, oiii: 1.000, sii: 1.000,
         shadow: 1.000, highlight: 1.000, brightness: 1.000, contrast: 1.000,
         saturation: 1.000, cyanGold: 0.000, redYellow: 0.000
      },
      enableGold: false, goldAmount: 0.000,
      enableStructure: false, structureSource: 0, structureAmount: 0.000,
      hint: "No Boosted preset selected. Sliders are neutral."
   };

   if ( index == 1 )
   {
      p.name = "Boosted";
      p.boosted = getSoftBoostedPreset();
      p.hint = "Default Boosted recipe. Press Apply to stack it, or keep editing the visible preview.";
      return p;
   }

   if ( index >= 2 )
   {
      var c = getCosmeticPresetDefinition( index-2 );
      p.name = c.name;
      p.boosted = c.boosted;
      p.enableGold = c.enableGold;
      p.goldAmount = c.goldAmount;
      p.enableStructure = c.enableStructure;
      p.structureSource = c.structureSource;
      p.structureAmount = c.structureAmount;
      p.hint = c.hint;
   }

   return p;
}

function withTemporaryBoostedPreset( callback )
{
   var old = {
      scnr: data.previewSCNR,
      oiii: data.previewOIIIBoost,
      sii: data.previewSIIBoost,
      shadow: data.previewShadowPoint,
      highlight: data.previewHighlightReduction,
      brightness: data.previewBrightness,
      contrast: data.previewContrast,
      saturation: data.previewSaturation,
      cyanGold: data.previewCyanGoldBalance,
      redYellow: data.previewRedYellowBalance,
      enableSII: data.previewEnableSIIAccent,
      siiActive: data.previewSIIAccentActive,
      enableChannelLightness: data.previewEnableChannelLightness,
      channelLightnessSource: data.previewChannelLightnessSource,
      channelLightnessAmount: data.previewChannelLightnessAmount
   };
   var p = getSoftBoostedPreset();
   data.previewSCNR = p.scnr;
   data.previewOIIIBoost = p.oiii;
   data.previewSIIBoost = p.sii;
   data.previewShadowPoint = p.shadow;
   data.previewHighlightReduction = p.highlight;
   data.previewBrightness = p.brightness;
   data.previewContrast = p.contrast;
   data.previewSaturation = p.saturation;
   data.previewCyanGoldBalance = p.cyanGold;
   data.previewRedYellowBalance = p.redYellow;
   data.previewEnableSIIAccent = false;
   data.previewSIIAccentActive = false;
   data.previewEnableChannelLightness = false;
   data.previewChannelLightnessAmount = 0.0;
   try
   {
      return callback();
   }
   finally
   {
      data.previewSCNR = old.scnr;
      data.previewOIIIBoost = old.oiii;
      data.previewSIIBoost = old.sii;
      data.previewShadowPoint = old.shadow;
      data.previewHighlightReduction = old.highlight;
      data.previewBrightness = old.brightness;
      data.previewContrast = old.contrast;
      data.previewSaturation = old.saturation;
      data.previewCyanGoldBalance = old.cyanGold;
      data.previewRedYellowBalance = old.redYellow;
      data.previewEnableSIIAccent = old.enableSII;
      data.previewSIIAccentActive = old.siiActive;
      data.previewEnableChannelLightness = old.enableChannelLightness;
      data.previewChannelLightnessSource = old.channelLightnessSource;
      data.previewChannelLightnessAmount = old.channelLightnessAmount;
   }
}

function needsPIPMaps( data )
{
   if ( data.allCombinations )
      return true;

   if ( data.typePalette == PALETTE_ORIGINAL )
      return false;

   var definition = getPaletteDefinitionByIndex( data.typePalette );
   return definition.needsPIPMaps;
}

function uniqueOutputViewId( baseId )
{
   var clean = baseId || "APS_Output";
   var id = clean;
   var n = 1;
   while ( isValidView( View.viewById( id ) ) )
   {
      id = clean + "_" + n;
      ++n;
   }
   return id;
}

function sanitizeOutputViewId( rawId, fallbackId )
{
   var raw = (rawId != null) ? rawId.toString() : "";
   raw = raw.replace(/^\s+|\s+$/g, "");
   if ( raw.length == 0 || raw == "<Auto>" )
      raw = fallbackId || "APS_Output";

   /* PixInsight view identifiers must be valid JavaScript-like identifiers.
    * Keep the UI forgiving by replacing invalid characters with underscores
    * and ensuring the id starts with a letter or underscore.
    */
   var id = raw.replace(/[^A-Za-z0-9_]/g, "_");
   if ( id.length == 0 )
      id = fallbackId || "APS_Output";
   if ( !/^[A-Za-z_]/.test( id ) )
      id = "APS_" + id;
   return id;
}

function resolveFinalOutputViewId( defaultId )
{
   var raw = (data.finalOutputId != null) ? data.finalOutputId.toString() : "";
   raw = raw.replace(/^\s+|\s+$/g, "");
   if ( raw.length == 0 || raw == "<Auto>" )
      return uniqueOutputViewId( defaultId );
   return uniqueOutputViewId( sanitizeOutputViewId( raw, defaultId ) );
}

function viewHasAstrometricSolutionSafe( view )
{
   try
   {
      return isValidView( view ) && isValidWindow( view.window ) && view.window.hasAstrometricSolution;
   }
   catch ( e )
   {
      return false;
   }
}

function copyAstrometricSolutionSafe( sourceView, targetView, reason )
{
   if ( !viewHasAstrometricSolutionSafe( sourceView ) || !isValidView( targetView ) || !isValidWindow( targetView.window ) )
      return false;

   try
   {
      targetView.window.copyAstrometricSolution( sourceView.window );
      Console.noteln( "Astrometric solution copied to final output: ", targetView.id,
                       reason ? (" (" + reason + ")") : "" );
      return true;
   }
   catch ( e )
   {
      Console.warningln( "Astrometric solution copy skipped for ", targetView.id, ": ", e );
      return false;
   }
}

function firstAstrometricSourceFromList( list )
{
   if ( list == null )
      return null;
   for ( var i = 0; i < list.length; ++i )
      if ( viewHasAstrometricSolutionSafe( list[i] ) )
         return list[i];
   return null;
}

function firstValidSourceFromList( list )
{
   if ( list == null )
      return null;
   for ( var i = 0; i < list.length; ++i )
      if ( isValidView( list[i] ) )
         return list[i];
   return null;
}

function resolveFinalAstrometrySourceView()
{
   var candidates = [
      data.finalAstrometrySourceView,
      data.finalOriginalView,
      data.finalOriginalHA,
      data.finalOriginalOIII,
      data.finalOriginalSII,
      data.currentView,
      data.referenceHA,
      data.referenceOIII,
      data.referenceSII
   ];

   var astrometric = firstAstrometricSourceFromList( candidates );
   if ( isValidView( astrometric ) )
      return astrometric;

   return firstValidSourceFromList( candidates );
}

function applyFinalOutputMetadata( outView )
{
   if ( !isValidView( outView ) )
      return;

   var sourceView = resolveFinalAstrometrySourceView();
   if ( viewHasAstrometricSolutionSafe( sourceView ) )
      copyAstrometricSolutionSafe( sourceView, outView, "final metadata" );
}

function applyFinalDisplayStretchIfNeeded( view )
{
   /* v0.14.14: The large preview applies the automatic display stretch when
    * linear input has been detected. Apply the same stretch to generated final
    * images in that mode so the created view follows the selected preview.
    */
   if ( !isValidView( view ) )
      return;
   if ( data.linearInputAutoStretchEnabled === true && data.previewAutoStretch === true )
      applyDisplayAutoStretchToView( view, shouldUseLinkedSHODisplayStretch(), "final output", getSelectedPreviewStretchReferenceView() );
}

function shouldUseLinearRefinedFinalOutput()
{
   return data.linearInputAutoStretchEnabled === true && data.previewAutoStretch === true;
}

function createLinearRefinedFinalOutputFromView( sourceView, outId )
{
   var refinedSource = sourceView;

   /* RC2: final images must never be generated from reduced preview sources.
    * Rebuild the same visual pipeline from the full-resolution palette base
    * passed by the final generator. This preserves preview/final appearance
    * while keeping final dimensions equal to the original source.
    */

   if ( !isValidView( refinedSource ) || refinedSource.image.numberOfChannels != 3 )
      return null;

   if ( shouldUseLinkedSHODisplayStretch() && data.selectedPreviewBoosted && data.previewAutoStretch )
      return createDirectMonoOriginalBoostedViewFromBase( refinedSource, outId, true, false, getSelectedPreviewStretchReferenceView() );

   safeForceCloseWindowById( outId );

   if ( isAnyMaskActive() )
      createSelectedMaskView( refinedSource );
   else
      gActiveStarMaskViewId = "";

   var tmpData = new parametersPrototype();
   tmpData.setDefaults();
   tmpData.currentView = refinedSource;
   tmpData.referenceHA = refinedSource;
   tmpData.previewSilent = false;

   /* RC4.1: Final linear boosted output now follows the same split pipeline
    * used by the large preview. Previously Cyan/Gold and Red/Yellow were
    * folded into the complete unified refinement PixelMath expression. On
    * large SHO/drizzle frames this generated thousands of invariant
    * subexpressions and could take minutes. Generate the tonal/base boosted
    * layer first, then apply the compact SCC-like color layer in-place.
    */
   var outView = pixelMathFcn( tmpData, refinedSource.id + "[0]", refinedSource.id + "[1]", refinedSource.id + "[2]", "", outId, true );

   if ( !isValidView( outView ) )
      return null;

   applyBoostedLayerStackToView( outView );

   if ( hasBaseNonGoldPreviewRefinementsToApply() )
   {
      if ( !applyPreviewBaseRefinementsStagedToView( outView ) )
         applyPreviewBaseRefinementsUnifiedToView( outView );
   }

   var apsColorStart = apsNowMs();
   applyPreviewColorBalanceOnlyToView( outView );
   apsProfileLog( "final SCC-like color layer", apsColorStart );

   if ( data.previewAdvancedLayerStack != null && data.previewAdvancedLayerStack.length > 0 )
      applyAdvancedLayerStackToView( outView );
   else
   {
      if ( data.previewEnableSIIAccent && Math.abs((data.previewSIIHighlightAccent || 0.0)) > 1e-6 )
         applyGoldAccentOnlyToView( outView );
      if ( isChannelLightnessActive() )
         applyChannelLightnessOnlyToView( outView );
   }

   if ( data.previewAutoStretch )
      applyDisplayAutoStretchToView( outView, shouldUseLinkedSHODisplayStretch(), "linear refined final", getSelectedPreviewStretchReferenceView() );

   return outView;
}

function finalizeGeneratedPaletteOutput( outView, desiredOutId, applyPreviewRefinementsInPlace )
{
   if ( !isValidView( outView ) )
      return outView;

   if ( shouldUseLinearRefinedFinalOutput() )
   {
      var baseId = outView.id;
      var refinedView = createLinearRefinedFinalOutputFromView( outView, desiredOutId );
      if ( isValidView( refinedView ) )
      {
         if ( baseId != desiredOutId )
            safeForceCloseWindowById( baseId );
         applyFinalOutputMetadata( refinedView );
         debugPreviewFinalComparison( data, refinedView );
         if ( isValidWindow( refinedView.window ) )
            refinedView.window.show();
         return refinedView;
      }
   }

   if ( applyPreviewRefinementsInPlace )
      applyPreviewRefinementsToView( outView );

   applyFinalDisplayStretchIfNeeded( outView );
   applyFinalOutputMetadata( outView );
   debugPreviewFinalComparison( data, outView );

   if ( isValidWindow( outView.window ) )
      outView.window.show();

   return outView;
}

function generateOriginalPalette( data )
{
   var finalId = resolveFinalOutputViewId( data.selectedPreviewBoosted ? "Original_Boosted" : "Original" );
   var workingId = shouldUseLinearRefinedFinalOutput() ? uniqueOutputViewId( finalId + "__APS_BASE" ) : finalId;
   var outView = null;

   if ( data.isOSC )
   {
      /* v0.14.14: Original/Original Boosted must be generated from the locked
       * RGB source used by the preview/final pipeline. Do not fall back to the
       * active/current view, which can become a mono Ha working view after prior
       * final generations.
       */
      var originalSource = isValidView( data.finalOriginalView ) ? data.finalOriginalView : data.currentView;
      if ( !isValidView( originalSource ) )
         return;

      var oldCurrent0 = data.currentView;
      data.currentView = originalSource;
      if ( viewHasRGBChannels( originalSource ) )
         outView = pixelMathFcn( data, originalSource.id + "[0]", originalSource.id + "[1]", originalSource.id + "[2]", "", workingId, true );
      else
         outView = pixelMathFcn( data, originalSource.id, originalSource.id, originalSource.id, "", workingId, true );
      data.currentView = oldCurrent0;
   }
   else
   {
      var haView = isValidView( data.finalOriginalHA ) ? data.finalOriginalHA : data.referenceHA;
      var oiiiView = isValidView( data.finalOriginalOIII ) ? data.finalOriginalOIII : data.referenceOIII;
      var siiView = isValidView( data.finalOriginalSII ) ? data.finalOriginalSII : data.referenceSII;

      var HA = getViewId( haView );
      var OIII = getViewId( oiiiView );
      var SII = getViewId( siiView );
      if ( HA.length == 0 || OIII.length == 0 )
         return;

      /* v0.14.19 / RC2.2: In monochrome mode, Original should be a direct
       * reference composition, not a creatively normalized/blended palette.
       * Use the preserved user band views at full resolution, so the final
       * follows the same direct mapping as the preview and does not inherit
       * any _APS_*_LF normalization copies created for other palettes.
       */
      var oldCurrent = data.currentView;
      data.currentView = haView;
      if ( SII.length > 0 )
         outView = pixelMathFcn( data, SII, HA, OIII, "", workingId, true );
      else
         outView = pixelMathFcn( data, HA, OIII, OIII, "", workingId, true );
      data.currentView = oldCurrent;
   }

   if ( isValidView( outView ) )
   {
      // RC2: the large preview applies realtime controls to any selected tile,
      // including OSC Original. Apply the same controls to the final whenever
      // they are active, so non-linear OSC Original previews and finals match.
      var applyRefinements = data.selectedPreviewBoosted || hasBoostedLayerStackToApply() || hasPreviewRefinementsToApply();
      finalizeGeneratedPaletteOutput( outView, finalId, applyRefinements );
   }
}

function selectedForaxxOutputId( index )
{
   switch ( index )
   {
      case PALETTE_FORAXX_SHO: return "Foraxx_SHO";
      case PALETTE_FORAXX_HOS: return "Foraxx_HOS";
      case PALETTE_FORAXX_OHS: return "Foraxx_OHS";
      case PALETTE_FORAXX_HOO: return "Foraxx_HOO";
      case PALETTE_FORAXX_HSO: return "Foraxx_HSO";
      case PALETTE_FORAXX_OSH: return "Foraxx_OSH";
      case PALETTE_FORAXX_SOH: return "Foraxx_SOH";
      default: return "Foraxx_Selected";
   }
}

function generateSelectedForaxxPaletteOnly( data, index )
{
   /* RC4.4: Studio mode must generate only the palette selected in the large
    * preview. The legacy foraxXXX() functions intentionally generate complete
    * families of six combinations; keep them available for legacy/all-combo
    * workflows, but do not call them from the normal Generate Final Image path.
    */
   var HA = getViewId( data.referenceHA );
   var OIII = getViewId( data.referenceOIII );
   var SII = getViewId( data.referenceSII );

   if ( HA.length == 0 || OIII.length == 0 || SII.length == 0 )
      return null;

   // Match the preview expression set: band emphasis belongs to the palette
   // formula, not to the cached PIP-map identifiers alone.
   var bands = applyBandEmphasisToIds( data, {HA:HA, OIII:OIII, SII:SII} );
   HA = bands.HA;
   OIII = bands.OIII;
   SII = bands.SII;

   var o = "o";
   var ho = "ho";
   var exprs = null;

   if ( data.syntheticSII === true && index == PALETTE_FORAXX_HOS )
      exprs = subtleForaxxHOSExpressionSet( data, HA, OIII );
   else
   {
      switch ( index )
      {
         case PALETTE_FORAXX_SHO:
            exprs = [o+"*"+SII+"+~"+o+"*"+HA,
                     ho+"*"+HA+"+~"+ho+"*"+OIII,
                     OIII];
            break;

         case PALETTE_FORAXX_HOS:
            exprs = [HA,
                     OIII,
                     o+"*"+SII+"+~"+o+"*"+OIII];
            break;

         case PALETTE_FORAXX_OHS:
            exprs = [o+"*"+OIII+"+~"+o+"*"+HA,
                     ho+"*"+HA+"+~"+ho+"*"+OIII,
                     o+"*"+SII+"+~"+o+"*"+OIII];
            break;

         case PALETTE_FORAXX_HOO:
            exprs = [HA,
                     OIII,
                     o+"*"+OIII+"+~"+o+"*"+SII];
            break;

         case PALETTE_FORAXX_HSO:
            exprs = [HA,
                     ho+"*"+SII+"+~"+ho+"*"+OIII,
                     OIII];
            break;

         case PALETTE_FORAXX_OSH:
            exprs = [o+"*"+OIII+"+~"+o+"*"+HA,
                     ho+"*"+SII+"+~"+ho+"*"+OIII,
                     o+"*"+HA+"+~"+o+"*"+OIII];
            break;

         case PALETTE_FORAXX_SOH:
            exprs = [o+"*"+SII+"+~"+o+"*"+HA,
                     OIII,
                     o+"*"+HA+"+~"+o+"*"+SII];
            break;
      }
   }

   if ( exprs == null )
      return null;

   return createMultipleRGB( data, exprs[0], exprs[1], exprs[2], selectedForaxxOutputId( index ) );
}

function generatePaletteByIndex( data, index )
{
   switch(index){
      case PALETTE_ORIGINAL:
         generateOriginalPalette(data);
         break;
      case PALETTE_CLASSIC_HOO:
      default:
         classicHOO(data);
         break;
      case PALETTE_CLASSIC_SHO:
         classicSHO(data);
         break;
      case PALETTE_CLASSIC_HSO:
         classicHSO(data);
         break;
      case PALETTE_CLASSIC_FORAXX:
         classicForaxx(data);
         break;
      case PALETTE_FORAXX_SHO:
         generateSelectedForaxxPaletteOnly(data, index);
         break;
      case PALETTE_FORAXX_HOS:
         generateSelectedForaxxPaletteOnly(data, index);
         break;
      case PALETTE_FORAXX_OHS:
         generateSelectedForaxxPaletteOnly(data, index);
         break;
      case PALETTE_FORAXX_HOO:
         generateSelectedForaxxPaletteOnly(data, index);
         break;
      case PALETTE_FORAXX_HSO:
         generateSelectedForaxxPaletteOnly(data, index);
         break;
      case PALETTE_FORAXX_OSH:
         generateSelectedForaxxPaletteOnly(data, index);
         break;
      case PALETTE_FORAXX_SOH:
         generateSelectedForaxxPaletteOnly(data, index);
         break;
   }
}

function generateSelectedPalettes( data )
{
   if (data.allCombinations){
      createAllClassic(data);
      return;
   }

   generatePaletteByIndex(data, data.typePalette);
}

function restorePaletteSourceState( data, state )
{
   if ( state == null )
      return;
   data.currentView = state.currentView;
   data.referenceHA = state.referenceHA;
   data.referenceOIII = state.referenceOIII;
   data.referenceSII = state.referenceSII;
   data.isOSC = state.isOSC;
   data.finalOriginalView = null;
   data.finalOriginalHA = null;
   data.finalOriginalOIII = null;
   data.finalOriginalSII = null;
   data.finalAstrometrySourceView = null;
}

function paletteStart(data, progressDialog){
   apsShowConsoleIfDebug();
   apsUpdateFinalProgress( progressDialog, 0, "Preparing final image..." );

   var apsFinalTotalStart = apsNowMs();
   if ( apsProfileEnabled() )
   {
      Console.noteln( "" );
      Console.noteln( "[APS profile] Generate Final Image started" );
      Console.writeln( "  Mode: ", data.isOSC ? "OSC" : "DBXtract/Mono",
                       ", palette=", getPaletteDefinitionByIndex(data.typePalette).name,
                       ", boosted=", data.selectedPreviewBoosted ? "true" : "false" );
   }

   var sourceState = {
      currentView: data.currentView,
      referenceHA: data.referenceHA,
      referenceOIII: data.referenceOIII,
      referenceSII: data.referenceSII,
      isOSC: data.isOSC
   };

   data.finalAstrometrySourceView = firstAstrometricSourceFromList( [
      sourceState.currentView, sourceState.referenceHA, sourceState.referenceOIII, sourceState.referenceSII
   ] );
   if ( !isValidView( data.finalAstrometrySourceView ) )
      data.finalAstrometrySourceView = firstValidSourceFromList( [
         sourceState.currentView, sourceState.referenceHA, sourceState.referenceOIII, sourceState.referenceSII
      ] );

   if ( isAnyMaskActive() )
      Console.warningln( "Mask Protection is active for final generation. The selected mask preset will be applied to the final image and may increase processing time." );

   if (data.isOSC){
      Console.noteln("Image Color");
      if (!isValidView(data.currentView) || !data.currentView.image.isColor){
          (new MessageBox("There must be one RGB image for OSC option", TITLE, StdIcon_Error, StdButton_Ok)).execute();
          apsClearFinalProgress( progressDialog );
          return false;
      }

      apsUpdateFinalProgress( progressDialog, 10, "Extracting OSC channels..." );
      var apsStageStart = apsNowMs();
      NBChannelExtraction(data.currentView, APS_OSC_HA_NAME, APS_OSC_SII_NAME, APS_OSC_OIII_NAME);
      apsProfileLog( "final OSC channel extraction", apsStageStart );
      data.referenceHA = View.viewById(APS_OSC_HA_NAME);
      data.referenceOIII = View.viewById(APS_OSC_OIII_NAME);
      data.referenceSII = View.viewById(APS_OSC_SII_NAME);
      apsUpdateFinalProgress( progressDialog, 20, "Preparing intermediate channels..." );
      apsStageStart = apsNowMs();
      intermediateSHO(data);
      apsProfileLog( "final intermediate SHO", apsStageStart );

      if (data.autoClose){
         var wHA = ImageWindow.windowById(APS_OSC_HA_NAME); if (isValidWindow(wHA)) wHA.hide();
         var wOIII = ImageWindow.windowById(APS_OSC_OIII_NAME); if (isValidWindow(wOIII)) wOIII.hide();
         var wSII = ImageWindow.windowById(APS_OSC_SII_NAME); if (isValidWindow(wSII)) wSII.hide();
         var wSHO = ImageWindow.windowById(SHO_NAME); if (isValidWindow(wSHO)) wSHO.hide();
      }
   }
   else Console.noteln("Image Mono");

   if (!data.isOSC && (!isValidView(data.referenceHA) || !isValidView(data.referenceOIII))){
      (new MessageBox("There must be at least valid Ha and OIII images open for this script to function", TITLE, StdIcon_Error, StdButton_Ok)).execute();
      apsClearFinalProgress( progressDialog );
      return false;
   }

   if ( !data.isOSC )
   {
      var finalNbError = getNarrowbandReferenceValidationError( data.referenceHA, data.referenceOIII, data.referenceSII, "final generation" );
      if ( finalNbError.length > 0 )
      {
         (new MessageBox( finalNbError, TITLE, StdIcon_Error, StdButton_Ok )).execute();
         apsClearFinalProgress( progressDialog );
         return false;
      }
      data.currentView = data.referenceHA;
   }

   /* RC2.2: Preserve the user's original monochrome band views before any
    * internal LinearFit/normalization or linear-working-copy substitution.
    * Original and Original Boosted previews are built from these unmodified
    * bands, so final generation must use the same source family at full
    * resolution. This avoids mismatches where the final used _APS_*_LF copies
    * while the preview used the direct DBXtract/mono channels.
    */
   data.finalOriginalHA = data.referenceHA;
   data.finalOriginalOIII = data.referenceOIII;
   data.finalOriginalSII = data.referenceSII;

   if ( isExternalMaskActive() )
   {
      var finalMaskError = getExternalMaskValidationError( data.previewExternalMaskView,
                                                           data.referenceHA, data.referenceOIII, data.referenceSII,
                                                           data.currentView, "final generation" );
      if ( finalMaskError.length > 0 )
      {
         (new MessageBox( finalMaskError, TITLE, StdIcon_Error, StdButton_Ok )).execute();
         apsClearFinalProgress( progressDialog );
         return false;
      }
      invalidateStarMaskCache();
   }

   apsUpdateFinalProgress( progressDialog, 30, "Preparing working views..." );
   var apsStageStart = apsNowMs();
   var previewLinearInputWorkflow = (data.previewAutoStretch === true || data.linearInputAutoStretchEnabled === true);
   var finalLinearInputDetected = prepareFinalLinearInputWorkingViews( data, previewLinearInputWorkflow );
   apsProfileLog( "final linear input working views", apsStageStart );
   data.linearInputAutoStretchEnabled = previewLinearInputWorkflow || finalLinearInputDetected;
   data.previewAutoStretch = data.linearInputAutoStretchEnabled;

   if ( data.typePalette != PALETTE_ORIGINAL && !isValidView(data.referenceSII))
   {
      if ( data.typePalette == PALETTE_CLASSIC_HOO )
      {
         // HOO does not require measured SII.
      }
      else if ( data.typePalette >= PALETTE_FORAXX_SHO && data.typePalette <= PALETTE_FORAXX_SOH )
      {
         // Ha/OIII bi-color Foraxx variants use an OSC-like SII proxy: close to Ha
         // with a small OIII contribution, plus softened OIII PIP maps in createSwapHSO().
         apsUpdateFinalProgress( progressDialog, 40, "Building synthetic SII..." );
         apsStageStart = apsNowMs();
         createSyntheticSIIOscLikeFromHaIfMissing( data, "final Foraxx variant generation" );
         apsProfileLog( "final synthetic SII OSC-like", apsStageStart );
      }
      else
      {
         apsUpdateFinalProgress( progressDialog, 40, "Building synthetic SII..." );
         apsStageStart = apsNowMs();
         createSyntheticSIIFromHaIfMissing( data, "final palette generation" );
         apsProfileLog( "final synthetic SII", apsStageStart );
      }
   }

   if (needsPIPMaps(data))
   {
      apsUpdateFinalProgress( progressDialog, 48, "Preparing Foraxx support maps..." );
      apsStageStart = apsNowMs();
      createSwapHSO(data); // PIP/Foraxx support maps
      apsProfileLog( "final PIP/Foraxx support maps", apsStageStart );
   }

   apsUpdateFinalProgress( progressDialog, 58, "Applying normalization..." );
   apsStageStart = apsNowMs();
   applyLinearFit(data);
   apsProfileLog( "final normalization/linear fit", apsStageStart );

   apsUpdateFinalProgress( progressDialog, 72, "Generating selected palette..." );
   apsStageStart = apsNowMs();
   generateSelectedPalettes(data);
   apsProfileLog( "final selected palette generation", apsStageStart );

   // _APS_SHO is always an internal helper; never leave it visible after final generation.
   if ( data.autoClose )
      safeForceCloseWindowById( SHO_NAME );

   apsUpdateFinalProgress( progressDialog, 92, "Cleaning temporary views..." );
   apsStageStart = apsNowMs();
   closeIntermediate(data);
   cleanupFinalLinearWorkingViews();
   restorePaletteSourceState( data, sourceState );
   apsProfileLog( "final cleanup", apsStageStart );
   apsProfileLog( "Generate Final Image total", apsFinalTotalStart );
   if ( apsProfileEnabled() ) Console.noteln( "[APS profile] Generate Final Image completed" );
   apsUpdateFinalProgress( progressDialog, 100, "Completed" );
   if ( !apsDebugEnabled() && !APS_PROFILE ) Console.hide();
   return true;
}

function getRequiredPIPMapIds( data )
{
   /* Generate only the PIP helper maps actually consumed by the selected
    * Foraxx formula. Classic Foraxx with real SII requires both O and HO
    * maps to match the original Foraxx Palette Utility PIP calculation.
    * Some variants still simplify algebraic no-ops and need only O or HO.
    */
   if ( data == null )
      return ["o", "ho"];

   if ( data.allCombinations )
      return ["o", "ho"];

   if ( data.syntheticSII === true &&
        (data.typePalette == PALETTE_CLASSIC_FORAXX || data.typePalette == PALETTE_FORAXX_HOS) )
      return [];

   switch ( data.typePalette )
   {
      case PALETTE_CLASSIC_FORAXX:
         return ["o", "ho"];

      case PALETTE_FORAXX_HSO:
         return ["ho"];

      case PALETTE_FORAXX_HOS:
      case PALETTE_FORAXX_HOO:
      case PALETTE_FORAXX_SOH:
         return ["o"];

      case PALETTE_FORAXX_SHO:
      case PALETTE_FORAXX_OHS:
      case PALETTE_FORAXX_OSH:
         return ["o", "ho"];

      default:
         return ["o", "ho"];
   }
}

function createSwapHSO(data){
   Console.noteln("createSwapHSO");

   var HA0 = getViewId(data.referenceHA);
   var OIII0 = getViewId(data.referenceOIII);
   var SII0 = getViewId(data.referenceSII);

   if (HA0.length == 0 || OIII0.length == 0 || SII0.length == 0) return;

   // RC4.3: regenerate only the PIP helper maps that are actually used by the
   // selected Foraxx-family formulas. This avoids several unnecessary full-res
   // PixelMath passes, especially noticeable on OSC/SHO large images.
   var requiredMaps = getRequiredPIPMapIds( data );
   var allMapIds = ["h","o","s","ho","hs","os"];
   for ( var __mi = 0; __mi < allMapIds.length; ++__mi )
      if ( requiredMaps.indexOf( allMapIds[__mi] ) >= 0 || isValidView( View.viewById( allMapIds[__mi] ) ) )
         safeForceCloseWindowById( allMapIds[__mi] );

   var bands = applyBandEmphasisToIds( data, {HA:HA0, OIII:OIII0, SII:SII0} );
   var HA = bands.HA;
   var OIII = bands.OIII;
   var SII = bands.SII;
   var ps = data.pipStrength;

   // When SII is synthetic from a Ha/OIII DBXtract workflow, soften the OIII contribution
   // only in PIP map generation. The output formulas still use the real OIII expression.
   // This tends to mimic the more mixed OSC/RGB routing without contaminating the source bands.
   var OIII_PIP = (data.syntheticSII === true) ? factorExpression( OIII, syntheticForaxxOIIIMaskFactor( data ) ) : OIII;

   function needsMap( id )
   {
      return requiredMaps.indexOf( id ) >= 0;
   }

   if ( needsMap( "h" ) )
      createSingleRGB(data, pipMapExpression(HA, ps), "h");
   if ( needsMap( "o" ) )
      createSingleRGB(data, pipMapExpression(OIII_PIP, ps), "o");
   if ( needsMap( "s" ) )
      createSingleRGB(data, pipMapExpression(SII, ps), "s");
   if ( needsMap( "ho" ) )
      createSingleRGB(data, pipMapExpression("("+HA+")*("+OIII_PIP+")", ps), "ho");
   if ( needsMap( "hs" ) )
      createSingleRGB(data, pipMapExpression("("+HA+")*("+SII+")", ps), "hs");
   if ( needsMap( "os" ) )
      createSingleRGB(data, pipMapExpression("("+OIII_PIP+")*("+SII+")", ps), "os");

   if (data.autoClose){
      for ( var __mj = 0; __mj < requiredMaps.length; ++__mj )
      {
         var __w = ImageWindow.windowById( requiredMaps[__mj] );
         if ( isValidWindow( __w ) ) __w.hide();
      }
   }
}

function intermediateSHO(data){
   Console.noteln("intermediateSHO");
   var HA = getViewId(data.referenceHA);
   var OIII = getViewId(data.referenceOIII);
   var SII = getViewId(data.referenceSII);

   if (HA.length == 0 || OIII.length == 0 || SII.length == 0) return;

   createMultipleRGB(data, SII, HA, OIII, SHO_NAME);
   var wSHO = ImageWindow.windowById(SHO_NAME);
   if ( isValidWindow( wSHO ) ) wSHO.hide();
}

function closeIntermediate(data){
   if ( apsDebugEnabled() ) Console.noteln("closeIntermediate");
   if (!data.autoClose) return;

   safeForceCloseWindowById("h");
   safeForceCloseWindowById("o");
   safeForceCloseWindowById("s");
   safeForceCloseWindowById("ho");
   safeForceCloseWindowById("hs");
   safeForceCloseWindowById("os");

   // RC2: close only AutoPalette-owned internal views. Never close user
   // DBXtract views such as _HA, _OIII or _SII.
   safeForceCloseWindowById( APS_OSC_HA_NAME );
   safeForceCloseWindowById( APS_OSC_OIII_NAME );
   safeForceCloseWindowById( APS_OSC_SII_NAME );
   safeForceCloseWindowById( PREVIEW_PREFIX + "HA_LF" );
   safeForceCloseWindowById( PREVIEW_PREFIX + "OIII_LF" );
   safeForceCloseWindowById( PREVIEW_PREFIX + "SII_LF" );
   safeForceCloseWindowById( SHO_NAME );
}

function createAllClassic(data){
   Console.noteln("createAllClassic");
   classicHOO(data);
   classicSHO(data);
   classicHSO(data);
   classicForaxx(data);
}

function createAll(data){
   Console.noteln("createAll");
   classicHOO(data);
   classicHSO(data);
   classicSHO(data);
   foraxSHO(data);
   foraxHOS(data);
   foraxOHS(data);
   foraxHOO(data);
   foraxHSO(data);
   foraxOSH(data);
   foraxSOH(data);
}

function foraxHOS(data){
   Console.noteln("foraxHOS");

   var HA = getViewId(data.referenceHA);
   var OIII = getViewId(data.referenceOIII);
   var SII = getViewId(data.referenceSII);

   if (HA.length == 0 || OIII.length == 0 || SII.length == 0) return;
   var bands = applyBandEmphasisToIds( data, {HA:HA, OIII:OIII, SII:SII} );
   HA = bands.HA; OIII = bands.OIII; SII = bands.SII;

   if ( data.syntheticSII === true )
   {
      var exprs = subtleForaxxHOSExpressionSet( data, HA, OIII );
      createMultipleRGB(data, exprs[0], exprs[1], exprs[2], "Foraxx_HOS_HOO");
      return;
   }

   createMultipleRGB(data, "o*"+HA+"+~o*"+HA, "ho*"+OIII+"+~ho*"+OIII, "o*"+SII+"+~o*"+OIII, "Foraxx_HOS_HOO");
   createMultipleRGB(data, "o*"+HA+"+~o*"+HA, "ho*"+OIII+"+~ho*"+SII, "o*"+SII+"+~o*"+OIII, "Foraxx_HOS_HSO");
   createMultipleRGB(data, "o*"+HA+"+~o*"+OIII, "ho*"+OIII+"+~ho*"+HA, "o*"+SII+"+~o*"+SII, "Foraxx_HOS_OHS");
   createMultipleRGB(data, "o*"+HA+"+~o*"+OIII, "ho*"+OIII+"+~ho*"+SII, "o*"+SII+"+~o*"+HA, "Foraxx_HOS_OSH");
   createMultipleRGB(data, "o*"+HA+"+~o*"+SII, "ho*"+OIII+"+~ho*"+OIII, "o*"+SII+"+~o*"+HA, "Foraxx_HOS_SOH");
   createMultipleRGB(data, "o*"+HA+"+~o*"+SII, "ho*"+OIII+"+~ho*"+HA, "o*"+SII+"+~o*"+OIII, "Foraxx_HOS_SHO");
}

function foraxOHS(data){
   Console.noteln("foraxOHS");

   var HA = getViewId(data.referenceHA);
   var OIII = getViewId(data.referenceOIII);
   var SII = getViewId(data.referenceSII);

   if (HA.length == 0 || OIII.length == 0 || SII.length == 0) return;
   var bands = applyBandEmphasisToIds( data, {HA:HA, OIII:OIII, SII:SII} );
   HA = bands.HA; OIII = bands.OIII; SII = bands.SII;

   createMultipleRGB(data, "o*"+OIII+"+~o*"+HA, "ho*"+HA+"+~ho*"+OIII, "o*"+SII+"+~o*"+OIII, "Foraxx_OHS_HOO");
   createMultipleRGB(data, "o*"+OIII+"+~o*"+HA, "ho*"+HA+"+~ho*"+OIII, "o*"+SII+"+~o*"+SII, "Foraxx_OHS_HOS");
   createMultipleRGB(data, "o*"+OIII+"+~o*"+HA, "ho*"+HA+"+~ho*"+SII, "o*"+SII+"+~o*"+OIII, "Foraxx_OHS_HSO");
   createMultipleRGB(data, "o*"+OIII+"+~o*"+OIII, "ho*"+HA+"+~ho*"+SII, "o*"+SII+"+~o*"+HA, "Foraxx_OHS_OSH");
   createMultipleRGB(data, "o*"+OIII+"+~o*"+SII, "ho*"+HA+"+~ho*"+HA, "o*"+SII+"+~o*"+OIII, "Foraxx_OHS_SHO");
   createMultipleRGB(data, "o*"+OIII+"+~o*"+SII, "ho*"+HA+"+~ho*"+OIII, "o*"+SII+"+~o*"+HA, "Foraxx_OHS_SOH");
}

function foraxSHO(data){
   Console.noteln("foraxSHO");

   var HA = getViewId(data.referenceHA);
   var OIII = getViewId(data.referenceOIII);
   var SII = getViewId(data.referenceSII);

   if (HA.length == 0 || OIII.length == 0 || SII.length == 0) return;
   var bands = applyBandEmphasisToIds( data, {HA:HA, OIII:OIII, SII:SII} );
   HA = bands.HA; OIII = bands.OIII; SII = bands.SII;

   createMultipleRGB(data, "o*"+SII+"+~o*"+HA, "ho*"+HA+"+~ho*"+OIII, OIII, "Foraxx_SHO_HOO");
   createMultipleRGB(data, "o*"+SII+"+~o*"+HA, "ho*"+HA+"+~ho*"+SII, OIII, "Foraxx_SHO_HSO");
   createMultipleRGB(data, "o*"+SII+"+~o*"+HA, "ho*"+HA+"+~ho*"+OIII, "o*"+OIII+"+~o*"+SII, "Foraxx_SHO_HOS");
   createMultipleRGB(data, "o*"+SII+"+~o*"+OIII, HA, "o*"+OIII+"+~o*"+SII, "Foraxx_SHO_OHS");
   createMultipleRGB(data, "o*"+SII+"+~o*"+OIII, "ho*"+HA+"+~ho*"+SII, "o*"+OIII+"+~o*"+HA, "Foraxx_SHO_OSH");
   createMultipleRGB(data, SII, "ho*"+OIII+"+~ho*"+HA, "o*"+OIII+"+~o*"+HA, "Foraxx_SHO_SOH");
}

function foraxHOO(data){
   Console.noteln("foraxHOO");

   var HA = getViewId(data.referenceHA);
   var OIII = getViewId(data.referenceOIII);
   var SII = getViewId(data.referenceSII);

   if (HA.length == 0 || OIII.length == 0 || SII.length == 0) return;
   var bands = applyBandEmphasisToIds( data, {HA:HA, OIII:OIII, SII:SII} );
   HA = bands.HA; OIII = bands.OIII; SII = bands.SII;

   createMultipleRGB(data, "o*"+HA+"+~o*"+HA, "ho*"+OIII+"+~ho*"+OIII, "o*"+OIII+"+~o*"+SII, "Foraxx_HOO_HOS");
   createMultipleRGB(data, "o*"+HA+"+~o*"+HA, "ho*"+OIII+"+~ho*"+SII, "o*"+OIII+"+~o*"+OIII, "Foraxx_HOO_HSO");
   createMultipleRGB(data, "o*"+HA+"+~o*"+OIII, "ho*"+OIII+"+~ho*"+HA, "o*"+OIII+"+~o*"+SII, "Foraxx_HOO_OHS");
   createMultipleRGB(data, "o*"+HA+"+~o*"+OIII, "ho*"+OIII+"+~ho*"+SII, "o*"+OIII+"+~o*"+HA, "Foraxx_HOO_OSH");
   createMultipleRGB(data, "o*"+HA+"+~o*"+SII, "ho*"+OIII+"+~ho*"+HA, "o*"+OIII+"+~o*"+OIII, "Foraxx_HOO_SHO");
   createMultipleRGB(data, "o*"+HA+"+~o*"+SII, "ho*"+OIII+"+~ho*"+OIII, "o*"+OIII+"+~o*"+HA, "Foraxx_HOO_SOH");
}

function foraxHSO(data){
   Console.noteln("foraxHSO");

   var HA = getViewId(data.referenceHA);
   var OIII = getViewId(data.referenceOIII);
   var SII = getViewId(data.referenceSII);

   if (HA.length == 0 || OIII.length == 0 || SII.length == 0) return;
   var bands = applyBandEmphasisToIds( data, {HA:HA, OIII:OIII, SII:SII} );
   HA = bands.HA; OIII = bands.OIII; SII = bands.SII;

   createMultipleRGB(data, "o*"+HA+"+~o*"+HA, "ho*"+SII+"+~ho*"+OIII, "o*"+OIII+"+~o*"+OIII, "Foraxx_HSO_HOO");
   createMultipleRGB(data, "o*"+HA+"+~o*"+HA, "ho*"+SII+"+~ho*"+OIII, "o*"+OIII+"+~o*"+SII, "Foraxx_HSO_HOS");
   createMultipleRGB(data, "o*"+HA+"+~o*"+OIII, "ho*"+SII+"+~ho*"+HA, "o*"+OIII+"+~o*"+SII, "Foraxx_HSO_OHS");
   createMultipleRGB(data, "o*"+HA+"+~o*"+OIII, "ho*"+SII+"+~ho*"+SII, "o*"+OIII+"+~o*"+HA, "Foraxx_HSO_OSH");
   createMultipleRGB(data, "o*"+HA+"+~o*"+SII, "ho*"+SII+"+~ho*"+HA, "o*"+OIII+"+~o*"+OIII, "Foraxx_HSO_SHO");
   createMultipleRGB(data, "o*"+HA+"+~o*"+SII, "ho*"+SII+"+~ho*"+OIII, "o*"+OIII+"+~o*"+HA, "Foraxx_HSO_SOH");
}

function foraxOSH(data){
   Console.noteln("foraxOSH");

   var HA = getViewId(data.referenceHA);
   var OIII = getViewId(data.referenceOIII);
   var SII = getViewId(data.referenceSII);

   if (HA.length == 0 || OIII.length == 0 || SII.length == 0) return;
   var bands = applyBandEmphasisToIds( data, {HA:HA, OIII:OIII, SII:SII} );
   HA = bands.HA; OIII = bands.OIII; SII = bands.SII;

   createMultipleRGB(data, "o*"+OIII+"+~o*"+HA, "ho*"+SII+"+~ho*"+OIII, "o*"+HA+"+~o*"+OIII, "Foraxx_OSH_HOO");
   createMultipleRGB(data, "o*"+OIII+"+~o*"+HA, "ho*"+SII+"+~ho*"+OIII, "o*"+HA+"+~o*"+SII, "Foraxx_OSH_HOS");
   createMultipleRGB(data, "o*"+OIII+"+~o*"+HA, "ho*"+SII+"+~ho*"+SII, "o*"+HA+"+~o*"+OIII, "Foraxx_OSH_HSO");
   createMultipleRGB(data, "o*"+OIII+"+~o*"+OIII, "ho*"+SII+"+~ho*"+SII, "o*"+HA+"+~o*"+HA, "Foraxx_OSH_OSH");
   createMultipleRGB(data, "o*"+OIII+"+~o*"+SII, "ho*"+SII+"+~ho*"+HA, "o*"+HA+"+~o*"+OIII, "Foraxx_OSH_SHO");
   createMultipleRGB(data, "o*"+OIII+"+~o*"+SII, "ho*"+SII+"+~ho*"+OIII, "o*"+HA+"+~o*"+HA, "Foraxx_OSH_SOH");
}

function foraxSOH(data){
   Console.noteln("foraxSOH");

   var HA = getViewId(data.referenceHA);
   var OIII = getViewId(data.referenceOIII);
   var SII = getViewId(data.referenceSII);

   if (HA.length == 0 || OIII.length == 0 || SII.length == 0) return;
   var bands = applyBandEmphasisToIds( data, {HA:HA, OIII:OIII, SII:SII} );
   HA = bands.HA; OIII = bands.OIII; SII = bands.SII;

   createMultipleRGB(data, "o*"+SII+"+~o*"+HA, "ho*"+OIII+"+~ho*"+OIII, "o*"+HA+"+~o*"+SII, "Foraxx_SOH_HOS");
   createMultipleRGB(data, "o*"+SII+"+~o*"+HA, "ho*"+OIII+"+~ho*"+SII, "o*"+HA+"+~o*"+OIII, "Foraxx_SOH_HSO");
   createMultipleRGB(data, "o*"+SII+"+~o*"+SII, "ho*"+OIII+"+~ho*"+HA, "o*"+HA+"+~o*"+OIII, "Foraxx_SOH_SHO");
   createMultipleRGB(data, "o*"+SII+"+~o*"+OIII, "ho*"+OIII+"+~ho*"+HA, "o*"+HA+"+~o*"+SII, "Foraxx_SOH_OHS");
   createMultipleRGB(data, "o*"+SII+"+~o*"+HA, "ho*"+OIII+"+~ho*"+OIII, "o*"+HA+"+~o*"+OIII, "Foraxx_SOH_HOO");
   createMultipleRGB(data, "o*"+SII+"+~o*"+OIII, "ho*"+OIII+"+~ho*"+SII, "o*"+HA+"+~o*"+HA, "Foraxx_SOH_OSH");
}

function classicSHO(data){
   Console.noteln("classicSHO");

   var HA = getViewId(data.referenceHA);
   var OIII = getViewId(data.referenceOIII);
   var SII = getViewId(data.referenceSII);

   if (HA.length == 0 || OIII.length == 0 || SII.length == 0) return;
   var bands = applyBandEmphasisToIds( data, {HA:HA, OIII:OIII, SII:SII} );
   HA = bands.HA; OIII = bands.OIII; SII = bands.SII;

   switch (data.blendMode){
      case 1: // Neutral (50% Ha + 50% OIII)
         createMultipleRGB(data, ".5*"+SII+"+.5*"+HA, ".5*"+HA+"+.5*"+OIII, OIII, "SHO_Classic_Neutral");
         break;

      case 2: // Soft (60% Ha + 40% OIII)
         createMultipleRGB(data, ".6*"+SII+"+.4*"+HA, ".6*"+HA+"+.4*"+OIII, OIII, "SHO_Classic_Soft");
         break;

      case 3: // Hard (70% Ha + 30% OIII)
         createMultipleRGB(data, ".7*"+SII+"+.3*"+HA, ".7*"+HA+"+.3*"+OIII, OIII, "SHO_Classic_Hard");
         break;

      case 4: // All modes
         createMultipleRGB(data, SII, HA, OIII, "SHO_Classic");
         createMultipleRGB(data, ".5*"+SII+"+.5*"+HA, ".5*"+HA+"+.5*"+OIII, OIII, "SHO_Classic_Neutral");
         createMultipleRGB(data, ".6*"+SII+"+.4*"+HA, ".6*"+HA+"+.4*"+OIII, OIII, "SHO_Classic_Soft");
         createMultipleRGB(data, ".7*"+SII+"+.3*"+HA, ".7*"+HA+"+.3*"+OIII, OIII, "SHO_Classic_Hard");
         break;

      default:
         createMultipleRGB(data, SII, HA, OIII, "SHO_Classic");
         break;
   }
}

function classicHOO(data){
   Console.noteln("classicHOO");

   var HA = getViewId(data.referenceHA);
   var OIII = getViewId(data.referenceOIII);

   if (HA.length == 0 || OIII.length == 0) return;
   var bands = applyBandEmphasisToIds( data, {HA:HA, OIII:OIII, SII:""} );
   HA = bands.HA; OIII = bands.OIII;

   switch (data.blendMode){
      case 1: // Neutral (50% Ha + 50% OIII)
         createMultipleRGB(data, HA, ".5*"+HA+"+.5*"+OIII, OIII, "HOO_Classic_Neutral");
         break;

      case 2: // Soft (60% Ha + 40% OIII)
         createMultipleRGB(data, HA, ".6*"+HA+"+.4*"+OIII, OIII, "HOO_Classic_Soft");
         break;

      case 3: // Hard (70% Ha + 30% OIII)
         createMultipleRGB(data, HA, ".7*"+HA+"+.3*"+OIII, OIII, "HOO_Classic_Hard");
         break;

      case 4: // All modes
         createMultipleRGB(data, HA, OIII, OIII, "HOO_Classic");
         createMultipleRGB(data, HA, ".5*"+HA+"+.5*"+OIII, OIII, "HOO_Classic_Neutral");
         createMultipleRGB(data, HA, ".6*"+HA+"+.4*"+OIII, OIII, "HOO_Classic_Soft");
         createMultipleRGB(data, HA, ".7*"+HA+"+.3*"+OIII, OIII, "HOO_Classic_Hard");
         break;

      default:
         createMultipleRGB(data, HA, OIII, OIII, "HOO_Classic");
         break;
   }
}

function classicHSO(data){
   Console.noteln("classicHSO");

   var HA = getViewId(data.referenceHA);
   var OIII = getViewId(data.referenceOIII);
   var SII = getViewId(data.referenceSII);

   if (HA.length == 0 || OIII.length == 0 || SII.length == 0) return;
   var bands = applyBandEmphasisToIds( data, {HA:HA, OIII:OIII, SII:SII} );
   HA = bands.HA; OIII = bands.OIII; SII = bands.SII;

   switch (data.blendMode){
      case 1: // Neutral (50% Ha + 50% OIII)
         createMultipleRGB(data, ".5*"+HA+"+.5*"+OIII, ".5*"+SII+"+.5*"+HA, OIII, "HSO_Classic_Neutral");
         break;

      case 2: // Soft (60% Ha + 40% OIII)
         createMultipleRGB(data, ".6*"+HA+"+.4*"+OIII, ".6*"+SII+"+.4*"+HA, OIII, "HSO_Classic_Soft");
         break;

      case 3: // Hard (70% Ha + 30% OIII)
         createMultipleRGB(data, ".7*"+HA+"+.3*"+OIII, ".7*"+SII+"+.3*"+HA, OIII, "HSO_Classic_Hard");
         break;

      case 4: // All modes
         createMultipleRGB(data, HA, SII, OIII, "HSO_Classic");
         createMultipleRGB(data, ".5*"+HA+"+.5*"+OIII, ".5*"+SII+"+.5*"+HA, OIII, "HSO_Classic_Neutral");
         createMultipleRGB(data, ".6*"+HA+"+.4*"+OIII, ".6*"+SII+"+.4*"+HA, OIII, "HSO_Classic_Soft");
         createMultipleRGB(data, ".7*"+HA+"+.3*"+OIII, ".7*"+SII+"+.3*"+HA, OIII, "HSO_Classic_Hard");
         break;

      default:
         createMultipleRGB(data, HA, SII, OIII, "HSO_Classic");
         break;
   }

}

function classicForaxx(data){
   Console.noteln("classicForaxx");

   var HA = getViewId(data.referenceHA);
   var OIII = getViewId(data.referenceOIII);
   var SII = getViewId(data.referenceSII);

   if (HA.length == 0 || OIII.length == 0) return;
   if (SII.length == 0)
   {
      if ( !createSyntheticSIIFromHaIfMissing( data, "classic Foraxx generation" ) )
         return;
      SII = getViewId(data.referenceSII);
   }

   var bands = applyBandEmphasisToIds( data, {HA:HA, OIII:OIII, SII:SII} );
   HA = bands.HA; OIII = bands.OIII; SII = bands.SII;

   if ( data.syntheticSII === true )
   {
      /* Foraxx Utility-compatible Ha/OIII bicolor formula. */
      var hoExpr = "(("+HA+")*("+OIII+"))^~(("+HA+")*("+OIII+"))";
      createMultipleRGB(data, HA, "("+hoExpr+")*"+HA+"+~("+hoExpr+")*"+OIII, OIII, "Foraxx_Classic_Bicolor");
      return;
   }

   // v1.0.9: Restore the original 3-channel Foraxx Palette Utility PIP
   // calculation. Red is guided by the O map, green by the HO map and blue
   // remains OIII. Do not simplify this to direct HSO-style channels.
   createMultipleRGB(data, "o*"+SII+"+~o*"+HA, "ho*"+HA+"+~ho*"+OIII, OIII, "Foraxx_Classic");
}

function pixelMathFcn(data, exp1, exp2, exp3, exp4, name, color){
    if(!isValidView(data.currentView))
      data.currentView = data.referenceHA;

    if(!isValidView(data.currentView)) return null;

    var m = data.currentView;

    /* v0.14.13: Robust RGB output creation.
     * Some PixInsight/V8 builds can ignore PixelMath.newImageColorSpace when a
     * new RGB image is created from a mono target, yielding a Gray final image
     * for Original/Boosted outputs.  For color outputs, explicitly create an
     * RGB ImageWindow first and execute PixelMath in-place on that RGB target.
     */
    if ( color )
    {
      var apsPMStart = apsNowMs();
      var outputName = name;
      if ( data.previewSilent === true || !isFinalPaletteOutputId( name ) )
         safeForceCloseWindowById( name );
      else
         outputName = uniqueOutputViewId( name );

      var targetWin = new ImageWindow(
         m.image.width, m.image.height,
         3, m.image.bitsPerSample, m.image.isReal,
         true, outputName );
      if ( data.previewSilent === true || !isFinalPaletteOutputId( name ) )
         targetWin.hide();
      targetWin.mainView.beginProcess( UndoFlag_NoSwapFile );
      targetWin.mainView.image.fill( 0 );
      targetWin.mainView.endProcess();

      var PC = new PixelMath;
      PC.expression = exp1;
      PC.expression1 = exp2;
      PC.expression2 = exp3;
      PC.expression3 = exp4;
      PC.useSingleExpression = false;
      PC.symbols = "";
      PC.clearImageCacheAndExit = false;
      PC.cacheGeneratedImages = false;
      PC.generateOutput = true;
      PC.singleThreaded = false;
      PC.optimization = true;
      PC.use64BitWorkingImage = false;
      PC.rescale = false;
      PC.rescaleLower = 0;
      PC.rescaleUpper = 1;
      PC.truncate = true;
      PC.truncateLower = 0;
      PC.truncateUpper = 1;
      PC.createNewImage = false;
      // RC5.2: the output window already exists; explicitly show/hide it after
      // execution instead of letting PixelMath manage window visibility.
      PC.showNewImage = false;
      PC.executeOn( targetWin.mainView, false /*swapFile */ );
      apsProfileLog( "PixelMath RGB " + name, apsPMStart );

      if ( data.previewSilent === true )
         targetWin.hide();
      else
         targetWin.show();

      return targetWin.mainView;
    }

    var beforeIds = [];
    var windowsBefore = ImageWindow.windows;
    for ( var i = 0; i < windowsBefore.length; ++i )
      beforeIds.push( windowsBefore[i].mainView.id );

    var apsPMStart = apsNowMs();
    var P = new PixelMath;
    P.expression = exp1;
    P.expression1 = exp2;
    P.expression2 = exp3;
    P.expression3 = exp4;
    P.useSingleExpression = true;
    P.symbols = "";
    P.clearImageCacheAndExit = false;
    P.cacheGeneratedImages = false;
    P.generateOutput = true;
    P.singleThreaded = false;
    P.optimization = true;
    P.use64BitWorkingImage = false;
    P.rescale = false;
    P.rescaleLower = 0;
    P.rescaleUpper = 1;
    P.truncate = true;
    P.truncateLower = 0;
    P.truncateUpper = 1;
    P.createNewImage = true;
    P.showNewImage = !(data.previewSilent === true);
    P.newImageId = name;
    P.newImageWidth = 0;
    P.newImageHeight = 0;
    P.newImageAlpha = false;
    P.newImageColorSpace = PixelMath.prototype.SameAsTarget;
    P.newImageSampleFormat = PixelMath.prototype.SameAsTarget;

    P.executeOn(m, false /*swapFile */);
    apsProfileLog( "PixelMath Gray " + name, apsPMStart );

    var createdView = null;
    var windowsAfter = ImageWindow.windows;
    for ( var j = 0; j < windowsAfter.length; ++j )
    {
      var w = windowsAfter[j];
      var id = w.mainView.id;
      if ( beforeIds.indexOf( id ) < 0 && (id == name || id.indexOf( name ) == 0) )
         createdView = w.mainView;
    }

    if ( !isValidView( createdView ) )
    {
      var v = View.viewById( name );
      if ( isValidView( v ) )
         createdView = v;
    }

    if ( data.previewSilent === true && isValidView( createdView ) && isValidWindow( createdView.window ) )
      createdView.window.hide();

    return createdView;
}

function NBChannelExtraction(vista, haId, siiId, oiiiId){
   if ( apsDebugEnabled() ) Console.noteln("NBChannelExtraction");

   haId = haId || APS_OSC_HA_NAME;
   siiId = siiId || APS_OSC_SII_NAME;
   oiiiId = oiiiId || APS_OSC_OIII_NAME;

   // RC2: never use user-facing _HA/_SII/_OIII names for internal OSC
   // extraction. DBXtract users can legitimately have those views open.
   safeForceCloseWindowById( haId );
   safeForceCloseWindowById( siiId );
   safeForceCloseWindowById( oiiiId );

   var m = vista;
   m.beginProcess();

   var P = new ChannelExtraction;
   P.colorSpace = ChannelExtraction.prototype.RGB;
   P.channels = [ // enabled, id
      [true, haId],
      [true, siiId],
      [true, oiiiId]
   ];
   P.sampleFormat = ChannelExtraction.prototype.SameAsSource;
   P.inheritAstrometricSolution = false;

   P.executeOn(m, false /*swapFile */);
   m.endProcess();
}

function linearFit(view, reference){
   if (!isValidView(view) || reference == null || reference.length == 0) return false;

   view.beginProcess();

   var P = new LinearFit;
   P.referenceViewId = reference;
   P.rejectLow = 0.000000;
   P.rejectHigh = 0.920000;

   P.executeOn(view, false /*swapFile */);
   view.endProcess();
   return true;
}

function computeNormalizationStats( view )
{
   if ( !isValidView( view ) )
      return null;

   var img = view.image;
   var w = img.width, h = img.height;
   var maxSamples = 120000;
   var step = Math.max( 1, Math.floor( Math.sqrt( (w*h)/maxSamples ) ) );
   var values = [];
   var sum = 0, sum2 = 0, n = 0;

   for ( var y = 0; y < h; y += step )
      for ( var x = 0; x < w; x += step )
      {
         var v = img.sample( x, y, 0 );
         if ( isFinite( v ) )
         {
            if ( v < 0 ) v = 0;
            if ( v > 1 ) v = 1;
            values.push( v );
            sum += v;
            sum2 += v*v;
            ++n;
         }
      }

   if ( n < 16 )
      return null;

   values.sort( function(a,b){ return a-b; } );
   function q( p )
   {
      var k = Math.max( 0, Math.min( values.length-1, Math.floor( p*(values.length-1) ) ) );
      return values[k];
   }

   var mean = sum/n;
   var sigma = Math.sqrt( Math.max( 0, sum2/n - mean*mean ) );
   var p25 = q(0.25), p50 = q(0.50), p90 = q(0.90), p98 = q(0.98);
   var signal = Math.max( 0.00001, p90 - p25 );
   var saturationPenalty = (p98 > 0.98) ? 0.55 : (p98 > 0.94 ? 0.78 : 1.0);
   var noisePenalty = 1.0/(1.0 + Math.max(0, p25)*2.0);
   var score = (signal/(0.010 + Math.max(0.000001, sigma))) * saturationPenalty * noisePenalty;

   return { mean:mean, sigma:sigma, p25:p25, median:p50, p90:p90, p98:p98, signal:signal, score:score };
}

function chooseAutoNormalizationReference( data )
{
   var candidates = [];
   if ( isValidView( data.referenceHA ) )
      candidates.push( {mode:NORMALIZATION_HA, name:"Ha", view:data.referenceHA} );
   if ( isValidView( data.referenceSII ) )
      candidates.push( {mode:NORMALIZATION_SII, name:"SII", view:data.referenceSII} );
   if ( isValidView( data.referenceOIII ) )
      candidates.push( {mode:NORMALIZATION_OIII, name:"OIII", view:data.referenceOIII} );

   if ( candidates.length == 0 )
      return NORMALIZATION_NONE;

   var best = candidates[0];
   best.stats = computeNormalizationStats( best.view );
   if ( best.stats == null )
      best.stats = {score:-1};

   for ( var i = 1; i < candidates.length; ++i )
   {
      candidates[i].stats = computeNormalizationStats( candidates[i].view );
      if ( candidates[i].stats == null )
         candidates[i].stats = {score:-1};
      if ( candidates[i].stats.score > best.stats.score )
         best = candidates[i];
   }

   // v0.13.99: In OSC data Ha is usually the most reliable visual anchor.
   // Auto still evaluates all channels, but keeps Ha unless OIII/SII are
   // significantly better. This avoids selecting SII just because it has
   // slightly cleaner statistics but weaker practical signal.
   var haCandidate = null;
   for ( var h = 0; h < candidates.length; ++h )
      if ( candidates[h].mode == NORMALIZATION_HA )
      {
         haCandidate = candidates[h];
         break;
      }

   if ( haCandidate != null && haCandidate.stats != null && best.stats != null )
   {
      var haScore = haCandidate.stats.score != null ? haCandidate.stats.score : -1;
      var bestScore = best.stats.score != null ? best.stats.score : -1;
      if ( haScore > 0 && bestScore > 0 && haScore >= 0.70*bestScore )
         best = haCandidate;
   }

   Console.noteln( "Auto normalization reference: ", best.name );
   if ( data.previewDebugWindows )
   {
      for ( var j = 0; j < candidates.length; ++j )
      {
         var st = candidates[j].stats;
         Console.writeln( "  ", candidates[j].name,
                          " score=", st.score.toFixed ? st.score.toFixed(4) : st.score,
                          " median=", st.median != null ? st.median.toFixed(5) : "n/a",
                          " sigma=", st.sigma != null ? st.sigma.toFixed(5) : "n/a",
                          " p90=", st.p90 != null ? st.p90.toFixed(5) : "n/a" );
      }
   }

   data.lastAutoNormalizationReference = best.name;
   return best.mode;
}

function applyNormalizationByMode( data, mode )
{
   switch ( mode )
   {
      case NORMALIZATION_HA:
         linearFit(data.referenceSII, getViewId(data.referenceHA));
         linearFit(data.referenceOIII, getViewId(data.referenceHA));
         break;

      case NORMALIZATION_SII:
         linearFit(data.referenceHA, getViewId(data.referenceSII));
         linearFit(data.referenceOIII, getViewId(data.referenceSII));
         break;

      case NORMALIZATION_OIII:
         linearFit(data.referenceHA, getViewId(data.referenceOIII));
         linearFit(data.referenceSII, getViewId(data.referenceOIII));
         break;
   }
}

function applyLinearFit(data){
   if (!data.linearFit) return;

   if ( apsDebugEnabled() ) Console.noteln("applyNormalization");

   if (!data.isOSC){
      var oldSilent = data.previewSilent;
      data.previewSilent = true;
      if(isValidView(data.referenceSII)){
         data.currentView = data.referenceSII;
         data.referenceSII = createSingleRGB(data, data.referenceSII.id, PREVIEW_PREFIX + "SII_LF");
      }

      if(isValidView(data.referenceOIII)){
         data.currentView = data.referenceOIII;
         data.referenceOIII = createSingleRGB(data, data.referenceOIII.id, PREVIEW_PREFIX + "OIII_LF");
      }

      if(isValidView(data.referenceHA)){
        data.currentView = data.referenceHA;
        data.referenceHA = createSingleRGB(data, data.referenceHA.id, PREVIEW_PREFIX + "HA_LF");
      }
      data.previewSilent = oldSilent;
   }

   var mode = data.linearFit;
   if ( mode == NORMALIZATION_AUTO )
      mode = chooseAutoNormalizationReference( data );

   applyNormalizationByMode( data, mode );
}

function createSingleRGB(data, expresion, name){
   return pixelMathFcn(data, expresion, "", "", "", name, false);
}

function createMultipleRGB(data, exp1, exp2, exp3, name){
   var finalName = isFinalPaletteOutputId( name ) ? resolveFinalOutputViewId( name ) : name;
   var workingId = finalName;
   if ( isFinalPaletteOutputId( name ) && shouldUseLinearRefinedFinalOutput() )
      workingId = uniqueOutputViewId( finalName + "__APS_BASE" );

   var outView = pixelMathFcn(data, exp1, exp2, exp3, "", workingId, true);

   // Studio behavior: final images should match the refined large preview.
   // Resolve the actual created output view (including auto-suffixed ids such as
   // HOO_Classic_Soft_1 when HOO_Classic_Soft already exists) before applying the
   // unified refinement pipeline.
   if ( isValidView( outView ) && isFinalPaletteOutputId( name ) )
      return finalizeGeneratedPaletteOutput( outView, finalName, true );

   return outView;
}

function debugPreviewFinalComparison( data, finalView )
{
   if ( !(data.previewFinalDebug || APS_DEBUG_PREVIEW_FINAL_PARITY) )
      return;

   apsShowConsoleIfDebug();
   Console.noteln( "AutoPalette Studio preview/final debug" );
   Console.writeln( "  Selected palette index: ", data.selectedPreviewPalette );
   Console.writeln( "  Selected boosted: ", data.selectedPreviewBoosted ? "true" : "false" );
   Console.writeln( "  Preview source id: ", data.previewDebugSourceViewId );
   Console.writeln( "  Preview parameter key: ", data.previewDebugParameterKey );
   Console.writeln( "  Final output id: ", isValidView(finalView) ? finalView.id : "<invalid>" );
   Console.writeln( "  Effective controls:" );
   Console.writeln( "    SCNR=", formatFloat(data.previewSCNR,3),
                    " OIII=", formatFloat(data.previewOIIIBoost,3),
                    " SII=", formatFloat(data.previewSIIBoost,3) );
   Console.writeln( "    Shadows=", formatFloat(data.previewShadowPoint,3),
                    " HighlightRed=", formatFloat(data.previewHighlightReduction,3),
                    " Brightness=", formatFloat(data.previewBrightness,3),
                    " Contrast=", formatFloat(data.previewContrast,3) );
   Console.writeln( "    Saturation=", formatFloat(data.previewSaturation,3),
                    " CyanGold=", formatFloat(data.previewCyanGoldBalance,3),
                    " RedYellow=", formatFloat(data.previewRedYellowBalance,3) );
   Console.writeln( "    GoldAccent enabled=", data.previewEnableSIIAccent ? "true" : "false",
                    " value=", formatFloat(data.previewSIIHighlightAccent,3),
                    " active=", data.previewSIIAccentActive ? "true" : "false" );

   if ( isValidView( finalView ) )
      Console.writeln( "  Final stats: ", previewStatsString( finalView ) );

   var sourceView = null;
   if ( data.previewDebugSourceViewId != null && data.previewDebugSourceViewId.length > 0 )
      sourceView = View.viewById( data.previewDebugSourceViewId );

   if ( !isValidView( sourceView ) )
   {
      Console.warningln( "  Debug preview source view not available. Create Previews must remain available until Generate Final Image is pressed." );
      return;
   }

   if ( sourceView.image.numberOfChannels != 3 )
   {
      Console.warningln( "  Debug preview source is not RGB: ", sourceView.id );
      return;
   }

   var outId = "APS_DEBUG_PREVIEW_REFINED";
   safeForceCloseWindowById( outId );
   var exprs = buildPreviewRefinementExpressionsForSource( sourceView.id + "[0]", sourceView.id + "[1]", sourceView.id + "[2]", true );
   var tmpData = new parametersPrototype();
   tmpData.setDefaults();
   tmpData.currentView = sourceView;
   tmpData.referenceHA = sourceView;
   tmpData.previewSilent = false;
   var debugView = pixelMathFcn( tmpData, exprs[0], exprs[1], exprs[2], "", outId, true );
   if ( isValidView( debugView ) )
   {
      if ( data.previewAutoStretch )
         autoStretchPreviewView( debugView );
      Console.writeln( "  Debug preview refined id: ", debugView.id );
      Console.writeln( "  Debug preview refined stats: ", previewStatsString( debugView ) );
   }
   else
      Console.warningln( "  Could not create APS_DEBUG_PREVIEW_REFINED." );

   if ( isValidView( finalView ) )
   {
      var finalDbgId = "APS_DEBUG_FINAL_COPY";
      safeForceCloseWindowById( finalDbgId );
      var tmpFinalData = new parametersPrototype();
      tmpFinalData.setDefaults();
      tmpFinalData.currentView = finalView;
      tmpFinalData.referenceHA = finalView;
      tmpFinalData.previewSilent = false;
      var fv = pixelMathFcn( tmpFinalData, finalView.id + "[0]", finalView.id + "[1]", finalView.id + "[2]", "", finalDbgId, true );
      if ( isValidView( fv ) )
         Console.writeln( "  Debug final copy id: ", fv.id, " stats: ", previewStatsString( fv ) );
   }
}


/*
 * STUDIO PREVIEW ENGINE
 * -------------------------------------------------------------------------
 * The preview engine intentionally does not reuse the final generation calls.
 * Preview and final generation now share the same refinement expression pipeline.
 * Previews work on temporary downsampled copies; final images apply the same
 * refinements at full resolution.
 */

function safeForceCloseWindowById( id )
{
   try
   {
      if ( id == null || id.length == 0 )
         return;
      var w = ImageWindow.windowById( id );
      if ( !isValidWindow( w ) )
         return;
      // Validate mainView before closing. Some stale ImageWindow handles are
      // not null but fail on CloseImageWindow(). In that case, avoid closing.
      try
      {
         if ( w.mainView == null || w.mainView.isNull || w.mainView.id != id )
            return;
      }
      catch ( e0 )
      {
         return;
      }
      w.forceClose();
   }
   catch ( e )
   {
      // Ignore stale UI handles during rapid preview refreshes.
   }
}

function safeHideWindowById( id )
{
   try
   {
      var w = ImageWindow.windowById( id );
      if ( isValidWindow( w ) )
         w.hide();
   }
   catch ( e )
   {
   }
}

function apsProfileEnabled()
{
   return APS_PROFILE || data.previewDebugWindows || data.previewFinalDebug;
}

function apsNowMs()
{
   return (new Date()).getTime();
}

function apsProfileLog( label, startMs )
{
   if ( apsProfileEnabled() )
      Console.noteln( "[APS profile] ", label, ": ", (apsNowMs()-startMs), " ms" );
}

function apsProfileNote( label, text )
{
   if ( apsProfileEnabled() )
      Console.noteln( "[APS profile] ", label, ": ", text );
}

function apsProfileCacheNote( label, hit )
{
   if ( apsProfileEnabled() )
      Console.noteln( "[APS profile] ", label, ": ", hit ? "cache hit" : "cache miss" );
}

function getPreviewQualityLabel()
{
   switch ( data.previewQuality )
   {
      case PREVIEW_QUALITY_QUALITY: return "Quality";
      case PREVIEW_QUALITY_BALANCED: return "Balanced";
      default: return "Fast";
   }
}

function isLargeFastPreviewSource( view )
{
   return data.previewQuality == PREVIEW_QUALITY_FAST &&
          isValidView( view ) &&
          (view.image.width > APS_LARGE_IMAGE_FAST_WIDTH || view.image.height > APS_LARGE_IMAGE_FAST_HEIGHT);
}

function getPreviewDownsampleFactorForView( view )
{
   if ( isLargeFastPreviewSource( view ) )
      return 6;

   switch ( data.previewQuality )
   {
      // RC5.4.9: keep Fast unchanged, but make Balanced/Quality sharper now
      // that preview caching and color-mask reuse are fast enough for higher
      // working resolutions. IntegerResample only supports integer factors, so
      // both higher modes use factor 2, with Quality avoiding downsampling on
      // more medium-sized frames via a larger min-dimension threshold.
      case PREVIEW_QUALITY_QUALITY: return 2;
      case PREVIEW_QUALITY_BALANCED: return 2;
      default: return 4;
   }
}

function getPreviewDownsampleMinDimForView( view )
{
   if ( isLargeFastPreviewSource( view ) )
      return 1000;

   switch ( data.previewQuality )
   {
      case PREVIEW_QUALITY_QUALITY: return 4600;
      case PREVIEW_QUALITY_BALANCED: return 3200;
      default: return 1400;
   }
}



function cleanupStudioPreviewWindows()
{
   var windows = ImageWindow.windows;
   for ( var i = windows.length-1; i >= 0; --i )
   {
      var id = "";
      try { id = windows[i].mainView.id; } catch ( e0 ) { continue; }
      if ( id.indexOf( PREVIEW_PREFIX ) == 0 )
      {
         // Exported user masks must survive when AutoPalette Studio closes.
         // Runtime preview mask view is _APS_MASK_PREVIEW and is still disposable.
         if ( id.indexOf( PREVIEW_PREFIX + "MASK_" ) == 0 && id != PREVIEW_PREFIX + "MASK_PREVIEW" )
            continue;
         safeForceCloseWindowById( id );
      }
   }
}

function makeViewCopy( sourceView, newId )
{
   if ( !isValidView( sourceView ) )
      return null;

   safeForceCloseWindowById( newId );

   var img = sourceView.image;
   var win = new ImageWindow( img.width, img.height, img.numberOfChannels,
                              img.bitsPerSample, img.isReal, img.isColor, newId );
   // RC5.2: hide implementation-detail windows immediately, before any
   // expensive copy/PixelMath work, to avoid transient UI flashes.
   win.hide();
   win.mainView.beginProcess( UndoFlag_NoSwapFile );
   win.mainView.image.apply( img );
   win.mainView.endProcess();

   return win.mainView;
}


function isGrayscaleSourceView( v )
{
   return isValidView( v ) && ( !v.image.isColor || v.image.numberOfChannels == 1 );
}

function viewsHaveSameGeometry( a, b )
{
   return isValidView( a ) && isValidView( b ) &&
          a.image.width == b.image.width &&
          a.image.height == b.image.height;
}

function firstValidMaskReferenceView( haView, oiiiView, siiView, fallbackView )
{
   if ( isValidView( haView ) ) return haView;
   if ( isValidView( oiiiView ) ) return oiiiView;
   if ( isValidView( siiView ) ) return siiView;
   if ( isValidView( fallbackView ) ) return fallbackView;
   return null;
}

function getNarrowbandReferenceValidationError( haView, oiiiView, siiView, contextLabel )
{
   var ctx = (contextLabel != null && contextLabel.length > 0) ? contextLabel : "narrowband source selection";

   if ( isValidView( haView ) && !isGrayscaleSourceView( haView ) )
      return "The selected Ha view must be a grayscale/monochrome image for " + ctx + ".";
   if ( isValidView( oiiiView ) && !isGrayscaleSourceView( oiiiView ) )
      return "The selected OIII view must be a grayscale/monochrome image for " + ctx + ".";
   if ( isValidView( siiView ) && !isGrayscaleSourceView( siiView ) )
      return "The selected SII view must be a grayscale/monochrome image for " + ctx + ".";

   var ref = firstValidMaskReferenceView( haView, oiiiView, siiView, null );
   if ( isValidView( ref ) )
   {
      if ( isValidView( haView ) && !viewsHaveSameGeometry( ref, haView ) )
         return "All selected DBXtract/mono source views must have the same dimensions for " + ctx + ".";
      if ( isValidView( oiiiView ) && !viewsHaveSameGeometry( ref, oiiiView ) )
         return "All selected DBXtract/mono source views must have the same dimensions for " + ctx + ".";
      if ( isValidView( siiView ) && !viewsHaveSameGeometry( ref, siiView ) )
         return "All selected DBXtract/mono source views must have the same dimensions for " + ctx + ".";
   }

   return "";
}

function getExternalMaskValidationError( maskView, haView, oiiiView, siiView, fallbackView, contextLabel )
{
   if ( !isValidView( maskView ) )
      return "Please select a valid external grayscale mask view.";

   if ( !isGrayscaleSourceView( maskView ) )
      return "The external mask must be a grayscale/monochrome image.";

   var ref = firstValidMaskReferenceView( haView, oiiiView, siiView, fallbackView );
   if ( !isValidView( ref ) )
      return "";

   if ( maskView.image.width != ref.image.width || maskView.image.height != ref.image.height )
   {
      var ctx = (contextLabel != null && contextLabel.length > 0) ? " for " + contextLabel : "";
      return "The external mask must have the same dimensions as the selected source views" + ctx + ".";
   }

   return "";
}

function downsamplePreviewView( view )
{
   if ( !isValidView( view ) )
      return;

   /* RC3 performance: preview sources are intentionally smaller than full
    * resolution. Final image generation never uses these _APS_ preview views.
    * Fast is the default for responsive testing; Balanced/Quality can be used
    * when the user wants sharper previews.
    */
   var minDim = getPreviewDownsampleMinDimForView( view );
   if ( view.image.width < minDim && view.image.height < minDim )
      return;

   var factor = getPreviewDownsampleFactorForView( view );
   if ( factor <= 1 )
      return;

   var P = new IntegerResample;
   P.zoomFactor = -factor;
   P.downsamplingMode = 0; // Average mode; numeric value avoids undefined enum issues on some PixInsight V8 builds
   P.xResolution = 72;
   P.yResolution = 72;
   P.metric = false;
   P.forceResolution = false;
   P.gammaCorrection = false;
   P.noGUIMessages = true;
   P.executeOn( view );
}

function runPreviewPixelMathOnView( view, expression, use64Bit )
{
   if ( !isValidView( view ) )
      return;

   var P = new PixelMath;
   P.expression = expression;
   P.useSingleExpression = true;
   P.symbols = "";
   P.clearImageCacheAndExit = false;
   P.cacheGeneratedImages = false;
   P.generateOutput = true;
   P.singleThreaded = false;
   P.optimization = true;
   P.use64BitWorkingImage = use64Bit;
   P.rescale = false;
   P.truncate = true;
   P.truncateLower = 0;
   P.truncateUpper = 1;
   P.createNewImage = false;
   P.showNewImage = false;
   P.executeOn( view, false );
}

function runPreviewPixelMathOnViewWithSymbols( view, expression, symbols, use64Bit )
{
   if ( !isValidView( view ) )
      return;

   var P = new PixelMath;
   P.expression = expression;
   P.useSingleExpression = true;
   P.symbols = symbols || "";
   P.clearImageCacheAndExit = false;
   P.cacheGeneratedImages = false;
   P.generateOutput = true;
   P.singleThreaded = false;
   P.optimization = true;
   P.use64BitWorkingImage = use64Bit;
   P.rescale = false;
   P.truncate = true;
   P.truncateLower = 0;
   P.truncateUpper = 1;
   P.createNewImage = false;
   P.showNewImage = false;
   P.executeOn( view, false );
}

function runPreviewPixelMathRGBOnView( view, expressionR, expressionG, expressionB, use64Bit )
{
   if ( !isValidView( view ) )
      return;

   var P = new PixelMath;
   P.expression = expressionR;
   P.expression1 = expressionG;
   P.expression2 = expressionB;
   P.expression3 = "";
   P.useSingleExpression = false;
   P.symbols = "";
   P.clearImageCacheAndExit = false;
   P.cacheGeneratedImages = false;
   P.generateOutput = true;
   P.singleThreaded = false;
   P.optimization = true;
   P.use64BitWorkingImage = use64Bit;
   P.rescale = false;
   P.truncate = true;
   P.truncateLower = 0;
   P.truncateUpper = 1;
   P.createNewImage = false;
   P.showNewImage = false;
   P.executeOn( view, false );
}

function previewStatsString( view )
{
   if ( !isValidView( view ) )
      return "invalid view";

   var img = view.image;
   var w = img.width;
   var h = img.height;
   var n = img.numberOfChannels;
   var stepX = Math.max( 1, Math.floor( w/160 ) );
   var stepY = Math.max( 1, Math.floor( h/160 ) );
   var parts = [];

   for ( var c = 0; c < n; ++c )
   {
      var minv = 1.0;
      var maxv = 0.0;
      var sum = 0.0;
      var count = 0;

      for ( var y = 0; y < h; y += stepY )
      {
         for ( var x = 0; x < w; x += stepX )
         {
            var v = img.sample( x, y, c );
            if ( v < minv ) minv = v;
            if ( v > maxv ) maxv = v;
            sum += v;
            ++count;
         }
      }

      parts.push( "c" + c + " min=" + minv.toFixed(5) + " mean=" + (sum/count).toFixed(5) + " max=" + maxv.toFixed(5) );
   }

   return parts.join( " | " );
}

function autoStretchPreviewView( view )
{
   if ( !isValidView( view ) )
      return;

   /*
    * Preview-only destructive stretch on temporary tile images.
    * Two passes are more reliable for very linear/faint data than a fixed MTF:
    * 1) STF-like black point rescale.
    * 2) HistogramTransformation-like midtones transfer to a target median.
    */
   var bp = "iif((med($T)-2.7*sdev($T))<min($T),min($T),med($T)-2.7*sdev($T))";
   var rescaled = "max(0,min(1,($T-(" + bp + "))/(1-(" + bp + "))))";
   runPreviewPixelMathOnView( view, rescaled, true );

   var targetMedian = "0.25";
   var stretch = "iif(Med($T)<=0,$T,((Med($T)-1)*" + targetMedian + "*$T)/(Med($T)*(" + targetMedian + "+$T-1)-" + targetMedian + "*$T))";
   runPreviewPixelMathOnView( view, stretch, true );
}


function isLikelyLinearPaletteView( view )
{
   if ( !isValidView( view ) )
      return false;

   var s = computeNormalizationStats( view );
   if ( s == null )
      return false;

   /*
    * Heuristic for linear astrophotography data. A dark non-linear image can
    * still have a low median, so we also require a relatively low high
    * percentile. This avoids re-stretching already non-linear palettes while
    * catching the typical faint linear masters that otherwise render almost
    * black in the Studio preview pipeline.
    */
   return (s.median < 0.12 && s.p98 < 0.55);
}

function applyLinearInputStretchToView( view, reason, force )
{
   if ( !isValidView( view ) )
      return false;

   force = !!force;

   if ( !force && !isLikelyLinearPaletteView( view ) )
      return false;

   var apsLinearStretchTotalStart = apsNowMs();
   var before = computeNormalizationStats( view );
   if ( apsDebugEnabled() )
      Console.noteln( "Linear input stretch applied to ", view.id,
                      reason ? " (" + reason + ")" : "",
                      before ? " median=" + before.median.toFixed(5) + " p98=" + before.p98.toFixed(5) : "" );

   /*
    * Same two-step approach used by SetiAstro Perfect Palette Picker:
    * 1) STF-like black point rescale.
    * 2) Midtones transfer to a target median of 0.25.
    *
    * This is intentionally destructive only on temporary working copies, never
    * on the user's original DBXtract/mono source views.
    */
   var bp = "iif((med($T)-2.7*sdev($T))<min($T),min($T),med($T)-2.7*sdev($T))";
   var rescaled = "max(0,min(1,($T-(" + bp + "))/(1-(" + bp + "))))";
   var apsLinearRescaleStart = apsNowMs();
   runPreviewPixelMathOnView( view, rescaled, true );
   apsProfileLog( "display stretch linear rescale", apsLinearRescaleStart );

   var targetMedian = "0.25";
   var stretch = "iif(Med($T)<=0,$T,((Med($T)-1)*" + targetMedian + "*$T)/(Med($T)*(" + targetMedian + "+$T-1)-" + targetMedian + "*$T))";
   var apsLinearMtfStart = apsNowMs();
   runPreviewPixelMathOnView( view, stretch, true );
   apsProfileLog( "display stretch linear midtones", apsLinearMtfStart );
   apsProfileLog( "display stretch linear total", apsLinearStretchTotalStart );

   return true;
}


function isDirectMonoOriginalTileView( view )
{
   // RC3.12.4: Treat any DBXtract/mono Original RGB composite as a direct
   // mono original display source, including Ha/OIII-only HOO.  This lets the
   // large preview and thumbnails use the robust Bill HT display stretch for
   // linear mono Original, instead of leaving Ha/OIII-only Original too dark.
   return !data.isOSC && isValidView( view ) && view.id.indexOf( PREVIEW_PREFIX + "TILE_ORIGINAL" ) == 0;
}

function shouldUseLinkedSHODisplayStretch()
{
   return !data.isOSC && data.selectedPreviewPalette == PALETTE_ORIGINAL;
}

function computeBillUnlinkedHTChannelStats( refView, channel )
{
   if ( !isValidView( refView ) || channel < 0 || channel >= refView.image.numberOfChannels )
      return null;

   var img = refView.image;
   var w = img.width, h = img.height;
   var maxSamples = 140000;
   var step = Math.max( 1, Math.floor( Math.sqrt( (w*h)/maxSamples ) ) );
   var values = [];

   for ( var y = 0; y < h; y += step )
      for ( var x = 0; x < w; x += step )
      {
         var v = img.sample( x, y, channel );
         if ( isFinite( v ) )
         {
            if ( v < 0 ) v = 0;
            if ( v > 1 ) v = 1;
            values.push( v );
         }
      }

   if ( values.length < 32 )
      return null;

   values.sort( function(a,b){ return a-b; } );
   var med = values[Math.floor( 0.5*(values.length-1) )];
   var dev = 0.0;
   for ( var i = 0; i < values.length; ++i )
      dev += Math.abs( values[i] - med );
   dev /= values.length;

   var C = -2.8;
   var c = med + C*1.4826*dev;
   if ( c < 0 ) c = 0;
   if ( c > 1 ) c = 1;
   return { median: med, mdev: dev, c: c };
}

function billUnlinkedHTExpressionForChannel( channel, stats )
{
   if ( stats == null )
      return "$T[" + channel + "]";

   var med = formatFloat( stats.median, 12 );
   var c = formatFloat( stats.c, 12 );
   var denom = formatFloat( Math.max( 1e-8, 1.0 - stats.c ), 12 );
   return "mtf(mtf(0.20," + med + "-" + c + "),max(0,($T[" + channel + "]-" + c + ")/" + denom + "))";
}

function applyBillUnlinkedHTStretchToView( view, reason, statsReferenceView )
{
   if ( !isValidView( view ) )
      return false;

   /* RC2.1: For preview/final parity, full-resolution finals can reuse the
    * selected large-preview source as the statistics reference. The output is
    * still full resolution, but the HT Unlink stretch parameters are derived
    * from the same preview source that the user approved visually. This avoids
    * colour/brightness shifts caused by recomputing med/mdev on a different
    * resolution image.
    */
   var apsBillTotalStart = apsNowMs();
   var ref = isValidView( statsReferenceView ) ? statsReferenceView : view;

   if ( apsDebugEnabled() )
      Console.noteln( "Bill unlinked HT stretch applied to ", view.id,
                      reason ? " (" + reason + ")" : "",
                      isValidView( statsReferenceView ) ? " using stats from " + statsReferenceView.id : "" );

   if ( view.image.numberOfChannels >= 3 && ref.image.numberOfChannels >= 3 )
   {
      var apsBillStatsStart = apsNowMs();
      var s0 = computeBillUnlinkedHTChannelStats( ref, 0 );
      var s1 = computeBillUnlinkedHTChannelStats( ref, 1 );
      var s2 = computeBillUnlinkedHTChannelStats( ref, 2 );
      apsProfileLog( "display stretch Bill stats", apsBillStatsStart );
      if ( s0 != null && s1 != null && s2 != null )
      {
         var apsBillPmStart = apsNowMs();
         runPreviewPixelMathRGBOnView( view,
            billUnlinkedHTExpressionForChannel( 0, s0 ),
            billUnlinkedHTExpressionForChannel( 1, s1 ),
            billUnlinkedHTExpressionForChannel( 2, s2 ), true );
         apsProfileLog( "display stretch Bill PixelMath", apsBillPmStart );
         apsProfileLog( "display stretch Bill total", apsBillTotalStart );
         return true;
      }
   }

   var expr = "C=-2.8;B=0.20;" +
              "c=min(max(0,med($T)+C*1.4826*mdev($T)),1);" +
              "mtf(mtf(B,med($T)-c),max(0,($T-c)/~c))";

   var apsBillFallbackPmStart = apsNowMs();
   runPreviewPixelMathOnViewWithSymbols( view, expr, "C,B,c", true );
   apsProfileLog( "display stretch Bill fallback PixelMath", apsBillFallbackPmStart );
   apsProfileLog( "display stretch Bill total", apsBillTotalStart );
   return true;
}

function getSelectedPreviewStretchReferenceView()
{
   if ( data.previewDebugSourceViewId != null && data.previewDebugSourceViewId.length > 0 )
   {
      var v = View.viewById( data.previewDebugSourceViewId );
      if ( isValidView( v ) && v.image.numberOfChannels >= 3 )
         return v;
   }
   return null;
}

function applyDisplayAutoStretchToView( view, linkedRGB, reason, statsReferenceView )
{
   if ( linkedRGB )
      return applyBillUnlinkedHTStretchToView( view, reason, statsReferenceView );
   return applyLinearInputStretchToView( view, reason );
}

function createDirectMonoOriginalBoostedViewFromBase( baseView, outId, includeGoldAccent, skipAdvancedStack, stretchStatsReferenceView )
{
   if ( !isValidView( baseView ) )
      return null;

   var preId = outId + "__PRESTRETCH";
   safeForceCloseWindowById( preId );
   safeForceCloseWindowById( outId );

   var preView = makeViewCopy( baseView, preId );
   if ( !isValidView( preView ) )
      return null;

   /* v0.14.26: For direct MONO SHO Original Boosted, the old order was
    * boosted refinements -> stretch. Since boosted tone/contrast math is
    * designed for display-range data, applying it to linear SHO can clip most
    * pixels to black. Use the Bill HT Unlink stretch first, then apply boosted
    * realtime refinements on the stretched temporary RGB image.
    */
   applyBillUnlinkedHTStretchToView( preView, "direct MONO SHO boosted prestretch", stretchStatsReferenceView );

   if ( isAnyMaskActive() )
      createSelectedMaskView( preView );
   else
      gActiveStarMaskViewId = "";

   var tmpData = new parametersPrototype();
   tmpData.setDefaults();
   tmpData.currentView = preView;
   tmpData.referenceHA = preView;
   tmpData.previewSilent = true;

   var outView = pixelMathFcn( tmpData, preView.id + "[0]", preView.id + "[1]", preView.id + "[2]", "", outId, true );

   if ( isValidView( outView ) )
   {
      if ( hasBaseNonGoldPreviewRefinementsToApply() )
      {
         if ( !applyPreviewBaseRefinementsStagedToView( outView ) )
            applyPreviewBaseRefinementsUnifiedToView( outView );
      }

      var apsColorStart = apsNowMs();
      applyPreviewColorBalanceOnlyToView( outView );
      apsProfileLog( "final SCC-like color layer", apsColorStart );

      if ( !skipAdvancedStack )
      {
         if ( data.previewAdvancedLayerStack != null && data.previewAdvancedLayerStack.length > 0 )
            applyAdvancedLayerStackToView( outView );
      }
   }

   safeForceCloseWindowById( preId );
   return outView;
}

function applyLinearInputStretchToPreviewSources( pData )
{
   var any = false;
   any = applyLinearInputStretchToView( pData.referenceHA, "preview Ha" ) || any;
   any = applyLinearInputStretchToView( pData.referenceOIII, "preview OIII" ) || any;
   any = applyLinearInputStretchToView( pData.referenceSII, "preview SII" ) || any;
   any = applyLinearInputStretchToView( pData.previewOriginal, "preview Original" ) || any;

   /* v0.14.21: keep direct MONO Original source copies in their linear state.
    * The direct SHO composite is now stretched later with a linked RGB display
    * transform, which avoids overstretching the Ha/green channel.
    */
   return any;
}

function cleanupFinalLinearWorkingViews()
{
   safeForceCloseWindowById( PREVIEW_PREFIX + "FINAL_RGB_LINEAR" );
   safeForceCloseWindowById( PREVIEW_PREFIX + "FINAL_HA_LINEAR" );
   safeForceCloseWindowById( PREVIEW_PREFIX + "FINAL_OIII_LINEAR" );
   safeForceCloseWindowById( PREVIEW_PREFIX + "FINAL_SII_LINEAR" );
   safeForceCloseWindowById( PREVIEW_PREFIX + "HA_LF" );
   safeForceCloseWindowById( PREVIEW_PREFIX + "OIII_LF" );
   safeForceCloseWindowById( PREVIEW_PREFIX + "SII_LF" );
}

function makeLinearFinalWorkingCopyIfNeeded( view, outId, reason, force )
{
   if ( !isValidView( view ) )
      return view;

   force = !!force;

   if ( !force && !isLikelyLinearPaletteView( view ) )
      return view;

   safeForceCloseWindowById( outId );
   var copy = makeViewCopy( view, outId );
   if ( !isValidView( copy ) )
      return view;

   applyLinearInputStretchToView( copy, reason, force );
   if ( isValidWindow( copy.window ) )
      copy.window.hide();
   return copy;
}

function prepareFinalLinearInputWorkingViews( data, forceLinearInput )
{
   cleanupFinalLinearWorkingViews();

   /* v1.0.7: Final generation follows the linear/non-linear decision already
    * made by the preview pipeline. Full-resolution masters can have bright
    * stars or high p98 values that make the heuristic reject them even though
    * the reduced preview sources were correctly detected as linear. When the
    * approved preview used the linear display workflow, force the same
    * temporary working-copy stretch for the final sources.
    */
   forceLinearInput = !!forceLinearInput;

   var changed = false;
   var v;
   var originalSource = data.currentView;
   data.finalOriginalView = null;

   v = makeLinearFinalWorkingCopyIfNeeded( originalSource, PREVIEW_PREFIX + "FINAL_RGB_LINEAR", "final RGB/Original", forceLinearInput );
   if ( isValidView( v ) )
   {
      data.finalOriginalView = v;
      if ( v !== originalSource ) changed = true;
   }

   v = makeLinearFinalWorkingCopyIfNeeded( data.referenceHA, PREVIEW_PREFIX + "FINAL_HA_LINEAR", "final Ha", forceLinearInput );
   if ( isValidView( v ) && v !== data.referenceHA ) { data.referenceHA = v; changed = true; }

   v = makeLinearFinalWorkingCopyIfNeeded( data.referenceOIII, PREVIEW_PREFIX + "FINAL_OIII_LINEAR", "final OIII", forceLinearInput );
   if ( isValidView( v ) && v !== data.referenceOIII ) { data.referenceOIII = v; changed = true; }

   v = makeLinearFinalWorkingCopyIfNeeded( data.referenceSII, PREVIEW_PREFIX + "FINAL_SII_LINEAR", "final SII", forceLinearInput );
   if ( isValidView( v ) && v !== data.referenceSII ) { data.referenceSII = v; changed = true; }

   if ( changed )
   {
      if ( apsDebugEnabled() )
         Console.warningln( "Linear input data detected. AutoPalette Studio generated non-linear temporary working channels before palette composition." );
      if ( !data.isOSC && isValidView( data.referenceHA ) )
         data.currentView = data.referenceHA;
      else
         data.currentView = originalSource;
   }

   return changed;
}

function cleanupStudioPreviewSourceWindows()
{
   var windows = ImageWindow.windows;
   for ( var i = windows.length-1; i >= 0; --i )
   {
      var id = "";
      try { id = windows[i].mainView.id; } catch ( e0 ) { continue; }

      // v0.13.43: Keep the reduced narrowband guide channels alive after
      // Create Previews. Advanced Channel Lightness needs _APS_SII as a
      // same-geometry source for the large preview. These windows remain
      // hidden implementation details and are removed by cleanupStudioPreviewWindows()
      // when previews are regenerated.
      if ( id == PREVIEW_PREFIX + "HA" ||
           id == PREVIEW_PREFIX + "OIII" ||
           id == PREVIEW_PREFIX + "SII" ||
           id == PREVIEW_PREFIX + "ORIGINAL" ||
           id == PREVIEW_PREFIX + "ORIG_HA" ||
           id == PREVIEW_PREFIX + "ORIG_OIII" ||
           id == PREVIEW_PREFIX + "ORIG_SII" )
         continue;

      if ( id.indexOf( PREVIEW_PREFIX ) == 0 && id.indexOf( PREVIEW_PREFIX + "TILE_" ) != 0 )
         safeForceCloseWindowById( id );
   }
}

function createPreviewSourceData( sourceData )
{
   var pData = new parametersPrototype();
   pData.setDefaults();
   pData.currentView = null;
   pData.referenceHA = null;
   pData.referenceOIII = null;
   pData.referenceSII = null;
   pData.typePalette = sourceData.typePalette;
   pData.isOSC = false;
   pData.autoClose = true;
   pData.allCombinations = false;
   pData.blendMode = sourceData.blendMode;
   pData.linearFit = 0;
   pData.previewAutoStretch = false;
   pData.linearInputAutoStretchEnabled = false;
   pData.previewDebugWindows = sourceData.previewDebugWindows || APS_DEBUG_KEEP_PREVIEW_WINDOWS;
   pData.previewOriginal = null;
   pData.originalReferenceHA = null;
   pData.originalReferenceOIII = null;
   pData.originalReferenceSII = null;

   if ( sourceData.isOSC )
   {
      if ( !isValidView( sourceData.currentView ) || !sourceData.currentView.image.isColor )
      {
         (new MessageBox("There must be one RGB image for OSC preview generation", TITLE, StdIcon_Error, StdButton_Ok)).execute();
         return null;
      }

      /*
       * RC3.3 parity fix:
       * Extract OSC channels at full resolution first, then normalize and
       * downsample the working preview bands. Downsampling the RGB source before
       * channel extraction/normalization made some OSC non-linear previews diverge
       * from the full-resolution final output, especially with boosted controls.
       */
      if ( sourceData.previewDebugWindows ) Console.writeln("Preview source: copying OSC view ", sourceData.currentView.id);
      var oscPreview = makeViewCopy( sourceData.currentView, PREVIEW_PREFIX + "OSC_SOURCE" );
      if ( !isValidView( oscPreview ) )
      {
         Console.warningln("Could not create temporary OSC preview source.");
         return null;
      }

      if ( sourceData.previewDebugWindows ) Console.writeln("Preview source stats [OSC full]: ", previewStatsString(oscPreview));
      pData.previewOriginal = makeViewCopy( oscPreview, PREVIEW_PREFIX + "ORIGINAL" );

      NBChannelExtraction( oscPreview, APS_OSC_HA_NAME, APS_OSC_SII_NAME, APS_OSC_OIII_NAME );
      safeHideWindowById( APS_OSC_HA_NAME );
      safeHideWindowById( APS_OSC_SII_NAME );
      safeHideWindowById( APS_OSC_OIII_NAME );
      pData.referenceHA = makeViewCopy( View.viewById(APS_OSC_HA_NAME), PREVIEW_PREFIX + "HA" );
      pData.referenceSII = makeViewCopy( View.viewById(APS_OSC_SII_NAME), PREVIEW_PREFIX + "SII" );
      pData.referenceOIII = makeViewCopy( View.viewById(APS_OSC_OIII_NAME), PREVIEW_PREFIX + "OIII" );

      if ( sourceData.previewDebugWindows )
      {
         Console.writeln("Preview source stats [HA]: ", previewStatsString(pData.referenceHA));
         Console.writeln("Preview source stats [SII]: ", previewStatsString(pData.referenceSII));
         Console.writeln("Preview source stats [OIII]: ", previewStatsString(pData.referenceOIII));
      }

      safeForceCloseWindowById( APS_OSC_HA_NAME );
      safeForceCloseWindowById( APS_OSC_SII_NAME );
      safeForceCloseWindowById( APS_OSC_OIII_NAME );
      safeForceCloseWindowById( PREVIEW_PREFIX + "OSC_SOURCE" );
   }
   else
   {
      if ( !isValidView( sourceData.referenceHA ) || !isValidView( sourceData.referenceOIII ) )
      {
         (new MessageBox("There must be at least valid Ha and OIII images for preview generation", TITLE, StdIcon_Error, StdButton_Ok)).execute();
         return null;
      }

      var previewNbError = getNarrowbandReferenceValidationError( sourceData.referenceHA, sourceData.referenceOIII, sourceData.referenceSII, "preview generation" );
      if ( previewNbError.length > 0 )
      {
         (new MessageBox( previewNbError, TITLE, StdIcon_Error, StdButton_Ok )).execute();
         return null;
      }

      pData.referenceHA = makeViewCopy( sourceData.referenceHA, PREVIEW_PREFIX + "HA" );
      pData.referenceOIII = makeViewCopy( sourceData.referenceOIII, PREVIEW_PREFIX + "OIII" );
      pData.originalReferenceHA = makeViewCopy( sourceData.referenceHA, PREVIEW_PREFIX + "ORIG_HA" );
      pData.originalReferenceOIII = makeViewCopy( sourceData.referenceOIII, PREVIEW_PREFIX + "ORIG_OIII" );
      if ( isValidView( sourceData.referenceSII ) )
      {
         pData.referenceSII = makeViewCopy( sourceData.referenceSII, PREVIEW_PREFIX + "SII" );
         pData.originalReferenceSII = makeViewCopy( sourceData.referenceSII, PREVIEW_PREFIX + "ORIG_SII" );
         pData.syntheticSII = false;
      }
      else
      {
         /* Bi-color Ha/OIII workflow: keep SII-dependent previews available with
          * a synthetic sulfur-like channel. Classic palettes use the selected blend;
          * Foraxx variants override this with an OSC-like proxy in previewExpressionSet().
          */
         pData.currentView = pData.referenceHA;
         pData.referenceSII = createSyntheticSIIFromHaOIII( pData, PREVIEW_PREFIX + "SII", "preview generation" );
         pData.syntheticSII = true;
      }
      pData.previewOriginal = makeViewCopy( sourceData.referenceHA, PREVIEW_PREFIX + "ORIGINAL" );
   }

   if ( !isValidView( pData.referenceHA ) || !isValidView( pData.referenceOIII ) )
      return null;

   if ( isExternalMaskActive() )
   {
      var previewMaskError = getExternalMaskValidationError( data.previewExternalMaskView,
                                                             sourceData.referenceHA, sourceData.referenceOIII, sourceData.referenceSII,
                                                             sourceData.currentView, "preview generation" );
      if ( previewMaskError.length > 0 )
      {
         (new MessageBox( previewMaskError, TITLE, StdIcon_Error, StdButton_Ok )).execute();
         return null;
      }
      invalidateStarMaskCache();
   }

   if ( sourceData.linearFit )
   {
      var previewNormMode = sourceData.linearFit;
      pData.lastAutoNormalizationReference = "";
      if ( previewNormMode == NORMALIZATION_AUTO )
         previewNormMode = chooseAutoNormalizationReference( pData );
      applyNormalizationByMode( pData, previewNormMode );
      if ( sourceData.linearFit == NORMALIZATION_AUTO )
         sourceData.lastAutoNormalizationReference = pData.lastAutoNormalizationReference;
   }

   if ( isValidView( pData.referenceHA ) ) downsamplePreviewView( pData.referenceHA );
   if ( isValidView( pData.referenceOIII ) ) downsamplePreviewView( pData.referenceOIII );
   if ( isValidView( pData.previewOriginal ) ) downsamplePreviewView( pData.previewOriginal );
   if ( isValidView( pData.referenceSII ) ) downsamplePreviewView( pData.referenceSII );
   if ( isValidView( pData.originalReferenceHA ) ) downsamplePreviewView( pData.originalReferenceHA );
   if ( isValidView( pData.originalReferenceOIII ) ) downsamplePreviewView( pData.originalReferenceOIII );
   if ( isValidView( pData.originalReferenceSII ) ) downsamplePreviewView( pData.originalReferenceSII );

   pData.currentView = pData.referenceHA;

   if ( sourceData.previewDebugWindows )
      Console.writeln("Preview source data ready. HA=", getViewId(pData.referenceHA),
                      " OIII=", getViewId(pData.referenceOIII),
                      " SII=", getViewId(pData.referenceSII));

   pData.linearInputAutoStretchEnabled = applyLinearInputStretchToPreviewSources( pData );
   pData.previewAutoStretch = (pData.linearInputAutoStretchEnabled === true);

   return pData;
}

function previewExpressionSet( data, index )
{
   var HA = getViewId(data.referenceHA);
   var OIII = getViewId(data.referenceOIII);
   var SII = getViewId(data.referenceSII);

   if ( HA.length == 0 || OIII.length == 0 )
      return null;

   var syntheticSII = (data.syntheticSII === true);
   if ( SII.length == 0 )
   {
      syntheticSII = true;
      SII = syntheticSIIExpression( data, HA, OIII );
   }

   var bands = applyBandEmphasisToIds( data, {HA:HA, OIII:OIII, SII:SII} );
   HA = bands.HA;
   OIII = bands.OIII;
   SII = bands.SII;

   var ps = data.pipStrength;
   var o  = pipMapExpression( OIII, ps );
   var h  = pipMapExpression( HA, ps );
   var s  = pipMapExpression( SII, ps );
   var ho = pipMapExpression( "(" + HA + ")*(" + OIII + ")", ps );
   var hs = pipMapExpression( "(" + HA + ")*(" + SII + ")", ps );
   var os = pipMapExpression( "(" + OIII + ")*(" + SII + ")", ps );

   /* Ha/OIII bi-color routing. Classic Foraxx keeps the dedicated two-channel
    * expression inspired by Foraxx Utility. Foraxx variants keep their normal
    * palette formulas, but use a contrast synthetic SII proxy so they are not
    * all visually identical to Classic Foraxx.
    */
   if ( syntheticSII && index == PALETTE_CLASSIC_FORAXX )
      return [HA, ho+"*"+HA+"+~"+ho+"*"+OIII, OIII];

   if ( syntheticSII && index == PALETTE_FORAXX_HOS )
      return subtleForaxxHOSExpressionSet( data, HA, OIII );

   if ( syntheticSII && index >= PALETTE_FORAXX_SHO && index <= PALETTE_FORAXX_SOH )
   {
      // HA and OIII have already received their band-emphasis factors above.
      // Build an OSC-like synthetic SII from those working expressions, then soften
      // OIII only for PIP map generation. Output channels still use real OIII.
      SII = factorExpression( syntheticSIIOscLikeExpression( data, HA, OIII ), data.siiEmphasis );
      var OIII_PIP = factorExpression( OIII, syntheticForaxxOIIIMaskFactor( data ) );
      o  = pipMapExpression( OIII_PIP, ps );
      h  = pipMapExpression( HA, ps );
      s  = pipMapExpression( SII, ps );
      ho = pipMapExpression( "(" + HA + ")*(" + OIII_PIP + ")", ps );
      hs = pipMapExpression( "(" + HA + ")*(" + SII + ")", ps );
      os = pipMapExpression( "(" + OIII_PIP + ")*(" + SII + ")", ps );
   }

   switch ( index )
   {
      case PALETTE_CLASSIC_HOO:
         switch ( data.blendMode )
         {
            case 1: return [HA, ".5*"+HA+"+.5*"+OIII, OIII];
            case 2: return [HA, ".6*"+HA+"+.4*"+OIII, OIII];
            case 3: return [HA, ".7*"+HA+"+.3*"+OIII, OIII];
            default: return [HA, OIII, OIII];
         }
      case PALETTE_CLASSIC_SHO:
         switch ( data.blendMode )
         {
            case 1: return [".5*"+SII+"+.5*"+HA, ".5*"+HA+"+.5*"+OIII, OIII];
            case 2: return [".6*"+SII+"+.4*"+HA, ".6*"+HA+"+.4*"+OIII, OIII];
            case 3: return [".7*"+SII+"+.3*"+HA, ".7*"+HA+"+.3*"+OIII, OIII];
            default: return [SII, HA, OIII];
         }
      case PALETTE_CLASSIC_HSO:
         switch ( data.blendMode )
         {
            case 1: return [".5*"+HA+"+.5*"+OIII, ".5*"+SII+"+.5*"+HA, OIII];
            case 2: return [".6*"+HA+"+.4*"+OIII, ".6*"+SII+"+.4*"+HA, OIII];
            case 3: return [".7*"+HA+"+.3*"+OIII, ".7*"+SII+"+.3*"+HA, OIII];
            default: return [HA, SII, OIII];
         }
      case PALETTE_CLASSIC_FORAXX:
         return [o+"*"+SII+"+~"+o+"*"+HA, ho+"*"+HA+"+~"+ho+"*"+OIII, OIII];
      case PALETTE_FORAXX_SHO:
         return [o+"*"+SII+"+~"+o+"*"+HA, ho+"*"+HA+"+~"+ho+"*"+OIII, OIII];
      case PALETTE_FORAXX_HOS:
         return [HA, OIII, o+"*"+SII+"+~"+o+"*"+OIII];
      case PALETTE_FORAXX_OHS:
         return [o+"*"+OIII+"+~"+o+"*"+HA, ho+"*"+HA+"+~"+ho+"*"+OIII, o+"*"+SII+"+~"+o+"*"+OIII];
      case PALETTE_FORAXX_HOO:
         return [HA, OIII, o+"*"+OIII+"+~"+o+"*"+SII];
      case PALETTE_FORAXX_HSO:
         return [HA, ho+"*"+SII+"+~"+ho+"*"+OIII, OIII];
      case PALETTE_FORAXX_OSH:
         return [o+"*"+OIII+"+~"+o+"*"+HA, ho+"*"+SII+"+~"+ho+"*"+OIII, o+"*"+HA+"+~"+o+"*"+OIII];
      case PALETTE_FORAXX_SOH:
         return [o+"*"+SII+"+~"+o+"*"+HA, OIII, o+"*"+HA+"+~"+o+"*"+SII];
   }

   return [HA, OIII, OIII];
}


#define APS_NONLINEAR_SLIDER_RESPONSE 1.25

function getLinearSafeOneValue( value, neutral, strength )
{
   value = (value != null) ? value : neutral;
   if ( data.linearInputAutoStretchEnabled === true )
      return neutral + (value-neutral)*strength;

   /* RC3.3: non-linear data does not need the linear safety reduction.
    * Give the realtime controls a stronger perceived response while keeping
    * the UI ranges unchanged.
    */
   return neutral + (value-neutral)*APS_NONLINEAR_SLIDER_RESPONSE;
}

function getLinearSafeZeroValue( value, strength )
{
   value = (value != null) ? value : 0.0;
   if ( data.linearInputAutoStretchEnabled === true )
      return value*strength;

   return value*APS_NONLINEAR_SLIDER_RESPONSE;
}

function getCurrentPreviewRefinementValues( includeGoldAccent )
{
   /* RC3.4: keep linear boosted controls safe, but give them a little more
    * perceived response than RC3. The Ha+OIII DBXtract/mono branch without real
    * SII is treated separately because the synthetic-SII boosted path can burn
    * highlights if brightness/contrast are pushed too much before/after the
    * display stretch.
    */
   var linearSyntheticHOO = isLinearSyntheticHOOBoostWorkflow();

   // RC3.12.4: Non-synthetic linear OSC previews were too conservative even
   // in Aggressive mode, while linear Ha/OIII-only DBXtract could feel too
   // strong after its display stretch.  Keep the two branches separated.
   var fSCNR = linearSyntheticHOO ? 0.34 : 0.68;
   var fOIII = linearSyntheticHOO ? 0.25 : 0.56;
   var fSII  = linearSyntheticHOO ? 0.20 : 0.56;
   var fShadow = linearSyntheticHOO ? 0.20 : 0.48;
   var fHighlight = linearSyntheticHOO ? 0.12 : 0.34;
   var fBrightness = linearSyntheticHOO ? 0.12 : 0.56;
   var fContrast = linearSyntheticHOO ? 0.20 : 0.56;
   var fSaturation = linearSyntheticHOO ? 0.24 : 0.56;
   var fColor = linearSyntheticHOO ? 0.18 : 0.42;
   var fGold = linearSyntheticHOO ? 0.18 : 0.42;
   var fLightness = linearSyntheticHOO ? 0.24 : 0.56;

   return {
      scnr: getLinearSafeZeroValue( data.previewSCNR, fSCNR ),
      oiiiBoost: getLinearSafeOneValue( data.previewOIIIBoost, 1.0, fOIII ),
      siiBoost: getLinearSafeOneValue( data.previewSIIBoost, 1.0, fSII ),
      shadowPoint: getLinearSafeOneValue( data.previewShadowPoint, 1.0, fShadow ),
      highlightReduction: getLinearSafeOneValue( data.previewHighlightReduction, 1.0, fHighlight ),
      brightness: getLinearSafeOneValue( data.previewBrightness, 1.0, fBrightness ),
      contrast: getLinearSafeOneValue( data.previewContrast, 1.0, fContrast ),
      saturation: getLinearSafeOneValue( data.previewSaturation, 1.0, fSaturation ),
      cyanGoldBalance: getLinearSafeZeroValue( data.previewCyanGoldBalance, fColor ),
      redYellowBalance: getLinearSafeZeroValue( data.previewRedYellowBalance, fColor ),
      goldAccent: (includeGoldAccent && data.previewEnableSIIAccent && data.previewSIIHighlightAccent != null) ? getLinearSafeZeroValue( data.previewSIIHighlightAccent, fGold ) : 0.0,
      channelLightnessAmount: (data.previewEnableChannelLightness && data.previewChannelLightnessAmount != null) ? getLinearSafeZeroValue( data.previewChannelLightnessAmount, fLightness ) : 0.0,
      channelLightnessSource: (data.previewChannelLightnessSource != null) ? data.previewChannelLightnessSource : 0
   };
}

function isMaskProtectionActive()
{
   // v0.13.69: generalized mask switch.  Keep legacy StarProtection alias
   // for older instances, but the UI now exposes this as Mask Protection.
   return !!(data.previewEnableMaskProtection || data.previewEnableStarProtection) &&
          Math.abs((data.previewStarProtectionAmount || 0.0)) > 1e-6;
}

function isStarProtectionMaskActive()
{
   return isMaskProtectionActive() && ((data.previewMaskPreset || 0) == 0);
}

function isBlueCoreMaskActive()
{
   return isMaskProtectionActive() && ((data.previewMaskPreset || 0) == 1);
}

function isWarmGoldMaskActive()
{
   return isMaskProtectionActive() && ((data.previewMaskPreset || 0) == 2);
}

function isFaintRedMaskActive()
{
   return isMaskProtectionActive() && ((data.previewMaskPreset || 0) == 3);
}

function isExternalMaskActive()
{
   return isMaskProtectionActive() && ((data.previewMaskPreset || 0) == 4);
}

function isSelectiveApplicationMaskActive()
{
   return isBlueCoreMaskActive() || isWarmGoldMaskActive() || isFaintRedMaskActive() || isExternalMaskActive();
}

function isAnyMaskActive()
{
   return isStarProtectionMaskActive() || isBlueCoreMaskActive() || isWarmGoldMaskActive() || isFaintRedMaskActive() || isExternalMaskActive();
}

function buildStarProtectionMaskExpressionFromRGB( R, G, B )
{
   function clipExpr( e )
   {
      return "min(1,max(0,(" + e + ")))";
   }

   // v0.13.73: Prefer a generated MLT/starlet star mask when available.
   // This mask is built from compact multiscale stellar structures and then
   // expanded/softened to cover halos.
   if ( gActiveStarMaskViewId != null && gActiveStarMaskViewId.length > 0 )
   {
      var mv = View.viewById( gActiveStarMaskViewId );
      if ( isValidView( mv ) )
         return gActiveStarMaskViewId;
   }

   // Fallback if a generated mask is not available yet.
   var a = Math.max( 0, Math.min( 1, data.previewStarProtectionAmount || 0.0 ) );
   var tCore = formatFloat( 0.68 - 0.14*a, 3 );
   var dCore = formatFloat( 0.22 + 0.10*a, 3 );
   var maxRGB = "max(max((" + R + "),(" + G + ")), (" + B + "))";
   var minRGB = "min(min((" + R + "),(" + G + ")), (" + B + "))";
   var chroma = "(" + maxRGB + "-" + minRGB + ")";
   var whiteGate = clipExpr( "1.20-(" + chroma + ")*4.8" );
   var coreGate = clipExpr( "((" + maxRGB + ")-" + tCore + ")/" + dCore );
   return clipExpr( "(" + coreGate + ")*(" + whiteGate + ")" );
}


function buildBlueCoreMaskExpressionFromRGB( R, G, B, preferGeneratedMask )
{
   if ( preferGeneratedMask === undefined )
      preferGeneratedMask = true;
   function clipExpr( e )
   {
      return "min(1,max(0,(" + e + ")))";
   }

   // v0.13.80: Prefer the generated/blurred Blue Core mask only when the
   // expression is being used by the preview/final pipeline.  During mask
   // generation we must force a fresh RGB selector.  Otherwise changing Amount
   // can recursively blur/intensify the previous cached mask instead of
   // rebuilding from the source image, which makes the slider feel inverted.
   if ( preferGeneratedMask && gActiveStarMaskViewId != null && gActiveStarMaskViewId.length > 0 )
   {
      var mv = View.viewById( gActiveStarMaskViewId );
      if ( isValidView( mv ) )
         return gActiveStarMaskViewId;
   }

   // v0.13.78: More robust expression-only OIII/cyan-blue selector.
   // The previous implementation relied heavily on CIEh/CIEc($T), which can
   // become almost black depending on the target/evaluation context and, when
   // used as a global blend selector, made the whole image fall back toward the
   // unboosted palette.  This version uses only explicit RGB channel relations:
   //   - cyan/blue dominance over red,
   //   - enough local brightness/chroma,
   //   - suppression of nearly-white/clipped stars.
   // It is intentionally soft, so the mask can be visualized and tuned with the
   // same Amount slider without creating hard borders.
   var a = Math.max( 0, Math.min( 1, data.previewStarProtectionAmount || 0.0 ) );
   var r = "(" + R + ")";
   var g = "(" + G + ")";
   var b = "(" + B + ")";

   var maxRGB = "max(max(" + r + "," + g + ")," + b + ")";
   var minRGB = "min(min(" + r + "," + g + ")," + b + ")";
   var chroma = "((" + maxRGB + ")-(" + minRGB + "))";
   var coolMean = "(0.5*(" + g + "+" + b + "))";

   // OIII/cyan-blue signal: G/B together must exceed R.  A small positive
   // offset keeps weak OIII nebulosity from disappearing completely.
   var coolDominance = clipExpr( "((" + coolMean + ")-(" + r + ")+0.035)/0.180" );

   // Prefer blue/cyan over neutral/white.  Pure white stars have low chroma and
   // are later attenuated again by the star suppression gate.
   var chromaGate = clipExpr( "((" + chroma + ")-0.018)/0.140" );

   // Avoid selecting black background, but keep this gentle so faint blue cores
   // can still be selected.
   var signalGate = clipExpr( "((" + maxRGB + ")-0.045)/0.260" );

   // Suppress very bright neutral stars/highlights.  This is deliberately soft:
   // it reduces star contamination without punching holes in bright OIII cores.
   var whiteness = clipExpr( "1-3.4*(" + chroma + ")" );
   var brightStarGate = clipExpr( "1-((" + maxRGB + ")-0.720)/0.260" );
   var notWhiteStar = clipExpr( "1-(" + whiteness + ")*(1-(" + brightStarGate + "))" );

   // v0.13.80: Keep the base selector lower and mostly independent from
   // Amount.  Amount should control softness/coverage, not make the initial
   // Blue Core mask excessively bright.
   var strength = formatFloat( 1.48 + 0.34*a, 3 );
   return clipExpr( strength + "*(" + coolDominance + ")*(" + chromaGate + ")*(" + signalGate + ")*(" + notWhiteStar + ")" );
}


function buildWarmGoldMaskExpressionFromRGB( R, G, B, preferGeneratedMask )
{
   if ( preferGeneratedMask === undefined )
      preferGeneratedMask = true;
   function clipExpr( e )
   {
      return "min(1,max(0,(" + e + ")))";
   }

   // v0.13.82: Warm/Gold selector. This is the complementary region mask to
   // Blue Core: it favours Ha/SII amber-red structures, avoids pure blue/cyan
   // OIII regions, and attenuates neutral white stars/highlights.  When a
   // generated blurred mask exists, use it for both preview and final pipelines.
   if ( preferGeneratedMask && gActiveStarMaskViewId != null && gActiveStarMaskViewId.length > 0 )
   {
      var mv = View.viewById( gActiveStarMaskViewId );
      if ( isValidView( mv ) )
         return gActiveStarMaskViewId;
   }

   var a = Math.max( 0, Math.min( 1, data.previewStarProtectionAmount || 0.0 ) );
   var r = "(" + R + ")";
   var g = "(" + G + ")";
   var b = "(" + B + ")";

   var maxRGB = "max(max(" + r + "," + g + ")," + b + ")";
   var minRGB = "min(min(" + r + "," + g + ")," + b + ")";
   var chroma = "((" + maxRGB + ")-(" + minRGB + "))";
   var warmMean = "(0.78*" + r + "+0.22*" + g + ")";
   var coolMean = "(0.5*(" + g + "+" + b + "))";

   // Warm dominance: red/yellow structures over the OIII/cyan-blue component.
   var warmDominance = clipExpr( "((" + warmMean + ")-(" + b + ")+0.030)/0.170" );

   // Keep this chroma gate gentle; many attractive sulfur/gold structures are
   // not strongly saturated after neutral palette construction.
   var chromaGate = clipExpr( "((" + chroma + ")-0.014)/0.125" );

   // Select real nebular signal, not black background.
   var signalGate = clipExpr( "((" + maxRGB + ")-0.040)/0.270" );

   // Suppress blue/cyan regions so this mask complements Blue Core.
   var notBlueCore = clipExpr( "1-0.85*(max(0,(" + coolMean + ")-(" + r + ")+0.025)/0.220)" );

   // Suppress neutral white star cores and very bright low-chroma highlights.
   var whiteness = clipExpr( "1-3.2*(" + chroma + ")" );
   var brightStarGate = clipExpr( "1-((" + maxRGB + ")-0.700)/0.280" );
   var notWhiteStar = clipExpr( "1-(" + whiteness + ")*(1-(" + brightStarGate + "))" );

   var strength = formatFloat( 1.38 + 0.30*a, 3 );
   return clipExpr( strength + "*(" + warmDominance + ")*(" + chromaGate + ")*(" + signalGate + ")*(" + notBlueCore + ")*(" + notWhiteStar + ")" );
}



function buildFaintRedMaskExpressionFromRGB( R, G, B, preferGeneratedMask )
{
   if ( preferGeneratedMask === undefined )
      preferGeneratedMask = true;
   function clipExpr( e )
   {
      return "min(1,max(0,(" + e + ")))";
   }

   // v0.13.85: Faint Red reaches lower-signal red regions/corners while keeping
   // the v0.13.84 bright Warm/Gold veto.
   // v0.13.84: Faint Red is now a true faint-zone selector, not just a
   // softened Warm/Gold mask.  It selects weak reddish Ha/SII signal and
   // explicitly vetoes the bright warm/gold structures that Warm/Gold already
   // handles well.
   if ( preferGeneratedMask && gActiveStarMaskViewId != null && gActiveStarMaskViewId.length > 0 )
   {
      var mv = View.viewById( gActiveStarMaskViewId );
      if ( isValidView( mv ) )
         return gActiveStarMaskViewId;
   }

   var a = Math.max( 0, Math.min( 1, data.previewStarProtectionAmount || 0.0 ) );
   var r = "(" + R + ")";
   var g = "(" + G + ")";
   var b = "(" + B + ")";

   var maxRGB = "max(max(" + r + "," + g + ")," + b + ")";
   var minRGB = "min(min(" + r + "," + g + ")," + b + ")";
   var chroma = "((" + maxRGB + ")-(" + minRGB + "))";
   var coolMean = "(0.5*(" + g + "+" + b + "))";
   var warmMean = "(0.86*" + r + "+0.14*" + g + ")";
   var redExcess = "((" + r + ")-max(" + g + "," + b + "))";

   // Require a weak red/warm bias, but keep it tolerant enough for low
   // saturation reddish dust/Ha regions.
   var redDominance = clipExpr( "max((" + redExcess + "+0.095)/0.210,((" + warmMean + ")-(" + coolMean + ")+0.055)/0.215)" );

   // Low-to-mid signal band.  This is deliberately much stricter than
   // Warm/Gold: below the lower gate there is just background, above the upper
   // gate we are already in the bright gold/warm structures we want to avoid.
   var lowGate = clipExpr( "((" + maxRGB + ")-0.014)/0.150" );
   var upperGate = clipExpr( "1-((" + maxRGB + ")-0.255)/0.185" );
   var faintBand = clipExpr( "(" + lowGate + ")*(" + upperGate + ")" );

   // Suppress the same high-confidence warm/gold core that the Warm/Gold mask
   // selects.  This avoids the two masks looking almost identical.
   var warmCore = clipExpr( "(((" + warmMean + ")-(" + b + ")+0.018)/0.140)*(((" + maxRGB + ")-0.205)/0.210)" );
   var notWarmCore = clipExpr( "1-1.25*(" + warmCore + ")" );

   // Low chroma is acceptable, but pure neutral background/stars should not
   // dominate the mask.
   var chromaGate = clipExpr( "((" + chroma + ")-0.0025)/0.085" );

   // Avoid OIII/cyan-blue regions.
   var notBlueCore = clipExpr( "1-1.05*(max(0,(" + coolMean + ")-(" + r + ")+0.018)/0.205)" );

   // Suppress neutral bright stars/highlights.
   var whiteness = clipExpr( "1-3.0*(" + chroma + ")" );
   var brightStarGate = clipExpr( "1-((" + maxRGB + ")-0.560)/0.300" );
   var notWhiteStar = clipExpr( "1-(" + whiteness + ")*(1-(" + brightStarGate + "))" );

   // Slightly lower than Warm/Gold; the generated mask is expanded/softened
   // afterwards, but the bright warm structures are gated again after blur.
   var strength = formatFloat( 1.38 + 0.22*a, 3 );
   return clipExpr( strength + "*(" + redDominance + ")*(" + faintBand + ")*(" + notWarmCore + ")*(" + chromaGate + ")*(" + notBlueCore + ")*(" + notWhiteStar + ")" );
}

function applyConvolutionBlurToViewWithSigma( view, sigma )
{
   if ( !isValidView( view ) )
      return false;

   try
   {
      var apsConvStart = apsNowMs();
      view.beginProcess( UndoFlag_NoSwapFile );
      var C = new Convolution;
      try { C.mode = Convolution.prototype.Parametric; } catch ( e0 ) {}
      try { C.sigma = sigma; } catch ( e1 ) {}
      try { C.stdDev = sigma; } catch ( e2 ) {}
      try { C.shape = 2.00; } catch ( e3 ) {}
      try { C.aspectRatio = 1.00; } catch ( e4 ) {}
      try { C.rotationAngle = 0.00; } catch ( e5 ) {}
      try { C.rotation = 0.00; } catch ( e6 ) {}
      C.executeOn( view, false );
      view.endProcess();
      apsProfileLog( "Gold Accent mask convolution", apsConvStart );
      return true;
   }
   catch ( e )
   {
      try { view.endProcess(); } catch ( ee ) {}
      Console.warningln( "Star mask convolution skipped: ", e );
      return false;
   }
}

function applyStarExtractionMLTToView( view )
{
   if ( !isValidView( view ) )
      return false;

   try
   {
      view.beginProcess( UndoFlag_NoSwapFile );
      var P = new MultiscaleLinearTransform;
      P.layers = [
         [true,  true, 0.000, false, 2.000, 1.00, 1],
         [true,  true, 0.000, false, 2.500, 1.00, 1],
         [true,  true, 0.000, false, 40.000, 1.00, 1],
         [true,  true, 0.500, true,  40.000, 1.00, 1],
         [false, true, 0.000, false, 3.000, 1.00, 1]
      ];
      P.transform = MultiscaleLinearTransform.prototype.StarletTransform;
      P.scaleDelta = 0;
      P.scalingFunctionData = [
         0.25,0.5,0.25,
         0.5,1,0.5,
         0.25,0.5,0.25
      ];
      P.scalingFunctionRowFilter = [0.5,1,0.5];
      P.scalingFunctionColFilter = [0.5,1,0.5];
      P.scalingFunctionNoiseSigma = [
         0.8003,0.2729,0.1198,
         0.0578,0.0287,0.0143,
         0.0072,0.0036,0.0019,
         0.001
      ];
      P.scalingFunctionName = "Linear Interpolation (3)";
      P.linearMask = false;
      P.linearMaskAmpFactor = 100;
      P.linearMaskSmoothness = 1.00;
      P.linearMaskInverted = true;
      P.linearMaskPreview = false;
      P.largeScaleFunction = MultiscaleLinearTransform.prototype.NoFunction;
      P.curveBreakPoint = 0.75;
      P.noiseThresholding = true;
      P.noiseThresholdingAmount = 1.00;
      P.noiseThreshold = 6.00;
      P.softThresholding = true;
      P.useMultiresolutionSupport = false;
      P.deringing = false;
      P.deringingDark = 0.1000;
      P.deringingBright = 0.0000;
      P.outputDeringingMaps = false;
      P.lowRange = 0.0000;
      P.highRange = 0.0000;
      P.previewMode = MultiscaleLinearTransform.prototype.Disabled;
      P.previewLayer = 0;
      P.toLuminance = true;
      P.toChrominance = true;
      P.linear = false;
      P.executeOn( view, false );
      view.endProcess();
      return true;
   }
   catch ( e )
   {
      try { view.endProcess(); } catch ( ee ) {}
      Console.warningln( "MLT star extraction skipped: ", e );
      return false;
   }
}

function applyStarMaskCurvesToView( view )
{
   if ( !isValidView( view ) )
      return false;

   try
   {
      view.beginProcess( UndoFlag_NoSwapFile );
      var C = new CurvesTransformation;
      // More selective than the SCC default curve: it suppresses weak extended
      // nebulosity after MLT and keeps compact stellar structures.
      C.K = [
         [0.00000, 0.00000],
         [0.10000, 0.00000],
         [0.24000, 0.08000],
         [0.46000, 0.43000],
         [0.76000, 0.82000],
         [1.00000, 1.00000]
      ];
      C.Kt = CurvesTransformation.prototype.AkimaSubsplines;
      C.executeOn( view, false );
      view.endProcess();
      return true;
   }
   catch ( e )
   {
      try { view.endProcess(); } catch ( ee ) {}
      Console.warningln( "Star mask curves skipped: ", e );
      return false;
   }
}

function applyStarMaskDilationToView( view, iterations )
{
   if ( !isValidView( view ) )
      return false;

   try
   {
      view.beginProcess( UndoFlag_NoSwapFile );
      var M = new MorphologicalTransformation;
      M.operator = MorphologicalTransformation.prototype.Dilation;
      M.interlacingDistance = 1;
      M.lowThreshold = 0.000000;
      M.highThreshold = 0.000000;
      M.numberOfIterations = Math.max( 1, iterations );
      M.amount = 1.00;
      M.selectionPoint = 0.50;
      M.structureName = "";
      M.structureSize = 7;
      M.structureWayTable = [[[
         0x00,0x00,0x01,0x01,0x01,0x00,0x00,
         0x00,0x01,0x01,0x01,0x01,0x01,0x00,
         0x01,0x01,0x01,0x01,0x01,0x01,0x01,
         0x01,0x01,0x01,0x01,0x01,0x01,0x01,
         0x01,0x01,0x01,0x01,0x01,0x01,0x01,
         0x00,0x01,0x01,0x01,0x01,0x01,0x00,
         0x00,0x00,0x01,0x01,0x01,0x00,0x00
      ]]];
      M.executeOn( view, false );
      view.endProcess();
      return true;
   }
   catch ( e )
   {
      try { view.endProcess(); } catch ( ee ) {}
      Console.warningln( "Star mask dilation skipped: ", e );
      return false;
   }
}

function intensifyMaskView( view, factor )
{
   if ( !isValidView( view ) )
      return false;

   try
   {
      view.beginProcess( UndoFlag_NoSwapFile );
      var P = new PixelMath;
      P.expression = "min(1,max(0," + formatFloat( factor, 3 ) + "*$T))";
      P.useSingleExpression = true;
      P.clearImageCacheAndExit = false;
      P.cacheGeneratedImages = false;
      P.generateOutput = true;
      P.singleThreaded = false;
      P.optimization = true;
      P.use64BitWorkingImage = false;
      P.rescale = false;
      P.truncate = true;
      P.truncateLower = 0;
      P.truncateUpper = 1;
      P.createNewImage = false;
      P.executeOn( view, false );
      view.endProcess();
      return true;
   }
   catch ( e )
   {
      try { view.endProcess(); } catch ( ee ) {}
      Console.warningln( "Star mask intensity skipped: ", e );
      return false;
   }
}


function gateFaintRedMaskAfterBlur( maskView, sourceView )
{
   if ( !isValidView( maskView ) || !isValidView( sourceView ) )
      return false;

   function clipExpr( e )
   {
      return "min(1,max(0,(" + e + ")))";
   }

   try
   {
      var src = sourceView.id;
      var r = "(" + src + "[0])";
      var g = "(" + src + "[1])";
      var b = "(" + src + "[2])";
      var maxRGB = "max(max(" + r + "," + g + ")," + b + ")";
      var coolMean = "(0.5*(" + g + "+" + b + "))";
      var warmMean = "(0.86*" + r + "+0.14*" + g + ")";
      var redExcess = "((" + r + ")-max(" + g + "," + b + "))";

      // Re-apply the faint-zone veto after gaussian blur.  Without this second
      // gate, bright Warm/Gold cores bleed into the Faint Red mask and both
      // masks look almost the same.
      var redDominance = clipExpr( "max((" + redExcess + "+0.095)/0.210,((" + warmMean + ")-(" + coolMean + ")+0.055)/0.215)" );
      var upperGate = clipExpr( "1-((" + maxRGB + ")-0.270)/0.190" );
      var signalGate = clipExpr( "((" + maxRGB + ")-0.012)/0.155" );
      var notBlueCore = clipExpr( "1-1.05*(max(0,(" + coolMean + ")-(" + r + ")+0.018)/0.205)" );
      var warmCore = clipExpr( "(((" + warmMean + ")-(" + b + ")+0.018)/0.140)*(((" + maxRGB + ")-0.205)/0.215)" );
      var notWarmCore = clipExpr( "1-1.35*(" + warmCore + ")" );

      var expr = clipExpr( "1.28*$T*(" + redDominance + ")*(" + upperGate + ")*(" + signalGate + ")*(" + notBlueCore + ")*(" + notWarmCore + ")" );

      maskView.beginProcess( UndoFlag_NoSwapFile );
      var P = new PixelMath;
      P.expression = expr;
      P.useSingleExpression = true;
      P.clearImageCacheAndExit = false;
      P.cacheGeneratedImages = false;
      P.generateOutput = true;
      P.singleThreaded = false;
      P.optimization = true;
      P.use64BitWorkingImage = false;
      P.rescale = false;
      P.truncate = true;
      P.truncateLower = 0;
      P.truncateUpper = 1;
      P.createNewImage = false;
      P.executeOn( maskView, false );
      maskView.endProcess();
      return true;
   }
   catch ( e )
   {
      try { maskView.endProcess(); } catch ( ee ) {}
      Console.warningln( "Faint Red post-blur gate skipped: ", e );
      return false;
   }
}

function stretchStarMaskSensitivityToView( view, amount )
{
   if ( !isValidView( view ) )
      return false;

   try
   {
      var a = Math.max( 0, Math.min( 1, amount || 0.0 ) );

      // v0.13.74: Gradual sensitivity stretch.  The previous gaussian falloff
      // was visually cleaner but too faint and did not reveal enough small
      // stars.  This operation lifts weak compact starlet detections before
      // gaussian halo growth, while preserving a soft, non-binary falloff.
      var black = Math.max( 0.000, 0.030 - 0.020*a );
      var gamma = Math.max( 0.36, 0.62 - 0.18*a );
      var gain  = 1.95 + 1.15*a;
      var expr = "min(1,max(0," + formatFloat( gain, 3 ) + "*(max(0,($T-" +
                 formatFloat( black, 4 ) + ")/(1-" + formatFloat( black, 4 ) + "))^" +
                 formatFloat( gamma, 3 ) + ")))";

      view.beginProcess( UndoFlag_NoSwapFile );
      var P = new PixelMath;
      P.expression = expr;
      P.useSingleExpression = true;
      P.clearImageCacheAndExit = false;
      P.cacheGeneratedImages = false;
      P.generateOutput = true;
      P.singleThreaded = false;
      P.optimization = true;
      P.use64BitWorkingImage = false;
      P.rescale = false;
      P.truncate = true;
      P.truncateLower = 0;
      P.truncateUpper = 1;
      P.createNewImage = false;
      P.executeOn( view, false );
      view.endProcess();
      return true;
   }
   catch ( e )
   {
      try { view.endProcess(); } catch ( ee ) {}
      Console.warningln( "Star mask sensitivity stretch skipped: ", e );
      return false;
   }
}

function createSmallScaleStarMaskView( sourceView )
{
   if ( !isValidView( sourceView ) || sourceView.image.numberOfChannels != 3 )
      return null;

   var cacheKey = starMaskCacheKeyForView( sourceView );
   var cachedMask = getCachedStarMaskViewForKey( cacheKey );
   if ( isValidView( cachedMask ) )
      return cachedMask;

   var a = Math.max( 0, Math.min( 1, data.previewStarProtectionAmount || 0.0 ) );
   var serial = ++gStarMaskSerial;
   var maskId = PREVIEW_PREFIX + "STAR_MASK_" + serial;
   gStarMaskComputationInProgress = true;

   var src = sourceView.id;
   // v0.13.73: build a luminance image, then extract only small-scale stellar
   // structures using an MLT starlet workflow inspired by Selective Color
   // Correction. This is much more selective than the previous high-pass blur
   // and avoids selecting extended nebulosity.
   var lumaExpr = "CIEL(" + src + ")";

   var tmpData = new parametersPrototype();
   tmpData.setDefaults();
   tmpData.currentView = sourceView;
   tmpData.referenceHA = sourceView;
   tmpData.previewSilent = true;

   try
   {
      pixelMathFcn( tmpData, lumaExpr, "", "", "", maskId, false );
      var maskWin = ImageWindow.windowById( maskId );
      if ( !isValidWindow( maskWin ) )
      {
         gStarMaskComputationInProgress = false;
         return null;
      }
      maskWin.hide();

      var maskView = maskWin.mainView;
      applyStarExtractionMLTToView( maskView );
      applyStarMaskCurvesToView( maskView );

      // v0.13.74: The starlet detection is now lifted gradually before halo
      // growth. This recovers more small stars without returning to the harsh,
      // binary-looking disks of v0.13.72.
      stretchStarMaskSensitivityToView( maskView, a );

      // Keep morphology disabled for normal values: gaussian falloff should be
      // the main way halos are protected.  Only apply one very mild dilation at
      // the extreme end to catch very large stellar halos.
      if ( a > 0.96 )
         applyStarMaskDilationToView( maskView, 1 );

      // Amount controls mostly halo width.  Slightly lower sigma than v0.13.73
      // avoids over-diffusing weak stars, while the sensitivity stretch above
      // provides the missing strength.
      applyConvolutionBlurToViewWithSigma( maskView, 0.35 + 2.05*a );

      // Restore protection level after gaussian blur, but with a soft gain ramp
      // so stars remain gradual instead of turning into white disks.
      intensifyMaskView( maskView, 1.55 + 0.85*a );
      applyMaskInversionIfRequested( maskView );

      storeStarMaskCacheViewForKey( cacheKey, maskId );
      gStarMaskComputationInProgress = false;
      return maskView;
   }
   catch ( e )
   {
      gStarMaskComputationInProgress = false;
      Console.warningln( "MLT star protection mask skipped: ", e );
      return null;
   }
}


function createBlueCoreMaskView( sourceView )
{
   if ( !isValidView( sourceView ) || sourceView.image.numberOfChannels != 3 )
      return null;

   var cacheKey = starMaskCacheKeyForView( sourceView );
   var cachedMask = getCachedStarMaskViewForKey( cacheKey );
   if ( isValidView( cachedMask ) )
      return cachedMask;

   var a = Math.max( 0, Math.min( 1, data.previewStarProtectionAmount || 0.0 ) );
   var serial = ++gStarMaskSerial;
   var maskId = PREVIEW_PREFIX + "BLUE_CORE_MASK_" + serial;
   gStarMaskComputationInProgress = true;

   var src = sourceView.id;
   var expr = buildBlueCoreMaskExpressionFromRGB( src + "[0]", src + "[1]", src + "[2]", false );

   var tmpData = new parametersPrototype();
   tmpData.setDefaults();
   tmpData.currentView = sourceView;
   tmpData.referenceHA = sourceView;
   tmpData.previewSilent = true;

   try
   {
      pixelMathFcn( tmpData, expr, "", "", "", maskId, false );
      var maskWin = ImageWindow.windowById( maskId );
      if ( !isValidWindow( maskWin ) )
      {
         gStarMaskComputationInProgress = false;
         return null;
      }
      maskWin.hide();

      var maskView = maskWin.mainView;

      // v0.13.80: Blue Core is a soft nebular region selector. Amount should
      // mainly expand/soften the selected area, not drive a large brightness
      // increase.  The previous version increased gain strongly with Amount,
      // which made the control feel counterintuitive.
      applyConvolutionBlurToViewWithSigma( maskView, 2.00 + 7.50*a );
      // v0.13.81: Slightly stronger Blue Core mask after blur.  Keep this
      // conservative: Amount already changes coverage/softness; gain just
      // compensates for the gaussian diffusion so the mask has usable effect.
      intensifyMaskView( maskView, 1.02 + 0.42*a );
      applyMaskInversionIfRequested( maskView );

      storeStarMaskCacheViewForKey( cacheKey, maskId );
      gStarMaskComputationInProgress = false;
      return maskView;
   }
   catch ( e )
   {
      gStarMaskComputationInProgress = false;
      Console.warningln( "Blue Core mask generation skipped: ", e );
      return null;
   }
}


function createWarmGoldMaskView( sourceView )
{
   if ( !isValidView( sourceView ) || sourceView.image.numberOfChannels != 3 )
      return null;

   var cacheKey = starMaskCacheKeyForView( sourceView );
   var cachedMask = getCachedStarMaskViewForKey( cacheKey );
   if ( isValidView( cachedMask ) )
      return cachedMask;

   var a = Math.max( 0, Math.min( 1, data.previewStarProtectionAmount || 0.0 ) );
   var serial = ++gStarMaskSerial;
   var maskId = PREVIEW_PREFIX + "WARM_GOLD_MASK_" + serial;
   gStarMaskComputationInProgress = true;

   var src = sourceView.id;
   var expr = buildWarmGoldMaskExpressionFromRGB( src + "[0]", src + "[1]", src + "[2]", false );

   var tmpData = new parametersPrototype();
   tmpData.setDefaults();
   tmpData.currentView = sourceView;
   tmpData.referenceHA = sourceView;
   tmpData.previewSilent = true;

   try
   {
      pixelMathFcn( tmpData, expr, "", "", "", maskId, false );
      var maskWin = ImageWindow.windowById( maskId );
      if ( !isValidWindow( maskWin ) )
      {
         gStarMaskComputationInProgress = false;
         return null;
      }
      maskWin.hide();

      var maskView = maskWin.mainView;

      // Warm/Gold should behave like Blue Core: a soft nebular selector whose
      // amount mainly expands/softens the selected warm structures.
      applyConvolutionBlurToViewWithSigma( maskView, 2.20 + 7.20*a );
      intensifyMaskView( maskView, 1.05 + 0.40*a );
      applyMaskInversionIfRequested( maskView );

      storeStarMaskCacheViewForKey( cacheKey, maskId );
      gStarMaskComputationInProgress = false;
      return maskView;
   }
   catch ( e )
   {
      gStarMaskComputationInProgress = false;
      Console.warningln( "Warm/Gold mask generation skipped: ", e );
      return null;
   }
}



function createFaintRedMaskView( sourceView )
{
   if ( !isValidView( sourceView ) || sourceView.image.numberOfChannels != 3 )
      return null;

   var cacheKey = starMaskCacheKeyForView( sourceView );
   var cachedMask = getCachedStarMaskViewForKey( cacheKey );
   if ( isValidView( cachedMask ) )
      return cachedMask;

   var a = Math.max( 0, Math.min( 1, data.previewStarProtectionAmount || 0.0 ) );
   var serial = ++gStarMaskSerial;
   var maskId = PREVIEW_PREFIX + "FAINT_RED_MASK_" + serial;
   gStarMaskComputationInProgress = true;

   var src = sourceView.id;
   var expr = buildFaintRedMaskExpressionFromRGB( src + "[0]", src + "[1]", src + "[2]", false );

   var tmpData = new parametersPrototype();
   tmpData.setDefaults();
   tmpData.currentView = sourceView;
   tmpData.referenceHA = sourceView;
   tmpData.previewSilent = true;

   try
   {
      pixelMathFcn( tmpData, expr, "", "", "", maskId, false );
      var maskWin = ImageWindow.windowById( maskId );
      if ( !isValidWindow( maskWin ) )
      {
         gStarMaskComputationInProgress = false;
         return null;
      }
      maskWin.hide();

      var maskView = maskWin.mainView;

      // Faint red regions should be broad and natural, but must not become a
      // duplicate of Warm/Gold.  First expand softly, then re-gate against the
      // source image to remove bright warm/gold cores that bled through blur.
      applyConvolutionBlurToViewWithSigma( maskView, 2.60 + 7.60*a );
      gateFaintRedMaskAfterBlur( maskView, sourceView );
      intensifyMaskView( maskView, 1.14 + 0.32*a );
      applyMaskInversionIfRequested( maskView );

      storeStarMaskCacheViewForKey( cacheKey, maskId );
      gStarMaskComputationInProgress = false;
      return maskView;
   }
   catch ( e )
   {
      gStarMaskComputationInProgress = false;
      Console.warningln( "Faint Red mask generation skipped: ", e );
      return null;
   }
}

function createExternalMaskPreviewView( sourceView )
{
   gActiveStarMaskViewId = "";

   if ( !isExternalMaskActive() || !isValidView( data.previewExternalMaskView ) )
      return null;

   var refBase = firstValidMaskReferenceView( data.referenceHA, data.referenceOIII, data.referenceSII, sourceView );
   var err = getExternalMaskValidationError( data.previewExternalMaskView,
                                             data.referenceHA, data.referenceOIII, data.referenceSII,
                                             refBase, "the current workflow" );
   if ( err.length > 0 )
      return null;

   var targetW = isValidView( sourceView ) ? sourceView.image.width : data.previewExternalMaskView.image.width;
   var targetH = isValidView( sourceView ) ? sourceView.image.height : data.previewExternalMaskView.image.height;
   var key = data.previewExternalMaskView.id + "|" + targetW + "x" + targetH + "|inv=" + (data.previewInvertMask ? "1" : "0");

   if ( gExternalMaskCacheKey == key )
   {
      var cached = View.viewById( gExternalMaskCacheViewId );
      if ( isValidView( cached ) )
      {
         gActiveStarMaskViewId = cached.id;
         return cached;
      }
   }

   if ( gExternalMaskCacheViewId != null && gExternalMaskCacheViewId.length > 0 )
      safeForceCloseWindowById( gExternalMaskCacheViewId );
   gExternalMaskCacheKey = "";
   gExternalMaskCacheViewId = "";

   var id = PREVIEW_PREFIX + "MASK_EXTERNAL";
   var v = makeViewCopy( data.previewExternalMaskView, id );
   if ( !isValidView( v ) )
      return null;

   if ( isValidView( sourceView ) &&
        (v.image.width != sourceView.image.width || v.image.height != sourceView.image.height) )
      downsamplePreviewView( v );

   if ( isValidView( sourceView ) &&
        (v.image.width != sourceView.image.width || v.image.height != sourceView.image.height) )
   {
      safeForceCloseWindowById( id );
      return null;
   }

   if ( data.previewInvertMask )
      runPreviewPixelMathOnView( v, "1-$T", false );

   gExternalMaskCacheKey = key;
   gExternalMaskCacheViewId = v.id;
   gActiveStarMaskViewId = v.id;
   return v;
}

function createSelectedMaskView( sourceView )
{
   if ( isStarProtectionMaskActive() )
      return createSmallScaleStarMaskView( sourceView );
   if ( isBlueCoreMaskActive() )
      return createBlueCoreMaskView( sourceView );
   if ( isWarmGoldMaskActive() )
      return createWarmGoldMaskView( sourceView );
   if ( isFaintRedMaskActive() )
      return createFaintRedMaskView( sourceView );
   if ( isExternalMaskActive() )
      return createExternalMaskPreviewView( sourceView );
   gActiveStarMaskViewId = "";
   return null;
}

function buildRawSelectedMaskExpressionFromRGB( R, G, B )
{
   if ( isStarProtectionMaskActive() )
      return buildStarProtectionMaskExpressionFromRGB( R, G, B );
   if ( isBlueCoreMaskActive() )
      return buildBlueCoreMaskExpressionFromRGB( R, G, B );
   if ( isWarmGoldMaskActive() )
      return buildWarmGoldMaskExpressionFromRGB( R, G, B );
   if ( isFaintRedMaskActive() )
      return buildFaintRedMaskExpressionFromRGB( R, G, B );
   if ( isExternalMaskActive() )
      return (gActiveStarMaskViewId != null && gActiveStarMaskViewId.length > 0) ? gActiveStarMaskViewId : "0";
   return "0";
}

function buildSelectedMaskExpressionFromRGB( R, G, B )
{
   var m = buildRawSelectedMaskExpressionFromRGB( R, G, B );

   // If m is the generated cached mask view, it has already been inverted
   // in-place when previewInvertMask is enabled and cached with a distinct key.
   // Do not invert it again here.  Only invert expression-only fallbacks.
   if ( data.previewInvertMask )
   {
      var cachedId = gActiveStarMaskViewId || "";
      if ( cachedId.length > 0 && m == cachedId && isValidView( View.viewById( cachedId ) ) )
         return m;
      return "min(1,max(0,1-(" + m + ")))";
   }

   return m;
}

function buildStarProtectionBlendExpression( originalExpr, processedExpr, R, G, B )
{
   function clipExpr( e )
   {
      return "min(1,max(0,(" + e + ")))";
   }

   if ( !isAnyMaskActive() )
      return processedExpr;

   var a = formatFloat( data.previewStarProtectionAmount || 0.0, 3 );
   var M = clipExpr( a + "*(" + buildSelectedMaskExpressionFromRGB( R, G, B ) + ")" );

   if ( isSelectiveApplicationMaskActive() )
   {
      // v0.13.82: Blue Core and Warm/Gold are selective application masks for Boosted.
      // v0.13.81: Blue Core is a selective application mask for Boosted too.
      // Earlier builds left Boosted fully global to avoid the black-mask issue,
      // but now the generated Blue Core mask is stable/cacheable, so blend from
      // the original palette to the boosted result only inside the blue/cyan
      // region.  Use a slightly stronger effect mask than the displayed mask so
      // the result is visible without adding a second Sensitivity control.
      var MB = clipExpr( "1.15*(" + buildSelectedMaskExpressionFromRGB( R, G, B ) + ")" );
      return clipExpr( "(" + originalExpr + ")*(1-(" + MB + "))+(" + processedExpr + ")*(" + MB + ")" );
   }

   // Star Protection: protect the masked stars/halos by blending them back to
   // the original palette while keeping the processed result elsewhere.
   return clipExpr( "(" + processedExpr + ")*(1-(" + M + "))+(" + originalExpr + ")*(" + M + ")" );
}

function buildStarProtectionEffectScaleExpression( R, G, B )
{
   function clipExpr( e )
   {
      return "min(1,max(0,(" + e + ")))";
   }

   if ( !isAnyMaskActive() )
      return "1";

   var a = formatFloat( data.previewStarProtectionAmount || 0.0, 3 );
   var M = clipExpr( a + "*(" + buildSelectedMaskExpressionFromRGB( R, G, B ) + ")" );

   if ( isSelectiveApplicationMaskActive() )
   {
      // v0.13.82: Amount is already embedded in selective generated masks.
      // v0.13.81: Amount is already embedded in the generated Blue Core mask
      // through blur/coverage, so do not multiply by Amount again here.
      // This makes Advanced effects visibly localized instead of nearly global
      // or too weak depending on the slider position.
      return clipExpr( "1.15*(" + buildSelectedMaskExpressionFromRGB( R, G, B ) + ")" );
   }

   return clipExpr( "1-(" + M + ")" );
}

function buildMaskAwareEffectExpression( originalExpr, processedExpr, R, G, B )
{
   function clipExpr( e )
   {
      return "min(1,max(0,(" + e + ")))";
   }

   if ( !isAnyMaskActive() )
      return processedExpr;

   var effectScale = buildStarProtectionEffectScaleExpression( R, G, B );
   return clipExpr( "(" + originalExpr + ")*(1-(" + effectScale + "))+(" + processedExpr + ")*(" + effectScale + ")" );
}

function buildUnifiedRefinementExpressions( R, G, B, values )
{
   function clipExpr( e )
   {
      return "min(1,max(0,(" + e + ")))";
   }

   var sp = formatFloat( values.shadowPoint, 3 );
   var hr = formatFloat( values.highlightReduction, 3 );
   var br = formatFloat( values.brightness, 3 );
   var ct = formatFloat( values.contrast, 3 );
   var sat = formatFloat( values.saturation, 3 );
   var cg = formatFloat( values.cyanGoldBalance, 3 );
   var ry = formatFloat( values.redYellowBalance, 3 );
   var sha = formatFloat( values.goldAccent, 3 );
   var sc = formatFloat( values.scnr, 3 );
   var ob = formatFloat( values.oiiiBoost, 3 );
   var sb = formatFloat( values.siiBoost, 3 );

   // Unified v0.13.25 pipeline. The same expression tree is used for:
   //  - large Studio preview
   //  - boosted preview tiles
   //  - final generated images
   // RC5.2.2: aggressively bypass neutral terms. This preserves the same
   // numerical output for neutral controls but avoids expanding huge trees such
   // as 1.000*x, 0.000*..., contrast=1, shadows=1 and highlights=1.
   var r0 = (Math.abs( values.siiBoost - 1.0 ) > 1e-6) ? clipExpr( sb + "*(" + R + ")" ) : R;
   var g0 = (Math.abs( values.oiiiBoost - 1.0 ) > 1e-6) ? clipExpr( ob + "*(" + G + ")" ) : G;
   var b0 = (Math.abs( values.oiiiBoost - 1.0 ) > 1e-6) ? clipExpr( ob + "*(" + B + ")" ) : B;

   var gScnr = g0;
   if ( Math.abs( values.scnr ) > 1e-6 )
   {
      var gLimit = "((" + r0 + ")+ (" + b0 + "))/2";
      gScnr = clipExpr( "(1-" + sc + ")*(" + g0 + ")+" + sc + "*min((" + g0 + "),(" + gLimit + "))" );
   }

   var rBase = r0;
   var gBase = gScnr;
   var bBase = b0;

   if ( Math.abs( values.shadowPoint - 1.0 ) > 1e-6 )
   {
      rBase = clipExpr( "((" + rBase + ")-(" + sp + "-1)*0.25)/(1-(" + sp + "-1)*0.25)" );
      gBase = clipExpr( "((" + gBase + ")-(" + sp + "-1)*0.25)/(1-(" + sp + "-1)*0.25)" );
      bBase = clipExpr( "((" + bBase + ")-(" + sp + "-1)*0.25)/(1-(" + sp + "-1)*0.25)" );
   }

   if ( Math.abs( values.highlightReduction - 1.0 ) > 1e-6 )
   {
      rBase = clipExpr( "(" + rBase + ")/(" + rBase + "+" + hr + "*(1-(" + rBase + ")))" );
      gBase = clipExpr( "(" + gBase + ")/(" + gBase + "+" + hr + "*(1-(" + gBase + ")))" );
      bBase = clipExpr( "(" + bBase + ")/(" + bBase + "+" + hr + "*(1-(" + bBase + ")))" );
   }

   var rAcc = rBase;
   var gAcc = gBase;
   var bAcc = bBase;

   if ( Math.abs( values.brightness - 1.0 ) > 1e-6 )
   {
      rAcc = clipExpr( br + "*(" + rAcc + ")" );
      gAcc = clipExpr( br + "*(" + gAcc + ")" );
      bAcc = clipExpr( br + "*(" + bAcc + ")" );
   }

   if ( Math.abs( values.contrast - 1.0 ) > 1e-6 )
   {
      rAcc = clipExpr( "((" + rAcc + "-0.5)*" + ct + "+0.5)" );
      gAcc = clipExpr( "((" + gAcc + "-0.5)*" + ct + "+0.5)" );
      bAcc = clipExpr( "((" + bAcc + "-0.5)*" + ct + "+0.5)" );
   }

   // RC3.9.2: Lightweight SelectiveColorCorrection-style color shaping.
   var cgPos = "max(0," + cg + ")";
   var cgNeg = "max(0,-(" + cg + "))";
   var ryPos = "max(0," + ry + ")";
   var ryNeg = "max(0,-(" + ry + "))";

   if ( Math.abs( values.cyanGoldBalance ) > 1e-6 )
   {
      rAcc = clipExpr( "(" + rAcc + ")*(1+0.24*(" + cgPos + ")-0.08*(" + cgNeg + "))" );
      gAcc = clipExpr( "(" + gAcc + ")*(1+0.18*(" + cgPos + ")+0.18*(" + cgNeg + "))" );
      bAcc = clipExpr( "(" + bAcc + ")*(1-0.08*(" + cgPos + ")+0.24*(" + cgNeg + "))" );
   }

   if ( Math.abs( values.redYellowBalance ) > 1e-6 )
   {
      rAcc = clipExpr( "(" + rAcc + ")*(1+0.10*(" + ryPos + ")+0.22*(" + ryNeg + "))" );
      gAcc = clipExpr( "(" + gAcc + ")*(1+0.22*(" + ryPos + ")-0.08*(" + ryNeg + "))" );
      bAcc = clipExpr( "(" + bAcc + ")*(1-0.06*abs(" + ry + "))" );
   }

   if ( Math.abs( values.goldAccent ) > 1e-6 )
   {
      var h = "CIEh($T)";
      var c = "CIEc($T)";
      var hueMask = "iif((" + h + ")<=0.1666666667,~mtf((" + h + ")/0.1666666667,0),iif((" + h + ")<=0.3333333333,~mtf((0.3333333333-(" + h + "))/0.1666666667,0),0))";
      var goldMask = clipExpr( "4.0*(" + hueMask + ")*(" + c + ")" );

      var rCurve = clipExpr( "(" + rAcc + ")+0.309*(" + rAcc + ")*(1-(" + rAcc + "))" );
      var gCurve = clipExpr( "(" + gAcc + ")-0.423*(" + gAcc + ")*(1-(" + gAcc + "))" );
      var bCurve = clipExpr( "(" + bAcc + ")+0.041*(" + bAcc + ")*(1-(" + bAcc + "))" );

      var shaBoost = "min(1,1.5*(" + sha + "))";
      var m = clipExpr( shaBoost + "*(" + goldMask + ")" );
      var hMix = clipExpr( "0.825*(" + shaBoost + ")*(" + goldMask + ")" );
      var rHue = clipExpr( "(" + rCurve + ")+0.150*(" + rCurve + ")*(1-(" + rCurve + "))" );
      var gHue = clipExpr( "(" + gCurve + ")-0.120*(" + gCurve + ")*(1-(" + gCurve + "))" );
      var bHue = clipExpr( "(" + bCurve + ")-0.030*(" + bCurve + ")*(1-(" + bCurve + "))" );

      var rCurved = clipExpr( "(" + rAcc + ")*(1-(" + m + "))+(" + rCurve + ")*(" + m + ")" );
      var gCurved = clipExpr( "(" + gAcc + ")*(1-(" + m + "))+(" + gCurve + ")*(" + m + ")" );
      var bCurved = clipExpr( "(" + bAcc + ")*(1-(" + m + "))+(" + bCurve + ")*(" + m + ")" );

      rAcc = clipExpr( "(" + rCurved + ")*(1-(" + hMix + "))+(" + rHue + ")*(" + hMix + ")" );
      gAcc = clipExpr( "(" + gCurved + ")*(1-(" + hMix + "))+(" + gHue + ")*(" + hMix + ")" );
      bAcc = clipExpr( "(" + bCurved + ")*(1-(" + hMix + "))+(" + bHue + ")*(" + hMix + ")" );
   }

   var r1 = rAcc;
   var g1 = gAcc;
   var b1 = bAcc;
   if ( Math.abs( values.saturation - 1.0 ) > 1e-6 )
   {
      var luma = "(0.2126*(" + rAcc + ")+0.7152*(" + gAcc + ")+0.0722*(" + bAcc + "))";
      r1 = clipExpr( luma + "+" + sat + "*( (" + rAcc + ")-(" + luma + ") )" );
      g1 = clipExpr( luma + "+" + sat + "*( (" + gAcc + ")-(" + luma + ") )" );
      b1 = clipExpr( luma + "+" + sat + "*( (" + bAcc + ")-(" + luma + ") )" );
   }

   // Global Masks: for now Star Protection acts as a protective blend between
   // the original palette and the processed result. This makes boosted controls
   // realtime-safe while reducing color/contrast changes in stars and strong
   // highlights. Presets only configure controls; they are not directly masked.
   r1 = buildStarProtectionBlendExpression( R, r1, R, G, B );
   g1 = buildStarProtectionBlendExpression( G, g1, R, G, B );
   b1 = buildStarProtectionBlendExpression( B, b1, R, G, B );

   return [r1, g1, b1];
}

function buildPreviewRefinementExpressionsForSource( sourceR, sourceG, sourceB, includeGoldAccent )
{
   // v0.13.47: When an Advanced result has been frozen as a new preview base,
   // realtime Boosted controls are applied as fine-tuning deltas over that
   // frozen image instead of recomputing the whole Advanced stack.
   var values = data.previewRefinementOverrideValues || getCurrentPreviewRefinementValues( includeGoldAccent );
   return buildUnifiedRefinementExpressions( sourceR, sourceG, sourceB, values );
}

function getCurrentPreviewBaseRefinementValues( includeGoldAccent )
{
   var v = data.previewRefinementOverrideValues || getCurrentPreviewRefinementValues( includeGoldAccent );
   var b = {};
   for ( var k in v )
      b[k] = v[k];
   b.cyanGoldBalance = 0.0;
   b.redYellowBalance = 0.0;
   return b;
}

function buildPreviewBaseRefinementExpressionsForSource( sourceR, sourceG, sourceB, includeGoldAccent )
{
   return buildUnifiedRefinementExpressions( sourceR, sourceG, sourceB, getCurrentPreviewBaseRefinementValues( includeGoldAccent ) );
}

function getCurrentPreviewStructuralRefinementValues()
{
   var v = data.previewRefinementOverrideValues || getCurrentPreviewRefinementValues( false );
   var b = {};
   for ( var k in v )
      b[k] = v[k];
   b.brightness = 1.0;
   b.contrast = 1.0;
   b.saturation = 1.0;
   b.cyanGoldBalance = 0.0;
   b.redYellowBalance = 0.0;
   b.goldAccent = 0.0;
   b.channelLightnessAmount = 0.0;
   return b;
}

function buildPreviewStructuralRefinementExpressionsForSource( sourceR, sourceG, sourceB )
{
   return buildUnifiedRefinementExpressions( sourceR, sourceG, sourceB, getCurrentPreviewStructuralRefinementValues() );
}

function hasStructuralPreviewRefinementsToApply()
{
   return Math.abs((data.previewSCNR || 0.0)) > 1e-6 ||
          Math.abs((data.previewOIIIBoost || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewSIIBoost || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewShadowPoint || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewHighlightReduction || 1.0)-1.0) > 1e-6;
}

function hasToneSaturationPreviewRefinementsToApply()
{
   return Math.abs((data.previewBrightness || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewContrast || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewSaturation || 1.0)-1.0) > 1e-6;
}

function previewStructuralBaseParameterKeyForView( view, skipAdvancedStack )
{
   return JSON.stringify( {
      viewId: isValidView( view ) ? view.id : "",
      viewWidth: isValidView( view ) ? view.image.width : 0,
      viewHeight: isValidView( view ) ? view.image.height : 0,
      viewChannels: isValidView( view ) ? view.image.numberOfChannels : 0,
      previewQuality: data.previewQuality,
      skipAdvancedStack: !!skipAdvancedStack,
      scnr: data.previewSCNR,
      oiii: data.previewOIIIBoost,
      sii: data.previewSIIBoost,
      shadow: data.previewShadowPoint,
      highlight: data.previewHighlightReduction,
      maskEnabled: data.previewEnableMaskProtection || data.previewEnableStarProtection,
      maskPreset: data.previewMaskPreset || 0,
      maskAmount: data.previewStarProtectionAmount,
      invertMask: data.previewInvertMask,
      autoStretch: data.previewAutoStretch,
      linkedSHO: shouldUseLinkedSHODisplayStretch()
   } );
}

function previewToneSatBaseParameterKeyForView( upstreamKey, upstreamView )
{
   return JSON.stringify( {
      upstreamKey: upstreamKey || "",
      upstreamViewId: isValidView( upstreamView ) ? upstreamView.id : "",
      brightness: data.previewBrightness,
      contrast: data.previewContrast,
      saturation: data.previewSaturation,
      autoStretch: data.previewAutoStretch,
      linkedSHO: shouldUseLinkedSHODisplayStretch()
   } );
}

function buildPreviewToneSaturationExpressionsForTarget()
{
   function clipExpr( e )
   {
      return "min(1,max(0,(" + e + ")))";
   }

   var v = data.previewRefinementOverrideValues || getCurrentPreviewRefinementValues( false );
   var brVal = v.brightness || 1.0;
   var ctVal = v.contrast || 1.0;
   var satVal = v.saturation || 1.0;
   var br = formatFloat( brVal, 3 );
   var ct = formatFloat( ctVal, 3 );
   var sat = formatFloat( satVal, 3 );

   var r = "$T[0]";
   var g = "$T[1]";
   var b = "$T[2]";

   if ( Math.abs( brVal - 1.0 ) > 1e-6 )
   {
      r = clipExpr( br + "*(" + r + ")" );
      g = clipExpr( br + "*(" + g + ")" );
      b = clipExpr( br + "*(" + b + ")" );
   }

   if ( Math.abs( ctVal - 1.0 ) > 1e-6 )
   {
      r = clipExpr( "((" + r + "-0.5)*" + ct + "+0.5)" );
      g = clipExpr( "((" + g + "-0.5)*" + ct + "+0.5)" );
      b = clipExpr( "((" + b + "-0.5)*" + ct + "+0.5)" );
   }

   if ( Math.abs( satVal - 1.0 ) > 1e-6 )
   {
      var luma = "(0.2126*(" + r + ")+0.7152*(" + g + ")+0.0722*(" + b + "))";
      r = clipExpr( luma + "+" + sat + "*( (" + r + ")-(" + luma + ") )" );
      g = clipExpr( luma + "+" + sat + "*( (" + g + ")-(" + luma + ") )" );
      b = clipExpr( luma + "+" + sat + "*( (" + b + ")-(" + luma + ") )" );
   }

   return [ r, g, b ];
}

function applyPreviewToneSaturationOnlyToView( view, maskReferenceView )
{
   if ( !isValidView( view ) || view.image.numberOfChannels != 3 || !hasToneSaturationPreviewRefinementsToApply() )
      return;

   var apsToneOnlyStart = apsNowMs();
   var exprs = buildPreviewToneSaturationExpressionsForTarget();

   // v1.0.10: when a mask is active, keep the layered preview path visually
   // consistent with the previous unified path by applying tone/saturation only
   // through the same protection/selection mask built from the original palette
   // source. This allows cached structural/tone stages with masks enabled.
   if ( isAnyMaskActive() && isValidView( maskReferenceView ) )
   {
      var r0 = maskReferenceView.id + "[0]";
      var g0 = maskReferenceView.id + "[1]";
      var b0 = maskReferenceView.id + "[2]";
      exprs = [
         buildMaskAwareEffectExpression( r0, exprs[0], r0, g0, b0 ),
         buildMaskAwareEffectExpression( g0, exprs[1], r0, g0, b0 ),
         buildMaskAwareEffectExpression( b0, exprs[2], r0, g0, b0 )
      ];
   }

   view.beginProcess( UndoFlag_NoSwapFile );
   var P = new PixelMath;
   P.expression = exprs[0];
   P.expression1 = exprs[1];
   P.expression2 = exprs[2];
   P.useSingleExpression = false;
   P.symbols = "";
   P.clearImageCacheAndExit = false;
   P.cacheGeneratedImages = false;
   P.generateOutput = true;
   P.singleThreaded = false;
   P.optimization = true;
   P.use64BitWorkingImage = false;
   P.rescale = false;
   P.truncate = true;
   P.truncateLower = 0;
   P.truncateUpper = 1;
   P.createNewImage = false;
   P.executeOn( view, false );
   view.endProcess();
   apsProfileLog( "tone/saturation PixelMath only", apsToneOnlyStart );
}


function hasColorBalanceRefinementsToApply()
{
   return Math.abs((data.previewCyanGoldBalance || 0.0)) > 1e-6 ||
          Math.abs((data.previewRedYellowBalance || 0.0)) > 1e-6;
}

function hasBaseNonGoldPreviewRefinementsToApply()
{
   return Math.abs((data.previewSCNR || 0.0)) > 1e-6 ||
          Math.abs((data.previewOIIIBoost || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewSIIBoost || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewShadowPoint || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewHighlightReduction || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewBrightness || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewContrast || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewSaturation || 1.0)-1.0) > 1e-6;
}

function previewColorBaseParameterKeyForView( view, skipAdvancedStack )
{
   return JSON.stringify( {
      viewId: isValidView( view ) ? view.id : "",
      viewWidth: isValidView( view ) ? view.image.width : 0,
      viewHeight: isValidView( view ) ? view.image.height : 0,
      viewChannels: isValidView( view ) ? view.image.numberOfChannels : 0,
      previewQuality: data.previewQuality,
      skipAdvancedStack: !!skipAdvancedStack,
      scnr: data.previewSCNR,
      oiii: data.previewOIIIBoost,
      sii: data.previewSIIBoost,
      shadow: data.previewShadowPoint,
      highlight: data.previewHighlightReduction,
      brightness: data.previewBrightness,
      contrast: data.previewContrast,
      saturation: data.previewSaturation,
      maskEnabled: data.previewEnableMaskProtection || data.previewEnableStarProtection,
      maskPreset: data.previewMaskPreset || 0,
      maskAmount: data.previewStarProtectionAmount,
      invertMask: data.previewInvertMask,
      autoStretch: data.previewAutoStretch,
      linkedSHO: shouldUseLinkedSHODisplayStretch()
   } );
}

function curveMidtoneExpr( x, amount )
{
   function clipExpr( e )
   {
      return "min(1,max(0,(" + e + ")))";
   }
   // SelectiveColorCorrection uses a midpoint curve with y(0.5)=0.5+0.4*fac.
   // The equivalent PixelMath form is x + k*x*(1-x), with k ~= 1.6*fac.
   return clipExpr( "(" + x + ") + " + formatFloat( 1.60*amount, 3 ) + "*(" + x + ")*(1-(" + x + "))" );
}

function maskedCurveMidtoneExpr( x, amount, maskExpr )
{
   function clipExpr( e )
   {
      return "min(1,max(0,(" + e + ")))";
   }
   var curved = curveMidtoneExpr( x, amount );
   return clipExpr( "(" + x + ")*(1-(" + maskExpr + "))+(" + curved + ")*(" + maskExpr + ")" );
}


function previewColorWarmMaskParameterKeyForView( toneKey, toneView )
{
   return JSON.stringify( {
      toneKey: toneKey || "",
      toneViewId: isValidView( toneView ) ? toneView.id : "",
      width: isValidView( toneView ) ? toneView.image.width : 0,
      height: isValidView( toneView ) ? toneView.image.height : 0
   } );
}

function getOrCreateLargePreviewWarmMaskView( toneView, toneKey )
{
   if ( !isValidView( toneView ) || toneView.image.numberOfChannels != 3 || !hasColorBalanceRefinementsToApply() )
      return null;

   var key = previewColorWarmMaskParameterKeyForView( toneKey, toneView );
   if ( gLargePreviewWarmMaskKey == key && gLargePreviewWarmMaskViewId.length > 0 )
   {
      var cached = View.viewById( gLargePreviewWarmMaskViewId );
      if ( isValidView( cached ) )
      {
         apsProfileCacheNote( "color warm mask", true );
         return cached;
      }
   }

   apsProfileCacheNote( "color warm mask", false );
   if ( gLargePreviewWarmMaskViewId.length > 0 )
      safeForceCloseWindowById( gLargePreviewWarmMaskViewId );

   var maskId = PREVIEW_PREFIX + "LARGE_COLOR_WARM_MASK";
   safeForceCloseWindowById( maskId );

   var apsMaskStart = apsNowMs();
   var P = new PixelMath;
   P.expression = buildSCCRedMaskExpr();
   P.useSingleExpression = true;
   P.symbols = "";
   P.clearImageCacheAndExit = false;
   P.cacheGeneratedImages = false;
   P.generateOutput = true;
   P.singleThreaded = false;
   P.optimization = true;
   P.use64BitWorkingImage = false;
   P.rescale = false;
   P.truncate = true;
   P.truncateLower = 0;
   P.truncateUpper = 1;
   P.createNewImage = true;
   P.showNewImage = false;
   P.newImageId = maskId;
   P.newImageWidth = 0;
   P.newImageHeight = 0;
   P.newImageAlpha = false;
   P.newImageColorSpace = PixelMath.prototype.Gray;
   P.newImageSampleFormat = PixelMath.prototype.SameAsTarget;

   P.executeOn( toneView, false );
   apsProfileLog( "color warm mask PixelMath", apsMaskStart );

   var w = ImageWindow.windowById( maskId );
   if ( isValidWindow( w ) )
   {
      w.hide();
      gLargePreviewWarmMaskViewId = maskId;
      gLargePreviewWarmMaskKey = key;
      return w.mainView;
   }

   gLargePreviewWarmMaskViewId = "";
   gLargePreviewWarmMaskKey = "";
   return null;
}

function buildSCCRedMaskExpr()
{
   // Same hue family as SelectiveColorCorrection's Red mask, used to avoid
   // painting the whole image yellow/orange when Red/Yellow is moved. The mask
   // is intentionally strengthened because CIEc/H masks tend to be soft on
   // nebular data.
   var h = "H($T)";
   var c = "CIEc($T)";
   var red = "iswitch((" + h + ")<=0,~mtf(((" + h + ")+1-(5/6))/(1/6),0)*(" + c + ")," +
             "(" + h + ")<=(1/6),~mtf(((1/6)-(" + h + "))/(1/6),0)*(" + c + ")," +
             "(" + h + ")<(5/6),0,~mtf(((" + h + ")-(5/6))/(1/6),0)*(" + c + "))";
   return "min(1,max(0,4.0*(" + red + ")))";
}


function buildPreviewColorBalanceOnlyExpressionsForTarget( warmMaskOverride )
{
   var r = "$T[0]";
   var g = "$T[1]";
   var b = "$T[2]";
   var cg = data.previewCyanGoldBalance || 0.0;
   var ry = data.previewRedYellowBalance || 0.0;

   // RC3.11: masked SCC-style color layer. SCC is fast because it applies
   // simple channel curves through a selected hue mask on an already-prepared
   // preview. Here we do the same compactly: Red/Yellow acts through a Red/Warm
   // mask, so it creates orange/red transitions in nebular borders instead of
   // turning the full frame yellow. Cyan/Gold uses a Cyan mask for negative
   // values and the same warm mask for positive/gold values.
   var warmMask = (warmMaskOverride != null && warmMaskOverride.length > 0) ? warmMaskOverride : buildSCCRedMaskExpr();

   if ( Math.abs( cg ) > 1e-6 )
   {
      // RC3.12.3: Cyan/Gold now follows SelectiveColorCorrection's Magenta
      // control behavior, applied through the warm/red mask. Positive values
      // curve R+B upward (magenta tint); negative values curve R+B downward,
      // leaving relatively more yellow/gold in the same warm structures.
      // This matches the SCC Magenta slider much better than the previous
      // cyan-vs-gold dual-mask behavior.
      r = maskedCurveMidtoneExpr( r, cg, warmMask );
      b = maskedCurveMidtoneExpr( b, cg, warmMask );
   }

   if ( ry > 1e-6 )
   {
      // Yellow: SCC Yellow curve through red/warm mask.
      r = maskedCurveMidtoneExpr( r, ry, warmMask );
      g = maskedCurveMidtoneExpr( g, ry, warmMask );
   }
   else if ( ry < -1e-6 )
   {
      // Red: SCC Red curve through red/warm mask.
      r = maskedCurveMidtoneExpr( r, -ry, warmMask );
   }

   return [ r, g, b ];
}

function applyPreviewColorBalanceOnlyToView( view, warmMaskView )
{
   if ( !isValidView( view ) || view.image.numberOfChannels != 3 || !hasColorBalanceRefinementsToApply() )
      return;

   var apsColorOnlyStart = apsNowMs();
   var warmMaskExpr = isValidView( warmMaskView ) ? warmMaskView.id : "";
   var exprs = buildPreviewColorBalanceOnlyExpressionsForTarget( warmMaskExpr );
   view.beginProcess( UndoFlag_NoSwapFile );
   var P = new PixelMath;
   P.expression = exprs[0];
   P.expression1 = exprs[1];
   P.expression2 = exprs[2];
   P.useSingleExpression = false;
   P.symbols = "";
   P.clearImageCacheAndExit = false;
   P.cacheGeneratedImages = false;
   P.generateOutput = true;
   P.singleThreaded = false;
   P.optimization = true;
   P.use64BitWorkingImage = false;
   P.rescale = false;
   P.truncate = true;
   P.truncateLower = 0;
   P.truncateUpper = 1;
   P.createNewImage = false;
   P.executeOn( view, false );
   view.endProcess();
   apsProfileLog( "color balance PixelMath only", apsColorOnlyStart );
}

function renderStudioBitmapFromView( view, colorReferenceView )
{
   if ( !isValidView( view ) )
      return null;

   var apsRenderStart = apsNowMs();
   var bmp = null;
   try
   {
      // Same rendering signature used by ImageBlend's preview control.  The
      // explicit parameters avoid the default render() path, which can differ
      // slightly from PixInsight's normal view display in saturation/contrast.
      bmp = view.image.render( 1, false, false );
   }
   catch ( e1 )
   {
      try { bmp = view.image.render(); }
      catch ( e2 ) { bmp = null; }
   }

   if ( bmp == null )
      return null;

   // Match PixInsight view colour-management behaviour as closely as possible.
   // ImageBlend applies the source view window colour transformation to the
   // rendered bitmap; doing the same here avoids display-only colour shifts in
   // the embedded panel without changing the actual image data.
   try
   {
      var ref = isValidView( colorReferenceView ) ? colorReferenceView : view;
      if ( isValidView( ref ) && isValidWindow( ref.window ) )
         ref.window.applyColorTransformation( bmp );
   }
   catch ( e3 )
   {
      // Not all PixInsight builds/configurations expose colour transformation
      // identically; the raw bitmap is still valid if this fails.
   }

   apsProfileLog( "preview bitmap render", apsRenderStart );
   return bmp;
}

function createBoostedPreviewBitmap( view )
{
   if ( !isValidView( view ) )
      return null;

   if ( !hasPreviewRefinementsToApply() )
      return renderAutoStretchedDisplayBitmap( view, view, PREVIEW_PREFIX + "BOOST_DISPLAY_DIRECT" );

   var outId = PREVIEW_PREFIX + "BOOST_PREVIEW";
   safeForceCloseWindowById( outId );

   if ( isDirectMonoOriginalTileView( view ) && data.previewAutoStretch )
   {
      var boostedView = createDirectMonoOriginalBoostedViewFromBase( view, outId, true, true );
      if ( isValidView( boostedView ) )
      {
         if ( isValidWindow( boostedView.window ) ) boostedView.window.hide();
         var bmpDirect = renderStudioBitmapFromView( boostedView, view );
         safeForceCloseWindowById( outId );
         return bmpDirect;
      }
      safeForceCloseWindowById( outId );
      return renderAutoStretchedDisplayBitmap( view, view, PREVIEW_PREFIX + "BOOST_DISPLAY_FALLBACK_DIRECT" );
   }

   var src = view.id;

   var tmpData = new parametersPrototype();
   tmpData.setDefaults();
   tmpData.currentView = view;
   tmpData.referenceHA = view;
   tmpData.previewSilent = true;
   try
   {
      Console.hide();
      if ( hasBaseNonGoldPreviewRefinementsToApply() || isAnyMaskActive() )
      {
         var exprs = buildPreviewBaseRefinementExpressionsForSource( src + "[0]", src + "[1]", src + "[2]", true );
         pixelMathFcn( tmpData, exprs[0], exprs[1], exprs[2], "", outId, true );
      }
      else
         pixelMathFcn( tmpData, src + "[0]", src + "[1]", src + "[2]", "", outId, true );
   }
   catch ( e )
   {
      safeForceCloseWindowById( outId );
      return renderAutoStretchedDisplayBitmap( view, view, PREVIEW_PREFIX + "BOOST_DISPLAY_FALLBACK" );
   }

   var win = ImageWindow.windowById( outId );
   if ( isValidWindow( win ) )
   {
      win.hide();
      applyPreviewColorBalanceOnlyToView( win.mainView );
      if ( data.previewAutoStretch )
         applyDisplayAutoStretchToView( win.mainView, isDirectMonoOriginalTileView( view ), "boosted thumbnail" );
      var bmp = renderStudioBitmapFromView( win.mainView, view );
      safeForceCloseWindowById( outId );
      return bmp;
   }

   return renderAutoStretchedDisplayBitmap( view, view, PREVIEW_PREFIX + "BOOST_DISPLAY_FALLBACK2" );
}

function createMaskPreviewBitmap( view )
{
   if ( !isValidView( view ) || !isAnyMaskActive() )
      return renderStudioBitmapFromView( view, view );

   var cachedBmp = getCachedMaskPreviewBitmapForView( view );
   if ( cachedBmp != null )
      return cachedBmp;

   var maskView = createSelectedMaskView( view );
   if ( isValidView( maskView ) )
   {
      var cachedGeneratedBmp = renderStudioBitmapFromView( maskView, view );
      storeMaskPreviewBitmapCacheForView( view, cachedGeneratedBmp );
      return cachedGeneratedBmp;
   }

   // Expression-only masks and fallback if generated mask creation fails.
   var src = view.id;
   var expr = buildSelectedMaskExpressionFromRGB( src + "[0]", src + "[1]", src + "[2]" );
   var outId = PREVIEW_PREFIX + "MASK_PREVIEW";
   safeForceCloseWindowById( outId );

   var tmpData = new parametersPrototype();
   tmpData.setDefaults();
   tmpData.currentView = view;
   tmpData.referenceHA = view;
   tmpData.previewSilent = true;

   try
   {
      pixelMathFcn( tmpData, expr, "", "", "", outId, false );
      var win = ImageWindow.windowById( outId );
      if ( isValidWindow( win ) )
      {
         win.hide();
         var bmp = renderStudioBitmapFromView( win.mainView, view );
         storeMaskPreviewBitmapCacheForView( view, bmp );
         safeForceCloseWindowById( outId );
         return bmp;
      }
   }
   catch ( e )
   {
      safeForceCloseWindowById( outId );
      Console.warningln( "Mask preview skipped: ", e );
   }

   return renderStudioBitmapFromView( view, view );
}

// Large preview display path: create a real temporary refined view and render the
// panel from it. This mirrors the debug image path and avoids using thumbnail
// display artifacts for the large preview. The window is kept hidden and reused
// through the bitmap cache, so selecting miniatures remains fast.
function createLargePreviewPanelBitmap( view, skipAdvancedStack )
{
   if ( !isValidView( view ) )
      return null;

   var apsLargePreviewStart = apsNowMs();
   skipAdvancedStack = !!skipAdvancedStack;

   if ( data.previewShowMaskPreview && isAnyMaskActive() )
   {
      apsProfileNote( "large preview route", "mask preview" );
      var apsMaskBmp = createMaskPreviewBitmap( view );
      apsProfileLog( "large preview total", apsLargePreviewStart );
      return apsMaskBmp;
   }

   // Prepare generated masks for realtime Boosted/Advanced modulation.
   // Star Protection and Blue Core are reused by PixelMath through
   // gActiveStarMaskViewId.
   if ( isAnyMaskActive() )
      createSelectedMaskView( view );
   else
      gActiveStarMaskViewId = "";

   var goldEnabled = !skipAdvancedStack && data.previewEnableSIIAccent && Math.abs((data.previewSIIHighlightAccent || 0.0)) > 1e-6;
   var lightnessEnabled = !skipAdvancedStack && isLightnessActive();
   var channelLightnessEnabled = !skipAdvancedStack && isChannelLightnessActive();
   var advancedStackEnabled = !skipAdvancedStack && data.previewAdvancedLayerStack != null && data.previewAdvancedLayerStack.length > 0;
   // Advanced controls are Apply-only. The current checkbox/slider values
   // must be rendered only while Calculate & Apply is committing the pending
   // layer. Without this guard, a neutral Boosted state can take the direct
   // preview route and ignore the pending Advanced layer entirely.
   var pendingAdvancedEnabled = (goldEnabled || lightnessEnabled || channelLightnessEnabled) &&
                                data.previewForcePendingAdvancedLayer === true;

   if ( data.previewShowLastPreview || (!hasPreviewRefinementsToApply() && !pendingAdvancedEnabled) )
   {
      apsProfileNote( "large preview route", "direct/original" );
      var apsDirectBmp = renderAutoStretchedDisplayBitmap( view, view, PREVIEW_PREFIX + "LARGE_DISPLAY_DIRECT" );
      apsProfileLog( "large preview total", apsLargePreviewStart );
      return apsDirectBmp;
   }

   if ( shouldUseLinkedSHODisplayStretch() && data.selectedPreviewBoosted && data.previewAutoStretch )
   {
      var boostedLargeId = nextLargePreviewRefinedId();
      gLastLargePreviewRefinedViewId = boostedLargeId;
      cleanupOldLargePreviewRefinedWindows( boostedLargeId );
      var boostedLarge = createDirectMonoOriginalBoostedViewFromBase( view, boostedLargeId, false, skipAdvancedStack );
      if ( isValidView( boostedLarge ) )
      {
         apsProfileNote( "large preview route", "direct mono SHO boosted" );
         if ( isValidWindow( boostedLarge.window ) ) boostedLarge.window.hide();
         var apsDirectMonoBmp = renderStudioBitmapFromView( boostedLarge, view );
         apsProfileLog( "large preview total", apsLargePreviewStart );
         return apsDirectMonoBmp;
      }
   }

   var src = view.id;
   var outId = nextLargePreviewRefinedId();
   gLastLargePreviewRefinedViewId = outId;
   cleanupOldLargePreviewRefinedWindows( outId );

   var tmpData = new parametersPrototype();
   tmpData.setDefaults();
   tmpData.currentView = view;
   tmpData.referenceHA = view;
   tmpData.previewSilent = true;

   try
   {
      // RC5.1: layered Boosted cache.  Split the preview chain into:
      //   A: selected palette tile (view)
      //   B: structural boost (SCNR/OIII/SII/shadows/highlights)
      //   C: tone/saturation (brightness/contrast/saturation)
      //   D: SCC-like color and Advanced pending effects
      // This preserves C/D slider values when B changes, but avoids rebuilding
      // B when only C or D controls move.  v1.0.10 also keeps masks on this
      // layered path: generated masks use an LRU cache and tone/saturation is
      // blended through the same protection/selection mask as the unified path.
      var useLayeredCache = true;

      if ( useLayeredCache )
      {
         apsProfileNote( "large preview route", "layered cache" );
         var structuralView = view;
         var structuralKey = previewStructuralBaseParameterKeyForView( view, skipAdvancedStack );

         if ( hasStructuralPreviewRefinementsToApply() )
         {
            if ( gLargePreviewStructuralBaseKey == structuralKey && gLargePreviewStructuralBaseViewId.length > 0 )
               structuralView = View.viewById( gLargePreviewStructuralBaseViewId );

            var apsStructuralHit = isValidView( structuralView ) && structuralView.id != view.id;
            apsProfileCacheNote( "structural layer", apsStructuralHit );

            if ( !isValidView( structuralView ) || structuralView.id == view.id )
            {
               if ( gLargePreviewStructuralBaseViewId.length > 0 )
                  safeForceCloseWindowById( gLargePreviewStructuralBaseViewId );
               if ( gLargePreviewToneSatBaseViewId.length > 0 )
                  safeForceCloseWindowById( gLargePreviewToneSatBaseViewId );
               gLargePreviewToneSatBaseViewId = "";
               gLargePreviewToneSatBaseKey = "";

               var structuralId = PREVIEW_PREFIX + "LARGE_STRUCTURAL_BASE";
               safeForceCloseWindowById( structuralId );
               var structuralExprs = buildPreviewStructuralRefinementExpressionsForSource( src + "[0]", src + "[1]", src + "[2]" );
               var apsStructuralStart = apsNowMs();
               pixelMathFcn( tmpData, structuralExprs[0], structuralExprs[1], structuralExprs[2], "", structuralId, true );
               apsProfileLog( "large preview structural layer", apsStructuralStart );

               var structuralWin = ImageWindow.windowById( structuralId );
               if ( isValidWindow( structuralWin ) )
               {
                  structuralWin.hide();
                  structuralView = structuralWin.mainView;
                  gLargePreviewStructuralBaseViewId = structuralId;
                  gLargePreviewStructuralBaseKey = structuralKey;
               }
            }
         }
         else
         {
            if ( gLargePreviewStructuralBaseViewId.length > 0 )
               safeForceCloseWindowById( gLargePreviewStructuralBaseViewId );
            gLargePreviewStructuralBaseViewId = "";
            gLargePreviewStructuralBaseKey = "";
            structuralKey = previewStructuralBaseParameterKeyForView( view, skipAdvancedStack ) + "|identity";
            structuralView = view;
         }

         var toneView = structuralView;
         var toneKey = previewToneSatBaseParameterKeyForView( structuralKey, structuralView );

         if ( hasToneSaturationPreviewRefinementsToApply() )
         {
            if ( gLargePreviewToneSatBaseKey == toneKey && gLargePreviewToneSatBaseViewId.length > 0 )
               toneView = View.viewById( gLargePreviewToneSatBaseViewId );

            var apsToneHit = isValidView( toneView ) && toneView.id != structuralView.id;
            apsProfileCacheNote( "tone/saturation layer", apsToneHit );

            if ( !isValidView( toneView ) || toneView.id == structuralView.id )
            {
               if ( gLargePreviewToneSatBaseViewId.length > 0 )
                  safeForceCloseWindowById( gLargePreviewToneSatBaseViewId );

               var toneId = PREVIEW_PREFIX + "LARGE_TONE_BASE";
               var apsToneStart = apsNowMs();
               var apsToneCopyStart = apsNowMs();
               toneView = makeViewCopy( structuralView, toneId );
               apsProfileLog( "tone/saturation makeViewCopy", apsToneCopyStart );
               if ( isValidView( toneView ) )
               {
                  applyPreviewToneSaturationOnlyToView( toneView, view );
                  gLargePreviewToneSatBaseViewId = toneId;
                  gLargePreviewToneSatBaseKey = toneKey;
                  apsProfileLog( "large preview tone/saturation layer", apsToneStart );
               }
            }
         }
         else
         {
            if ( gLargePreviewToneSatBaseViewId.length > 0 )
               safeForceCloseWindowById( gLargePreviewToneSatBaseViewId );
            gLargePreviewToneSatBaseViewId = "";
            gLargePreviewToneSatBaseKey = "";
            toneView = structuralView;
            toneKey += "|identity";
         }

         if ( isValidView( toneView ) )
         {
            var needsFinalWorkingCopy = hasColorBalanceRefinementsToApply() || advancedStackEnabled ||
                                        pendingAdvancedEnabled || data.previewAutoStretch;
            if ( !needsFinalWorkingCopy )
            {
               // RC5.2: when the cached tone view is already the final display
               // state, render it directly instead of cloning another hidden
               // _APS_LARGE_PREVIEW_REFINED_* window.
               var apsToneRenderBmp = renderStudioBitmapFromView( toneView, view );
               apsProfileLog( "large preview total", apsLargePreviewStart );
               return apsToneRenderBmp;
            }

            var apsFinalLayerStart = apsNowMs();
            var apsFinalCopyStart = apsNowMs();
            var colorView = makeViewCopy( toneView, outId );
            apsProfileLog( "final working makeViewCopy", apsFinalCopyStart );
            if ( isValidView( colorView ) )
            {
               gLastLargePreviewRefinedViewId = outId;
               if ( isValidWindow( colorView.window ) ) colorView.window.hide();
               var colorWarmMaskView = hasColorBalanceRefinementsToApply() ? getOrCreateLargePreviewWarmMaskView( toneView, toneKey ) : null;
               applyPreviewColorBalanceOnlyToView( colorView, colorWarmMaskView );
               if ( advancedStackEnabled )
                  applyAdvancedLayerStackToView( colorView );
               if ( pendingAdvancedEnabled )
               {
                  if ( lightnessEnabled )
                     applyLightnessOnlyToView( colorView );
                  if ( channelLightnessEnabled )
                     applyChannelLightnessOnlyToView( colorView );
                  if ( goldEnabled )
                     applyGoldAccentOnlyToView( colorView );
               }
               if ( data.previewAutoStretch )
                  applyDisplayAutoStretchToView( colorView, shouldUseLinkedSHODisplayStretch(), "large refined display" );
               apsProfileLog( "large preview final working layer", apsFinalLayerStart );
               var apsFinalBmp = renderStudioBitmapFromView( colorView, view );
               apsProfileLog( "large preview total", apsLargePreviewStart );
               return apsFinalBmp;
            }
         }
      }

      apsProfileNote( "large preview route", "legacy fallback" );

      // Legacy fallback: masks and unusual cases use the previous single-base
      // cache to avoid any visual change in protected/selective workflows.
      var baseKey = previewColorBaseParameterKeyForView( view, skipAdvancedStack );
      var baseView = null;
      if ( gLargePreviewColorBaseKey == baseKey && gLargePreviewColorBaseViewId.length > 0 )
         baseView = View.viewById( gLargePreviewColorBaseViewId );

      if ( !isValidView( baseView ) )
      {
         if ( gLargePreviewColorBaseViewId.length > 0 )
            safeForceCloseWindowById( gLargePreviewColorBaseViewId );
         var baseId = PREVIEW_PREFIX + "LARGE_COLOR_BASE";
         safeForceCloseWindowById( baseId );

         var apsLegacyBaseStart = apsNowMs();
         if ( hasBaseNonGoldPreviewRefinementsToApply() || isAnyMaskActive() )
         {
            var baseExprs = buildPreviewBaseRefinementExpressionsForSource( src + "[0]", src + "[1]", src + "[2]", false );
            pixelMathFcn( tmpData, baseExprs[0], baseExprs[1], baseExprs[2], "", baseId, true );
         }
         else
            pixelMathFcn( tmpData, src + "[0]", src + "[1]", src + "[2]", "", baseId, true );
         apsProfileLog( "legacy base PixelMath", apsLegacyBaseStart );

         var baseWin = ImageWindow.windowById( baseId );
         if ( isValidWindow( baseWin ) )
         {
            baseWin.hide();
            baseView = baseWin.mainView;
            gLargePreviewColorBaseViewId = baseId;
            gLargePreviewColorBaseKey = baseKey;
         }
      }

      if ( isValidView( baseView ) )
      {
         var colorViewLegacy = makeViewCopy( baseView, outId );
         if ( isValidView( colorViewLegacy ) )
         {
            gLastLargePreviewRefinedViewId = outId;
            if ( isValidWindow( colorViewLegacy.window ) ) colorViewLegacy.window.hide();
            applyPreviewColorBalanceOnlyToView( colorViewLegacy );
            if ( advancedStackEnabled )
               applyAdvancedLayerStackToView( colorViewLegacy );
            if ( pendingAdvancedEnabled )
            {
               if ( lightnessEnabled )
                  applyLightnessOnlyToView( colorViewLegacy );
               if ( channelLightnessEnabled )
                  applyChannelLightnessOnlyToView( colorViewLegacy );
               if ( goldEnabled )
                  applyGoldAccentOnlyToView( colorViewLegacy );
            }
            if ( data.previewAutoStretch )
               applyDisplayAutoStretchToView( colorViewLegacy, shouldUseLinkedSHODisplayStretch(), "large refined display" );
            var apsLegacyBmp = renderStudioBitmapFromView( colorViewLegacy, view );
            apsProfileLog( "large preview total", apsLargePreviewStart );
            return apsLegacyBmp;
         }
      }
   }
   catch ( e )
   {
      safeForceCloseWindowById( outId );
      var apsFallbackBmp = renderAutoStretchedDisplayBitmap( view, view, PREVIEW_PREFIX + "LARGE_DISPLAY_FALLBACK" );
      apsProfileLog( "large preview total", apsLargePreviewStart );
      return apsFallbackBmp;
   }

   var apsFallbackBmp2 = renderAutoStretchedDisplayBitmap( view, view, PREVIEW_PREFIX + "LARGE_DISPLAY_FALLBACK2" );
   apsProfileLog( "large preview total", apsLargePreviewStart );
   return apsFallbackBmp2;
}


function hasPreviewRefinementsToApply()
{
   return hasBoostedLayerStackToApply() ||
          (data.previewAdvancedLayerStack != null && data.previewAdvancedLayerStack.length > 0) ||
          Math.abs((data.previewSCNR || 0.0)) > 1e-6 ||
          Math.abs((data.previewOIIIBoost || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewSIIBoost || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewShadowPoint || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewHighlightReduction || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewBrightness || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewContrast || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewSaturation || 1.0)-1.0) > 1e-6 ||
          Math.abs((data.previewCyanGoldBalance || 0.0)) > 1e-6 ||
          Math.abs((data.previewRedYellowBalance || 0.0)) > 1e-6;
}



function isChannelLightnessActive()
{
   var src = data.previewChannelLightnessSource || 0;
   return data.previewEnableChannelLightness &&
          (src == 0 || src == 1 || src == 2) &&
          Math.abs((data.previewChannelLightnessAmount || 0.0)) > 1e-6;
}

function isLightnessActive()
{
   var src = data.previewLightnessSource || 0;
   return data.previewEnableLightness &&
          (src == 0 || src == 1 || src == 2) &&
          Math.abs((data.previewLightnessAmount || 0.0)) > 1e-6;
}

function isAnyAdvancedPreviewActive()
{
   return (data.previewEnableSIIAccent && Math.abs((data.previewSIIHighlightAccent || 0.0)) > 1e-6) ||
          isLightnessActive() ||
          isChannelLightnessActive();
}

function getChannelLightnessSourceView( targetView )
{
   // v0.13.53: SII, OIII and Ha are now functional Structure Lift sources.
   // OIII is implemented as a blue-core selective structure lift.
   var src = data.previewChannelLightnessSource || 0;
   if ( src != 0 && src != 1 && src != 2 )
      return null;

   function sameGeometry( v )
   {
      return isValidView( v ) && isValidView( targetView ) &&
             v.image.width == targetView.image.width &&
             v.image.height == targetView.image.height;
   }

   var candidates;
   if ( src == 2 )
   {
      // Ha guide: for Studio previews prefer _APS_HA; for final output prefer
      // the full-size Ha reference/_HA view. Avoid cross-size PixelMath refs.
      candidates = [
         View.viewById( PREVIEW_PREFIX + "HA" ),
         data.referenceHA,
         View.viewById( HA_NAME ),
         View.viewById( HA_NAME + "_LF" )
      ];
   }
   else if ( src == 1 )
   {
      // OIII guide: for Studio previews prefer _APS_OIII; for final output prefer
      // the full-size OIII reference/_OIII view. Avoid cross-size PixelMath refs.
      candidates = [
         View.viewById( PREVIEW_PREFIX + "OIII" ),
         data.referenceOIII,
         View.viewById( O3_NAME ),
         View.viewById( O3_NAME + "_LF" )
      ];
   }
   else
   {
      // SII guide: for Studio previews prefer _APS_SII; for final output prefer
      // the full-size SII reference/_SII view. Avoid cross-size PixelMath refs.
      candidates = [
         View.viewById( PREVIEW_PREFIX + "SII" ),
         data.referenceSII,
         View.viewById( S2_NAME ),
         View.viewById( S2_NAME + "_LF" )
      ];
   }

   for ( var i = 0; i < candidates.length; ++i )
      if ( sameGeometry( candidates[i] ) )
         return candidates[i];

   // Do not return a valid but different-size source view. PixelMath cannot
   // safely mix a reduced preview with a full-size guide, or vice versa.
   // applyChannelLightnessOnlyToView() has a controlled same-target fallback.
   return null;
}

function applyChannelLightnessOnlyToView( view )
{
   if ( !isValidView( view ) || view.image.numberOfChannels != 3 )
      return;

   if ( !isChannelLightnessActive() )
      return;

   var apsStructureLiftStart = apsNowMs();
   var sourceView = getChannelLightnessSourceView( view );
   var srcMode = data.previewChannelLightnessSource || 0;
   var useWarmProxy = !isValidView( sourceView );

   function clipExpr( e )
   {
      return "min(1,max(0,(" + e + ")))";
   }

   var a = formatFloat( data.previewChannelLightnessAmount || 0.0, 3 );
   var R = "$T[0]";
   var G = "$T[1]";
   var B = "$T[2]";
   var L = "(0.2126*(" + R + ")+0.7152*(" + G + ")+0.0722*(" + B + "))";
   // Source guide. Prefer the real same-geometry source guide (_APS_SII/_APS_OIII/_APS_HA
   // for previews, full-size reference for final output). If it is not available,
   // use a same-target proxy so the control remains responsive instead of doing
   // nothing. Ha uses a luminance-biased proxy; OIII uses a cool proxy based on
   // blue and green; SII uses a warm proxy.
   var proxy = (srcMode == 2) ? L : ((srcMode == 1) ? clipExpr("0.25*(" + R + ")+0.75*(max((" + G + "),(" + B + ")))") : "$T[0]");
   var S = clipExpr( useWarmProxy ? proxy : sourceView.id );
   if ( useWarmProxy )
      Console.warningln( "Structure Lift: source view not available; using target proxy." );

   // v0.13.53 Structure Lift color personalities:
   // - SII: warm, red/gold-biased
   // - Ha : neutral, preserves blue/cyan better
   // - OIII: blue-core emphasis, with strong blue and moderate green
   var sourceGate = clipExpr( "((" + S + ")-0.10)/0.40" );
   var shadowGate = clipExpr( "((" + L + ")-0.08)/0.22" );
   var highlightProtect = clipExpr( "(1-(" + L + "))" );
   var structureMask = clipExpr( "(" + sourceGate + ")*(" + shadowGate + ")" );
   var liftScale = (srcMode == 2) ? "0.40" : ((srcMode == 1) ? "0.56" : "0.52");
   var protectionScale = buildStarProtectionEffectScaleExpression( R, G, B );
   var lift = clipExpr( liftScale + "*(" + a + ")*(" + structureMask + ")*(" + highlightProtect + ")*(" + protectionScale + ")" );

   // Source-specific color personality.
   var kR = (srcMode == 2) ? "0.68" : ((srcMode == 1) ? "0.06" : "1.18");
   var kG = (srcMode == 2) ? "0.60" : ((srcMode == 1) ? "0.55" : "0.42");
   var kB = (srcMode == 2) ? "0.34" : ((srcMode == 1) ? "1.35" : "0.06");

   var exprs = [
      clipExpr( "(" + R + ")+" + kR + "*(" + lift + ")" ),
      clipExpr( "(" + G + ")+" + kG + "*(" + lift + ")" ),
      clipExpr( "(" + B + ")+" + kB + "*(" + lift + ")" )
   ];

   view.beginProcess( UndoFlag_NoSwapFile );
   var P = new PixelMath;
   P.expression = exprs[0];
   P.expression1 = exprs[1];
   P.expression2 = exprs[2];
   P.useSingleExpression = false;
   P.symbols = "";
   P.clearImageCacheAndExit = false;
   P.cacheGeneratedImages = false;
   P.generateOutput = true;
   P.singleThreaded = false;
   P.optimization = true;
   P.use64BitWorkingImage = false;
   P.rescale = false;
   P.truncate = true;
   P.truncateLower = 0;
   P.truncateUpper = 1;
   P.createNewImage = false;
   P.executeOn( view, false );
   view.endProcess();
   apsProfileLog( "Structure Lift PixelMath", apsStructureLiftStart );
}

function getLightnessSourceView( targetView )
{
   var src = data.previewLightnessSource || 0;
   if ( src != 0 && src != 1 && src != 2 )
      return null;

   function sameGeometry( v )
   {
      return isValidView( v ) && isValidView( targetView ) &&
             v.image.width == targetView.image.width &&
             v.image.height == targetView.image.height;
   }

   var candidates;
   if ( src == 2 )
      candidates = [ View.viewById( PREVIEW_PREFIX + "HA" ), data.referenceHA, View.viewById( HA_NAME ), View.viewById( HA_NAME + "_LF" ) ];
   else if ( src == 1 )
      candidates = [ View.viewById( PREVIEW_PREFIX + "OIII" ), data.referenceOIII, View.viewById( O3_NAME ), View.viewById( O3_NAME + "_LF" ) ];
   else
      candidates = [ View.viewById( PREVIEW_PREFIX + "SII" ), data.referenceSII, View.viewById( S2_NAME ), View.viewById( S2_NAME + "_LF" ) ];

   for ( var i = 0; i < candidates.length; ++i )
      if ( sameGeometry( candidates[i] ) )
         return candidates[i];
   return null;
}

function applyLightnessOnlyToView( view )
{
   if ( !isValidView( view ) || view.image.numberOfChannels != 3 )
      return;

   if ( !isLightnessActive() )
      return;

   function clipExpr( e )
   {
      return "min(1,max(0,(" + e + ")))";
   }

   var sourceView = getLightnessSourceView( view );
   var srcMode = data.previewLightnessSource || 0;
   // i02: make Channel Lightness another 50% stronger; total response is now 2.0x the original 1.0.8 behavior while keeping the public 0..1 slider range.
   var a = formatFloat( Math.min( 2.0, 2.0*(data.previewLightnessAmount || 0.0) ), 3 );
   var R = "$T[0]";
   var G = "$T[1]";
   var B = "$T[2]";
   var Y = "max(1e-06,(0.2126*(" + R + ")+0.7152*(" + G + ")+0.0722*(" + B + ")))";
   var proxy = (srcMode == 2) ? G : ((srcMode == 1) ? "max((" + G + "),(" + B + "))" : R);
   var S = clipExpr( isValidView( sourceView ) ? sourceView.id : proxy );
   var Lmix = "((1-(" + a + "))*(" + Y + ")+(" + a + ")*(" + S + "))";
   var gain = "min(4,max(0,(" + Lmix + ")/(" + Y + ")))";

   var rLight = clipExpr( "(" + R + ")*(" + gain + ")" );
   var gLight = clipExpr( "(" + G + ")*(" + gain + ")" );
   var bLight = clipExpr( "(" + B + ")*(" + gain + ")" );

   var exprs = [
      buildMaskAwareEffectExpression( R, rLight, R, G, B ),
      buildMaskAwareEffectExpression( G, gLight, R, G, B ),
      buildMaskAwareEffectExpression( B, bLight, R, G, B )
   ];

   applyRGBPixelMathInPlace( view, exprs, "Channel Lightness PixelMath" );
}

function buildGoldAccentMaskExpression()
{
   function clipExpr( e )
   {
      return "min(1,max(0,(" + e + ")))";
   }
   var h = "CIEh($T)";
   var c = "CIEc($T)";
   var hueMask = "iif((" + h + ")<=0.1666666667,~mtf((" + h + ")/0.1666666667,0),iif((" + h + ")<=0.3333333333,~mtf((0.3333333333-(" + h + "))/0.1666666667,0),0))";
   return clipExpr( "4.0*(" + hueMask + ")*(" + c + ")" );
}

function applyConvolutionBlurToView( view )
{
   if ( !isValidView( view ) )
      return false;

   // Fast mask softening.  This follows PixInsight's native Convolution process
   // (Parametric tab: StdDev=4.00, Shape=2.00, Aspect=1.00) as suggested for
   // Gold Accent, but is deliberately wrapped in a safe fallback so the effect
   // still works on builds where process property names differ.
   try
   {
      view.beginProcess( UndoFlag_NoSwapFile );
      var C = new Convolution;
      try { C.mode = Convolution.prototype.Parametric; } catch ( e0 ) {}
      try { C.sigma = 4.00; } catch ( e1 ) {}
      try { C.stdDev = 4.00; } catch ( e2 ) {}
      try { C.shape = 2.00; } catch ( e3 ) {}
      try { C.aspectRatio = 1.00; } catch ( e4 ) {}
      try { C.rotationAngle = 0.00; } catch ( e5 ) {}
      try { C.rotation = 0.00; } catch ( e6 ) {}
      C.executeOn( view, false );
      view.endProcess();
      return true;
   }
   catch ( e )
   {
      try { view.endProcess(); } catch ( ee ) {}
      Console.warningln( "Gold Accent mask convolution skipped: ", e );
      return false;
   }
}

function createGoldAccentMaskView( targetView, maskId )
{
   if ( !isValidView( targetView ) )
      return null;

   safeForceCloseWindowById( maskId );

   var apsGoldMaskStart = apsNowMs();
   var P = new PixelMath;
   P.expression = buildGoldAccentMaskExpression();
   P.useSingleExpression = true;
   P.symbols = "";
   P.clearImageCacheAndExit = false;
   P.cacheGeneratedImages = false;
   P.generateOutput = true;
   P.singleThreaded = false;
   P.optimization = true;
   P.use64BitWorkingImage = false;
   P.rescale = false;
   P.truncate = true;
   P.truncateLower = 0;
   P.truncateUpper = 1;
   P.createNewImage = true;
   P.showNewImage = false;
   P.newImageId = maskId;
   P.newImageWidth = 0;
   P.newImageHeight = 0;
   P.newImageAlpha = false;
   P.newImageColorSpace = PixelMath.prototype.Gray;
   P.newImageSampleFormat = PixelMath.prototype.SameAsTarget;

   P.executeOn( targetView, false );
   apsProfileLog( "Gold Accent mask PixelMath", apsGoldMaskStart );

   var w = ImageWindow.windowById( maskId );
   if ( isValidWindow( w ) )
   {
      w.hide();
      applyConvolutionBlurToView( w.mainView );
      return w.mainView;
   }
   return null;
}

function applyGoldAccentOnlyToView( view )
{
   if ( !isValidView( view ) || view.image.numberOfChannels != 3 )
      return;

   var apsGoldAccentStart = apsNowMs();
   var sha = data.previewSIIHighlightAccent || 0.0;
   if ( !data.previewEnableSIIAccent || Math.abs( sha ) <= 1e-6 )
      return;

   var maskId = PREVIEW_PREFIX + "GOLD_MASK";
   var maskView = createGoldAccentMaskView( view, maskId );
   if ( !isValidView( maskView ) )
      return;

   function clipExpr( e )
   {
      return "min(1,max(0,(" + e + ")))";
   }

   var mId = maskView.id;
   var s = formatFloat( Math.min( 1.0, 1.5*sha ), 3 );
   var R = "$T[0]";
   var G = "$T[1]";
   var B = "$T[2]";
   var protectionScale = buildStarProtectionEffectScaleExpression( R, G, B );
   var M = clipExpr( s + "*(" + mId + ")*(" + protectionScale + ")" );
   var HM = clipExpr( "0.825*" + s + "*(" + mId + ")*(" + protectionScale + ")" );

   var rCurve = clipExpr( "(" + R + ")+0.309*(" + R + ")*(1-(" + R + "))" );
   var gCurve = clipExpr( "(" + G + ")-0.423*(" + G + ")*(1-(" + G + "))" );
   var bCurve = clipExpr( "(" + B + ")+0.041*(" + B + ")*(1-(" + B + "))" );

   var rCurved = clipExpr( "(" + R + ")*(1-(" + M + "))+(" + rCurve + ")*(" + M + ")" );
   var gCurved = clipExpr( "(" + G + ")*(1-(" + M + "))+(" + gCurve + ")*(" + M + ")" );
   var bCurved = clipExpr( "(" + B + ")*(1-(" + M + "))+(" + bCurve + ")*(" + M + ")" );

   var rHue = clipExpr( "(" + rCurve + ")+0.150*(" + rCurve + ")*(1-(" + rCurve + "))" );
   var gHue = clipExpr( "(" + gCurve + ")-0.120*(" + gCurve + ")*(1-(" + gCurve + "))" );
   var bHue = clipExpr( "(" + bCurve + ")-0.030*(" + bCurve + ")*(1-(" + bCurve + "))" );

   var exprs = [
      clipExpr( "(" + rCurved + ")*(1-(" + HM + "))+(" + rHue + ")*(" + HM + ")" ),
      clipExpr( "(" + gCurved + ")*(1-(" + HM + "))+(" + gHue + ")*(" + HM + ")" ),
      clipExpr( "(" + bCurved + ")*(1-(" + HM + "))+(" + bHue + ")*(" + HM + ")" )
   ];

   view.beginProcess( UndoFlag_NoSwapFile );
   var P = new PixelMath;
   P.expression = exprs[0];
   P.expression1 = exprs[1];
   P.expression2 = exprs[2];
   P.useSingleExpression = false;
   P.symbols = "";
   P.clearImageCacheAndExit = false;
   P.cacheGeneratedImages = false;
   P.generateOutput = true;
   P.singleThreaded = false;
   P.optimization = true;
   P.use64BitWorkingImage = false;
   P.rescale = false;
   P.truncate = true;
   P.truncateLower = 0;
   P.truncateUpper = 1;
   P.createNewImage = false;
   P.executeOn( view, false );
   view.endProcess();
   apsProfileLog( "Gold Accent apply PixelMath", apsGoldAccentStart );

   safeForceCloseWindowById( maskId );
}


function cloneAdvancedLayerStack( stack )
{
   var out = [];
   if ( stack == null )
      return out;
   for ( var i = 0; i < stack.length; ++i )
   {
      var l = stack[i];
      out.push( {
         goldEnabled: !!l.goldEnabled,
         goldAmount: l.goldAmount || 0.0,
         channelEnabled: !!l.channelEnabled,
         channelSource: l.channelSource || 0,
         channelAmount: l.channelAmount || 0.0,
         lightnessEnabled: !!l.lightnessEnabled,
         lightnessSource: l.lightnessSource || 0,
         lightnessAmount: l.lightnessAmount || 0.0
      } );
   }
   return out;
}

function cloneBoostedLayerStack( stack )
{
   var out = [];
   if ( stack == null )
      return out;
   for ( var i = 0; i < stack.length; ++i )
   {
      var l = stack[i];
      out.push( {
         scnr: l.scnr || 0.0,
         oiii: (l.oiii != null) ? l.oiii : 1.0,
         sii: (l.sii != null) ? l.sii : 1.0,
         shadow: (l.shadow != null) ? l.shadow : 1.0,
         highlight: (l.highlight != null) ? l.highlight : 1.0,
         brightness: (l.brightness != null) ? l.brightness : 1.0,
         contrast: (l.contrast != null) ? l.contrast : 1.0,
         saturation: (l.saturation != null) ? l.saturation : 1.0,
         cyanGold: l.cyanGold || 0.0,
         redYellow: l.redYellow || 0.0,
         maskEnabled: !!l.maskEnabled,
         maskPreset: l.maskPreset || 0,
         maskAmount: (l.maskAmount != null) ? l.maskAmount : 0.70,
         invertMask: !!l.invertMask
      } );
   }
   return out;
}

function hasBoostedLayerStackToApply()
{
   return data.previewBoostedLayerStack != null && data.previewBoostedLayerStack.length > 0;
}

function captureCurrentBoostedLayer()
{
   return {
      scnr: data.previewSCNR || 0.0,
      oiii: (data.previewOIIIBoost != null) ? data.previewOIIIBoost : 1.0,
      sii: (data.previewSIIBoost != null) ? data.previewSIIBoost : 1.0,
      shadow: (data.previewShadowPoint != null) ? data.previewShadowPoint : 1.0,
      highlight: (data.previewHighlightReduction != null) ? data.previewHighlightReduction : 1.0,
      brightness: (data.previewBrightness != null) ? data.previewBrightness : 1.0,
      contrast: (data.previewContrast != null) ? data.previewContrast : 1.0,
      saturation: (data.previewSaturation != null) ? data.previewSaturation : 1.0,
      cyanGold: data.previewCyanGoldBalance || 0.0,
      redYellow: data.previewRedYellowBalance || 0.0,
      maskEnabled: !!(data.previewEnableMaskProtection || data.previewEnableStarProtection),
      maskPreset: data.previewMaskPreset || 0,
      maskAmount: (data.previewStarProtectionAmount != null) ? data.previewStarProtectionAmount : 0.70,
      invertMask: !!data.previewInvertMask
   };
}

function setBoostedLayerDataTemporarily( layer, callback )
{
   var old = {
      scnr: data.previewSCNR, oiii: data.previewOIIIBoost, sii: data.previewSIIBoost,
      shadow: data.previewShadowPoint, highlight: data.previewHighlightReduction,
      brightness: data.previewBrightness, contrast: data.previewContrast, saturation: data.previewSaturation,
      cyanGold: data.previewCyanGoldBalance, redYellow: data.previewRedYellowBalance,
      maskEnabled: data.previewEnableMaskProtection, starAlias: data.previewEnableStarProtection,
      maskPreset: data.previewMaskPreset, maskAmount: data.previewStarProtectionAmount, invertMask: data.previewInvertMask
   };

   data.previewSCNR = layer.scnr || 0.0;
   data.previewOIIIBoost = (layer.oiii != null) ? layer.oiii : 1.0;
   data.previewSIIBoost = (layer.sii != null) ? layer.sii : 1.0;
   data.previewShadowPoint = (layer.shadow != null) ? layer.shadow : 1.0;
   data.previewHighlightReduction = (layer.highlight != null) ? layer.highlight : 1.0;
   data.previewBrightness = (layer.brightness != null) ? layer.brightness : 1.0;
   data.previewContrast = (layer.contrast != null) ? layer.contrast : 1.0;
   data.previewSaturation = (layer.saturation != null) ? layer.saturation : 1.0;
   data.previewCyanGoldBalance = layer.cyanGold || 0.0;
   data.previewRedYellowBalance = layer.redYellow || 0.0;
   data.previewEnableMaskProtection = !!layer.maskEnabled;
   data.previewEnableStarProtection = !!layer.maskEnabled;
   data.previewMaskPreset = layer.maskPreset || 0;
   data.previewStarProtectionAmount = (layer.maskAmount != null) ? layer.maskAmount : 0.70;
   data.previewInvertMask = !!layer.invertMask;

   try
   {
      return callback();
   }
   finally
   {
      data.previewSCNR = old.scnr; data.previewOIIIBoost = old.oiii; data.previewSIIBoost = old.sii;
      data.previewShadowPoint = old.shadow; data.previewHighlightReduction = old.highlight;
      data.previewBrightness = old.brightness; data.previewContrast = old.contrast; data.previewSaturation = old.saturation;
      data.previewCyanGoldBalance = old.cyanGold; data.previewRedYellowBalance = old.redYellow;
      data.previewEnableMaskProtection = old.maskEnabled; data.previewEnableStarProtection = old.starAlias;
      data.previewMaskPreset = old.maskPreset; data.previewStarProtectionAmount = old.maskAmount; data.previewInvertMask = old.invertMask;
   }
}

function applyBoostedOnlyRefinementsToView( view )
{
   if ( !isValidView( view ) || view.image.numberOfChannels != 3 )
      return;

   if ( !hasBaseNonGoldPreviewRefinementsToApply() && !hasColorBalanceRefinementsToApply() )
      return;

   if ( isAnyMaskActive() )
      createSelectedMaskView( view );
   else
      gActiveStarMaskViewId = "";

   if ( hasBaseNonGoldPreviewRefinementsToApply() )
   {
      if ( !applyPreviewBaseRefinementsStagedToView( view ) )
         applyPreviewBaseRefinementsUnifiedToView( view );
   }

   applyPreviewColorBalanceOnlyToView( view );
}

function applyBoostedLayerStackToView( view )
{
   if ( !isValidView( view ) || data.previewBoostedLayerStack == null || data.previewBoostedLayerStack.length == 0 )
      return false;

   var stack = cloneBoostedLayerStack( data.previewBoostedLayerStack );
   for ( var i = 0; i < stack.length; ++i )
      setBoostedLayerDataTemporarily( stack[i], function(){ applyBoostedOnlyRefinementsToView( view ); } );
   return true;
}

function captureCurrentAdvancedLayer()
{
   return {
      goldEnabled: !!data.previewEnableSIIAccent && Math.abs((data.previewSIIHighlightAccent || 0.0)) > 1e-6,
      goldAmount: data.previewSIIHighlightAccent || 0.0,
      lightnessEnabled: !!data.previewEnableLightness && Math.abs((data.previewLightnessAmount || 0.0)) > 1e-6,
      lightnessSource: data.previewLightnessSource || 0,
      lightnessAmount: data.previewLightnessAmount || 0.0,
      channelEnabled: !!data.previewEnableChannelLightness && Math.abs((data.previewChannelLightnessAmount || 0.0)) > 1e-6,
      channelSource: data.previewChannelLightnessSource || 0,
      channelAmount: data.previewChannelLightnessAmount || 0.0
   };
}

function applyAdvancedLayerToView( view, layer )
{
   if ( !isValidView( view ) || view.image.numberOfChannels != 3 || layer == null )
      return;

   var oldGoldEnabled = data.previewEnableSIIAccent;
   var oldGoldAmount = data.previewSIIHighlightAccent;
   var oldLightnessEnabled = data.previewEnableLightness;
   var oldLightnessSource = data.previewLightnessSource;
   var oldLightnessAmount = data.previewLightnessAmount;
   var oldChannelEnabled = data.previewEnableChannelLightness;
   var oldChannelSource = data.previewChannelLightnessSource;
   var oldChannelAmount = data.previewChannelLightnessAmount;

   try
   {
      data.previewEnableSIIAccent = !!layer.goldEnabled;
      data.previewSIIHighlightAccent = layer.goldAmount || 0.0;
      data.previewEnableLightness = !!layer.lightnessEnabled;
      data.previewLightnessSource = layer.lightnessSource || 0;
      data.previewLightnessAmount = layer.lightnessAmount || 0.0;
      data.previewEnableChannelLightness = !!layer.channelEnabled;
      data.previewChannelLightnessSource = layer.channelSource || 0;
      data.previewChannelLightnessAmount = layer.channelAmount || 0.0;

      if ( isLightnessActive() )
         applyLightnessOnlyToView( view );
      if ( isChannelLightnessActive() )
         applyChannelLightnessOnlyToView( view );
      if ( data.previewEnableSIIAccent && Math.abs((data.previewSIIHighlightAccent || 0.0)) > 1e-6 )
         applyGoldAccentOnlyToView( view );
   }
   finally
   {
      data.previewEnableSIIAccent = oldGoldEnabled;
      data.previewSIIHighlightAccent = oldGoldAmount;
      data.previewEnableLightness = oldLightnessEnabled;
      data.previewLightnessSource = oldLightnessSource;
      data.previewLightnessAmount = oldLightnessAmount;
      data.previewEnableChannelLightness = oldChannelEnabled;
      data.previewChannelLightnessSource = oldChannelSource;
      data.previewChannelLightnessAmount = oldChannelAmount;
   }
}

function applyAdvancedLayerStackToView( view )
{
   var stack = data.previewAdvancedLayerStack || [];
   for ( var i = 0; i < stack.length; ++i )
      applyAdvancedLayerToView( view, stack[i] );
}


function applyRGBPixelMathInPlace( view, exprs, profileLabel )
{
   if ( !isValidView( view ) || view.image.numberOfChannels != 3 )
      return false;

   var t0 = apsNowMs();
   view.beginProcess( UndoFlag_NoSwapFile );
   var P = new PixelMath;
   P.expression = exprs[0];
   P.expression1 = exprs[1];
   P.expression2 = exprs[2];
   P.useSingleExpression = false;
   P.symbols = "";
   P.clearImageCacheAndExit = false;
   P.cacheGeneratedImages = false;
   P.generateOutput = true;
   P.singleThreaded = false;
   P.optimization = true;
   P.use64BitWorkingImage = false;
   P.rescale = false;
   P.truncate = true;
   P.truncateLower = 0;
   P.truncateUpper = 1;
   P.createNewImage = false;
   P.executeOn( view, false );
   view.endProcess();
   if ( profileLabel && profileLabel.length > 0 )
      apsProfileLog( profileLabel, t0 );
   return true;
}

function applyPreviewBaseRefinementsUnifiedToView( view )
{
   var exprs = buildPreviewBaseRefinementExpressionsForSource( "$T[0]", "$T[1]", "$T[2]", false );
   return applyRGBPixelMathInPlace( view, exprs, "final unified base refinements" );
}

function applyPreviewBaseRefinementsStagedToView( view )
{
   /* RC4.2: avoid a single huge full-resolution PixelMath tree for final
    * Boosted output. Apply the same clipped operations in small sequential
    * passes: channel/SCNR -> tone -> saturation. Since buildUnifiedRefinement
    * already clips after each stage, this is visually equivalent in practice
    * but avoids thousands of repeated invariant subexpressions on large frames.
    * If a protective mask is active, fall back to the old unified expression so
    * the mask blend remains exactly preserved.
    */
   if ( !isValidView( view ) || view.image.numberOfChannels != 3 )
      return false;

   if ( isAnyMaskActive() )
      return false;

   var values = data.previewRefinementOverrideValues || getCurrentPreviewBaseRefinementValues( false );

   function clipExpr( e )
   {
      return "min(1,max(0,(" + e + ")))";
   }

   var sc = formatFloat( values.scnr, 3 );
   var ob = formatFloat( values.oiiiBoost, 3 );
   var sb = formatFloat( values.siiBoost, 3 );
   var sp = formatFloat( values.shadowPoint, 3 );
   var hr = formatFloat( values.highlightReduction, 3 );
   var br = formatFloat( values.brightness, 3 );
   var ct = formatFloat( values.contrast, 3 );
   var sat = formatFloat( values.saturation, 3 );

   var didSomething = false;

   if ( Math.abs((values.oiiiBoost || 1.0)-1.0) > 1e-6 ||
        Math.abs((values.siiBoost || 1.0)-1.0) > 1e-6 ||
        Math.abs((values.scnr || 0.0)) > 1e-6 )
   {
      var r0 = clipExpr( sb + "*($T[0])" );
      var g0 = clipExpr( ob + "*($T[1])" );
      var b0 = clipExpr( ob + "*($T[2])" );
      var gLimit = "((" + r0 + ")+ (" + b0 + "))/2";
      var gScnr = clipExpr( "(1-" + sc + ")*(" + g0 + ")+" + sc + "*min((" + g0 + "),(" + gLimit + "))" );
      applyRGBPixelMathInPlace( view, [ r0, gScnr, b0 ], "final staged channel/SCNR" );
      didSomething = true;
   }

   if ( Math.abs((values.shadowPoint || 1.0)-1.0) > 1e-6 ||
        Math.abs((values.highlightReduction || 1.0)-1.0) > 1e-6 ||
        Math.abs((values.brightness || 1.0)-1.0) > 1e-6 ||
        Math.abs((values.contrast || 1.0)-1.0) > 1e-6 )
   {
      var toneExpr = function( x )
      {
         var sh = clipExpr( "((" + x + ")-(" + sp + "-1)*0.25)/(1-(" + sp + "-1)*0.25)" );
         var hi = clipExpr( "(" + sh + ")/(" + sh + "+" + hr + "*(1-(" + sh + ")))" );
         var bt = clipExpr( br + "*(" + hi + ")" );
         return clipExpr( "((" + bt + "-0.5)*" + ct + "+0.5)" );
      };
      applyRGBPixelMathInPlace( view, [ toneExpr("$T[0]"), toneExpr("$T[1]"), toneExpr("$T[2]") ], "final staged tone" );
      didSomething = true;
   }

   if ( Math.abs((values.saturation || 1.0)-1.0) > 1e-6 )
   {
      var luma = "(0.2126*($T[0])+0.7152*($T[1])+0.0722*($T[2]))";
      var rSat = clipExpr( luma + "+" + sat + "*(($T[0])-(" + luma + "))" );
      var gSat = clipExpr( luma + "+" + sat + "*(($T[1])-(" + luma + "))" );
      var bSat = clipExpr( luma + "+" + sat + "*(($T[2])-(" + luma + "))" );
      applyRGBPixelMathInPlace( view, [ rSat, gSat, bSat ], "final staged saturation" );
      didSomething = true;
   }

   return didSomething;
}

function advancedLayerEquals( a, b )
{
   if ( a == null || b == null )
      return false;
   return (!!a.goldEnabled == !!b.goldEnabled) &&
          Math.abs((a.goldAmount || 0.0) - (b.goldAmount || 0.0)) < 1e-6 &&
          (!!a.lightnessEnabled == !!b.lightnessEnabled) &&
          ((a.lightnessSource || 0) == (b.lightnessSource || 0)) &&
          Math.abs((a.lightnessAmount || 0.0) - (b.lightnessAmount || 0.0)) < 1e-6 &&
          (!!a.channelEnabled == !!b.channelEnabled) &&
          ((a.channelSource || 0) == (b.channelSource || 0)) &&
          Math.abs((a.channelAmount || 0.0) - (b.channelAmount || 0.0)) < 1e-6;
}

function currentAdvancedLayerAlreadyCommitted()
{
   var current = captureCurrentAdvancedLayer();
   if ( !(current.goldEnabled || current.lightnessEnabled || current.channelEnabled) )
      return true;
   var stack = data.previewAdvancedLayerStack || [];
   if ( stack.length == 0 )
      return false;
   return advancedLayerEquals( current, stack[stack.length-1] );
}

function applyPreviewRefinementsToView( view )
{
   if ( !isValidView( view ) || view.image.numberOfChannels != 3 )
      return;

   var boostedStackApplied = applyBoostedLayerStackToView( view );

   if ( !hasPreviewRefinementsToApply() )
      return;

   var goldEnabled = data.previewEnableSIIAccent && Math.abs((data.previewSIIHighlightAccent || 0.0)) > 1e-6;
   var lightnessEnabled = isLightnessActive();
   var channelLightnessEnabled = isChannelLightnessActive();

   if ( isAnyMaskActive() )
      createSelectedMaskView( view );
   else
      gActiveStarMaskViewId = "";

   if ( hasBaseNonGoldPreviewRefinementsToApply() )
   {
      if ( !applyPreviewBaseRefinementsStagedToView( view ) )
         applyPreviewBaseRefinementsUnifiedToView( view );
   }

   applyPreviewColorBalanceOnlyToView( view );

   // Advanced stack. Replay committed layers first. If the user has edited an
   // Advanced layer in realtime but has not pressed Apply yet, also apply the
   // pending visible layer unless it is identical to the last committed layer.
   if ( data.previewAdvancedLayerStack != null && data.previewAdvancedLayerStack.length > 0 )
      applyAdvancedLayerStackToView( view );

   if ( (goldEnabled || lightnessEnabled || channelLightnessEnabled) && !currentAdvancedLayerAlreadyCommitted() )
   {
      if ( lightnessEnabled )
         applyLightnessOnlyToView( view );
      if ( channelLightnessEnabled )
         applyChannelLightnessOnlyToView( view );
      if ( goldEnabled )
         applyGoldAccentOnlyToView( view );
   }
}

function isFinalPaletteOutputId( id )
{
   if ( id == "h" || id == "o" || id == "s" || id == "ho" || id == "hs" || id == "os" )
      return false;
   if ( id == SHO_NAME || id == HA_NAME || id == O3_NAME || id == S2_NAME )
      return false;
   if ( id.indexOf( PREVIEW_PREFIX ) == 0 )
      return false;
   if ( id.indexOf( "_LF" ) >= 0 )
      return false;
   return true;
}



function viewHasRGBChannels( view )
{
   return isValidView( view ) && view.image.numberOfChannels >= 3;
}

function createRGBCopyForThumbnail( data, view, outId )
{
   if ( !isValidView( view ) )
      return null;

   safeForceCloseWindowById( outId );

   var tmpData = new parametersPrototype();
   tmpData.setDefaults();
   tmpData.currentView = view;
   tmpData.referenceHA = view;
   tmpData.previewSilent = true;

   if ( viewHasRGBChannels( view ) )
      return pixelMathFcn( tmpData, view.id + "[0]", view.id + "[1]", view.id + "[2]", "", outId, true );

   return pixelMathFcn( tmpData, view.id, view.id, view.id, "", outId, true );
}

function syntheticSIIBlendWeights( data )
{
   /* Keep the synthetic channel close to the existing Classic blend semantics.
    * Soft/default = 60% Ha + 40% OIII, neutral = 50/50, hard = 70/30.
    */
   switch ( data.blendMode )
   {
      case 1: return { ha:0.50, oiii:0.50 };
      case 3: return { ha:0.70, oiii:0.30 };
      default: return { ha:0.60, oiii:0.40 };
   }
}

function syntheticSIIExpression( data, HA, OIII )
{
   var w = syntheticSIIBlendWeights( data );
   return "(" + w.ha.toFixed(2) + "*" + HA + "+" + w.oiii.toFixed(2) + "*" + OIII + ")";
}



function syntheticSIIOscLikeOIIIFraction( data )
{
   /* OSC-like synthetic SII for Ha/OIII-only DBXtract workflows.
    * Keep the proxy close to Ha, with a small OIII contribution to mimic the
    * residual RGB/OSC mixing that the original AutoPalette route naturally sees.
    */
   switch ( data.blendMode )
   {
      case 1: return 0.12; // Neutral
      case 3: return 0.20; // Hard
      default: return 0.15; // Soft/default
   }
}

function syntheticForaxxOIIIMaskFactor( data )
{
   /* Only affects PIP map generation for synthetic-SII Foraxx variants.
    * Lowering OIII slightly makes DBXtract Ha/OIII previews behave closer to
    * the mixed OSC/RGB route, without altering the actual blue/OIII output channel.
    */
   switch ( data.blendMode )
   {
      case 1: return 0.95; // Neutral
      case 3: return 0.85; // Hard
      default: return 0.90; // Soft/default
   }
}

function syntheticSIIOscLikeExpression( data, HA, OIII )
{
   var a = syntheticSIIOscLikeOIIIFraction( data );
   return "((" + (1-a).toFixed(2) + ")*(" + HA + ")+(" + a.toFixed(2) + ")*(" + OIII + "))";
}

function syntheticSIISubtleMixFactor( data )
{
   /* Subtle Ha/OIII-only Foraxx HOS: keep the synthetic SII proxy close to OIII
    * so the result remains near the bicolor Classic Foraxx, with only a controlled
    * sulfur-like tint.
    */
   switch ( data.blendMode )
   {
      case 1: return 0.16; // Neutral
      case 3: return 0.28; // Hard
      default: return 0.22; // Soft/default
   }
}

function syntheticSIISubtleContrastFactor( data )
{
   switch ( data.blendMode )
   {
      case 1: return 0.15; // Neutral
      case 3: return 0.30; // Hard
      default: return 0.22; // Soft/default
   }
}

function syntheticSIISubtleForaxxHOSExpression( data, HA, OIII )
{
   var a = syntheticSIISubtleMixFactor( data );
   var k = syntheticSIISubtleContrastFactor( data );
   var ps = data.pipStrength;
   var ho = pipMapExpression( "(" + HA + ")*(" + OIII + ")", ps );
   var contrast = "max(0,(" + HA + ")-" + k.toFixed(2) + "*(" + OIII + "))";
   var pipGuided = "(" + ho + ")*(" + HA + ")+~(" + ho + ")*(" + contrast + ")";
   return "((" + (1-a).toFixed(2) + ")*(" + OIII + ")+(" + a.toFixed(2) + ")*(" + pipGuided + "))";
}

function subtleForaxxHOSExpressionSet( data, HA, OIII )
{
   var ps = data.pipStrength;
   var o  = pipMapExpression( OIII, ps );
   var ho = pipMapExpression( "(" + HA + ")*(" + OIII + ")", ps );
   var subtleSII = syntheticSIISubtleForaxxHOSExpression( data, HA, OIII );

   var classicG = "(" + ho + ")*(" + HA + ")+~(" + ho + ")*(" + OIII + ")";
   var g = "0.88*(" + classicG + ")+0.12*(" + OIII + ")";
   var b = "(" + o + ")*(" + subtleSII + ")+~(" + o + ")*(" + OIII + ")";

   return [ HA, g, b ];
}

function createSyntheticSIIOscLikeFromHaOIII( data, outId, reason )
{
   if ( !isValidView( data.referenceHA ) || !isValidView( data.referenceOIII ) )
      return null;

   var HA = getViewId( data.referenceHA );
   var OIII = getViewId( data.referenceOIII );
   if ( HA.length == 0 || OIII.length == 0 )
      return null;

   safeForceCloseWindowById( outId );
   var oldCurrent = data.currentView;
   var oldSilent = data.previewSilent;
   data.currentView = data.referenceHA;
   data.previewSilent = true;
   var expr = syntheticSIIOscLikeExpression( data, HA, OIII );
   var v = pixelMathFcn( data, expr, "", "", "", outId, false );
   data.currentView = oldCurrent;
   data.previewSilent = oldSilent;

   if ( isValidView( v ) )
   {
      data.syntheticSII = true;
      Console.warningln( "SII view not provided. OSC-like synthetic SII created from Ha/OIII", reason ? " (" + reason + ")" : "", ": ", expr );
   }
   return v;
}

function createSyntheticSIIOscLikeFromHaIfMissing( data, reason )
{
   if ( isValidView( data.referenceSII ) )
   {
      data.syntheticSII = false;
      return false;
   }

   var v = createSyntheticSIIOscLikeFromHaOIII( data, PREVIEW_PREFIX + "SYNTH_SII", reason );
   if ( !isValidView( v ) )
      return false;

   data.referenceSII = v;
   return true;
}


function createSyntheticSIIFromHaOIII( data, outId, reason )
{
   if ( !isValidView( data.referenceHA ) || !isValidView( data.referenceOIII ) )
      return null;

   var HA = getViewId( data.referenceHA );
   var OIII = getViewId( data.referenceOIII );
   if ( HA.length == 0 || OIII.length == 0 )
      return null;

   safeForceCloseWindowById( outId );
   var oldCurrent = data.currentView;
   var oldSilent = data.previewSilent;
   data.currentView = data.referenceHA;
   data.previewSilent = true;
   var v = pixelMathFcn( data, syntheticSIIExpression( data, HA, OIII ), "", "", "", outId, false );
   data.currentView = oldCurrent;
   data.previewSilent = oldSilent;

   if ( isValidView( v ) )
   {
      data.syntheticSII = true;
      Console.warningln( "SII view not provided. Synthetic SII blend created from Ha/OIII", reason ? " (" + reason + ")" : "", ": ", syntheticSIIExpression( data, HA, OIII ) );
   }
   return v;
}

function createSyntheticSIIFromHaIfMissing( data, reason )
{
   if ( isValidView( data.referenceSII ) )
   {
      data.syntheticSII = false;
      return false;
   }

   var v = createSyntheticSIIFromHaOIII( data, PREVIEW_PREFIX + "SYNTH_SII", reason );
   if ( !isValidView( v ) )
      return false;

   data.referenceSII = v;
   return true;
}


function createMonoOriginalRGBComposite( pData, outId )
{
   var HA = getViewId( isValidView( pData.originalReferenceHA ) ? pData.originalReferenceHA : pData.referenceHA );
   var OIII = getViewId( isValidView( pData.originalReferenceOIII ) ? pData.originalReferenceOIII : pData.referenceOIII );
   var SII = getViewId( isValidView( pData.originalReferenceSII ) ? pData.originalReferenceSII : pData.referenceSII );

   if ( HA.length == 0 || OIII.length == 0 )
      return null;

   safeForceCloseWindowById( outId );

   var oldCurrent = pData.currentView;
   pData.currentView = isValidView( pData.originalReferenceHA ) ? pData.originalReferenceHA : pData.referenceHA;

   /* v0.14.19: For monochrome inputs, Original must be a direct band mapping
    * and should not inherit creative normalization/blend routing. Use real
    * SII/Ha/OIII when sulfur is available; otherwise keep the plain HOO base.
    */
   var v = null;
   if ( SII.length > 0 && pData.syntheticSII !== true )
      v = pixelMathFcn( pData, SII, HA, OIII, "", outId, true );
   else
      v = pixelMathFcn( pData, HA, OIII, OIII, "", outId, true );

   pData.currentView = oldCurrent;

   var w = ImageWindow.windowById( outId );
   if ( isValidWindow( w ) )
   {
      if ( pData.previewDebugWindows ) w.show(); else w.hide();
      return w.mainView;
   }

   return v;
}

function renderPreviewTileBitmap( view, autoStretch )
{
   if ( !isValidView( view ) )
      return null;

   if ( !autoStretch )
      return renderStudioBitmapFromView( view, view );

   // v0.13.25: Auto-stretch is only a thumbnail visualization aid. It must not
   // modify previewView, because previewView is also the clean source used by the
   // large preview and by the boosted row.
   var outId = PREVIEW_PREFIX + "THUMB_STRETCH";
   safeForceCloseWindowById( outId );

   var tmpData = new parametersPrototype();
   tmpData.setDefaults();
   tmpData.currentView = view;
   tmpData.referenceHA = view;
   tmpData.previewSilent = true;

   try
   {
      createRGBCopyForThumbnail( tmpData, view, outId );
      var win = ImageWindow.windowById( outId );
      if ( isValidWindow( win ) )
      {
         applyDisplayAutoStretchToView( win.mainView, isDirectMonoOriginalTileView( view ), "thumbnail" );
         var bmp = renderStudioBitmapFromView( win.mainView, view );
         safeForceCloseWindowById( outId );
         return bmp;
      }
   }
   catch ( e )
   {
      safeForceCloseWindowById( outId );
   }

   return renderStudioBitmapFromView( view, view );
}

function renderAutoStretchedDisplayBitmap( view, colorReferenceView, outId )
{
   if ( !isValidView( view ) )
      return null;

   if ( !data.previewAutoStretch )
      return renderStudioBitmapFromView( view, colorReferenceView || view );

   outId = outId || (PREVIEW_PREFIX + "DISPLAY_STRETCH");
   safeForceCloseWindowById( outId );

   var tmpData = new parametersPrototype();
   tmpData.setDefaults();
   tmpData.currentView = view;
   tmpData.referenceHA = view;
   tmpData.previewSilent = true;

   try
   {
      createRGBCopyForThumbnail( tmpData, view, outId );
      var win = ImageWindow.windowById( outId );
      if ( isValidWindow( win ) )
      {
         applyDisplayAutoStretchToView( win.mainView, shouldUseLinkedSHODisplayStretch(), "large direct display" );
         var bmp = renderStudioBitmapFromView( win.mainView, colorReferenceView || view );
         safeForceCloseWindowById( outId );
         return bmp;
      }
   }
   catch ( e )
   {
      safeForceCloseWindowById( outId );
   }

   return renderStudioBitmapFromView( view, colorReferenceView || view );
}

function createPreviewPaletteView( pData, paletteIndex )
{
   if ( paletteIndex == PALETTE_ORIGINAL )
   {
      var originalId = PREVIEW_PREFIX + "TILE_ORIGINAL";
      if ( isValidView( pData.previewOriginal ) )
      {
         if ( viewHasRGBChannels( pData.previewOriginal ) )
            return makeViewCopy( pData.previewOriginal, originalId );

         /* Mono DBXtract/Ha+OIII sources are single-channel. The downstream
          * preview refinement code expects RGB tiles, so build a neutral HOO
          * RGB source instead of returning a mono copy.
          */
         return createMonoOriginalRGBComposite( pData, originalId );
      }
      return null;
   }

   var expressions = previewExpressionSet( pData, paletteIndex );
   if ( expressions == null )
      return null;

   var outId = PREVIEW_PREFIX + "TILE_" + PALETTE_DEFINITIONS[paletteIndex].id;
   safeForceCloseWindowById( outId );

   if ( data.previewDebugWindows )
   {
      Console.writeln("Creating preview tile ", outId, " with expressions:");
      Console.writeln("  R: ", expressions[0]);
      Console.writeln("  G: ", expressions[1]);
      Console.writeln("  B: ", expressions[2]);
   }

   var oldCurrent = pData.currentView;
   pData.currentView = pData.referenceHA;
   pixelMathFcn( pData, expressions[0], expressions[1], expressions[2], "", outId, true );
   pData.currentView = oldCurrent;

   var outWindow = ImageWindow.windowById( outId );
   if ( !isValidWindow( outWindow ) )
      return null;

   if ( data.previewDebugWindows )
      Console.writeln("Preview tile source stats [", outId, "]: ", previewStatsString(outWindow.mainView));

   if ( pData.previewDebugWindows )
      outWindow.show();
   else
      outWindow.hide();

   return outWindow.mainView;
}

function refenceNB(NB)
{
   var vista = View.viewById(NB);
   if (isValidView(vista))
      return vista;

   switch(NB){
      case "Ha":
      case HA_NAME:
         vista = View.viewById("HA");
         if(!isValidView(vista)) vista = View.viewById("Halfa");
         if(!isValidView(vista)) vista = View.viewById("ha");
         if(!isValidView(vista)) vista = View.viewById("halfa");
         if(!isValidView(vista)) vista = View.viewById("hidrogeno");
         if(!isValidView(vista)) vista = View.viewById(HA_NAME);
         break;

      case "SII":
      case S2_NAME:
         vista = View.viewById("sii");
         if(!isValidView(vista)) vista = View.viewById("s2");
         if(!isValidView(vista)) vista = View.viewById("S2");
         if(!isValidView(vista)) vista = View.viewById("Sii");
         if(!isValidView(vista)) vista = View.viewById("sulfuro");
         if(!isValidView(vista)) vista = View.viewById(S2_NAME);
         break;

      case "OIII":
      case O3_NAME:
         vista = View.viewById("oiii");
         if(!isValidView(vista)) vista = View.viewById("o3");
         if(!isValidView(vista)) vista = View.viewById("O3");
         if(!isValidView(vista)) vista = View.viewById("Oiii");
         if(!isValidView(vista)) vista = View.viewById("oxigeno");
         if(!isValidView(vista)) vista = View.viewById(O3_NAME);
         break;
   }

   return isValidView(vista) ? vista : null;
}

// Alias with corrected spelling, kept for future code readability.

/*
 * DATA & PARAMETERS
 */

function parametersPrototype()
{
   this.setDefaults = function()
   {
      this.currentView = getActiveViewOrNull();
      this.referenceHA = refenceNB("Ha");
      this.referenceOIII = refenceNB("OIII");
      this.referenceSII = refenceNB("SII");
      this.typePalette = 0;
      this.isOSC = true;
      this.autoClose = true;
      this.allCombinations = false;
      this.blendMode = 2;
      // RC5.2.3: default to no normalization for a faster first preview pass.
      // Users can still opt into Auto/Ha/SII/OIII when they need channel matching.
      this.linearFit = NORMALIZATION_NONE;
      this.lastAutoNormalizationReference = "";
      this.previewAutoStretch = false;
      this.linearInputAutoStretchEnabled = false;
      this.previewDebugWindows = APS_DEBUG_KEEP_PREVIEW_WINDOWS;
      this.previewSilent = false;
      this.previewFinalDebug = APS_DEBUG_PREVIEW_FINAL_PARITY;
      this.previewDebugSourceViewId = "";
      this.previewDebugParameterKey = "";
      this.previewShowAdvanced = false;
      // RC5.2.3: keep boosted variants opt-in so initial preview creation is faster.
      this.previewShowBoosted = false;
      this.previewQuality = PREVIEW_QUALITY_BALANCED;
      this.previewBoostRangeMode = BOOST_RANGE_BALANCED;
      this.previewShowAdvancedControls = true;
      this.previewEnableSIIAccent = false;
      this.previewZoom = 1.0;
      this.selectedPreviewPalette = PALETTE_ORIGINAL;
      this.selectedPreviewBoosted = false;
      this.previewSCNR = 0.00;
      this.previewOIIIBoost = 1.00;
      this.previewSIIBoost = 1.00;
      this.previewShadowPoint = 1.00;
      this.previewHighlightReduction = 1.00;
      this.previewBrightness = 1.00;
      this.previewContrast = 1.00;
      this.previewSaturation = 1.00;
      this.previewCyanGoldBalance = 0.00;
      this.previewRedYellowBalance = 0.00;
      this.previewSIIHighlightAccent = 0.00;
      this.previewSIIAccentActive = false;
      this.previewEnableChannelLightness = false;
      this.previewChannelLightnessSource = 2; // 0=SII, 1=OIII, 2=Ha. All three are implemented. Default UI source: Ha.
      this.previewChannelLightnessAmount = 0.00;
      this.previewEnableLightness = false;
      this.previewLightnessSource = 2; // 0=SII, 1=OIII, 2=Ha. Default UI source: Ha.
      this.previewLightnessAmount = 0.00;
      this.previewEnableStarProtection = false; // legacy alias
      this.previewEnableMaskProtection = false;
      this.previewMaskPreset = 0; // 0=Star protection, 1=Blue Core, 2=Warm/Gold, 3=Faint Red, 4=External View
      this.previewExternalMaskView = null;
      this.previewStarProtectionAmount = 0.70;
      this.previewShowMaskPreview = false;
      this.previewInvertMask = false;
      this.previewAdvancedLayerStack = [];
      this.previewBoostedLayerStack = [];
      this.previewShowLastPreview = false;
      this.pipStrength = 1.00;
      this.haEmphasis = 1.00;
      this.oiiiEmphasis = 1.00;
      this.siiEmphasis = 1.00;
      this.syntheticSII = false;
      this.finalAstrometrySourceView = null;
      this.finalOutputId = "<Auto>";
   };

   this.setParameters = function()
   {
      Parameters.clear();
      if(isValidView(this.currentView)) Parameters.set( "currentView", this.currentView.id );
      if(isValidView(this.referenceHA)) Parameters.set( "referenceHA", this.referenceHA.id );
      if(isValidView(this.referenceOIII)) Parameters.set( "referenceOIII", this.referenceOIII.id );
      if(isValidView(this.referenceSII)) Parameters.set( "referenceSII", this.referenceSII.id );
      Parameters.set( "typePalette", this.typePalette );
      Parameters.set( "isOSC", this.isOSC );
      Parameters.set( "autoClose", this.autoClose );
      Parameters.set( "allCombinations", this.allCombinations );
      Parameters.set( "blendMode", this.blendMode );
      Parameters.set( "linearFit", this.linearFit );
      Parameters.set( "previewAutoStretch", this.previewAutoStretch );
      Parameters.set( "linearInputAutoStretchEnabled", this.linearInputAutoStretchEnabled );
      Parameters.set( "previewDebugWindows", this.previewDebugWindows );
      Parameters.set( "previewFinalDebug", this.previewFinalDebug );
      Parameters.set( "previewShowAdvanced", this.previewShowAdvanced );
      Parameters.set( "previewShowBoosted", this.previewShowBoosted );
      Parameters.set( "previewQuality", this.previewQuality );
      Parameters.set( "previewBoostRangeMode", this.previewBoostRangeMode );
      Parameters.set( "previewShowAdvancedControls", this.previewShowAdvancedControls );
      Parameters.set( "previewEnableSIIAccent", this.previewEnableSIIAccent );
      Parameters.set( "previewZoom", this.previewZoom );
      Parameters.set( "selectedPreviewPalette", this.selectedPreviewPalette );
      Parameters.set( "selectedPreviewBoosted", this.selectedPreviewBoosted );
      Parameters.set( "previewSCNR", this.previewSCNR );
      Parameters.set( "previewOIIIBoost", this.previewOIIIBoost );
      Parameters.set( "previewSIIBoost", this.previewSIIBoost );
      Parameters.set( "previewShadowPoint", this.previewShadowPoint );
      Parameters.set( "previewHighlightReduction", this.previewHighlightReduction );
      Parameters.set( "previewBrightness", this.previewBrightness );
      Parameters.set( "previewContrast", this.previewContrast );
      Parameters.set( "previewSaturation", this.previewSaturation );
      Parameters.set( "previewCyanGoldBalance", this.previewCyanGoldBalance );
      Parameters.set( "previewRedYellowBalance", this.previewRedYellowBalance );
      Parameters.set( "previewSIIHighlightAccent", this.previewSIIHighlightAccent );
      Parameters.set( "previewEnableChannelLightness", this.previewEnableChannelLightness );
      Parameters.set( "previewChannelLightnessSource", this.previewChannelLightnessSource );
      Parameters.set( "previewChannelLightnessAmount", this.previewChannelLightnessAmount );
      Parameters.set( "previewEnableLightness", this.previewEnableLightness );
      Parameters.set( "previewLightnessSource", this.previewLightnessSource );
      Parameters.set( "previewLightnessAmount", this.previewLightnessAmount );
      Parameters.set( "previewEnableStarProtection", this.previewEnableStarProtection );
      Parameters.set( "previewEnableMaskProtection", this.previewEnableMaskProtection );
      Parameters.set( "previewMaskPreset", this.previewMaskPreset );
      if(isValidView(this.previewExternalMaskView)) Parameters.set( "previewExternalMaskView", this.previewExternalMaskView.id );
      Parameters.set( "previewStarProtectionAmount", this.previewStarProtectionAmount );
      Parameters.set( "previewShowMaskPreview", this.previewShowMaskPreview );
      Parameters.set( "previewInvertMask", this.previewInvertMask );
      Parameters.set( "previewShowLastPreview", this.previewShowLastPreview );
      Parameters.set( "previewBoostedLayerStack", JSON.stringify( this.previewBoostedLayerStack || [] ) );
      Parameters.set( "pipStrength", this.pipStrength );
      Parameters.set( "haEmphasis", this.haEmphasis );
      Parameters.set( "oiiiEmphasis", this.oiiiEmphasis );
      Parameters.set( "siiEmphasis", this.siiEmphasis );
      Parameters.set( "finalOutputId", this.finalOutputId );
   };

   this.getParameters = function()
   {
      if (Parameters.has("currentView"))
         this.currentView = View.viewById(Parameters.getString("currentView"));

      if (!isValidView(this.currentView) && Parameters.isViewTarget) {
         var targetViewId = Parameters.getString("targetView");
         if (targetViewId)
            this.currentView = View.viewById(targetViewId);
      }

      if (Parameters.has("referenceHA"))
         this.referenceHA = View.viewById(Parameters.getString("referenceHA"));

      if (Parameters.has("referenceOIII"))
         this.referenceOIII = View.viewById(Parameters.getString("referenceOIII"));

      if (Parameters.has("referenceSII"))
         this.referenceSII = View.viewById(Parameters.getString("referenceSII"));

      if ( Parameters.has( "typePalette" ) )
         this.typePalette = Parameters.getInteger( "typePalette" );

      if ( Parameters.has( "isOSC" ) )
         this.isOSC = Parameters.getBoolean( "isOSC" );

      if ( Parameters.has( "autoClose" ) )
         this.autoClose = Parameters.getBoolean( "autoClose" );

      if ( Parameters.has( "allCombinations" ) )
         this.allCombinations = Parameters.getBoolean( "allCombinations" );

      if ( Parameters.has( "blendMode" ) )
         this.blendMode = Parameters.getInteger( "blendMode" );

      if ( Parameters.has( "linearFit" ) )
         this.linearFit = Parameters.getInteger( "linearFit" );

      if ( Parameters.has( "previewAutoStretch" ) )
         this.previewAutoStretch = Parameters.getBoolean( "previewAutoStretch" );

      if ( Parameters.has( "linearInputAutoStretchEnabled" ) )
         this.linearInputAutoStretchEnabled = Parameters.getBoolean( "linearInputAutoStretchEnabled" );

      if ( Parameters.has( "previewDebugWindows" ) )
         this.previewDebugWindows = Parameters.getBoolean( "previewDebugWindows" );

      if ( Parameters.has( "previewFinalDebug" ) )
         this.previewFinalDebug = Parameters.getBoolean( "previewFinalDebug" );

      if ( Parameters.has( "previewShowAdvanced" ) )
         this.previewShowAdvanced = Parameters.getBoolean( "previewShowAdvanced" );

      if ( Parameters.has( "previewShowBoosted" ) )
         this.previewShowBoosted = Parameters.getBoolean( "previewShowBoosted" );

      if ( Parameters.has( "previewQuality" ) )
         this.previewQuality = Parameters.getInteger( "previewQuality" );

      if ( Parameters.has( "previewBoostRangeMode" ) )
         this.previewBoostRangeMode = Parameters.getInteger( "previewBoostRangeMode" );

      if ( Parameters.has( "previewShowAdvancedControls" ) )
         this.previewShowAdvancedControls = Parameters.getBoolean( "previewShowAdvancedControls" );

      if ( Parameters.has( "previewEnableSIIAccent" ) )
         this.previewEnableSIIAccent = Parameters.getBoolean( "previewEnableSIIAccent" );

      if ( Parameters.has( "previewZoom" ) )
         this.previewZoom = Parameters.getReal( "previewZoom" );

      if ( Parameters.has( "selectedPreviewPalette" ) )
         this.selectedPreviewPalette = Parameters.getInteger( "selectedPreviewPalette" );

      if ( Parameters.has( "selectedPreviewBoosted" ) )
         this.selectedPreviewBoosted = Parameters.getBoolean( "selectedPreviewBoosted" );

      if ( Parameters.has( "previewSCNR" ) )
         this.previewSCNR = Parameters.getReal( "previewSCNR" );

      if ( Parameters.has( "previewOIIIBoost" ) )
         this.previewOIIIBoost = Parameters.getReal( "previewOIIIBoost" );

      if ( Parameters.has( "previewSIIBoost" ) )
         this.previewSIIBoost = Parameters.getReal( "previewSIIBoost" );

      if ( Parameters.has( "previewShadowPoint" ) )
         this.previewShadowPoint = Parameters.getReal( "previewShadowPoint" );

      if ( Parameters.has( "previewHighlightReduction" ) )
         this.previewHighlightReduction = Parameters.getReal( "previewHighlightReduction" );

      if ( Parameters.has( "previewBrightness" ) )
         this.previewBrightness = Parameters.getReal( "previewBrightness" );

      if ( Parameters.has( "previewContrast" ) )
         this.previewContrast = Parameters.getReal( "previewContrast" );

      if ( Parameters.has( "previewSaturation" ) )
         this.previewSaturation = Parameters.getReal( "previewSaturation" );

      if ( Parameters.has( "previewCyanGoldBalance" ) )
         this.previewCyanGoldBalance = Parameters.getReal( "previewCyanGoldBalance" );

      if ( Parameters.has( "previewRedYellowBalance" ) )
         this.previewRedYellowBalance = Parameters.getReal( "previewRedYellowBalance" );

      if ( Parameters.has( "previewSIIHighlightAccent" ) )
         this.previewSIIHighlightAccent = Parameters.getReal( "previewSIIHighlightAccent" );

      if ( Parameters.has( "previewEnableChannelLightness" ) )
         this.previewEnableChannelLightness = Parameters.getBoolean( "previewEnableChannelLightness" );

      if ( Parameters.has( "previewChannelLightnessSource" ) )
         this.previewChannelLightnessSource = Parameters.getInteger( "previewChannelLightnessSource" );

      if ( Parameters.has( "previewChannelLightnessAmount" ) )
         this.previewChannelLightnessAmount = Parameters.getReal( "previewChannelLightnessAmount" );

      if ( Parameters.has( "previewEnableLightness" ) )
         this.previewEnableLightness = Parameters.getBoolean( "previewEnableLightness" );

      if ( Parameters.has( "previewLightnessSource" ) )
         this.previewLightnessSource = Parameters.getInteger( "previewLightnessSource" );

      if ( Parameters.has( "previewLightnessAmount" ) )
         this.previewLightnessAmount = Parameters.getReal( "previewLightnessAmount" );

      if ( Parameters.has( "previewEnableStarProtection" ) )
         this.previewEnableStarProtection = Parameters.getBoolean( "previewEnableStarProtection" );

      if ( Parameters.has( "previewEnableMaskProtection" ) )
         this.previewEnableMaskProtection = Parameters.getBoolean( "previewEnableMaskProtection" );
      else
         this.previewEnableMaskProtection = this.previewEnableStarProtection;

      if ( Parameters.has( "previewMaskPreset" ) )
         this.previewMaskPreset = Parameters.getInteger( "previewMaskPreset" );

      if ( Parameters.has( "previewExternalMaskView" ) )
         this.previewExternalMaskView = View.viewById( Parameters.getString( "previewExternalMaskView" ) );

      if ( Parameters.has( "previewStarProtectionAmount" ) )
         this.previewStarProtectionAmount = Parameters.getReal( "previewStarProtectionAmount" );

      if ( Parameters.has( "previewShowMaskPreview" ) )
         this.previewShowMaskPreview = Parameters.getBoolean( "previewShowMaskPreview" );

      if ( Parameters.has( "previewInvertMask" ) )
         this.previewInvertMask = Parameters.getBoolean( "previewInvertMask" );

      if ( Parameters.has( "previewShowLastPreview" ) )
         this.previewShowLastPreview = Parameters.getBoolean( "previewShowLastPreview" );

      if ( Parameters.has( "previewBoostedLayerStack" ) )
      {
         try { this.previewBoostedLayerStack = JSON.parse( Parameters.getString( "previewBoostedLayerStack" ) ); } catch ( eBoostStack ) { this.previewBoostedLayerStack = []; }
      }

      if ( Parameters.has( "pipStrength" ) )
         this.pipStrength = Parameters.getReal( "pipStrength" );

      if ( Parameters.has( "haEmphasis" ) )
         this.haEmphasis = Parameters.getReal( "haEmphasis" );

      if ( Parameters.has( "oiiiEmphasis" ) )
         this.oiiiEmphasis = Parameters.getReal( "oiiiEmphasis" );

      if ( Parameters.has( "siiEmphasis" ) )
         this.siiEmphasis = Parameters.getReal( "siiEmphasis" );

      if ( Parameters.has( "finalOutputId" ) )
         this.finalOutputId = Parameters.getString( "finalOutputId" );

      // i03: old process icons/instances may persist SII as an inactive Advanced
      // source. When an Advanced tool is not enabled, reset its source to Ha so
      // the default UI state is consistently Ha/SII/OIII with Ha selected.
      if ( !this.previewEnableLightness )
         this.previewLightnessSource = 2;
      if ( !this.previewEnableChannelLightness )
         this.previewChannelLightnessSource = 2;
   };
}

var data = new parametersPrototype();
data.setDefaults();
data.getParameters();
// Palette-shaping setup sliders were removed from the Studio UI. Keep their
// internal values neutral so preview generation and final output remain driven
// by the selected palette formulas, LinearFit and Blend mode only.
data.pipStrength = 1.00;
data.haEmphasis = 1.00;
data.oiiiEmphasis = 1.00;
data.siiEmphasis = 1.00;
// RC5.4: boosted variants are no longer represented as separate preview tiles.
data.previewShowBoosted = false;
data.selectedPreviewBoosted = false;

/* DIALOGO PRINCIPAL
 */
function autopaletteMain() {
    this.__base__ = Dialog;
    this.__base__();

    var dlg = this;
    this.previewTiles = [];
    this.largePreviewBitmap = null;
    this.largePreviewSourceView = null;
    this.previewZoom = data.previewZoom || 1.0;
    this.previewPanX = 0;
    this.previewPanY = 0;
    this.previewDragging = false;
    this.previewDragStartX = 0;
    this.previewDragStartY = 0;
    this.previewDragStartPanX = 0;
    this.previewDragStartPanY = 0;
    this.previewDragMoved = false;
    this.selectedPaletteIndex = (data.selectedPreviewPalette != null) ? data.selectedPreviewPalette : PALETTE_ORIGINAL;
    this.selectedPaletteBoosted = false;
    data.selectedPreviewBoosted = false;
    this.userBoostedControlsSnapshot = null;
    this.boostedAppliedStacks = {};
    this.boostedUndoStacks = {};
    this.boostedRedoStacks = {};
    this.presetControlsSnapshot = null;
    // RC5.4.2: cache reduced preview source channels so enabling advanced
    // combinations does not repeat RGB channel extraction/downsampling.
    this.previewSourceDataCache = null;
    this.previewSourceDataCacheKey = "";
    this.previewsReady = false;
    this.previewGenerationBusy = false;
    var labelWidth = this.font.width("Monochrome NarrowBand:");

   function normalizedViewIdForSearch( id )
   {
      if ( id == null )
         return "";
      return id.toLowerCase().replace( /[^a-z0-9]+/g, "_" );
   }

   function idContainsToken( normalizedId, token )
   {
      return ( "_" + normalizedId + "_" ).indexOf( "_" + token + "_" ) >= 0;
   }

   function idContainsTokenWithNumericSuffix( normalizedId, token )
   {
      // Matches tokens such as _HA1, HA_1, target_HA01, _OIII1, _SII2.
      // The previous token-only check detected _OIII1 through the generic
      // substring fallback, but missed _HA1 because Ha was only accepted as an
      // isolated token. DBXtract/PixInsight often appends a numeric suffix when
      // the base id already exists.
      var n = "_" + normalizedId + "_";
      var pattern = new RegExp( "_" + token + "([0-9]+|_[0-9]+|_)" );
      return pattern.test( n );
   }

   function viewIdMatchesNarrowbandRole( id, role )
   {
      var n = normalizedViewIdForSearch( id );
      if ( n.length == 0 )
         return false;

      if ( role == "HA" )
         return idContainsToken( n, "ha" ) || idContainsTokenWithNumericSuffix( n, "ha" ) ||
                idContainsToken( n, "halpha" ) || idContainsTokenWithNumericSuffix( n, "halpha" ) ||
                idContainsToken( n, "h_alpha" ) || idContainsTokenWithNumericSuffix( n, "h_alpha" ) ||
                n.indexOf( "halpha" ) >= 0 || n.indexOf( "h_alpha" ) >= 0 || n.indexOf( "h_alfa" ) >= 0 ||
                n.indexOf( "hidrogeno" ) >= 0 || n.indexOf( "hydrogen" ) >= 0;

      if ( role == "OIII" )
         return idContainsToken( n, "oiii" ) || idContainsTokenWithNumericSuffix( n, "oiii" ) ||
                idContainsToken( n, "o3" ) || idContainsTokenWithNumericSuffix( n, "o3" ) ||
                n.indexOf( "oiii" ) >= 0 || n.indexOf( "oxygeniii" ) >= 0 ||
                n.indexOf( "oxygen_iii" ) >= 0 || n.indexOf( "oxigeno" ) >= 0;

      if ( role == "SII" )
         return idContainsToken( n, "sii" ) || idContainsTokenWithNumericSuffix( n, "sii" ) ||
                idContainsToken( n, "s2" ) || idContainsTokenWithNumericSuffix( n, "s2" ) ||
                n.indexOf( "sii" ) >= 0 || n.indexOf( "sulfurii" ) >= 0 ||
                n.indexOf( "sulfur_ii" ) >= 0 || n.indexOf( "sulphurii" ) >= 0 ||
                n.indexOf( "sulphur_ii" ) >= 0 || n.indexOf( "sulfuro" ) >= 0;

      return false;
   }

   function isInternalAutoPaletteViewId( id )
   {
      if ( id == null || id.length == 0 )
         return true;

      // Hide temporary/internal AutoPalette Studio preview views, but do not
      // hide all leading-underscore views. DBXtract and many mono workflows
      // deliberately create user-facing channels such as _HA, _OIII, _SII,
      // or target-specific variants containing Ha/OIII/SII in the id.
      if ( id.indexOf( "APS_TILE" ) >= 0 || id.indexOf( "APS_" ) >= 0 || id.indexOf( PREVIEW_PREFIX ) == 0 )
         return true;

      // Legacy PIP/Foraxx helper maps used internally by AutoPalette.
      if ( id == "h" || id == "o" || id == "s" || id == "ho" || id == "hs" || id == "os" )
         return true;

      return false;
   }

   function isSelectableGrayView( v )
   {
      if ( !isValidView( v ) )
         return false;
      // PixInsight grayscale images are normally !isColor with one channel,
      // but keep this tolerant for synthetic mono views.
      return !v.image.isColor || v.image.numberOfChannels == 1;
   }

   function buildSelectableViews( requireColor, requireGray )
   {
      var result = [];
      var windows = ImageWindow.windows;
      for ( var i = 0; i < windows.length; ++i )
      {
         var v = windows[i].mainView;
         if ( !isValidView( v ) )
            continue;
         if ( isInternalAutoPaletteViewId( v.id ) )
            continue;
         if ( requireColor && !v.image.isColor )
            continue;
         if ( requireGray && !isSelectableGrayView( v ) )
            continue;

         result.push( v );
      }
      return result;
   }

   function setupFilteredViewCombo( combo, currentView, requireColor, requireGray, noSelectionText, onSelect )
   {
      combo.clear();
      combo.__viewIds = [];
      combo.addItem( noSelectionText );
      combo.__viewIds.push( "" );

      var views = buildSelectableViews( requireColor, requireGray );
      var selectedIndex = 0;
      for ( var i = 0; i < views.length; ++i )
      {
         combo.addItem( views[i].id );
         combo.__viewIds.push( views[i].id );
         if ( isValidView( currentView ) && views[i].id == currentView.id )
            selectedIndex = i + 1;
      }

      combo.currentItem = selectedIndex;
      combo.onItemSelected = function( index )
      {
         var id = this.__viewIds[index];
         if ( id == null || id.length == 0 )
         {
            onSelect( null );
            return;
         }

         var v = View.viewById( id );
         onSelect( isValidView( v ) ? v : null );
      };
   }


   function findFirstValidViewByIds( ids )
   {
      for ( var i = 0; i < ids.length; ++i )
      {
         var v = View.viewById( ids[i] );
         if ( isValidView( v ) && isSelectableGrayView( v ) )
            return v;
      }
      return null;
   }

   function findBestNarrowbandViewByRole( role, exactIds )
   {
      var exact = findFirstValidViewByIds( exactIds );
      if ( isValidView( exact ) )
         return exact;

      var bestView = null;
      var bestScore = -1;
      var windows = ImageWindow.windows;
      for ( var i = 0; i < windows.length; ++i )
      {
         var v = windows[i].mainView;
         if ( !isValidView( v ) || !isSelectableGrayView( v ) )
            continue;
         if ( isInternalAutoPaletteViewId( v.id ) )
            continue;
         if ( !viewIdMatchesNarrowbandRole( v.id, role ) )
            continue;

         var n = normalizedViewIdForSearch( v.id );
         var score = 1;
         if ( v.id == HA_NAME || v.id == O3_NAME || v.id == S2_NAME )
            score += 10;
         if ( idContainsToken( n, role.toLowerCase() ) )
            score += 5;
         if ( v.id.indexOf( "DBX" ) >= 0 || v.id.indexOf( "dbx" ) >= 0 || v.id.indexOf( "DBXtract" ) >= 0 )
            score += 2;

         if ( score > bestScore )
         {
            bestScore = score;
            bestView = v;
         }
      }

      return bestView;
   }

   function setComboToView( combo, view )
   {
      if ( !combo || !combo.__viewIds || !isValidView( view ) )
         return;
      for ( var i = 0; i < combo.__viewIds.length; ++i )
      {
         if ( combo.__viewIds[i] == view.id )
         {
            combo.currentItem = i;
            return;
         }
      }
   }

   this.restoreComboSelection = function( combo, oldView )
   {
      if ( !combo )
         return;
      if ( isValidView( oldView ) )
         setComboToView( combo, oldView );
      else
         combo.currentItem = 0;
   };

   this.validateNarrowbandSourceSelection = function( candidateHa, candidateOiii, candidateSii )
   {
      var err = getNarrowbandReferenceValidationError( candidateHa, candidateOiii, candidateSii, "DBXtract/mono source selection" );
      if ( err.length > 0 )
      {
         (new MessageBox( err, TITLE, StdIcon_Error, StdButton_Ok )).execute();
         return false;
      }
      return true;
   };

   this.validateExternalMaskSelection = function( candidateMask )
   {
      var err = getExternalMaskValidationError( candidateMask, data.referenceHA, data.referenceOIII, data.referenceSII, data.currentView, "the current source selection" );
      if ( err.length > 0 )
      {
         (new MessageBox( err, TITLE, StdIcon_Error, StdButton_Ok )).execute();
         return false;
      }
      return true;
   };

   this.autoDetectNarrowbandViews = function()
   {
      var ha = findBestNarrowbandViewByRole( "HA", [ HA_NAME, "_HA", "HA", "Ha", "ha", "Halfa", "halfa", "Halpha", "halpha", "DBX_HA", "DBX_Ha", "DBXtract_HA" ] );
      var oiii = findBestNarrowbandViewByRole( "OIII", [ O3_NAME, "_OIII", "OIII", "O3", "o3", "Oiii", "oiii", "DBX_OIII", "DBX_O3", "DBXtract_OIII" ] );
      var sii = findBestNarrowbandViewByRole( "SII", [ S2_NAME, "_SII", "SII", "S2", "s2", "Sii", "sii", "DBX_SII", "DBX_S2", "DBXtract_SII" ] );

      if ( isValidView( ha ) )
      {
         data.referenceHA = ha;
         setComboToView( this.referenceHA_ViewList, ha );
      }
      if ( isValidView( oiii ) )
      {
         data.referenceOIII = oiii;
         setComboToView( this.referenceOIII_ViewList, oiii );
      }
      if ( isValidView( sii ) )
      {
         data.referenceSII = sii;
         setComboToView( this.referenceSII_ViewList, sii );
      }

      if ( isValidView( ha ) || isValidView( oiii ) || isValidView( sii ) )
         Console.noteln( "Auto-detected narrowband source views: Ha=", isValidView(ha) ? ha.id : "<none>", ", OIII=", isValidView(oiii) ? oiii.id : "<none>", ", SII=", isValidView(sii) ? sii.id : "<none>" );
   };
    this.headerLabel = new Label( this );
    this.headerLabel.backgroundColor = 0x8dd0f8ff;
    this.headerLabel.textColor = 0x570069;
    this.headerLabel.useRichText = true;
    this.headerLabel.textAlignment = TextAlign_Center|TextAlign_VertCenter;
    this.headerLabel.margin = 4;
    this.headerLabel.text = "<p><b>" + TITLE + " v" + VERSION + "</b></p>";

    this.helpLabel = new Label(this);
    with(this.helpLabel) {
        frameStyle   = FrameStyle_Box;
        margin       = 4;
        wordWrapping = true;
        useRichText  = true;
        text         = "This script allows the dynamic narrowband channel combinations for OSC and MONOCHROME images, based on <i>PIP (Power Inverted Pixels)</i> method for the RGB channels exponential transformation."+
      "<br><br>AutoPalette Studio preview grid: create downsampled previews, select a palette visually and generate only the final selected palette.<br><br>Available palettes (45 combinations):"+
      "<ul>"+
      "<li><b>Classic:</b> HOO, SHO, HSO and Foraxx</i></li>"+
      "<li><b>Foraxx Combinations:</b> SHO, HOS, OHS, HOO, HSO, OSH, SOH</li>"+
      "</ul>"+
      "Image minimum <b>requisites</b>:"+
      "<ol>"+
      "<li>Background extraction and neutralization</li>"+
      "<li>Color calibration</li>"+
      "<li>Non-linear or stretched images</li>"+
      "</ol>"+
      "AutoPalette Studio was developed by <b>Raúl Hussein</b><br />"+
		"Inspired in dynamic Foraxx combinations developed by <b>Marcelo Muñoz</b><br /><br />"+
		"More info in <a href='https://www.youtube.com/@astrocitas'>Astrocitas Youtube Channel</a><br />";
    }
    // Legacy long help text is kept for reference but hidden in Studio layout.
    this.helpLabel.hide();


    this.compactHelpLabel = new Label(this);
    this.compactHelpLabel.frameStyle = FrameStyle_Box;
    this.compactHelpLabel.margin = 4;
    this.compactHelpLabel.wordWrapping = true;
    this.compactHelpLabel.useRichText = true;
    this.compactHelpLabel.text = "<u><b>Workflow</b></u>: (1) Select an OSC dualband RGB image or existing <b>DBXtract / Mono Narrowband</b> Ha/OIII/SII views, then choose optional <b>Normalization</b> and <b>Blend</b> &rarr; (2) <b>Create Previews</b> and select a base palette &rarr; refine with <b>Cosmetic Presets</b>, (3) <b>Boosted</b>, (4) <b>Advanced</b> and (5) <b>Masks</b> &rarr; <b>Generate Final Image</b>.<br/><br/>"+
                                 "This script was developed by <a href='https://www.instagram.com/rahusga/'><b>Raúl Hussein</b></a>.";

   /*
    * Radio Buttons
    */
   this.rbOSC = new RadioButton( this );
   with (this.rbOSC)
   {
      checked = true;
      text = "OSC Dualband";
      toolTip = "<p>Select color DB Image</p>";
      onCheck = function ( checked ){
         data.isOSC = checked;
         if ( dlg.updateReferenceModeVisibility )
            dlg.updateReferenceModeVisibility();
         if ( dlg.updateBlendModeAvailability )
            dlg.updateBlendModeAvailability();
         markPreviewSetupChanged();
      }
   }

   this.rbMonochrome = new RadioButton( this );
   with (this.rbMonochrome)
   {
      text = "DBXtract / Mono Narrowband";
      toolTip = "<p>Use existing Ha/OIII/SII views, including channels generated by DBXtract.</p>";
      onCheck = function ( checked ){
         data.isOSC = !checked;
         if ( checked && dlg.autoDetectNarrowbandViews )
            dlg.autoDetectNarrowbandViews();
         if ( dlg.updateReferenceModeVisibility )
            dlg.updateReferenceModeVisibility();
         if ( dlg.autoSetNormalizationNoneForRealSII ) dlg.autoSetNormalizationNoneForRealSII();
         if ( dlg.updateBlendModeAvailability ) dlg.updateBlendModeAvailability();
         markPreviewSetupChanged();
      }
   }

   this.radioButtons_Sizer = new HorizontalSizer;
   with (this.radioButtons_Sizer)
   {
      spacing = 4;
      addStretch();
      add (this.rbOSC );
      add (this.rbMonochrome);
   }

   // v0.14.01: Collapse DBXtract/Mono reference rows in OSC mode to save
   // vertical UI space. Narrowband controls become available immediately when
   // DBXtract / Mono Narrowband is selected.
   this.updateReferenceModeVisibility = function()
   {
      var osc = data.isOSC;

      if ( this.referenceOSC_ViewList )
         this.referenceOSC_ViewList.enabled = osc;

      if ( this.referenceHA_ViewList )
         this.referenceHA_ViewList.enabled = !osc;
      if ( this.referenceOIII_ViewList )
         this.referenceOIII_ViewList.enabled = !osc;
      if ( this.referenceSII_ViewList )
         this.referenceSII_ViewList.enabled = !osc;

      if ( this.monoReferences_Control )
         this.monoReferences_Control.visible = !osc;

      try
      {
         this.adjustToContents();
         this.setVariableSize();
      }
      catch ( e )
      {
      }
   };

   this.autoSetNormalizationNoneForRealSII = function()
   {
      if ( data.isOSC )
         return;
      if ( !isValidView( data.referenceSII ) )
         return;

      if ( data.linearFit != NORMALIZATION_NONE )
      {
         data.linearFit = NORMALIZATION_NONE;
         data.lastAutoNormalizationReference = "";
         if ( this.linearfit_Combo )
            this.linearfit_Combo.currentItem = NORMALIZATION_NONE;
         if ( this.updateAutoNormalizationInfoLabel )
            this.updateAutoNormalizationInfoLabel();
      }
   };

   this.updateBlendModeAvailability = function()
   {
      var enableBlend = true;
      if ( !data.isOSC && isValidView( data.referenceSII ) )
         enableBlend = false;

      if ( this.blendMode_Combo )
         this.blendMode_Combo.enabled = enableBlend;
      if ( this.blendMode_Label )
         this.blendMode_Label.enabled = enableBlend;
   };

   /*
    * Reference view list
    */
   // OSC
	this.referenceOSC_Label = new Label(this);
    with(this.referenceOSC_Label) {
        text          = "OSC RGB view:";
        textAlignment = TextAlign_Right|TextAlign_VertCenter;
        minWidth      = labelWidth;
    }

	this.referenceOSC_ViewList = new ComboBox(this);
    with(this.referenceOSC_ViewList) {
        enabled        = false;
        minWidth       = 300;
        toolTip        = "<p>Select an OSC RGB image. Internal AutoPalette preview views are hidden from this list.</p>";
   }
   setupFilteredViewCombo( this.referenceOSC_ViewList, data.currentView, true, false, "<No View Selected>",
      function( view )
      {
         data.currentView = view;
         if ( dlg.autoSetNormalizationNoneForRealSII ) dlg.autoSetNormalizationNoneForRealSII();
         if ( dlg.updateBlendModeAvailability ) dlg.updateBlendModeAvailability();
         markPreviewSetupChanged();
      } );

	// HA
	this.referenceHA_Label = new Label(this);
    with(this.referenceHA_Label) {
        text          = "Ha view:";
        textAlignment = TextAlign_Right|TextAlign_VertCenter;
        minWidth      = labelWidth;
    }

	this.referenceHA_ViewList = new ComboBox(this);
    with(this.referenceHA_ViewList) {
        enabled        = false;
        minWidth       = 300;
        toolTip        = "<p>Select any grayscale/monochrome Ha image. DBXtract names and variants containing Ha/Halpha are detected automatically when possible.</p>";
    }
   setupFilteredViewCombo( this.referenceHA_ViewList, data.referenceHA, false, true, "<No View Selected>",
      function( view )
      {
         var oldView = data.referenceHA;
         if ( isValidView( view ) && !dlg.validateNarrowbandSourceSelection( view, data.referenceOIII, data.referenceSII ) )
         {
            dlg.restoreComboSelection( dlg.referenceHA_ViewList, oldView );
            return;
         }
         data.referenceHA = view;
         invalidateStarMaskCache();
         if ( dlg.autoSetNormalizationNoneForRealSII ) dlg.autoSetNormalizationNoneForRealSII();
         if ( dlg.updateBlendModeAvailability ) dlg.updateBlendModeAvailability();
         markPreviewSetupChanged();
      } );

	// OIII
	this.referenceOIII_Label = new Label(this);
    with(this.referenceOIII_Label) {
        text          = "OIII view:";
        textAlignment = TextAlign_Right|TextAlign_VertCenter;
        minWidth      = labelWidth;
    }

	this.referenceOIII_ViewList = new ComboBox(this);
    with(this.referenceOIII_ViewList) {
        minWidth       = 300;
        enabled        = false;
        toolTip        = "<p>Select any grayscale/monochrome OIII image. DBXtract names and variants containing OIII/O3 are detected automatically when possible.</p>";
    }
   setupFilteredViewCombo( this.referenceOIII_ViewList, data.referenceOIII, false, true, "<No View Selected>",
      function( view )
      {
         var oldView = data.referenceOIII;
         if ( isValidView( view ) && !dlg.validateNarrowbandSourceSelection( data.referenceHA, view, data.referenceSII ) )
         {
            dlg.restoreComboSelection( dlg.referenceOIII_ViewList, oldView );
            return;
         }
         data.referenceOIII = view;
         invalidateStarMaskCache();
         if ( dlg.autoSetNormalizationNoneForRealSII ) dlg.autoSetNormalizationNoneForRealSII();
         if ( dlg.updateBlendModeAvailability ) dlg.updateBlendModeAvailability();
         markPreviewSetupChanged();
      } );

	// SII
	this.referenceSII_Label = new Label(this);
    with(this.referenceSII_Label) {
        text          = "SII view:";
        textAlignment = TextAlign_Right|TextAlign_VertCenter;
        minWidth      = labelWidth;
    }

	this.referenceSII_ViewList = new ComboBox(this);
    with(this.referenceSII_ViewList) {
        minWidth       = 300;
        enabled        = false;
        toolTip        = "<p>Select any grayscale/monochrome SII image. DBXtract names and variants containing SII/S2 are detected automatically when possible.</p>";
    }
   setupFilteredViewCombo( this.referenceSII_ViewList, data.referenceSII, false, true, "<No View Selected>",
      function( view )
      {
         var oldView = data.referenceSII;
         if ( isValidView( view ) && !dlg.validateNarrowbandSourceSelection( data.referenceHA, data.referenceOIII, view ) )
         {
            dlg.restoreComboSelection( dlg.referenceSII_ViewList, oldView );
            return;
         }
         data.referenceSII = view;
         invalidateStarMaskCache();
         if ( dlg.autoSetNormalizationNoneForRealSII ) dlg.autoSetNormalizationNoneForRealSII();
         if ( dlg.updateBlendModeAvailability ) dlg.updateBlendModeAvailability();
         markPreviewSetupChanged();
      } );


   this.rbOSC.checked = data.isOSC;
   this.rbMonochrome.checked = !data.isOSC;


   this.referenceOSC_Sizer = new HorizontalSizer;
    with(this.referenceOSC_Sizer) {
        spacing = 4;
        add(this.referenceOSC_Label);
        add(this.referenceOSC_ViewList, 200);
   }

   this.referenceHA_Sizer = new HorizontalSizer;
    with(this.referenceHA_Sizer) {
        spacing = 4;
        add(this.referenceHA_Label);
        add(this.referenceHA_ViewList, 100);
   }

	this.referenceOIII_Sizer = new HorizontalSizer;
    with(this.referenceOIII_Sizer) {
        spacing = 4;
        add(this.referenceOIII_Label);
        add(this.referenceOIII_ViewList, 100);
    }

	this.referenceSII_Sizer = new HorizontalSizer;
    with(this.referenceSII_Sizer) {
        spacing = 4;
        add(this.referenceSII_Label);
        add(this.referenceSII_ViewList, 100);
    }

   this.monoReferences_Control = new Control( this );
   this.monoReferences_Control.sizer = new VerticalSizer;
   this.monoReferences_Control.sizer.spacing = 4;
   this.monoReferences_Control.sizer.add( this.referenceHA_Sizer );
   this.monoReferences_Control.sizer.add( this.referenceOIII_Sizer );
   this.monoReferences_Control.sizer.add( this.referenceSII_Sizer );

   this.updateReferenceModeVisibility();


   /*
    * Palette Type
    */
	this.forax_Label               = new Label(this);
   this.forax_Label.text          = "Palette Method:";
   this.forax_Label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
   this.forax_Label.minWidth      = labelWidth;

   this.forax_Combo = new ComboBox(this);
   this.forax_Combo.editEnabled = false;
   this.forax_Combo.toolTip = "<p>Select method to create the palette</p>1. Classic HOO/SHO/Hubble/Foraxx<br />2. Foraxx SHO/HOS/OHS/HOO/OSH/SOH<br />";
   this.forax_Combo.minWidth = labelWidth;
   for (var p = 0; p < PALETTE_DEFINITIONS.length; ++p)
      this.forax_Combo.addItem(PALETTE_DEFINITIONS[p].name);

	if (data.typePalette != null){
        this.forax_Combo.currentItem = data.typePalette;
   }

   this.forax_Combo.onItemSelected = function (){
        data.typePalette = this.currentItem;

        if (data.typePalette >= 3)
           dlg.blendMode_Combo.enabled = false;
        else
           dlg.blendMode_Combo.enabled = true;
        markPreviewSetupChanged();
    };

   this.all_CheckBox = new CheckBox(this);
	with (this.all_CheckBox) {
		text = "All Classic Combinations";
		checked = data.allCombinations;
		onCheck = function (checked) {
         data.allCombinations = checked;
         dlg.forax_Combo.enabled = !checked;
         markPreviewSetupChanged();
      };
	}

	this.typeForaxx_Sizer = new HorizontalSizer;
    with(this.typeForaxx_Sizer) {
		spacing = 4;
		add(this.forax_Label);
		add(this.forax_Combo, 150);
    }

   this.allCheckbox_Sizer = new HorizontalSizer;
    with(this.allCheckbox_Sizer) {
		spacing = 4;
		add(this.all_CheckBox);
      addStretch();
    }

   // Studio UI: keep the legacy palette selector alive for internal compatibility
   // and New Instance parameters, but hide it because palette selection is now
   // driven by the preview tiles. Without these hide() calls PixInsight can
   // paint unattached controls at the top-left corner of the dialog.
   this.forax_Label.hide();
   this.forax_Combo.hide();
   this.all_CheckBox.hide();

   /*
    * Normalization
    */
   this.linearfit_Label               = new Label(this);
   this.linearfit_Label.text          = "Normalization mode:";
   this.linearfit_Label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
   this.linearfit_Label.minWidth      = labelWidth;

   this.linearfit_Combo = new ComboBox(this);
   this.linearfit_Combo.editEnabled = false;
   this.linearfit_Combo.toolTip = "<p><b>Normalization Mode</b></p>Select the reference channel used to normalize narrowband channels before palette creation. <br /><br />"+
   "<b>Auto</b> estimates a stable reference from Ha/SII/OIII statistics and applies LinearFit to the remaining channels.";
   this.linearfit_Combo.minWidth = labelWidth;
   //this.linearfit_Combo.maxWidth = 150;
   this.linearfit_Combo.addItem("None");
   this.linearfit_Combo.addItem("HA as reference");
   this.linearfit_Combo.addItem("SII as reference");
   this.linearfit_Combo.addItem("OIII as reference");
   this.linearfit_Combo.addItem("Auto");
   this.linearfit_Combo.currentItem = data.linearFit;

   this.linearfit_Combo.onItemSelected = function (){
      data.linearFit = this.currentItem;
      data.lastAutoNormalizationReference = "";
      if ( dlg.updateAutoNormalizationInfoLabel )
         dlg.updateAutoNormalizationInfoLabel();
      markPreviewSetupChanged();
   };

   this.linearfit_Sizer = new HorizontalSizer;
   with(this.linearfit_Sizer) {
      spacing = 4;
      add(this.linearfit_Label);
      add(this.linearfit_Combo, 80);
      addStretch();
   }

   // v0.13.98: compact feedback for Auto normalization.
   this.autoNormalizationInfo_Label = new Label( this );
   this.autoNormalizationInfo_Label.useRichText = true;
   this.autoNormalizationInfo_Label.wordWrapping = true;
   this.autoNormalizationInfo_Label.text = "";
   this.autoNormalizationInfo_Label.hide();

   this.updateAutoNormalizationInfoLabel = function()
   {
      if ( !this.autoNormalizationInfo_Label )
         return;

      if ( data.linearFit == NORMALIZATION_AUTO )
      {
         if ( data.lastAutoNormalizationReference && data.lastAutoNormalizationReference.length > 0 )
            this.autoNormalizationInfo_Label.text = "Auto reference: <b>" + data.lastAutoNormalizationReference + "</b>";
         else
            this.autoNormalizationInfo_Label.text = "Auto will choose a stable channel, with Ha preference when scores are close.";
         this.autoNormalizationInfo_Label.show();
      }
      else
      {
         this.autoNormalizationInfo_Label.text = "";
         this.autoNormalizationInfo_Label.hide();
      }
   };

   if ( this.autoSetNormalizationNoneForRealSII )
      this.autoSetNormalizationNoneForRealSII();
   if ( this.updateBlendModeAvailability )
      this.updateBlendModeAvailability();

    /*
     * Blend Mode
     */
    this.blendMode_Label               = new Label(this);
    this.blendMode_Label.text          = "Blend mode:";
    this.blendMode_Label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
    this.blendMode_Label.minWidth      = labelWidth;

    this.blendMode_Combo = new ComboBox(this);
    this.blendMode_Combo.editEnabled = false;
    this.blendMode_Combo.toolTip = "<p><b>Blend Mode</b> <i>(Only for Classic Palettes)</i></p>Here we have three options to help create"+
    "the synthetic <u>green channel</u> using the Ha and OIII data.<br /><br />1. None<br />2. Neutral (50% Ha + 50% OIII)<br />"+
    "3. Soft (60% Ha + 40% OIII) <i>recommended</i><br />4. Hard (70% Ha + 30% OIII)<br />";
    this.blendMode_Combo.minWidth = labelWidth;
    this.blendMode_Combo.addItem("None");
    this.blendMode_Combo.addItem("Neutral (50% Ha + 50% OIII)");
    this.blendMode_Combo.addItem("Soft (60% Ha + 40% OIII)");
    this.blendMode_Combo.addItem("Hard (70% Ha + 30% OIII)");
    this.blendMode_Combo.hideList();

    if (data.blendMode == null || data.blendMode > 3) data.blendMode = 2;
    this.blendMode_Combo.currentItem = data.blendMode;
    this.blendMode_Combo.onItemSelected = function (){
        data.blendMode = this.currentItem;
        markPreviewSetupChanged();
    };

    this.blendMode_Sizer = new HorizontalSizer;
    with(this.blendMode_Sizer) {
        spacing = 4;
        add(this.blendMode_Label);
        add(this.blendMode_Combo, 150);
        addStretch();
    }

   /*
    * Palette setup controls. These affect preview generation and the final
    * selected output. They intentionally do not update the large preview in
    * real time; press Create Previews again after changing them.
    */
   function markPreviewSetupChanged()
   {
      dlg.previewsReady = false;
      if ( dlg.setBoostedControlsCalculationBusy )
         dlg.setBoostedControlsCalculationBusy( false );
      // v0.13.65: setup changes invalidate the whole visual workflow.
      // New image/configuration values are not meaningful until Create Previews
      // is pressed again, so reset Boosted/Advanced/Preset state to neutral.
      if ( dlg.resetWorkflowAfterSetupChange )
         dlg.resetWorkflowAfterSetupChange();
   }

   function setupProcessingNumericControl( control, label, minValue, maxValue, value, precision, sliderSteps, onUpdate )
   {
      control.label.text = label;
      control.label.minWidth = labelWidth;
      control.setRange( minValue, maxValue );
      control.setPrecision( precision );
      control.slider.setRange( 0, sliderSteps );
      control.setValue( value );
      control.onValueUpdated = onUpdate;
   }

   // Legacy setup status label. It is not part of the Studio layout anymore,
   // so keep it explicitly hidden to avoid an orphan text control being painted
   // over the header by the V8 UI engine.
   this.previewSetupStatus_Label = new Label( this );
   this.previewSetupStatus_Label.useRichText = true;
   this.previewSetupStatus_Label.wordWrapping = true;
   this.previewSetupStatus_Label.text = "";
   this.previewSetupStatus_Label.hide();
   this.previewSetupStatus_Label.setFixedSize( 0, 0 );

   this.pipStrength_Control = new NumericControl( this );
   setupProcessingNumericControl( this.pipStrength_Control, "PIP strength:", 0.75, 1.50, data.pipStrength, 2, 75,
      function( value )
      {
         data.pipStrength = value;
         markPreviewSetupChanged();
      } );

   this.haEmphasis_Control = new NumericControl( this );
   setupProcessingNumericControl( this.haEmphasis_Control, "Ha emphasis:", 0.70, 1.50, data.haEmphasis, 2, 80,
      function( value )
      {
         data.haEmphasis = value;
         markPreviewSetupChanged();
      } );

   this.oiiiEmphasis_Control = new NumericControl( this );
   setupProcessingNumericControl( this.oiiiEmphasis_Control, "OIII emphasis:", 0.70, 1.50, data.oiiiEmphasis, 2, 80,
      function( value )
      {
         data.oiiiEmphasis = value;
         markPreviewSetupChanged();
      } );

   this.siiEmphasis_Control = new NumericControl( this );
   setupProcessingNumericControl( this.siiEmphasis_Control, "SII emphasis:", 0.70, 1.50, data.siiEmphasis, 2, 80,
      function( value )
      {
         data.siiEmphasis = value;
         markPreviewSetupChanged();
      } );

   this.paletteSetupReset_Button = new PushButton( this );
   this.paletteSetupReset_Button.text = "Reset palette setup";
   this.paletteSetupReset_Button.onClick = function()
   {
      data.pipStrength = 1.00;
      data.haEmphasis = 1.00;
      data.oiiiEmphasis = 1.00;
      data.siiEmphasis = 1.00;
// RC5.4: boosted variants are no longer represented as separate preview tiles.
data.previewShowBoosted = false;
data.selectedPreviewBoosted = false;
      dlg.pipStrength_Control.setValue( data.pipStrength );
      dlg.haEmphasis_Control.setValue( data.haEmphasis );
      dlg.oiiiEmphasis_Control.setValue( data.oiiiEmphasis );
      dlg.siiEmphasis_Control.setValue( data.siiEmphasis );
      markPreviewSetupChanged();
   };

   this.paletteSetupReset_Sizer = new HorizontalSizer;
   this.paletteSetupReset_Sizer.spacing = 4;
   this.paletteSetupReset_Sizer.addStretch();
   this.paletteSetupReset_Sizer.add( this.paletteSetupReset_Button );

   // Removed from Studio UI: keep these legacy setup controls hidden to avoid
   // orphan widgets being painted over the header in PixInsight V8.
   this.pipStrength_Control.hide(); this.pipStrength_Control.setFixedSize( 0, 0 );
   this.haEmphasis_Control.hide(); this.haEmphasis_Control.setFixedSize( 0, 0 );
   this.oiiiEmphasis_Control.hide(); this.oiiiEmphasis_Control.setFixedSize( 0, 0 );
   this.siiEmphasis_Control.hide(); this.siiEmphasis_Control.setFixedSize( 0, 0 );
   this.paletteSetupReset_Button.hide(); this.paletteSetupReset_Button.setFixedSize( 0, 0 );


   /*
    * Real-time large-preview controls.
    *
    * Stage 3.1 preview engine: parameters update immediately while a small
    * debounced timer waits for the user to stop moving the slider before
    * recalculating the large preview bitmap. This avoids a PixelMath run on
    * every slider tick and makes the interaction much smoother.
    */
   this.realtimeSliderDragging = false;
   this.realtimeRefreshSuspended = false;
   this.realtimeRefreshBusy = false;
   this.realtimeRefreshQueued = false;
   this.realtimeRefreshQueuedForce = false;
   this.realtimePreviewCalculating = false;
   this.showAdvancedCalculatingOverlay = false;
   this.largePreviewInvalid = false;
   this.previewOverlayMessage = "Calculating preview...";
   this.previewToastMessage = "";
   this.previewToastVisible = false;
   this.realtimePreviewLastKey = "";
   this.largePreviewBaseBitmap = null;
   this.largePreviewBaseKey = "";
   this.largePreviewAdvancedBitmap = null;
   this.largePreviewAdvancedKey = "";
   this.advancedPreviewPendingKey = "";
   this.advancedPreviewLastAppliedKey = "";
   this.advancedPreviewRefreshQueued = false;
   this.advancedPreviewBusy = false;
   this.frozenAdvancedSourceView = null;
   this.frozenAdvancedBaseKey = "";
   this.frozenAdvancedBoostBaseline = null;
   this.advancedUndoStack = [];
   this.advancedRedoStack = [];
   this.advancedStackSerial = 0;

   // ImageBlend-style preview cache: keep rendered large-preview bitmaps by
   // effective parameter key. This avoids recalculating the same preview when
   // the user switches between already visited palette tiles.
   this.largePreviewBitmapCache = {};
   this.largePreviewCacheOrder = [];
   this.largePreviewCacheLimit = 32;

   this.clearLargePreviewCache = function()
   {
      this.largePreviewBitmapCache = {};
      this.largePreviewCacheOrder = [];
      this.largePreviewBaseBitmap = null;
      this.largePreviewBaseKey = "";
      this.largePreviewAdvancedBitmap = null;
      this.largePreviewAdvancedKey = "";
      clearMaskPreviewBitmapCache();
      closeLayeredLargePreviewCacheViews();
      cleanupAllLargePreviewRefinedWindows();
      this.advancedPreviewPendingKey = "";
      this.advancedPreviewLastAppliedKey = "";
      this.advancedPreviewRefreshQueued = false;
      this.advancedPreviewBusy = false;
      this.largePreviewInvalid = false;
      this.realtimePreviewLastKey = "";
   };

   this.showLargePreviewLoading = function( message )
   {
      this.previewOverlayMessage = message || "Loading preview...";
      this.realtimePreviewCalculating = true;
      this.showAdvancedCalculatingOverlay = true;
      if ( this.largePreview_Control )
         this.largePreview_Control.update();
      try { processEvents(); } catch ( e ) {}
   };

   this.hideLargePreviewLoading = function()
   {
      this.realtimePreviewCalculating = false;
      this.showAdvancedCalculatingOverlay = false;
      this.largePreviewInvalid = false;
      this.previewOverlayMessage = "Calculating preview...";
      this.setPreviewActivity( false );
      if ( this.largePreview_Control )
         this.largePreview_Control.update();
   };

   this.markLargePreviewStale = function()
   {
      /* RC5.0: ImageBlend-style stale preview feedback. While a debounced
       * recalculation is pending, keep the last bitmap visible but mark it with
       * a yellow cross instead of replacing it with a text-only message.
       */
      this.largePreviewInvalid = true;
      this.previewOverlayMessage = "Calculating preview...";
      this.setPreviewActivity( false );
      if ( this.largePreview_Control )
         this.largePreview_Control.update();
      try { processEvents(); } catch ( e ) {}
   };

   this.clearLargePreviewStale = function()
   {
      this.largePreviewInvalid = false;
      if ( this.largePreview_Control )
         this.largePreview_Control.update();
   };

   this.adjustLargePreviewControlAspect = function()
   {
      /* v0.14.28: keep the function as a safe no-op. v0.14.27 tried to reduce
       * letterboxing by locking the preview control height to the bitmap aspect
       * ratio, but that prevented the large preview from growing naturally when
       * the user resized the dialog. The draw code already preserves image
       * aspect ratio; the control itself must remain fully resizable.
       */
      return;
   };

   this.exportCurrentMaskToView = function()
   {
      if ( !(data.previewEnableMaskProtection || data.previewEnableStarProtection) || !isAnyMaskActive() )
      {
         (new MessageBox( "Enable a mask first.", TITLE, StdIcon_Error, StdButton_Ok )).execute();
         return;
      }

      var sourceView = null;
      if ( isValidView( this.largePreviewSourceView ) )
         sourceView = this.largePreviewSourceView;
      else if ( this.selectedPreviewTile != null && isValidView( this.selectedPreviewTile.view ) )
         sourceView = this.selectedPreviewTile.view;
      else if ( isValidView( data.currentView ) )
         sourceView = data.currentView;

      if ( !isValidView( sourceView ) )
      {
         (new MessageBox( "No valid preview source is available to export the mask.", TITLE, StdIcon_Error, StdButton_Ok )).execute();
         return;
      }

      this.previewOverlayMessage = (data.previewInvertMask ? "Exporting inverted mask..." : "Exporting mask...");
      this.realtimePreviewCalculating = true;
      if ( this.largePreview_Control )
         this.largePreview_Control.update();

      var maskView = createSelectedMaskView( sourceView );
      if ( !isValidView( maskView ) )
      {
         this.realtimePreviewCalculating = false;
         if ( this.largePreview_Control )
            this.largePreview_Control.update();
         (new MessageBox( "The current mask could not be generated.", TITLE, StdIcon_Error, StdButton_Ok )).execute();
         return;
      }

      var presetName = "StarProtection";
      switch ( data.previewMaskPreset || 0 )
      {
         case 1: presetName = "BlueCore"; break;
         case 2: presetName = "WarmGold"; break;
         case 3: presetName = "FaintRed"; break;
      }

      // Do not use PREVIEW_PREFIX here: exported masks are user-facing views
      // and must not be removed by APS temporary-window cleanup.
      var outId = "APS_MASK_" + presetName + (data.previewInvertMask ? "_INV_" : "_") + (++gStarMaskSerial);

      var tmpData = new parametersPrototype();
      tmpData.setDefaults();
      tmpData.currentView = maskView;
      tmpData.referenceHA = maskView;
      tmpData.previewSilent = true;

      var exportedOk = false;
      try
      {
         pixelMathFcn( tmpData, "$T", "", "", "", outId, false );
         var outWin = ImageWindow.windowById( outId );
         if ( isValidWindow( outWin ) )
         {
            outWin.show();
            outWin.zoomToFit();
            try { outWin.mainView.stf = maskView.stf; } catch ( e0 ) {}
            Console.noteln( "Exported mask view: ", outId );
            exportedOk = true;
         }
      }
      catch ( e )
      {
         Console.warningln( "Mask export failed: ", e );
         (new MessageBox( "The current mask could not be exported.", TITLE, StdIcon_Error, StdButton_Ok )).execute();
      }

      this.realtimePreviewCalculating = false;
      if ( exportedOk )
         this.showPreviewToast( "Mask exported correctly" );
      else if ( this.largePreview_Control )
         this.largePreview_Control.update();
   };

   this.showPreviewToast = function( message )
   {
      this.previewToastMessage = message || "Done";
      this.previewToastVisible = true;
      if ( this.largePreview_Control )
         this.largePreview_Control.update();
      if ( this.previewToast_Timer )
      {
         this.previewToast_Timer.stop();
         this.previewToast_Timer.start();
      }
   };

   this.clearPreviewToast = function()
   {
      if ( this.previewToast_Timer )
         this.previewToast_Timer.stop();
      this.previewToastVisible = false;
      this.previewToastMessage = "";
      if ( this.largePreview_Control )
         this.largePreview_Control.update();
   };

   this.storeLargePreviewCache = function( key, bmp )
   {
      if ( key == null || bmp == null )
         return;

      if ( this.largePreviewBitmapCache[key] == null )
      {
         this.largePreviewCacheOrder.push( key );
         while ( this.largePreviewCacheOrder.length > this.largePreviewCacheLimit )
         {
            var oldKey = this.largePreviewCacheOrder.shift();
            delete this.largePreviewBitmapCache[oldKey];
         }
      }

      this.largePreviewBitmapCache[key] = bmp;
   };

   this.getLargePreviewCache = function( key )
   {
      if ( key == null )
         return null;
      return this.largePreviewBitmapCache[key] || null;
   };

   this.realtimePreviewParameterKey = function()
   {
      return JSON.stringify( {
         palette: this.selectedPaletteIndex,
         boosted: this.selectedPaletteBoosted,
         sourceId: isValidView( this.largePreviewSourceView ) ? this.largePreviewSourceView.id : "",
         sourceWidth: isValidView( this.largePreviewSourceView ) ? this.largePreviewSourceView.image.width : 0,
         sourceHeight: isValidView( this.largePreviewSourceView ) ? this.largePreviewSourceView.image.height : 0,
         sourceChannels: isValidView( this.largePreviewSourceView ) ? this.largePreviewSourceView.image.numberOfChannels : 0,
         previewQuality: data.previewQuality,
         frozenAdvanced: this.isFrozenAdvancedBaseUsable ? (this.isFrozenAdvancedBaseUsable() ? this.frozenAdvancedBaseKey : "") : "",
         showOriginal: data.previewShowLastPreview,
         autoStretch: data.previewAutoStretch,
         scnr: data.previewSCNR,
         oiii: data.previewOIIIBoost,
         sii: data.previewSIIBoost,
         shadow: data.previewShadowPoint,
         highlight: data.previewHighlightReduction,
         brightness: data.previewBrightness,
         contrast: data.previewContrast,
         saturation: data.previewSaturation,
         cyanGold: data.previewCyanGoldBalance,
         redYellow: data.previewRedYellowBalance,
         maskEnabled: data.previewEnableMaskProtection || data.previewEnableStarProtection,
         maskPreset: data.previewMaskPreset || 0,
         maskAmount: data.previewStarProtectionAmount,
         showMask: data.previewShowMaskPreview,
         invertMask: data.previewInvertMask,

         // i02: The large preview renderer includes committed and pending
         // Advanced layers in the same visual chain as Boosted. Keep that
         // state in the normal realtime cache key as well, otherwise a
         // delayed/base realtime refresh can reuse an older Boosted-only
         // bitmap and overwrite the Advanced preview a few seconds later.
         advancedStackDepth: ((data.previewAdvancedLayerStack != null) ? data.previewAdvancedLayerStack.length : 0),
         advancedGoldEnabled: data.previewEnableSIIAccent,
         advancedGoldAmount: data.previewSIIHighlightAccent,
         advancedLightnessEnabled: data.previewEnableLightness,
         advancedLightnessSource: data.previewLightnessSource,
         advancedLightnessAmount: data.previewLightnessAmount,
         advancedStructureEnabled: data.previewEnableChannelLightness,
         advancedStructureSource: data.previewChannelLightnessSource,
         advancedStructureAmount: data.previewChannelLightnessAmount
      } );
   };

   this.advancedPreviewParameterKey = function()
   {
      // Kept as a semantic alias for Advanced-specific timers/apply logic.
      // realtimePreviewParameterKey() already includes the Advanced state in
      // i02 so base/advanced cache entries cannot collide.
      return this.realtimePreviewParameterKey();
   };

   this.invalidateAdvancedPreviewCache = function()
   {
      this.largePreviewAdvancedBitmap = null;
      this.largePreviewAdvancedKey = "";
      this.advancedPreviewPendingKey = "";
      this.advancedPreviewLastAppliedKey = "";
      this.advancedPreviewRefreshQueued = false;
   };

   this.showBasePreviewFromCacheOrRefresh = function()
   {
      var key = this.realtimePreviewParameterKey();
      var cached = this.getLargePreviewCache( key );
      if ( cached != null )
      {
         this.largePreviewBitmap = cached;
         this.largePreviewBaseBitmap = cached;
         this.largePreviewBaseKey = key;
         if ( this.largePreview_Control )
            this.largePreview_Control.update();
      }
      else
         this.refreshLargePreviewBoost( true );
   };

   this.showAdvancedPreviewFromCacheOrBase = function()
   {
      var key = this.advancedPreviewParameterKey();
      if ( isAnyAdvancedPreviewActive() && this.largePreviewAdvancedBitmap != null && this.largePreviewAdvancedKey == key )
      {
         this.largePreviewBitmap = this.largePreviewAdvancedBitmap;
         if ( this.largePreview_Control )
            this.largePreview_Control.update();
      }
      else
         this.showBasePreviewFromCacheOrRefresh();
   };

   this.refreshTransientAdvancedPreview = function()
   {
      /* Realtime Advanced preview helper. This renders the currently enabled
       * Advanced controls over the visible preview without pushing anything to
       * the Advanced stack. Apply remains the explicit commit/stack action.
       */
      this.syncAdvancedControlValues();
      // Do not invalidate here: callers invalidate when a control actually
      // changes. This allows same-key Advanced renders to be reused and avoids
      // visible flicker after the debounce timer fires.
      if ( this.realtimePreviewTimer )
         this.realtimePreviewTimer.stop();
      if ( this.applySIIAccent_Timer )
         this.applySIIAccent_Timer.stop();
      this.clearLargePreviewStale();

      if ( !isAnyAdvancedPreviewActive() )
      {
         data.previewSIIAccentActive = false;
         this.showBasePreviewFromCacheOrRefresh();
         this.refreshAdvancedControlsState();
         return;
      }

      var key = this.advancedPreviewParameterKey();
      if ( this.largePreviewAdvancedBitmap != null && this.largePreviewAdvancedKey == key )
      {
         this.largePreviewBitmap = this.largePreviewAdvancedBitmap;
         if ( this.largePreview_Control )
            this.largePreview_Control.update();
         this.refreshAdvancedControlsState();
         return;
      }

      var oldActive = data.previewSIIAccentActive;
      data.previewSIIAccentActive = true;
      this.realtimePreviewCalculating = true;
      this.showAdvancedCalculatingOverlay = true;
      this.previewOverlayMessage = "Calculating advanced preview...";
      if ( this.largePreview_Control )
         this.largePreview_Control.update();
      try { processEvents(); } catch ( eap ) {}

      try
      {
         this.refreshLargePreviewBoost( true );
         this.largePreviewAdvancedBitmap = this.largePreviewBitmap;
         this.largePreviewAdvancedKey = key;
      }
      finally
      {
         data.previewSIIAccentActive = oldActive;
         // i02: an Advanced render is authoritative for the current visible
         // state. Drop any stale base/Boosted realtime refresh queued while
         // the Advanced PixelMath pass was running; otherwise it can overwrite
         // the correct Structure Lift/Gold Accent preview shortly afterwards.
         this.realtimeRefreshQueued = false;
         this.realtimeRefreshQueuedForce = false;
         if ( this.realtimePreviewTimer )
            this.realtimePreviewTimer.stop();
         this.realtimePreviewCalculating = false;
         this.showAdvancedCalculatingOverlay = false;
         this.previewOverlayMessage = "Calculating preview...";
         this.refreshAdvancedControlsState();
         if ( this.largePreview_Control )
            this.largePreview_Control.update();
      }
   };

   this.commitRealtimePreviewRefresh = function( forceRefresh )
   {
      if ( this.realtimeRefreshSuspended )
         return;

      if ( this.realtimeRefreshBusy )
      {
         this.realtimeRefreshQueued = true;
         this.realtimeRefreshQueuedForce = this.realtimeRefreshQueuedForce || !!forceRefresh;
         return;
      }

      var key = this.realtimePreviewParameterKey();
      if ( !forceRefresh && key == this.realtimePreviewLastKey )
      {
         this.setPreviewActivity( false );
         return;
      }

      this.markLargePreviewStale();
      this.refreshLargePreviewBoost( true );
      // refreshLargePreviewBoost updates realtimePreviewLastKey when the render
      // completes.  Keeping the assignment inside the renderer avoids marking a
      // failed or queued calculation as already up to date.
      // v0.13.47: If Advanced has already been applied, it becomes a frozen
      // preview base. Realtime/Boosted controls now fine-tune that frozen base
      // and must not recompute the expensive Advanced stack on every slider move.
   };

   this.scheduleRealtimePreviewRefresh = function( forceRefresh )
   {
      if ( this.realtimeRefreshSuspended )
         return;

      if ( this.realtimeRefreshBusy )
      {
         this.realtimeRefreshQueued = true;
         this.realtimeRefreshQueuedForce = this.realtimeRefreshQueuedForce || !!forceRefresh;
         return;
      }

      this.realtimePreviewTimer.stop();

      if ( forceRefresh )
      {
         this.commitRealtimePreviewRefresh( true );
         return;
      }

      // RC5.0: Mark the current large preview as stale immediately while the
      // debounced timer waits for the user to stop moving the slider.
      this.markLargePreviewStale();

      // RC3.12.1: Match SCC-style debounce at 1.0 s for smoother slider interaction.
      // Do not run PixelMath on every tick: let PixInsight release the native
      // NumericControl slider capture before recalculating.
      this.realtimePreviewTimer.start();
   };

   this.realtimePreviewTimer = new Timer();
   this.realtimePreviewTimer.interval = APS_REALTIME_PREVIEW_DEBOUNCE_SECONDS;
   this.realtimePreviewTimer.periodic = false;
   this.realtimePreviewTimer.dialog = this;
   this.realtimePreviewTimer.onTimeout = function()
   {
      this.stop();
      this.dialog.commitRealtimePreviewRefresh( false );
   };

   function getBoostRangeModeSpec( mode )
   {
      switch ( mode )
      {
      case BOOST_RANGE_FINE:
         return {
            scnr:[0.00,0.50], oiii:[0.85,1.15], sii:[0.85,1.15],
            shadows:[0.90,1.10], highlights:[0.85,1.15], brightness:[0.85,1.15], contrast:[0.85,1.15],
            saturation:[0.80,1.20], cyanGold:[-0.35,0.35], redYellow:[-0.35,0.35]
         };
      case BOOST_RANGE_AGGRESSIVE:
         return {
            scnr:[0.00,1.00], oiii:[0.25,1.75], sii:[0.25,1.75],
            shadows:[0.60,1.40], highlights:[0.35,1.65], brightness:[0.55,1.45], contrast:[0.45,1.55],
            saturation:[0.20,1.80], cyanGold:[-1.50,1.50], redYellow:[-1.50,1.50]
         };
      case BOOST_RANGE_BALANCED:
      default:
         return {
            scnr:[0.00,1.00], oiii:[0.50,1.50], sii:[0.50,1.50],
            shadows:[0.75,1.25], highlights:[0.50,1.50], brightness:[0.70,1.30], contrast:[0.60,1.40],
            saturation:[0.40,1.60], cyanGold:[-1.00,1.00], redYellow:[-1.00,1.00]
         };
      }
   }

   function setNumericControlMinWidth( control )
   {
      if ( control && control.slider )
         control.slider.scaledMinWidth = 210;
   }

   function setBoostedEditFixedWidth( control )
   {
      if ( control && control.edit )
         control.edit.setFixedWidth( APS_BOOSTED_EDIT_WIDTH );
   }


   function createBoostResetButton( dialog, toolTip, resetValue, control, assignCallback )
   {
      var b = new ToolButton( dialog );
      b.icon = dialog.scaledResource( ':/icons/clear-inverted.png' );
      b.setScaledFixedSize( 18, 18 );
      b.toolTip = toolTip;
      b.onClick = function()
      {
         dialog.realtimeRefreshSuspended = true;
         control.setValue( resetValue );
         if ( assignCallback )
            assignCallback( resetValue );
         dialog.realtimeRefreshSuspended = false;
         dialog.invalidateAdvancedPreviewCache();
         dialog.scheduleRealtimePreviewRefresh( true );
      };
      return b;
   }

   function createBoostedControlRow( dialog, control, resetButton )
   {
      var s = new HorizontalSizer;
      s.spacing = 4;
      s.add( control, 1 );
      if ( resetButton )
         s.add( resetButton );
      return s;
   }

   function setupRealtimeNumericControl( control, label, minValue, maxValue, value, precision, sliderSteps, onUpdate )
   {
      control.label.text = label;
      control.label.minWidth = labelWidth;
      control.setRange( minValue, maxValue );
      control.setPrecision( precision );
      control.slider.setRange( 0, sliderSteps );
      control.setValue( value );
      // Keep all Boosted numeric edit boxes visually consistent. NumericControl
      // tends to widen edits automatically for signed ranges, which made the
      // Cyan/Gold and Red/Yellow boxes wider than the other controls.
      if ( control.edit )
         control.edit.setFixedWidth( APS_BOOSTED_EDIT_WIDTH );

      control.onValueUpdated = function( v )
      {
         onUpdate( v );
         dlg.invalidateAdvancedPreviewCache();
         dlg.scheduleRealtimePreviewRefresh( false );
      };

      // Do not override slider mouse handlers here. PixInsight's NumericControl
      // slider has its own mouse capture behavior; custom press/release handlers
      // can leave the knob "active" while the pointer moves elsewhere. The
      // debounce timer below is enough: every value update restarts the timer,
      // and the preview is recalculated only after movement settles.
      if ( control.edit )
         control.edit.onEditCompleted = function()
         {
            onUpdate( control.value );
            dlg.invalidateAdvancedPreviewCache();
            dlg.scheduleRealtimePreviewRefresh( true );
         };
   }

   this.previewChannelTitle_Label = new Label( this );
   this.previewChannelTitle_Label.backgroundColor = SECTION_HINT_BG;
   this.previewChannelTitle_Label.useRichText = true;
   this.previewChannelTitle_Label.text = "<b>Channel controls</b>";

   this.previewSCNR_Control = new NumericControl( this );
   setupRealtimeNumericControl( this.previewSCNR_Control, "SCNR:", 0.00, 1.00, data.previewSCNR, 3, 1000,
      function( value )
      {
         data.previewSCNR = value;
      } );
   this.previewSCNR_Control.toolTip = "<p><b>SCNR</b></p>Softly reduces green dominance in the preview/final output. Useful when HOO or Foraxx variants become too green/cyan. Keep low for natural transitions.";
   setNumericControlMinWidth( this.previewSCNR_Control );

   this.previewOIIIBoost_Control = new NumericControl( this );
   setupRealtimeNumericControl( this.previewOIIIBoost_Control, "OIII boost:", 0.50, 1.50, data.previewOIIIBoost, 3, 10000,
      function( value )
      {
         data.previewOIIIBoost = value;
      } );
   this.previewOIIIBoost_Control.toolTip = "<p><b>OIII boost</b></p>Increases or reduces the OIII/cyan-blue contribution after the palette engine. Helps recover weak OIII signal, but high values can reveal blue halos or noise.";
   setNumericControlMinWidth( this.previewOIIIBoost_Control );

   this.previewSIIBoost_Control = new NumericControl( this );
   setupRealtimeNumericControl( this.previewSIIBoost_Control, "SII boost:", 0.50, 1.50, data.previewSIIBoost, 3, 10000,
      function( value )
      {
         data.previewSIIBoost = value;
      } );
   this.previewSIIBoost_Control.toolTip = "<p><b>SII boost</b></p>Increases or reduces the warm SII/red-gold contribution after the palette engine. Useful for bringing out sulfur structures without changing the base palette logic.";
   setNumericControlMinWidth( this.previewSIIBoost_Control );

   this.previewToneTitle_Label = new Label( this );
   this.previewToneTitle_Label.backgroundColor = SECTION_HINT_BG;
   this.previewToneTitle_Label.useRichText = true;
   this.previewToneTitle_Label.text = "<b>Tone controls</b>";

   this.previewShadowPoint_Control = new NumericControl( this );
   setupRealtimeNumericControl( this.previewShadowPoint_Control, "Shadows:", 0.75, 1.25, data.previewShadowPoint, 3, 5000,
      function( value )
      {
         data.previewShadowPoint = value;
      } );
   this.previewShadowPoint_Control.toolTip = "<p><b>Shadows</b></p>Controls the lower tonal range. Lower values lift faint structures; higher values darken the background. It can reveal existing gradients if pushed too far.";
   setNumericControlMinWidth( this.previewShadowPoint_Control );

   this.previewHighlightReduction_Control = new NumericControl( this );
   setupRealtimeNumericControl( this.previewHighlightReduction_Control, "Highlight red.:", 0.50, 1.50, data.previewHighlightReduction, 3, 10000,
      function( value )
      {
         data.previewHighlightReduction = value;
      } );
   this.previewHighlightReduction_Control.toolTip = "<p><b>Highlight reduction</b></p>Compresses bright structures and star cores to avoid a harsh preview. Useful when the palette looks too contrasty or highlights dominate the nebula.";
   setNumericControlMinWidth( this.previewHighlightReduction_Control );

   this.previewBrightness_Control = new NumericControl( this );
   setupRealtimeNumericControl( this.previewBrightness_Control, "Brightness:", 0.70, 1.30, data.previewBrightness, 3, 6000,
      function( value )
      {
         data.previewBrightness = value;
      } );
   this.previewBrightness_Control.toolTip = "<p><b>Brightness</b></p>Global brightness adjustment applied after the palette engine. Designed as a quick cosmetic preview/final-image refinement.";
   setNumericControlMinWidth( this.previewBrightness_Control );

   this.previewContrast_Control = new NumericControl( this );
   setupRealtimeNumericControl( this.previewContrast_Control, "Contrast:", 0.60, 1.40, data.previewContrast, 3, 8000,
      function( value )
      {
         data.previewContrast = value;
      } );
   this.previewContrast_Control.toolTip = "<p><b>Contrast</b></p>Global contrast around mid-levels. Increases separation between faint and bright nebular structures without changing the selected palette recipe.";
   setNumericControlMinWidth( this.previewContrast_Control );

   this.previewColorTitle_Label = new Label( this );
   this.previewColorTitle_Label.backgroundColor = SECTION_HINT_BG;
   this.previewColorTitle_Label.useRichText = true;
   this.previewColorTitle_Label.text = "<b>Color controls</b>";

   this.previewSaturation_Control = new NumericControl( this );
   setupRealtimeNumericControl( this.previewSaturation_Control, "Saturation:", 0.40, 1.60, data.previewSaturation, 3, 12000,
      function( value )
      {
         data.previewSaturation = value;
      } );
   this.previewSaturation_Control.toolTip = "<p><b>Saturation</b></p>Controls global color intensity. Use moderate values to preserve smooth PIP/Foraxx color transitions.";
   setNumericControlMinWidth( this.previewSaturation_Control );

   this.previewCyanGoldBalance_Control = new NumericControl( this );
   setupRealtimeNumericControl( this.previewCyanGoldBalance_Control, "Cyan / Gold:", -1.00, 1.00, data.previewCyanGoldBalance, 3, 20000,
      function( value )
      {
         data.previewCyanGoldBalance = value;
      } );
   this.previewCyanGoldBalance_Control.toolTip = "<p><b>Cyan / Gold</b></p>SCC Magenta-style warm color balance. Negative values reduce magenta and reveal more gold/yellow in warm structures; positive values strengthen magenta by curving R+B upward through a warm mask.";
   setNumericControlMinWidth( this.previewCyanGoldBalance_Control );

   this.previewRedYellowBalance_Control = new NumericControl( this );
   setupRealtimeNumericControl( this.previewRedYellowBalance_Control, "Red / Yellow:", -1.00, 1.00, data.previewRedYellowBalance, 3, 20000,
      function( value )
      {
         data.previewRedYellowBalance = value;
      } );
   this.previewRedYellowBalance_Control.toolTip = "<p><b>Red / Yellow</b></p>Midtone-biased warm hue balance inspired by SelectiveColorCorrection. Negative values reinforce red tones; positive values reinforce yellow/gold tones.";
   setNumericControlMinWidth( this.previewRedYellowBalance_Control );

   this.previewBoostRange_Label = new Label( this );
   this.previewBoostRange_Label.text = "Control range:";
   this.previewBoostRange_Label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
   this.previewBoostRange_Label.toolTip = "<p>Select how fine or aggressive the Boosted controls should be. Changing this range resets only the Boosted control values to their neutral defaults.</p>";

   this.previewBoostRange_Combo = new ComboBox( this );
   this.previewBoostRange_Combo.editEnabled = false;
   this.previewBoostRange_Combo.addItem( "Fine" );
   this.previewBoostRange_Combo.addItem( "Balanced" );
   this.previewBoostRange_Combo.addItem( "Aggressive" );
   this.previewBoostRange_Combo.currentItem = (data.previewBoostRangeMode != null) ? data.previewBoostRangeMode : BOOST_RANGE_BALANCED;
   this.previewBoostRange_Combo.toolTip = this.previewBoostRange_Label.toolTip;

   this.previewBoostRange_Sizer = new HorizontalSizer;
   this.previewBoostRange_Sizer.spacing = 6;
   this.previewBoostRange_Sizer.addStretch();
   this.previewBoostRange_Sizer.add( this.previewBoostRange_Label );
   this.previewBoostRange_Sizer.addSpacing( 6 );
   this.previewBoostRange_Sizer.add( this.previewBoostRange_Combo );

   this.applyBoostControlRangeMode = function( mode, resetValues, scheduleRefresh )
   {
      var spec = getBoostRangeModeSpec( mode );
      data.previewBoostRangeMode = mode;
      if ( this.previewBoostRange_Combo.currentItem != mode )
         this.previewBoostRange_Combo.currentItem = mode;

      this.previewSCNR_Control.setRange( spec.scnr[0], spec.scnr[1] );
      this.previewOIIIBoost_Control.setRange( spec.oiii[0], spec.oiii[1] );
      this.previewSIIBoost_Control.setRange( spec.sii[0], spec.sii[1] );
      this.previewShadowPoint_Control.setRange( spec.shadows[0], spec.shadows[1] );
      this.previewHighlightReduction_Control.setRange( spec.highlights[0], spec.highlights[1] );
      this.previewBrightness_Control.setRange( spec.brightness[0], spec.brightness[1] );
      this.previewContrast_Control.setRange( spec.contrast[0], spec.contrast[1] );
      this.previewSaturation_Control.setRange( spec.saturation[0], spec.saturation[1] );
      this.previewCyanGoldBalance_Control.setRange( spec.cyanGold[0], spec.cyanGold[1] );
      this.previewRedYellowBalance_Control.setRange( spec.redYellow[0], spec.redYellow[1] );

      // Signed ranges can make NumericControl widen the edit box again after
      // setRange(). Re-apply the common edit width each time the range changes.
      setBoostedEditFixedWidth( this.previewSCNR_Control );
      setBoostedEditFixedWidth( this.previewOIIIBoost_Control );
      setBoostedEditFixedWidth( this.previewSIIBoost_Control );
      setBoostedEditFixedWidth( this.previewShadowPoint_Control );
      setBoostedEditFixedWidth( this.previewHighlightReduction_Control );
      setBoostedEditFixedWidth( this.previewBrightness_Control );
      setBoostedEditFixedWidth( this.previewContrast_Control );
      setBoostedEditFixedWidth( this.previewSaturation_Control );
      setBoostedEditFixedWidth( this.previewCyanGoldBalance_Control );
      setBoostedEditFixedWidth( this.previewRedYellowBalance_Control );

      if ( resetValues )
      {
         this.realtimeRefreshSuspended = true;
         data.previewSCNR = 0.00;
         data.previewOIIIBoost = 1.00;
         data.previewSIIBoost = 1.00;
         data.previewShadowPoint = 1.00;
         data.previewHighlightReduction = 1.00;
         data.previewBrightness = 1.00;
         data.previewContrast = 1.00;
         data.previewSaturation = 1.00;
         data.previewCyanGoldBalance = 0.00;
         data.previewRedYellowBalance = 0.00;
         this.previewSCNR_Control.setValue( data.previewSCNR );
         this.previewOIIIBoost_Control.setValue( data.previewOIIIBoost );
         this.previewSIIBoost_Control.setValue( data.previewSIIBoost );
         this.previewShadowPoint_Control.setValue( data.previewShadowPoint );
         this.previewHighlightReduction_Control.setValue( data.previewHighlightReduction );
         this.previewBrightness_Control.setValue( data.previewBrightness );
         this.previewContrast_Control.setValue( data.previewContrast );
         this.previewSaturation_Control.setValue( data.previewSaturation );
         this.previewCyanGoldBalance_Control.setValue( data.previewCyanGoldBalance );
         this.previewRedYellowBalance_Control.setValue( data.previewRedYellowBalance );
         this.realtimeRefreshSuspended = false;
      }

      if ( scheduleRefresh )
         this.scheduleRealtimePreviewRefresh( true );
   };

   this.previewBoostRange_Combo.onItemSelected = function()
   {
      // RC3.9.3: Changing the range is only a Boosted-controls UI operation.
      // Preserve the currently selected palette/tile and the large preview source;
      // otherwise a forced refresh can visually fall back to the default/classic
      // source after the controls are reset.
      var savedPalette = this.dialog.selectedPaletteIndex;
      var savedBoosted = this.dialog.selectedPaletteBoosted;
      var savedSourceView = this.dialog.largePreviewSourceView;
      var savedZoom = this.dialog.previewZoom;
      var savedPanX = this.dialog.previewPanX;
      var savedPanY = this.dialog.previewPanY;

      this.dialog.applyBoostControlRangeMode( this.currentItem, true, false );

      this.dialog.selectedPaletteIndex = savedPalette;
      this.dialog.selectedPaletteBoosted = savedBoosted;
      data.selectedPreviewPalette = savedPalette;
      data.selectedPreviewBoosted = savedBoosted;
      if ( isValidView( savedSourceView ) )
         this.dialog.largePreviewSourceView = savedSourceView;
      this.dialog.previewZoom = savedZoom;
      this.dialog.previewPanX = savedPanX;
      this.dialog.previewPanY = savedPanY;

      this.dialog.realtimePreviewLastKey = "";
      this.dialog.largePreviewBaseBitmap = null;
      this.dialog.largePreviewBaseKey = "";
      this.dialog.invalidateAdvancedPreviewCache();

      var restoredSource = isValidView( savedSourceView ) ? savedSourceView : null;
      if ( this.dialog.previewTiles )
         for ( var ri = 0; ri < this.dialog.previewTiles.length; ++ri )
         {
            var isSelectedTile = (this.dialog.previewTiles[ri].paletteIndex == savedPalette && this.dialog.previewTiles[ri].boostedVariant == savedBoosted);
            this.dialog.previewTiles[ri].selected = isSelectedTile;
            if ( isSelectedTile && isValidView( this.dialog.previewTiles[ri].previewView ) )
               restoredSource = this.dialog.previewTiles[ri].previewView;
            this.dialog.previewTiles[ri].update();
         }

      this.dialog.selectedPaletteIndex = savedPalette;
      this.dialog.selectedPaletteBoosted = savedBoosted;
      data.selectedPreviewPalette = savedPalette;
      data.selectedPreviewBoosted = savedBoosted;
      if ( isValidView( restoredSource ) )
         this.dialog.largePreviewSourceView = restoredSource;
      if ( this.dialog.selectedPreview_Label )
         this.dialog.selectedPreview_Label.text = "<b>Selected:</b> " + getPreviewPaletteName( savedPalette, savedBoosted );
      this.dialog.previewZoom = savedZoom;
      this.dialog.previewPanX = savedPanX;
      this.dialog.previewPanY = savedPanY;
      this.dialog.refreshLargePreviewBoost( true );
   };

   this.previewSCNR_ResetButton = createBoostResetButton( this, "<p>Reset SCNR to its neutral value.</p>", 0.00, this.previewSCNR_Control, function(v){ data.previewSCNR = v; } );
   this.previewOIIIBoost_ResetButton = createBoostResetButton( this, "<p>Reset OIII boost to its neutral value.</p>", 1.00, this.previewOIIIBoost_Control, function(v){ data.previewOIIIBoost = v; } );
   this.previewSIIBoost_ResetButton = createBoostResetButton( this, "<p>Reset SII boost to its neutral value.</p>", 1.00, this.previewSIIBoost_Control, function(v){ data.previewSIIBoost = v; } );
   this.previewShadowPoint_ResetButton = createBoostResetButton( this, "<p>Reset Shadows to its neutral value.</p>", 1.00, this.previewShadowPoint_Control, function(v){ data.previewShadowPoint = v; } );
   this.previewHighlightReduction_ResetButton = createBoostResetButton( this, "<p>Reset Highlight reduction to its neutral value.</p>", 1.00, this.previewHighlightReduction_Control, function(v){ data.previewHighlightReduction = v; } );
   this.previewBrightness_ResetButton = createBoostResetButton( this, "<p>Reset Brightness to its neutral value.</p>", 1.00, this.previewBrightness_Control, function(v){ data.previewBrightness = v; } );
   this.previewContrast_ResetButton = createBoostResetButton( this, "<p>Reset Contrast to its neutral value.</p>", 1.00, this.previewContrast_Control, function(v){ data.previewContrast = v; } );
   this.previewSaturation_ResetButton = createBoostResetButton( this, "<p>Reset Saturation to its neutral value.</p>", 1.00, this.previewSaturation_Control, function(v){ data.previewSaturation = v; } );
   this.previewCyanGold_ResetButton = createBoostResetButton( this, "<p>Reset Cyan / Gold to its neutral value.</p>", 0.00, this.previewCyanGoldBalance_Control, function(v){ data.previewCyanGoldBalance = v; } );
   this.previewRedYellow_ResetButton = createBoostResetButton( this, "<p>Reset Red / Yellow to its neutral value.</p>", 0.00, this.previewRedYellowBalance_Control, function(v){ data.previewRedYellowBalance = v; } );

   this.previewSCNR_Row = createBoostedControlRow( this, this.previewSCNR_Control, this.previewSCNR_ResetButton );
   this.previewOIIIBoost_Row = createBoostedControlRow( this, this.previewOIIIBoost_Control, this.previewOIIIBoost_ResetButton );
   this.previewSIIBoost_Row = createBoostedControlRow( this, this.previewSIIBoost_Control, this.previewSIIBoost_ResetButton );
   this.previewShadowPoint_Row = createBoostedControlRow( this, this.previewShadowPoint_Control, this.previewShadowPoint_ResetButton );
   this.previewHighlightReduction_Row = createBoostedControlRow( this, this.previewHighlightReduction_Control, this.previewHighlightReduction_ResetButton );
   this.previewBrightness_Row = createBoostedControlRow( this, this.previewBrightness_Control, this.previewBrightness_ResetButton );
   this.previewContrast_Row = createBoostedControlRow( this, this.previewContrast_Control, this.previewContrast_ResetButton );
   this.previewSaturation_Row = createBoostedControlRow( this, this.previewSaturation_Control, this.previewSaturation_ResetButton );
   this.previewCyanGold_Row = createBoostedControlRow( this, this.previewCyanGoldBalance_Control, this.previewCyanGold_ResetButton );
   this.previewRedYellow_Row = createBoostedControlRow( this, this.previewRedYellowBalance_Control, this.previewRedYellow_ResetButton );

   // A Studio adjustment is valid only when an actual large preview has been
   // rendered. This prevents UI events from controls before Create Previews.
   this.hasLoadedLargePreviewForControls = function()
   {
      return !!( this.previewsReady && !this.previewGenerationBusy &&
                 isValidView( this.largePreviewSourceView ) &&
                 this.largePreviewBitmap != null );
   };

   // RC5.2.4: prevent overlapping slider actions while a large preview
   // PixelMath/render pass is active. PixInsight is mostly single-threaded,
   // but queued UI events can still arrive while a previous calculation is
   // finishing, which feels like controls are overlapping.
   this.setBoostedControlsCalculationBusy = function( busy )
   {
      this.boostedControlsCalculationBusy = !!busy;
      var enabled = !!(!busy && !this.finalGenerationBusy && !this.previewGenerationBusy &&
                         this.hasLoadedLargePreviewForControls && this.hasLoadedLargePreviewForControls());
      var controls = [
         this.previewSCNR_Control,
         this.previewOIIIBoost_Control,
         this.previewSIIBoost_Control,
         this.previewShadowPoint_Control,
         this.previewHighlightReduction_Control,
         this.previewBrightness_Control,
         this.previewContrast_Control,
         this.previewSaturation_Control,
         this.previewCyanGoldBalance_Control,
         this.previewRedYellowBalance_Control
      ];
      var buttons = [
         this.previewSCNR_ResetButton,
         this.previewOIIIBoost_ResetButton,
         this.previewSIIBoost_ResetButton,
         this.previewShadowPoint_ResetButton,
         this.previewHighlightReduction_ResetButton,
         this.previewBrightness_ResetButton,
         this.previewContrast_ResetButton,
         this.previewSaturation_ResetButton,
         this.previewCyanGold_ResetButton,
         this.previewRedYellow_ResetButton
      ];

      for ( var ci = 0; ci < controls.length; ++ci )
         if ( controls[ci] ) controls[ci].enabled = enabled;
      for ( var bi = 0; bi < buttons.length; ++bi )
         if ( buttons[bi] ) buttons[bi].enabled = enabled;
      if ( this.previewBoostRange_Combo ) this.previewBoostRange_Combo.enabled = enabled;
      if ( this.boostPreset_Combo ) this.boostPreset_Combo.enabled = enabled;
      if ( this.previewBoostReset_Button ) this.previewBoostReset_Button.enabled = enabled;
      if ( this.applyBoosted_Button ) this.applyBoosted_Button.enabled = enabled;
      var uk = this.boostedStackKey ? this.boostedStackKey( this.selectedPaletteIndex ) : "";
      if ( this.undoBoosted_Button )
      {
         var canUndoBoosted = !!(enabled && this.boostedUndoStacks && this.boostedUndoStacks[uk] && this.boostedUndoStacks[uk].length > 0);
         this.undoBoosted_Button.enabled = canUndoBoosted;
      }
      if ( this.redoBoosted_Button )
      {
         var canRedoBoosted = !!(enabled && this.boostedRedoStacks && this.boostedRedoStacks[uk] && this.boostedRedoStacks[uk].length > 0);
         this.redoBoosted_Button.enabled = canRedoBoosted;
      }
      if ( this.lastPreview_CheckBox ) this.lastPreview_CheckBox.enabled = enabled;
      if ( this.refreshAdvancedControlsState ) this.refreshAdvancedControlsState();
      if ( this.refreshMaskControlsState ) this.refreshMaskControlsState();
      this.update();
   };

   this.applyBoostControlRangeMode( data.previewBoostRangeMode != null ? data.previewBoostRangeMode : BOOST_RANGE_BALANCED, false, false );

   this.enableSIIAccent_CheckBox = new CheckBox( this );
   this.enableSIIAccent_CheckBox.text = "Enable Gold Accent";
   this.enableSIIAccent_CheckBox.checked = data.previewEnableSIIAccent;
   this.enableSIIAccent_CheckBox.toolTip = "<p><b>Enable Gold Accent</b></p>Selects Gold Accent as a pending Advanced layer. Press Calculate & Apply to commit it to the Advanced stack; uncheck it to exclude it from the next Apply.";

   this.previewSIIHighlightAccent_Control = new NumericControl( this );
   this.previewSIIHighlightAccent_Control.label.text = "Gold Accent:";
   this.previewSIIHighlightAccent_Control.label.minWidth = labelWidth;
   this.previewSIIHighlightAccent_Control.setRange( 0.00, 1.00 );
   this.previewSIIHighlightAccent_Control.setPrecision( 3 );
   this.previewSIIHighlightAccent_Control.slider.setRange( 0, 10000 );
   this.previewSIIHighlightAccent_Control.setValue( data.previewSIIHighlightAccent );
   this.previewSIIHighlightAccent_Control.onValueUpdated = function( value )
   {
      data.previewSIIHighlightAccent = value;
      dlg.invalidateAdvancedPreviewCache();
      dlg.refreshAdvancedControlsState();
      // Gold Accent can be applied as a new Advanced layer with Apply Advanced.
      // Do not clear the frozen Advanced base while the user edits the next layer.
   };
   if ( this.previewSIIHighlightAccent_Control.edit )
      this.previewSIIHighlightAccent_Control.edit.onEditCompleted = function()
      {
         data.previewSIIHighlightAccent = dlg.previewSIIHighlightAccent_Control.value;
         dlg.invalidateAdvancedPreviewCache();
         dlg.refreshAdvancedControlsState();
      };
   this.previewSIIHighlightAccent_Control.toolTip = "<p>Selective gold/yellow accent using a ColorMask + RGB/H curves style transformation. For performance, changing this slider does not refresh the preview until you press Calculate & Apply. This version applies a stronger internal Gold Accent response (+50%) while keeping the same slider range.</p>";

   var narrowAdvancedSourceWidth = this.font.width( "OIII" ) + 46;

   // i03: UI order is Ha / SII / OIII. Internal enum remains
   // 0=SII, 1=OIII, 2=Ha for compatibility with saved states/stacks.
   this.advancedSourceOrHa = function( src )
   {
      return (src == 0 || src == 1 || src == 2) ? src : 2;
   };

   this.advancedSourceEnumToComboIndex = function( src )
   {
      src = this.advancedSourceOrHa( src );
      if ( src == 2 ) return 0; // Ha
      if ( src == 0 ) return 1; // SII
      if ( src == 1 ) return 2; // OIII
      return 0; // Default UI source: Ha
   };

   this.advancedSourceComboIndexToEnum = function( idx )
   {
      if ( idx == 0 ) return 2; // Ha
      if ( idx == 1 ) return 0; // SII
      if ( idx == 2 ) return 1; // OIII
      return 2; // Default source: Ha
   };

   this.enableLightness_CheckBox = new CheckBox( this );
   this.enableLightness_CheckBox.text = "Enable Channel Lightness";
   this.enableLightness_CheckBox.checked = data.previewEnableLightness;
   this.enableLightness_CheckBox.toolTip = "<p><b>Enable Channel Lightness</b></p>Selects Channel Lightness as a pending Advanced layer. Press Calculate &amp; Apply to commit it to the Advanced stack; uncheck it to exclude it from the next Apply.</p>";

   this.lightnessSource_Label = new Label( this );
   this.lightnessSource_Label.text = "Source:";
   this.lightnessSource_Label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
   this.lightnessSource_Label.minWidth = labelWidth;

   this.lightnessSource_Combo = new ComboBox( this );
   this.lightnessSource_Combo.editEnabled = false;
   this.lightnessSource_Combo.addItem( "Ha" );
   this.lightnessSource_Combo.addItem( "SII" );
   this.lightnessSource_Combo.addItem( "OIII" );
   this.lightnessSource_Combo.currentItem = this.advancedSourceEnumToComboIndex( this.advancedSourceOrHa( data.previewLightnessSource ) );
   this.lightnessSource_Combo.setFixedWidth( narrowAdvancedSourceWidth );
   this.lightnessSource_Combo.toolTip = "<p>Channel Lightness source. Uses the selected narrowband channel as luminance guidance for the current RGB palette.</p>";
   this.lightnessSource_Combo.onItemSelected = function()
   {
      data.previewLightnessSource = dlg.advancedSourceComboIndexToEnum( this.currentItem );
      dlg.invalidateAdvancedPreviewCache();
      dlg.refreshAdvancedControlsState();
   };

   this.lightnessSource_Sizer = new HorizontalSizer;
   this.lightnessSource_Sizer.spacing = 4;
   this.lightnessSource_Sizer.add( this.lightnessSource_Label );
   this.lightnessSource_Sizer.add( this.lightnessSource_Combo );
   this.lightnessSource_Sizer.addStretch();

   this.previewLightnessAmount_Control = new NumericControl( this );
   this.previewLightnessAmount_Control.label.text = "Lightness amount:";
   this.previewLightnessAmount_Control.label.minWidth = labelWidth;
   this.previewLightnessAmount_Control.setRange( 0.00, 1.00 );
   this.previewLightnessAmount_Control.setPrecision( 3 );
   this.previewLightnessAmount_Control.slider.setRange( 0, 10000 );
   this.previewLightnessAmount_Control.setValue( data.previewLightnessAmount );
   this.previewLightnessAmount_Control.toolTip = "<p><b>Lightness amount</b></p>Controls how strongly the selected source channel guides the image lightness. Internal response is boosted by 100% versus the original 1.0.8 implementation in this tester iteration. For performance, changing this slider does not refresh the preview until you press <b>Calculate &amp; Apply</b>.</p>";
   this.previewLightnessAmount_Control.onValueUpdated = function( value )
   {
      data.previewLightnessAmount = value;
      dlg.invalidateAdvancedPreviewCache();
      dlg.refreshAdvancedControlsState();
   };
   if ( this.previewLightnessAmount_Control.edit )
      this.previewLightnessAmount_Control.edit.onEditCompleted = function()
      {
         data.previewLightnessAmount = dlg.previewLightnessAmount_Control.value;
         dlg.invalidateAdvancedPreviewCache();
         dlg.refreshAdvancedControlsState();
      };

   this.channelLightnessTitle_Label = new Label( this );
   this.channelLightnessTitle_Label.useRichText = true;
   this.channelLightnessTitle_Label.text = "";
   this.channelLightnessTitle_Label.toolTip = "<p>Use a narrowband channel as a selective structure guide. SII, OIII and Ha are implemented.</p>";

   this.enableChannelLightness_CheckBox = new CheckBox( this );
   this.enableChannelLightness_CheckBox.text = "Enable Structure Lift";
   this.enableChannelLightness_CheckBox.checked = data.previewEnableChannelLightness;
   this.enableChannelLightness_CheckBox.toolTip = "<p><b>Enable Structure Lift</b></p>Selects Structure Lift as a pending Advanced layer. Press Calculate & Apply to commit it to the Advanced stack; uncheck it to exclude it from the next Apply. SII, OIII and Ha are implemented.</p>";

   this.channelLightnessSource_Label = new Label( this );
   this.channelLightnessSource_Label.text = "Source:";
   this.channelLightnessSource_Label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
   this.channelLightnessSource_Label.minWidth = labelWidth;

   this.channelLightnessSource_Combo = new ComboBox( this );
   this.channelLightnessSource_Combo.editEnabled = false;
   this.channelLightnessSource_Combo.addItem( "Ha" );
   this.channelLightnessSource_Combo.addItem( "SII" );
   this.channelLightnessSource_Combo.addItem( "OIII" );
   this.channelLightnessSource_Combo.currentItem = this.advancedSourceEnumToComboIndex( this.advancedSourceOrHa( data.previewChannelLightnessSource ) );
   this.channelLightnessSource_Combo.setFixedWidth( narrowAdvancedSourceWidth );
   this.channelLightnessSource_Combo.toolTip = "<p>Structure source. SII, OIII and Ha are functional. OIII uses a blue-core selective structure lift.</p>";
   this.channelLightnessSource_Combo.onItemSelected = function()
   {
      data.previewChannelLightnessSource = dlg.advancedSourceComboIndexToEnum( this.currentItem );
      dlg.invalidateAdvancedPreviewCache();
      dlg.refreshAdvancedControlsState();
      // Source changes define the next Advanced layer; they should not discard
      // the already frozen/stacked Advanced result.
   };

   this.channelLightnessSource_Sizer = new HorizontalSizer;
   this.channelLightnessSource_Sizer.spacing = 4;
   this.channelLightnessSource_Sizer.add( this.channelLightnessSource_Label );
   this.channelLightnessSource_Sizer.add( this.channelLightnessSource_Combo );
   this.channelLightnessSource_Sizer.addStretch();

   this.previewChannelLightnessAmount_Control = new NumericControl( this );
   this.previewChannelLightnessAmount_Control.label.text = "Structure amount:";
   this.previewChannelLightnessAmount_Control.label.minWidth = labelWidth;
   this.previewChannelLightnessAmount_Control.setRange( 0.00, 1.00 );
   this.previewChannelLightnessAmount_Control.setPrecision( 3 );
   this.previewChannelLightnessAmount_Control.slider.setRange( 0, 10000 );
   this.previewChannelLightnessAmount_Control.setValue( data.previewChannelLightnessAmount );
   this.previewChannelLightnessAmount_Control.toolTip = "<p><b>Structure amount</b></p>Controls the selective structure lift guided by the chosen source. SII, OIII and Ha are implemented. OIII is tuned to emphasize blue/cyan inner structure. For performance, changing this slider does not refresh the preview until you press <b>Calculate &amp; Apply</b>.</p>";
   this.previewChannelLightnessAmount_Control.onValueUpdated = function( value )
   {
      data.previewChannelLightnessAmount = value;
      dlg.invalidateAdvancedPreviewCache();
      // i03: Structure Lift is intentionally manual-apply again. Moving the
      // slider should only mark the Advanced cache dirty and keep Boosted
      // controls responsive. The effect is refreshed when Apply is pressed.
      dlg.refreshAdvancedControlsState();
   };
   if ( this.previewChannelLightnessAmount_Control.edit )
      this.previewChannelLightnessAmount_Control.edit.onEditCompleted = function()
      {
         data.previewChannelLightnessAmount = dlg.previewChannelLightnessAmount_Control.value;
         dlg.invalidateAdvancedPreviewCache();
         dlg.refreshAdvancedControlsState();
      };

   this.computeAdvancedPreviewNow = function()
   {
      if ( !this.hasLoadedLargePreviewForControls || !this.hasLoadedLargePreviewForControls() )
         return;
      if ( this.advancedPreviewBusy )
         return;

      this.advancedPreviewBusy = true;
      this.advancedPreviewRefreshQueued = false;

      var key = this.advancedPreviewPendingKey;
      if ( key == "" )
         key = this.advancedPreviewParameterKey();

      // Apply Advanced is a commit operation. Even if the same visual state has
      // already been rendered by the realtime Advanced preview cache, pressing
      // Apply must still push it onto the Advanced layer stack.
      this.pushAdvancedUndoState();
      var currentLayer = captureCurrentAdvancedLayer();
      data.previewSIIAccentActive = true;
      data.previewForcePendingAdvancedLayer = true;
      try
      {
         if ( this.isFrozenAdvancedBaseUsable() )
         {
            // Stacked Advanced workflow: start from the current frozen Advanced
            // preview plus any realtime Boosted fine-tuning deltas, then apply
            // the newly selected Advanced layer on top. This lets the user do
            // OIII Structure Lift -> Apply, then SII Structure Lift -> Apply,
            // without replacing the first result.
            var savedOverrideValues = data.previewRefinementOverrideValues || null;
            data.previewRefinementOverrideValues = this.currentFineTuneValuesFromFrozenBaseline();
            gLastLargePreviewRefinedViewId = "";
            createLargePreviewPanelBitmap( this.frozenAdvancedSourceView, true );
            data.previewRefinementOverrideValues = savedOverrideValues;

            var stackInput = View.viewById( gLastLargePreviewRefinedViewId );
            if ( !isValidView( stackInput ) )
            {
               stackInput = this.cloneHiddenRGBView( this.frozenAdvancedSourceView, PREVIEW_PREFIX + "FROZEN_ADVANCED_BOOSTED_BASE" );
               if ( isValidView( stackInput ) )
                  applyBoostedOnlyRefinementsToView( stackInput );
               else
                  stackInput = this.frozenAdvancedSourceView;
            }

            var stackView = this.cloneHiddenRGBView( stackInput, PREVIEW_PREFIX + "FROZEN_ADVANCED_NEXT" );
            if ( isValidView( stackView ) )
            {
               applyAdvancedLayerToView( stackView, currentLayer );
               var frozenStacked = this.cloneHiddenRGBView( stackView, PREVIEW_PREFIX + "FROZEN_ADVANCED" );
               safeForceCloseWindowById( PREVIEW_PREFIX + "FROZEN_ADVANCED_NEXT" );
               if ( isValidView( frozenStacked ) )
               {
                  this.frozenAdvancedSourceView = frozenStacked;
                  this.frozenAdvancedBaseKey = this.advancedFrozenBaseParameterKey();
                  this.frozenAdvancedBoostBaseline = this.captureBoostedControlsState();
                  if ( data.previewAdvancedLayerStack == null )
                     data.previewAdvancedLayerStack = [];
                  data.previewAdvancedLayerStack.push( currentLayer );
                  this.largePreviewBitmap = renderStudioBitmapFromView( frozenStacked, frozenStacked );
               }
            }
         }
         else
         {
            this.refreshLargePreviewBoost( true );

            // Freeze the just-computed Advanced result as a real hidden view.
            // Subsequent Boosted slider changes operate over this frozen base as
            // fast fine-tuning deltas, instead of recomputing Advanced.
            var advView = View.viewById( gLastLargePreviewRefinedViewId );
            if ( !isValidView( advView ) )
               advView = View.viewById( PREVIEW_PREFIX + "LARGE_PREVIEW_REFINED" ); // legacy fallback
            var frozen = this.cloneHiddenRGBView( advView, PREVIEW_PREFIX + "FROZEN_ADVANCED" );
            if ( isValidView( frozen ) )
            {
               this.frozenAdvancedSourceView = frozen;
               this.frozenAdvancedBaseKey = this.advancedFrozenBaseParameterKey();
               this.frozenAdvancedBoostBaseline = this.captureBoostedControlsState();
               if ( data.previewAdvancedLayerStack == null )
                  data.previewAdvancedLayerStack = [];
               data.previewAdvancedLayerStack.push( currentLayer );
            }
         }

         this.largePreviewAdvancedBitmap = this.largePreviewBitmap;
         this.largePreviewAdvancedKey = key;
         this.advancedPreviewLastAppliedKey = key;
      }
      finally
      {
         data.previewSIIAccentActive = false;
         data.previewForcePendingAdvancedLayer = false;
         data.previewRefinementOverrideValues = null;
         this.realtimePreviewCalculating = false;
         this.showAdvancedCalculatingOverlay = false;
         if ( this.applySIIAccent_Button )
            this.applySIIAccent_Button.enabled = isAnyAdvancedPreviewActive();
         if ( this.undoAdvanced_Button )
            this.undoAdvanced_Button.enabled = this.advancedUndoStack.length > 0;
         if ( this.redoAdvanced_Button )
            this.redoAdvanced_Button.enabled = this.advancedRedoStack.length > 0;
         if ( this.largePreview_Control )
            this.largePreview_Control.update();
         this.advancedPreviewBusy = false;
      }
   };

   this.applySIIAccent_Timer = new Timer();
   this.applySIIAccent_Timer.interval = 0.10;
   this.applySIIAccent_Timer.periodic = false;
   this.applySIIAccent_Timer.dialog = this;
   this.applySIIAccent_Timer.onTimeout = function()
   {
      this.stop();
      try
      {
         if ( this.dialog && this.dialog.computeAdvancedPreviewNow )
            this.dialog.computeAdvancedPreviewNow();
      }
      catch ( e )
      {
         Console.warningln( "Advanced preview refresh aborted: ", e );
      }
   };

   this.advancedRealtimePreview_Timer = new Timer();
   this.advancedRealtimePreview_Timer.interval = 0.10;
   this.advancedRealtimePreview_Timer.periodic = false;
   this.advancedRealtimePreview_Timer.dialog = this;
   this.advancedRealtimePreview_Timer.onTimeout = function()
   {
      // Advanced Controls are strictly Apply-only. This timer is retained only
      // to safely stop stale timers from older/internal builds; it must never
      // render an Advanced preview from slider movement.
      this.stop();
   };

   this.applyAdvancedPreviewNow = function( showOverlay )
   {
      if ( !this.hasLoadedLargePreviewForControls || !this.hasLoadedLargePreviewForControls() )
         return;
      showOverlay = !!showOverlay;
      this.syncAdvancedControlValues();
      if ( !isAnyAdvancedPreviewActive() )
      {
         // No new layer is selected for Apply. Keep the current frozen stack
         // visible if it exists; do not revert to the classic/base preview.
         data.previewSIIAccentActive = false;
         if ( this.isFrozenAdvancedBaseUsable() )
            this.refreshLargePreviewBoost( true );
         else
            this.showBasePreviewFromCacheOrRefresh();
         this.refreshAdvancedControlsState();
         return;
      }

      data.previewShowLastPreview = false;
      if ( this.lastPreview_CheckBox )
         this.lastPreview_CheckBox.checked = false;

      // i04: Advanced must always be committed over the current visible Boosted
      // state. Invalidate large-preview caches before Apply so the sequence is:
      // Base palette -> Masks -> Boosted/current fine tuning -> Advanced layer.
      try
      {
         if ( this.clearLargePreviewCache )
            this.clearLargePreviewCache();
      }
      catch ( eCache ) {}

      var key = this.advancedPreviewParameterKey();
      this.advancedPreviewPendingKey = key;
      if ( this.realtimePreviewTimer )
         this.realtimePreviewTimer.stop();
      this.realtimePreviewCalculating = true;
      this.showAdvancedCalculatingOverlay = showOverlay;
      if ( this.applySIIAccent_Button )
         this.applySIIAccent_Button.enabled = false;
      if ( this.largePreview_Control )
         this.largePreview_Control.update();
      this.advancedPreviewRefreshQueued = true;
      this.applySIIAccent_Timer.stop();
      // Calculate immediately from the button. Advanced sliders/checks remain
      // Apply-only; no Advanced PixelMath runs until this explicit action.
      this.computeAdvancedPreviewNow();
   };

   this.scheduleAdvancedPreviewRefresh = function( forceRefresh )
   {
      // i03: Advanced is manual Apply-only. Keep this function as a safe
      // compatibility hook for preset/legacy paths, but do not launch realtime
      // Advanced rendering from checkbox or slider edits.
      if ( this.realtimeRefreshSuspended )
         return;
      if ( !this.hasLoadedLargePreviewForControls || !this.hasLoadedLargePreviewForControls() )
         return;

      this.syncAdvancedControlValues();
      this.invalidateAdvancedPreviewCache();
      this.advancedPreviewPendingKey = this.advancedPreviewParameterKey();
      this.advancedPreviewRefreshQueued = false;
      if ( this.advancedRealtimePreview_Timer )
         this.advancedRealtimePreview_Timer.stop();
      if ( this.applySIIAccent_Timer )
         this.applySIIAccent_Timer.stop();
      this.refreshAdvancedControlsState();
   };

   this.applySIIAccent_Button = new ToolButton( this );
   this.applySIIAccent_Button.text = "Calculate && Apply";
   this.applySIIAccent_Button.icon = this.scaledResource( ":/icons/process.png" );
   this.applySIIAccent_Button.toolTip = "<p><b>Calculate &amp; Apply</b></p>Calculates the enabled Advanced controls and applies them as a new layer over the current preview. Repeated clicks can stack Channel Lightness, Structure Lift or Gold Accent effects. Boosted controls remain realtime fine-tuning over the stacked result.</p>";
   this.applySIIAccent_Button.onClick = function()
   {
      if ( !dlg.hasLoadedLargePreviewForControls || !dlg.hasLoadedLargePreviewForControls() )
         return;
      if ( !isAnyAdvancedPreviewActive() )
      {
         (new MessageBox( "Enable at least one Advanced control and set its amount above zero.", TITLE, StdIcon_Information, StdButton_Ok )).execute();
         return;
      }

      dlg.applyAdvancedPreviewNow( true );
   };

   this.undoAdvanced_Button = new ToolButton( this );
   this.undoAdvanced_Button.icon = this.scaledResource( ":/icons/undo.png" );
   this.undoAdvanced_Button.enabled = false;
   this.undoAdvanced_Button.toolTip = "<p><b>Undo</b></p>Undo the last applied Advanced layer in the Studio preview stack.</p>";
   this.undoAdvanced_Button.onClick = function()
   {
      if ( !dlg.hasLoadedLargePreviewForControls || !dlg.hasLoadedLargePreviewForControls() )
         return;
      dlg.undoAdvancedLayer();
   };

   this.redoAdvanced_Button = new ToolButton( this );
   this.redoAdvanced_Button.icon = this.scaledResource( ":/icons/redo.png" );
   this.redoAdvanced_Button.enabled = false;
   this.redoAdvanced_Button.toolTip = "<p><b>Redo</b></p>Redo the last undone Advanced layer in the Studio preview stack.</p>";
   this.redoAdvanced_Button.onClick = function()
   {
      if ( !dlg.hasLoadedLargePreviewForControls || !dlg.hasLoadedLargePreviewForControls() )
         return;
      dlg.redoAdvancedLayer();
   };

   this.advancedWarning_Label = new Label( this );
   this.advancedWarning_Label.backgroundColor = SECTION_HINT_BG;
   this.advancedWarning_Label.useRichText = true;
   this.advancedWarning_Label.text = "";
   this.advancedWarning_Label.hide();
   this.advancedWarning_Label.toolTip = "Advanced operations are applied as a compact post-processing stack. Gold Accent uses an optimized mask + PixInsight Convolution pass; Channel Lightness injects source-guided luminance; Structure Lift implements SII, OIII and Ha with source-specific color separation.";

   this.applySIIAccent_Sizer = new HorizontalSizer;
   this.applySIIAccent_Sizer.spacing = 6;
   this.applySIIAccent_Sizer.addStretch();
   this.applySIIAccent_Sizer.add( this.applySIIAccent_Button );
   this.applySIIAccent_Sizer.addSpacing( 8 );
   this.applySIIAccent_Sizer.add( this.undoAdvanced_Button );
   this.applySIIAccent_Sizer.add( this.redoAdvanced_Button );

   this.syncAdvancedControlValues = function()
   {
      // Keep data in sync even if PixInsight only committed the NumericControl
      // edit/slider value but has not fired the update callback yet.
      try
      {
         if ( this.previewSIIHighlightAccent_Control )
            data.previewSIIHighlightAccent = this.previewSIIHighlightAccent_Control.value;
         if ( this.previewLightnessAmount_Control )
            data.previewLightnessAmount = this.previewLightnessAmount_Control.value;
         if ( this.lightnessSource_Combo )
            data.previewLightnessSource = this.advancedSourceComboIndexToEnum( this.lightnessSource_Combo.currentItem );
         if ( this.previewChannelLightnessAmount_Control )
            data.previewChannelLightnessAmount = this.previewChannelLightnessAmount_Control.value;
         if ( this.channelLightnessSource_Combo )
            data.previewChannelLightnessSource = this.advancedSourceComboIndexToEnum( this.channelLightnessSource_Combo.currentItem );
      }
      catch ( e ) {}
   };

   this.previewToast_Timer = new Timer();
   this.previewToast_Timer.interval = 1.80;
   this.previewToast_Timer.periodic = false;
   this.previewToast_Timer.dialog = this;
   this.previewToast_Timer.onTimeout = function()
   {
      this.stop();
      this.dialog.previewToastVisible = false;
      this.dialog.previewToastMessage = "";
      if ( this.dialog.largePreview_Control )
         this.dialog.largePreview_Control.update();
   };

   this.refreshAdvancedControlsState = function()
   {
      this.syncAdvancedControlValues();

      var controlsEnabled = !!(!this.finalGenerationBusy && !this.previewGenerationBusy &&
                               this.hasLoadedLargePreviewForControls && this.hasLoadedLargePreviewForControls());
      var goldEnabled = controlsEnabled && data.previewEnableSIIAccent;
      var lightnessEnabled = controlsEnabled && data.previewEnableLightness;
      var structureEnabled = controlsEnabled && data.previewEnableChannelLightness;
      var implementedLightnessSource = (data.previewLightnessSource == 0 || data.previewLightnessSource == 1 || data.previewLightnessSource == 2);
      var implementedStructureSource = (data.previewChannelLightnessSource == 0 || data.previewChannelLightnessSource == 1 || data.previewChannelLightnessSource == 2);

      if ( this.enableSIIAccent_CheckBox ) this.enableSIIAccent_CheckBox.enabled = controlsEnabled;
      if ( this.enableLightness_CheckBox ) this.enableLightness_CheckBox.enabled = controlsEnabled;
      if ( this.enableChannelLightness_CheckBox ) this.enableChannelLightness_CheckBox.enabled = controlsEnabled;
      this.previewSIIHighlightAccent_Control.enabled = goldEnabled;
      this.lightnessSource_Combo.enabled = lightnessEnabled;
      this.previewLightnessAmount_Control.enabled = lightnessEnabled && implementedLightnessSource;
      this.channelLightnessSource_Combo.enabled = structureEnabled;
      this.previewChannelLightnessAmount_Control.enabled = structureEnabled && implementedStructureSource;
      this.applySIIAccent_Button.enabled = controlsEnabled && !this.realtimePreviewCalculating && isAnyAdvancedPreviewActive();
      if ( this.undoAdvanced_Button )
         this.undoAdvanced_Button.enabled = controlsEnabled && this.advancedUndoStack.length > 0;
      if ( this.redoAdvanced_Button )
         this.redoAdvanced_Button.enabled = controlsEnabled && this.advancedRedoStack.length > 0;
   };

   this.enableSIIAccent_CheckBox.onCheck = function( checked )
   {
      // RC5.1.1: Enable checkboxes are Apply selectors again. They decide
      // which Advanced layer will be committed when the user presses Apply;
      // they do not preview/undo the effect live.
      data.previewEnableSIIAccent = checked;
      dlg.invalidateAdvancedPreviewCache();
      dlg.refreshAdvancedControlsState();
   };

   this.enableLightness_CheckBox.onCheck = function( checked )
   {
      data.previewEnableLightness = checked;
      dlg.invalidateAdvancedPreviewCache();
      dlg.refreshAdvancedControlsState();
   };

   this.enableChannelLightness_CheckBox.onCheck = function( checked )
   {
      // RC5.1.1: Structure Lift is also Apply-only again.
      data.previewEnableChannelLightness = checked;
      dlg.invalidateAdvancedPreviewCache();
      dlg.refreshAdvancedControlsState();
   };

   // v0.13.62: frameless outer section body. The SectionBar already provides
   // the visual title/header, so this matches the lighter Selective Color
   // Correction style and saves vertical space.
   this.advancedControls_GroupBox = new Control( this );
   this.advancedControls_GroupBox.backgroundColor = SECTION_BODY_BG;
   this.advancedControls_GroupBox.sizer = new VerticalSizer;

   with ( this.advancedControls_GroupBox.sizer )
   {
      margin = 4;
      spacing = 5;
      add( this.enableLightness_CheckBox );
      add( this.lightnessSource_Sizer );
      add( this.previewLightnessAmount_Control );
      addSpacing( 8 );
      add( this.enableSIIAccent_CheckBox );
      add( this.previewSIIHighlightAccent_Control );
      addSpacing( 8 );
      add( this.enableChannelLightness_CheckBox );
      add( this.channelLightnessSource_Sizer );
      add( this.previewChannelLightnessAmount_Control );
      addSpacing( 8 );
      add( this.applySIIAccent_Sizer );
   }

   this.enableStarProtection_CheckBox = new CheckBox( this );
   this.enableStarProtection_CheckBox.text = "Enable Mask Protection";
   this.enableStarProtection_CheckBox.checked = data.previewEnableMaskProtection || data.previewEnableStarProtection;
   this.enableStarProtection_CheckBox.enabled = false;
   this.enableStarProtection_CheckBox.toolTip = "<p><b>Mask Protection</b></p>Enables the selected mask preset. The mask modulates Boosted and Advanced effects; Presets only configure controls. Star Protection protects stars/halos; Blue Core selects OIII/cyan-blue structures; Warm/Gold selects Ha/SII warm structures; Faint Red selects weaker red Ha/SII structures.</p>";
   this.enableStarProtection_CheckBox.onCheck = function( checked )
   {
      if ( !dlg.hasLoadedLargePreviewForControls || !dlg.hasLoadedLargePreviewForControls() )
      {
         data.previewEnableMaskProtection = false;
         data.previewEnableStarProtection = false;
         this.checked = false;
         return;
      }
      data.previewEnableMaskProtection = checked;
      data.previewEnableStarProtection = checked; // legacy alias
      if ( !checked )
      {
         data.previewShowMaskPreview = false;
         data.previewInvertMask = false;
      }
      dlg.clearLargePreviewCache();
      dlg.invalidateAdvancedPreviewCache();
      if ( dlg.starProtectionAmount_Control )
         dlg.starProtectionAmount_Control.enabled = checked;
      if ( dlg.showMaskPreview_CheckBox )
      {
         dlg.showMaskPreview_CheckBox.enabled = checked;
         dlg.showMaskPreview_CheckBox.checked = data.previewShowMaskPreview;
      }
      if ( dlg.invertMask_CheckBox )
      {
         dlg.invertMask_CheckBox.enabled = checked;
         dlg.invertMask_CheckBox.checked = data.previewInvertMask;
      }
      if ( dlg.exportMask_Button )
         dlg.exportMask_Button.enabled = checked;
      invalidateStarMaskCache();
      if ( dlg.refreshMaskControlsState )
         dlg.refreshMaskControlsState();
      if ( !checked )
         dlg.refreshLargePreviewBoost( true );
      else
         dlg.scheduleRealtimePreviewRefresh();
   };

   this.starProtectionAmount_Control = new NumericControl( this );
   this.starProtectionAmount_Control.label.text = "Mask amount:";
   this.starProtectionAmount_Control.label.minWidth = labelWidth;
   this.starProtectionAmount_Control.setRange( 0.00, 1.00 );
   this.starProtectionAmount_Control.setPrecision( 3 );
   this.starProtectionAmount_Control.slider.setRange( 0, 10000 );
   this.starProtectionAmount_Control.setValue( data.previewStarProtectionAmount );
   this.starProtectionAmount_Control.enabled = false;
   this.starProtectionAmount_Control.toolTip = "<p><b>Mask amount</b></p>Controls protection strength and halo coverage. Higher values expand and soften the MLT/starlet star mask to protect halos, not just cores.</p>";
   this.starProtectionAmount_Control.onValueUpdated = function( value )
   {
      if ( !dlg.hasLoadedLargePreviewForControls || !dlg.hasLoadedLargePreviewForControls() )
         return;
      data.previewStarProtectionAmount = value;
      invalidateStarMaskCache();
      dlg.clearLargePreviewCache();
      dlg.invalidateAdvancedPreviewCache();
      if ( data.previewEnableMaskProtection || data.previewEnableStarProtection )
         dlg.scheduleRealtimePreviewRefresh();
   };

   this.showMaskPreview_CheckBox = new CheckBox( this );
   this.showMaskPreview_CheckBox.text = "View in preview";
   this.showMaskPreview_CheckBox.checked = data.previewShowMaskPreview;
   this.showMaskPreview_CheckBox.enabled = false;
   this.showMaskPreview_CheckBox.toolTip = "<p>Shows the current mask in the large preview. Disable it to return to the current image preview without changing any processing state.</p>";
   this.showMaskPreview_CheckBox.onCheck = function( checked )
   {
      if ( !dlg.hasLoadedLargePreviewForControls || !dlg.hasLoadedLargePreviewForControls() )
      {
         data.previewShowMaskPreview = false;
         this.checked = false;
         return;
      }
      if ( checked && !(data.previewEnableMaskProtection || data.previewEnableStarProtection) )
      {
         data.previewShowMaskPreview = false;
         this.checked = false;
         return;
      }
      data.previewShowMaskPreview = checked;
      dlg.clearLargePreviewCache();
      dlg.refreshLargePreviewBoost( true );
   };

   this.invertMask_CheckBox = new CheckBox( this );
   this.invertMask_CheckBox.text = "Invert";
   this.invertMask_CheckBox.checked = !!data.previewInvertMask;
   this.invertMask_CheckBox.enabled = false;
   this.invertMask_CheckBox.toolTip = "<p>Inverts the selected mask. The inverted version is cached separately, so Boosted and Advanced controls can reuse it without recalculating the mask on every movement.</p>";
   this.invertMask_CheckBox.onCheck = function( checked )
   {
      if ( !dlg.hasLoadedLargePreviewForControls || !dlg.hasLoadedLargePreviewForControls() )
      {
         data.previewInvertMask = false;
         this.checked = false;
         return;
      }
      if ( checked && !(data.previewEnableMaskProtection || data.previewEnableStarProtection) )
      {
         data.previewInvertMask = false;
         this.checked = false;
         return;
      }
      data.previewInvertMask = checked;
      invalidateStarMaskCache();
      dlg.clearLargePreviewCache();
      dlg.invalidateAdvancedPreviewCache();
      if ( data.previewShowMaskPreview )
         dlg.refreshLargePreviewBoost( true );
      else
         dlg.scheduleRealtimePreviewRefresh();
   };

   this.exportMask_Button = new PushButton( this );
   this.exportMask_Button.text = "Export Mask";
   this.exportMask_Button.toolTip = "<p>Exports the currently selected mask preset to a visible PixInsight grayscale view. If <b>Invert mask</b> is enabled, the exported mask is inverted too.</p>";
   this.exportMask_Button.enabled = false;
   this.exportMask_Button.setFixedWidth( this.font.width( "Export Mask" ) + 44 );
   this.exportMask_Button.onClick = function()
   {
      if ( !dlg.hasLoadedLargePreviewForControls || !dlg.hasLoadedLargePreviewForControls() )
         return;
      dlg.exportCurrentMaskToView();
   };

   this.maskActions_Sizer = new HorizontalSizer;
   this.maskActions_Sizer.spacing = 10;
   this.maskActions_Sizer.add( this.showMaskPreview_CheckBox );
   this.maskActions_Sizer.addStretch();
   this.maskActions_Sizer.add( this.invertMask_CheckBox );
   this.maskActions_Sizer.addSpacing( 8 );
   this.maskActions_Sizer.add( this.exportMask_Button );

   this.maskPreset_Label = new Label( this );
   this.maskPreset_Label.text = "Mask preset:";
   this.maskPreset_Label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
   this.maskPreset_Label.minWidth = labelWidth;

   this.maskPreset_Combo = new ComboBox( this );
   this.maskPreset_Combo.editEnabled = false;
   this.maskPreset_Combo.addItem( "Star Protection" );
   this.maskPreset_Combo.addItem( "Blue Core" );
   this.maskPreset_Combo.addItem( "Warm/Gold" );
   this.maskPreset_Combo.addItem( "Faint Red" );
   this.maskPreset_Combo.addItem( "External View" );
   this.maskPreset_Combo.currentItem = data.previewMaskPreset || 0;
   this.maskPreset_Combo.enabled = false;
   this.maskPreset_Combo.toolTip = "<p><b>Preconfigured masks</b></p><p><b>Star Protection</b>: protects stars and halos from Boosted/Advanced changes.</p><p><b>Blue Core</b>: applies Boosted/Advanced changes mainly to OIII/cyan-blue regions.</p><p><b>Warm/Gold</b>: applies Boosted/Advanced changes mainly to warm Ha/SII/gold structures.</p><p><b>Faint Red</b>: applies Boosted/Advanced changes mainly to weaker red Ha/SII regions, avoiding the brightest warm structures.</p><p><b>External View</b>: uses a user-selected grayscale mask with the same dimensions as the selected source views. White areas receive the Boosted/Advanced effect; black areas remain less affected. Invert Mask is also supported.</p></p>";
   this.maskPreset_Combo.onItemSelected = function()
   {
      if ( !dlg.hasLoadedLargePreviewForControls || !dlg.hasLoadedLargePreviewForControls() )
         return;
      data.previewMaskPreset = this.currentItem;
      invalidateStarMaskCache();
      dlg.clearLargePreviewCache();
      dlg.invalidateAdvancedPreviewCache();
      if ( dlg.refreshMaskControlsState )
         dlg.refreshMaskControlsState();
      if ( data.previewShowMaskPreview )
         dlg.refreshLargePreviewBoost( true );
      else
         dlg.scheduleRealtimePreviewRefresh();
   };

   this.maskPreset_Sizer = new HorizontalSizer;
   this.maskPreset_Sizer.spacing = 4;
   this.maskPreset_Sizer.add( this.maskPreset_Label );
   this.maskPreset_Sizer.add( this.maskPreset_Combo );
   this.maskPreset_Sizer.addStretch();


   this.externalMask_Label = new Label( this );
   this.externalMask_Label.text = "External mask:";
   this.externalMask_Label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
   this.externalMask_Label.minWidth = labelWidth;

   this.externalMask_ViewList = new ComboBox( this );
   this.externalMask_ViewList.minWidth = 300;
   this.externalMask_ViewList.enabled = false;
   this.externalMask_ViewList.toolTip = "<p>Select a grayscale/monochrome mask view with the same dimensions as the selected source views. This imported mask is invalidated automatically whenever the workflow is regenerated.</p>";
   setupFilteredViewCombo( this.externalMask_ViewList, data.previewExternalMaskView, false, true, "<No View Selected>",
      function( view )
      {
         var oldView = data.previewExternalMaskView;
         if ( isValidView( view ) && !dlg.validateExternalMaskSelection( view ) )
         {
            dlg.restoreComboSelection( dlg.externalMask_ViewList, oldView );
            return;
         }
         data.previewExternalMaskView = view;
         invalidateStarMaskCache();
         dlg.clearLargePreviewCache();
         dlg.invalidateAdvancedPreviewCache();
         if ( dlg.refreshMaskControlsState )
            dlg.refreshMaskControlsState();
         if ( data.previewShowMaskPreview )
            dlg.refreshLargePreviewBoost( true );
         else
            dlg.scheduleRealtimePreviewRefresh();
      } );

   this.externalMask_Sizer = new HorizontalSizer;
   this.externalMask_Sizer.spacing = 4;
   this.externalMask_Sizer.add( this.externalMask_Label );
   this.externalMask_Sizer.add( this.externalMask_ViewList );
   this.externalMask_Sizer.addStretch();

   this.masks_GroupBox = new Control( this );
   this.masks_GroupBox.backgroundColor = SECTION_BODY_BG;
   this.masks_GroupBox.sizer = new VerticalSizer;
   with ( this.masks_GroupBox.sizer )
   {
      margin = 4;
      spacing = 5;
      add( this.maskPreset_Sizer );
      add( this.externalMask_Sizer );
      add( this.enableStarProtection_CheckBox );
      add( this.starProtectionAmount_Control );
      addSpacing( 4 );
      add( this.maskActions_Sizer );
   }

   this.refreshMaskControlsState = function()
   {
      var controlsEnabled = !!(!this.finalGenerationBusy && !this.previewGenerationBusy &&
                               this.hasLoadedLargePreviewForControls && this.hasLoadedLargePreviewForControls());
      var maskActive = controlsEnabled && (data.previewEnableMaskProtection || data.previewEnableStarProtection);
      if ( this.maskPreset_Combo ) this.maskPreset_Combo.enabled = controlsEnabled;
      if ( this.enableStarProtection_CheckBox ) this.enableStarProtection_CheckBox.enabled = controlsEnabled;
      if ( this.starProtectionAmount_Control ) this.starProtectionAmount_Control.enabled = maskActive;
      if ( this.showMaskPreview_CheckBox ) this.showMaskPreview_CheckBox.enabled = maskActive;
      if ( this.invertMask_CheckBox ) this.invertMask_CheckBox.enabled = maskActive;
      if ( this.exportMask_Button ) this.exportMask_Button.enabled = maskActive;
      var externalMaskControlsEnabled = controlsEnabled && ((data.previewMaskPreset || 0) == 4);
      if ( this.externalMask_Label ) this.externalMask_Label.enabled = externalMaskControlsEnabled;
      if ( this.externalMask_ViewList ) this.externalMask_ViewList.enabled = externalMaskControlsEnabled;
   };

   this.cosmeticPreset_Label = new Label( this );
   this.cosmeticPreset_Label.text = "Preset:";
   this.cosmeticPreset_Label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
   this.cosmeticPreset_Label.minWidth = labelWidth;

   this.cosmeticPreset_Combo = new ComboBox( this );
   this.cosmeticPreset_Combo.editEnabled = false;
   this.cosmeticPreset_Combo.addItem( "Natural Boost" );
   this.cosmeticPreset_Combo.addItem( "Blue Core" );
   this.cosmeticPreset_Combo.addItem( "Warm Sulfur" );
   this.cosmeticPreset_Combo.addItem( "Balanced Detail" );
   this.cosmeticPreset_Combo.addItem( "Deep Contrast" );
   this.cosmeticPreset_Combo.addItem( "Foraxx Pop" );
   this.cosmeticPreset_Combo.currentItem = 0;
   this.cosmeticPreset_Combo.toolTip = "<p>Select a cosmetic preset. Presets adjust Boosted controls and may prepare Advanced settings, but they do not add an Advanced layer until you press <b>Calculate &amp; Apply</b> in Advanced controls.</p>";
   this.cosmeticPreset_Combo.onItemSelected = function( index )
   {
      var p = getCosmeticPresetDefinition( index );
      if ( dlg.cosmeticPresetHint_Label )
         dlg.cosmeticPresetHint_Label.text = p.hint;
   };

   this.applyCosmeticPreset_Button = new PushButton( this );
   this.applyCosmeticPreset_Button.text = "Apply Preset";
   this.applyCosmeticPreset_Button.toolTip = "<p>Applies the selected preset to Boosted controls and prepares Advanced controls. It does not automatically stack an Advanced layer.</p>";

   this.resetCosmeticPreset_Button = new PushButton( this );
   this.resetCosmeticPreset_Button.text = "Reset Preset";
   this.resetCosmeticPreset_Button.enabled = false;
   this.resetCosmeticPreset_Button.toolTip = "<p>Restores the Boosted and Advanced preparation controls to the state they had just before the last preset was applied. This does not undo already stacked Advanced layers; use the Advanced undo button for that.</p>";

   this.cosmeticPreset_Sizer = new HorizontalSizer;
   this.cosmeticPreset_Sizer.spacing = 4;
   this.cosmeticPreset_Sizer.add( this.cosmeticPreset_Label );
   this.cosmeticPreset_Sizer.add( this.cosmeticPreset_Combo, 1 );
   this.cosmeticPreset_Sizer.addSpacing( 6 );
   this.cosmeticPreset_Sizer.add( this.applyCosmeticPreset_Button );
   this.cosmeticPreset_Sizer.addSpacing( 4 );
   this.cosmeticPreset_Sizer.add( this.resetCosmeticPreset_Button );

   this.cosmeticPresetHint_Label = new Label( this );
   this.cosmeticPresetHint_Label.backgroundColor = SECTION_HINT_BG;
   this.cosmeticPresetHint_Label.useRichText = true;
   this.cosmeticPresetHint_Label.wordWrapping = true;
   this.cosmeticPresetHint_Label.text = getCosmeticPresetDefinition( 0 ).hint;
   this.cosmeticPresetHint_Label.toolTip = "Presets do not automatically add Advanced layers. Press Apply in Advanced controls to stack prepared effects.";

   // v0.13.62: frameless outer section body for Presets.
   this.cosmeticPresets_GroupBox = new Control( this );
   this.cosmeticPresets_GroupBox.backgroundColor = SECTION_BODY_BG;
   this.cosmeticPresets_GroupBox.sizer = new VerticalSizer;
   with ( this.cosmeticPresets_GroupBox.sizer )
   {
      margin = 4;
      spacing = 5;
      add( this.cosmeticPreset_Sizer );
      add( this.cosmeticPresetHint_Label );
   }

   this.boostedStackKey = function( paletteIndex )
   {
      return "p" + ((paletteIndex != null) ? paletteIndex : this.selectedPaletteIndex);
   };

   this.getBoostedStackForPalette = function( paletteIndex )
   {
      var key = this.boostedStackKey( paletteIndex );
      if ( this.boostedAppliedStacks[key] == null )
         this.boostedAppliedStacks[key] = [];
      return this.boostedAppliedStacks[key];
   };

   this.syncDataBoostedStackForSelection = function()
   {
      data.previewBoostedLayerStack = cloneBoostedLayerStack( this.getBoostedStackForPalette( this.selectedPaletteIndex ) );
      var uk = this.boostedStackKey( this.selectedPaletteIndex );
      if ( this.undoBoosted_Button )
         this.undoBoosted_Button.enabled = !!(this.boostedUndoStacks[uk] != null && this.boostedUndoStacks[uk].length > 0);
      if ( this.redoBoosted_Button )
         this.redoBoosted_Button.enabled = !!(this.boostedRedoStacks[uk] != null && this.boostedRedoStacks[uk].length > 0);
   };

   this.captureBoostedAppliedState = function()
   {
      var tile = this.getSelectedPreviewTile ? this.getSelectedPreviewTile() : null;
      var state = {
         stack: cloneBoostedLayerStack( this.getBoostedStackForPalette( this.selectedPaletteIndex ) ),
         viewId: "",
         bitmap: (tile != null) ? tile.previewBitmap : null
      };
      if ( tile != null && isValidView( tile.previewView ) )
      {
         var capId = PREVIEW_PREFIX + "BOOSTED_REDO_STATE_" + this.selectedPaletteIndex + "_" + (new Date()).getTime();
         var capView = this.cloneHiddenRGBView( tile.previewView, capId );
         if ( isValidView( capView ) )
            state.viewId = capId;
      }
      return state;
   };

   this.restoreBoostedAppliedState = function( state )
   {
      if ( state == null )
         return;
      var key = this.boostedStackKey( this.selectedPaletteIndex );
      this.boostedAppliedStacks[key] = cloneBoostedLayerStack( state.stack || [] );
      this.syncDataBoostedStackForSelection();

      var tile = this.getSelectedPreviewTile();
      if ( tile != null )
      {
         if ( state.viewId != "" )
         {
            var stateView = View.viewById( state.viewId );
            if ( isValidView( stateView ) )
            {
               var restoredId = PREVIEW_PREFIX + "BOOSTED_RESTORED_" + this.selectedPaletteIndex + "_" + (new Date()).getTime();
               var restored = this.cloneHiddenRGBView( stateView, restoredId );
               if ( isValidView( restored ) )
               {
                  tile.previewView = restored;
                  tile.previewBitmap = renderPreviewTileBitmap( restored, data.previewAutoStretch );
                  this.largePreviewSourceView = restored;
               }
               safeForceCloseWindowById( state.viewId );
            }
         }
         else if ( state.bitmap != null )
            tile.previewBitmap = state.bitmap;
         tile.update();
      }

      this.resetBoostedControlsToNeutral( false );
      this.clearLargePreviewCache();
      this.invalidateAdvancedPreviewCache();

      // i02: restored state is authoritative for Undo/Redo as well.
      // Avoid an immediate neutral refresh that could overwrite the restored view.
      if ( tile != null && isValidView( tile.previewView ) )
      {
         this.largePreviewSourceView = tile.previewView;
         this.largePreviewBitmap = renderStudioBitmapFromView( tile.previewView, tile.previewView );
         this.largePreviewBaseBitmap = this.largePreviewBitmap;
         this.largePreviewBaseKey = this.realtimePreviewParameterKey();
         this.realtimePreviewLastKey = this.largePreviewBaseKey;
         this.clearLargePreviewStale();
         this.hideLargePreviewLoading();
         this.adjustLargePreviewControlAspect();
         if ( this.largePreview_Control )
            this.largePreview_Control.update();
      }
      else
      {
         this.realtimePreviewLastKey = "";
         this.refreshLargePreviewBoost( true );
      }
   };

   this.getSelectedPreviewTile = function()
   {
      for ( var i = 0; i < this.previewTiles.length; ++i )
         if ( this.previewTiles[i].paletteIndex == this.selectedPaletteIndex && !this.previewTiles[i].boostedVariant )
            return this.previewTiles[i];
      return null;
   };

   this.resetBoostedControlsToNeutral = function( refreshPreview )
   {
      this.applyBoostedControlsState( {
         scnr: 0.00, oiii: 1.00, sii: 1.00, shadow: 1.00, highlight: 1.00,
         brightness: 1.00, contrast: 1.00, saturation: 1.00, cyanGold: 0.00, redYellow: 0.00
      } );
      if ( this.boostPreset_Combo )
         this.boostPreset_Combo.currentItem = 0;
      if ( this.boostPresetHint_Label )
         this.boostPresetHint_Label.text = "No Boosted preset selected. Sliders are neutral.";
      if ( refreshPreview )
         this.scheduleRealtimePreviewRefresh( true );
   };

   this.applyBoostedPresetDefinition = function( presetIndex )
   {
      if ( !this.previewsReady || this.previewGenerationBusy || this.realtimeRefreshBusy )
         return;

      var p = getBoostedWorkflowPresetDefinition( presetIndex );
      this.applyBoostedControlsState( p.boosted );

      data.previewEnableSIIAccent = p.enableGold;
      data.previewSIIHighlightAccent = p.goldAmount;
      data.previewEnableLightness = (p.enableLightness != null) ? p.enableLightness : false;
      data.previewLightnessSource = (p.lightnessSource != null) ? p.lightnessSource : 0;
      data.previewLightnessAmount = (p.lightnessAmount != null) ? p.lightnessAmount : 0.0;
      data.previewEnableChannelLightness = p.enableStructure;
      data.previewChannelLightnessSource = p.structureSource;
      data.previewChannelLightnessAmount = p.structureAmount;

      if ( this.enableSIIAccent_CheckBox )
         this.enableSIIAccent_CheckBox.checked = data.previewEnableSIIAccent;
      if ( this.previewSIIHighlightAccent_Control )
         this.previewSIIHighlightAccent_Control.setValue( data.previewSIIHighlightAccent );
      if ( this.enableLightness_CheckBox )
         this.enableLightness_CheckBox.checked = data.previewEnableLightness;
      if ( this.lightnessSource_Combo )
         this.lightnessSource_Combo.currentItem = this.advancedSourceEnumToComboIndex( data.previewLightnessSource );
      if ( this.previewLightnessAmount_Control )
         this.previewLightnessAmount_Control.setValue( data.previewLightnessAmount );
      if ( this.enableChannelLightness_CheckBox )
         this.enableChannelLightness_CheckBox.checked = data.previewEnableChannelLightness;
      if ( this.channelLightnessSource_Combo )
         this.channelLightnessSource_Combo.currentItem = this.advancedSourceEnumToComboIndex( data.previewChannelLightnessSource );
      if ( this.previewChannelLightnessAmount_Control )
         this.previewChannelLightnessAmount_Control.setValue( data.previewChannelLightnessAmount );
      if ( this.boostPresetHint_Label )
         this.boostPresetHint_Label.text = p.hint;

      this.invalidateAdvancedPreviewCache();
      this.refreshAdvancedControlsState();
      this.scheduleRealtimePreviewRefresh( true );
   };

   this.applyBoostedLayerNow = function()
   {
      if ( !this.previewsReady || this.previewGenerationBusy || this.realtimeRefreshBusy )
         return;

      if ( !hasBaseNonGoldPreviewRefinementsToApply() && !hasColorBalanceRefinementsToApply() )
      {
         this.showPreviewToast( "No Boosted changes to apply" );
         return;
      }

      var tile = this.getSelectedPreviewTile();
      if ( tile == null || !isValidView( this.largePreviewSourceView ) )
         return;

      this.setBoostedControlsCalculationBusy( true );
      this.showLargePreviewLoading( "Applying Boosted..." );
      try { processEvents(); } catch ( eApplyBoost0 ) {}

      var key = this.boostedStackKey( this.selectedPaletteIndex );
      if ( this.boostedUndoStacks[key] == null )
         this.boostedUndoStacks[key] = [];
      // A new Apply creates a new branch, so redo history for this palette is no longer valid.
      this.boostedRedoStacks[key] = [];
      if ( this.redoBoosted_Button )
         this.redoBoosted_Button.enabled = false;

      var undoState = {
         stack: cloneBoostedLayerStack( this.getBoostedStackForPalette( this.selectedPaletteIndex ) ),
         viewId: "",
         bitmap: tile.previewBitmap
      };

      try
      {
         if ( isValidView( tile.previewView ) )
         {
            var undoId = PREVIEW_PREFIX + "BOOSTED_UNDO_" + this.selectedPaletteIndex + "_" + (new Date()).getTime();
            var undoView = this.cloneHiddenRGBView( tile.previewView, undoId );
            if ( isValidView( undoView ) )
               undoState.viewId = undoId;
         }
         this.boostedUndoStacks[key].push( undoState );

         // RC5.4.1: Apply must commit the *visible* Boosted state, not a cached
         // base/original bitmap. Force a fresh refined working view and disable
         // the comparison toggle while committing.
         if ( this.realtimePreviewTimer )
            this.realtimePreviewTimer.stop();
         data.previewShowLastPreview = false;
         if ( this.lastPreview_CheckBox )
            this.lastPreview_CheckBox.checked = false;
         this.clearLargePreviewCache();
         gLastLargePreviewRefinedViewId = "";
         this.realtimePreviewLastKey = "";
         this.refreshLargePreviewBoost( true );

         var refinedView = View.viewById( gLastLargePreviewRefinedViewId );
         if ( !isValidView( refinedView ) )
         {
            // If the renderer found no need for a final working copy, build one
            // explicitly from the current large-preview source before committing.
            var fallbackId = PREVIEW_PREFIX + "BOOSTED_APPLIED_FALLBACK_" + this.selectedPaletteIndex + "_" + (new Date()).getTime();
            var fallbackView = makeViewCopy( this.largePreviewSourceView, fallbackId );
            if ( isValidView( fallbackView ) )
            {
               // i02: fallback commit must include the whole current Boosted
               // state, not only the final color-balance layer. Some non-Original
               // palettes can render through a direct/cached preview path without
               // producing gLastLargePreviewRefinedViewId; committing only color
               // balance made Apply appear to calculate and then revert after the
               // controls were reset to neutral.
               applyBoostedOnlyRefinementsToView( fallbackView );
               if ( data.previewAutoStretch )
                  applyDisplayAutoStretchToView( fallbackView, shouldUseLinkedSHODisplayStretch(), "boosted apply fallback display" );
               refinedView = fallbackView;
            }
         }

         var appliedId = PREVIEW_PREFIX + "BOOSTED_APPLIED_" + this.selectedPaletteIndex + "_" + (new Date()).getTime();
         var appliedView = this.cloneHiddenRGBView( refinedView, appliedId );
         if ( isValidView( appliedView ) )
         {
            tile.previewView = appliedView;
            tile.previewBitmap = renderPreviewTileBitmap( appliedView, data.previewAutoStretch );
            this.largePreviewSourceView = appliedView;
            this.getBoostedStackForPalette( this.selectedPaletteIndex ).push( captureCurrentBoostedLayer() );
            this.syncDataBoostedStackForSelection();
            tile.update();

            this.resetBoostedControlsToNeutral( false );
            this.clearLargePreviewCache();
            this.invalidateAdvancedPreviewCache();

            // i02: after Apply, the committed boosted view is authoritative.
            // Do not run an immediate neutral-control refresh, because that can
            // reuse/rebuild a base palette path and visually jump back to the
            // previous preview. The next user edit will refresh from this new
            // appliedView as the source.
            this.largePreviewSourceView = appliedView;
            this.largePreviewBitmap = renderStudioBitmapFromView( appliedView, appliedView );
            this.largePreviewBaseBitmap = this.largePreviewBitmap;
            this.largePreviewBaseKey = this.realtimePreviewParameterKey();
            this.realtimePreviewLastKey = this.largePreviewBaseKey;
            this.clearLargePreviewStale();
            this.hideLargePreviewLoading();
            this.adjustLargePreviewControlAspect();
            if ( this.largePreview_Control )
               this.largePreview_Control.update();

            if ( this.undoBoosted_Button )
               this.undoBoosted_Button.enabled = true;
         }
         else
         {
            // Do not leave a dead undo entry if the commit failed.
            this.boostedUndoStacks[key].pop();
            this.showPreviewToast( "Boosted Apply failed" );
            if ( this.undoBoosted_Button )
               this.undoBoosted_Button.enabled = this.boostedUndoStacks[key].length > 0;
         }
      }
      catch ( eApplyBoost )
      {
         Console.warningln( "Boosted Apply failed: ", eApplyBoost );
         if ( this.boostedUndoStacks[key] && this.boostedUndoStacks[key].length > 0 )
            this.boostedUndoStacks[key].pop();
         this.showPreviewToast( "Boosted Apply failed" );
      }

      this.setBoostedControlsCalculationBusy( false );
   };

   this.undoBoostedLayer = function()
   {
      var key = this.boostedStackKey( this.selectedPaletteIndex );
      var stack = this.boostedUndoStacks[key];
      if ( stack == null || stack.length == 0 )
         return;

      if ( this.boostedRedoStacks[key] == null )
         this.boostedRedoStacks[key] = [];
      this.boostedRedoStacks[key].push( this.captureBoostedAppliedState() );

      var state = stack.pop();
      this.restoreBoostedAppliedState( state );

      if ( this.undoBoosted_Button )
         this.undoBoosted_Button.enabled = stack.length > 0;
      if ( this.redoBoosted_Button )
         this.redoBoosted_Button.enabled = this.boostedRedoStacks[key].length > 0;
   };

   this.redoBoostedLayer = function()
   {
      var key = this.boostedStackKey( this.selectedPaletteIndex );
      var stack = this.boostedRedoStacks[key];
      if ( stack == null || stack.length == 0 )
         return;

      if ( this.boostedUndoStacks[key] == null )
         this.boostedUndoStacks[key] = [];
      this.boostedUndoStacks[key].push( this.captureBoostedAppliedState() );

      var state = stack.pop();
      this.restoreBoostedAppliedState( state );

      if ( this.undoBoosted_Button )
         this.undoBoosted_Button.enabled = this.boostedUndoStacks[key].length > 0;
      if ( this.redoBoosted_Button )
         this.redoBoosted_Button.enabled = stack.length > 0;
   };

   this.capturePresetControlsState = function()
   {
      return {
         boosted: this.captureBoostedControlsState(),
         enableGold: data.previewEnableSIIAccent,
         goldAmount: data.previewSIIHighlightAccent,
         enableLightness: data.previewEnableLightness,
         lightnessSource: data.previewLightnessSource,
         lightnessAmount: data.previewLightnessAmount,
         enableStructure: data.previewEnableChannelLightness,
         structureSource: data.previewChannelLightnessSource,
         structureAmount: data.previewChannelLightnessAmount,
         showOriginal: data.previewShowLastPreview
      };
   };

   this.restorePresetControlsState = function( state )
   {
      if ( state == null )
         return;

      this.applyBoostedControlsState( state.boosted );

      data.previewEnableSIIAccent = state.enableGold;
      data.previewSIIHighlightAccent = state.goldAmount;
      data.previewEnableLightness = !!state.enableLightness;
      data.previewLightnessSource = (state.lightnessSource != null) ? state.lightnessSource : 2;
      data.previewLightnessAmount = (state.lightnessAmount != null) ? state.lightnessAmount : 0.0;
      data.previewEnableChannelLightness = state.enableStructure;
      data.previewChannelLightnessSource = (state.structureSource != null) ? state.structureSource : 2;
      data.previewChannelLightnessAmount = state.structureAmount;
      data.previewShowLastPreview = state.showOriginal;

      if ( this.enableSIIAccent_CheckBox )
         this.enableSIIAccent_CheckBox.checked = data.previewEnableSIIAccent;
      if ( this.previewSIIHighlightAccent_Control )
         this.previewSIIHighlightAccent_Control.setValue( data.previewSIIHighlightAccent );
      if ( this.enableLightness_CheckBox )
         this.enableLightness_CheckBox.checked = data.previewEnableLightness;
      if ( this.lightnessSource_Combo )
         this.lightnessSource_Combo.currentItem = this.advancedSourceEnumToComboIndex( data.previewLightnessSource );
      if ( this.previewLightnessAmount_Control )
         this.previewLightnessAmount_Control.setValue( data.previewLightnessAmount );
      if ( this.enableChannelLightness_CheckBox )
         this.enableChannelLightness_CheckBox.checked = data.previewEnableChannelLightness;
      if ( this.channelLightnessSource_Combo )
         this.channelLightnessSource_Combo.currentItem = this.advancedSourceEnumToComboIndex( data.previewChannelLightnessSource );
      if ( this.previewChannelLightnessAmount_Control )
         this.previewChannelLightnessAmount_Control.setValue( data.previewChannelLightnessAmount );
      if ( this.lastPreview_CheckBox )
         this.lastPreview_CheckBox.checked = data.previewShowLastPreview;

      this.invalidateAdvancedPreviewCache();
      this.refreshAdvancedControlsState();
      this.scheduleRealtimePreviewRefresh( true );
   };

   this.applyCosmeticPreset_Button.onClick = function()
   {
      var p = getCosmeticPresetDefinition( dlg.cosmeticPreset_Combo.currentItem );

      dlg.presetControlsSnapshot = dlg.capturePresetControlsState();
      if ( dlg.resetCosmeticPreset_Button )
         dlg.resetCosmeticPreset_Button.enabled = true;

      dlg.applyBoostedControlsState( p.boosted );

      data.previewEnableSIIAccent = p.enableGold;
      data.previewSIIHighlightAccent = p.goldAmount;
      data.previewEnableChannelLightness = p.enableStructure;
      data.previewChannelLightnessSource = p.structureSource;
      data.previewChannelLightnessAmount = p.structureAmount;

      if ( dlg.enableSIIAccent_CheckBox )
         dlg.enableSIIAccent_CheckBox.checked = data.previewEnableSIIAccent;
      if ( dlg.previewSIIHighlightAccent_Control )
         dlg.previewSIIHighlightAccent_Control.setValue( data.previewSIIHighlightAccent );
      if ( dlg.enableChannelLightness_CheckBox )
         dlg.enableChannelLightness_CheckBox.checked = data.previewEnableChannelLightness;
      if ( dlg.channelLightnessSource_Combo )
         dlg.channelLightnessSource_Combo.currentItem = data.previewChannelLightnessSource;
      if ( dlg.previewChannelLightnessAmount_Control )
         dlg.previewChannelLightnessAmount_Control.setValue( data.previewChannelLightnessAmount );

      if ( dlg.cosmeticPresetHint_Label )
         dlg.cosmeticPresetHint_Label.text = p.hint;

      dlg.invalidateAdvancedPreviewCache();
      dlg.refreshAdvancedControlsState();
      dlg.scheduleRealtimePreviewRefresh( true );
   };

   this.resetCosmeticPreset_Button.onClick = function()
   {
      if ( dlg.presetControlsSnapshot == null )
         return;

      dlg.restorePresetControlsState( dlg.presetControlsSnapshot );
      dlg.presetControlsSnapshot = null;
      this.enabled = false;
      if ( dlg.cosmeticPresetHint_Label )
         dlg.cosmeticPresetHint_Label.text = "Preset reset: restored the controls to the state before the last preset was applied.";
   };

   this.boostPreset_Label = new Label( this );
   this.boostPreset_Label.text = "Cosmetic Presets:";
   this.boostPreset_Label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
   this.boostPreset_Label.minWidth = labelWidth;

   this.boostPreset_Combo = new ComboBox( this );
   this.boostPreset_Combo.editEnabled = false;
   this.boostPreset_Combo.addItem( "None" );
   this.boostPreset_Combo.addItem( "Boosted" );
   this.boostPreset_Combo.addItem( "Natural Boost" );
   this.boostPreset_Combo.addItem( "Blue Core" );
   this.boostPreset_Combo.addItem( "Warm Sulfur" );
   this.boostPreset_Combo.addItem( "Balanced Detail" );
   this.boostPreset_Combo.addItem( "Deep Contrast" );
   this.boostPreset_Combo.addItem( "Foraxx Pop" );
   this.boostPreset_Combo.currentItem = 0;
   this.boostPreset_Combo.enabled = false;
   this.boostPreset_Combo.toolTip = "<p><b>Cosmetic Presets</b></p><p>Select a preset to configure Boosted controls and, where applicable, prepare Advanced controls. The visible preview is recalculated immediately. Use <b>Apply</b> in Boosted or Advanced to stack changes, or generate the final image to use the visible state.</p><p><b>Note:</b> Cosmetic Presets are enabled only after previews have been created.</p>";
   this.boostPreset_Combo.onItemSelected = function( index )
   {
      if ( !dlg.previewsReady || dlg.previewGenerationBusy || dlg.realtimeRefreshBusy )
         return;
      dlg.applyBoostedPresetDefinition( index );
   };

   this.boostPresetHint_Label = new Label( this );
   this.boostPresetHint_Label.backgroundColor = SECTION_HINT_BG;
   this.boostPresetHint_Label.useRichText = true;
   this.boostPresetHint_Label.wordWrapping = true;
   this.boostPresetHint_Label.text = getBoostedWorkflowPresetDefinition( 0 ).hint;
   // RC5.4.2: Keep preset guidance in the tooltip only. An unplaced Label can
   // appear at the top-left of the dialog in PixInsight, so keep this hidden.
   this.boostPresetHint_Label.hide();

   this.boostPreset_Sizer = new HorizontalSizer;
   this.boostPreset_Sizer.spacing = 6;
   this.boostPreset_Sizer.addStretch();
   this.boostPreset_Sizer.add( this.boostPreset_Label );
   this.boostPreset_Sizer.add( this.boostPreset_Combo );

   this.lastPreview_CheckBox = new CheckBox( this );
   this.lastPreview_CheckBox.text = "View Original Palette";
   this.lastPreview_CheckBox.toolTip = "Show the original selected palette preview without real-time controls, so you can compare before/after without resetting slider values.";
   this.lastPreview_CheckBox.checked = data.previewShowLastPreview;
   this.lastPreview_CheckBox.onCheck = function( checked )
   {
      data.previewShowLastPreview = checked;
      // RC5.0.1: View Original Palette is an immediate comparison toggle,
      // not a stale-parameter change. Refresh directly without showing the
      // yellow invalid-preview cross.
      if ( dlg.realtimePreviewTimer )
         dlg.realtimePreviewTimer.stop();
      dlg.clearLargePreviewStale();
      dlg.refreshLargePreviewBoost( true );
   };

   this.captureBoostedControlsState = function()
   {
      return {
         scnr: data.previewSCNR,
         oiii: data.previewOIIIBoost,
         sii: data.previewSIIBoost,
         shadow: data.previewShadowPoint,
         highlight: data.previewHighlightReduction,
         brightness: data.previewBrightness,
         contrast: data.previewContrast,
         saturation: data.previewSaturation,
         cyanGold: data.previewCyanGoldBalance,
         redYellow: data.previewRedYellowBalance
      };
   };

   this.applyBoostedControlsState = function( p )
   {
      if ( p == null )
         return;

      this.realtimeRefreshSuspended = true;
      data.previewSCNR = p.scnr;
      data.previewOIIIBoost = p.oiii;
      data.previewSIIBoost = p.sii;
      data.previewShadowPoint = p.shadow;
      data.previewHighlightReduction = p.highlight;
      data.previewBrightness = p.brightness;
      data.previewContrast = p.contrast;
      data.previewSaturation = p.saturation;
      data.previewCyanGoldBalance = p.cyanGold;
      data.previewRedYellowBalance = p.redYellow;
      this.previewSCNR_Control.setValue( data.previewSCNR );
      this.previewOIIIBoost_Control.setValue( data.previewOIIIBoost );
      this.previewSIIBoost_Control.setValue( data.previewSIIBoost );
      this.previewShadowPoint_Control.setValue( data.previewShadowPoint );
      this.previewHighlightReduction_Control.setValue( data.previewHighlightReduction );
      this.previewBrightness_Control.setValue( data.previewBrightness );
      this.previewContrast_Control.setValue( data.previewContrast );
      this.previewSaturation_Control.setValue( data.previewSaturation );
      this.previewCyanGoldBalance_Control.setValue( data.previewCyanGoldBalance );
      this.previewRedYellowBalance_Control.setValue( data.previewRedYellowBalance );
      this.realtimeRefreshSuspended = false;
      this.invalidateAdvancedPreviewCache();
   };

   this.setBoostedControlsToPreset = function()
   {
      var p = getSoftBoostedPreset();
      this.applyBoostedControlsState( p );
   };

   this.restoreUserBoostedControlsSnapshot = function()
   {
      if ( this.userBoostedControlsSnapshot != null )
      {
         this.applyBoostedControlsState( this.userBoostedControlsSnapshot );
         this.userBoostedControlsSnapshot = null;
      }
   };

   this.advancedFrozenBaseParameterKey = function()
   {
      return JSON.stringify( {
         palette: this.selectedPaletteIndex,
         boostedVariant: this.selectedPaletteBoosted,
         sourceId: isValidView( this.largePreviewSourceView ) ? this.largePreviewSourceView.id : "",
         sourceWidth: isValidView( this.largePreviewSourceView ) ? this.largePreviewSourceView.image.width : 0,
         sourceHeight: isValidView( this.largePreviewSourceView ) ? this.largePreviewSourceView.image.height : 0,
         previewQuality: data.previewQuality,
         showOriginal: data.previewShowLastPreview
      } );
   };

   this.clearAdvancedUndoStack = function()
   {
      for ( var i = 0; i < this.advancedUndoStack.length; ++i )
         if ( this.advancedUndoStack[i].viewId )
            safeForceCloseWindowById( this.advancedUndoStack[i].viewId );
      this.advancedUndoStack = [];
      this.advancedRedoStack = [];
      if ( this.undoAdvanced_Button )
         this.undoAdvanced_Button.enabled = false;
      if ( this.redoAdvanced_Button )
         this.redoAdvanced_Button.enabled = false;
   };

   this.clearFrozenAdvancedBase = function()
   {
      try { safeForceCloseWindowById( PREVIEW_PREFIX + "FROZEN_ADVANCED" ); } catch ( e ) {}
      this.frozenAdvancedSourceView = null;
      this.frozenAdvancedBaseKey = "";
      this.frozenAdvancedBoostBaseline = null;
      data.previewAdvancedLayerStack = [];
      this.clearAdvancedUndoStack();
   };

   this.clearFrozenAdvancedBaseSoft = function()
   {
      // v0.13.67: Used while reacting to setup/view-list changes. Do not close
      // hidden PixInsight windows synchronously from a ViewList callback; some
      // builds can expose stale UI handles and CloseImageWindow may hang PI.
      // We only detach AutoPalette state. Temporary hidden views are cleaned on
      // the next successful Create Previews or when PI exits.
      this.frozenAdvancedSourceView = null;
      this.frozenAdvancedBaseKey = "";
      this.frozenAdvancedBoostBaseline = null;
      data.previewAdvancedLayerStack = [];
      this.advancedUndoStack = [];
      this.advancedRedoStack = [];
      if ( this.undoAdvanced_Button )
         this.undoAdvanced_Button.enabled = false;
      if ( this.redoAdvanced_Button )
         this.redoAdvanced_Button.enabled = false;
   };

   this.isFrozenAdvancedBaseUsable = function()
   {
      // v0.13.55: A frozen Advanced stack remains the active preview base
      // independently of the current Enable checkboxes. Enable only controls
      // what will be added on the next Apply; Undo removes applied layers.
      return isValidView( this.frozenAdvancedSourceView ) &&
             this.frozenAdvancedBaseKey == this.advancedFrozenBaseParameterKey();
   };

   this.resetWorkflowAfterSetupChange = function()
   {
      // This can be called by setup-control callbacks while the dialog is still
      // being constructed. In that case, just mark previews as outdated and exit.
      if ( this.workflowSetupChangeResetting )
         return;
      this.workflowSetupChangeResetting = true;

      try
      {
         if ( this.realtimePreviewTimer )
            this.realtimePreviewTimer.stop();
         if ( this.applySIIAccent_Timer )
            this.applySIIAccent_Timer.stop();
         if ( this.advancedRealtimePreview_Timer )
            this.advancedRealtimePreview_Timer.stop();
         if ( this.previewToast_Timer )
            this.previewToast_Timer.stop();

         this.previewsReady = false;
         this.selectedPaletteIndex = PALETTE_ORIGINAL;
         this.selectedPaletteBoosted = false;
         data.selectedPreviewPalette = PALETTE_ORIGINAL;
         data.selectedPreviewBoosted = false;
         data.typePalette = PALETTE_ORIGINAL;
         data.allCombinations = false;

         // v0.13.67: Do not force-close APS temporary windows while reacting to
         // setup/view-list changes. Selecting <No View Selected> can happen from
         // a UI callback immediately after preview generation, and synchronous
         // CloseImageWindow calls may hit stale PixInsight handles. Detach all
         // script state and let the next successful Create Previews perform
         // normal regeneration.
         this.clearFrozenAdvancedBaseSoft();
         this.invalidateAdvancedPreviewCache();
         this.clearLargePreviewCache();
         invalidateStarMaskCache();
         this.largePreviewBitmap = null;
         this.largePreviewBaseBitmap = null;
         this.largePreviewBaseKey = "";
         this.largePreviewSourceView = null;
         this.realtimePreviewLastKey = "";
         this.userBoostedControlsSnapshot = null;
         this.presetControlsSnapshot = null;
         this.previewSourceDataCache = null;
         this.previewSourceDataCacheKey = "";
         this.boostedAppliedStacks = {};
         this.boostedUndoStacks = {};
         this.boostedRedoStacks = {};
         data.previewBoostedLayerStack = [];

         if ( this.previewTiles )
            for ( var ti = 0; ti < this.previewTiles.length; ++ti )
            {
               this.previewTiles[ti].previewBitmap = null;
               this.previewTiles[ti].previewView = null;
               this.previewTiles[ti].selected = (this.previewTiles[ti].paletteIndex == PALETTE_ORIGINAL && !this.previewTiles[ti].boostedVariant);
               this.previewTiles[ti].update();
            }

         var neutralBoost = {
            scnr: 0.00,
            oiii: 1.00,
            sii: 1.00,
            shadow: 1.00,
            highlight: 1.00,
            brightness: 1.00,
            contrast: 1.00,
            saturation: 1.00,
            cyanGold: 0.00,
            redYellow: 0.00
         };

         if ( this.applyBoostedControlsState )
            this.applyBoostedControlsState( neutralBoost );
         else
         {
            data.previewSCNR = neutralBoost.scnr;
            data.previewOIIIBoost = neutralBoost.oiii;
            data.previewSIIBoost = neutralBoost.sii;
            data.previewShadowPoint = neutralBoost.shadow;
            data.previewHighlightReduction = neutralBoost.highlight;
            data.previewBrightness = neutralBoost.brightness;
            data.previewContrast = neutralBoost.contrast;
            data.previewSaturation = neutralBoost.saturation;
            data.previewCyanGoldBalance = neutralBoost.cyanGold;
            data.previewRedYellowBalance = neutralBoost.redYellow;
         }

         data.previewEnableSIIAccent = false;
         data.previewSIIHighlightAccent = 0.00;
         data.previewSIIAccentActive = false;
         data.previewEnableChannelLightness = false;
         data.previewChannelLightnessSource = 2;
         data.previewChannelLightnessAmount = 0.00;
         data.previewEnableLightness = false;
         data.previewLightnessSource = 2;
         data.previewLightnessAmount = 0.00;
         data.previewEnableStarProtection = false; data.previewEnableMaskProtection = false;
         data.previewStarProtectionAmount = 0.70;
         data.previewShowMaskPreview = false;
         data.previewInvertMask = false;
         data.previewShowLastPreview = false;
         data.previewAdvancedLayerStack = [];

         if ( this.enableSIIAccent_CheckBox )
            this.enableSIIAccent_CheckBox.checked = false;
         if ( this.previewSIIHighlightAccent_Control )
            this.previewSIIHighlightAccent_Control.setValue( 0.00 );
         if ( this.enableLightness_CheckBox )
            this.enableLightness_CheckBox.checked = false;
         if ( this.lightnessSource_Combo )
            this.lightnessSource_Combo.currentItem = this.advancedSourceEnumToComboIndex( 2 );
         if ( this.previewLightnessAmount_Control )
            this.previewLightnessAmount_Control.setValue( 0.00 );
         if ( this.enableChannelLightness_CheckBox )
            this.enableChannelLightness_CheckBox.checked = false;
         if ( this.channelLightnessSource_Combo )
            this.channelLightnessSource_Combo.currentItem = this.advancedSourceEnumToComboIndex( 2 );
         if ( this.previewChannelLightnessAmount_Control )
            this.previewChannelLightnessAmount_Control.setValue( 0.00 );
         if ( this.lastPreview_CheckBox )
            this.lastPreview_CheckBox.checked = false;
         if ( this.resetCosmeticPreset_Button )
            this.resetCosmeticPreset_Button.enabled = false;
         if ( this.boostPreset_Combo )
         {
            this.boostPreset_Combo.currentItem = 0;
            this.boostPreset_Combo.enabled = false;
         }
         if ( this.boostPresetHint_Label )
            this.boostPresetHint_Label.text = "Setup changed: create previews again before applying Boosted presets or Advanced layers.";
         if ( this.undoBoosted_Button )
            this.undoBoosted_Button.enabled = false;
         if ( this.redoBoosted_Button )
            this.redoBoosted_Button.enabled = false;
         if ( this.cosmeticPresetHint_Label )
            this.cosmeticPresetHint_Label.text = "Setup changed: create previews again before applying presets or advanced layers.";
         if ( this.selectedPreview_Label )
            this.selectedPreview_Label.text = "<b>Selected:</b> " + getPaletteDefinitionByIndex(PALETTE_ORIGINAL).name;
         if ( this.largePreview_Control )
            this.largePreview_Control.update();
         if ( this.generateSelected_Button )
            this.generateSelected_Button.enabled = false;
         if ( this.refreshAdvancedControlsState )
            this.refreshAdvancedControlsState();
      }
      catch ( e )
      {
         Console.warningln( "Workflow reset after setup change skipped: ", e );
      }
      this.workflowSetupChangeResetting = false;
   };

   this.currentFineTuneValuesFromFrozenBaseline = function()
   {
      var b = this.frozenAdvancedBoostBaseline || this.captureBoostedControlsState();
      function nz( v, def ) { return (v != null) ? v : def; }
      function ratio( cur, base, def )
      {
         cur = nz( cur, def );
         base = nz( base, def );
         if ( Math.abs( base ) < 1e-6 )
            return cur;
         return cur/base;
      }
      return {
         // SCNR is not truly invertible once baked; only apply additional SCNR.
         scnr: Math.max( 0.0, nz(data.previewSCNR,0.0) - nz(b.scnr,0.0) ),
         oiiiBoost: ratio( data.previewOIIIBoost, b.oiii, 1.0 ),
         siiBoost: ratio( data.previewSIIBoost, b.sii, 1.0 ),
         shadowPoint: ratio( data.previewShadowPoint, b.shadow, 1.0 ),
         highlightReduction: ratio( data.previewHighlightReduction, b.highlight, 1.0 ),
         brightness: ratio( data.previewBrightness, b.brightness, 1.0 ),
         contrast: ratio( data.previewContrast, b.contrast, 1.0 ),
         saturation: ratio( data.previewSaturation, b.saturation, 1.0 ),
         cyanGoldBalance: nz(data.previewCyanGoldBalance,0.0) - nz(b.cyanGold,0.0),
         redYellowBalance: nz(data.previewRedYellowBalance,0.0) - nz(b.redYellow,0.0),
         goldAccent: 0.0,
         channelLightnessAmount: 0.0,
         channelLightnessSource: 0
      };
   };

   this.cloneHiddenRGBView = function( sourceView, outId )
   {
      if ( !isValidView( sourceView ) )
         return null;
      safeForceCloseWindowById( outId );
      var tmpData = new parametersPrototype();
      tmpData.setDefaults();
      tmpData.currentView = sourceView;
      tmpData.referenceHA = sourceView;
      tmpData.previewSilent = true;
      try
      {
         pixelMathFcn( tmpData, sourceView.id + "[0]", sourceView.id + "[1]", sourceView.id + "[2]", "", outId, true );
         var w = ImageWindow.windowById( outId );
         if ( isValidWindow( w ) )
         {
            w.hide();
            return w.mainView;
         }
      }
      catch ( e )
      {
         safeForceCloseWindowById( outId );
      }
      return null;
   };



   this.captureAdvancedControlsState = function()
   {
      return {
         enableGold: data.previewEnableSIIAccent,
         goldAmount: data.previewSIIHighlightAccent,
         enableLightness: data.previewEnableLightness,
         lightnessSource: data.previewLightnessSource,
         lightnessAmount: data.previewLightnessAmount,
         enableStructure: data.previewEnableChannelLightness,
         structureSource: data.previewChannelLightnessSource,
         structureAmount: data.previewChannelLightnessAmount,
         showOriginal: data.previewShowLastPreview
      };
   };

   this.restoreAdvancedControlsState = function( c )
   {
      if ( c == null )
         return;
      this.realtimeRefreshSuspended = true;
      data.previewEnableSIIAccent = !!c.enableGold;
      data.previewSIIHighlightAccent = (c.goldAmount != null) ? c.goldAmount : 0.0;
      data.previewEnableLightness = !!c.enableLightness;
      data.previewLightnessSource = (c.lightnessSource != null) ? c.lightnessSource : 2;
      data.previewLightnessAmount = (c.lightnessAmount != null) ? c.lightnessAmount : 0.0;
      data.previewEnableChannelLightness = !!c.enableStructure;
      data.previewChannelLightnessSource = (c.structureSource != null) ? c.structureSource : 2;
      data.previewChannelLightnessAmount = (c.structureAmount != null) ? c.structureAmount : 0.0;
      data.previewShowLastPreview = !!c.showOriginal;
      if ( this.enableSIIAccent_CheckBox ) this.enableSIIAccent_CheckBox.checked = data.previewEnableSIIAccent;
      if ( this.previewSIIHighlightAccent_Control ) this.previewSIIHighlightAccent_Control.setValue( data.previewSIIHighlightAccent );
      if ( this.enableLightness_CheckBox ) this.enableLightness_CheckBox.checked = data.previewEnableLightness;
      if ( this.lightnessSource_Combo ) this.lightnessSource_Combo.currentItem = this.advancedSourceEnumToComboIndex( data.previewLightnessSource );
      if ( this.previewLightnessAmount_Control ) this.previewLightnessAmount_Control.setValue( data.previewLightnessAmount );
      if ( this.enableChannelLightness_CheckBox ) this.enableChannelLightness_CheckBox.checked = data.previewEnableChannelLightness;
      if ( this.channelLightnessSource_Combo ) this.channelLightnessSource_Combo.currentItem = this.advancedSourceEnumToComboIndex( data.previewChannelLightnessSource );
      if ( this.previewChannelLightnessAmount_Control ) this.previewChannelLightnessAmount_Control.setValue( data.previewChannelLightnessAmount );
      if ( this.lastPreview_CheckBox ) this.lastPreview_CheckBox.checked = data.previewShowLastPreview;
      this.realtimeRefreshSuspended = false;
   };

   this.pushAdvancedUndoState = function()
   {
      var state = {
         viewId: "",
         key: this.frozenAdvancedBaseKey,
         baseline: this.frozenAdvancedBoostBaseline,
         layers: cloneAdvancedLayerStack( data.previewAdvancedLayerStack || [] ),
         controls: this.captureAdvancedControlsState()
      };

      if ( isValidView( this.frozenAdvancedSourceView ) )
      {
         var undoId = PREVIEW_PREFIX + "FROZEN_ADVANCED_UNDO_" + (new Date()).getTime() + "_" + this.advancedUndoStack.length;
         var undoView = this.cloneHiddenRGBView( this.frozenAdvancedSourceView, undoId );
         if ( isValidView( undoView ) )
            state.viewId = undoId;
      }

      this.advancedUndoStack.push( state );
      this.advancedRedoStack = [];
      if ( this.undoAdvanced_Button )
         this.undoAdvanced_Button.enabled = true;
      if ( this.redoAdvanced_Button )
         this.redoAdvanced_Button.enabled = false;
   };

   this.captureAdvancedAppliedState = function()
   {
      var state = {
         viewId: "",
         key: this.frozenAdvancedBaseKey,
         baseline: this.frozenAdvancedBoostBaseline,
         layers: cloneAdvancedLayerStack( data.previewAdvancedLayerStack || [] ),
         controls: this.captureAdvancedControlsState()
      };
      if ( isValidView( this.frozenAdvancedSourceView ) )
      {
         var capId = PREVIEW_PREFIX + "FROZEN_ADVANCED_REDO_" + (new Date()).getTime() + "_" + ((this.advancedRedoStack != null) ? this.advancedRedoStack.length : 0);
         var capView = this.cloneHiddenRGBView( this.frozenAdvancedSourceView, capId );
         if ( isValidView( capView ) )
            state.viewId = capId;
      }
      return state;
   };

   this.restoreAdvancedAppliedState = function( state )
   {
      if ( state == null )
         return;
      safeForceCloseWindowById( PREVIEW_PREFIX + "FROZEN_ADVANCED" );

      data.previewAdvancedLayerStack = cloneAdvancedLayerStack( state.layers || [] );
      this.restoreAdvancedControlsState( state.controls );
      this.frozenAdvancedSourceView = null;
      this.frozenAdvancedBaseKey = state.key || "";
      this.frozenAdvancedBoostBaseline = state.baseline || null;

      if ( state.viewId != "" )
      {
         var stateView = View.viewById( state.viewId );
         if ( isValidView( stateView ) )
         {
            var restored = this.cloneHiddenRGBView( stateView, PREVIEW_PREFIX + "FROZEN_ADVANCED" );
            if ( isValidView( restored ) )
               this.frozenAdvancedSourceView = restored;
            safeForceCloseWindowById( state.viewId );
         }
      }

      this.largePreviewAdvancedBitmap = null;
      this.largePreviewAdvancedKey = "";
      this.advancedPreviewLastAppliedKey = "";
      this.advancedPreviewPendingKey = "";
      this.advancedPreviewRefreshQueued = false;

      if ( isValidView( this.frozenAdvancedSourceView ) )
         this.refreshLargePreviewBoost( true );
      else
         this.showBasePreviewFromCacheOrRefresh();
      this.refreshAdvancedControlsState();
   };

   this.undoAdvancedLayer = function()
   {
      if ( this.advancedUndoStack.length == 0 )
         return;

      this.advancedRedoStack.push( this.captureAdvancedAppliedState() );
      var state = this.advancedUndoStack.pop();
      this.restoreAdvancedAppliedState( state );

      if ( this.undoAdvanced_Button )
         this.undoAdvanced_Button.enabled = this.advancedUndoStack.length > 0;
      if ( this.redoAdvanced_Button )
         this.redoAdvanced_Button.enabled = this.advancedRedoStack.length > 0;
   };

   this.redoAdvancedLayer = function()
   {
      if ( this.advancedRedoStack.length == 0 )
         return;

      this.advancedUndoStack.push( this.captureAdvancedAppliedState() );
      var state = this.advancedRedoStack.pop();
      this.restoreAdvancedAppliedState( state );

      if ( this.undoAdvanced_Button )
         this.undoAdvanced_Button.enabled = this.advancedUndoStack.length > 0;
      if ( this.redoAdvanced_Button )
         this.redoAdvanced_Button.enabled = this.advancedRedoStack.length > 0;
   };

   /* old implementation replaced by applyBoostedControlsState */
   this.setBoostedControlsToPreset_old = function()
   {
      var p = getSoftBoostedPreset();
      this.realtimeRefreshSuspended = true;
      data.previewSCNR = p.scnr;
      data.previewOIIIBoost = p.oiii;
      data.previewSIIBoost = p.sii;
      data.previewShadowPoint = p.shadow;
      data.previewHighlightReduction = p.highlight;
      data.previewBrightness = p.brightness;
      data.previewContrast = p.contrast;
      data.previewSaturation = p.saturation;
      data.previewCyanGoldBalance = p.cyanGold;
      data.previewRedYellowBalance = p.redYellow;
      this.previewSCNR_Control.setValue( data.previewSCNR );
      this.previewOIIIBoost_Control.setValue( data.previewOIIIBoost );
      this.previewSIIBoost_Control.setValue( data.previewSIIBoost );
      this.previewShadowPoint_Control.setValue( data.previewShadowPoint );
      this.previewHighlightReduction_Control.setValue( data.previewHighlightReduction );
      this.previewBrightness_Control.setValue( data.previewBrightness );
      this.previewContrast_Control.setValue( data.previewContrast );
      this.previewSaturation_Control.setValue( data.previewSaturation );
      this.previewCyanGoldBalance_Control.setValue( data.previewCyanGoldBalance );
      this.previewRedYellowBalance_Control.setValue( data.previewRedYellowBalance );
      this.realtimeRefreshSuspended = false;
      this.invalidateAdvancedPreviewCache();
   };

   this.previewBoostReset_Button = new PushButton( this );
   this.previewBoostReset_Button.text = "Reset";
   this.previewBoostReset_Button.onClick = function()
   {
      dlg.realtimeRefreshSuspended = true;
      data.previewSCNR = 0.00;
      data.previewOIIIBoost = 1.00;
      data.previewSIIBoost = 1.00;
      data.previewShadowPoint = 1.00;
      data.previewHighlightReduction = 1.00;
      data.previewBrightness = 1.00;
      data.previewContrast = 1.00;
      data.previewSaturation = 1.00;
      data.previewCyanGoldBalance = 0.00;
      data.previewRedYellowBalance = 0.00;
      data.previewSIIHighlightAccent = 0.00;
      data.previewSIIAccentActive = false;
      dlg.invalidateAdvancedPreviewCache();
      data.previewShowLastPreview = false;
      dlg.previewSCNR_Control.setValue( data.previewSCNR );
      dlg.previewOIIIBoost_Control.setValue( data.previewOIIIBoost );
      dlg.previewSIIBoost_Control.setValue( data.previewSIIBoost );
      dlg.previewShadowPoint_Control.setValue( data.previewShadowPoint );
      dlg.previewHighlightReduction_Control.setValue( data.previewHighlightReduction );
      dlg.previewBrightness_Control.setValue( data.previewBrightness );
      dlg.previewContrast_Control.setValue( data.previewContrast );
      dlg.previewSaturation_Control.setValue( data.previewSaturation );
      dlg.previewCyanGoldBalance_Control.setValue( data.previewCyanGoldBalance );
      dlg.previewRedYellowBalance_Control.setValue( data.previewRedYellowBalance );
      dlg.previewSIIHighlightAccent_Control.setValue( data.previewSIIHighlightAccent );
      dlg.lastPreview_CheckBox.checked = false;
      if ( dlg.boostPreset_Combo )
         dlg.boostPreset_Combo.currentItem = 0;
      if ( dlg.boostPresetHint_Label )
         dlg.boostPresetHint_Label.text = getBoostedWorkflowPresetDefinition( 0 ).hint;
      dlg.applyBoostControlRangeMode( data.previewBoostRangeMode != null ? data.previewBoostRangeMode : BOOST_RANGE_BALANCED, false, false );
      dlg.realtimeRefreshSuspended = false;
      dlg.scheduleRealtimePreviewRefresh( true );
   };

   this.applyBoosted_Button = new ToolButton( this );
   this.applyBoosted_Button.text = "Apply";
   this.applyBoosted_Button.icon = this.scaledResource( ":/icons/process.png" );
   this.applyBoosted_Button.toolTip = "<p><b>Apply</b></p>Stacks the current Boosted controls over the selected preview. The result becomes the new base for this palette; sliders and Preset return to neutral/None.</p>";
   this.applyBoosted_Button.onClick = function()
   {
      dlg.applyBoostedLayerNow();
   };

   this.undoBoosted_Button = new ToolButton( this );
   this.undoBoosted_Button.icon = this.scaledResource( ":/icons/undo.png" );
   this.undoBoosted_Button.enabled = false;
   this.undoBoosted_Button.toolTip = "<p><b>Undo</b></p>Undo the last applied Boosted layer for the selected palette.</p>";
   this.undoBoosted_Button.onClick = function()
   {
      dlg.undoBoostedLayer();
   };

   this.redoBoosted_Button = new ToolButton( this );
   this.redoBoosted_Button.icon = this.scaledResource( ":/icons/redo.png" );
   this.redoBoosted_Button.enabled = false;
   this.redoBoosted_Button.toolTip = "<p><b>Redo</b></p>Redo the last undone Boosted layer for the selected palette.</p>";
   this.redoBoosted_Button.onClick = function()
   {
      dlg.redoBoostedLayer();
   };

   this.previewBoostReset_Sizer = new HorizontalSizer;
   this.previewBoostReset_Sizer.spacing = 6;
   this.previewBoostReset_Sizer.addStretch();
   this.previewBoostReset_Sizer.add( this.lastPreview_CheckBox );
   this.previewBoostReset_Sizer.addSpacing( 10 );
   this.previewBoostReset_Sizer.add( this.previewBoostReset_Button );
   this.previewBoostReset_Sizer.addSpacing( 8 );
   this.previewBoostReset_Sizer.add( this.applyBoosted_Button );
   this.previewBoostReset_Sizer.add( this.undoBoosted_Button );
   this.previewBoostReset_Sizer.add( this.redoBoosted_Button );

   /*
    * Preview Grid / Studio UX
    */
   this.linearInputStatus_Label = new Label( this );
   this.linearInputStatus_Label.useRichText = true;
   this.linearInputStatus_Label.textAlignment = TextAlign_Left|TextAlign_VertCenter;
   this.linearInputStatus_Label.margin = 4;
   this.linearInputStatus_Label.backgroundColor = 0xFFDED1CE;
   this.linearInputStatus_Label.textColor = 0xFF3F3030;
   this.linearInputStatus_Label.text = "Linear input detected · Auto-stretch previews ON";
   this.linearInputStatus_Label.toolTip = "<p>AutoPalette Studio detected linear input data. Temporary internally stretched working copies are used for previews and final image generation. Your original views are not modified.</p>";
   this.linearInputStatus_Label.hide();

   this.previewQuality_Label = new Label( this );
   this.previewQuality_Label.text = "Preview quality:";
   this.previewQuality_Label.textAlignment = TextAlign_Left|TextAlign_VertCenter;

   this.previewQuality_Combo = new ComboBox( this );
   this.previewQuality_Combo.editEnabled = false;
   this.previewQuality_Combo.toolTip = "<p>Select the working size used for preview generation.</p><p><b>Balanced</b> is the default tester mode: sharper than Fast while remaining responsive. Final images are always generated at full resolution.</p>";
   this.previewQuality_Combo.addItem( "Fast" );
   this.previewQuality_Combo.addItem( "Balanced" );
   this.previewQuality_Combo.addItem( "Quality" );
   if ( data.previewQuality < PREVIEW_QUALITY_FAST || data.previewQuality > PREVIEW_QUALITY_QUALITY )
      data.previewQuality = PREVIEW_QUALITY_BALANCED;
   this.previewQuality_Combo.currentItem = data.previewQuality;
   this.previewQuality_Combo.onItemSelected = function( index )
   {
      data.previewQuality = index;

      if ( dlg.previewsReady && dlg.rebuildSelectedLargePreviewForQuality )
         dlg.rebuildSelectedLargePreviewForQuality();
      else
         markPreviewSetupChanged();
   };

   this.previewAdvanced_CheckBox = new CheckBox( this );
   this.previewAdvanced_CheckBox.text = "Show advanced combinations";
   this.previewAdvanced_CheckBox.checked = data.previewShowAdvanced;
   this.previewAdvanced_CheckBox.enabled = false;
   this.previewAdvanced_CheckBox.toolTip = "<p>Show the less common classic and Foraxx family previews. Keep this disabled for a cleaner palette-picking workflow.</p>";
   this.previewAdvanced_CheckBox.onCheck = function( checked )
   {
      if ( !dlg.hasLoadedLargePreviewForControls || !dlg.hasLoadedLargePreviewForControls() )
      {
         data.previewShowAdvanced = false;
         this.checked = false;
         return;
      }
      data.previewShowAdvanced = checked;
      dlg.refreshAdvancedPreviewVisibility();
      // Advanced tiles are generated on demand. If the user already created
      // previews, regenerate them immediately to avoid empty/black advanced tiles.
      if ( dlg.previewsReady && checked )
         dlg.createPreviewTiles( true );
   };

   this.previewBoosted_CheckBox = new CheckBox( this );
   this.previewBoosted_CheckBox.text = "Show boosted variants";
   this.previewBoosted_CheckBox.hide();
   this.previewBoosted_CheckBox.checked = data.previewShowBoosted;
   this.previewBoosted_CheckBox.toolTip = "<p>Show/hide a second row with soft boosted versions of the main palettes. In RC5.2.3 boosted previews are generated on demand, so initial preview creation is faster when this option is disabled.</p>";
   this.previewBoosted_CheckBox.onCheck = function( checked )
   {
      data.previewShowBoosted = checked;
      dlg.refreshBoostedPreviewVisibility();
      // RC5.2.3: boosted previews are opt-in. If previews already exist and the
      // user enables the row, compute only the missing boosted tiles on demand.
      if ( checked && dlg.previewsReady && dlg.createMissingBoostedPreviewTiles )
         dlg.createMissingBoostedPreviewTiles();
   };

   this.previewDebug_CheckBox = new CheckBox( this );
   this.previewDebug_CheckBox.text = "Debug preview windows";
   this.previewDebug_CheckBox.checked = data.previewDebugWindows;
   this.previewDebug_CheckBox.toolTip = "<p>Keep temporary _APS_TILE_ windows open and print preview statistics to the console.</p>";
   this.previewDebug_CheckBox.onCheck = function( checked ) { data.previewDebugWindows = checked; };
   this.previewDebug_CheckBox.hide();
   data.previewDebugWindows = APS_DEBUG_KEEP_PREVIEW_WINDOWS;

   // Keep preview/final diagnostics disabled in tester builds unless explicitly enabled above.
   data.previewFinalDebug = APS_DEBUG_PREVIEW_FINAL_PARITY;

   this.luckyPreview_Button = new PushButton( this );
   this.luckyPreview_Button.text = "I\'m feeling lucky";
   this.luckyPreview_Button.toolTip = "<p>Randomly selects one of the available previews and applies a tasteful random Boosted/Advanced preparation. Advanced effects, including Channel Lightness, are prepared but not stacked until you press Calculate &amp; Apply.</p>";
   this.luckyPreview_Button.backgroundColor = 0xFFE8DFA3;
   this.luckyPreview_Button.enabled = this.previewsReady;

   this.createPreviews_Button = new ToolButton( this );
   this.createPreviews_Button.icon = this.scaledResource( ":/icons/gears.png" );
   this.createPreviews_Button.text = "Create Previews";
   this.createPreviews_Button.backgroundColor = 0xfff0f0f0;
   this.createPreviews_Button.toolTip = "<p>Create previews for the visible palettes using the selected preview quality. Final images are always full resolution.</p>";

   this.finalOutputId_Label = new Label( this );
   this.finalOutputId_Label.text = "Output image id:";
   this.finalOutputId_Label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
   this.finalOutputId_Label.toolTip = "<p>Optional final output view identifier. Leave <b>&lt;Auto&gt;</b> to use the selected palette name automatically.</p>";

   this.finalOutputId_Edit = new Edit( this );
   this.finalOutputId_Edit.text = (data.finalOutputId != null && data.finalOutputId.length > 0) ? data.finalOutputId : "<Auto>";
   this.finalOutputId_Edit.setFixedWidth( 180 );
   this.finalOutputId_Edit.toolTip = "<p>Optional final output view identifier. Use <b>&lt;Auto&gt;</b> for the current palette name. Invalid identifier characters will be replaced by underscores.</p>";
   this.finalOutputId_Edit.onEditCompleted = function()
   {
      data.finalOutputId = this.text;
   };

   this.generateSelected_Button = new PushButton( this );
   this.generateSelected_Button.text = "Generate Final Image";
   this.generateSelected_Button.toolTip = "<p>Generate the currently selected palette at full resolution.</p>";

   this.finalGenerationHandled = false;
   this.finalGenerationBusy = false;

   this.finalGenerationStatus_Label = new Label( this );
   this.finalGenerationStatus_Label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
   this.finalGenerationStatus_Label.useRichText = false;
   this.finalGenerationStatus_Label.minWidth = 250;
   this.finalGenerationStatus_Label.setFixedSize( 250, 22 );
   this.finalGenerationStatus_Label.text = "";
   this.finalGenerationStatus_Label.toolTip = "Final generation progress.";

   this.setFinalGenerationStatus = function( message, percent )
   {
      if ( !this.finalGenerationStatus_Label )
         return;
      var p = (percent != null) ? Math.round( percent ) : -1;
      var suffix = (p >= 0) ? (" " + p.toString() + "%") : "";
      this.finalGenerationStatus_Label.text = (message || "") + suffix;
      this.finalGenerationStatus_Label.update();
   };

   this.clearFinalGenerationStatus = function()
   {
      if ( !this.finalGenerationStatus_Label )
         return;
      this.finalGenerationStatus_Label.text = "";
      this.finalGenerationStatus_Label.update();
   };

   this.setFinalGenerationBusy = function( busy )
   {
      this.finalGenerationBusy = busy;
      if ( this.generateSelected_Button ) this.generateSelected_Button.enabled = !busy && this.previewsReady;
      if ( this.createPreviews_Button ) this.createPreviews_Button.enabled = !busy;
      if ( this.luckyPreview_Button ) this.luckyPreview_Button.enabled = !busy && this.previewsReady;
      if ( this.previewQuality_Combo ) this.previewQuality_Combo.enabled = !busy;
      if ( this.previewBoosted_CheckBox ) this.previewBoosted_CheckBox.enabled = !busy;
      if ( this.finalOutputId_Edit ) this.finalOutputId_Edit.enabled = !busy;
      if ( this.previewAdvanced_CheckBox ) this.previewAdvanced_CheckBox.enabled = !busy && this.hasLoadedLargePreviewForControls && this.hasLoadedLargePreviewForControls();
      if ( this.setBoostedControlsCalculationBusy ) this.setBoostedControlsCalculationBusy( busy );
      if ( this.refreshAdvancedControlsState ) this.refreshAdvancedControlsState();
      if ( this.refreshMaskControlsState ) this.refreshMaskControlsState();
      if ( this.cancel_Button ) this.cancel_Button.enabled = !busy;
      for ( var busyTi = 0; busyTi < this.previewTiles.length; ++busyTi )
         this.previewTiles[busyTi].enabled = !busy;
      this.update();
   };

   this.runFinalGeneration = function()
   {
      if ( this.finalGenerationBusy )
         return;

      data.selectedPreviewPalette = this.selectedPaletteIndex;
      data.selectedPreviewBoosted = false;
      this.syncDataBoostedStackForSelection();
      data.typePalette = this.selectedPaletteIndex;
      data.allCombinations = false;
      data.previewDebugSourceViewId = isValidView( this.largePreviewSourceView ) ? this.largePreviewSourceView.id : "";
      data.previewDebugParameterKey = this.realtimePreviewParameterKey();
      data.setParameters();

      this.setFinalGenerationBusy( true );
      this.setFinalGenerationStatus( "Generating final image...", 0 );
      apsTryProcessEvents();

      var ok = false;
      try
      {
         ok = paletteStart( data, this ) === true;
      }
      catch ( genErr )
      {
         this.setFinalGenerationBusy( false );
         this.clearFinalGenerationStatus();
         throw genErr;
      }

      this.setFinalGenerationBusy( false );

      if ( ok )
      {
         this.finalGenerationHandled = true;
         this.ok();
         return;
      }

      this.clearFinalGenerationStatus();
   };

   this.selectedPreview_Label = new Label( this );
   this.selectedPreview_Label.useRichText = true;
   this.selectedPreview_Label.textAlignment = TextAlign_Left|TextAlign_VertCenter;
   this.selectedPreview_Label.text = "<b>Selected:</b> " + getPreviewPaletteName( this.selectedPaletteIndex, false );

   this.previewActivity_Label = new Label( this );
   this.previewActivity_Label.textAlignment = TextAlign_Left|TextAlign_VertCenter;
   this.previewActivity_Label.useRichText = true;
   this.previewActivity_Label.margin = 5;
   this.previewActivity_Label.text = "";
   this.previewActivity_Label.textColor = 0xFF3F3030;
   this.previewActivity_Label.backgroundColor = 0xFFE8E8E8;
   this.previewActivity_Label.setFixedSize( 190, 22 );
   this.previewActivity_Label.toolTip = "Realtime preview calculation is running after a control change.";
   this.previewActivity_Label.show();

   this.setPreviewActivity = function( active, message )
   {
      if ( !this.previewActivity_Label )
         return;
      if ( active )
      {
         this.previewActivity_Label.text = message || "Updating preview...";
         this.previewActivity_Label.backgroundColor = 0xFFDED1CE;
      }
      else
      {
         this.previewActivity_Label.text = "";
         this.previewActivity_Label.backgroundColor = 0xFFE8E8E8;
      }
      this.previewActivity_Label.show();
      this.previewActivity_Label.update();
   };

   this.previewActions_Sizer = new HorizontalSizer;
   this.previewActions_Sizer.spacing = 6;
   this.previewActions_Sizer.add( this.createPreviews_Button );
   this.previewActions_Sizer.add( this.previewAdvanced_CheckBox );
   this.previewActions_Sizer.addSpacing( 8 );
   this.previewActions_Sizer.add( this.linearInputStatus_Label );
   this.previewActions_Sizer.addStretch();
   this.previewActions_Sizer.add( this.luckyPreview_Button );

   this.previewOptions_Sizer = new HorizontalSizer;
   this.previewOptions_Sizer.spacing = 6;
   this.previewOptions_Sizer.addStretch();

   this.previewDebug_Sizer = new HorizontalSizer;
   this.previewDebug_Sizer.spacing = 4;
   this.previewDebug_Sizer.addStretch();

   this.previewInfo_Sizer = new HorizontalSizer;
   this.previewInfo_Sizer.spacing = 6;
   this.previewInfo_Sizer.add( this.selectedPreview_Label );
   this.previewInfo_Sizer.addStretch();
   this.previewInfo_Sizer.add( this.previewQuality_Label );
   this.previewInfo_Sizer.add( this.previewQuality_Combo );

   this.updateLinearInputStatusLabel = function()
   {
      var enabled = (data.linearInputAutoStretchEnabled === true);
      if ( this.linearInputStatus_Label )
      {
         if ( enabled )
            this.linearInputStatus_Label.show();
         else
            this.linearInputStatus_Label.hide();
      }
   };

   this.getLargePreviewDrawState = function( control )
   {
      if ( this.largePreviewBitmap == null ) return null;

      var bmpW = this.largePreviewBitmap.width;
      var bmpH = this.largePreviewBitmap.height;
      if ( bmpW <= 0 || bmpH <= 0 ) return null;

      var fitScale = Math.min( (control.width-8)/bmpW, (control.height-8)/bmpH );
      var scale = fitScale * this.previewZoom;
      if ( scale <= 0 || !isFinite(scale) ) scale = 1;

      var drawW = bmpW * scale;
      var drawH = bmpH * scale;
      var maxPanX = Math.max( 0, (drawW - control.width)/2 + 4 );
      var maxPanY = Math.max( 0, (drawH - control.height)/2 + 4 );

      this.previewPanX = Math.max( -maxPanX, Math.min( maxPanX, this.previewPanX ) );
      this.previewPanY = Math.max( -maxPanY, Math.min( maxPanY, this.previewPanY ) );

      return {
         scale: scale,
         drawW: drawW,
         drawH: drawH,
         drawX: (control.width - drawW)/2 + this.previewPanX,
         drawY: (control.height - drawH)/2 + this.previewPanY,
         maxPanX: maxPanX,
         maxPanY: maxPanY
      };
   };

   this.resetLargePreviewPan = function()
   {
      this.previewPanX = 0;
      this.previewPanY = 0;
      this.previewDragging = false;
   };

   this.getBitmapPointFromControlPoint = function( control, x, y )
   {
      var st = this.getLargePreviewDrawState( control );
      if ( st == null || this.largePreviewBitmap == null || st.scale <= 0 ) return null;

      var bx = (x - st.drawX)/st.scale;
      var by = (y - st.drawY)/st.scale;
      if ( bx < 0 || by < 0 || bx > this.largePreviewBitmap.width || by > this.largePreviewBitmap.height )
         return null;
      return { x: bx, y: by, state: st };
   };

   this.centerPreviewOnBitmapPoint = function( control, bx, by )
   {
      if ( this.largePreviewBitmap == null ) return;
      var st = this.getLargePreviewDrawState( control );
      if ( st == null ) return;
      this.previewPanX = control.width/2 - (bx * st.scale + (control.width - st.drawW)/2);
      this.previewPanY = control.height/2 - (by * st.scale + (control.height - st.drawH)/2);
      this.getLargePreviewDrawState( control );
   };

   this.centerPreviewOnControlPoint = function( control, x, y )
   {
      var bp = this.getBitmapPointFromControlPoint( control, x, y );
      if ( bp == null ) return;
      this.centerPreviewOnBitmapPoint( control, bp.x, bp.y );
   };

   this.setPreviewZoomAt = function( control, newZoom, anchorX, anchorY )
   {
      if ( this.largePreviewBitmap == null ) return;

      var bp = null;
      if ( anchorX != null && anchorY != null )
         bp = this.getBitmapPointFromControlPoint( control, anchorX, anchorY );

      this.previewZoom = Math.max( 0.25, Math.min( 8.0, newZoom ) );
      data.previewZoom = this.previewZoom;

      if ( bp != null )
      {
         var st = this.getLargePreviewDrawState( control );
         if ( st != null )
         {
            this.previewPanX = anchorX - (bp.x * st.scale + (control.width - st.drawW)/2);
            this.previewPanY = anchorY - (bp.y * st.scale + (control.height - st.drawH)/2);
         }
      }

      this.getLargePreviewDrawState( control );
   };

   this.getPreferredPreviewAspectFromView = function( sourceView )
   {
      if ( !isValidView( sourceView ) )
         return 1.5;
      try
      {
         var w = sourceView.image.width;
         var h = sourceView.image.height;
         if ( w > 0 && h > 0 )
            return Math.max( 0.75, Math.min( 2.35, w/h ) );
      }
      catch ( eAspect )
      {
      }
      return 1.5;
   };

   this.adaptLargePreviewAreaToSource = function( sourceView )
   {
      if ( !this.largePreview_Control )
         return;

      var aspect = this.getPreferredPreviewAspectFromView( sourceView );
      var targetW = 760;
      var targetH = 460;
      var tileW = (typeof DEFAULT_TILE_WIDTH != "undefined" && DEFAULT_TILE_WIDTH > 0) ? DEFAULT_TILE_WIDTH : 174;
      var tileGap = 6;
      var previewColumns = 4;
      var gridAlignedW = previewColumns*tileW + (previewColumns-1)*tileGap + 8;

      if ( aspect >= 1.15 )
      {
         // v1.0.5: Keep the large preview width visually aligned with the
         // thumbnail grid, which is the user-visible reference width in the
         // Create Previews section. This also reduces the chance of a large
         // vertical viewport that introduces black bars above/below the image.
         targetW = gridAlignedW;
         targetH = Math.round( targetW / aspect );
         if ( targetH < 420 ) targetH = 420;
         if ( targetH > 620 ) targetH = 620;
      }
      else
      {
         // Near-square frames keep the same width reference and grow in height
         // only as much as needed, preserving a compact production layout.
         targetW = gridAlignedW;
         targetH = Math.round( targetW / Math.max( 0.75, aspect ) );
         if ( targetH < 480 ) targetH = 480;
         if ( targetH > 700 ) targetH = 700;
      }

      targetW = Math.max( gridAlignedW, Math.min( 980, targetW ) );
      targetH = Math.max( 420, Math.min( 700, targetH ) );

      try { this.largePreview_Control.setMinSize( targetW, targetH ); } catch ( eMin ) {}
      try { this.setVariableSize(); } catch ( eVar ) {}
      try { this.ensureLayoutUpdated(); } catch ( e0 ) {}
      try { this.adjustToContents(); } catch ( e1 ) {}
      try { this.setVariableSize(); } catch ( e2 ) {}
      if ( this.largePreview_Control )
         this.largePreview_Control.update();
   };

   this.largePreview_Control = new Control( this );
   // v1.0.5: compact startup width, aligned with the four-tile preview grid.
   this.largePreview_Control.setMinSize( 720, 520 );
   this.largePreview_Control.toolTip = "<p>Large preview. Use mouse wheel or the zoom buttons to zoom, drag with the mouse to pan, double-click for Fit, press 1:1 for full-size preview and click a point to center it.</p>";
   this.largePreview_Control.ownerDialog = this;
   this.largePreview_Control.onPaint = function()
   {
      var g = new Graphics( this );
      g.fillRect( 0, 0, this.width, this.height, new Brush( 0xFF202020 ) );

      var dlg = this.ownerDialog;
      var st = dlg.getLargePreviewDrawState( this );
      if ( dlg.largePreviewBitmap != null && st != null )
      {
         g.scaleTransformation( st.scale );
         g.drawBitmap( st.drawX/st.scale, st.drawY/st.scale, dlg.largePreviewBitmap );
         g.resetTransformation();

         if ( dlg.previewZoom > 1.0 )
         {
            g.pen = new Pen( 0xAAFFFFFF );
            g.font = new Font( "Helvetica", 9 );
            var modeText = data.previewShowLastPreview ? "Original Palette  |  " : "";
            g.drawText( 10, 18, modeText + "Drag to pan  |  Wheel to zoom  |  Zoom " + Math.round( dlg.previewZoom*100 ) + "%" );
         }
      }
      else
      {
         if ( !(dlg.realtimePreviewCalculating && dlg.showAdvancedCalculatingOverlay) && !(dlg.previewToastVisible && dlg.previewToastMessage) )
         {
            g.pen = new Pen( 0xFFFFFFFF );
            g.font = new Font( "Helvetica", 11 );
            g.drawText( 16, 28, "Create previews, then select a tile to inspect it here." );
         }
      }

      var genericPreviewCalculation = dlg.realtimePreviewCalculating && dlg.showAdvancedCalculatingOverlay &&
                                      ((dlg.previewOverlayMessage || "Calculating preview...") == "Calculating preview...");
      var showStaleCross = dlg.largePreviewInvalid || genericPreviewCalculation;

      if ( showStaleCross && dlg.largePreviewBitmap != null )
      {
         // RC5.0: show an ImageBlend-like invalid preview marker. This keeps the
         // previous preview visible but makes it obvious that it no longer
         // corresponds to the current slider values.
         g.pen = new Pen( 0xFFFFFF00, 2 );
         g.drawLine( 0, 0, this.width, this.height );
         g.drawLine( this.width, 0, 0, this.height );
         g.pen = new Pen( 0x99FFFF00, 1 );
         g.drawRect( 0, 0, this.width-1, this.height-1 );
      }
      else if ( dlg.realtimePreviewCalculating && dlg.showAdvancedCalculatingOverlay )
      {
         g.fillRect( 0, 0, this.width, this.height, new Brush( 0x88000000 ) );
         g.pen = new Pen( 0xFFFFFFFF );
         g.font = new Font( "Helvetica", 16 );
         var msg = dlg.previewOverlayMessage || "Calculating preview...";
         var msgW = g.font.width( msg );
         var msgH = g.font.ascent + g.font.descent;
         g.drawText( Math.max( 16, Math.floor((this.width - msgW)/2) ), Math.floor((this.height + msgH)/2), msg );
      }

      if ( dlg.previewToastVisible && dlg.previewToastMessage )
      {
         var tw = Math.max( 240, dlg.font.width( dlg.previewToastMessage ) + 48 );
         var th = 34;
         var tx = Math.max( 12, Math.floor( (this.width - tw)/2 ) );
         var ty = Math.max( 12, this.height - th - 18 );
         g.fillRect( tx, ty, tx + tw, ty + th, new Brush( 0xCC101010 ) );
         g.pen = new Pen( 0xFFFFFFFF );
         g.font = new Font( "Helvetica", 12 );
         g.drawText( tx + 20, ty + 22, dlg.previewToastMessage );
      }
      g.end();
   };

   this.largePreview_Control.onMousePress = function( x, y, button, buttons, modifiers )
   {
      var dlg = this.ownerDialog;
      if ( dlg.largePreviewBitmap == null ) return;
      dlg.previewDragging = true;
      dlg.previewDragMoved = false;
      dlg.previewDragStartX = x;
      dlg.previewDragStartY = y;
      dlg.previewDragStartPanX = dlg.previewPanX;
      dlg.previewDragStartPanY = dlg.previewPanY;
      this.hasFocus = true;
   };

   this.largePreview_Control.onMouseMove = function( x, y, buttons, modifiers )
   {
      var dlg = this.ownerDialog;
      if ( !dlg.previewDragging || dlg.largePreviewBitmap == null ) return;
      if ( Math.abs(x - dlg.previewDragStartX) > 2 || Math.abs(y - dlg.previewDragStartY) > 2 )
         dlg.previewDragMoved = true;
      dlg.previewPanX = dlg.previewDragStartPanX + (x - dlg.previewDragStartX);
      dlg.previewPanY = dlg.previewDragStartPanY + (y - dlg.previewDragStartY);
      dlg.getLargePreviewDrawState( this );
      this.update();
   };

   this.largePreview_Control.onMouseRelease = function( x, y, button, buttons, modifiers )
   {
      var dlg = this.ownerDialog;
      var wasMoved = dlg.previewDragMoved;
      dlg.previewDragging = false;
      dlg.getLargePreviewDrawState( this );
      if ( !wasMoved && dlg.largePreviewBitmap != null )
         dlg.centerPreviewOnControlPoint( this, x, y );
      this.update();
   };

   this.largePreview_Control.onMouseDoubleClick = function( x, y, button, buttons, modifiers )
   {
      var dlg = this.ownerDialog;
      dlg.previewZoom = 1.0;
      data.previewZoom = dlg.previewZoom;
      dlg.resetLargePreviewPan();
      this.update();
   };

   this.largePreview_Control.onMouseWheel = function( x, y, delta, buttons, modifiers )
   {
      var dlg = this.ownerDialog;
      if ( dlg.largePreviewBitmap == null ) return;
      var step = (delta > 0) ? 1.25 : 0.80;
      dlg.setPreviewZoomAt( this, dlg.previewZoom * step, x, y );
      this.update();
   };

   this.zoomIn_Button = new PushButton( this );
   this.zoomIn_Button.text = "Zoom +";
   this.zoomIn_Button.onClick = function()
   {
      dlg.setPreviewZoomAt( dlg.largePreview_Control, dlg.previewZoom * 1.25, dlg.largePreview_Control.width/2, dlg.largePreview_Control.height/2 );
      dlg.largePreview_Control.update();
   };

   this.zoomOut_Button = new PushButton( this );
   this.zoomOut_Button.text = "Zoom -";
   this.zoomOut_Button.onClick = function()
   {
      dlg.setPreviewZoomAt( dlg.largePreview_Control, dlg.previewZoom * 0.80, dlg.largePreview_Control.width/2, dlg.largePreview_Control.height/2 );
      dlg.largePreview_Control.update();
   };

   this.zoom11_Button = new PushButton( this );
   this.zoom11_Button.text = "1:1";
   this.zoom11_Button.onClick = function()
   {
      if ( dlg.largePreviewBitmap == null ) return;
      dlg.setPreviewZoomAt( dlg.largePreview_Control, 1.0/Math.max( 1e-6, Math.min( (dlg.largePreview_Control.width-8)/dlg.largePreviewBitmap.width, (dlg.largePreview_Control.height-8)/dlg.largePreviewBitmap.height ) ), dlg.largePreview_Control.width/2, dlg.largePreview_Control.height/2 );
      dlg.largePreview_Control.update();
   };

   this.zoomFit_Button = new PushButton( this );
   this.zoomFit_Button.text = "Fit";
   this.zoomFit_Button.onClick = function()
   {
      dlg.previewZoom = 1.0;
      data.previewZoom = dlg.previewZoom;
      dlg.resetLargePreviewPan();
      dlg.largePreview_Control.update();
   };

   this.zoom_Sizer = new HorizontalSizer;
   this.zoom_Sizer.spacing = 6;
   this.zoom_Sizer.add( this.previewActivity_Label );
   this.zoom_Sizer.addStretch();
   this.zoom_Sizer.add( this.zoomIn_Button );
   this.zoom_Sizer.add( this.zoomOut_Button );
   this.zoom_Sizer.add( this.zoom11_Button );
   this.zoom_Sizer.add( this.zoomFit_Button );

   this.createPreviewTileControl = function( paletteIndex, minW, minH, boostedVariant )
   {
      boostedVariant = !!boostedVariant;
      var tile = new Control( this );
      // RC5.4.9: preview thumbnails are fixed-size tiles. They should not
      // grow when the dialog is resized; the extra space belongs to the large
      // preview, not to thumbnails.
      try { tile.setFixedSize( minW, minH ); } catch ( eFixedTile ) { tile.setMinSize( minW, minH ); }
      tile.paletteIndex = paletteIndex;
      tile.boostedVariant = boostedVariant;
      tile.paletteName = getPreviewPaletteName( paletteIndex, boostedVariant );
      tile.previewBitmap = null;
      tile.previewView = null;
      tile.isDefaultPreviewTile = false;
      tile.ownerDialog = this;
      tile.selected = (paletteIndex == this.selectedPaletteIndex && boostedVariant == this.selectedPaletteBoosted);

      tile.onPaint = function()
      {
         var g = new Graphics( this );
         g.fillRect( 0, 0, this.width, this.height, new Brush( this.selected ? 0xFF303840 : 0xFF202020 ) );

         if ( this.previewBitmap != null )
         {
            var bmpW = this.previewBitmap.width;
            var bmpH = this.previewBitmap.height;
            var scale = Math.min( (this.width-8)/bmpW, (this.height-24)/bmpH );
            if ( scale <= 0 || !isFinite(scale) ) scale = 1;
            var drawW = bmpW * scale;
            var drawH = bmpH * scale;
            var drawX = (this.width - drawW)/2;
            var drawY = 4;
            g.scaleTransformation( scale );
            g.drawBitmap( drawX/scale, drawY/scale, this.previewBitmap );
            g.resetTransformation();
         }

         g.pen = new Pen( this.selected ? 0xFF80FF80 : 0xFFFFFFFF );
         g.font = new Font( "Helvetica", 9 );
         g.drawText( 5, this.height-6, this.paletteName );
         g.end();
      };

      tile.onMousePress = function()
      {
         if ( this.ownerDialog.previewGenerationBusy )
            return;
         this.ownerDialog.selectPreviewPalette( this.paletteIndex, this.boostedVariant );
      };

      this.previewTiles.push( tile );
      return tile;
   };

   var DEFAULT_TILE_WIDTH  = 174;
   var DEFAULT_TILE_HEIGHT = 88;

   this.mainPreviewGrid_Sizer = new HorizontalSizer;
   this.mainPreviewGrid_Sizer.spacing = 6;
   for ( var m = 0; m < DEFAULT_CLASSIC_PALETTE_INDICES.length; ++m )
   {
      var mainTile = this.createPreviewTileControl( DEFAULT_CLASSIC_PALETTE_INDICES[m], DEFAULT_TILE_WIDTH, DEFAULT_TILE_HEIGHT, false );
      mainTile.isDefaultPreviewTile = true;
      this.mainPreviewGrid_Sizer.add( mainTile );
   }
   this.mainPreviewGrid_Sizer.addStretch();

   this.boostedPreview_Control = new Control( this );
   this.boostedPreview_Control.sizer = new HorizontalSizer;
   this.boostedPreview_Control.sizer.margin = 0;
   this.boostedPreview_Control.sizer.spacing = 6;
   for ( var bm = 0; bm < DEFAULT_CLASSIC_PALETTE_INDICES.length; ++bm )
   {
      var boostTile = this.createPreviewTileControl( DEFAULT_CLASSIC_PALETTE_INDICES[bm], DEFAULT_TILE_WIDTH, DEFAULT_TILE_HEIGHT, true );
      boostTile.isDefaultPreviewTile = true;
      this.boostedPreview_Control.sizer.add( boostTile );
   }
   this.boostedPreview_Control.sizer.addStretch();

   this.advancedPreview_Control = new Control( this );
   this.advancedPreview_Control.sizer = new VerticalSizer;
   this.advancedPreview_Control.sizer.margin = 0;
   this.advancedPreview_Control.sizer.spacing = 6;

   var adv = [PALETTE_CLASSIC_SHO, PALETTE_CLASSIC_HSO, PALETTE_FORAXX_SHO, PALETTE_FORAXX_OHS, PALETTE_FORAXX_HOO, PALETTE_FORAXX_HSO, PALETTE_FORAXX_OSH, PALETTE_FORAXX_SOH];
   var advIndex = 0;
   for ( var ar = 0; ar < 2; ++ar )
   {
      var advRow = new HorizontalSizer;
      advRow.spacing = 6;
      for ( var ac = 0; ac < 4; ++ac )
      {
         if ( advIndex < adv.length )
         {
            advRow.add( this.createPreviewTileControl( adv[advIndex], DEFAULT_TILE_WIDTH, DEFAULT_TILE_HEIGHT ) );
            advIndex++;
         }
         else
         {
            var spacer = new Control( this );
            try { spacer.setFixedSize( DEFAULT_TILE_WIDTH, DEFAULT_TILE_HEIGHT ); } catch ( eSpacerFixed ) { spacer.setMinSize( DEFAULT_TILE_WIDTH, DEFAULT_TILE_HEIGHT ); }
            spacer.enabled = false;
            spacer.onPaint = function()
            {
               var g = new Graphics( this );
               g.fillRect( 0, 0, this.width, this.height, new Brush( 0x00000000 ) );
               g.end();
            };
            advRow.add( spacer );
         }
      }
      // Keep advanced rows using the same left-aligned grid behavior as the
      // main preview row, so all advanced combination tiles stay visually
      // aligned when the dialog is resized.
      advRow.addStretch();
      this.advancedPreview_Control.sizer.add( advRow );
   }

   this.preview_GroupBox = new GroupBox( this );
   this.preview_GroupBox.title = "(2) Create Previews";
   this.preview_GroupBox.sizer = new VerticalSizer;
   this.preview_GroupBox.sizer.margin = 6;
   this.preview_GroupBox.sizer.spacing = 6;
   this.preview_GroupBox.sizer.add( this.previewActions_Sizer );
   // RC5.4.9: advanced checkbox now lives on the top action row.
   this.preview_GroupBox.sizer.addSpacing( 8 );
   this.preview_GroupBox.sizer.add( this.previewInfo_Sizer );
   this.preview_GroupBox.sizer.add( this.mainPreviewGrid_Sizer );
   this.boostedPreview_Control.hide();
   this.preview_GroupBox.sizer.add( this.advancedPreview_Control );
   this.preview_GroupBox.sizer.addSpacing( 8 );
   this.preview_GroupBox.sizer.add( this.zoom_Sizer );
   this.preview_GroupBox.sizer.add( this.largePreview_Control );

   // RC5.2.4: Showing/hiding optional preview rows must not shrink the dialog
   // back to its default size after the user has manually stretched it.
   // We allow the dialog to grow if the newly visible row needs more room,
   // but never reduce the current user size.
   this.adjustPreviewVisibilityPreservingUserSize = function()
   {
      var oldW = this.width;
      var oldH = this.height;
      try { this.ensureLayoutUpdated(); } catch ( e0 ) {}
      try { this.adjustToContents(); } catch ( e1 ) {}

      var newW = this.width;
      var newH = this.height;
      var targetW = (oldW > newW) ? oldW : newW;
      var targetH = (oldH > newH) ? oldH : newH;

      if ( targetW > 0 && targetH > 0 && (targetW != newW || targetH != newH) )
      {
         try
         {
            this.resize( targetW, targetH );
         }
         catch ( e2 )
         {
            try
            {
               this.setFixedSize( targetW, targetH );
               this.setVariableSize();
            }
            catch ( e3 )
            {
            }
         }
      }

      if ( this.largePreview_Control )
         this.largePreview_Control.update();
      this.update();
   };

   this.refreshBoostedPreviewVisibility = function()
   {
      data.previewShowBoosted = false;
      if ( this.selectedPaletteBoosted )
         this.selectPreviewPalette( this.selectedPaletteIndex, false );
      if ( this.boostedPreview_Control )
         this.boostedPreview_Control.hide();
      this.adjustPreviewVisibilityPreservingUserSize();
   };

   this.createMissingBoostedPreviewTiles = function()
   {
      if ( this.previewGenerationBusy )
         return;
      if ( !this.previewsReady || !data.previewShowBoosted )
         return;

      var apsBoostedStart = apsNowMs();
      this.previewGenerationBusy = true;
      if ( this.setBoostedControlsCalculationBusy ) this.setBoostedControlsCalculationBusy( true );
      if ( this.previewBoosted_CheckBox ) this.previewBoosted_CheckBox.enabled = false;
      if ( this.createPreviews_Button ) this.createPreviews_Button.enabled = false;
      if ( this.generateSelected_Button ) this.generateSelected_Button.enabled = false;
      if ( this.luckyPreview_Button ) this.luckyPreview_Button.enabled = false;
      this.previewOverlayMessage = "Calculating boosted variants...";
      this.realtimePreviewCalculating = true;
      this.setPreviewActivity( true, "Calculating boosted variants..." );
      if ( this.largePreview_Control ) this.largePreview_Control.update();
      try { processEvents(); } catch ( peBoost0 ) {}

      for ( var bti = 0; bti < this.previewTiles.length; ++bti )
      {
         var tile = this.previewTiles[bti];
         if ( !tile.boostedVariant )
            continue;
         if ( tile.previewBitmap != null )
         {
            tile.update();
            continue;
         }

         var idx = tile.paletteIndex;
         var baseView = null;
         for ( var bi = 0; bi < this.previewTiles.length; ++bi )
            if ( this.previewTiles[bi].paletteIndex == idx && !this.previewTiles[bi].boostedVariant && isValidView( this.previewTiles[bi].previewView ) )
            {
               baseView = this.previewTiles[bi].previewView;
               break;
            }

         if ( isValidView( baseView ) )
         {
            var apsBoostTileStart = apsNowMs();
            tile.previewView = baseView;
            tile.previewBitmap = withTemporaryBoostedPreset( function(){ return createBoostedPreviewBitmap( baseView ); } );
            tile.update();
            apsProfileLog( "boosted tile on demand " + getPreviewPaletteName( idx, true ), apsBoostTileStart );
         }
         else
            tile.update();
      }

      this.previewGenerationBusy = false;
      if ( this.setBoostedControlsCalculationBusy ) this.setBoostedControlsCalculationBusy( false );
      this.realtimePreviewCalculating = false;
      this.previewOverlayMessage = "Calculating preview...";
      this.setPreviewActivity( false );
      if ( this.previewBoosted_CheckBox ) this.previewBoosted_CheckBox.enabled = true;
      if ( this.createPreviews_Button ) this.createPreviews_Button.enabled = true;
      if ( this.generateSelected_Button ) this.generateSelected_Button.enabled = true;
      if ( this.luckyPreview_Button ) this.luckyPreview_Button.enabled = true;
      if ( this.largePreview_Control ) this.largePreview_Control.update();
      apsProfileLog( "boosted previews on demand total", apsBoostedStart );
   };

   this.refreshAdvancedPreviewVisibility = function()
   {
      if ( data.previewShowAdvanced )
         this.advancedPreview_Control.show();
      else
      {
         if ( this.selectedPaletteIndex != PALETTE_ORIGINAL && this.selectedPaletteIndex != PALETTE_CLASSIC_HOO && this.selectedPaletteIndex != PALETTE_CLASSIC_FORAXX && this.selectedPaletteIndex != PALETTE_FORAXX_HOS )
            this.selectPreviewPalette( PALETTE_CLASSIC_HOO );
         this.advancedPreview_Control.hide();
      }
      this.adjustPreviewVisibilityPreservingUserSize();
   };

   this.refreshLargePreviewBoost = function( keepPan )
   {
      if ( this.realtimeRefreshBusy )
      {
         this.realtimeRefreshQueued = true;
         return;
      }

      // Gold Accent/Structure Lift are Advanced calculations. In i02 the
      // normal realtime key also includes Advanced state so queued Boosted/base
      // refreshes cannot overwrite the currently visible Advanced preview.
      // Still avoid cache hits during explicit Advanced calculation/Apply.
      var isAdvancedCalculation = data.previewSIIAccentActive === true;
      var key = isAdvancedCalculation ? this.advancedPreviewParameterKey() : this.realtimePreviewParameterKey();
      var cached = isAdvancedCalculation ? null : this.getLargePreviewCache( key );
      if ( cached != null )
      {
         this.largePreviewBitmap = cached;
         this.largePreviewBaseBitmap = cached;
         this.largePreviewBaseKey = key;
         if ( !keepPan )
            this.resetLargePreviewPan();
         this.adjustLargePreviewControlAspect();
         this.hideLargePreviewLoading();
         if ( this.largePreview_Control )
            this.largePreview_Control.update();
         this.realtimePreviewLastKey = key;
         return;
      }

      this.realtimeRefreshBusy = true;
      if ( this.setBoostedControlsCalculationBusy ) this.setBoostedControlsCalculationBusy( true );
      try
      {
         var renderSourceView = this.largePreviewSourceView;
         var skipAdvancedStack = false;
         var savedOverrideValues = data.previewRefinementOverrideValues || null;

         if ( !isAdvancedCalculation && this.isFrozenAdvancedBaseUsable() )
         {
            renderSourceView = this.frozenAdvancedSourceView;
            skipAdvancedStack = true;
            data.previewRefinementOverrideValues = this.currentFineTuneValuesFromFrozenBaseline();
         }

         var needsStarMaskBuild = isValidView( renderSourceView ) &&
            (data.previewShowMaskPreview || isAnyMaskActive()) &&
            !isStarMaskCacheReadyForView( renderSourceView );

         if ( needsStarMaskBuild && this.largePreview_Control )
         {
            this.realtimePreviewCalculating = true;
            this.showAdvancedCalculatingOverlay = true;
            this.previewOverlayMessage = isBlueCoreMaskActive() ? "Calculating blue core mask..." : (isWarmGoldMaskActive() ? "Calculating warm/gold mask..." : (isFaintRedMaskActive() ? "Calculating faint red mask..." : "Calculating star mask..."));
            this.largePreview_Control.update();
            try { processEvents(); } catch ( pe ) {}
         }

         if ( isValidView( renderSourceView ) )
         {
            if ( data.previewShowLastPreview && !isAdvancedCalculation )
               this.largePreviewBitmap = renderAutoStretchedDisplayBitmap( renderSourceView, renderSourceView, PREVIEW_PREFIX + "LARGE_LAST_DISPLAY" );
            else
               this.largePreviewBitmap = createLargePreviewPanelBitmap( renderSourceView, skipAdvancedStack );
         }
         else
            this.largePreviewBitmap = null;

         data.previewRefinementOverrideValues = savedOverrideValues;

         if ( !isAdvancedCalculation )
         {
            this.largePreviewBaseBitmap = this.largePreviewBitmap;
            this.largePreviewBaseKey = key;
            this.storeLargePreviewCache( key, this.largePreviewBitmap );
         }

         if ( !keepPan )
            this.resetLargePreviewPan();
         this.adjustLargePreviewControlAspect();
         this.realtimePreviewCalculating = false;
         this.showAdvancedCalculatingOverlay = false;
         this.largePreviewInvalid = false;
         this.previewOverlayMessage = "Calculating preview...";
         this.setPreviewActivity( false );
         if ( this.largePreview_Control )
            this.largePreview_Control.update();
         this.realtimePreviewLastKey = key;
      }
      catch ( e )
      {
         this.hideLargePreviewLoading();
         Console.warningln( "Realtime preview refresh skipped: ", e );
      }

      this.realtimeRefreshBusy = false;
      if ( this.setBoostedControlsCalculationBusy ) this.setBoostedControlsCalculationBusy( false );

      if ( this.realtimeRefreshQueued )
      {
         var queuedForce = this.realtimeRefreshQueuedForce;
         this.realtimeRefreshQueued = false;
         this.realtimeRefreshQueuedForce = false;
         this.realtimePreviewTimer.stop();
         if ( queuedForce )
            this.scheduleRealtimePreviewRefresh( true );
         else
            this.realtimePreviewTimer.start();
      }
   };

   this.updateLargePreviewFromSelection = function()
   {
      this.largePreviewBitmap = null;
      this.largePreviewSourceView = null;
      for ( var i = 0; i < this.previewTiles.length; ++i )
      {
         if ( this.previewTiles[i].paletteIndex == this.selectedPaletteIndex && !this.previewTiles[i].boostedVariant )
         {
            this.largePreviewSourceView = this.previewTiles[i].previewView;
            break;
         }
      }
      this.realtimePreviewLastKey = "";
      this.largePreviewBaseBitmap = null;
      this.largePreviewBaseKey = "";
      this.invalidateAdvancedPreviewCache();
      this.clearFrozenAdvancedBase();
      this.refreshLargePreviewBoost( false );
   };

   this.selectPreviewPalette = function( paletteIndex, boostedVariant )
   {
      if ( this.clearPreviewToast )
         this.clearPreviewToast();

      boostedVariant = false;
      if ( paletteIndex >= PALETTE_FORAXX_SHO && paletteIndex != PALETTE_FORAXX_HOS && !data.previewShowAdvanced )
         paletteIndex = PALETTE_CLASSIC_HOO;

      this.selectedPaletteIndex = paletteIndex;
      this.selectedPaletteBoosted = false;
      data.selectedPreviewPalette = paletteIndex;
      data.selectedPreviewBoosted = false;
      this.syncDataBoostedStackForSelection();
      data.typePalette = paletteIndex;
      data.allCombinations = false;
      if ( paletteIndex >= 0 ) this.forax_Combo.currentItem = paletteIndex;
      this.all_CheckBox.checked = false;
      this.forax_Combo.enabled = false;
      this.forax_Combo.hide();
      this.all_CheckBox.hide();
      this.blendMode_Combo.enabled = (paletteIndex >= 0 && paletteIndex < 3);
      this.selectedPreview_Label.text = "<b>Selected:</b> " + getPreviewPaletteName( paletteIndex, false );

      for ( var i = 0; i < this.previewTiles.length; ++i )
      {
         this.previewTiles[i].selected = (this.previewTiles[i].paletteIndex == paletteIndex && !this.previewTiles[i].boostedVariant);
         this.previewTiles[i].update();
      }

      this.showLargePreviewLoading( "Loading preview..." );
      this.updateLargePreviewFromSelection();
   };

   this.rebuildSelectedLargePreviewForQuality = function()
   {
      if ( this.previewGenerationBusy )
         return;

      var saved = {
         palette: this.selectedPaletteIndex,
         boosted: this.selectedPaletteBoosted,
         zoom: this.previewZoom,
         panX: this.previewPanX,
         panY: this.previewPanY,
         boostedControls: this.captureBoostedControlsState(),
         advancedControls: this.captureAdvancedControlsState ? this.captureAdvancedControlsState() : null,
         advancedStack: cloneAdvancedLayerStack( data.previewAdvancedLayerStack || [] ),
         showAdvanced: data.previewShowAdvanced,
         showMask: data.previewShowMaskPreview,
         maskEnabled: data.previewEnableMaskProtection || data.previewEnableStarProtection,
         maskPreset: data.previewMaskPreset,
         maskAmount: data.previewStarProtectionAmount,
         invertMask: data.previewInvertMask,
         finalOutputId: data.finalOutputId
      };

      this.showLargePreviewLoading( "Rebuilding previews at " + getPreviewQualityLabel() + " quality..." );
      if ( this.realtimePreviewTimer ) this.realtimePreviewTimer.stop();
      if ( this.applySIIAccent_Timer ) this.applySIIAccent_Timer.stop();
      if ( this.advancedRealtimePreview_Timer ) this.advancedRealtimePreview_Timer.stop();
      this.clearLargePreviewCache();
      this.invalidateAdvancedPreviewCache();
      invalidateStarMaskCache();

      // Full soft rebuild: all _APS_ preview sources/tiles are regenerated at the
      // new quality. User-facing controls are restored below; stale cache/views are
      // intentionally not reused across preview resolutions.
      this.createPreviewTiles( false );
      if ( !this.previewsReady )
      {
         this.hideLargePreviewLoading();
         return;
      }

      data.previewShowAdvanced = saved.showAdvanced;
      if ( this.previewAdvanced_CheckBox )
         this.previewAdvanced_CheckBox.checked = saved.showAdvanced;
      this.refreshAdvancedPreviewVisibility();

      this.selectedPaletteIndex = saved.palette;
      this.selectedPaletteBoosted = false;
      data.selectedPreviewPalette = saved.palette;
      data.selectedPreviewBoosted = false;
      data.typePalette = saved.palette;
      data.finalOutputId = saved.finalOutputId;
      if ( this.finalOutputId_Edit )
         this.finalOutputId_Edit.text = saved.finalOutputId;

      this.applyBoostedControlsState( saved.boostedControls );
      if ( this.restoreAdvancedControlsState )
         this.restoreAdvancedControlsState( saved.advancedControls );
      data.previewAdvancedLayerStack = cloneAdvancedLayerStack( saved.advancedStack );
      this.frozenAdvancedSourceView = null;
      this.frozenAdvancedBaseKey = "";
      this.frozenAdvancedBoostBaseline = null;
      this.advancedUndoStack = [];
      this.advancedRedoStack = [];

      data.previewEnableMaskProtection = !!saved.maskEnabled;
      data.previewEnableStarProtection = !!saved.maskEnabled;
      data.previewMaskPreset = saved.maskPreset;
      data.previewStarProtectionAmount = saved.maskAmount;
      data.previewShowMaskPreview = saved.showMask;
      data.previewInvertMask = saved.invertMask;
      if ( this.refreshMaskControlsState )
         this.refreshMaskControlsState();

      var restoredSource = null;
      for ( var ti = 0; ti < this.previewTiles.length; ++ti )
      {
         var tile = this.previewTiles[ti];
         tile.selected = (tile.paletteIndex == saved.palette && !tile.boostedVariant);
         if ( tile.selected && isValidView( tile.previewView ) )
            restoredSource = tile.previewView;
         tile.update();
      }

      if ( isValidView( restoredSource ) )
         this.largePreviewSourceView = restoredSource;
      if ( this.selectedPreview_Label )
         this.selectedPreview_Label.text = "<b>Selected:</b> " + getPreviewPaletteName( saved.palette, false );

      this.previewZoom = saved.zoom;
      this.previewPanX = saved.panX;
      this.previewPanY = saved.panY;
      this.realtimePreviewLastKey = "";
      this.largePreviewBaseBitmap = null;
      this.largePreviewBaseKey = "";
      this.invalidateAdvancedPreviewCache();
      this.refreshAdvancedControlsState();
      this.refreshLargePreviewBoost( true );
      this.showPreviewToast( "Preview quality changed to " + getPreviewQualityLabel() );
   };

   this.randomRange = function( minValue, maxValue )
   {
      return minValue + Math.random()*(maxValue-minValue);
   };

   this.round3 = function( v )
   {
      return Math.round( v*1000 )/1000;
   };

   this.applyLuckyPreviewPreset = function()
   {
      if ( this.previewGenerationBusy )
         return;

      if ( !this.previewsReady )
      {
         this.showPreviewToast( "Create previews first" );
         return;
      }

      var candidates = [];
      for ( var i = 0; i < this.previewTiles.length; ++i )
      {
         var t = this.previewTiles[i];
         if ( t.boostedVariant )
            continue;
         if ( !t.isDefaultPreviewTile && !data.previewShowAdvanced )
            continue;
         if ( t.previewBitmap == null )
            continue;
         if ( t.boostedVariant )
         {
            // Boosted tiles use their base view plus a thumbnail bitmap. They are
            // valid lucky candidates, but values below are applied after tile
            // selection so the random recipe is not overwritten by the boosted
            // tile preset.
            var hasBase = false;
            for ( var bi = 0; bi < this.previewTiles.length; ++bi )
               if ( this.previewTiles[bi].paletteIndex == t.paletteIndex && !this.previewTiles[bi].boostedVariant && isValidView( this.previewTiles[bi].previewView ) )
               {
                  hasBase = true;
                  break;
               }
            if ( !hasBase )
               continue;
         }
         else if ( !isValidView( t.previewView ) )
            continue;
         candidates.push( t );
      }

      if ( candidates.length == 0 )
      {
         this.showPreviewToast( "No available preview to randomize" );
         return;
      }

      var selectedTile = candidates[ Math.floor( Math.random()*candidates.length ) ];

      this.showLargePreviewLoading( "I'm feeling lucky..." );

      // Choose a tasteful random boosted recipe. Ranges are intentionally
      // constrained to avoid destructive clipping while still giving a visible
      // "lucky" variation on each click.
      var warmBias = Math.random();
      var boosted = {
         scnr:       this.round3( this.randomRange( 0.000, 0.045 ) ),
         oiii:       this.round3( this.randomRange( 1.080, 1.380 ) ),
         sii:        this.round3( this.randomRange( 1.080, 1.450 ) ),
         shadow:     this.round3( this.randomRange( 0.970, 1.015 ) ),
         highlight:  this.round3( this.randomRange( 1.004, 1.020 ) ),
         brightness: this.round3( this.randomRange( 1.000, 1.045 ) ),
         contrast:   this.round3( this.randomRange( 1.035, 1.155 ) ),
         saturation: this.round3( this.randomRange( 1.080, 1.300 ) ),
         cyanGold:   this.round3( this.randomRange( warmBias < 0.50 ? 0.030 : 0.160, warmBias < 0.50 ? 0.180 : 0.340 ) ),
         redYellow:  this.round3( this.randomRange( 0.000, warmBias < 0.50 ? 0.090 : 0.180 ) )
      };

      // Pick a restrained Advanced preparation. This mirrors the preset
      // philosophy: it prepares the controls, but the user decides whether to
      // stack the Advanced layer with Calculate & Apply.
      // i01: include Channel Lightness in the lucky Advanced recipes.
      var advancedMode = Math.floor( Math.random()*9 );
      // 0 none, 1 gold, 2 structure, 3 gold+structure, 4 structure strong,
      // 5 lightness, 6 lightness+gold, 7 lightness+structure, 8 all
      var structureSource = Math.floor( Math.random()*3 ); // internal enum: 0 SII, 1 OIII, 2 Ha
      var lightnessSource = Math.floor( Math.random()*3 ); // internal enum: 0 SII, 1 OIII, 2 Ha
      var structureAmount = (advancedMode == 4) ? this.randomRange( 0.430, 0.680 ) : this.randomRange( 0.280, 0.540 );
      var lightnessAmount = (advancedMode == 6 || advancedMode == 7 || advancedMode == 8) ? this.randomRange( 0.120, 0.340 ) : this.randomRange( 0.180, 0.460 );

      this.presetControlsSnapshot = this.capturePresetControlsState();
      if ( this.resetCosmeticPreset_Button )
         this.resetCosmeticPreset_Button.enabled = true;

      this.selectPreviewPalette( selectedTile.paletteIndex, selectedTile.boostedVariant );
      this.applyBoostedControlsState( boosted );

      this.realtimeRefreshSuspended = true;
      data.previewEnableLightness = (advancedMode == 5 || advancedMode == 6 || advancedMode == 7 || advancedMode == 8);
      data.previewLightnessSource = lightnessSource;
      data.previewLightnessAmount = data.previewEnableLightness ? this.round3( lightnessAmount ) : 0.000;
      data.previewEnableSIIAccent = (advancedMode == 1 || advancedMode == 3 || advancedMode == 6 || advancedMode == 8);
      data.previewSIIHighlightAccent = data.previewEnableSIIAccent ? this.round3( this.randomRange( 0.120, 0.420 ) ) : 0.000;
      data.previewEnableChannelLightness = (advancedMode == 2 || advancedMode == 3 || advancedMode == 4 || advancedMode == 7 || advancedMode == 8);
      data.previewChannelLightnessSource = structureSource;
      data.previewChannelLightnessAmount = data.previewEnableChannelLightness ? this.round3( structureAmount ) : 0.000;

      if ( this.enableLightness_CheckBox )
         this.enableLightness_CheckBox.checked = data.previewEnableLightness;
      if ( this.lightnessSource_Combo )
         this.lightnessSource_Combo.currentItem = this.advancedSourceEnumToComboIndex( data.previewLightnessSource );
      if ( this.previewLightnessAmount_Control )
         this.previewLightnessAmount_Control.setValue( data.previewLightnessAmount );
      if ( this.enableSIIAccent_CheckBox )
         this.enableSIIAccent_CheckBox.checked = data.previewEnableSIIAccent;
      if ( this.previewSIIHighlightAccent_Control )
         this.previewSIIHighlightAccent_Control.setValue( data.previewSIIHighlightAccent );
      if ( this.enableChannelLightness_CheckBox )
         this.enableChannelLightness_CheckBox.checked = data.previewEnableChannelLightness;
      if ( this.channelLightnessSource_Combo )
         this.channelLightnessSource_Combo.currentItem = this.advancedSourceEnumToComboIndex( data.previewChannelLightnessSource );
      if ( this.previewChannelLightnessAmount_Control )
         this.previewChannelLightnessAmount_Control.setValue( data.previewChannelLightnessAmount );
      this.realtimeRefreshSuspended = false;

      if ( this.cosmeticPresetHint_Label )
         this.cosmeticPresetHint_Label.text = "Lucky preset generated: random palette + Boosted values" + (data.previewEnableLightness || data.previewEnableSIIAccent || data.previewEnableChannelLightness ? ", with Advanced controls prepared. Press Calculate & Apply in Advanced to stack them." : ". No Advanced layer prepared this time.");

      this.invalidateAdvancedPreviewCache();
      this.clearFrozenAdvancedBase();
      this.refreshAdvancedControlsState();
      this.scheduleRealtimePreviewRefresh( true );
      this.showPreviewToast( "Lucky preset generated" );
   };

   this.createPreviewTiles = function( incrementalAdvancedOnly )
   {
      if ( this.previewGenerationBusy )
         return;

      var apsCreatePreviewStart = apsNowMs();
      var incrementalAdvanced = !!incrementalAdvancedOnly && this.previewsReady;

      this.previewGenerationBusy = true;
      for ( var lockTi = 0; lockTi < this.previewTiles.length; ++lockTi )
         this.previewTiles[lockTi].enabled = false;
      if ( this.luckyPreview_Button ) this.luckyPreview_Button.enabled = false;
      if ( this.createPreviews_Button ) this.createPreviews_Button.enabled = false;
      if ( this.generateSelected_Button ) this.generateSelected_Button.enabled = false;

      apsShowConsoleIfDebug();
      if ( apsDebugEnabled() )
         Console.noteln( incrementalAdvanced ? "Creating AutoPalette Studio advanced previews..." : "Creating AutoPalette Studio previews..." );

      this.previewOverlayMessage = incrementalAdvanced ? "Calculating advanced combinations..." : "Calculating previews...";
      this.realtimePreviewCalculating = true;
      this.showAdvancedCalculatingOverlay = true;
      if ( this.largePreview_Control )
         this.largePreview_Control.update();
      try { processEvents(); } catch ( pe0 ) {}

      if ( !incrementalAdvanced )
      {
         cleanupStudioPreviewWindows();
         this.clearFrozenAdvancedBase();
         this.largePreviewBitmap = null;
         this.clearLargePreviewCache();
         this.previewsReady = false;
         if ( this.largePreview_Control )
            this.largePreview_Control.update();
      }

      var apsSourceStart = apsNowMs();
      var pData = null;
      if ( incrementalAdvanced && this.previewSourceDataCache != null &&
           isValidView( this.previewSourceDataCache.referenceHA ) &&
           isValidView( this.previewSourceDataCache.referenceOIII ) &&
           isValidView( this.previewSourceDataCache.referenceSII ) )
      {
         pData = this.previewSourceDataCache;
         apsProfileLog( "createPreviewSourceData cache hit", apsSourceStart );
      }
      else
      {
         pData = createPreviewSourceData( data );
         apsProfileLog( "createPreviewSourceData (" + getPreviewQualityLabel() + ")", apsSourceStart );
         if ( pData != null )
         {
            this.previewSourceDataCache = pData;
            this.previewSourceDataCacheKey = (new Date()).getTime().toString();
         }
      }
      if ( pData == null )
      {
         Console.warningln("Preview source data could not be created.");
         data.linearInputAutoStretchEnabled = false;
         data.previewAutoStretch = false;
         if ( this.updateLinearInputStatusLabel ) this.updateLinearInputStatusLabel();
         this.previewGenerationBusy = false;
         this.realtimePreviewCalculating = false;
         this.showAdvancedCalculatingOverlay = false;
         this.previewOverlayMessage = "Calculating preview...";
         this.setPreviewActivity( false );
         for ( var unlockFailTi = 0; unlockFailTi < this.previewTiles.length; ++unlockFailTi )
            this.previewTiles[unlockFailTi].enabled = true;
         if ( this.luckyPreview_Button ) this.luckyPreview_Button.enabled = this.previewsReady;
         if ( this.createPreviews_Button ) this.createPreviews_Button.enabled = true;
         if ( this.generateSelected_Button && this.previewsReady ) this.generateSelected_Button.enabled = true;
         if ( this.largePreview_Control ) this.largePreview_Control.update();
         return;
      }

      if ( !incrementalAdvanced && this.adaptLargePreviewAreaToSource )
      {
         var aspectSourceView = isValidView( pData.previewOriginal ) ? pData.previewOriginal :
                                (isValidView( pData.referenceHA ) ? pData.referenceHA : null);
         this.adaptLargePreviewAreaToSource( aspectSourceView );
      }

      data.linearInputAutoStretchEnabled = (pData.linearInputAutoStretchEnabled === true);
      data.previewAutoStretch = data.linearInputAutoStretchEnabled;
      if ( this.updateLinearInputStatusLabel )
         this.updateLinearInputStatusLabel();
      if ( data.linearInputAutoStretchEnabled && apsDebugEnabled() )
         Console.warningln( "Linear input detected. Internal auto-stretch enabled for previews and final image generation." );

      var autoNormalizationMessage = "";
      if ( data.linearFit == NORMALIZATION_AUTO && data.lastAutoNormalizationReference && data.lastAutoNormalizationReference.length > 0 )
         autoNormalizationMessage = "Auto normalization: " + data.lastAutoNormalizationReference;

      var previewGenerationFailed = false;
      try
      {
      for ( var i = 0; i < this.previewTiles.length; ++i )
      {
         var tile = this.previewTiles[i];
         var idx = tile.paletteIndex;
         var def = getPaletteDefinitionByIndex( idx );

         // RC5.2.3: if boosted variants are hidden, do not generate them during
         // Create Previews. They can be computed later on demand when the user
         // enables "Show boosted variants".
         if ( tile.boostedVariant )
         {
            if ( !incrementalAdvanced )
            {
               tile.previewBitmap = null;
               tile.previewView = null;
            }
            tile.update();
            continue;
         }

         // Default tiles are already cached when we are only revealing advanced
         // combinations. Keep their previewView/bitmap untouched so enabling
         // Show advanced combinations does not recalculate the whole grid.
         if ( incrementalAdvanced && tile.isDefaultPreviewTile )
         {
            tile.update();
            continue;
         }

         var visibleInCurrentMode = (tile.isDefaultPreviewTile || data.previewShowAdvanced);

         if ( incrementalAdvanced && tile.previewBitmap != null && (tile.boostedVariant || isValidView( tile.previewView )) )
         {
            tile.update();
            continue;
         }

         if ( !incrementalAdvanced )
         {
            tile.previewBitmap = null;
            tile.previewView = null;
         }

         if ( !visibleInCurrentMode )
         {
            tile.update();
            continue;
         }

         if ( def.requiresSII && !isValidView(pData.referenceSII) )
         {
            tile.update();
            continue;
         }

         if ( tile.boostedVariant )
         {
            var baseView = null;
            for ( var bi = 0; bi < this.previewTiles.length; ++bi )
               if ( this.previewTiles[bi].paletteIndex == idx && !this.previewTiles[bi].boostedVariant && isValidView( this.previewTiles[bi].previewView ) )
               {
                  baseView = this.previewTiles[bi].previewView;
                  break;
               }

            if ( isValidView( baseView ) )
            {
               tile.previewView = baseView;
               tile.previewBitmap = withTemporaryBoostedPreset( function(){ return createBoostedPreviewBitmap( baseView ); } );
               tile.update();
               if ( data.previewDebugWindows ) Console.writeln("Boosted preview created: ", def.name);
            }
            else
               tile.update();
            continue;
         }

         var apsTileStart = apsNowMs();
         var v = createPreviewPaletteView( pData, idx );
         if ( isValidView( v ) )
         {
            tile.previewView = v;
            tile.previewBitmap = renderPreviewTileBitmap( v, pData.previewAutoStretch );
            tile.update();
            if ( isValidWindow( v.window ) && !data.previewDebugWindows )
               v.window.hide();
            if ( data.previewDebugWindows ) Console.writeln("Preview created: ", def.name);
            apsProfileLog( "tile " + def.name + (tile.boostedVariant ? " boosted" : ""), apsTileStart );
         }
         else
            tile.update();
      }

      }
      catch ( eCreatePreviewTiles )
      {
         previewGenerationFailed = true;
         Console.warningln( "Preview generation failed: ", eCreatePreviewTiles );
      }

      cleanupStudioPreviewSourceWindows();
      if ( !incrementalAdvanced )
      {
         // RC3.11: after generating previews, start from Original. This keeps
         // the workflow neutral and makes the first large preview match the
         // first tile selected by default.
         this.selectPreviewPalette( PALETTE_ORIGINAL, false );
         this.syncDataBoostedStackForSelection();
      }
      else if ( this.largePreview_Control )
         this.largePreview_Control.update();

      this.previewsReady = true;
      this.previewGenerationBusy = false;
      if ( this.setBoostedControlsCalculationBusy )
      {
         try { this.setBoostedControlsCalculationBusy( false ); }
         catch ( eUnlockBoosted ) { Console.warningln( "Boosted control unlock failed: ", eUnlockBoosted ); }
      }
      this.realtimePreviewCalculating = false;
      this.showAdvancedCalculatingOverlay = false;
      this.previewOverlayMessage = "Calculating preview...";
      this.setPreviewActivity( false );
      for ( var unlockTi = 0; unlockTi < this.previewTiles.length; ++unlockTi )
         this.previewTiles[unlockTi].enabled = true;
      if ( this.luckyPreview_Button ) this.luckyPreview_Button.enabled = true;
      if ( this.previewAdvanced_CheckBox ) this.previewAdvanced_CheckBox.enabled = !!(this.hasLoadedLargePreviewForControls && this.hasLoadedLargePreviewForControls());
      if ( this.createPreviews_Button ) this.createPreviews_Button.enabled = true;
      if ( this.generateSelected_Button )
         this.generateSelected_Button.enabled = true;
      if ( !incrementalAdvanced && this.collapseSetupSectionsAfterPreview )
         this.collapseSetupSectionsAfterPreview();
      if ( this.largePreview_Control )
         this.largePreview_Control.update();
      if ( this.updateAutoNormalizationInfoLabel )
         this.updateAutoNormalizationInfoLabel();
      if ( previewGenerationFailed )
         this.showPreviewToast( "Preview generation failed; controls were unlocked" );
      else if ( autoNormalizationMessage.length > 0 )
         this.showPreviewToast( autoNormalizationMessage );
      if ( apsDebugEnabled() )
         Console.noteln( incrementalAdvanced ? "AutoPalette Studio advanced previews completed." : "AutoPalette Studio previews completed." );
      apsProfileLog( incrementalAdvanced ? "advanced previews total" : "previews total", apsCreatePreviewStart );
      if ( !apsDebugEnabled() && !APS_PROFILE ) Console.hide();
   };

   this.luckyPreview_Button.onClick = function() { dlg.applyLuckyPreviewPreset(); };
   this.createPreviews_Button.onClick = function() { dlg.createPreviewTiles(); };
   this.generateSelected_Button.onClick = function()
   {
      if ( dlg.finalOutputId_Edit )
         data.finalOutputId = dlg.finalOutputId_Edit.text;
      // Keep the dialog open while the final image is being generated so the
      // user gets progress feedback instead of a disappearing interface.
      dlg.runFinalGeneration();
   };

   if ( data.previewShowBoosted )
      this.boostedPreview_Control.show();
   else
      this.boostedPreview_Control.hide();

   if ( data.previewShowAdvanced )
      this.advancedPreview_Control.show();
   else
      this.advancedPreview_Control.hide();


   /*
    * Bottom buttons
    */
    this.cancel_Button = new PushButton(this);
    this.cancel_Button.text    = "Cancel";
    this.cancel_Button.cursor  = new Cursor(StdCursor_Crossmark);
    this.cancel_Button.onClick = function() { this.dialog.cancel(); };

    this.newInstanceButton = new ToolButton( this );
    this.newInstanceButton.icon = this.scaledResource( ":/process-interface/new-instance.png" );
    this.newInstanceButton.setScaledFixedSize( 24, 24 );
    this.newInstanceButton.toolTip = "New Instance";
    this.newInstanceButton.onMousePress = function()
    {
       this.hasFocus = true;
       this.pushed = false;
       if ( this.dialog.finalOutputId_Edit )
          data.finalOutputId = this.dialog.finalOutputId_Edit.text;
       data.setParameters();
       this.dialog.newInstance();
    };

    this.help_Button = new ToolButton( this );
    this.help_Button.icon = this.scaledResource( ":/process-interface/browse-documentation.png" );
    this.help_Button.setScaledFixedSize( 20, 20 );
    this.help_Button.toolTip = "Browse Documentation";
    this.help_Button.onClick = function()
    {
       Dialog.browseScriptDocumentation( "AutoPalette Studio" );
    };

    this.buttons_Sizer = new HorizontalSizer;
    this.buttons_Sizer.spacing = 6;
    this.buttons_Sizer.add(this.finalOutputId_Label);
    this.buttons_Sizer.add(this.finalOutputId_Edit);
    this.buttons_Sizer.addStretch();
    this.buttons_Sizer.add(this.finalGenerationStatus_Label);
    this.buttons_Sizer.add(this.generateSelected_Button);
    this.buttons_Sizer.add(this.cancel_Button);


    // 1.0: final output controls belong visually to the preview panel,
    // not to the whole dialog. This aligns Output image id with the large
    // preview area and leaves the left control stack clean.

   /*
    * Print Dialog
    */

   this.image_GroupBox = new Control( this );
   this.image_GroupBox.backgroundColor = SETUP_SECTION_BODY_BG;
   this.image_GroupBox.sizer = new VerticalSizer;

   with ( this.image_GroupBox.sizer )
   {
      margin  = 6;
      spacing = 6;
      add(this.radioButtons_Sizer);
      addSpacing(4);
      add(this.referenceOSC_Sizer);
      addSpacing(4);
      add(this.monoReferences_Control);
      addSpacing(6);
      add(this.linearfit_Sizer);
      add(this.autoNormalizationInfo_Label);
      addSpacing(4);
      add(this.blendMode_Sizer);
   }

   this.paletteConfigInfo_Label = new Label( this );
   this.paletteConfigInfo_Label.useRichText = true;
   this.paletteConfigInfo_Label.wordWrapping = true;
   this.paletteConfigInfo_Label.text = "Preview tiles are generated from the selected source channels. Default normalization is None for speed; use Auto/Ha/SII/OIII only when you want channel matching.";

   this.palettee_GroupBox = new Control( this );
   this.palettee_GroupBox.backgroundColor = SETUP_SECTION_BODY_BG;
   this.palettee_GroupBox.sizer = new VerticalSizer;

   with ( this.palettee_GroupBox.sizer )
   {
      margin  = 6;
      spacing = 6;
      add(this.paletteConfigInfo_Label);
   }

   this.image_SectionBar = new SectionBar( this, "(1) Channel Source" );
   this.image_SectionBar.setSection( this.image_GroupBox );

   this.paletteConfig_SectionBar = new SectionBar( this, "(2) Palette Setup" );
   this.paletteConfig_SectionBar.setSection( this.palettee_GroupBox );
   this.paletteConfig_SectionBar.hide();
   this.palettee_GroupBox.hide();
   if ( this.updateAutoNormalizationInfoLabel )
      this.updateAutoNormalizationInfoLabel();

   // v0.13.62: frameless outer section body for Boosted controls.
   this.previewBoost_GroupBox = new Control( this );
   this.previewBoost_GroupBox.backgroundColor = SECTION_BODY_BG;
   this.previewBoost_GroupBox.sizer = new VerticalSizer;

   with ( this.previewBoost_GroupBox.sizer )
   {
      margin = 4;
      spacing = 5;
      add( this.previewBoostRange_Sizer );
      add( this.previewChannelTitle_Label );
      add( this.previewSCNR_Row );
      add( this.previewOIIIBoost_Row );
      add( this.previewSIIBoost_Row );
      addSpacing( 8 );
      add( this.previewToneTitle_Label );
      add( this.previewShadowPoint_Row );
      add( this.previewHighlightReduction_Row );
      add( this.previewBrightness_Row );
      add( this.previewContrast_Row );
      addSpacing( 8 );
      add( this.previewColorTitle_Label );
      add( this.previewSaturation_Row );
      add( this.previewCyanGold_Row );
      add( this.previewRedYellow_Row );
      addSpacing( 8 );
      add( this.previewBoostReset_Sizer );
   }

   this.previewBoost_SectionBar = new SectionBar( this, "(3) Boosted controls" );
   this.previewBoost_SectionBar.setSection( this.previewBoost_GroupBox );

   this.advancedControls_SectionBar = new SectionBar( this, "(4) Advanced controls" );
   this.advancedControls_SectionBar.setSection( this.advancedControls_GroupBox );

   this.masks_SectionBar = new SectionBar( this, "(5) Masks" );
   this.masks_SectionBar.setSection( this.masks_GroupBox );

    /*
     * Studio layout
     *
     * Left side keeps the stable classic controls. Right side contains the
     * new preview grid, so the dialog does not become excessively tall.
     */
    this.leftPanel_Sizer = new VerticalSizer;
    with (this.leftPanel_Sizer) {
        margin  = 0;
        spacing = 6;
        add(this.headerLabel);
        add(this.compactHelpLabel);
        addSpacing(4);
        add(this.image_SectionBar);
        add(this.image_GroupBox);
        addSpacing(6);
        add(this.boostPreset_Sizer);
        addSpacing(4);
        add(this.previewBoost_SectionBar);
        add(this.previewBoost_GroupBox);
        addSpacing(6);
        add(this.advancedControls_SectionBar);
        add(this.advancedControls_GroupBox);
        addSpacing(6);
        add(this.masks_SectionBar);
        add(this.masks_GroupBox);
        addStretch();
        this.leftBottomTools_Sizer = new HorizontalSizer;
        this.leftBottomTools_Sizer.spacing = 6;
        this.leftBottomTools_Sizer.add( this.newInstanceButton );
        this.leftBottomTools_Sizer.add( this.help_Button );
        this.leftBottomTools_Sizer.addStretch();
        add( this.leftBottomTools_Sizer );
    }

    this.rightPanel_Sizer = new VerticalSizer;
    with (this.rightPanel_Sizer) {
        margin = 0;
        spacing = 6;
        add(this.preview_GroupBox, 1);
        add(this.buttons_Sizer);
    }

    this.mainPanels_Sizer = new HorizontalSizer;
    with (this.mainPanels_Sizer) {
        margin  = 0;
        spacing = 8;
        add(this.leftPanel_Sizer);
        add(this.rightPanel_Sizer, 1);
    }

    this.sizer = new VerticalSizer;
    with (this.sizer) {
        margin  = 6;
        spacing = 6;
        add(this.mainPanels_Sizer, 1);
    }

   this.setLayout = function()
   {
      this.ensureLayoutUpdated();
      this.adjustToContents();
      this.setVariableSize();
   };

   this.collapseSetupSectionsAfterPreview = function()
   {
      // i02: keep Channel Source visible after Create Previews. Only collapse
      // secondary setup sections so the user can still inspect/change sources.
      if ( this.image_GroupBox )
         this.image_GroupBox.show();
      if ( this.palettee_GroupBox )
         this.palettee_GroupBox.hide();
      this.setLayout();
   };

   this.image_SectionBar.onToggleSection = function( bar, toggleBegin )
   {
      this.dialog.setLayout();
   };
   this.paletteConfig_SectionBar.onToggleSection = function( bar, toggleBegin )
   {
      this.dialog.setLayout();
   };

   this.previewBoost_SectionBar.onToggleSection = function( bar, toggleBegin )
   {
      this.dialog.setLayout();
   };
   this.advancedControls_SectionBar.onToggleSection = function( bar, toggleBegin )
   {
      this.dialog.setLayout();
   };
   this.masks_SectionBar.onToggleSection = function( bar, toggleBegin )
   {
      this.dialog.setLayout();
   };

   // Cosmetic preset guidance remains tooltip-only. Masks start closed by
   // default to keep the initial production layout compact.
   if ( this.cosmeticPresets_GroupBox )
      this.cosmeticPresets_GroupBox.hide();
   // v1.0.4: Advanced starts collapsed; it is available after previews are loaded.
   if ( this.advancedControls_GroupBox )
      this.advancedControls_GroupBox.hide();
   if ( this.masks_GroupBox )
      this.masks_GroupBox.hide();
   // Default mask state: section visible but no mask active.
   data.previewShowMaskPreview = false;
   if ( this.showMaskPreview_CheckBox )
      this.showMaskPreview_CheckBox.checked = false;

   this.refreshAdvancedControlsState();
   if ( this.refreshMaskControlsState )
      this.refreshMaskControlsState();
   if ( this.setBoostedControlsCalculationBusy )
      this.setBoostedControlsCalculationBusy( false );
   if ( this.previewAdvanced_CheckBox )
      this.previewAdvanced_CheckBox.enabled = false;
   if ( this.generateSelected_Button )
      this.generateSelected_Button.enabled = this.previewsReady;
   if ( this.luckyPreview_Button )
      this.luckyPreview_Button.enabled = this.previewsReady;
   this.windowTitle = TITLE;
   this.adjustToContents();
   this.setVariableSize();

   this.onHide = function()
   {
      if ( this.realtimePreviewTimer )
         this.realtimePreviewTimer.stop();
      if ( this.applySIIAccent_Timer )
         this.applySIIAccent_Timer.stop();
      if ( this.previewToast_Timer )
         this.previewToast_Timer.stop();
   };
}

autopaletteMain.prototype = new Dialog;


function main() {
   Console.writeln("");
   Console.noteln("<b>",  TITLE , " " , VERSION, "</b>:");
   Console.hide();

   data.getParameters();

   // Direct execution from a process icon dropped on a view/container target.
   if (Parameters.isViewTarget && isValidView(data.currentView)) {
      paletteStart(data);
      return;
   }

   var dialog = new autopaletteMain();
   for ( ;; ) {
       if (!dialog.execute()) break;
       if ( dialog.finalGenerationHandled )
          break;
       data.setParameters();
       paletteStart(data);
   }

   cleanupStudioPreviewWindows();
   return;
}


main();
