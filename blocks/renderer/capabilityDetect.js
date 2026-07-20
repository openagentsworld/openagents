import * as THREE from 'three';

export function detectCapabilities(renderer) {
  const gl = renderer.getContext();
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const pixelRatio = Math.min(window.devicePixelRatio, 2);

  // Naive low-end guess based on texture size and renderer string.
  const rendererString = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    : '';
  const isSoftwareRenderer = /(SwiftShader|LLVMPIPE|llvmpipe|Software)/i.test(rendererString);
  const isHeadless = /HeadlessChrome/i.test(navigator.userAgent);
  const isLowEndGuess =
    maxTextureSize <= 4096 || /(Intel|Apple)/i.test(rendererString) || isSoftwareRenderer || isHeadless;

  let preferredTier = 'high';
  if (isLowEndGuess || pixelRatio < 1.5) preferredTier = 'med';
  if (isSoftwareRenderer || isHeadless || maxTextureSize <= 2048) preferredTier = 'low';

  return {
    webgl: true,
    webgpuAvailable: false,
    maxTextureSize,
    pixelRatio,
    isLowEndGuess,
    preferredTier,
    rendererString,
  };
}
