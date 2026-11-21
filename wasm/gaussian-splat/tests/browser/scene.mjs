import { Application, Entity, GSplatData, GSplatResource } from 'playcanvas';
import { prepareSplatForRendering } from '../../preparation.ts';

const app = new Application(globalThis.document.querySelector('canvas'), {
  graphicsDeviceOptions: { alpha: false, antialias: false },
});
const camera = new Entity();
camera.addComponent('camera');
camera.camera.clearColor.set(0, 0, 0, 1);
camera.setPosition(0, 0, 3);
app.root.addChild(camera);
app.start();

const engine = await globalThis.WebAssembly.compileStreaming(globalThis.fetch('/engine.wasm'));
let splat;
let resource;
globalThis.splatProbe = async (invalid) => {
  const bytes = new ArrayBuffer(32);
  const view = new DataView(bytes);
  for (const offset of [12, 16, 20]) view.setFloat32(offset, 0.3, true);
  if (invalid) view.setFloat32(0, NaN, true);
  new Uint8Array(bytes).set([255, 32, 16, 240, 255, 128, 128, 128], 24);
  const result = await prepareSplatForRendering(engine, bytes);
  const detached = bytes.byteLength === 0;
  if (!result.ok) return { detached, reason: result.reason };
  resource = new GSplatResource(app.graphicsDevice, new GSplatData([result.element]));
  splat = new Entity();
  splat.addComponent('gsplat');
  splat.gsplat.resource = resource;
  app.root.addChild(splat);
  return { detached, count: result.element.count };
};
globalThis.removeSplatProbe = () => {
  splat.destroy();
  resource.destroy();
};
await new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)));
globalThis.document.querySelector('canvas').dataset.ready = 'true';
