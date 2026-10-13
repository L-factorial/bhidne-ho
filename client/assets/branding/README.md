# Bhidne Ho artwork

Original user-supplied PNG files, preserved without modification.

- `00`: reference brand sheet; not displayed in the application.
- `01`: previous desktop welcome artwork, retained as an original.
- `02`, `03`, `04`: previous banner, logo and loading artwork, retained as originals.
- `bhidneho-header.png`: previous header artwork, retained as an original.
- `bhidneho-header-final.png`: app/table header logo (727 × 385), rendered at its original aspect ratio.
- `bhidneho-landing-final.png`: mobile and desktop welcome artwork (1090 × 650), rendered at its original aspect ratio.
- `bhidneho-app-icon.png`: startup loading artwork, iOS/Android launcher icon and web favicon (1024 × 1024, opaque).
- `05`: simplified icon retained for future native assets.
- `06`: previous web favicon, retained as an original.
- `09`, `10`, `11`: game selection tiles and table headers.
- `12`: room directory decoration.

`src/branding.ts` provides static Metro asset references. Shared colors live in `src/theme.ts`; pink turn highlights remain readable in both modes.

The current launcher icon is configured in `app.json`; native installs need a new build to receive it. The portrait is welcome artwork, not a configured native splash screen.
