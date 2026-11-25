---
name: subdomain-provisioner
description: Provisions, registers, changes, and de-provisions live client prototype subdomains (proto-{client}.zero7.space) via automated DNS lifecycle management and Droplet Nginx routing. Use when deploying, updating, or deleting client prototype subdomains.
---

# Subdomain Provisioner Skill

This skill allows the agent to automatically allocate, configure, change, and publish live interactive prototypes on custom Zero7 client subdomains (e.g., `proto-{client}.zero7.space`).

## When to Use
- Whenever generating an interactive HTML mockup or full-page prototype for a lead.
- When asked to "make the prototype live", "assign a subdomain", "change the subdomain", or "delete/remove the subdomain".
- When preparing an outreach WhatsApp pitch hook that needs a clickable live demo link.

## Architecture
1. **Scoped DNS Lifecycle**: Automatically creates, modifies, and deletes client-specific A records on `zero7.space`. When changing a subdomain, the previous record is automatically deleted first. Core system records (`cos`, `@`, `mail`) are strictly safeguarded and can never be modified.
2. **Host Routing**: Zero7 Droplet (`68.183.92.215`) has an Nginx catch-all reverse proxy for `*.zero7.space`. Any incoming request matching a lead's assigned subdomain is routed directly to FastAPI and serves that client's interactive prototype shell.
3. **Subdomain Verification**: The CRM verifies DNS resolution via `POST /api/leads/{id}/provision-subdomain` and updates `lead.subdomain`, `lead.dns_record_id`, and `lead.subdomain_status = 'active'`.
4. **Automated Publishing**: The prototype HTML is registered via `POST /api/leads/{id}/publish-prototype`.

## Execution Workflow

### 1. Provision or Change Subdomain & Publish HTML Prototype
```bash
python .agents/skills/subdomain-provisioner/scripts/provision_subdomain.py \
  --lead-id "<LEAD_ID>" \
  --subdomain "proto-<CLIENT_SLUG>.zero7.space" \
  --html-file "<PATH_TO_GENERATED_HTML>"
```

### 2. De-provision / Delete Subdomain
```bash
python .agents/skills/subdomain-provisioner/scripts/provision_subdomain.py \
  --lead-id "<LEAD_ID>" \
  --action delete
```

### Parameters
- `--lead-id`: The target lead's UUID in the CRM.
- `--subdomain`: The desired subdomain slug (e.g. `proto-burosys.zero7.space` or simply `burosys`). Required for provision/change.
- `--action`: `provision` (default), `change`, or `delete`.
- `--html-file`: Path to the generated single-file HTML prototype on disk.
- `--api-url`: Optional CRM base URL (defaults to `https://cos.zero7.space`).

## Output Format
The script returns a JSON object containing:
- `live_url`: `https://proto-{slug}.zero7.space`
- `dns_verified`: Boolean indicating reachability
- `provision_response`: Details from the DNS provider including `dns_record_id`
- `pitch_copy`: A ready-to-send WhatsApp pitch message incorporating the live link

Always include the `live_url` in your final response to the user!
