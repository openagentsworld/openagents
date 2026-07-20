export function createDebugHud() {
  const container = document.createElement('div');
  container.className = 'debug-hud';
  document.body.appendChild(container);

  const state = {
    fps: 0,
    calls: 0,
    triangles: 0,
    loadedAssets: 0,
    tier: 'med',
    hovered: '-',
  };

  let lastTime = performance.now();
  let frames = 0;

  function update(rendererInfo) {
    const now = performance.now();
    frames++;
    if (now - lastTime >= 1000) {
      state.fps = frames;
      frames = 0;
      lastTime = now;
      state.calls = rendererInfo.render.calls;
      state.triangles = rendererInfo.render.triangles;
      render();
    }
  }

  function set(key, value) {
    state[key] = value;
    render();
  }

  function render() {
    container.innerHTML = `
      <div>FPS: <b>${state.fps}</b></div>
      <div>Calls: ${state.calls}</div>
      <div>Tris: ${(state.triangles / 1000).toFixed(1)}k</div>
      <div>Assets: ${state.loadedAssets}</div>
      <div>Quality: ${state.tier}</div>
      <div>Hover: ${state.hovered}</div>
    `;
  }

  render();

  return { update, set, element: container };
}
