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

Choose checks for the files and behavior changed. The commands below cover code
changes; documentation-only edits need a diff and reference review, not a full
build. Keep required CI checks in place and report any checks that could not run.

```bash
npm run type-check
npm run build
```

When changing public protocol shapes or exported SDK types, run the affected
downstream plugin checks when available. If a consumer is unavailable, document
the compatibility risk and rely on its CI or follow-up validation; do not make
access to every plugin repo a prerequisite for updating this SDK.
