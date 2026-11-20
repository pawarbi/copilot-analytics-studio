# Copilot Analytics Studio

A local web application for creating Microsoft 365 declarative agents backed by Power BI sources, with personal or shareable deployments.

Data answering is powered by **Fabric IQ** through the configured Power BI MCP action. Microsoft 365 Copilot provides the conversational runtime and composes the final answer. This application does not create Fabric data agent items.

## Features

- Configure Power BI reports and semantic models using full links or bare artifact GUIDs. Select Report or Semantic model for GUID-only sources; links determine their own type.
- Explain artifact grounding with one animated request routed through agent guidance to a relevant Power BI report and semantic model, with other configured sources shown alongside.
- Compare this app with Fabric Data Agent across five documented differences, with Microsoft Learn citations.
- Edit agent instructions and use starter templates, behavior presets and reusable skills.
- Import SKILL.md files and edit supporting reference material.
- Preview generated files and export project source.
- Validate and publish personal or shareable agents using Microsoft 365 Agents Toolkit.
- Grant or remove chat access for specific users/groups on shareable deployments, and copy the returned sharing link.

## Run locally

Requires Node.js 22.21.1 or later and a Microsoft 365 work or school account.

```shell
npm ci
npm start
```

Open http://127.0.0.1:4317 and sign in. Projects and published packages are stored in the ignored `data` directory.

Publishing does not grant Microsoft 365 Copilot, Fabric IQ or Power BI licenses. Available capabilities depend on your account, source permissions and tenant policies.

## Publishing and sharing

In **Review & publish**, choose **Personal — just me** (the default) or **Shareable — selected people**, then confirm publishing. The modes use separate workspaces and published identities. Existing personal projects continue using their original workspace. Switching the draft mode does not delete or revoke access to either published agent.

After publishing a shareable agent, select **Manage sharing**. Enter up to 20 user or group email addresses and confirm **Add chat access** or **Remove chat access**. Copying the sharing link does not grant permissions. Recipient changes use the signed-in publishing account and the Toolkit's sharing commands; they do not grant editing rights or Power BI access. A group member can retain access through another group even after an individual grant is removed.

The recipient list records only successful changes made through this Studio, not live service permissions or group membership. If a command fails or times out, inspect the log and actual access before retrying: partial service changes may have occurred. Tenant policies can block sharing. Organization-wide catalog submission is not implemented, and Copilot's native **Share agent** menu is not guaranteed.

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

The educational diagram uses unmodified Microsoft Copilot, Fabric, Power BI, report and semantic model icons from [Microsoft's official Fabric icon collection](https://learn.microsoft.com/fabric/fundamentals/icons). These icons identify Microsoft products and artifacts, not this application. The original package license is included in `public/icons/LICENSE`.
