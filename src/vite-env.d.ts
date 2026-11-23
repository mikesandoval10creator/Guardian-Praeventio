/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY: string;
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_GRAPH_LAYOUT_WASM_SHA256?: string;
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
