# Card-back artwork

Ten original illustrations generated with the imagegen skill from the user's
Nepal landmark card-back reference: Kathmandu Durbar Square, Mount Everest,
Boudhanath Stupa, Pokhara, Pashupatinath, Chitwan National Park, Bhaktapur Durbar
Square, Rara Lake, Lumbini, and Annapurna Range.

These are flat portrait back textures, with no card ranks, suits, or gameplay
information. The images are bundled locally and work offline. Runtime JPEGs
are 512 × 768, optimized from the full-size generated originals. The original
outputs remain in the Codex generated-image library.

`src/cardThemeCatalog.ts` contains stable IDs and translated names;
`src/cardThemeImages.ts` maps IDs to bundled artwork. Add future options through
those two catalogs. `CardThemeProvider` persists a default for creating new tables.
`TableCardThemeProvider` overrides it with the shared server-confirmed table
choice, and `CardBack` applies it uniformly across all three games.
