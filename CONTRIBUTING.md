# Contributing to SWAL Agent Runner

> **Southwest AI Labs (SWAL)** — Sovereign Intelligence Ecosystem

Thank you for your interest in contributing to `swal-agent-runner`! We welcome contributions from developers of all skill levels.

## Code of Conduct

Please maintain a respectful, inclusive, and professional environment in all issues, pull requests, and discussions.

## How to Contribute

1. **Fork and Clone**:
   ```bash
   git clone https://github.com/swal-labs/swal-agent-runner.git
   cd swal-agent-runner
   ```

2. **Install Dependencies**:
   ```bash
   pnpm install
   ```

3. **Development Workflows**:
   - Start the local Vite development server with COEP/COOP headers:
     ```bash
     pnpm run dev
     ```
   - Build the production bundle and service worker:
     ```bash
     pnpm run build
     ```
   - Execute the test battery (unit & integration):
     ```bash
     pnpm run test
     ```

4. **SWAL Development Standards**:
   - **Zero Desktop Dependencies**: Do not introduce native desktop-only Node APIs or dependencies. All Git operations and storage must use `isomorphic-git` + LightningFS in IndexedDB.
   - **Cross-Platform Parity**: Features must function equally on PC Desktop browsers and Android Chrome standalone PWA.
   - **Testing & Verification**: Always include test coverage for new features or bug fixes. Ensure `pnpm test` and `pnpm build` pass cleanly.
   - **Docs Standards**: Update `SRC.md`, `AGENTS.md`, or SRS specifications when modifying architecture or adding new capabilities.

5. **Submit a Pull Request**:
   - Create a feature branch (e.g. `feat/my-feature`, `fix/issue-description`, `docs/update`).
   - Push your branch and open a PR against `main`.
   - Ensure all GitHub Actions CI checks pass.

## Licensing

By contributing to this repository, you agree that your contributions will be licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0-only)** and subject to the SWAL Contributor License Agreement (`CLA.md`).
