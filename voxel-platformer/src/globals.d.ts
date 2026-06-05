// Build-time constants injected by Vite `define` (see vite.config.ts).

/** True only in the public game build (`vite build --mode game`). Game code
 *  reads this to drop editor-only affordances (e.g. the "Exit to Editor"
 *  button). Defined as `false` for dev and the full multi-page build. */
declare const __GAME_BUILD__: boolean
