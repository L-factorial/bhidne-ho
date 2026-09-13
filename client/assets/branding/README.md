# Bhidne Ho artwork

Original user-supplied PNG files, preserved without modification.

- `00`: reference brand sheet; not displayed in the application.
- `01`: desktop welcome artwork.
- `02`: mobile welcome banner; the view clips to the central logo to exclude the painted navigation controls.
- `03`: shared room, profile and preview headers.
- `04`: startup loading icon.
- `05`: simplified icon retained for future native assets.
- `06`: web favicon (Expo generates the exported favicon).
- `09`, `10`, `11`: game selection tiles and table headers.
- `12`: room directory decoration.

`src/branding.ts` provides static Metro asset references. Shared colors live in `src/theme.ts`; pink turn highlights remain readable in both modes.

The provided main icon is 226 × 220 pixels. Native launcher configuration is intentionally pending a square, high-resolution export; the supplied originals are suitable for their current small interface placements. The portrait is welcome artwork, not a configured native splash screen. The logo contains a light background in the original image.
