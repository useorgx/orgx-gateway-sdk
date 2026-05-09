# Codex Cloud Environment

Use these repo-local scripts when configuring the Codex cloud environment for `useorgx/orgx-gateway-sdk`.

## Setup script

```bash
bash .codex/setup-cloud.sh
```

## Maintenance script

```bash
bash .codex/maintenance-cloud.sh
```

## Environment notes

- Node 22 or newer is safe for this repository.
- No OrgX API secrets are required for type checking or building the SDK.
- Keep internet access limited to the setup phase unless a task explicitly needs external services.

## Verification commands

```bash
npm run type-check
npm run build
npm test
```
