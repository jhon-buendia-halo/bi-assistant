#!/usr/bin/env python3
"""Write the Intellify Testing Data seed: a PostgreSQL schema plus synthetic data.

Source model: the Halo x Marsh "Intellify Data Model" ERD and data dictionary
(49 entities, 243 attributes). Mongo field paths become snake_case columns
(client_clientId -> client_client_id, _id -> id); every column comment names its
source field and carries the dictionary's description. ObjectIds are char(24) hex,
embedded objects are jsonb. Every drawn relationship that has a field, and every
undrawn foreign key the dictionary lists, is declared as a real foreign key.

All rows are synthetic and deterministic: running this again rewrites the seed byte
for byte. Change this script and regenerate; never edit the seed by hand.
See specs/capabilities/testing-data/spec.md (R4). Standard library only:
    python3 scripts/generate-intellify-seed.py [output.sql.gz]
"""
import gzip
import json
import os
import random
import re
import sys
from datetime import date, datetime, timedelta, timezone

rng = random.Random(20261014)
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "backend", "src", "modules", "testing-data", "fixtures",
    "003_intellify.sql.gz")

# ---------------------------------------------------------------- schema ---
# (table, grain/purpose, [(mongo_field, type, key, ref)])
# type: oid | text | int | bool | date | ts | json ; key: PK | UK | FK | '' ; ref: table or table(col)
T = []


def table(name, comment, cols):
    T.append((name, comment, cols))


table("clients", "One row per employer client. The central hub of the model.", [
    ("_id", "oid", "PK", None), ("oneCode", "text", "UK", None), ("name", "text", "", None),
    ("tenantKey", "text", "", None), ("deleted", "bool", "", None)])
table("contacts", "One row per contact. People associated with a client.", [
    ("_id", "oid", "PK", None), ("clients_clientId", "oid", "FK", "clients"),
    ("location_countryId", "oid", "FK", "countries"), ("email", "text", "", None), ("contactType", "text", "", None)])
table("countries", "One row per country. ISO-style country reference list.", [
    ("_id", "oid", "PK", None), ("code", "text", "", None), ("name", "text", "", None)])
table("products", "One row per line of coverage (LOC): medical, dental, vision, life, disability and so on.", [
    ("_id", "oid", "PK", None), ("name", "text", "", None), ("locType", "text", "", None),
    ("displayOrder", "int", "", None), ("deleted", "bool", "", None)])
table("products_hierarchies", "One row per node in the product tree. Self-referencing.", [
    ("_id", "oid", "PK", None), ("parent", "oid", "FK", "products_hierarchies"), ("displayName", "text", "", None),
    ("level", "int", "", None), ("displayOrder", "int", "", None)])
table("product_groups", "One row per product group. Top-level grouping above the product hierarchy.", [
    ("_id", "oid", "PK", None), ("name", "text", "", None), ("displayOrder", "int", "", None)])
table("plan_types", "One row per plan type per LOC (PPO, HMO, HDHP, EPO ...).", [
    ("_id", "oid", "PK", None), ("loc_productId", "oid", "FK", "products"), ("name", "text", "", None),
    ("isChipHidden", "bool", "", None), ("similarPlanTypesIds", "text", "", None)])
table("insurers", "One row per insurer. Carrier reference list.", [
    ("_id", "oid", "PK", None), ("name", "text", "", None), ("code", "text", "", None), ("deleted", "bool", "", None)])
table("insurer_categories", "One row per category mapping per LOC.", [
    ("_id", "oid", "PK", None), ("loc_productId", "oid", "FK", "products"), ("loc_locType", "text", "", None),
    ("mapName", "text", "", None), ("displayName", "text", "", None)])
table("funding_types", "One row per funding type (fully insured, self-funded, level-funded ...).", [
    ("_id", "oid", "PK", None), ("name", "text", "", None), ("displayOrder", "int", "", None), ("theme", "text", "", None)])
table("loc_statuses", "One row per client per LOC per status period. Current status = latest startDate.", [
    ("_id", "oid", "PK", None), ("client_clientId", "oid", "FK", "clients"), ("loc_productId", "oid", "FK", "products"),
    ("loc_locType", "text", "", None), ("status", "text", "", None), ("startDate", "date", "", None)])
table("plan_designs", "One row per plan design (per client, per LOC). The plan a client offers on a line of coverage.", [
    ("_id", "oid", "PK", None), ("client_clientId", "oid", "FK", "clients"), ("loc_productId", "oid", "FK", "products"),
    ("insurer_insurerId", "oid", "FK", "insurers"), ("planInfo_fundingTypeId", "oid", "FK", "funding_types"),
    ("planInfo_stateId", "oid", "FK", "plan_states"), ("planCreationIdentifierFlag", "text", "", None),
    ("deleted", "bool", "", None)])
table("plan_states", "One row per lifecycle state per LOC.", [
    ("_id", "oid", "PK", None), ("loc_productId", "oid", "FK", "products"), ("resourceKey", "text", "", None),
    ("displayName", "text", "", None), ("isActive", "bool", "", None)])
table("wizards", "One row per wizard run: a guided plan-building session for a client on a LOC.", [
    ("_id", "oid", "PK", None), ("client_clientId", "oid", "FK", "clients"), ("loc_productId", "oid", "FK", "products"),
    ("wizardType", "text", "", None), ("status", "text", "", None), ("deleted", "bool", "", None)])
table("wizard_alternate_plans", "One row per alternate plan option offered inside a wizard run.", [
    ("_id", "oid", "PK", None), ("planDesignId", "oid", "FK", "plan_designs"),
    ("fundingTypeId", "oid", "FK", "funding_types"), ("loc_productId", "oid", "FK", "products"), ("name", "text", "", None)])
table("plan_eligibility_details", "One row per eligibility definition (version) per plan design. Filter isCurrent.", [
    ("_id", "oid", "PK", None), ("planDesign_planDesignId", "oid", "FK", "plan_designs"),
    ("client_clientId", "oid", "FK", "clients"), ("loc_productId", "oid", "FK", "products"),
    ("workflowStatus", "text", "", None), ("isCurrent", "bool", "", None)])
table("plan_eligibility_types", "One row per eligibility section/field definition per LOC. Configuration.", [
    ("_id", "oid", "PK", None), ("loc_productId", "oid", "FK", "products"), ("section_resourceKey", "text", "", None),
    ("displayOrder", "int", "", None), ("level", "int", "", None)])
table("plan_design_hierarchy_types", "One row per hierarchy definition per LOC. Configuration.", [
    ("_id", "oid", "PK", None), ("loc_productId", "oid", "FK", "products"), ("isToggleable", "bool", "", None),
    ("isDynamic", "bool", "", None), ("isTierTable", "bool", "", None)])
table("plan_design_header_dependencies", "One row per conditional display rule per LOC. Configuration.", [
    ("_id", "oid", "PK", None), ("loc_productId", "oid", "FK", "products"), ("headerResourceKey", "text", "", None),
    ("conditionMatchKey", "text", "", None), ("actionActionKey", "text", "", None)])
table("plan_financial_types", "One row per financial section definition per LOC. Schema for policy_financials.plan_financial.", [
    ("_id", "oid", "PK", None), ("loc_productId", "oid", "FK", "products"), ("section_resourceKey", "text", "", None),
    ("displayOrder", "int", "", None), ("headers", "json", "", None)])
table("plan_financial_types_validations", "One row per validation rule for plan financial entry.", [
    ("_id", "oid", "PK", None), ("validationKey", "text", "", None), ("displayMessage", "text", "", None),
    ("condition", "json", "", None), ("dependsOn", "json", "", None)])
table("policies", "One row per policy: the contract with a carrier for a client.", [
    ("_id", "oid", "PK", None), ("client_clientId", "oid", "FK", "clients"), ("insurer_insurerId", "oid", "FK", "insurers"),
    ("kickOffTiming_kickOffTimingId", "oid", "FK", "renewal_kick_off_timings"), ("number", "text", "", None),
    ("deleted", "bool", "", None)])
table("policy_coverages", "One row per covered plan within a policy: the bridge from contract to plan design.", [
    ("_id", "oid", "PK", None), ("policyInfo_policyId", "oid", "FK", "policies"),
    ("planDesign_planDesignId", "oid", "FK", "plan_designs"), ("loc_productId", "oid", "FK", "products"),
    ("insurer_insurerId", "oid", "FK", "insurers"), ("deleted", "bool", "", None)])
table("policy_financials", "One row per policy coverage (one-to-one). The money: rates, premiums, enrolment, contributions in plan_financial.", [
    ("_id", "oid", "PK", None), ("policyCoverage_policyCoverageId", "oid", "FK1", "policy_coverages"),
    ("planFinancial", "json", "", None), ("deleted", "bool", "", None)])
table("renewal_kick_off_timings", "One row per timing rule: how far ahead of renewal the process starts.", [
    ("_id", "oid", "PK", None), ("name", "text", "", None), ("days", "int", "", None)])
table("renewal_reminder_notifications", "One row per renewal reminder for a plan design.", [
    ("_id", "oid", "PK", None), ("planDesignId", "oid", "FK", "plan_designs"), ("emailId", "text", "", None),
    ("reminderDate", "date", "", None), ("createdAt", "ts", "", None)])
table("census_answers", "One row per census document per client per effective year. Joins to clients by oneCode.", [
    ("_id", "oid", "PK", None), ("documentId", "text", "", None), ("clientOneCode", "text", "FK", "clients(one_code)"),
    ("answers", "json", "", None), ("contextData", "json", "", None), ("effectiveYear", "text", "", None),
    ("deleted", "bool", "", None)])
table("census_plans", "One row per plan named in a census, per client per LOC (before reconciliation).", [
    ("_id", "oid", "PK", None), ("client_clientId", "oid", "FK", "clients"), ("loc_productId", "oid", "FK", "products"),
    ("documentId", "text", "", None), ("name", "text", "", None), ("deleted", "bool", "", None)])
table("plan_design_census_plans", "One row per census-plan to plan-design mapping per effective year. Unmapped census plans have no row.", [
    ("_id", "oid", "PK", None), ("documentId", "text", "UK", None), ("censusPlanId", "oid", "FK", "census_plans"),
    ("intellifyPlanId", "oid", "FK", "plan_designs"), ("effectiveYear", "text", "", None)])
table("aggregated_census_answers", "One row per client per census document: pre-aggregated rollup of census_answers.", [
    ("_id", "oid", "PK", None), ("client_clientId", "oid", "FK", "clients"), ("documentId", "text", "UK", None),
    ("census", "json", "", None), ("deleted", "bool", "", None)])
table("census_hierarchies", "One row per node in the census field hierarchy (self-reference by key).", [
    ("_id", "oid", "PK", None), ("resourceKey", "text", "", None), ("documentKey", "text", "", None),
    ("parent", "text", "", None), ("isParent", "bool", "", None)])
table("carrier_credits", "One row per credit per client per carrier. Committed value = isFinal and not expired.", [
    ("_id", "oid", "PK", None), ("client_clientId", "oid", "FK", "clients"),
    ("carrierInfo_insurerId", "oid", "FK", "insurers"), ("carrierInfo_expirationDate", "date", "", None),
    ("isFinal", "bool", "", None), ("deleted", "bool", "", None)])
table("carrier_credit_types", "One row per carrier credit type.", [
    ("_id", "oid", "PK", None), ("isDefault", "bool", "", None), ("section_resourceKey", "text", "", None),
    ("displayName", "text", "", None), ("displayOrder", "int", "", None)])
table("carrier_credit_types_validations", "One row per validation rule for carrier credit entry.", [
    ("_id", "oid", "PK", None), ("validationKey", "text", "", None), ("displayMessage", "text", "", None),
    ("condition", "json", "", None), ("dependsOn", "json", "", None)])
table("carrier_credit_notifications", "One row per notification attached to a carrier credit.", [
    ("_id", "oid", "PK", None), ("carrierCreditId", "oid", "FK", "carrier_credits"),
    ("sectionResourceKey", "text", "", None), ("emailId", "text", "", None), ("dueDays", "int", "", None)])
table("lad_ancillary_fees", "One row per fee per client per carrier per effective window.", [
    ("_id", "oid", "PK", None), ("client_clientId", "oid", "FK", "clients"),
    ("ladAncillaryFeesInfo_insurerId", "oid", "FK", "insurers"), ("effectiveDate", "date", "", None),
    ("expirationDate", "date", "", None), ("deleted", "bool", "", None)])
table("lad_ancillary_fee_types", "One row per ancillary fee type.", [
    ("_id", "oid", "PK", None), ("section_resourceKey", "text", "", None), ("displayOrder", "int", "", None),
    ("options", "json", "", None), ("headers", "json", "", None)])
table("contribution_questions", "One row per client per LOC per effective period (contribution strategy envelope).", [
    ("_id", "oid", "PK", None), ("client_clientId", "oid", "FK", "clients"), ("loc_productId", "oid", "FK", "products"),
    ("effectivePeriod_startDate", "date", "", None), ("effectivePeriod_endDate", "date", "", None),
    ("deleted", "bool", "", None)])
table("national_survey", "One row per client per survey period: national benchmarking survey responses.", [
    ("_id", "oid", "PK", None), ("client_clientId", "oid", "FK", "clients"),
    ("effectivePeriod_startDate", "date", "", None), ("effectivePeriod_endDate", "date", "", None),
    ("answers", "json", "", None), ("deleted", "bool", "", None)])
table("mercervip_vendors", "One row per vendor in the MercerVIP point-solutions marketplace.", [
    ("_id", "oid", "PK", None), ("name", "text", "UK", None), ("deleted", "bool", "", None), ("createdAt", "ts", "", None)])
table("mercervip_products", "One row per vendor product (marketplace SKU, not a line of coverage).", [
    ("_id", "oid", "PK", None), ("name", "text", "", None), ("vendorId", "oid", "FK", "mercervip_vendors"),
    ("deleted", "bool", "", None), ("createdAt", "ts", "", None)])
table("mercervip_categories", "One row per MercerVIP marketplace category.", [
    ("_id", "oid", "PK", None), ("name", "text", "UK", None), ("deleted", "bool", "", None), ("createdAt", "ts", "", None)])
table("point_solutions_products", "One row per client per selected MercerVIP product.", [
    ("_id", "oid", "PK", None), ("client_clientId", "oid", "FK", "clients"), ("vendor_id", "oid", "FK", "mercervip_vendors"),
    ("product_id", "oid", "FK", "mercervip_products"), ("deleted", "bool", "", None)])
table("events", "One row per platform event. collectionId is an untyped reference (client or plan design, per topic).", [
    ("_id", "oid", "PK", None), ("channel", "text", "", None), ("topic", "text", "", None),
    ("collectionId", "text", "", None), ("createdAt", "ts", "", None)])
table("migrations", "One row per migration run. Operational metadata, not business data.", [
    ("_id", "oid", "PK", None), ("migrationName", "text", "", None), ("timestamp", "ts", "", None),
    ("result", "json", "", None), ("flags", "text", "", None)])
table("data_types", "One row per data type used by the configuration-driven forms.", [
    ("_id", "oid", "PK", None), ("dataType", "text", "", None), ("primitiveDataType", "text", "", None),
    ("dataFormat", "text", "", None), ("defaultValue", "text", "", None)])
table("broker_names", "One row per broker (pick-list).", [
    ("_id", "oid", "PK", None), ("name", "text", "", None), ("displayOrder", "int", "", None)])
table("broking_remuneration_types", "One row per broking remuneration type (pick-list).", [
    ("_id", "oid", "PK", None), ("name", "text", "", None), ("displayOrder", "int", "", None)])
table("pbm_names", "One row per pharmacy benefit manager (pick-list).", [
    ("_id", "oid", "PK", None), ("name", "text", "", None), ("displayOrder", "int", "", None)])


def col(field):
    if field == "_id":
        return "id"
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", field)
    return s.lower()


SQLTYPE = {"oid": "char(24)", "text": "text", "int": "integer", "bool": "boolean", "date": "date",
           "ts": "timestamptz", "json": "jsonb"}

assert len(T) == 49, len(T)
n_attrs = sum(len(c) for _, _, c in T)

# ------------------------------------------------------------ data helpers -
_ts = int(datetime(2023, 1, 1, tzinfo=timezone.utc).timestamp())


def oid():
    global _ts
    _ts += rng.randint(1, 900)
    return f"{_ts:08x}" + "".join(rng.choice("0123456789abcdef") for _ in range(16))


ROWS = {name: [] for name, _, _ in T}
COLS = {name: [f for f, _, _, _ in cols] for name, _, cols in T}


def add(tbl, **kw):
    row = {f: kw.get(f) for f in COLS[tbl]}
    unknown = set(kw) - set(COLS[tbl])
    assert not unknown, (tbl, unknown)
    if row["_id"] is None:
        row["_id"] = oid()
    ROWS[tbl].append(row)
    return row


def chance(p):
    return rng.random() < p


def soft(p=0.03):
    return chance(p)


def rdate(a, b):
    return a + timedelta(days=rng.randint(0, (b - a).days))


def rts(a, b):
    d = rdate(a, b)
    return datetime(d.year, d.month, d.day, rng.randint(7, 19), rng.randint(0, 59), rng.randint(0, 59),
                    tzinfo=timezone.utc)


# ---------------------------------------------------------- reference data -
countries = {}
for code, name in [("US", "United States"), ("CA", "Canada"), ("GB", "United Kingdom"), ("MX", "Mexico"),
                   ("IE", "Ireland"), ("IN", "India"), ("DE", "Germany"), ("FR", "France"), ("BR", "Brazil"),
                   ("AU", "Australia"), ("PH", "Philippines"), ("CO", "Colombia")]:
    countries[code] = add("countries", code=code, name=name)

LOCS = [  # name, locType, offer probability
    ("Medical", "medical", 1.0), ("Dental", "dental", 0.92), ("Vision", "vision", 0.85),
    ("Basic Life / AD&D", "life", 0.85), ("Supplemental Life", "life", 0.5),
    ("Short-Term Disability", "disability", 0.6), ("Long-Term Disability", "disability", 0.65),
    ("Accident", "voluntary", 0.4), ("Critical Illness", "voluntary", 0.35),
    ("Hospital Indemnity", "voluntary", 0.25), ("Employee Assistance Program", "eap", 0.5)]
products = {}
for i, (name, lt, p) in enumerate(LOCS, 1):
    products[name] = add("products", name=name, locType=lt, displayOrder=i, deleted=False)
legal = add("products", name="Legal Plan", locType="voluntary", displayOrder=99, deleted=True)
PROD = lambda n: products[n]["_id"]

groups = {}
for i, g in enumerate(["Health", "Group Risk", "Voluntary Benefits", "Wellbeing"], 1):
    groups[g] = add("product_groups", name=g, displayOrder=i)
GROUP_OF = {"Medical": "Health", "Dental": "Health", "Vision": "Health", "Basic Life / AD&D": "Group Risk",
            "Supplemental Life": "Group Risk", "Short-Term Disability": "Group Risk",
            "Long-Term Disability": "Group Risk", "Accident": "Voluntary Benefits",
            "Critical Illness": "Voluntary Benefits", "Hospital Indemnity": "Voluntary Benefits",
            "Employee Assistance Program": "Wellbeing"}
hier_root = {}
for i, g in enumerate(groups, 1):
    hier_root[g] = add("products_hierarchies", parent=None, displayName=g, level=0, displayOrder=i)
hier_loc = {}
for i, (name, _, _) in enumerate(LOCS, 1):
    hier_loc[name] = add("products_hierarchies", parent=hier_root[GROUP_OF[name]]["_id"], displayName=name,
                         level=1, displayOrder=i)

PLAN_TYPES = {"Medical": ["PPO", "HMO", "HDHP", "EPO", "POS"], "Dental": ["DPPO", "DHMO"],
              "Vision": ["Vision PPO", "Vision Indemnity"], "Basic Life / AD&D": ["Flat Amount", "Salary Multiple"],
              "Supplemental Life": ["Employee Paid", "Spouse/Child"], "Short-Term Disability": ["Salary Continuation", "Insured STD"],
              "Long-Term Disability": ["Core LTD", "Buy-Up LTD"], "Accident": ["Accident"],
              "Critical Illness": ["Critical Illness"], "Hospital Indemnity": ["Hospital Indemnity"],
              "Employee Assistance Program": ["EAP"]}
plan_types = {}
for loc, names in PLAN_TYPES.items():
    rows = [add("plan_types", loc_productId=PROD(loc), name=n, isChipHidden=chance(0.15), similarPlanTypesIds="")
            for n in names]
    for r in rows:
        sims = [o["_id"] for o in rows if o is not r and chance(0.6)]
        r["similarPlanTypesIds"] = ",".join(sims) if sims else None
    plan_types[loc] = rows

CARRIERS = [("Aetna", "AET", ["Medical", "Dental", "Vision", "Basic Life / AD&D"]),
            ("Cigna", "CIG", ["Medical", "Dental"]),
            ("UnitedHealthcare", "UHC", ["Medical", "Dental", "Vision"]),
            ("Blue Cross Blue Shield", "BCBS", ["Medical", "Dental"]),
            ("Kaiser Permanente", "KP", ["Medical"]),
            ("Delta Dental", "DD", ["Dental"]), ("VSP", "VSP", ["Vision"]), ("EyeMed", "EYM", ["Vision"]),
            ("MetLife", "MET", ["Dental", "Basic Life / AD&D", "Supplemental Life", "Accident", "Critical Illness",
                                "Hospital Indemnity"]),
            ("Guardian", "GRD", ["Dental", "Vision", "Short-Term Disability", "Long-Term Disability"]),
            ("Lincoln Financial", "LFG", ["Basic Life / AD&D", "Supplemental Life", "Short-Term Disability",
                                          "Long-Term Disability"]),
            ("Unum", "UNM", ["Short-Term Disability", "Long-Term Disability", "Accident", "Critical Illness"]),
            ("The Hartford", "HIG", ["Basic Life / AD&D", "Short-Term Disability", "Long-Term Disability"]),
            ("Sun Life", "SLF", ["Dental", "Supplemental Life", "Long-Term Disability"]),
            ("Aflac", "AFL", ["Accident", "Critical Illness", "Hospital Indemnity"]),
            ("ComPsych", "CPS", ["Employee Assistance Program"]),
            ("Lyra Health", "LYR", ["Employee Assistance Program"])]
insurers = {}
carriers_for = {loc: [] for loc, _, _ in LOCS}
for name, code, locs in CARRIERS:
    insurers[name] = add("insurers", name=name, code=code, deleted=False)
    for l in locs:
        carriers_for[l].append(name)
add("insurers", name="Great Western Mutual", code="GWM", deleted=True)

for loc, _, _ in LOCS:
    for mp, dn in [("national", "National Carriers"), ("regional", "Regional Carriers"), ("specialty", "Specialty Carriers")][: rng.randint(1, 3)]:
        add("insurer_categories", loc_productId=PROD(loc), loc_locType=products[loc]["locType"], mapName=f"{products[loc]['locType']}.{mp}",
            displayName=dn)

funding = {}
for i, (n, th) in enumerate([("Fully Insured", "blue"), ("Self-Funded", "green"), ("Level-Funded", "amber"),
                             ("Minimum Premium", "purple")], 1):
    funding[n] = add("funding_types", name=n, displayOrder=i, theme=th)

STATES = [("draft", "Draft", True), ("inReview", "In Review", True), ("approved", "Approved", True),
          ("published", "Published", True), ("archived", "Archived", False)]
plan_states = {}
for loc, _, _ in LOCS:
    plan_states[loc] = {k: add("plan_states", loc_productId=PROD(loc), resourceKey=f"planState.{k}", displayName=d,
                               isActive=a) for k, d, a in STATES}

kickoffs = [add("renewal_kick_off_timings", name=f"{d} days prior", days=d) for d in (60, 90, 120, 150, 180)]

for loc, _, _ in LOCS:
    lt = products[loc]["locType"]
    for i, sec in enumerate(["employeeClasses", "waitingPeriod", "hoursRequirement", "dependentEligibility",
                             "retireeEligibility"][: rng.randint(3, 5)], 1):
        add("plan_eligibility_types", loc_productId=PROD(loc), section_resourceKey=f"eligibility.{lt}.{sec}",
            displayOrder=i, level=0 if i <= 2 else 1)
    for _ in range(rng.randint(2, 4)):
        add("plan_design_hierarchy_types", loc_productId=PROD(loc), isToggleable=chance(0.5), isDynamic=chance(0.4),
            isTierTable=chance(0.5) if lt in ("medical", "dental", "vision") else False)
    for h, c, a in [("deductible", "planType=HDHP", "require"), ("hsaContribution", "planType=HDHP", "show"),
                    ("copay", "planType=HDHP", "hide"), ("orthodontia", "planType=DPPO", "show"),
                    ("eliminationPeriod", "planType=Core LTD", "require")][: rng.randint(1, 4)]:
        add("plan_design_header_dependencies", loc_productId=PROD(loc), headerResourceKey=f"header.{lt}.{h}",
            conditionMatchKey=c, actionActionKey=a)
    for i, sec in enumerate(["rates", "enrollment", "contributions", "fees"], 1):
        hdr = {"rates": ["employeeOnly", "employeeSpouse", "employeeChildren", "family"],
               "enrollment": ["employeeOnly", "employeeSpouse", "employeeChildren", "family"],
               "contributions": ["employerPct", "employeeMonthly"], "fees": ["adminFeePepm", "stopLossPepm"]}[sec]
        add("plan_financial_types", loc_productId=PROD(loc), section_resourceKey=f"financial.{lt}.{sec}",
            displayOrder=i, headers=[{"key": h, "dataType": "currency" if sec != "enrollment" else "integer"} for h in hdr])

for k, m, cond, dep in [
        ("ratesPositive", "Rates must be greater than zero.", {"op": ">", "field": "rates.*", "value": 0}, ["rates"]),
        ("tierOrder", "Family rate must be at least the employee-only rate.", {"op": ">=", "left": "rates.family", "right": "rates.employeeOnly"}, ["rates.family", "rates.employeeOnly"]),
        ("adminFeeRequired", "Admin fee is required for self-funded plans.", {"op": "required", "field": "fees.adminFeePepm", "when": {"fundingType": "Self-Funded"}}, ["fees.adminFeePepm", "fundingType"]),
        ("stopLossRequired", "Stop-loss premium is required for self-funded and level-funded plans.", {"op": "required", "field": "fees.stopLossPepm"}, ["fees.stopLossPepm", "fundingType"]),
        ("contributionRange", "Employer contribution must be between 0% and 100%.", {"op": "between", "field": "contributions.employerPct", "min": 0, "max": 1}, ["contributions.employerPct"]),
        ("enrollmentInteger", "Enrollment counts must be whole numbers.", {"op": "integer", "field": "enrollment.*"}, ["enrollment"])]:
    add("plan_financial_types_validations", validationKey=k, displayMessage=m, condition=cond, dependsOn=dep)

cc_types = [add("carrier_credit_types", isDefault=(i == 1), section_resourceKey=f"carrierCredit.{k}", displayName=d,
                displayOrder=i)
            for i, (k, d) in enumerate([("wellnessFund", "Wellness Fund"), ("implementation", "Implementation Credit"),
                                        ("communication", "Communication Credit"), ("pharmacyRebate", "Pharmacy Rebate"),
                                        ("performanceGuarantee", "Performance Guarantee")], 1)]
for k, m, cond, dep in [
        ("amountPositive", "Credit amount must be greater than zero.", {"op": ">", "field": "amount", "value": 0}, ["amount"]),
        ("expiryAfterEffective", "Expiration date must be after the effective date.", {"op": ">", "left": "expirationDate", "right": "effectiveDate"}, ["expirationDate", "effectiveDate"]),
        ("finalNeedsDocument", "A final credit needs a signed carrier letter.", {"op": "required", "field": "documentUrl", "when": {"isFinal": True}}, ["isFinal", "documentUrl"]),
        ("wellnessCap", "Wellness fund cannot exceed $150 per enrolled employee.", {"op": "<=", "field": "amountPerEmployee", "value": 150}, ["amountPerEmployee"])]:
    add("carrier_credit_types_validations", validationKey=k, displayMessage=m, condition=cond, dependsOn=dep)

fee_types = [add("lad_ancillary_fee_types", section_resourceKey=f"ladFee.{k}", displayOrder=i,
                 options=opts, headers=[{"key": "amount", "dataType": "currency"}, {"key": "basis", "dataType": "string"}])
             for i, (k, opts) in enumerate([("brokerFee", ["flat", "pepm"]), ("adminFee", ["pepm", "percentOfPremium"]),
                                            ("technologyFee", ["flat"]), ("complianceFee", ["flat", "pepm"])], 1)]

for i, n in enumerate(["Northbridge Advisory", "Keystone Benefits Partners", "Harbor & Vale Brokerage",
                       "Summit Risk Consultants", "Meridian Employee Benefits", "Atlas Insurance Services",
                       "Clearwater Brokers", "Pinecrest Benefit Group"], 1):
    add("broker_names", name=n, displayOrder=i)
for i, n in enumerate(["Commission", "Fee", "Commission + Fee", "Override", "Bonus"], 1):
    add("broking_remuneration_types", name=n, displayOrder=i)
for i, n in enumerate(["CVS Caremark", "Express Scripts", "OptumRx", "Prime Therapeutics", "MedImpact",
                       "Navitus", "Capital Rx"], 1):
    add("pbm_names", name=n, displayOrder=i)
for dt, prim, fmt, dv in [("currency", "decimal", "$#,##0.00", "0"), ("percent", "decimal", "0.0%", "0"),
                          ("integer", "int", "#,##0", "0"), ("string", "string", None, ""),
                          ("date", "date", "MM/DD/YYYY", None), ("boolean", "bool", None, "false"),
                          ("pepm", "decimal", "$#,##0.00 PEPM", "0"), ("multiplier", "decimal", "0.0x", "1"),
                          ("days", "int", "# days", "0"), ("email", "string", "email", None)]:
    add("data_types", dataType=dt, primitiveDataType=prim, dataFormat=fmt, defaultValue=dv)

CENSUS_NODES = [("demographics", None, True), ("age", "demographics", False), ("gender", "demographics", False),
                ("state", "demographics", False), ("employment", None, True), ("salary", "employment", False),
                ("hireDate", "employment", False), ("employeeClass", "employment", False),
                ("hoursPerWeek", "employment", False), ("coverage", None, True), ("medicalTier", "coverage", False),
                ("dentalTier", "coverage", False), ("visionTier", "coverage", False),
                ("medicalPlan", "coverage", False), ("dependents", "coverage", True),
                ("spouseCovered", "dependents", False), ("childCount", "dependents", False)]
for k, p, ip in CENSUS_NODES:
    add("census_hierarchies", resourceKey=f"census.{k}", documentKey=k, parent=p, isParent=ip)

for i in range(1, 23):
    d = datetime(2023, 3, 1, tzinfo=timezone.utc) + timedelta(days=i * 41 + rng.randint(0, 20))
    ok = not (i in (7, 15))
    add("migrations", migrationName=f"{i:03d}-" + rng.choice(["add-plan-state-index", "backfill-loc-type",
                                                             "split-plan-financial", "rename-carrier-info",
                                                             "census-hierarchy-seed", "drop-legacy-fields",
                                                             "normalize-one-code", "add-wizard-status"]),
        timestamp=d, result={"ok": ok, "documentsModified": rng.randint(0, 25000), **({} if ok else {"error": "duplicate key"})},
        flags=rng.choice(["--dry-run=false", "--batch=500", "--batch=1000 --resume", None]))

# MercerVIP
VENDORS = {"Kinetic MSK": ["Virtual Physical Therapy", "Joint Pain Program"],
           "GlucoPath": ["Diabetes Management", "Prediabetes Prevention"],
           "MindHarbor": ["Therapy & Coaching", "Psychiatry"],
           "BloomFamily": ["Fertility Benefit", "Maternity Navigation"],
           "RestWell": ["Digital Sleep Therapy"],
           "Cadence Navigate": ["Care Navigation", "Second Opinion"],
           "Ledger Wellbeing": ["Financial Coaching", "Student Loan Assist"],
           "HeartLine": ["Hypertension Program"],
           "NourishRx": ["Nutrition Coaching", "Weight Management"],
           "QuitNow": ["Tobacco Cessation"], "ClearSight Digital": ["Myopia Care"],
           "CareCircle": ["Elder Care Support", "Caregiver Coaching"]}
vendors, vprods = {}, {}
for name, prods in VENDORS.items():
    v = add("mercervip_vendors", name=name, deleted=False, createdAt=rts(date(2023, 2, 1), date(2024, 6, 30)))
    vendors[name] = v
    vprods[name] = [add("mercervip_products", name=p, vendorId=v["_id"], deleted=soft(0.05),
                        createdAt=rts(date(2024, 7, 1), date(2025, 3, 31))) for p in prods]
add("mercervip_vendors", name="Pulse Fitness Co", deleted=True, createdAt=rts(date(2023, 2, 1), date(2023, 6, 1)))
for c in ["Musculoskeletal", "Diabetes & Metabolic", "Mental Health", "Fertility & Family", "Sleep",
          "Navigation & Advocacy", "Financial Wellbeing", "Cardiovascular", "Nutrition", "Caregiving"]:
    add("mercervip_categories", name=c, deleted=False, createdAt=rts(date(2023, 2, 1), date(2024, 1, 31)))
add("mercervip_categories", name="Gym Discounts", deleted=True, createdAt=rts(date(2023, 2, 1), date(2023, 6, 1)))

# ----------------------------------------------------------------- clients -
PREFIX = ["Apex", "Brightwater", "Cedar", "Copperline", "Driftwood", "Evergreen", "Falcon", "Granite", "Harborview",
          "Ironwood", "Juniper", "Keystone", "Lakeshore", "Maple Ridge", "Northwind", "Oakmont", "Pioneer",
          "Quarry", "Redstone", "Silverline", "Tidewater", "Union Square", "Vantage", "Westfield", "Yellowpine",
          "Zephyr", "Bluebird", "Crescent", "Highland", "Sterling", "Riverbend", "Summit", "Bayside", "Clearview",
          "Foxglove", "Goldcrest", "Hawthorne", "Larkspur", "Meadowbrook", "Orchard"]
SUFFIX = ["Manufacturing", "Health System", "Logistics", "Foods", "Financial Group", "Technologies", "Retail",
          "Energy", "Hospitality", "University", "Engineering", "Pharmaceuticals", "Media", "Construction",
          "Insurance Services", "Telecom", "Aerospace", "Biosciences", "Credit Union", "School District"]
INDUSTRY = {"Manufacturing": "Manufacturing", "Health System": "Healthcare", "Logistics": "Transportation",
            "Foods": "Food & Beverage", "Financial Group": "Financial Services", "Technologies": "Technology",
            "Retail": "Retail", "Energy": "Energy & Utilities", "Hospitality": "Hospitality",
            "University": "Higher Education", "Engineering": "Professional Services",
            "Pharmaceuticals": "Life Sciences", "Media": "Media & Entertainment", "Construction": "Construction",
            "Insurance Services": "Financial Services", "Telecom": "Technology", "Aerospace": "Manufacturing",
            "Biosciences": "Life Sciences", "Credit Union": "Financial Services", "School District": "Public Sector"}
US_STATES = ["CA", "TX", "NY", "FL", "IL", "PA", "OH", "GA", "NC", "MI", "NJ", "VA", "WA", "AZ", "MA", "CO", "MN", "MO"]
REGION = {"CA": "West", "WA": "West", "AZ": "West", "CO": "West", "TX": "South", "FL": "South", "GA": "South",
          "NC": "South", "VA": "South", "NY": "Northeast", "PA": "Northeast", "NJ": "Northeast", "MA": "Northeast",
          "IL": "Midwest", "OH": "Midwest", "MI": "Midwest", "MN": "Midwest", "MO": "Midwest"}
TENANTS = ["mercer-us-east", "mercer-us-central", "mercer-us-west", "marsh-mma"]

clients = []
names_used = set()
for i in range(40):
    while True:
        n = f"{rng.choice(PREFIX)} {rng.choice(SUFFIX)}"
        if n not in names_used:
            names_used.add(n)
            break
    size = int(rng.choice([rng.randint(120, 480), rng.randint(500, 2500), rng.randint(2500, 9000),
                           rng.randint(9000, 28000)]))
    hq = rng.choice(US_STATES)
    c = add("clients", oneCode=f"IC{100100 + i * 37:06d}", name=n, tenantKey=rng.choice(TENANTS),
            deleted=(i in (13, 31)))
    c["_meta"] = {"size": size, "hq": hq, "industry": None,
                  "domain": re.sub(r"[^a-z]", "", n.lower())[:18] + ".example.com"}
    clients.append(c)
for c in clients:  # industry lookup fix for two-word suffixes
    suf = next(s for s in SUFFIX if c["name"].endswith(s))
    c["_meta"]["industry"] = INDUSTRY[suf]

FIRST = ["Ana", "Ben", "Carla", "Deepak", "Elena", "Femi", "Grace", "Hiro", "Isabel", "Jamal", "Kara", "Luis",
         "Mei", "Noah", "Olga", "Priya", "Quinn", "Rosa", "Sam", "Tariq", "Uma", "Victor", "Wen", "Yara", "Zoe"]
LAST = ["Alvarez", "Brooks", "Chen", "Diaz", "Evans", "Fischer", "Gupta", "Hughes", "Ito", "Johnson", "Khan",
        "Lopez", "Morgan", "Nguyen", "Okafor", "Patel", "Reyes", "Silva", "Turner", "Walsh"]
for c in clients:
    for _ in range(rng.randint(2, 5)):
        f, l = rng.choice(FIRST), rng.choice(LAST)
        ctry = "US" if chance(0.85) else rng.choice(["CA", "GB", "MX", "IE", "IN", "CO", "PH"])
        add("contacts", clients_clientId=c["_id"], location_countryId=countries[ctry]["_id"],
            email=f"{f.lower()}.{l.lower()}@{c['_meta']['domain']}",
            contactType=rng.choice(["HR Lead", "Benefits Manager", "Broker", "Billing", "CFO", "HR Lead",
                                    "Benefits Manager", "hr lead", "Payroll"]))

# offered LOCs per client
for c in clients:
    offered = [loc for loc, _, p in LOCS if chance(p)]
    if "Medical" not in offered:
        offered.insert(0, "Medical")
    c["_meta"]["locs"] = offered

LOC_FLOW = ["Not Started", "In Progress", "Under Review", "Complete"]
for c in clients:
    for loc in c["_meta"]["locs"]:
        d = rdate(date(2024, 9, 1), date(2025, 3, 1))
        steps = rng.randint(1, 4)
        for s in range(steps):
            add("loc_statuses", client_clientId=c["_id"], loc_productId=PROD(loc),
                loc_locType=products[loc]["locType"], status=LOC_FLOW[s], startDate=d)
            d = d + timedelta(days=rng.randint(20, 120))
            if d > date(2026, 10, 1):
                break

# --------------------------------------------------------------- plan designs
plan_designs = []
for c in clients:
    size = c["_meta"]["size"]
    for loc in c["_meta"]["locs"]:
        lt = products[loc]["locType"]
        n_plans = rng.randint(1, 4 if size > 2500 else 3) if loc == "Medical" else (rng.randint(1, 2) if lt in ("dental", "vision") else 1)
        carrier = rng.choice(carriers_for[loc])
        for k in range(n_plans):
            if loc == "Medical":
                ft = ("Self-Funded" if chance(0.8) else "Minimum Premium") if size > 2500 else \
                     ("Level-Funded" if chance(0.4) else "Fully Insured") if size < 500 else \
                     rng.choice(["Fully Insured", "Self-Funded", "Level-Funded"])
            elif loc == "Dental" and size > 2500:
                ft = "Self-Funded" if chance(0.5) else "Fully Insured"
            else:
                ft = "Fully Insured"
            if loc == "Medical" and k > 0 and chance(0.25):
                carrier2 = rng.choice(carriers_for[loc])
            else:
                carrier2 = carrier
            ptype = plan_types[loc][k % len(plan_types[loc])] if loc == "Medical" else rng.choice(plan_types[loc])
            state = rng.choices(["published", "approved", "inReview", "draft", "archived"], [55, 15, 12, 10, 8])[0]
            pd = add("plan_designs", client_clientId=c["_id"], loc_productId=PROD(loc),
                     insurer_insurerId=insurers[carrier2]["_id"], planInfo_fundingTypeId=funding[ft]["_id"],
                     planInfo_stateId=plan_states[loc][state]["_id"],
                     planCreationIdentifierFlag=rng.choices(["manual", "cloned", "wizard", "imported"], [35, 30, 20, 15])[0],
                     deleted=soft(0.04))
            pd["_meta"] = {"client": c, "loc": loc, "carrier": carrier2, "funding": ft, "ptype": ptype["name"], "state": state}
            plan_designs.append(pd)

live_pds = [p for p in plan_designs if not p["deleted"]]

# wizards + alternate plans
for c in clients:
    for _ in range(rng.choice([0, 1, 1, 2, 3])):
        loc = rng.choice([l for l in c["_meta"]["locs"] if l in ("Medical", "Dental", "Vision")] or ["Medical"])
        add("wizards", client_clientId=c["_id"], loc_productId=PROD(loc),
            wizardType=rng.choice(["renewal", "newPlan", "benchmark", "marketing"]),
            status=rng.choices(["complete", "inProgress", "abandoned"], [60, 25, 15])[0], deleted=soft(0.03))
        base = [p for p in live_pds if p["_meta"]["client"] is c and p["_meta"]["loc"] == loc]
        for j, p in enumerate(base[:rng.randint(1, 3)]):
            for opt in range(rng.randint(1, 3)):
                ft = rng.choice(list(funding))
                add("wizard_alternate_plans", planDesignId=p["_id"], fundingTypeId=funding[ft]["_id"],
                    loc_productId=PROD(loc), name=f"Option {chr(65 + opt)} - {p['_meta']['ptype']} {ft}")

# eligibility versions
for p in plan_designs:
    versions = rng.choices([1, 2, 3], [60, 30, 10])[0]
    for v in range(versions):
        current = v == versions - 1
        add("plan_eligibility_details", planDesign_planDesignId=p["_id"], client_clientId=p["client_clientId"],
            loc_productId=p["loc_productId"],
            workflowStatus=(rng.choices(["approved", "submitted", "draft"], [70, 20, 10])[0] if current else "superseded"),
            isCurrent=current)

# renewal reminders
for p in live_pds:
    for _ in range(rng.choice([0, 0, 1, 2])):
        rd = rdate(date(2025, 6, 1), date(2026, 12, 15))
        add("renewal_reminder_notifications", planDesignId=p["_id"],
            emailId=rng.choice(["renewal-kickoff", "renewal-30-day", "renewal-final-notice", "renewal-data-request"]),
            reminderDate=rd, createdAt=datetime(rd.year, rd.month, rd.day, 9, 0, tzinfo=timezone.utc) - timedelta(days=rng.randint(10, 60)))

# ----------------------------------------------------- policies + financials
TIER_MIX = {"employeeOnly": 0.45, "employeeSpouse": 0.18, "employeeChildren": 0.14, "family": 0.23}
BASE_RATE = {"medical": 720, "dental": 48, "vision": 11}
TIER_FACTOR = {"employeeOnly": 1.0, "employeeSpouse": 2.05, "employeeChildren": 1.8, "family": 2.85}
FT_FACTOR = {"Fully Insured": 1.08, "Self-Funded": 0.93, "Level-Funded": 0.98, "Minimum Premium": 0.96}
STATE_FACTOR = {"CA": 1.12, "NY": 1.22, "MA": 1.18, "NJ": 1.15, "WA": 1.06, "IL": 1.04, "TX": 0.97, "FL": 1.02,
                "GA": 0.95, "NC": 0.96, "OH": 0.94, "PA": 1.03, "MI": 0.96, "VA": 0.99, "AZ": 0.95, "CO": 1.0,
                "MN": 1.03, "MO": 0.93}

coverages = []
for c in clients:
    by_carrier = {}
    for p in live_pds:
        if p["_meta"]["client"] is c:
            by_carrier.setdefault(p["_meta"]["carrier"], []).append(p)
    for carrier, pds in by_carrier.items():
        pol = add("policies", client_clientId=c["_id"], insurer_insurerId=insurers[carrier]["_id"],
                  kickOffTiming_kickOffTimingId=rng.choice(kickoffs)["_id"],
                  number=f"{insurers[carrier]['code']}-{rng.randint(1000000, 9999999)}", deleted=soft(0.03))
        for p in pds:
            if p["_meta"]["state"] in ("draft",):
                continue
            cov = add("policy_coverages", policyInfo_policyId=pol["_id"], planDesign_planDesignId=p["_id"],
                      loc_productId=p["loc_productId"], insurer_insurerId=insurers[carrier]["_id"], deleted=soft(0.03))
            coverages.append((cov, p, c))

for cov, p, c in coverages:
    m = p["_meta"]
    lt = products[m["loc"]]["locType"]
    size = c["_meta"]["size"]
    n_plans_loc = sum(1 for q in live_pds if q["_meta"]["client"] is c and q["_meta"]["loc"] == m["loc"])
    take_up = {"medical": 0.82, "dental": 0.74, "vision": 0.6}.get(lt, 0.0)
    enrolled_total = max(5, int(size * take_up / max(1, n_plans_loc) * rng.uniform(0.6, 1.4)))
    fin = {"planYear": 2026, "currency": "USD", "fundingType": m["funding"], "planType": m["ptype"]}
    if lt in BASE_RATE:
        base = BASE_RATE[lt] * FT_FACTOR[m["funding"]] * STATE_FACTOR[c["_meta"]["hq"]] * rng.uniform(0.85, 1.2)
        if m["ptype"] == "HDHP":
            base *= 0.82
        if m["ptype"] in ("HMO", "DHMO"):
            base *= 0.9
        rates = {t: round(base * f, 2) for t, f in TIER_FACTOR.items()}
        enroll = {t: int(round(enrolled_total * w * rng.uniform(0.85, 1.15))) for t, w in TIER_MIX.items()}
        monthly = round(sum(rates[t] * enroll[t] for t in rates), 2)
        er_pct = round(rng.uniform(0.7, 0.9) if lt == "medical" else rng.uniform(0.0, 0.8), 2)
        fin.update({"ratingBasis": "4-tier", "rates": rates, "enrollment": enroll,
                    "enrolledEmployees": sum(enroll.values()), "monthlyPremium": monthly,
                    "annualPremium": round(monthly * 12, 2),
                    "contributions": {"employerPct": er_pct, "employeeMonthlyEmployeeOnly": round(rates["employeeOnly"] * (1 - er_pct), 2)}})
        if m["funding"] in ("Self-Funded", "Level-Funded", "Minimum Premium"):
            fin["fees"] = {"adminFeePepm": round(rng.uniform(38, 72), 2),
                           "stopLossPepm": round(rng.uniform(55, 140), 2) if lt == "medical" else None}
    else:
        covered = max(5, int(size * {"life": 0.9, "disability": 0.7, "voluntary": 0.25, "eap": 1.0}[lt] * rng.uniform(0.8, 1.05)))
        if lt in ("life", "disability"):
            rate = round({"life": rng.uniform(0.12, 0.28), "disability": rng.uniform(0.25, 0.65)}[lt], 3)
            volume = int(covered * rng.uniform(40000, 95000))
            monthly = round(volume / 1000 * rate, 2) if lt == "life" else round(covered * rng.uniform(18, 42), 2)
            fin.update({"ratingBasis": "per $1,000 volume" if lt == "life" else "per covered life",
                        "ratePer1000": rate if lt == "life" else None, "coveredLives": covered,
                        "volume": volume if lt == "life" else None, "monthlyPremium": monthly,
                        "annualPremium": round(monthly * 12, 2), "contributions": {"employerPct": 1.0 if m["loc"] != "Supplemental Life" else 0.0}})
        else:
            pepm = round(rng.uniform(1.6, 3.4), 2) if lt == "eap" else round(rng.uniform(8, 24), 2)
            monthly = round(covered * pepm, 2)
            fin.update({"ratingBasis": "PEPM", "pepm": pepm, "coveredLives": covered, "monthlyPremium": monthly,
                        "annualPremium": round(monthly * 12, 2),
                        "contributions": {"employerPct": 1.0 if lt == "eap" else 0.0}})
    fin["priorYearAnnualPremium"] = round(fin["annualPremium"] / rng.uniform(1.02, 1.14), 2)
    fin["renewalIncreasePct"] = round(fin["annualPremium"] / fin["priorYearAnnualPremium"] - 1, 4)
    add("policy_financials", policyCoverage_policyCoverageId=cov["_id"], planFinancial=fin, deleted=cov["deleted"])

# ------------------------------------------------------------------ census -
PLAN_LABEL = {"PPO": ["PPO {d}", "Open Access Plus {d}", "Choice PPO {d}"], "HMO": ["HMO {d}", "Select HMO"],
              "HDHP": ["HDHP {d} HSA", "HSA Plan {d}", "Consumer Choice {d}"], "EPO": ["EPO {d}", "Exclusive {d}"],
              "POS": ["POS {d}", "Point of Service"], "DPPO": ["Dental PPO", "Dental High", "Dental Base"],
              "DHMO": ["Dental HMO", "DHMO Plan"], "Vision PPO": ["Vision", "Vision Plus", "Vision Base"],
              "Vision Indemnity": ["Vision Indemnity"]}
census_plan_rows = []
for c in clients:
    size = c["_meta"]["size"]
    years = [y for y in ("2024", "2025", "2026") if chance(0.85)] or ["2026"]
    for y in years:
        doc = f"census-{c['oneCode'].lower()}-{y}-{rng.randint(1000, 9999)}"
        heads = int(size * {"2024": 0.94, "2025": 0.97, "2026": 1.0}[y] * rng.uniform(0.96, 1.04))
        eligible = int(heads * rng.uniform(0.86, 0.97))
        enrolled = int(eligible * rng.uniform(0.72, 0.9))
        female = round(rng.uniform(0.32, 0.68), 3)
        states = rng.sample(US_STATES, rng.randint(1, 6))
        if c["_meta"]["hq"] not in states:
            states[0] = c["_meta"]["hq"]
        w = [rng.random() for _ in states]
        w[states.index(c["_meta"]["hq"])] += 2.5
        by_state = {s: int(heads * x / sum(w)) for s, x in zip(states, w)}
        answers = {"totalEmployees": heads, "eligibleEmployees": eligible, "enrolledEmployees": enrolled,
                   "averageAge": round(rng.uniform(34, 49), 1), "averageSalary": int(rng.uniform(48000, 135000)),
                   "gender": {"female": female, "male": round(1 - female, 3)},
                   "byState": by_state,
                   "medicalTier": {t: int(enrolled * w2) for t, w2 in TIER_MIX.items()},
                   "employeeClass": {"fullTime": int(heads * 0.88), "partTime": heads - int(heads * 0.88)}}
        ca = add("census_answers", documentId=doc, clientOneCode=c["oneCode"], answers=answers,
                 contextData={"source": rng.choice(["upload", "upload", "api", "carrierFeed"]),
                              "fileName": f"{c['name'].replace(' ', '_')}_census_{y}.xlsx",
                              "uploadedBy": f"benefits@{c['_meta']['domain']}",
                              "uploadedAt": f"{int(y) - 1}-{rng.randint(8, 12):02d}-{rng.randint(1, 28):02d}T15:00:00Z"},
                 effectiveYear=y, deleted=soft(0.03))
        if chance(0.9):
            add("aggregated_census_answers", client_clientId=c["_id"], documentId=doc,
                census={"effectiveYear": y, "headcount": heads, "enrolled": enrolled,
                        "participationRate": round(enrolled / max(1, eligible), 3),
                        "averageAge": answers["averageAge"], "femalePct": female,
                        "tierMix": {t: round(v / max(1, enrolled), 3) for t, v in answers["medicalTier"].items()},
                        "statesCount": len(by_state), "computedAt": f"{int(y) - 1}-12-15T02:00:00Z"},
                deleted=ca["deleted"])
        # census plans for this document (Medical, Dental, Vision)
        for loc in ("Medical", "Dental", "Vision"):
            pds = [p for p in live_pds if p["_meta"]["client"] is c and p["_meta"]["loc"] == loc]
            if not pds:
                continue
            for p in pds:
                lab = rng.choice(PLAN_LABEL.get(p["_meta"]["ptype"], [p["_meta"]["ptype"]])).format(d=rng.choice([500, 1000, 1500, 2000, 3000]))
                if chance(0.3):
                    lab = lab.upper()
                cp = add("census_plans", client_clientId=c["_id"], loc_productId=PROD(loc), documentId=doc,
                         name=f"{p['_meta']['carrier'].split()[0]} {lab}", deleted=soft(0.02))
                census_plan_rows.append((cp, p, y))
            if chance(0.25):  # a census plan nobody recognises -> stays unmapped
                cp = add("census_plans", client_clientId=c["_id"], loc_productId=PROD(loc), documentId=doc,
                         name=rng.choice(["Legacy Plan", "COBRA Continuation", "Waived", "Plan 3 (old)", "Retiree Medical"]),
                         deleted=False)
                census_plan_rows.append((cp, None, y))

for cp, p, y in census_plan_rows:
    if p is None or chance(0.12):  # ~12% of recognisable plans still unmapped
        continue
    add("plan_design_census_plans", documentId=f"map-{cp['documentId']}-{cp['_id'][-6:]}", censusPlanId=cp["_id"],
        intellifyPlanId=p["_id"], effectiveYear=y)

# ------------------------------------------------------- commercial terms -
credits = []
for c in clients:
    carriers = sorted({p["_meta"]["carrier"] for p in live_pds if p["_meta"]["client"] is c}) or ["Aetna"]
    for _ in range(rng.choice([0, 1, 2, 2, 3, 4])):
        cr = add("carrier_credits", client_clientId=c["_id"], carrierInfo_insurerId=insurers[rng.choice(carriers)]["_id"],
                 carrierInfo_expirationDate=rdate(date(2025, 1, 1), date(2027, 12, 31)), isFinal=chance(0.7),
                 deleted=soft(0.04))
        credits.append(cr)
        for _ in range(rng.choice([0, 1, 1, 2])):
            add("carrier_credit_notifications", carrierCreditId=cr["_id"],
                sectionResourceKey=rng.choice(cc_types)["section_resourceKey"],
                emailId=rng.choice(["credit-expiry-warning", "credit-document-request", "credit-finalize-reminder"]),
                dueDays=rng.choice([7, 14, 30, 45, 60]))
    for _ in range(rng.choice([0, 1, 2, 3])):
        eff = rdate(date(2024, 1, 1), date(2026, 7, 1)).replace(day=1)
        add("lad_ancillary_fees", client_clientId=c["_id"],
            ladAncillaryFeesInfo_insurerId=insurers[rng.choice(carriers)]["_id"], effectiveDate=eff,
            expirationDate=date(eff.year + 1, eff.month, 1) - timedelta(days=1), deleted=soft(0.04))
    for loc in [l for l in c["_meta"]["locs"] if l in ("Medical", "Dental", "Vision")]:
        for y in (2025, 2026):
            add("contribution_questions", client_clientId=c["_id"], loc_productId=PROD(loc),
                effectivePeriod_startDate=date(y, 1, 1), effectivePeriod_endDate=date(y, 12, 31), deleted=soft(0.02))
    for y in (2025, 2026):
        if chance(0.7):
            meds = [p for p in live_pds if p["_meta"]["client"] is c and p["_meta"]["loc"] == "Medical"]
            add("national_survey", client_clientId=c["_id"], effectivePeriod_startDate=date(y, 1, 1),
                effectivePeriod_endDate=date(y, 12, 31),
                answers={"industry": c["_meta"]["industry"], "region": REGION[c["_meta"]["hq"]],
                         "headquartersState": c["_meta"]["hq"], "employeeCount": c["_meta"]["size"],
                         "medicalPlanCount": len(meds), "offersHDHP": any(p["_meta"]["ptype"] == "HDHP" for p in meds),
                         "selfFunded": any(p["_meta"]["funding"] == "Self-Funded" for p in meds),
                         "avgIndividualDeductible": rng.choice([500, 750, 1000, 1500, 2000, 2500, 3000]),
                         "employerHsaContribution": rng.choice([0, 250, 500, 750, 1000]),
                         "wellnessProgram": chance(0.6), "spousalSurcharge": chance(0.25),
                         "costIncreaseExpectedPct": round(rng.uniform(0.04, 0.11), 3)},
                deleted=soft(0.02))
    for v in rng.sample(list(VENDORS), rng.choice([0, 1, 2, 3, 4])):
        prod = rng.choice(vprods[v])
        add("point_solutions_products", client_clientId=c["_id"], vendor_id=vendors[v]["_id"],
            product_id=prod["_id"], deleted=soft(0.05))

# ------------------------------------------------------------------ events -
TOPICS = [("intellify.planDesign", "planDesign.created", "pd"), ("intellify.planDesign", "planDesign.updated", "pd"),
          ("intellify.planDesign", "planDesign.published", "pd"), ("intellify.census", "census.uploaded", "c"),
          ("intellify.census", "census.mapped", "c"), ("intellify.wizard", "wizard.started", "c"),
          ("intellify.wizard", "wizard.completed", "c"), ("intellify.carrierCredit", "carrierCredit.finalized", "c"),
          ("intellify.client", "client.updated", "c"), ("intellify.renewal", "renewal.kickedOff", "c")]
for _ in range(1800):
    ch, tp, ref = rng.choices(TOPICS, [8, 22, 6, 7, 5, 6, 4, 3, 6, 4])[0]
    target = rng.choice(plan_designs)["_id"] if ref == "pd" else rng.choice(clients)["_id"]
    add("events", channel=ch, topic=tp, collectionId=target, createdAt=rts(date(2025, 1, 1), date(2026, 10, 10)))

# ------------------------------------------------------------ descriptions -
# Condensed from the data dictionary. Generic column names first, then table.column overrides.
GENERIC = {
    "id": "Mongo ObjectId (24-hex) of the source document. Primary key.",
    "deleted": "Soft-delete flag. Rows with deleted = true are kept in the source; filter deleted = false.",
    "loc_product_id": "Line of coverage (LOC). FK to products.id (medical, dental, vision, life, ...).",
    "client_client_id": "Owning employer client. FK to clients.id.",
    "display_order": "Sort position in the UI.",
    "section_resource_key": "Localisation key of the form section, not display text.",
    "loc_loc_type": "LOC type, denormalised from products.loc_type.",
    "created_at": "Row creation timestamp.",
    "name": "Name.",
}
SPECIFIC = {
    "clients.one_code": "Enterprise client code (unique). Cross-system join key; census_answers joins on this instead of id.",
    "clients.name": "Client display name.",
    "clients.tenant_key": "Tenant / partition the client belongs to.",
    "contacts.clients_client_id": "Client the contact is attached to. FK to clients.id.",
    "contacts.location_country_id": "Country of the contact. FK to countries.id.",
    "contacts.email": "Contact email (PII).",
    "contacts.contact_type": "Role of the contact (HR Lead, Broker, Billing, ...). Uncontrolled free text; casing varies.",
    "countries.code": "ISO 3166 alpha-2 country code.",
    "countries.name": "Country name.",
    "products.name": "Line-of-coverage name (Medical, Dental, Vision, Basic Life / AD&D, ...).",
    "products.loc_type": "LOC type discriminator: medical, dental, vision, life, disability, voluntary, eap.",
    "products_hierarchies.parent": "Parent node (self-reference to products_hierarchies.id). NULL for a root node.",
    "products_hierarchies.display_name": "Node label.",
    "products_hierarchies.level": "Depth in the tree (0 = root group).",
    "product_groups.name": "Product group name.",
    "plan_types.name": "Plan type (PPO, HMO, HDHP, EPO, DPPO, ...).",
    "plan_types.is_chip_hidden": "Hides the plan-type chip in the UI.",
    "plan_types.similar_plan_types_ids": "Comma-delimited plan_types ids a plan can be benchmarked against.",
    "insurers.name": "Carrier name.",
    "insurers.code": "Carrier code; also the prefix of policies.number.",
    "insurer_categories.map_name": "Internal mapping name.",
    "insurer_categories.display_name": "Category label.",
    "funding_types.name": "Funding arrangement: Fully Insured, Self-Funded, Level-Funded, Minimum Premium.",
    "funding_types.theme": "UI colour token.",
    "loc_statuses.status": "Workflow status of the client/LOC pair: Not Started, In Progress, Under Review, Complete.",
    "loc_statuses.start_date": "When the status took effect. No end date: current status = latest start_date per client/LOC.",
    "plan_designs.insurer_insurer_id": "Carrier of the plan. FK to insurers.id.",
    "plan_designs.plan_info_funding_type_id": "Funding arrangement. FK to funding_types.id.",
    "plan_designs.plan_info_state_id": "Lifecycle state. FK to plan_states.id (Draft, In Review, Approved, Published, Archived).",
    "plan_designs.plan_creation_identifier_flag": "How the plan was created: manual, cloned, wizard, imported.",
    "plan_states.resource_key": "Localisation key of the state (planState.published, ...).",
    "plan_states.display_name": "State label.",
    "plan_states.is_active": "Whether the state is selectable.",
    "wizards.wizard_type": "Wizard flow: renewal, newPlan, benchmark, marketing.",
    "wizards.status": "Run progress: complete, inProgress, abandoned.",
    "wizard_alternate_plans.plan_design_id": "Plan design the option is based on. FK to plan_designs.id.",
    "wizard_alternate_plans.funding_type_id": "Funding arrangement of the option. FK to funding_types.id.",
    "wizard_alternate_plans.name": "Option label.",
    "plan_eligibility_details.plan_design_plan_design_id": "Plan design the eligibility rule belongs to. FK to plan_designs.id.",
    "plan_eligibility_details.workflow_status": "Approval state: approved, submitted, draft; older versions are superseded.",
    "plan_eligibility_details.is_current": "Active version flag. Filter is_current = true or rows double-count.",
    "plan_eligibility_types.level": "Nesting depth of the section.",
    "plan_design_hierarchy_types.is_toggleable": "Section can be switched on and off.",
    "plan_design_hierarchy_types.is_dynamic": "Rows can be added at runtime.",
    "plan_design_hierarchy_types.is_tier_table": "Section renders as a coverage-tier table.",
    "plan_design_header_dependencies.header_resource_key": "Header the rule applies to.",
    "plan_design_header_dependencies.condition_match_key": "Condition that triggers the rule.",
    "plan_design_header_dependencies.action_action_key": "Action when the condition matches: show, hide, require.",
    "plan_financial_types.headers": "JSON column definitions of the financial section.",
    "plan_financial_types_validations.validation_key": "Rule identifier.",
    "plan_financial_types_validations.display_message": "Message shown when the rule fails.",
    "plan_financial_types_validations.condition": "JSON expression for when the rule fires.",
    "plan_financial_types_validations.depends_on": "JSON list of fields the rule reads.",
    "policies.insurer_insurer_id": "Carrier on the policy. FK to insurers.id.",
    "policies.kick_off_timing_kick_off_timing_id": "Renewal kick-off rule. FK to renewal_kick_off_timings.id.",
    "policies.number": "Policy number issued by the carrier.",
    "policy_coverages.policy_info_policy_id": "Parent policy. FK to policies.id.",
    "policy_coverages.plan_design_plan_design_id": "Plan design realised by this coverage. FK to plan_designs.id.",
    "policy_coverages.insurer_insurer_id": "Carrier for this coverage. FK to insurers.id.",
    "policy_financials.policy_coverage_policy_coverage_id": "Coverage these financials belong to (one-to-one). FK to policy_coverages.id.",
    "policy_financials.plan_financial": (
        "JSON money document (plan year 2026, USD). Keys: annualPremium, monthlyPremium, priorYearAnnualPremium, "
        "renewalIncreasePct, fundingType, planType, ratingBasis; medical/dental/vision also rates{employeeOnly,"
        "employeeSpouse,employeeChildren,family}, enrollment{same tiers}, enrolledEmployees, contributions{employerPct,"
        "employeeMonthlyEmployeeOnly}, fees{adminFeePepm,stopLossPepm} when not fully insured; life, disability and "
        "voluntary lines: coveredLives, ratePer1000, volume, pepm. Read with (plan_financial->>'annualPremium')::numeric."),
    "renewal_kick_off_timings.name": "Rule name, e.g. 120 days prior.",
    "renewal_kick_off_timings.days": "Days before renewal that the process kicks off.",
    "renewal_reminder_notifications.plan_design_id": "Plan design the reminder is about. FK to plan_designs.id.",
    "renewal_reminder_notifications.email_id": "Email template identifier.",
    "renewal_reminder_notifications.reminder_date": "When the reminder is due or was sent.",
    "census_answers.document_id": "Census submission id; matches aggregated_census_answers.document_id and census_plans.document_id.",
    "census_answers.client_one_code": "Client reference as the oneCode string (FK to clients.one_code), not an ObjectId.",
    "census_answers.answers": (
        "JSON census payload: totalEmployees, eligibleEmployees, enrolledEmployees, averageAge, averageSalary, "
        "gender{female,male}, byState{STATE:count}, medicalTier{employeeOnly,...}, employeeClass{fullTime,partTime}."),
    "census_answers.context_data": "JSON upload context: source, fileName, uploadedBy, uploadedAt.",
    "census_answers.effective_year": "Plan year the census applies to (text: 2024, 2025, 2026).",
    "census_plans.document_id": "Census submission the plan name came from.",
    "census_plans.name": "Plan name exactly as written in the census (uncontrolled text).",
    "plan_design_census_plans.document_id": "Mapping document id (unique).",
    "plan_design_census_plans.census_plan_id": "Census-side plan. FK to census_plans.id. Census plans with no row here are unmapped.",
    "plan_design_census_plans.intellify_plan_id": "Intellify plan design. FK to plan_designs.id.",
    "plan_design_census_plans.effective_year": "Plan year the mapping is valid for.",
    "aggregated_census_answers.document_id": "Census submission the aggregate summarises (unique).",
    "aggregated_census_answers.census": (
        "JSON rollup: effectiveYear, headcount, enrolled, participationRate, averageAge, femalePct, tierMix, "
        "statesCount, computedAt."),
    "census_hierarchies.resource_key": "Localisation key of the census field.",
    "census_hierarchies.document_key": "Key of the census field (matches keys in census_answers.answers).",
    "census_hierarchies.parent": "Parent node document_key (self-reference by key). NULL for a root.",
    "census_hierarchies.is_parent": "Whether the node has children.",
    "carrier_credits.carrier_info_insurer_id": "Carrier granting the credit. FK to insurers.id.",
    "carrier_credits.carrier_info_expiration_date": "Credit expiry. Exclude expired credits from value calculations.",
    "carrier_credits.is_final": "Finalised credit. Non-final credits are provisional.",
    "carrier_credit_types.is_default": "Default selection.",
    "carrier_credit_types.display_name": "Credit type label.",
    "carrier_credit_types_validations.validation_key": "Rule identifier.",
    "carrier_credit_types_validations.display_message": "Message shown when the rule fails.",
    "carrier_credit_types_validations.condition": "JSON expression for when the rule fires.",
    "carrier_credit_types_validations.depends_on": "JSON list of fields the rule reads.",
    "carrier_credit_notifications.carrier_credit_id": "Credit the notification relates to. FK to carrier_credits.id.",
    "carrier_credit_notifications.section_resource_key": "Credit form section the notification concerns.",
    "carrier_credit_notifications.email_id": "Email template identifier.",
    "carrier_credit_notifications.due_days": "Days before the trigger date that the notification fires.",
    "lad_ancillary_fees.lad_ancillary_fees_info_insurer_id": "Carrier charging the fee. FK to insurers.id.",
    "lad_ancillary_fees.effective_date": "Start of the fee window.",
    "lad_ancillary_fees.expiration_date": "End of the fee window. Point-in-time questions filter on both dates.",
    "lad_ancillary_fee_types.options": "JSON selectable options.",
    "lad_ancillary_fee_types.headers": "JSON column definitions.",
    "contribution_questions.effective_period_start_date": "Start of the period.",
    "contribution_questions.effective_period_end_date": "End of the period.",
    "national_survey.effective_period_start_date": "Start of the survey period.",
    "national_survey.effective_period_end_date": "End of the survey period.",
    "national_survey.answers": (
        "JSON survey answers: industry, region, headquartersState, employeeCount, medicalPlanCount, offersHDHP, "
        "selfFunded, avgIndividualDeductible, employerHsaContribution, wellnessProgram, spousalSurcharge, "
        "costIncreaseExpectedPct."),
    "mercervip_vendors.name": "Vendor name (unique).",
    "mercervip_products.name": "Marketplace product name (not a line of coverage).",
    "mercervip_products.vendor_id": "Vendor offering the product. FK to mercervip_vendors.id.",
    "mercervip_categories.name": "Category name (unique).",
    "point_solutions_products.vendor_id": "Vendor of the selected product. FK to mercervip_vendors.id.",
    "point_solutions_products.product_id": "Selected MercerVIP product. FK to mercervip_products.id.",
    "events.channel": "Event channel (intellify.planDesign, intellify.census, ...).",
    "events.topic": "Event type (planDesign.updated, census.uploaded, wizard.completed, ...).",
    "events.collection_id": "Untyped reference: a plan_designs.id for planDesign.* topics, otherwise a clients.id.",
    "migrations.migration_name": "Migration script name.",
    "migrations.timestamp": "When it ran.",
    "migrations.result": "JSON outcome.",
    "migrations.flags": "Flags the migration ran with.",
    "data_types.data_type": "Logical type name.",
    "data_types.primitive_data_type": "Underlying primitive.",
    "data_types.data_format": "Format mask.",
    "data_types.default_value": "Default value.",
}


_KNOWN = {f"{name}.{col(f)}" for name, _, cols in T for f, _, _, _ in cols}
assert not set(SPECIFIC) - _KNOWN, f"descriptions for unknown columns: {sorted(set(SPECIFIC) - _KNOWN)}"


def describe(table_name, column):
    text = SPECIFIC.get(f"{table_name}.{column}") or GENERIC.get(column)
    assert text, f"no description for {table_name}.{column}"
    return text


# ------------------------------------------------------------------ output -
def lit(v, typ):
    if v is None:
        return "NULL"
    if typ == "bool":
        return "true" if v else "false"
    if typ == "int":
        return str(int(v))
    if typ == "json":
        return "'" + json.dumps(v, separators=(",", ":")).replace("'", "''") + "'::jsonb"
    if typ == "date":
        return f"'{v.isoformat()}'"
    if typ == "ts":
        return f"'{v.isoformat()}'"
    return "'" + str(v).replace("'", "''") + "'"


# Load order: parents first. Tables whose FK targets are all loaded go next.
deps = {}
for name, _, cols in T:
    deps[name] = {re.sub(r"\(.*", "", ref) for _, _, k, ref in cols if ref and k.startswith("FK")} - {name}
order, done = [], set()
while len(order) < len(T):
    ready = [n for n, _, _ in T if n not in done and deps[n] <= done]
    assert ready, "cycle"
    for n in ready:
        order.append(n)
        done.add(n)

def q(text):
    return "'" + text.replace("'", "''") + "'"


S = "intellify"
out = []
w = out.append
w("-- Intellify data model: PostgreSQL schema + synthetic data.")
w("-- Generated by scripts/generate-intellify-seed.py; do not edit by hand. All data is synthetic.")
w(f"DROP SCHEMA IF EXISTS {S} CASCADE;")
w(f"CREATE SCHEMA {S};")
w(f"COMMENT ON SCHEMA {S} IS 'Intellify source collections (Mongo) landed as tables. Synthetic sample data. Filter deleted = false.';")
for name in order:
    _, comment, cols = next(t for t in T if t[0] == name)
    lines = []
    for f, typ, key, ref in cols:
        line = f'  "{col(f)}" {SQLTYPE[typ]}'
        if key == "PK":
            line += " PRIMARY KEY"
        elif key in ("UK", "FK1"):
            line += " UNIQUE"
        lines.append(line)
    w(f'CREATE TABLE {S}."{name}" (\n' + ",\n".join(lines) + "\n);")
    w(f'COMMENT ON TABLE {S}."{name}" IS {q(comment + " Source collection: " + name.upper() + ".")};')
    for f, typ, key, ref in cols:
        source = f"Source field: {f}" + (f" ({key.replace('FK1', 'FK')})" if key else "")
        w(f'COMMENT ON COLUMN {S}."{name}"."{col(f)}" IS {q(describe(name, col(f)) + " " + source + ".")};')
for name in order:
    _, _, cols = next(t for t in T if t[0] == name)
    names = [f'"{col(f)}"' for f, _, _, _ in cols]
    rows = ROWS[name]
    for i in range(0, len(rows), 200):
        vals = ",\n".join("(" + ",".join(lit(r[f], typ) for f, typ, _, _ in cols) + ")" for r in rows[i:i + 200])
        w(f'INSERT INTO {S}."{name}" ({", ".join(names)}) VALUES\n{vals};')
# Foreign keys after the data (self-references and load order both satisfied).
for name, _, cols in T:
    for f, typ, key, ref in cols:
        if key.startswith("FK"):
            m = re.match(r"(\w+)(?:\((\w+)\))?", ref)
            cname = f"fk_{name}_{col(f)}"[:63]
            w(f'ALTER TABLE {S}."{name}" ADD CONSTRAINT "{cname}" FOREIGN KEY ("{col(f)}") '
              f'REFERENCES {S}."{m.group(1)}" ("{m.group(2) or "id"}");')
            w(f'CREATE INDEX ON {S}."{name}" ("{col(f)}");')

# mtime=0 and no embedded file name keep the gzip byte-identical across runs.
with open(OUT, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=9) as fh:
    fh.write(("\n".join(out) + "\n").encode("utf-8"))

total = sum(len(v) for v in ROWS.values())
print(f"tables={len(T)} attributes={n_attrs} rows={total}")
for name in order:
    print(f"  {name:36s} {len(ROWS[name]):6d}")
