# AGENTS.md

Guidelines for Codex and other agents working in `useorgx/orgx-gateway-sdk`.

## Project

This repo is the shared TypeScript Gateway Protocol SDK used by OrgX peer plugins.

## Setup

For Codex cloud, use:

```bash
bash .codex/setup-cloud.sh
```

Maintenance script for cached environments:

```bash
bash .codex/maintenance-cloud.sh
```

## Verification

```bash
npm run type-check
npm run build
```

Run downstream plugin checks when changing public protocol shapes or exported SDK types.
