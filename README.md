# FIDA — Fabric IQ Declarative Agents

Build grounded agents for Microsoft Copilot.

Built by [Sandeep Pawar](https://www.fabric.guru). FIDA is an independent community project, not a Microsoft product or project, and is not affiliated with or endorsed by Microsoft.

A web application for creating declarative agents backed by Power BI sources, with personal or shareable deployments. Run locally, or host the experimental community edition on Render.

Data answering is powered by **Fabric IQ** through the configured Power BI MCP action. Microsoft Copilot provides the conversational runtime and composes the final answer. This application does not create Fabric data agent items.

## Features

- Configure Power BI reports and semantic models using full links or bare artifact GUIDs. Select Report or Semantic model for GUID-only sources; links determine their own type.
- Add optional source-routing instructions describing when to use each source, exclusions and overlap priorities. With multiple sources, FIDA prompts for this guidance and includes it in the generated agent instructions; missing routing is a warning, not a publishing blocker.
- Explain artifact grounding with one animated request routed through agent guidance to a relevant Power BI report and semantic model, with other configured sources shown alongside.
- Compare this app with Fabric Data Agent across five documented differences, with Microsoft Learn citations.
- Edit agent instructions and use starter templates, behavior presets and reusable skills.
- Import SKILL.md files and edit supporting reference material.
- Preview generated files and export project source.
- Download a standalone installable ZIP for manual Teams custom-app upload, without FIDA publishing permissions or local CLI commands.
- Validate and publish personal or shareable agents using Microsoft 365 Agents Toolkit.
- Grant or remove chat access for specific users/groups on shareable deployments, and copy the returned sharing link.
- Use **Export draft** in the project toolbar to back up even incomplete drafts, then import their `fida-project.json` in a later session. Restoring creates a new draft and does not reconnect to an existing published agent.

## Run locally

Requires Node.js 22.21.1 or later and a Microsoft 365 work or school account.

```shell
git clone https://github.com/pawarbi/copilot-analytics-studio.git
cd copilot-analytics-studio
npm ci
npm start
```

Open http://127.0.0.1:4317 and sign in. Projects and published packages are stored in the ignored `data` directory.

Publishing does not grant Microsoft Copilot, Fabric IQ or Power BI licenses. Available capabilities depend on your account, source permissions and tenant policies.

## Host on Render Free (experimental)

The included `render.yaml` defines one free Node web service, without a database or persistent disk. Hosted mode uses a separate in-memory Microsoft sign-in and temporary workspace for each browser session; it does not use the server owner's desktop Toolkit account. The hosted build omits development dependencies and skips install scripts for bundled native desktop credential components, which this publisher does not use.

**Status:** automated OAuth, session-isolation, SDK-contract and offline initialization checks pass. Live consent, publishing and sharing with this application's own Entra client registration, including another tenant, still require end-to-end verification. Registration alone does not establish access to every downstream Microsoft publishing API.

1. In Microsoft Entra, register an application for **accounts in any organizational directory**. Copy its Application (client) ID. Create a client secret under **Certificates & secrets** and copy its **Value**, not the secret ID, directly into Render. Never put it in Git or a chat.
2. In Render, select **New > Blueprint**, connect this repository, and use `render.yaml`. Set `FIDA_CLIENT_ID` and `FIDA_CLIENT_SECRET` privately when prompted. Keep the **Free** plan. Build and start commands are already configured.
3. After Render assigns the service's HTTPS URL, open the Entra registration's **Authentication > Add a platform > Web**. Add the exact Render origin followed by `/auth/callback` as its redirect URI. Use the actual assigned URL; do not enable public-client flows or implicit token issuance.
4. Open FIDA and sign in. Initial sign-in requests delegated Microsoft Graph `User.Read` and standard sign-in/offline scopes. Publishing requests additional delegated consent incrementally for the Teams AuthSvc, Developer Portal and Microsoft 365 publishing services. An administrator may need to consent; unavailable API permissions or tenant policies can block this experimental integration.
5. Test a personal agent in your own tenant, verify it in Microsoft Copilot, then test sharing and a consenting user from another tenant before advertising hosted publishing as supported. A consent redirect does not publish: return to **Review & publish** and confirm again.

`FIDA_HOSTED=true` enables hosted mode. `RENDER_EXTERNAL_URL` supplies the public HTTPS origin automatically. For a custom domain, add it in Render, configure the DNS records Render provides, set `FIDA_PUBLIC_ORIGIN` to that HTTPS origin, add its exact `/auth/callback` Web redirect URI in Entra, and redeploy. Only the configured origin is accepted; use its canonical link. Do not change the DNS records serving an existing blog. Render Free supports custom domains and managed TLS.

**Temporary storage:** use **Export draft** in the top-right project toolbar before leaving. This downloads `fida-draft-backup.zip`, a backup for restoring in FIDA, **not an app package for Teams**. Sessions expire after 30 minutes idle (5 minutes before sign-in), after 8 hours absolutely, or on sign-out. Restarts, deployments and free-service sleep can also discard work. Published agents remain in Microsoft Copilot. Draft backups contain maker-authored content but no server-owned deployment identities or authentication cache; extract the ZIP and use **Import draft** to select `fida-project.json`. For local updates to an existing deployment, also export its **source ZIP after publishing**, which retains the approved deployment workspace.

The preview limits each process to 24 sessions, 10 projects per session, and one SDK publishing worker at a time. Free instances have limited memory: worker memory usage under a real publish has not been measured. A busy worker returns a retryable failure rather than starting another. An interrupted or timed-out operation may have made partial cloud changes; inspect Microsoft Copilot before retrying.

Render's [free-service limits](https://render.com/docs/free), [custom domains](https://render.com/docs/custom-domains) and [Blueprint documentation](https://render.com/docs/infrastructure-as-code) describe current hosting behavior. No Render service is created merely by cloning this repository.

## Three publishing options

The final **Review & publish** page presents three routes. Manual upload is recommended for personal installation. Direct publication can publish a shared version after any required hosted consent; running locally supports shared publication without authorizing FIDA's hosted Entra application.

### 1. Upload an installable ZIP (recommended for personal use)

Complete the required agent and publisher fields and choose **Download installable ZIP**. No Personal/Shareable choice is required. This creates `fida-installable-agent.zip` with `manifest.json` at the ZIP root, a resolved app ID, inlined agent instructions, icons, the Fabric IQ MCP action and any configured skills. No publishing API or additional publishing-consent flow is invoked; existing Microsoft sign-in is still required.

1. In Teams, click **+ (Apps)** on the left, then the **gear icon** at the top right to open **Manage your apps > Apps**. Some versions show **Apps > Manage your apps** directly.
2. Select **Upload an app > Upload a custom app**.
3. Choose `fida-installable-agent.zip` **without extracting it**, then select **Add**.
4. Open **Microsoft Copilot > Agents**. The agent may take a few minutes to appear; check **All agents** if needed.

This is different from **Submit an app to your org**, which requests organization approval. Tenant policies still apply, including [advanced package upload controls](https://learn.microsoft.com/copilot/manage/configure-copilot-advanced-package-uploads) for agents with actions/MCP, source permissions and licensing. Package validation does not prove that the agent is installed, that this tenant permits upload, or that its Power BI runtime queries succeed.

**Choose the right file:** **Download installable ZIP** is the only download to use for this Teams upload. **Export draft** in the project toolbar downloads `fida-draft-backup.zip` for restoration in FIDA only. **Export source ZIP**, under **Advanced: Toolkit source and file preview**, downloads an editable Toolkit project with `appPackage` and `env` folders, not an uploadable app. Do not upload source or draft ZIPs in Teams.

Manual upload has its own app identity, stable while downloading from the same FIDA project, and does not inherit direct-publishing deployment IDs or sharing grants. Direct-publishing Personal/Shareable selections do not grant an audience to manual uploads. Keep the installable ZIP for future manual updates and increment the package version while preserving its manifest app ID. A restored draft creates a new project and a new manual app identity. FIDA does not track the installation or sharing of manually uploaded packages.

### 2. Publish directly from FIDA

Hosted publication requests authorization for FIDA's publishing permissions. If the publishing organization requires administrator approval, its administrator must consent in that tenant. Approval is usually once per organization for the approved permissions, not once per agent; new permissions, revoked consent or policy changes can require further approval. Consent in the registration's home tenant does not approve other organizations. The current integration remains experimental as described above.

In option 2, explicitly choose **Personal — just me** or **Shareable — selected people** under **Direct-publishing audience**, then confirm publishing. This choice applies to direct publishing and Toolkit source exports, not manual installation. Both radio options are visible; neither is selected for a new project. Your choice is saved, and existing projects retain their saved mode. The modes use separate workspaces and published identities. Existing personal projects continue using their original workspace. Switching the draft mode does not delete or revoke access to either published agent.

After publishing a shareable agent, select **Manage sharing**. Enter up to 20 user or group email addresses and confirm **Add chat access** or **Remove chat access**. Copying the sharing link does not grant permissions. Recipient changes use the signed-in publishing account and the Toolkit's sharing commands; they do not grant editing rights or Power BI access. A group member can retain access through another group even after an individual grant is removed.

The recipient list records only successful changes made through FIDA, not live service permissions or group membership. If a command fails or times out, inspect the log and actual access before retrying: partial service changes may have occurred. Tenant policies can block sharing. Organization-wide catalog submission is not implemented, and Copilot's native **Share agent** menu is not guaranteed.

### 3. Run FIDA locally

This is the recommended route for a shareable agent when avoiding authorization to FIDA's hosted application. It is not authentication-free: local publishing uses Microsoft Agents Toolkit authentication and remains subject to Toolkit consent, source access, licensing and tenant policies.

1. Use **Export draft** to back up your hosted agent.
2. Follow [Run locally](#run-locally) above to install Node.js and Git, clone the repository, run `npm ci` and start the app with `npm start`.
3. Open http://127.0.0.1:4317 and sign in with your Microsoft work or school account.
4. Extract `fida-draft-backup.zip`. In the local app, choose **Import draft** and select `fida-project.json`, or create a new agent. Restoring creates a new draft, not an update connection to an existing published agent.
5. On **Review & publish**, choose **Shareable — selected people** in option 2 and confirm publication.
6. Use **Manage sharing** to grant **Add chat access** to user/group emails and copy the sharing link. Recipients need their own source permissions and licenses.

## Validation

```shell
npm test
npm run test:browser
npm run test:schema
```

Browser tests require Microsoft Edge. OAuth and publishing tests use isolated test doubles; schema validation and the SDK initialization smoke test use the installed Toolkit/SDK without publishing.

## Current scope

Local mode uses the Toolkit account on the same computer. Hosted mode has isolated temporary browser sessions and an experimental delegated SDK publisher; live hosted publication and cross-tenant consent are not yet verified. Persistent hosted projects, organization-wide deployment and querying a published agent from FIDA are not implemented.

This is a community project, not an official Microsoft product.

## Icon attribution

The educational diagram uses unmodified Microsoft Copilot, Fabric, Power BI, report and semantic model icons from [Microsoft's official Fabric icon collection](https://learn.microsoft.com/fabric/fundamentals/icons). These icons identify Microsoft products and artifacts, not this application. The original package license is included in `public/icons/LICENSE`.
