# Azure Production Status and Pricing (2026-02-25)

## Current Status

- Resource groups created:
  - `rg-menumanager-staging`
  - `rg-menumanager-prod`
- App Service quota blocker previously seen (`SubscriptionIsOverQuotaForSku`) is now cleared.
- App Service deployment created successfully in Azure portal (production path unblocked).

## Chosen Deployment Approach

- Azure-first deployment.
- App Service preferred runtime for Microsoft ecosystem alignment.
- Single production App Service Plan hosting multiple Menu Manager web apps.

## Next Steps (Deferred Until Post-Demo)

1. Confirm App Service Plan details:
   - resource group: `rg-menumanager-prod`
   - region: `East US`
   - OS: `Linux`
   - SKU: `B1`
2. Create production web apps on that plan:
   - dashboard
   - db
   - parser
   - ai-review
   - differ
   - clickup-integration
3. Set production app settings/env vars on each service.
4. Replace localhost inter-service calls with environment-based HTTPS service URLs.
5. Deploy code and run smoke tests.
6. Point ClickUp webhook to production endpoint and validate signature flow.

## ClickUp Production Values (Current)

- `CLICKUP_TEAM_ID=8572371`
- `CLICKUP_LIST_ID=901408496144`
- `CLICKUP_ASSIGNEE_ID=114079264`
- `CLICKUP_WEBHOOK_SECRET=<set in Azure app settings>`
- `CLICKUP_CORRECTIONS_STATUS=<must exactly match an existing ClickUp status>`

## Demo Price Estimate (One Production Environment)

Assumptions:
- 1x App Service Plan (`B1`, Linux, East US)
- 6 web apps hosted on the same plan (no additional plan charge per app)
- No paid custom SSL add-ons beyond standard managed cert path
- Low-to-moderate pilot traffic and logging

Breakdown by service type:

| Service type | Estimate / month | Notes |
|---|---:|---|
| App Service compute (Linux B1, 1 instance) | **~$55** | Main fixed cost. All apps share this plan. |
| Persistent storage (documents/log artifacts) | **~$1-$4** | Depends on retained GB and transactions. |
| Data transfer (egress) | **~$2-$10** | Depends on outbound traffic volume. |
| Monitoring/logs (Azure Monitor / App Insights) | **~$0-$12** | Depends on ingestion and retention settings. |
| Optional domain/SSL extras | **~$0-$6** | Can be $0 when using free managed cert path. |

Estimated total:
- **Expected monthly range: ~$60-$80**
- **Single demo number to present: ~$70/month**

Pricing behavior to call out in demos:
- Billing is mostly on the App Service Plan instance, not app count.
- Cost variance is typically driven by logs and bandwidth usage.

Note:
- Final billed amount depends on actual network egress, diagnostics retention, and any paid add-ons after go-live.

## OpenAI API Cost Estimate (Added 2026-02-26)

Yes, OpenAI API usage is a separate variable cost on top of cloud hosting.

Current repo note:
- `services/ai-review/index.ts` is currently configured to call `gpt-4o`.

Pricing reference used:
- `gpt-4o` text pricing: **$2.50 / 1M input tokens**, **$10.00 / 1M output tokens**.
- `gpt-4.1-mini` text pricing: **$0.40 / 1M input tokens**, **$1.60 / 1M output tokens**.
- `gpt-4o-mini` text pricing: **$0.15 / 1M input tokens**, **$0.60 / 1M output tokens**.

Scenario assumptions for estimate:
- Around **10 submissions/day** (about **300/month**).
- Around **1-2 model calls per submission** (QA check + review flow and occasional reruns).

Estimated OpenAI monthly cost at 10 submissions/day:

| Usage scenario | Assumed token usage | Estimated monthly API cost |
|---|---|---:|
| Low | ~4k input + ~0.8k output per submission (about 1 call) | **~$5-$8/mo** |
| Medium | ~8k input + ~1.5k output per submission (about 1.5 calls avg) | **~$12-$20/mo** |
| High | ~15k input + ~3k output per submission (about 2 calls) | **~$30-$45/mo** |

Estimated OpenAI monthly cost at 10 submissions/day using smaller models:

| Model | Low usage | Medium usage | High usage |
|---|---:|---:|---:|
| `gpt-4.1-mini` | **~$1-$2/mo** | **~$2-$4/mo** | **~$5-$9/mo** |
| `gpt-4o-mini` | **~$0.50-$1/mo** | **~$1-$2/mo** | **~$2-$4/mo** |

Cost optimization takeaway:
- If quality holds, moving from `gpt-4o` to `gpt-4.1-mini` or `gpt-4o-mini` can reduce API spend materially for the same traffic profile.

Important:
- These are planning ranges, not a bill guarantee.
- Actual cost depends on prompt length, menu length, and number of reruns.

## AWS vs Azure Cost Conclusion (Updated 2026-02-26)

Assumptions for comparison:
- Same app behavior and integrations.
- One production environment.
- Low traffic profile (around 10 submitters, about 10 menu submissions/day total).
- Current architecture runs multiple Node services concurrently.

Cost conclusion:
- Azure (current target): **~$60-$80/month**.
- AWS Lightsail realistic minimum for this repo shape (not $7, likely 2 GB tier + backups/logging): **~$12-$25/month**.
- Estimated AWS savings vs Azure: **~$35-$68/month** (roughly **45%-80% lower** infra spend).

Recommendation:
- If your only goal is lowest monthly infra cost and you accept more ops ownership, AWS can be materially cheaper.
- If your goal is easiest enterprise fit with a Microsoft-centric client and future Azure governance, stay on Azure.

Key tradeoffs if choosing AWS over Azure:
- Pros:
  - Lower base hosting cost.
  - Full control of one VM-style deployment.
- Cons:
  - More operational burden (patching, process supervision, backups, failover, monitoring setup).
  - Less native alignment with Microsoft IT controls and enterprise approval paths.
  - Higher blast radius if all services run on one small host.

Microsoft ecosystem compatibility from AWS:
- Integrations to Microsoft 365/Teams are still possible from AWS using Microsoft Graph.
- Sending files to Teams folders is not blocked by AWS hosting.
- You still need Azure AD app registration, permissions, and tenant admin approval either way.

## Plain-English Tradeoffs (For Non-Technical Stakeholders)

If the company is already Microsoft-based, using AWS can still work, but it usually means more manual ownership on our side.

Simple explanation:

1. More maintenance work
- AWS in this setup is like managing your own house.
- We handle updates, restarts, and health checks more directly.
- Azure App Service handles more of this by default.

2. More custom setup
- Monitoring, alerts, backups, and recovery steps need more manual configuration.
- Azure has tighter built-in paths for these app-hosting needs.

3. Harder outage recovery unless we pay for extra setup
- One small AWS server is lower cost but higher risk.
- To reduce downtime risk, we add extra servers and failover, which increases cost and complexity.

4. More internal coordination in Microsoft-first organizations
- AWS is outside the default Microsoft operating model.
- Security/governance approvals can be slower depending on internal IT policy.

Bottom line:
- **AWS:** lower starting cost, more do-it-yourself operations.
- **Azure:** higher starting cost, simpler long-term operations in a Microsoft-first environment.
