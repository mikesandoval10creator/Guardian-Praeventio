const fs = require('node:fs');
const path = require('node:path');

/** Test/adoption tooling only. Never loads or enables WASM in the product. */
function readBuiltLayoutWasm({
  root = path.resolve(__dirname, '../..'),
  required = process.env.LAYOUT_WASM_REQUIRED === '1',
} = {}) {
  const modulePath = path.join(root, 'wasm/force-graph-layout/target/wasm32-unknown-unknown/release/force_graph_layout.wasm');
  if (!fs.existsSync(modulePath)) {
    if (required) throw new Error('layout_wasm_required_missing: run npm run layout-wasm:build');
    return null;
  }
  const bytes = fs.readFileSync(modulePath);
  if (!WebAssembly.validate(bytes)) throw new Error('layout_wasm_invalid: rebuild the experimental module');
  return bytes;
}

module.exports = { readBuiltLayoutWasm };
