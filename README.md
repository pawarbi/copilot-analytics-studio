# Copilot Analytics Studio

A local web application for creating and personally publishing Microsoft 365 declarative agents backed by Power BI sources.

## Features

- Configure Power BI reports and semantic models.
- Explain artifact grounding with one animated request routed through agent guidance to a relevant Power BI report and semantic model, with other configured sources shown alongside.
- Edit agent instructions and use starter templates, behavior presets and reusable skills.
- Import SKILL.md files and edit supporting reference material.
- Preview generated files and export project source.
- Validate and publish to your account using Microsoft 365 Agents Toolkit.

## Run locally

Requires Node.js 22.21.1 or later and a Microsoft 365 work or school account.

```shell
npm ci
npm start
```

Open http://127.0.0.1:4317 and sign in. Projects and published packages are stored in the ignored `data` directory.

Publishing does not grant Microsoft 365 Copilot, Fabric IQ or Power BI licenses. Available capabilities depend on your account, source permissions and tenant policies.

## Validation

```shell
npm test
npm run test:browser
npm run test:schema
```

Browser tests require Microsoft Edge. Unit and browser tests use an isolated Toolkit test double; schema validation uses the installed Toolkit without publishing.

## Current scope

This version runs locally and uses the Toolkit account on the same computer. It is not configured for shared public hosting. Per-user hosted authentication, Render deployment and published-agent querying are not implemented.

This is a community project, not an official Microsoft product.

## Icon attribution

The educational diagram uses unmodified Power BI, report and semantic model icons from [Microsoft's official Fabric icon collection](https://learn.microsoft.com/fabric/fundamentals/icons). These icons identify Microsoft products and artifacts, not this application. The original package license is included in `public/icons/LICENSE`.
