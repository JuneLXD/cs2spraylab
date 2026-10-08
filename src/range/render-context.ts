import * as THREE from 'three';

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** The game's WebGL 2 renderer. three.js has no option for a desynchronized canvas, so the context is created here.
 * `lowLatency` asks for one: Chrome and Edge then show each frame without waiting for the page compositor (it can
 * tear, like V-Sync off; other browsers ignore it). Software renderers (SwiftShader, llvmpipe) get a normal canvas:
 * they gain nothing from it, and headless Chromium's SwiftShader stalls reading pixels back from one. */
export function createGameRenderer({antialias, lowLatency}: {antialias: boolean; lowLatency: boolean}) {
  const attributes: WebGLContextAttributes = {alpha: false, antialias, depth: true, stencil: false, premultipliedAlpha: true,
    preserveDrawingBuffer: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false};
  let canvas = document.createElement('canvas');
  let context = lowLatency ? canvas.getContext('webgl2', {...attributes, desynchronized: true, failIfMajorPerformanceCaveat: true}) : null;
  if (context && SOFTWARE_RENDERER.test(rendererName(context))) {
    context.getExtension('WEBGL_lose_context')?.loseContext();
    context = null;
  }
  if (!context) {
    canvas = document.createElement('canvas');
    context = canvas.getContext('webgl2', attributes);
  }
  if (!context) throw new Error('WebGL 2 is unavailable');
  return new THREE.WebGLRenderer({canvas, context, antialias, alpha: false, powerPreference: 'high-performance'});
}

/** Chromium and Safari report a masked "WebKit WebGL" as the renderer, and the real one through the debug extension. */
function rendererName(gl: WebGL2RenderingContext) {
  const renderer = String(gl.getParameter(gl.RENDERER));
  if (!/^webkit webgl$/i.test(renderer)) return renderer;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : renderer;
}
