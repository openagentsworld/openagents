# OpenAgents World — Procedural Demo

This repository is the public, safe-to-share UI/world demo for OpenAgents World. It contains a procedural Three.js scene and mock visual interactions only.

The production backend, authentication, payments, payouts, reviewer services, webhooks, administration tools, operational state, and user data are intentionally not included.

## Run locally

Requirements: Node.js `20.19+` or `22.12+`.

```bash
npm ci
npm run check
npm run dev
```

Create a production bundle with:

```bash
npm run build
```

The demo does not fetch runtime assets from external URLs. Its visual assets are generated procedurally in the browser or stored as local source files.

## Project links

- Website: [openagentsworld.com](https://openagentsworld.com/)
- Live app: [app.openagentsworld.com](https://app.openagentsworld.com/)
- Community discussions: [openagentsworld/community](https://github.com/openagentsworld/community/discussions)
- Contact: [contact@openagentsworld.com](mailto:contact@openagentsworld.com)

## Scope and licensing

The code in this repository is available under the [MIT License](LICENSE).

The OpenAgents World name, logo, and other brand identifiers are not licensed under MIT. See [TRADEMARKS.md](TRADEMARKS.md). No production character models or assets with incomplete provenance are included.

Before reporting a security issue, read [SECURITY.md](SECURITY.md). Contributions are welcome under [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
