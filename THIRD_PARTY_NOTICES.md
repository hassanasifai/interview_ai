# Third Party Notices

This MVP includes or references open-source software packages under their respective licenses.

## Frontend Runtime and Tooling

- React (`react`, `react-dom`) - MIT
- Vite (`vite`, `@vitejs/plugin-react`) - MIT
- TypeScript (`typescript`) - Apache-2.0
- Zustand (`zustand`) - MIT
- Zod (`zod`) - MIT
- Lucide React (`lucide-react`) - ISC
- ESLint and related plugins - MIT
- Vitest and Testing Library packages - MIT

## Desktop and Native Layer

- Tauri (`@tauri-apps/api`, `@tauri-apps/cli`) - MIT/Apache-2.0
- Rust ecosystem crates used in `src-tauri` - per crate licenses in Cargo metadata

## External AI Provider APIs

- Groq API is used via HTTP and is not bundled as a redistributable library.
- Users must provide their own API key and are responsible for complying with provider terms.

## Notes

- This project is local-first and stores app data in local storage fallback when Tauri invoke is unavailable.
- No GPL or AGPL code has been copied into this workspace by these MVP updates.
