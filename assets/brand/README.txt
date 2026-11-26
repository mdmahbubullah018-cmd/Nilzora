Nilzora brand assets
====================

Supplied files (official artwork, kept unmodified in this directory):
  - favicon-1.ico          16/32/48/64 px icon. Used as the browser favicon of the
                           storefront and admin apps (copied to src/app/favicon.ico).
  - apple-touch-icon.png   180 x 180 px icon with transparency. Used as the home-screen
                           icon of both web apps (copied to src/app/apple-icon.png).
  - 1-logo-white-bg-Picsart-BackgroundRemover.png
                           1600 x 900 full lockup for light backgrounds, transparent.
  - 2-logo-dark-bg-Picsart-BackgroundRemover.png
                           1600 x 900 full lockup for navy / dark backgrounds, transparent.
  - 3-app-icon-navy-Picsart-BackgroundRemover.png
                           1200 x 1200 navy app mark (navy rounded square, sky "N",
                           off-white dot), transparent.
  - 4-app-icon-sky.png     1080 x 1080 sky app mark (sky rounded square, white "N"),
                           transparent.
  - build-app-assets.ps1   Rebuilds every derived copy below from those originals.

No SVG and no separate monochrome lockup were supplied, so nothing here is redrawn: every
derived file is the supplied artwork scaled proportionally and centred, never stretched and
never recoloured, except the two Android monochrome silhouettes, which the platform requires
to be a single alpha shape.

Derived web and app copies (same artwork, only the empty transparent margin trimmed)
----------------------------------------------------------------------------------
apps/storefront/public/brand, apps/admin/public/brand and apps/mobile/assets/brand hold the
same four files:
  - nilzora-logo-on-light.png  <- 1-logo-white-bg-...  (1023 x 243)
  - nilzora-logo-on-dark.png   <- 2-logo-dark-bg-...   (1023 x 243)
  - nilzora-mark-navy.png      <- 3-app-icon-navy-...  (725 x 724)
  - nilzora-mark-sky.png       <- 4-app-icon-sky.png   (650 x 650)

Their paths are named once, in packages/ui/src/brand.ts. Both web apps render them through
the shared <Logo>/<LogoMark> (packages/ui/src/components/logo.tsx, a CSS background, so
exactly one tone is downloaded and the tone follows [data-theme]); the storefront additionally
uses next/image (apps/storefront/src/components/brand/nilzora-logo.tsx) so it serves an
optimised copy. The mobile app renders nilzora-logo-on-light.png through
apps/mobile/src/components/logo.tsx.

Android launcher, splash and notification artwork (apps/mobile/assets/app), built by
build-app-assets.ps1
---------------------------------------------------------------------------------------
The launcher art is extracted from 3-app-icon-navy-... : the sky "N" and the off-white dot
(the "letterform") are lifted off the artwork's own navy rounded plate with their exact
colours and anti-aliased edges preserved, and the plate itself is discarded. That removes the
nested-square look (a navy plate drawn inside a navy launcher tile, with a visible light rim
between them) without redrawing anything.

  - icon.png                      1024 x 1024  the letterform at 62%, flattened onto a
                                               full-bleed #0F172A tile (opaque, as both
                                               stores require)
  - adaptive-icon-foreground.png  1024 x 1024  the same letterform at 41%, transparent, so
                                               it stays inside the Android safe zone and the
                                               system supplies the mask; the configured
                                               background is #0F172A
  - adaptive-icon-monochrome.png  1024 x 1024  single-colour silhouette of the letterform at
                                               41%, for Android 13+ themed icons
  - notification-icon.png           96 x 96    the same silhouette at notification size
  - ios-icon-tinted.png           1024 x 1024  the same silhouette, used as the iOS 18
                                               tinted / dark icon appearance
  - splash-icon.png               1024 x 243   the light-background lockup (no longer used by
                                               the launch screen; see below)

Launch screen (mobile)
----------------------
The native Android splash shows only the mark: app.json's expo-splash-screen entry points at
apps/mobile/assets/brand/nilzora-mark-navy.png at 112 dp on #F1F5FB, and the
android/app/src/main/res/drawable-*/splashscreen_logo.png files are that mark composed exactly
as the plugin does (a 288 dp transparent canvas, the mark contained in a 112 dp square). The
animated splash in the app then moves the mark into the full lockup.

  - apps/mobile/assets/brand/nilzora-wordmark-on-light.png  721 x 243
        cropped, unmodified, from nilzora-logo-on-light.png at x = 302 (columns 244-301 of the
        lockup are fully transparent), full height kept so it lines up with the mark exactly as
        in the lockup. Never redrawn or recoloured.

Extraction rules (Save-MarkInk in build-app-assets.ps1): a pixel belongs to the letterform
when its colour is far enough from the plate colour sampled at the plate's left edge, so the
soft cyan glow and the faint rim collapse into transparency; isolated one-pixel flecks and the
mark's low-saturation grey shadow beside the dot are dropped, while the near-white dot is
kept.

The scales are measured from the supplied art, not guessed: in 3-app-icon-navy the letterform
covers 0.615 of its rounded plate's height. icon.png keeps that ratio of its own tile; the
Android layers use 0.41 because their 108 dp canvas only shows the inner 72 dp, which is what
the launcher mask replaces - 0.41 x 108 = 0.615 x 72, so the mark looks the same size on both
platforms and its furthest pixel (the dot) stays 7 dp inside a circular mask.

Still not supplied, and therefore still absent:
  - an SVG version of the lockup or of the mark
  - a standalone one-colour logo (the Android silhouettes are derived from the mark above)
  - a square 1024 x 1024 app-icon source that already carries its own background
