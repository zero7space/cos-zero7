#!/usr/bin/env python3
"""
Zero7 CRM — Subdomain Provisioner & Verifier Script
Supports automated provisioning, changing, and deleting of client-specific subdomains
with strictly scoped DNS record lifecycle management.

Usage:
  # Provision or Change Subdomain
  python provision_subdomain.py --lead-id <LEAD_ID> --subdomain <SUBDOMAIN> [--html-file <HTML_PATH>] [--api-url <URL>]

  # Delete / De-provision Subdomain
  python provision_subdomain.py --lead-id <LEAD_ID> --action delete [--api-url <URL>]
"""

import sys
import os
import re
import json
import socket
import argparse
import urllib.request
import urllib.error
import ssl

DROPLET_IP = "68.183.92.215"
ROOT_DOMAIN = "zero7.space"
DEFAULT_API_URL = os.environ.get("CRM_SERVER_URL", "https://cos.zero7.space").rstrip("/")

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

def normalize_subdomain(subdomain: str) -> str:
    sub = subdomain.lower().strip()
    sub = re.sub(r"^https?://", "", sub).split("/")[0].split(":")[0].strip()
    if not sub.endswith(f".{ROOT_DOMAIN}"):
        slug = re.sub(r"[^a-z0-9-]+", "-", sub).strip("-")
        if not slug.startswith("proto-"):
            slug = f"proto-{slug}"
        return f"{slug}.{ROOT_DOMAIN}"
    return sub

def verify_dns(subdomain: str) -> tuple[bool, str]:
    try:
        resolved_ip = socket.gethostbyname(subdomain)
        is_droplet = (resolved_ip == DROPLET_IP)
        return is_droplet, resolved_ip
    except Exception as e:
        return False, str(e)

def call_crm_provision(api_url: str, lead_id: str, subdomain: str) -> dict:
    url = f"{api_url}/api/leads/{lead_id}/provision-subdomain"
    payload = json.dumps({"subdomain": subdomain}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=15, context=ssl_ctx) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        # Fallback to local module if running inside workspace
        try:
            from backend.integrations.dns_provisioner import dns_provisioner
            return dns_provisioner.provision_subdomain(lead_id, subdomain)
        except Exception as inner_e:
            return {"error": f"API error: {e} | Local fallback error: {inner_e}"}

def call_crm_deprovision(api_url: str, lead_id: str) -> dict:
    url = f"{api_url}/api/leads/{lead_id}/provision-subdomain"
    req = urllib.request.Request(
        url,
        headers={"Content-Type": "application/json"},
        method="DELETE"
    )
    try:
        with urllib.request.urlopen(req, timeout=15, context=ssl_ctx) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        try:
            from backend.integrations.dns_provisioner import dns_provisioner
            return dns_provisioner.deprovision_subdomain(lead_id)
        except Exception as inner_e:
            return {"error": f"API error: {e} | Local fallback error: {inner_e}"}

def publish_prototype(api_url: str, lead_id: str, html_file: str, subdomain: str) -> dict:
    if not os.path.exists(html_file):
        return {"error": f"File not found: {html_file}"}

    with open(html_file, "r", encoding="utf-8") as f:
        html_content = f.read()

    url = f"{api_url}/api/leads/{lead_id}/publish-prototype"
    payload = json.dumps({
        "title": f"Live Prototype ({subdomain})",
        "description": "Interactive Prototype published via subdomain-provisioner skill",
        "html_content": html_content
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=15, context=ssl_ctx) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}

def main():
    parser = argparse.ArgumentParser(description="Zero7 Subdomain Provisioner & Verifier")
    parser.add_argument("--lead-id", required=True, help="Lead UUID")
    parser.add_argument("--subdomain", default=None, help="Subdomain slug or full domain (e.g. proto-burosys.zero7.space)")
    parser.add_argument("--action", choices=["provision", "change", "delete"], default="provision", help="Action: provision, change, or delete")
    parser.add_argument("--html-file", default=None, help="Path to interactive HTML prototype file to bind and publish")
    parser.add_argument("--api-url", default=DEFAULT_API_URL, help="CRM API Base URL")
    args = parser.parse_args()

    if args.action == "delete":
        res = call_crm_deprovision(args.api_url, args.lead_id)
        print(json.dumps({
            "status": "success" if res.get("success") else "error",
            "action": "delete",
            "lead_id": args.lead_id,
            "response": res
        }, indent=2))
        return

    if not args.subdomain:
        print(json.dumps({"error": "--subdomain is required for action 'provision' or 'change'"}, indent=2))
        sys.exit(1)

    clean_subdomain = normalize_subdomain(args.subdomain)
    prov_res = call_crm_provision(args.api_url, args.lead_id, clean_subdomain)
    dns_ok, resolved_ip = verify_dns(clean_subdomain)

    proto_res = None
    if args.html_file:
        proto_res = publish_prototype(args.api_url, args.lead_id, args.html_file, clean_subdomain)

    live_url = f"https://{clean_subdomain}"
    output = {
        "status": "success" if prov_res.get("success") else "partial",
        "action": args.action,
        "subdomain": clean_subdomain,
        "live_url": live_url,
        "dns_verified": dns_ok,
        "resolved_ip": resolved_ip,
        "provision_response": prov_res,
        "prototype_published": bool(proto_res and proto_res.get("success", False)),
        "pitch_copy": (
            f"Hey! We built a live interactive concept prototype tailored specifically for your workflow.\n"
            f"You can test it right now on your phone or laptop here: {live_url}\n"
            f"Let me know what you think!"
        )
    }

    print(json.dumps(output, indent=2))

if __name__ == "__main__":
    main()
