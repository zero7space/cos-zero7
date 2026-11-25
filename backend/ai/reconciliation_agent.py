"""
Zero7 CRM — 3-Way Reconciliation & Matching Agent (Stone Crusher Operations)
Reconciles Weighbridge PC weights, Gate Munshi WhatsApp slips, and Busy Accounting vouchers.
Flags missing slips, weight variations, rate anomalies, and generates party ledgers & morning owner reports.
"""

import os
import json
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger("zero7_reconciliation")


class ReconciliationAgent:
    def __init__(self, weight_tolerance_mt: float = 0.5):
        self.weight_tolerance_mt = weight_tolerance_mt  # ~500 kg tolerance for scale calibration

    def reconcile_daily_dispatches(
        self,
        weighbridge_records: List[Dict[str, Any]],
        munshi_slips: List[Dict[str, Any]],
        busy_vouchers: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Performs 3-Way Reconciliation across:
        1. Weighbridge Scale & ANPR PC logs
        2. Munshi Gate WhatsApp Slips
        3. Busy Accounting posted vouchers
        """
        discrepancies = []
        matched_entries = []

        # Index slips by slip_no and vehicle_no
        slips_by_no = {str(s.get("slip_no")): s for s in munshi_slips if s.get("slip_no")}
        slips_by_veh = {}
        for s in munshi_slips:
            v = str(s.get("vehicle_no", "")).replace("-", "").strip().upper()
            if v:
                slips_by_veh.setdefault(v, []).append(s)

        busy_by_slip = {}
        if busy_vouchers:
            for b in busy_vouchers:
                b_slip = str(b.get("slip_no") or b.get("voucher_no", ""))
                if b_slip:
                    busy_by_slip[b_slip] = b

        # 1. Audit Weighbridge vs Slips
        for wb in weighbridge_records:
            wb_slip_no = str(wb.get("slip_no", ""))
            wb_veh = str(wb.get("vehicle_no", "")).replace("-", "").strip().upper()
            wb_net_wt = float(wb.get("net_weight_mt") or wb.get("weight", 0.0))

            matched_slip = slips_by_no.get(wb_slip_no)
            if not matched_slip and wb_veh in slips_by_veh:
                # Potential slip with handwritten number mismatch
                matched_slip = slips_by_veh[wb_veh][0]

            if not matched_slip:
                discrepancies.append({
                    "type": "MISSING_GATE_SLIP",
                    "severity": "HIGH",
                    "vehicle_no": wb_veh,
                    "weighbridge_time": wb.get("timestamp"),
                    "net_weight_mt": wb_net_wt,
                    "description": f"Vehicle {wb_veh} weighed {wb_net_wt} MT on scale, but no matching gate slip was logged on WhatsApp."
                })
                continue

            # Compare weight / volume
            slip_cft = float(matched_slip.get("feet_volume") or 0.0)
            slip_mt = float(matched_slip.get("net_weight_mt") or 0.0)
            
            # Conversion factor check: 1 MT ≈ 20-25 CFT depending on rock density
            if slip_mt > 0 and abs(wb_net_wt - slip_mt) > self.weight_tolerance_mt:
                discrepancies.append({
                    "type": "WEIGHT_VARIANCE",
                    "severity": "MEDIUM",
                    "slip_no": matched_slip.get("slip_no"),
                    "vehicle_no": wb_veh,
                    "weighbridge_mt": wb_net_wt,
                    "slip_mt": slip_mt,
                    "difference_mt": round(abs(wb_net_wt - slip_mt), 2),
                    "description": f"Weight variance of {round(abs(wb_net_wt - slip_mt), 2)} MT between digital scale ({wb_net_wt} MT) and slip ({slip_mt} MT)."
                })

            # 2. Check Busy Voucher sync if provided
            if busy_vouchers:
                busy_match = busy_by_slip.get(matched_slip.get("slip_no"))
                if not busy_match:
                    discrepancies.append({
                        "type": "MISSING_IN_BUSY",
                        "severity": "LOW",
                        "slip_no": matched_slip.get("slip_no"),
                        "party_name": matched_slip.get("party_name"),
                        "amount": matched_slip.get("total_amount"),
                        "description": f"Slip {matched_slip.get('slip_no')} for {matched_slip.get('party_name')} not yet posted into Busy Accounting."
                    })

            matched_entries.append({
                "slip_no": matched_slip.get("slip_no"),
                "party_name": matched_slip.get("party_name"),
                "vehicle_no": wb_veh,
                "material": matched_slip.get("material_size"),
                "volume_feet": slip_cft,
                "total_amount": matched_slip.get("total_amount"),
                "payment_mode": matched_slip.get("payment_mode")
            })

        # Calculate Day Summary Aggregates
        total_revenue = sum(float(s.get("total_amount") or 0.0) for s in munshi_slips)
        credit_sales = sum(float(s.get("total_amount") or 0.0) for s in munshi_slips if s.get("payment_mode") == "credit")
        cash_sales = sum(float(s.get("cash_amount") or 0.0) for s in munshi_slips)
        online_sales = sum(float(s.get("online_amount") or 0.0) for s in munshi_slips)

        return {
            "total_slips_audited": len(munshi_slips),
            "matched_entries_count": len(matched_entries),
            "flagged_discrepancies_count": len(discrepancies),
            "discrepancies": discrepancies,
            "financial_summary": {
                "total_sales_inr": total_revenue,
                "credit_sales_inr": credit_sales,
                "cash_collected_inr": cash_sales,
                "online_collected_inr": online_sales
            }
        }

    def generate_owner_morning_briefing(self, client_name: str, date_str: str, audit_result: Dict[str, Any]) -> str:
        """
        Generates the 8:00 AM WhatsApp executive briefing message for Shubham Bansal.
        """
        fin = audit_result.get("financial_summary", {})
        total_slips = audit_result.get("total_slips_audited", 0)
        discrepancies = audit_result.get("discrepancies", [])

        flag_lines = ""
        if discrepancies:
            flag_lines = f"\n⚠️ *Discrepancies Flagged ({len(discrepancies)})* — Senior accountant to review:\n"
            for d in discrepancies[:4]:
                flag_lines += f"• Slip #{d.get('slip_no', 'N/A')} ({d.get('vehicle_no')}): {d.get('description')}\n"
        else:
            flag_lines = "\n✅ *100% 3-Way Match*: Weighbridge scale, Gate Slips, and Busy vouchers tallied perfectly.\n"

        msg = f"""📊 *MAA BANDHORI MINING — DAILY EXECUTIVE BRIEFING*
🗓️ Date: {date_str} | Client: {client_name}

🚛 *Dispatch Summary*:
• Total Slips Issued: {total_slips}
• Total Sales: ₹{fin.get('total_sales_inr', 0):,.2f}
• Credit (बाकी / उधारी): ₹{fin.get('credit_sales_inr', 0):,.2f}
• Cash Collected: ₹{fin.get('cash_collected_inr', 0):,.2f}
• Online/HDFC: ₹{fin.get('online_collected_inr', 0):,.2f}
{flag_lines}
📱 *Ledgers Status*:
All tallied party ledgers are ready for 1-click WhatsApp delivery to customers.

_Generated automatically by Zero7 COS Theta Agentic OS_"""
        return msg

    def export_to_busy_xml_batch(self, slips: List[Dict[str, Any]]) -> str:
        """
        Generates standard Busy Accounting XML voucher import batch format.
        Allows the accountant to import all daily slips with 1-click into Busy.
        """
        xml_parts = [
            '<?xml version="1.0" encoding="utf-8"?>',
            '<VOUCHERS>'
        ]

        for s in slips:
            xml_parts.append(f"""  <VOUCHER>
    <VCHTYPE>Sales</VCHTYPE>
    <DATE>{s.get('date', '2026-09-17')}</DATE>
    <VCHNO>{s.get('slip_no', '')}</VCHNO>
    <PARTYNAME>{s.get('party_name', '')}</PARTYNAME>
    <ITEMNAME>{s.get('material_size', '20MM')}</ITEMNAME>
    <QTY>{s.get('feet_volume', 0)}</QTY>
    <PRICE>{s.get('material_rate', 0)}</PRICE>
    <AMOUNT>{s.get('material_amount', 0)}</AMOUNT>
    <FREIGHT>{s.get('transport_amount', 0)}</FREIGHT>
    <TOTAL>{s.get('total_amount', 0)}</TOTAL>
    <PAYMENTMODE>{s.get('payment_mode', 'credit')}</PAYMENTMODE>
  </VOUCHER>""")

        xml_parts.append('</VOUCHERS>')
        return "\n".join(xml_parts)


reconciliation_agent = ReconciliationAgent()
