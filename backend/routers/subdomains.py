"""
COS Theta — Subdomains & DNS Reconciliation Router
Manages custom client subdomain routes, DNS provisioning, and discrepancy reconciliation.
"""

from fastapi import APIRouter, Depends, HTTPException
from backend.database import Repository
from backend.auth import require_auth, require_admin

router = APIRouter(tags=["subdomains"])


@router.get("/api/subdomains/reconciliation")
def get_subdomain_reconciliation(user: dict = Depends(require_auth)):
    """Returns discrepancy report between Hostinger DNS records and CRM database."""
    from backend.integrations.dns_provisioner import dns_provisioner
    return dns_provisioner.reconcile_dns_records(auto_fix=False)


@router.post("/api/subdomains/reconciliation/fix")
def fix_subdomain_reconciliation(user: dict = Depends(require_admin)):
    """Auto-fixes discrepancies between Hostinger DNS and CRM leads (cleans orphans, provisions missing)."""
    from backend.integrations.dns_provisioner import dns_provisioner
    return dns_provisioner.reconcile_dns_records(auto_fix=True)


@router.get("/api/subdomains/{subdomain}")
def get_subdomain_route_endpoint(subdomain: str):
    route = Repository.get_subdomain_route(subdomain)
    if not route:
        raise HTTPException(status_code=404, detail="Subdomain route not found")
    return {"route": route}
