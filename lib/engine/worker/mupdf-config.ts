const current: unknown = globalThis['$libmupdf_wasm_Module'];
const configuration = typeof current === 'object' && current !== null ? current : {};

globalThis['$libmupdf_wasm_Module'] = {
  ...configuration,
  // Emscripten routes MuPDF's diagnostic stderr through console.error by default.
  // Operation failures still reject through WorkerRpc; diagnostics remain visible as warnings.
  printErr: (...values: unknown[]) => console.warn(...values),
};

export {};
