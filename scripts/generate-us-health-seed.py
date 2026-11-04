#!/usr/bin/env python3
"""Write the US Health Testing Data seed: a PostgreSQL schema plus synthetic data.

Source model: the approved "Mercer US Health data model" design (story BA-306, epic
BA-305): 41 analytics tables in 8 domains (firm & clients, benefit programs, members &
claims, benchmarking, employee surveys, life/absence/disability, strategy, data
operations) plus 4 reporting views, all in schema us_health. Columns are typed
(numeric(14,2) money, integer counts, date, boolean, text), keys are readable text
(C017, P-C017-2026-MED1), every foreign key is declared, and every table, view and
column carries a comment with its grain and meaning.

All rows are synthetic and deterministic: running this again rewrites the seed byte
for byte (fixed random seed, gzip mtime=0, no now(), no random UUIDs, no set
iteration). The dataset's "today" is fixed at 2026-10-31. Change this script and
regenerate; never edit the seed by hand. Benchmark means follow Mercer's published
National Survey headlines; every split, client, carrier, vendor and person is invented.

Planted signals and data-quality defects (each asserted by
scripts/test_generate_us_health_seed.py) are listed in PLANTED below.

See specs/capabilities/testing-data/spec.md. Standard library only:
    python3 scripts/generate-us-health-seed.py [output.sql.gz]
"""
import gzip
import io
import math
import os
import random
import sys
from datetime import date, timedelta

SEED = 20261104
S = "us_health"
TODAY = date(2026, 10, 31)          # the dataset's fixed "today"
CLAIMS_START = date(2023, 1, 1)
CLAIMS_END = date(2026, 9, 30)      # last service date a complete feed covers
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", "src", "modules",
                           "testing-data", "fixtures", "004_us_health.sql.gz")

PLANTED = """
Signals: (1) deep-data client cost per employee-month follows the market: +5.0% 2023->2024,
+6.0% 2024->2025, +6.75% 2025->2026; 2027 medical renewals average ~8% final increase.
(2) Clients covering GLP-1s for weight loss run Rx trend 5 points above those that do not;
Northgate (C017) adopted GLP-1 criteria and a PBM carve-out for 2027.
(3) HDHP plans cost less per member than PPO but score lower on medical satisfaction.
(4) Brightwater (C023) has a ~$2.1M NICU claimant (born 2025) above its stop-loss specific deductible.
(5) Halvorsen (C044) LTD loss ratio above 100% in 2024 and 2025; MSK is its top STD diagnosis.
(6) Fairhaven (C012) pays 6 weeks of leave in WA and NY, below those states' 12-week laws.
(7) Northeast and West peer groups cost more per employee than South and Midwest.
Defects: Corliss (C038) medical feed 45 days late and its Aug-Sep 2026 medical claims thin;
duplicated medical claims (same member, date, amount, new claim_id); claims outside any
enrollment; service dates after paid date or after 2026-10-31; missing dependent birth years;
one survey subgroup (SV-C044-2025, Executive) with 7 respondents.
"""

# ---------------------------------------------------------------- schema ---
# Types: text | int | money numeric(14,2) | pct numeric(7,2) | num numeric(14,2) | rate numeric(12,4)
#        | date | bool.  ref = "table.column" declares a foreign key (added after the data).
SQLTYPE = {"text": "text", "int": "integer", "money": "numeric(14,2)", "pct": "numeric(7,2)",
           "num": "numeric(14,2)", "rate": "numeric(12,4)", "date": "date", "bool": "boolean"}
TABLES = []


def table(name, comment, cols, pk=None):
    TABLES.append({"name": name, "comment": comment, "cols": cols, "pk": pk or [cols[0][0]]})


def c(name, typ, comment, ref=None):
    return (name, typ, comment, ref)


# 01 firm & clients
table("offices", "One row per Mercer US Health office (synthetic). Grain: office.", [
    c("office_id", "text", "Office key, OF- plus a city code (OF-CHI)."),
    c("city", "text", "Office city."),
    c("state", "text", "Two-letter US state of the office."),
    c("region", "text", "US Census region: Northeast, Midwest, South or West.")])
table("service_lines", "One row per US Health & Benefits service line. Grain: service line.", [
    c("service_line_id", "text", "Service line key (SL-STRAT, SL-ACT ...)."),
    c("name", "text", "Service line name, e.g. Strategy & Consulting, Pharmacy (MercerRx)."),
    c("category", "text", "Consulting, Specialty or Research."),
    c("description", "text", "What the service line does for clients.")])
table("colleagues", "One row per consultant or actuary (invented people). Grain: colleague.", [
    c("colleague_id", "text", "Colleague key (CL-0001)."),
    c("full_name", "text", "Invented full name."),
    c("role", "text", "Analyst, Associate, Consultant, Senior Consultant, Principal, Health Actuary or LAD Consultant."),
    c("office_id", "text", "Home office. FK to offices.", "offices.office_id"),
    c("service_line_id", "text", "Home practice. FK to service_lines.", "service_lines.service_line_id"),
    c("start_year", "int", "Year the colleague joined.")])
table("clients", "One row per employer client (fictional). Grain: client. The hub of the model.", [
    c("client_id", "text", "Client key, C plus three digits (C017)."),
    c("name", "text", "Invented employer name."),
    c("industry", "text", "One of 7 industries: Healthcare, Manufacturing, Transportation, Retail, Financial Services, Technology, Public sector."),
    c("segment", "text", "Mid-size (500-4,999), Large (5,000-19,999), Jumbo (20,000+) or Public sector."),
    c("hq_state", "text", "Two-letter headquarters state."),
    c("region", "text", "Census region of the headquarters state."),
    c("employee_count", "int", "Eligible benefits headcount of the whole employer. For deep-data clients the employees table holds a census SAMPLE, not every employee: compute PEPY/PMPM from employees, enrollments and claims, never by dividing claims by this column."),
    c("union_flag", "bool", "True when the client has collectively bargained employee groups."),
    c("renewal_month", "int", "Month the plan year starts: 1 for most clients, 7 for public sector."),
    c("office_id", "text", "Serving office. FK to offices.", "offices.office_id"),
    c("client_since", "int", "First year Mercer served the client."),
    c("deep_data", "bool", "True when census (employees, members, enrollments) and claims are on file. 8 clients.")])
table("engagements", "One row per client x service line x engagement period. Grain: engagement.", [
    c("engagement_id", "text", "Engagement key (ENG-C017-STRAT)."),
    c("client_id", "text", "Client served. FK to clients.", "clients.client_id"),
    c("service_line_id", "text", "Service line delivering it. FK to service_lines.", "service_lines.service_line_id"),
    c("lead_colleague_id", "text", "Lead consultant. FK to colleagues.", "colleagues.colleague_id"),
    c("fee_basis", "text", "Commission, Retainer or Project fee."),
    c("start_date", "date", "Engagement start."),
    c("end_date", "date", "Engagement end; NULL while ongoing."),
    c("status", "text", "Active or Completed (as of 2026-10-31).")])
table("revenue", "One row per engagement x month x revenue type. Grain: engagement, period_month, revenue_type. Jan 2023 - Oct 2026.", [
    c("engagement_id", "text", "Engagement that earned it. FK to engagements.", "engagements.engagement_id"),
    c("period_month", "date", "First day of the revenue month."),
    c("revenue_type", "text", "Commission (carrier commission on placed coverage), Supplemental comp (carrier volume/retention bonus, booked each March) or Fee."),
    c("amount_usd", "money", "Recognised revenue in USD.")],
    pk=["engagement_id", "period_month", "revenue_type"])
table("deliverables", "One row per deliverable produced on an engagement. Grain: deliverable.", [
    c("deliverable_id", "text", "Deliverable key (DL-00001)."),
    c("engagement_id", "text", "Engagement it belongs to. FK to engagements.", "engagements.engagement_id"),
    c("deliverable_type", "text", "Renewal report, Plan modeling, Cost projection, Benchmark report, Strategy roadmap, RFP, PBM audit, Compliance review, Survey report or Claims dashboard."),
    c("title", "text", "Deliverable title."),
    c("due_date", "date", "Date promised to the client."),
    c("delivered_date", "date", "Date delivered; NULL when not yet delivered. Late when delivered_date > due_date.")])

# 02 benefit programs
table("carriers", "One row per carrier, TPA, PBM, stop-loss writer, LAD insurer, leave administrator or vendor (invented names). Grain: organisation.", [
    c("carrier_id", "text", "Carrier key (CR-01)."),
    c("name", "text", "Invented organisation name."),
    c("carrier_type", "text", "Medical carrier, TPA, PBM, Stop-loss, LAD carrier, Leave administrator, Dental & vision carrier or Ben admin vendor (benefits administration is a third-party vendor, not a Mercer service line).")])
table("plans", "One row per client x plan year x plan. Grain: plan (a plan id is specific to one plan year).", [
    c("plan_id", "text", "Plan key P-<client>-<plan year>-<line><n> (P-C017-2026-MED1)."),
    c("client_id", "text", "Sponsoring client. FK to clients.", "clients.client_id"),
    c("plan_year", "int", "Plan year 2023-2027 (2027 only for 1/1 renewals, decided Aug-Sep 2026)."),
    c("line_of_coverage", "text", "Medical, Rx (a carved-out pharmacy contract), Dental or Vision."),
    c("plan_name", "text", "Plan name shown to employees."),
    c("plan_type", "text", "PPO, HMO, EPO, HDHP/HSA, POS; DPPO, DHMO; Vision PPO; PBM for Rx."),
    c("funding", "text", "Fully insured, Self-funded (ASO) or Level-funded."),
    c("carrier_id", "text", "Insurer or administrator. FK to carriers.", "carriers.carrier_id"),
    c("pbm_carrier_id", "text", "Pharmacy benefit manager behind the plan's Rx benefit (medical and Rx plans). FK to carriers.", "carriers.carrier_id"),
    c("network", "text", "Broad, Narrow or Tiered."),
    c("plan_start", "date", "First day of the plan year."),
    c("plan_end", "date", "Last day of the plan year.")])
table("plan_provisions", "One row per plan (1:1 with plans): plan design. Grain: plan. USD amounts per year unless named monthly.", [
    c("plan_id", "text", "Plan. PK and FK to plans.", "plans.plan_id"),
    c("deductible_single", "money", "In-network single deductible, USD."),
    c("deductible_family", "money", "In-network family deductible, USD."),
    c("oop_max_single", "money", "Single out-of-pocket maximum, USD (dental: annual benefit maximum)."),
    c("oop_max_family", "money", "Family out-of-pocket maximum, USD."),
    c("coinsurance_pct", "pct", "Member coinsurance percent after the deductible; the plan pays the rest."),
    c("pcp_copay", "money", "Primary-care visit copay, USD; NULL when coinsurance applies (HDHP)."),
    c("specialist_copay", "money", "Specialist visit copay, USD."),
    c("er_copay", "money", "Emergency room copay, USD."),
    c("rx_tier1_copay", "money", "Generic drug copay (30-day retail), USD."),
    c("rx_tier2_copay", "money", "Preferred brand copay, USD."),
    c("rx_tier3_copay", "money", "Non-preferred brand copay, USD."),
    c("rx_tier4_coinsurance_pct", "pct", "Specialty drug coinsurance percent."),
    c("hsa_employer_contrib", "money", "Employer HSA seed for single coverage, USD per year; HDHP only."),
    c("glp1_weight_loss_covered", "text", "Whether GLP-1 drugs are covered for weight loss: Yes, With criteria or No (medical and Rx plans).")])
table("plan_rates", "One row per plan x coverage tier. Grain: plan, tier. Premium or self-funded premium equivalent.", [
    c("plan_id", "text", "Plan. FK to plans.", "plans.plan_id"),
    c("tier", "text", "EE, EE+Spouse, EE+Child(ren) or Family."),
    c("total_monthly_rate", "money", "Total monthly premium (insured) or premium equivalent (self-funded), USD."),
    c("ee_monthly_contribution", "money", "Employee share of the monthly rate, USD."),
    c("enrolled_employees", "int", "Employees enrolled at the start of the plan year, whole-employer headcount basis.")],
    pk=["plan_id", "tier"])
table("renewals", "One row per client x plan year x line of coverage. Grain: renewal decision.", [
    c("renewal_id", "text", "Renewal key RN-<client>-<plan year>-<line> (RN-C017-2027-MED)."),
    c("client_id", "text", "Client renewing. FK to clients.", "clients.client_id"),
    c("plan_year", "int", "Plan year the renewal sets."),
    c("line_of_coverage", "text", "Medical, Dental or Vision."),
    c("incumbent_carrier_id", "text", "Carrier in place before the renewal. FK to carriers.", "carriers.carrier_id"),
    c("new_carrier_id", "text", "Carrier moved to when outcome = Moved carrier, else NULL. FK to carriers.", "carriers.carrier_id"),
    c("initial_increase_pct", "pct", "Carrier's first renewal offer, percent change in cost."),
    c("final_increase_pct", "pct", "Final percent change after negotiation or marketing; NULL while pending."),
    c("marketed", "bool", "True when the line was sent to market (RFP)."),
    c("outcome", "text", "Renewed, Moved carrier, Changed funding or Pending."),
    c("decision_date", "date", "Decision date: Aug-Sep of the prior year for 1/1 renewals, Mar-Apr for 7/1; NULL while pending.")])
table("stop_loss_contracts", "One row per self-funded or level-funded client x plan year. Grain: stop-loss contract.", [
    c("stop_loss_id", "text", "Contract key SL-<client>-<plan year>."),
    c("client_id", "text", "Client insured. FK to clients.", "clients.client_id"),
    c("plan_year", "int", "Plan year covered."),
    c("carrier_id", "text", "Stop-loss writer. FK to carriers.", "carriers.carrier_id"),
    c("contract_basis", "text", "Incurred/paid basis: 12/12, 12/15, 12/18 or Paid."),
    c("specific_deductible", "money", "Specific (per claimant) deductible, USD per plan year."),
    c("aggregate_corridor_pct", "pct", "Aggregate attachment as a percent of expected claims (typically 125)."),
    c("premium_pepm", "money", "Stop-loss premium per employee per month, USD."),
    c("lasered_claimants", "int", "Claimants with an individual (lasered) deductible.")])

# 03 members & claims
table("employees", "One row per employee in a deep-data client's census. A scaled SAMPLE of the employer (see clients.employee_count). Grain: employee.", [
    c("employee_id", "text", "Employee key EMP-<client>-<n> (EMP-C017-00001)."),
    c("client_id", "text", "Employer. FK to clients.", "clients.client_id"),
    c("birth_year", "int", "Birth year (no birth dates are stored)."),
    c("gender", "text", "Female, Male or Not disclosed."),
    c("work_state", "text", "Two-letter work state; drives which state leave law applies."),
    c("job_level", "text", "Hourly, Salaried or Executive."),
    c("salary_band", "text", "Banded annual salary: <$40k, $40-60k, $60-90k, $90-130k, $130k+."),
    c("hire_date", "date", "Hire date."),
    c("term_date", "date", "Termination date; NULL while employed."),
    c("status", "text", "Active (term_date NULL) or Terminated.")])
table("members", "One row per covered person: the employee and each dependent. Grain: member.", [
    c("member_id", "text", "Member key <employee>-<n>; suffix 0 is the employee."),
    c("employee_id", "text", "Subscribing employee. FK to employees.", "employees.employee_id"),
    c("relationship", "text", "Employee, Spouse or Child."),
    c("birth_year", "int", "Birth year; missing (NULL) for a few dependents."),
    c("gender", "text", "Female, Male or Not disclosed.")])
table("enrollments", "One row per employee x medical plan x coverage period. Grain: election. Rx coverage follows the medical plan.", [
    c("enrollment_id", "text", "Enrollment key (ENR-0000001)."),
    c("employee_id", "text", "Enrolled employee. FK to employees.", "employees.employee_id"),
    c("plan_id", "text", "Medical plan elected. FK to plans.", "plans.plan_id"),
    c("tier", "text", "EE, EE+SP, EE+CH or FAM."),
    c("covered_members", "int", "Members covered under the election (employee plus covered dependents). Sum it for member months."),
    c("start_date", "date", "Coverage start (plan-year start or hire date)."),
    c("end_date", "date", "Coverage end (plan-year end or termination date). Active on a day when start_date <= day <= end_date.")])
table("medical_claims", "One row per medical claim header, deep-data clients only. Grain: claim. Service dates 2023-01-01 to 2026-09-30.", [
    c("claim_id", "text", "Claim key (MC-00000001)."),
    c("member_id", "text", "Patient. FK to members.", "members.member_id"),
    c("plan_id", "text", "Medical plan that adjudicated it. FK to plans.", "plans.plan_id"),
    c("service_date", "date", "Date of service (incurred date)."),
    c("paid_date", "date", "Date the claim was paid or denied."),
    c("setting", "text", "Inpatient, Outpatient, Professional, ER or Telehealth."),
    c("diagnosis_group", "text", "MSK, Cardiovascular, Cancer, Maternity, Mental health, Respiratory, Digestive, Injury, Preventive, Neonatal / NICU or Other."),
    c("allowed", "money", "Allowed amount after network discounts, USD."),
    c("plan_paid", "money", "Amount the plan paid, USD (0 when denied). The employer cost."),
    c("member_paid", "money", "Member cost share (deductible, copay, coinsurance), USD."),
    c("status", "text", "Paid, Denied or Adjusted. Denial rate = Denied / all claims."),
    c("denial_reason", "text", "Reason when Denied, else NULL."),
    c("network_flag", "text", "In or Out of network.")])
table("rx_claims", "One row per pharmacy fill, deep-data clients only. Grain: fill. Fill dates 2023-01-01 to 2026-09-30.", [
    c("rx_claim_id", "text", "Fill key (RX-00000001)."),
    c("member_id", "text", "Patient. FK to members.", "members.member_id"),
    c("plan_id", "text", "Medical plan whose pharmacy benefit paid the fill. FK to plans.", "plans.plan_id"),
    c("fill_date", "date", "Date filled."),
    c("drug_class", "text", "Generic, Brand, Specialty, GLP-1 (diabetes) or GLP-1 (weight loss)."),
    c("days_supply", "int", "Days of supply (30 or 90)."),
    c("channel", "text", "Retail, Mail or Specialty pharmacy."),
    c("ingredient_cost", "money", "Gross ingredient cost, USD (plan_paid + member_paid)."),
    c("plan_paid", "money", "Amount the plan paid, USD, before rebates."),
    c("member_paid", "money", "Member copay or coinsurance, USD."),
    c("rebate_estimate", "money", "Estimated manufacturer rebate, USD.")])

# 04 benchmarking
table("benchmark_sources", "One row per survey edition or study. Grain: source.", [
    c("source_id", "text", "Source key (NS-2025, NS-2026P, ABS-2024 ...)."),
    c("name", "text", "Source name; Mercer sources are labelled (synthetic): published means where they exist, invented splits."),
    c("publisher", "text", "Publishing organisation."),
    c("survey_year", "int", "Year the values describe (2026/2027 National Survey rows are projections)."),
    c("fielded", "text", "When the survey was in the field."),
    c("respondents", "int", "Responding employers (or contributing insurers for the SOA study)."),
    c("notes", "text", "What is published versus synthetic.")])
table("peer_groups", "One row per benchmark cut: size band x region x industry x union. Grain: peer group.", [
    c("peer_group_id", "text", "Peer group key (PG-001)."),
    c("label", "text", "Readable cut, e.g. Manufacturing - Midwest - 1,000-4,999."),
    c("size_band", "text", "Employer size band (10-49 ... 20,000+), All 500+ for the large-employer total."),
    c("region", "text", "Northeast, Midwest, South, West or All."),
    c("industry", "text", "One of the 7 industries or All."),
    c("union_status", "text", "Any or Union.")])
table("benchmark_measures", "One row per benchmark measure. Grain: measure.", [
    c("measure", "text", "Measure key, e.g. cost_per_employee, ppo_deductible_single, std_incidence_per_100."),
    c("unit", "text", "USD, %, days, weeks, months, per 100 or per 1,000."),
    c("domain", "text", "Medical, Rx, Plan design, Contribution, Programs, Strategy or LAD."),
    c("definition", "text", "Definition the agents quote.")])
table("benchmark_values", "One row per source x peer group x measure. Grain: benchmark value.", [
    c("source_id", "text", "Source. FK to benchmark_sources.", "benchmark_sources.source_id"),
    c("peer_group_id", "text", "Peer group. FK to peer_groups.", "peer_groups.peer_group_id"),
    c("measure", "text", "Measure. FK to benchmark_measures.", "benchmark_measures.measure"),
    c("p25", "num", "25th percentile across employers in the cut; NULL for prevalence measures."),
    c("p50", "num", "Median; NULL for prevalence measures."),
    c("p75", "num", "75th percentile; NULL for prevalence measures."),
    c("mean", "num", "Mean (prevalence measures: percent of employers)."),
    c("n", "int", "Respondents in the cut; NULL (suppressed) below 10.")],
    pk=["source_id", "peer_group_id", "measure"])

# 05 employee surveys
table("surveys", "One row per client employee-benefits survey wave. Grain: survey.", [
    c("survey_id", "text", "Survey key SV-<client>-<year>."),
    c("client_id", "text", "Client running the survey. FK to clients.", "clients.client_id"),
    c("name", "text", "Survey name, e.g. 2026 Benefits Pulse."),
    c("field_start", "date", "First day in the field."),
    c("field_end", "date", "Last day in the field."),
    c("invited_count", "int", "Employees invited. Response rate = respondents / invited_count."),
    c("previous_survey_id", "text", "Prior wave of the same survey, for wave-over-wave comparison. FK to surveys.", "surveys.survey_id")])
table("survey_questions", "One row per survey x question. Grain: question.", [
    c("question_id", "text", "Question key <survey>-Q<nn>."),
    c("survey_id", "text", "Survey. FK to surveys.", "surveys.survey_id"),
    c("question_no", "int", "Order in the questionnaire."),
    c("benefit_area", "text", "Medical, Rx, Dental, Vision, Life, Disability, Leave, Retirement, Wellbeing, Voluntary or Overall."),
    c("question_type", "text", "Importance, Satisfaction, Likert (1-5 agreement) or Open (free text, see survey_comments)."),
    c("question_text", "text", "Question wording.")])
table("survey_respondents", "One row per respondent. Demographics only; never linked to employees. Grain: respondent. Suppress groups below n = 10.", [
    c("respondent_id", "text", "Respondent key <survey>-R<nnnn>."),
    c("survey_id", "text", "Survey answered. FK to surveys.", "surveys.survey_id"),
    c("location_state", "text", "Work state."),
    c("job_level", "text", "Hourly, Salaried, Manager or Executive."),
    c("tenure_band", "text", "<1 yr, 1-4 yrs, 5-9 yrs, 10+ yrs."),
    c("coverage_tier", "text", "EE, EE+SP, EE+CH, FAM or Waived."),
    c("medical_plan_type", "text", "PPO, HDHP/HSA, HMO, EPO or Waived."),
    c("generation", "text", "Gen Z, Millennial, Gen X or Boomer.")])
table("survey_responses", "One row per respondent x scored question. Grain: respondent, question.", [
    c("respondent_id", "text", "Respondent. FK to survey_respondents.", "survey_respondents.respondent_id"),
    c("question_id", "text", "Question. FK to survey_questions.", "survey_questions.question_id"),
    c("score", "int", "Score 1-5 (5 = very important / very satisfied / strongly agree).")],
    pk=["respondent_id", "question_id"])
table("survey_comments", "One row per open-text comment. Grain: comment.", [
    c("comment_id", "text", "Comment key."),
    c("respondent_id", "text", "Respondent. FK to survey_respondents.", "survey_respondents.respondent_id"),
    c("question_id", "text", "Open question answered. FK to survey_questions.", "survey_questions.question_id"),
    c("benefit_area", "text", "Benefit area the comment is about."),
    c("comment_text", "text", "Invented comment text."),
    c("theme", "text", "Coded theme: Cost, Access, Choice, Communication, Service, Network, Coverage or Wellbeing."),
    c("sentiment", "text", "Positive, Neutral or Negative.")])
table("survey_norms", "One row per benefit area x measure x year: market norm (synthetic). Grain: norm.", [
    c("benefit_area", "text", "Benefit area."),
    c("measure", "text", "importance_mean, satisfaction_mean or top2_satisfaction_pct."),
    c("norm_year", "int", "Year of the norm."),
    c("value", "num", "Norm value (means on the 1-5 scale; top-2-box in percent).")],
    pk=["benefit_area", "measure", "norm_year"])

# 06 life, absence & disability
table("lad_programs", "One row per client x plan year x LAD coverage. Grain: program.", [
    c("program_id", "text", "Program key LP-<client>-<plan year>-<coverage code>."),
    c("client_id", "text", "Sponsoring client. FK to clients.", "clients.client_id"),
    c("plan_year", "int", "Plan year 2023-2027."),
    c("coverage", "text", "Basic life, Supplemental life, AD&D, STD, LTD or Leave administration."),
    c("carrier_id", "text", "Insurer or administrator. FK to carriers.", "carriers.carrier_id"),
    c("funding", "text", "Insured or Self-insured ASO."),
    c("benefit_pct", "pct", "Income replacement percent (STD, LTD)."),
    c("max_monthly", "money", "Maximum monthly benefit, USD (STD: weekly maximum x 52 / 12)."),
    c("elimination_days", "int", "Elimination (waiting) period in days."),
    c("own_occ_months", "int", "LTD own-occupation period in months."),
    c("life_multiple", "num", "Life benefit as a multiple of salary."),
    c("guaranteed_issue", "money", "Guaranteed issue amount, USD."),
    c("rate_basis", "text", "Per $1,000 of volume, Per $10 of weekly benefit, % of covered payroll or PEPM."),
    c("rate", "rate", "Monthly rate on rate_basis.")])
table("lad_experience", "One row per program x experience year: premium and claims experience. Grain: program, year. Whole-employer basis.", [
    c("program_id", "text", "Program. FK to lad_programs.", "lad_programs.program_id"),
    c("experience_year", "int", "Plan year the experience covers."),
    c("months_reported", "int", "Months of the plan year reported (2026 is partial)."),
    c("covered_lives", "int", "Covered employees."),
    c("premium", "money", "Premium (or premium equivalent) for the reported months, USD."),
    c("incurred_claims", "money", "Incurred claims for the reported months, USD. Loss ratio = incurred_claims / premium."),
    c("claim_count", "int", "New claims incurred.")],
    pk=["program_id", "experience_year"])
table("disability_claims", "One row per STD or LTD claim, deep-data census employees only. Grain: claim.", [
    c("claim_id", "text", "Claim key DC-<client number>-<n> (DC-044-00381)."),
    c("employee_id", "text", "Claimant. FK to employees.", "employees.employee_id"),
    c("program_id", "text", "STD or LTD program that pays it. FK to lad_programs.", "lad_programs.program_id"),
    c("claim_type", "text", "STD or LTD."),
    c("diagnosis_category", "text", "Musculoskeletal, Maternity, Mental health, Cancer, Cardiovascular, Injury, Digestive, Respiratory or Other."),
    c("incurred_date", "date", "Date disability began."),
    c("approved", "bool", "True when the claim was approved."),
    c("duration_days", "int", "Days of disability; NULL while open or when denied."),
    c("benefit_paid", "money", "Benefits paid to date, USD."),
    c("status", "text", "Open, Closed - RTW (returned to work) or Closed - other."),
    c("rtw_date", "date", "Return-to-work date; NULL unless Closed - RTW.")])
table("leave_cases", "One row per leave case, deep-data census employees only. Grain: case.", [
    c("case_id", "text", "Case key LV-<client number>-<n>."),
    c("employee_id", "text", "Employee on leave. FK to employees.", "employees.employee_id"),
    c("leave_type", "text", "FMLA, State PFML, ADA accommodation or Company."),
    c("work_state", "text", "Employee's work state when the leave started."),
    c("pfml_state", "text", "State paid-leave program that may govern the case: the work state when it has one, else NULL. FK to state_leave_laws.", "state_leave_laws.state"),
    c("reason", "text", "Own health, Bonding or Family care."),
    c("start_date", "date", "First day of leave."),
    c("end_date", "date", "Last day of leave; NULL while open."),
    c("approved", "bool", "True when approved."),
    c("intermittent", "bool", "True for intermittent (not continuous) leave.")])
table("state_leave_laws", "One row per state with a mandatory paid family and medical leave program as of 2026 (13 states plus DC). Values are SIMPLIFIED and approximate; check current law before relying on them. Grain: state program.", [
    c("state", "text", "Two-letter state (DC for the District of Columbia)."),
    c("program_name", "text", "Program name (simplified)."),
    c("effective_date", "date", "Date benefits first became payable (approximate)."),
    c("max_weeks_medical", "int", "Maximum weeks for the worker's own serious health condition (simplified)."),
    c("max_weeks_family", "int", "Maximum weeks for bonding or family care (simplified)."),
    c("max_weeks_combined", "int", "Maximum combined weeks per benefit year (simplified)."),
    c("wage_replacement_pct", "pct", "Headline wage replacement percent (simplified; most programs are progressive)."),
    c("weekly_max", "money", "Approximate maximum weekly benefit, USD (simplified)."),
    c("funding", "text", "Employee, Employer or Shared payroll contributions (simplified).")])
table("client_leave_policies", "One row per client x state x leave reason: what the employer provides. Grain: client, state, reason.", [
    c("client_id", "text", "Client. FK to clients.", "clients.client_id"),
    c("state", "text", "State with a paid-leave law where the client employs people. FK to state_leave_laws.", "state_leave_laws.state"),
    c("reason", "text", "Own health, Bonding or Family care."),
    c("weeks_paid", "int", "Paid weeks the employer policy provides. Compare with state_leave_laws max weeks (medical for Own health, family otherwise)."),
    c("pay_pct", "pct", "Percent of pay the policy replaces."),
    c("integrates_with_state", "text", "Offset (state benefit reduces the company benefit) or Top-up (company tops up the state benefit).")],
    pk=["client_id", "state", "reason"])

# 07 strategy
table("client_goals", "One row per client x goal. Grain: client, goal.", [
    c("client_id", "text", "Client. FK to clients.", "clients.client_id"),
    c("goal", "text", "Control cost, Affordability for low earners, Attract & retain, Simplify or Health outcomes."),
    c("rank", "int", "1 = most important."),
    c("set_year", "int", "Year the goal was set.")],
    pk=["client_id", "goal"])
table("trend_assumptions", "One row per projection year x line: the trend behind a do-nothing projection. Grain: year, line.", [
    c("projection_year", "int", "Year the trend applies to (2023-2032)."),
    c("line_of_coverage", "text", "Medical, Rx or Dental."),
    c("trend_pct", "pct", "Annual cost trend percent."),
    c("basis", "text", "Actual (observed) or Projected."),
    c("source_id", "text", "Benchmark source cited. FK to benchmark_sources.", "benchmark_sources.source_id")],
    pk=["projection_year", "line_of_coverage"])
table("strategy_options", "One row per modeled strategy option. Grain: option.", [
    c("option_id", "text", "Option key SO-<client number>-<nn> (SO-017-03)."),
    c("client_id", "text", "Client. FK to clients.", "clients.client_id"),
    c("lever", "text", "Plan design, Contribution, PBM carve-out, GLP-1 policy, Centres of excellence, Narrow network, Point solution or Navigation."),
    c("description", "text", "The option as modeled, e.g. Contribution shift (+5 pts EE share)."),
    c("est_savings_annual", "money", "Estimated annual savings, USD."),
    c("employee_impact", "text", "Low, Medium or High disruption to employees."),
    c("risk", "text", "Low, Medium or High delivery risk."),
    c("effective_year", "int", "Plan year the option takes effect."),
    c("status", "text", "Proposed, Adopted or Rejected."),
    c("goal", "text", "Client goal the option serves (see client_goals).")])
table("roadmap_items", "One row per adopted option x milestone. Grain: roadmap item.", [
    c("item_id", "text", "Item key <option>-M<n>."),
    c("option_id", "text", "Adopted option. FK to strategy_options.", "strategy_options.option_id"),
    c("year", "int", "Milestone year."),
    c("quarter", "int", "Milestone quarter 1-4."),
    c("milestone", "text", "Milestone description."),
    c("owner_colleague_id", "text", "Mercer owner. FK to colleagues.", "colleagues.colleague_id"),
    c("status", "text", "Done, In progress or Planned (as of 2026-10-31).")])
table("point_solutions", "One row per point-solution vendor product (invented vendors). Grain: solution.", [
    c("solution_id", "text", "Solution key (PS-01)."),
    c("vendor", "text", "Invented vendor name."),
    c("solution_name", "text", "Product name."),
    c("category", "text", "Diabetes, MSK, Fertility, Mental health, Navigation or Virtual primary care."),
    c("pricing", "text", "PEPM or Per engaged member."),
    c("list_fee", "money", "List fee, USD: per employee per month, or per engaged member per month.")])
table("client_point_solutions", "One row per client x contracted solution. Grain: client, solution.", [
    c("client_id", "text", "Client. FK to clients.", "clients.client_id"),
    c("solution_id", "text", "Solution. FK to point_solutions.", "point_solutions.solution_id"),
    c("start_date", "date", "Contract start."),
    c("engagement_rate_pct", "pct", "Percent of eligible members engaged."),
    c("fee_pepm", "money", "Effective fee per employee per month, USD.")],
    pk=["client_id", "solution_id"])

# 08 data operations
table("data_feeds", "One row per deep-data client x feed. Grain: feed. Status as of 2026-10-31.", [
    c("feed_id", "text", "Feed key FD-<client>-<type code>."),
    c("client_id", "text", "Client. FK to clients.", "clients.client_id"),
    c("carrier_id", "text", "Sending vendor. FK to carriers.", "carriers.carrier_id"),
    c("feed_type", "text", "Eligibility, Medical claims, Rx claims, Disability or Leave."),
    c("cadence", "text", "Monthly or Weekly."),
    c("last_received", "date", "Date the last file arrived."),
    c("covers_through", "date", "Last service/activity date the received files cover. Data after it is incomplete."),
    c("expected_by", "date", "Date the next (overdue or upcoming) file is due."),
    c("days_late", "int", "Days the next file is overdue as of 2026-10-31 (0 when on time)."),
    c("status", "text", "On time, Late or Failed.")])

TNAME = [t["name"] for t in TABLES]
COLS = {t["name"]: [col[0] for col in t["cols"]] for t in TABLES}
TYPES = {t["name"]: [col[1] for col in t["cols"]] for t in TABLES}
COLIDX = {t["name"]: {col[0]: i for i, col in enumerate(t["cols"])} for t in TABLES}
assert len(TABLES) == 41, len(TABLES)

VIEWS = [
    ("v_monthly_cost",
     "One row per client x medical plan x month (Jan 2023 - Sep 2026), deep-data clients. Members and employees count "
     "enrollments active on the 15th; paid amounts come from claims by service/fill month. The cost measures every agent uses.",
     [("client_id", "Client."), ("plan_id", "Medical plan."), ("month_start", "First day of the month."),
      ("members", "Covered members (sum of enrollments.covered_members) active on the 15th."),
      ("employees", "Enrolled employees active on the 15th."),
      ("medical_paid", "Medical plan_paid by service month, USD."), ("rx_paid", "Rx plan_paid by fill month, USD."),
      ("pmpm", "(medical_paid + rx_paid) / members: cost per member per month, USD."),
      ("pepm", "(medical_paid + rx_paid) / employees: cost per employee per month, USD. x 12 = PEPY.")],
     """WITH months AS (
  SELECT gs::date AS month_start
  FROM generate_series(DATE '2023-01-01', DATE '2026-09-01', INTERVAL '1 month') AS gs
), exposure AS (
  SELECT p.client_id, e.plan_id, m.month_start,
         count(*)::integer AS employees,
         sum(e.covered_members)::integer AS members
  FROM us_health.enrollments e
  JOIN us_health.plans p ON p.plan_id = e.plan_id
  JOIN months m ON e.start_date <= m.month_start + 14 AND e.end_date >= m.month_start + 14
  GROUP BY p.client_id, e.plan_id, m.month_start
), med AS (
  SELECT plan_id, date_trunc('month', service_date)::date AS month_start, sum(plan_paid) AS medical_paid
  FROM us_health.medical_claims
  GROUP BY plan_id, date_trunc('month', service_date)::date
), rx AS (
  SELECT plan_id, date_trunc('month', fill_date)::date AS month_start, sum(plan_paid) AS rx_paid
  FROM us_health.rx_claims
  GROUP BY plan_id, date_trunc('month', fill_date)::date
)
SELECT x.client_id, x.plan_id, x.month_start, x.members, x.employees,
       COALESCE(med.medical_paid, 0)::numeric(14,2) AS medical_paid,
       COALESCE(rx.rx_paid, 0)::numeric(14,2) AS rx_paid,
       round((COALESCE(med.medical_paid, 0) + COALESCE(rx.rx_paid, 0)) / NULLIF(x.members, 0), 2) AS pmpm,
       round((COALESCE(med.medical_paid, 0) + COALESCE(rx.rx_paid, 0)) / NULLIF(x.employees, 0), 2) AS pepm
FROM exposure x
LEFT JOIN med ON med.plan_id = x.plan_id AND med.month_start = x.month_start
LEFT JOIN rx ON rx.plan_id = x.plan_id AND rx.month_start = x.month_start"""),
    ("v_large_claimants",
     "One row per member x plan year whose medical + Rx plan_paid exceeds $250,000, with the stop-loss specific deductible.",
     [("member_id", "Member."), ("client_id", "Client."), ("plan_year", "Plan year of the paying plans."),
      ("relationship", "Employee, Spouse or Child."), ("birth_year", "Member birth year."),
      ("medical_paid", "Medical plan_paid in the plan year, USD."), ("rx_paid", "Rx plan_paid in the plan year, USD."),
      ("total_paid", "Medical + Rx plan_paid, USD."),
      ("specific_deductible", "Stop-loss specific deductible for the client and plan year; NULL when fully insured."),
      ("exceeds_specific", "True when total_paid exceeds the specific deductible."),
      ("excess_over_specific", "total_paid above the specific deductible (stop-loss reimbursable), USD.")],
     """WITH paid AS (
  SELECT member_id, plan_id, plan_paid AS medical_paid, 0::numeric AS rx_paid FROM us_health.medical_claims
  UNION ALL
  SELECT member_id, plan_id, 0::numeric, plan_paid FROM us_health.rx_claims
), by_member AS (
  SELECT pa.member_id, p.client_id, p.plan_year,
         sum(pa.medical_paid) AS medical_paid, sum(pa.rx_paid) AS rx_paid,
         sum(pa.medical_paid + pa.rx_paid) AS total_paid
  FROM paid pa
  JOIN us_health.plans p ON p.plan_id = pa.plan_id
  GROUP BY pa.member_id, p.client_id, p.plan_year
)
SELECT b.member_id, b.client_id, b.plan_year, m.relationship, m.birth_year,
       b.medical_paid::numeric(14,2) AS medical_paid, b.rx_paid::numeric(14,2) AS rx_paid,
       b.total_paid::numeric(14,2) AS total_paid,
       s.specific_deductible,
       COALESCE(b.total_paid > s.specific_deductible, false) AS exceeds_specific,
       GREATEST(b.total_paid - COALESCE(s.specific_deductible, b.total_paid), 0)::numeric(14,2) AS excess_over_specific
FROM by_member b
JOIN us_health.members m ON m.member_id = b.member_id
LEFT JOIN us_health.stop_loss_contracts s ON s.client_id = b.client_id AND s.plan_year = b.plan_year
WHERE b.total_paid > 250000"""),
    ("v_lad_loss_ratio",
     "One row per LAD program x experience year: loss ratio and incidence.",
     [("program_id", "Program."), ("client_id", "Client."), ("coverage", "LAD coverage."),
      ("experience_year", "Experience year."), ("months_reported", "Months reported."),
      ("covered_lives", "Covered employees."), ("premium", "Premium, USD."), ("incurred_claims", "Incurred claims, USD."),
      ("claim_count", "New claims."), ("loss_ratio_pct", "incurred_claims / premium x 100."),
      ("incidence_per_1000", "claim_count per 1,000 covered lives, annualised by months_reported.")],
     """SELECT x.program_id, lp.client_id, lp.coverage, x.experience_year, x.months_reported,
       x.covered_lives, x.premium, x.incurred_claims, x.claim_count,
       round(100 * x.incurred_claims / NULLIF(x.premium, 0), 2) AS loss_ratio_pct,
       round(1000.0 * x.claim_count * 12 / NULLIF(x.covered_lives * x.months_reported, 0), 2) AS incidence_per_1000
FROM us_health.lad_experience x
JOIN us_health.lad_programs lp ON lp.program_id = x.program_id"""),
    ("v_client_revenue",
     "One row per client x service line x calendar year: Mercer revenue. 2026 covers Jan-Oct only.",
     [("client_id", "Client."), ("service_line_id", "Service line."), ("revenue_year", "Calendar year."),
      ("months_reported", "Months with revenue rows."),
      ("commission", "Commission plus supplemental compensation, USD."), ("fees", "Fees, USD."),
      ("total", "commission + fees, USD."),
      ("yoy_growth_pct", "Percent change of total versus the prior year for the same client and service line.")],
     """WITH y AS (
  SELECT e.client_id, e.service_line_id, extract(year FROM r.period_month)::integer AS revenue_year,
         count(DISTINCT r.period_month)::integer AS months_reported,
         COALESCE(sum(r.amount_usd) FILTER (WHERE r.revenue_type IN ('Commission', 'Supplemental comp')), 0) AS commission,
         COALESCE(sum(r.amount_usd) FILTER (WHERE r.revenue_type = 'Fee'), 0) AS fees,
         sum(r.amount_usd) AS total
  FROM us_health.revenue r
  JOIN us_health.engagements e ON e.engagement_id = r.engagement_id
  GROUP BY e.client_id, e.service_line_id, extract(year FROM r.period_month)::integer
)
SELECT client_id, service_line_id, revenue_year, months_reported,
       commission::numeric(14,2) AS commission, fees::numeric(14,2) AS fees, total::numeric(14,2) AS total,
       round(100 * (total / NULLIF(lag(total) OVER (PARTITION BY client_id, service_line_id ORDER BY revenue_year), 0) - 1), 2)
         AS yoy_growth_pct
FROM y"""),
]
REQUIRED = TNAME + [v[0] for v in VIEWS]

RESERVED = {"all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric", "both", "case", "cast",
            "check", "collate", "column", "constraint", "create", "default", "deferrable", "desc", "distinct", "do",
            "else", "end", "except", "false", "fetch", "for", "foreign", "from", "grant", "group", "having", "in",
            "initially", "intersect", "into", "lateral", "leading", "limit", "not", "null", "offset", "on", "only",
            "or", "order", "placing", "primary", "references", "returning", "select", "some", "symmetric", "table",
            "then", "to", "trailing", "true", "union", "unique", "user", "using", "variadic", "when", "where",
            "window", "with", "join", "left", "right", "full", "inner", "outer", "natural", "cross", "is", "like",
            "between", "overlaps", "similar", "verbose", "freeze", "binary", "ilike", "isnull", "notnull"}
for _t in TABLES:
    for _cn in COLS[_t["name"]]:
        assert _cn not in RESERVED, _cn


# ------------------------------------------------------------ reference data -
REGION = {}
for _r, _ss in [("Northeast", "NY NJ PA MA CT RI ME NH VT"), ("Midwest", "OH IL MI WI MN MO IN KS IA NE"),
                ("South", "TX FL GA NC VA TN MD DC DE KY AL LA SC OK AR"), ("West", "CA WA OR CO AZ NV UT NM")]:
    for _s in _ss.split():
        REGION[_s] = _r
STATE_COST = {"Northeast": 1.08, "West": 1.05, "Midwest": 0.97, "South": 0.95}
INDUSTRIES = ["Healthcare", "Manufacturing", "Transportation", "Retail", "Financial Services", "Technology",
              "Public sector"]
INDUSTRY_COST = {"Healthcare": 1.03, "Manufacturing": 0.98, "Transportation": 0.99, "Retail": 0.92,
                 "Financial Services": 1.05, "Technology": 1.04, "Public sector": 1.09}

OFFICES = [("OF-NYC", "New York", "NY"), ("OF-BOS", "Boston", "MA"), ("OF-PHL", "Philadelphia", "PA"),
           ("OF-WAS", "Washington", "DC"), ("OF-ATL", "Atlanta", "GA"), ("OF-CLT", "Charlotte", "NC"),
           ("OF-RIC", "Richmond", "VA"), ("OF-MIA", "Miami", "FL"), ("OF-CHI", "Chicago", "IL"),
           ("OF-DET", "Detroit", "MI"), ("OF-CLE", "Cleveland", "OH"), ("OF-MSP", "Minneapolis", "MN"),
           ("OF-STL", "St. Louis", "MO"), ("OF-MKE", "Milwaukee", "WI"), ("OF-LOU", "Louisville", "KY"),
           ("OF-DAL", "Dallas", "TX"), ("OF-HOU", "Houston", "TX"), ("OF-DEN", "Denver", "CO"),
           ("OF-PHX", "Phoenix", "AZ"), ("OF-LAX", "Los Angeles", "CA"), ("OF-SFO", "San Francisco", "CA"),
           ("OF-SEA", "Seattle", "WA")]

SERVICE_LINES = [
    ("SL-STRAT", "Strategy & Consulting", "Consulting", "Benefits strategy, renewals, carrier negotiation and placement."),
    ("SL-ACT", "Actuarial", "Consulting", "Cost projections, IBNP reserves, premium equivalents, plan modeling."),
    ("SL-RX", "Pharmacy (MercerRx)", "Specialty", "PBM strategy, RFPs, claims audits and market checks."),
    ("SL-LAD", "Life, Absence & Disability", "Specialty", "Life, AD&D, STD, LTD and leave program design and placement."),
    ("SL-COMP", "Compliance", "Specialty", "ACA, ERISA, state mandate and filing support."),
    ("SL-VOL", "Voluntary Benefits", "Specialty", "Voluntary and worksite benefit placement."),
    ("SL-WELL", "Wellbeing", "Specialty", "Wellbeing strategy and point-solution selection."),
    ("SL-DATA", "Data & Technology", "Specialty", "Claims data warehousing, dashboards and analytics tools."),
    ("SL-RB", "Research & Benchmarking", "Research", "Custom benchmarking against the National Survey."),
    ("SL-GBM", "Global Benefits", "Consulting", "Benefits for US multinationals' employees outside the US."),
    ("SL-SPEC", "Specialty", "Specialty", "Centres of excellence, fertility, navigation and other specialty programs.")]

CARRIERS = [  # (id, name, type)
    ("CR-01", "Pinewick Health Plan", "Medical carrier"), ("CR-02", "Crestmoor Health Partners", "Medical carrier"),
    ("CR-03", "Bluehaven Health", "Medical carrier"), ("CR-04", "Riverstone Health Plan", "Medical carrier"),
    ("CR-05", "Northstar Health Alliance", "Medical carrier"), ("CR-06", "Harrowgate Health Plan", "Medical carrier"),
    ("CR-07", "Tri-River Health Plan", "Medical carrier"), ("CR-08", "Prairieland Health", "Medical carrier"),
    ("CR-09", "Ardent Benefit Administrators", "TPA"), ("CR-10", "Clearpath Claims Services", "TPA"),
    ("CR-11", "Ledgerline TPA", "TPA"),
    ("CR-12", "Corvid Rx", "PBM"), ("CR-13", "Apothecary Benefits Group", "PBM"),
    ("CR-14", "Lumenscript Pharmacy Solutions", "PBM"), ("CR-15", "Tallow Rx Transparent", "PBM"),
    ("CR-16", "Bulwark Re Stop-Loss", "Stop-loss"), ("CR-17", "Anchorpoint Specialty", "Stop-loss"),
    ("CR-18", "Granitebay Excess", "Stop-loss"),
    ("CR-19", "Kestwick Life", "LAD carrier"), ("CR-20", "Harborline Life & Disability", "LAD carrier"),
    ("CR-21", "Prairie Mutual Life", "LAD carrier"), ("CR-22", "Evergold Life", "LAD carrier"),
    ("CR-23", "Bastion Disability Insurance", "LAD carrier"),
    ("CR-24", "Leaveline Administrators", "Leave administrator"), ("CR-25", "Tidewell Absence Services", "Leave administrator"),
    ("CR-26", "Dentara Dental", "Dental & vision carrier"), ("CR-27", "Smileguard Dental Mutual", "Dental & vision carrier"),
    ("CR-28", "Iris Vision Plan", "Dental & vision carrier"), ("CR-29", "Visionary Eye Plans", "Dental & vision carrier"),
    ("CR-30", "Benefitwise Administration", "Ben admin vendor"), ("CR-31", "Enrollio", "Ben admin vendor"),
    ("CR-32", "Coastal Bay Health", "Medical carrier"), ("CR-33", "Cascade Peak Health", "Medical carrier"),
    ("CR-34", "Ironbark Stop-Loss", "Stop-loss")]
CARRIERS_BY_TYPE = {}
for _cid, _n, _t in CARRIERS:
    CARRIERS_BY_TYPE.setdefault(_t, []).append(_cid)

# client number -> (name, industry, segment, hq_state, employee_count)
FIXED_CLIENTS = {
    5: ("Lindqvist Mutual Financial", "Financial Services", "Large", "MN", 6400),
    12: ("Fairhaven Market Stores", "Retail", "Large", "IL", 9800),
    17: ("Northgate Regional Health System", "Healthcare", "Large", "OH", 14200),
    23: ("Brightwater Logistics", "Transportation", "Mid-size", "TX", 2850),
    29: ("Kestrel Ridge Software", "Technology", "Mid-size", "CA", 3600),
    31: ("State of Cascadia Employees", "Public sector", "Public sector", "WA", 38000),
    38: ("Corliss Aerostructures", "Manufacturing", "Large", "KS", 5600),
    44: ("Halvorsen Precision Manufacturing", "Manufacturing", "Mid-size", "WI", 1240),
    51: ("Marlowe Street Capital", "Financial Services", "Mid-size", "NY", 2100),
}
# deep-data census: sample size, work-state mix, GLP-1 weight-loss coverage, funding, medical plan types
DEEP = {
    "C005": dict(n=900, states=[("MN", 70), ("WI", 15), ("IA", 10), ("IL", 5)], glp1=False, funding="Self-funded",
                 types=["PPO", "HDHP/HSA", "HMO"]),
    "C012": dict(n=1500, states=[("IL", 30), ("WA", 15), ("NY", 15), ("TX", 15), ("OH", 10), ("PA", 10), ("IN", 5)],
                 glp1=True, funding="Self-funded", types=["PPO", "HDHP/HSA", "HMO"]),
    "C017": dict(n=1900, states=[("OH", 85), ("PA", 8), ("MI", 7)], glp1=True, funding="Self-funded",
                 types=["PPO", "HDHP/HSA", "EPO"]),
    "C023": dict(n=850, states=[("TX", 65), ("LA", 15), ("OK", 10), ("NM", 10)], glp1=False, funding="Level-funded",
                 types=["PPO", "HDHP/HSA"]),
    "C029": dict(n=900, states=[("CA", 60), ("WA", 20), ("OR", 10), ("CO", 10)], glp1=True, funding="Self-funded",
                 types=["PPO", "HDHP/HSA", "EPO"]),
    "C038": dict(n=1000, states=[("KS", 70), ("MO", 20), ("OK", 10)], glp1=False, funding="Self-funded",
                 types=["PPO", "HDHP/HSA"]),
    "C044": dict(n=500, states=[("WI", 85), ("IL", 10), ("MN", 5)], glp1=False, funding="Self-funded",
                 types=["PPO", "HDHP/HSA"]),
    "C051": dict(n=550, states=[("NY", 60), ("NJ", 25), ("CT", 15)], glp1=True, funding="Self-funded",
                 types=["PPO", "HDHP/HSA"]),
}
LATE_FEED_CLIENT = "C038"
LEAVE_GAP_CLIENT = "C012"
PUBLIC_CLIENTS = [("City of Larkhaven", "OR", 9200), ("Tamarack County Government", "MN", 6100),
                  ("Ridgemont Unified School District", "CA", 11800), ("Port Alder Regional Transit", "WA", 3400),
                  ("Kellerton State University", "MI", 15600)]
NAME_PREFIX = ["Aldermoor", "Bramblewood", "Castellan", "Dovecote", "Emberly", "Farrowdale", "Gilmartin", "Hollins",
               "Jessamine", "Kinross", "Lockridge", "Merriweather", "Nettlefield", "Oakhurst", "Penrose",
               "Quillfeather", "Rosemont", "Saltmarsh", "Thornbury", "Upham", "Verity", "Whitlock", "Yarrowby",
               "Ashcombe", "Bellmere", "Coldbrook", "Delmont", "Eastmarch", "Fenwick", "Glenrock", "Hartwell",
               "Ivybridge", "Kettering", "Linden Vale", "Norcross", "Pellham", "Quenby", "Redfern", "Sablewood",
               "Ulverton", "Vellamy", "Wrenfield"]
NAME_SUFFIX = {"Healthcare": ["Health System", "Medical Center", "Health Partners", "Community Hospitals"],
               "Manufacturing": ["Industries", "Components", "Fabrication", "Machine Works", "Polymers"],
               "Transportation": ["Freight", "Transit Lines", "Airways", "Rail Services", "Distribution"],
               "Retail": ["Market", "Outfitters", "Stores", "Home Goods", "Grocers"],
               "Financial Services": ["Mutual", "Capital", "Bancorp", "Insurance Group", "Credit Partners"],
               "Technology": ["Software", "Systems", "Networks", "Labs", "Data"]}
HQ_STATES = ["NY", "NJ", "PA", "MA", "CT", "OH", "IL", "MI", "WI", "MN", "MO", "IN", "TX", "FL", "GA", "NC", "VA",
             "TN", "MD", "CA", "WA", "OR", "CO", "AZ"]

PFML = [  # state, program, effective, weeks medical, weeks family, combined, replacement %, weekly max, funding
    ("CA", "California SDI / Paid Family Leave", date(2004, 7, 1), 52, 8, 52, 70, 1681, "Employee"),
    ("CO", "Colorado FAMLI", date(2024, 1, 1), 12, 12, 12, 90, 1324, "Shared"),
    ("CT", "Connecticut Paid Leave", date(2022, 1, 1), 12, 12, 12, 95, 981, "Employee"),
    ("DC", "DC Paid Family Leave", date(2020, 7, 1), 12, 12, 12, 90, 1130, "Employer"),
    ("DE", "Delaware Paid Leave", date(2026, 1, 1), 12, 6, 12, 80, 900, "Shared"),
    ("MA", "Massachusetts PFML", date(2021, 1, 1), 20, 12, 26, 80, 1171, "Shared"),
    ("MD", "Maryland FAMLI", date(2028, 1, 1), 12, 12, 12, 90, 1000, "Shared"),
    ("ME", "Maine Paid Family and Medical Leave", date(2026, 5, 1), 12, 12, 12, 90, 1100, "Shared"),
    ("MN", "Minnesota Paid Leave", date(2026, 1, 1), 12, 12, 20, 90, 1423, "Shared"),
    ("NJ", "New Jersey TDI / Family Leave Insurance", date(2009, 7, 1), 26, 12, 26, 85, 1081, "Shared"),
    ("NY", "New York Paid Family Leave / DBL", date(2018, 1, 1), 26, 12, 26, 67, 1177, "Employee"),
    ("OR", "Paid Leave Oregon", date(2023, 9, 3), 12, 12, 12, 100, 1568, "Shared"),
    ("RI", "Rhode Island TDI / TCI", date(2014, 1, 1), 30, 8, 30, 60, 1104, "Employee"),
    ("WA", "Washington Paid Family and Medical Leave", date(2020, 1, 1), 12, 12, 16, 90, 1542, "Shared"),
]
PFML_BY_STATE = {p[0]: p for p in PFML}

FIRST = ["Ana", "Ben", "Carla", "Deepak", "Elena", "Femi", "Grace", "Hiro", "Isabel", "Jamal", "Kara", "Luis", "Mei",
         "Noah", "Olga", "Priya", "Quinn", "Rosa", "Sam", "Tariq", "Uma", "Victor", "Wen", "Yara", "Zoe", "Aaron",
         "Bianca", "Colin", "Dana", "Ethan", "Fiona", "Gabe", "Hana", "Ivan", "Jodie", "Kofi"]
LAST = ["Abernathy", "Bellweather", "Castell", "Dunleavy", "Ellison", "Farraday", "Gutierrez", "Halloran", "Iverson",
        "Jaramillo", "Kowalczyk", "Lindgren", "Mbeki", "Nakashima", "Oyelaran", "Pradhan", "Quintero", "Rasmussen",
        "Sorensen", "Thibodeaux", "Underhill", "Valdivia", "Whitcombe", "Yamada", "Zielinski", "Ashworth",
        "Brennan", "Okonkwo", "Marchetti", "Delacroix"]

YEARS_CLAIMS = [2023, 2024, 2025, 2026]
# Market trend index for total cost per employee (signal 1): +5.0%, +6.0%, +6.75%.
TOTAL_IDX = {2023: 1.0, 2024: 1.05, 2025: 1.05 * 1.06, 2026: 1.05 * 1.06 * 1.0675}
# Rx index: GLP-1 weight-loss coverage adds 5 points of Rx trend each year (signal 2).
RX_IDX = {True: {2023: 1.0, 2024: 1.105, 2025: 1.105 * 1.11, 2026: 1.105 * 1.11 * 1.11},
          False: {2023: 1.0, 2024: 1.055, 2025: 1.055 * 1.06, 2026: 1.055 * 1.06 * 1.06}}
RX_SHARE_2023 = 0.22
MED_RENEWAL = {2023: 5.2, 2024: 5.0, 2025: 6.0, 2026: 6.7, 2027: 8.2}
NICU = {"client": "C023", "birth": date(2025, 3, 4),
        "paid": [612450.00, 498320.00, 455180.00, 341900.00, 192150.00]}  # sums to 2,100,000.00


def employee_months(start, end, year):
    """Months of `year` (through CLAIMS_END) whose 15th falls inside [start, end]. The exposure basis
    the claims are calibrated against and the v_monthly_cost view uses."""
    n = 0
    for m in range(1, 13):
        d = date(year, m, 15)
        if d > CLAIMS_END:
            break
        if start <= d <= end:
            n += 1
    return n


def cnum(client_id):
    return client_id[1:]


# ------------------------------------------------------------------- build -
class _Gen:
    def __init__(self):
        self.rng = random.Random(SEED)
        self.rows = {n: [] for n in TNAME}

    def add(self, tbl, **kw):
        idx = COLIDX[tbl]
        row = [None] * len(idx)
        for k, v in kw.items():
            row[idx[k]] = v
        self.rows[tbl].append(row)
        return row

    # helpers
    def chance(self, p):
        return self.rng.random() < p

    def rdate(self, a, b):
        return a + timedelta(days=self.rng.randint(0, max(0, (b - a).days)))

    def wpick(self, pairs):
        tot = sum(w for _, w in pairs)
        x = self.rng.random() * tot
        for v, w in pairs:
            x -= w
            if x < 0:
                return v
        return pairs[-1][0]

    def poisson(self, lam):
        if lam <= 0:
            return 0
        if lam > 30:
            return max(0, int(self.rng.gauss(lam, math.sqrt(lam)) + 0.5))
        lim = math.exp(-lam)
        k, p = 0, self.rng.random()
        while p > lim:
            k += 1
            p *= self.rng.random()
        return k

    def person(self, used):
        while True:
            n = f"{self.rng.choice(FIRST)} {self.rng.choice(LAST)}"
            if n not in used:
                used.add(n)
                return n


def build():
    """Build every table's rows in memory. Returns {table: [row lists in COLS order]}."""
    g = _Gen()
    rng = g.rng
    _firm_and_clients(g)
    _programs(g)
    _lad_programs(g)
    _census(g)
    _claims(g)
    _disability_and_leave(g)
    _benchmarks(g)
    _surveys(g)
    _strategy(g)
    _feeds(g)
    _revenue(g)
    del rng
    return g.rows


# ------------------------------------------------------- 01 firm & clients -
def _firm_and_clients(g):
    rng = g.rng
    for oid, city, st in OFFICES:
        g.add("offices", office_id=oid, city=city, state=st, region=REGION[st])
    for sid, name, cat, desc in SERVICE_LINES:
        g.add("service_lines", service_line_id=sid, name=name, category=cat, description=desc)
    used = set()
    sl_weights = [("SL-STRAT", 40), ("SL-ACT", 16), ("SL-RX", 10), ("SL-LAD", 8), ("SL-COMP", 5), ("SL-VOL", 4),
                  ("SL-WELL", 4), ("SL-DATA", 6), ("SL-RB", 3), ("SL-GBM", 2), ("SL-SPEC", 2)]
    g.colleagues = []
    for i in range(1, 181):
        sl = g.wpick(sl_weights)
        if sl == "SL-ACT":
            role = g.wpick([("Health Actuary", 60), ("Analyst", 20), ("Principal", 20)])
        elif sl == "SL-LAD":
            role = g.wpick([("LAD Consultant", 60), ("Senior Consultant", 25), ("Principal", 15)])
        else:
            role = g.wpick([("Analyst", 22), ("Associate", 22), ("Consultant", 25), ("Senior Consultant", 18),
                            ("Principal", 13)])
        off = rng.choice(OFFICES)[0]
        cid = f"CL-{i:04d}"
        g.add("colleagues", colleague_id=cid, full_name=g.person(used), role=role, office_id=off,
              service_line_id=sl, start_year=rng.randint(1996, 2025))
        g.colleagues.append({"id": cid, "sl": sl, "office": off, "role": role})

    # clients
    g.clients = []
    names = set()
    public = list(PUBLIC_CLIENTS)
    public_slots = [8, 19, 34, 46, 57]
    for num in range(1, 61):
        if num in FIXED_CLIENTS:
            name, ind, seg, hq, cnt = FIXED_CLIENTS[num]
        elif num in public_slots:
            name, hq, cnt = public.pop(0)
            ind, seg = "Public sector", "Public sector"
        else:
            ind = INDUSTRIES[rng.randrange(6)]
            while True:
                name = f"{rng.choice(NAME_PREFIX)} {rng.choice(NAME_SUFFIX[ind])}"
                if name not in names:
                    break
            seg = g.wpick([("Mid-size", 45), ("Large", 40), ("Jumbo", 15)])
            cnt = {"Mid-size": rng.randint(5, 49) * 100 + rng.randint(0, 99),
                   "Large": rng.randint(50, 199) * 100 + rng.randint(0, 99),
                   "Jumbo": rng.randint(200, 620) * 100 + rng.randint(0, 99)}[seg]
            hq = rng.choice(HQ_STATES)
        names.add(name)
        cid = f"C{num:03d}"
        reg = REGION[hq]
        same = [o[0] for o in OFFICES if o[2] == hq]
        offs = same or [o[0] for o in OFFICES if REGION[o[2]] == reg]
        union = g.chance({"Public sector": 0.85, "Transportation": 0.55, "Manufacturing": 0.45,
                          "Healthcare": 0.25}.get(ind, 0.05))
        deep = cid in DEEP
        rm = 7 if seg == "Public sector" else 1
        since = rng.randint(1996, 2016) if deep else rng.randint(1998, 2022)
        g.add("clients", client_id=cid, name=name, industry=ind, segment=seg, hq_state=hq, region=reg,
              employee_count=cnt, union_flag=union, renewal_month=rm, office_id=rng.choice(offs),
              client_since=since, deep_data=deep)
        # extra operating states (for leave policies)
        if deep:
            states = [s for s, _ in DEEP[cid]["states"]]
        else:
            states = [hq] + [s for s in rng.sample(HQ_STATES, rng.randint(1, 3)) if s != hq]
            if not any(s in PFML_BY_STATE for s in states):
                states.append(rng.choice(["CA", "NY", "NJ", "MA", "WA", "CO", "OR", "CT"]))
        g.clients.append({"id": cid, "num": num, "name": name, "industry": ind, "segment": seg, "hq": hq,
                          "region": reg, "count": cnt, "rm": rm, "deep": deep, "since": since, "states": states,
                          "years": [2023, 2024, 2025, 2026] + ([2027] if rm == 1 else []),
                          "base_pepy": 15797 * STATE_COST[reg] * INDUSTRY_COST[ind] * rng.uniform(0.93, 1.07)})
    g.client_by_id = {c["id"]: c for c in g.clients}


# ------------------------------------------------------ 02 benefit programs -
def _programs(g):
    rng = g.rng
    for cid_, name_, typ_ in CARRIERS:
        g.add("carriers", carrier_id=cid_, name=name_, carrier_type=typ_)
    med_types_by_seg = {"Mid-size": ["PPO", "HDHP/HSA"], "Large": ["PPO", "HDHP/HSA", "HMO"],
                        "Jumbo": ["PPO", "HDHP/HSA", "HMO", "EPO"], "Public sector": ["PPO", "HMO", "HDHP/HSA"]}
    g.plans = {}           # plan_id -> meta
    g.client_plans = {}    # (client, year) -> [plan meta of medical plans]
    g.funding = {}         # (client, year) -> medical funding
    for cl in g.clients:
        cid, seg, years = cl["id"], cl["segment"], cl["years"]
        if cl["deep"]:
            funding0 = DEEP[cid]["funding"]
            types = DEEP[cid]["types"]
        else:
            funding0 = {"Mid-size": g.wpick([("Self-funded", 50), ("Level-funded", 20), ("Fully insured", 30)]),
                        "Large": g.wpick([("Self-funded", 90), ("Fully insured", 10)]),
                        "Jumbo": "Self-funded",
                        "Public sector": g.wpick([("Self-funded", 70), ("Fully insured", 30)])}[seg]
            types = med_types_by_seg[seg]
        switch_year = None
        if not cl["deep"] and funding0 == "Fully insured" and g.chance(0.35):
            switch_year = rng.choice([2024, 2025, 2026])
        # GLP-1 weight-loss coverage by year
        if cl["deep"]:
            glp = {y: ("Yes" if DEEP[cid]["glp1"] else "No") for y in years}
            if cid == "C017":
                glp[2027] = "With criteria"
        else:
            start = rng.choice([2021, 2023, 2024, 2025, 9999, 9999]) if seg != "Jumbo" else rng.choice([2021, 2023, 9999])
            glp = {y: ("Yes" if y >= start else "No") for y in years}
            if 2027 in glp and glp[2027] == "Yes" and g.chance(0.25):
                glp[2027] = "With criteria" if g.chance(0.7) else "No"
        cl["glp"] = glp
        # carriers per line over time
        def med_carrier(funding):
            if funding == "Self-funded" and g.chance(0.2):
                return rng.choice(CARRIERS_BY_TYPE["TPA"])
            return rng.choice(CARRIERS_BY_TYPE["Medical carrier"])
        carrier = {"Medical": med_carrier(funding0), "Dental": rng.choice(CARRIERS_BY_TYPE["Dental & vision carrier"][:2]),
                   "Vision": rng.choice(CARRIERS_BY_TYPE["Dental & vision carrier"][2:])}
        pbm = rng.choice(CARRIERS_BY_TYPE["PBM"])
        carve = (not cl["deep"]) and funding0 == "Self-funded" and seg in ("Large", "Jumbo") and g.chance(0.3)
        ppo_ded = rng.choice([500, 750, 1000, 1000, 1250, 1500])
        hdhp_ded = rng.choice([1650, 2000, 2500, 2500, 3000, 3300])
        contrib_f = rng.uniform(0.75, 1.25)
        rate_f = cl["base_pepy"] / 15797 * rng.uniform(0.95, 1.05)
        dental_n = 2 if seg in ("Large", "Jumbo", "Public sector") and g.chance(0.6) else 1
        prev_carrier = dict(carrier)
        funding = funding0
        for y in years:
            # renewal decisions for the year
            if switch_year and y == switch_year:
                funding = "Level-funded" if seg == "Mid-size" else "Self-funded"
            for line in ("Medical", "Dental", "Vision"):
                incumbent = prev_carrier[line]
                pending = cl["rm"] == 7 and y == 2027
                marketed = (not pending) and y > 2023 and g.chance(0.25 if y == 2027 else 0.18)
                moved = marketed and g.chance(0.45) and not (cl["deep"] and line == "Medical")
                outcome = "Renewed"
                new_c = None
                if pending:
                    outcome = "Pending"
                elif line == "Medical" and switch_year == y:
                    outcome = "Changed funding"
                elif moved:
                    pool = [x for x in (CARRIERS_BY_TYPE["Medical carrier"] if line == "Medical" else
                                        CARRIERS_BY_TYPE["Dental & vision carrier"]) if x != incumbent]
                    new_c = rng.choice(pool)
                    carrier[line] = new_c
                    outcome = "Moved carrier"
                if line == "Medical":
                    final = MED_RENEWAL[y] + rng.gauss(0, 1.5)
                elif line == "Dental":
                    final = {2023: 3.0, 2024: 3.2, 2025: 3.6, 2026: 3.9, 2027: 4.2}[y] + rng.gauss(0, 1.0)
                else:
                    final = {2023: 1.5, 2024: 1.8, 2025: 2.0, 2026: 2.2, 2027: 2.5}[y] + rng.gauss(0, 0.8)
                final = round(max(-2.0, final), 2)
                initial = round(final + rng.uniform(1.0, 4.5), 2)
                if cl["rm"] == 1:
                    dd = g.rdate(date(y - 1, 8, 1), date(y - 1, 9, 30))
                else:
                    dd = g.rdate(date(y, 3, 1), date(y, 4, 30))
                if pending:
                    initial = final = dd = None
                g.add("renewals", renewal_id=f"RN-{cid}-{y}-{line[:3].upper()}", client_id=cid, plan_year=y,
                      line_of_coverage=line, incumbent_carrier_id=incumbent, new_carrier_id=new_c,
                      initial_increase_pct=initial, final_increase_pct=final, marketed=marketed, outcome=outcome,
                      decision_date=dd)
            prev_carrier = dict(carrier)
            g.funding[(cid, y)] = funding
            if g.chance(0.22):
                ppo_ded += 250
            if g.chance(0.2):
                hdhp_ded += 100
            idx = TOTAL_IDX.get(y, TOTAL_IDX[2026] * 1.082)
            p_start = date(y, cl["rm"], 1)
            p_end = date(y + 1, cl["rm"], 1) - timedelta(days=1)
            this_pbm = pbm
            if cid == "C017" and y == 2027:
                this_pbm = "CR-15"
            carved = carve or (cid == "C017" and y == 2027)
            meds = []
            for k, ptype in enumerate(types, 1):
                pid = f"P-{cid}-{y}-MED{k}"
                net = "Broad"
                if ptype in ("HMO", "EPO") and g.chance(0.5):
                    net = "Narrow"
                elif ptype == "PPO" and g.chance(0.15):
                    net = "Tiered"
                if ptype == "PPO":
                    ded, oop, coins = ppo_ded, ppo_ded * 3 + 1000, rng.choice([20, 20, 20, 10, 30])
                    copays = (rng.choice([25, 30, 35]), rng.choice([50, 55, 60, 65]), rng.choice([250, 300, 350]))
                    contrib = 172 * contrib_f * (idx ** 0.9)
                    rate_t, name = 1.08, f"PPO {ppo_ded}"
                elif ptype == "HDHP/HSA":
                    ded, oop, coins = hdhp_ded, hdhp_ded * 2 + 500, 20
                    copays = (None, None, None)
                    contrib = 98 * contrib_f * (idx ** 0.9)
                    rate_t, name = 0.82, f"HDHP/HSA {hdhp_ded}"
                elif ptype == "HMO":
                    ded, oop, coins = rng.choice([0, 250, 500]), 3000, rng.choice([0, 10])
                    copays = (20, 40, 200)
                    contrib = 150 * contrib_f * (idx ** 0.9)
                    rate_t, name = 0.92, "HMO Select"
                else:
                    ded, oop, coins = rng.choice([0, 500, 750]), 3500, 10
                    copays = (25, 50, 250)
                    contrib = 160 * contrib_f * (idx ** 0.9)
                    rate_t, name = 0.97, "EPO High Performance"
                carrier_id = carrier["Medical"]
                if funding != "Self-funded" and carrier_id in CARRIERS_BY_TYPE["TPA"]:
                    carrier_id = CARRIERS_BY_TYPE["Medical carrier"][0]
                g.add("plans", plan_id=pid, client_id=cid, plan_year=y, line_of_coverage="Medical", plan_name=name,
                      plan_type=ptype, funding=funding, carrier_id=carrier_id, pbm_carrier_id=this_pbm, network=net,
                      plan_start=p_start, plan_end=p_end)
                prov = g.add("plan_provisions", plan_id=pid, deductible_single=float(ded),
                             deductible_family=float(ded * 2), oop_max_single=float(oop),
                             oop_max_family=float(oop * 2), coinsurance_pct=float(coins),
                             pcp_copay=None if copays[0] is None else float(copays[0]),
                             specialist_copay=None if copays[1] is None else float(copays[1]),
                             er_copay=None if copays[2] is None else float(copays[2]),
                             rx_tier1_copay=10.0, rx_tier2_copay=float(rng.choice([35, 40, 45])),
                             rx_tier3_copay=float(rng.choice([60, 70, 80])),
                             rx_tier4_coinsurance_pct=float(rng.choice([20, 25, 30])),
                             hsa_employer_contrib=float(rng.choice([500, 750, 1000])) if ptype == "HDHP/HSA" else None,
                             glp1_weight_loss_covered=glp[y])
                single = 740 * rate_f * rate_t * idx * rng.uniform(0.97, 1.03)
                meta = {"id": pid, "client": cid, "year": y, "type": ptype, "start": p_start, "end": p_end,
                        "prov": prov, "single": single, "contrib": contrib}
                g.plans[pid] = meta
                meds.append(meta)
            g.client_plans[(cid, y)] = meds
            if carved:
                pid = f"P-{cid}-{y}-RX1"
                g.add("plans", plan_id=pid, client_id=cid, plan_year=y, line_of_coverage="Rx",
                      plan_name="Pharmacy carve-out", plan_type="PBM", funding="Self-funded", carrier_id=this_pbm,
                      pbm_carrier_id=this_pbm, network="Broad", plan_start=p_start, plan_end=p_end)
                g.add("plan_provisions", plan_id=pid, rx_tier1_copay=10.0, rx_tier2_copay=40.0, rx_tier3_copay=70.0,
                      rx_tier4_coinsurance_pct=25.0, glp1_weight_loss_covered=glp[y])
            for k in range(1, dental_n + 1):
                pid = f"P-{cid}-{y}-DEN{k}"
                ptype = "DPPO" if k == 1 else "DHMO"
                g.add("plans", plan_id=pid, client_id=cid, plan_year=y, line_of_coverage="Dental",
                      plan_name="Dental PPO" if k == 1 else "Dental HMO", plan_type=ptype,
                      funding="Self-funded" if funding == "Self-funded" and seg == "Jumbo" else "Fully insured",
                      carrier_id=carrier["Dental"], network="Broad", plan_start=p_start, plan_end=p_end)
                g.add("plan_provisions", plan_id=pid, deductible_single=50.0 if k == 1 else 0.0,
                      deductible_family=150.0 if k == 1 else 0.0, oop_max_single=float(rng.choice([1500, 2000])),
                      coinsurance_pct=20.0)
                g.plans[pid] = {"id": pid, "type": ptype, "single": 46 * idx ** 0.6 * (1 if k == 1 else 0.7),
                                "contrib": 14 * idx ** 0.6 * (1 if k == 1 else 0.5), "client": cid, "year": y}
            pid = f"P-{cid}-{y}-VIS1"
            g.add("plans", plan_id=pid, client_id=cid, plan_year=y, line_of_coverage="Vision", plan_name="Vision",
                  plan_type="Vision PPO", funding="Fully insured", carrier_id=carrier["Vision"], network="Broad",
                  plan_start=p_start, plan_end=p_end)
            g.add("plan_provisions", plan_id=pid, deductible_single=0.0, deductible_family=0.0, specialist_copay=10.0)
            g.plans[pid] = {"id": pid, "type": "Vision PPO", "single": 10.5 * idx ** 0.4, "contrib": 6 * idx ** 0.4,
                            "client": cid, "year": y}
            # rates
            share = {"PPO": 0.55, "HDHP/HSA": 0.3, "HMO": 0.15, "EPO": 0.1, "DPPO": 0.8, "DHMO": 0.2,
                     "Vision PPO": 0.7}
            med_share_tot = sum(share[m["type"]] for m in meds)
            for pid2 in [m["id"] for m in meds] + [f"P-{cid}-{y}-DEN{k}" for k in range(1, dental_n + 1)] + \
                    [f"P-{cid}-{y}-VIS1"]:
                meta = g.plans[pid2]
                if pid2 in [m["id"] for m in meds]:
                    plan_share = share[meta["type"]] / med_share_tot * 0.86
                else:
                    plan_share = share[meta["type"]] * (0.8 if "DEN" in pid2 else 0.7)
                    if "DEN" in pid2 and dental_n == 1:
                        plan_share = 0.8
                for tier, tf, cf, mix in (("EE", 1.0, 1.0, 0.42), ("EE+Spouse", 2.1, 2.6, 0.2),
                                          ("EE+Child(ren)", 1.85, 2.2, 0.15), ("Family", 2.9, 3.3, 0.23)):
                    g.add("plan_rates", plan_id=pid2, tier=tier, total_monthly_rate=round(meta["single"] * tf, 2),
                          ee_monthly_contribution=round(meta["contrib"] * cf, 2),
                          enrolled_employees=int(round(cl["count"] * plan_share * mix * rng.uniform(0.9, 1.1))))
            # stop-loss
            if funding in ("Self-funded", "Level-funded"):
                cnt = cl["count"]
                spec = (75000 if cnt < 1000 else 150000 if cnt < 5000 else 300000 if cnt < 20000 else 750000)
                spec = int(spec * (1 + 0.1 * ((y - 2023) // 2)) * rng.choice([1.0, 1.0, 1.25]))
                if cid == "C023":
                    spec = {2023: 150000, 2024: 150000, 2025: 175000, 2026: 175000, 2027: 200000}[y]
                g.add("stop_loss_contracts", stop_loss_id=f"SL-{cid}-{y}", client_id=cid, plan_year=y,
                      carrier_id=rng.choice(CARRIERS_BY_TYPE["Stop-loss"]),
                      contract_basis=rng.choice(["12/12", "12/15", "12/18", "Paid"]),
                      specific_deductible=float(spec),
                      aggregate_corridor_pct=120.0 if funding == "Level-funded" else 125.0,
                      premium_pepm=round(rng.uniform(40, 90) * (150000 / spec) ** 0.4 * idx, 2),
                      lasered_claimants=rng.choice([0, 0, 0, 1, 1, 2, 3]))
    # the design's sample rows (2026)
    _set_prov(g, "P-C017-2026-MED1", 1000, 4000, 20, 186)
    _set_prov(g, "P-C017-2026-MED2", 2500, 5500, 20, 104)
    _set_prov(g, "P-C023-2026-MED1", 1500, 5000, 30, 212)


def _set_prov(g, pid, ded, oop, coins, contrib):
    meta = g.plans[pid]
    p = meta["prov"]
    ix = COLIDX["plan_provisions"]
    p[ix["deductible_single"]], p[ix["deductible_family"]] = float(ded), float(ded * 2)
    p[ix["oop_max_single"]], p[ix["oop_max_family"]] = float(oop), float(oop * 2)
    p[ix["coinsurance_pct"]] = float(coins)
    ri = COLIDX["plan_rates"]
    factor = contrib / meta["contrib"]
    for r in g.rows["plan_rates"]:
        if r[ri["plan_id"]] == pid:
            r[ri["ee_monthly_contribution"]] = round(r[ri["ee_monthly_contribution"]] * factor, 2)
            if r[ri["tier"]] == "EE":
                r[ri["ee_monthly_contribution"]] = float(contrib)
    meta["contrib"] = contrib
    plans_ix = COLIDX["plans"]
    for r in g.rows["plans"]:
        if r[plans_ix["plan_id"]] == pid:
            r[plans_ix["plan_name"]] = f"{meta['type']} {ded}"


# ------------------------------------------------- 06 LAD programs + experience
def _lad_programs(g):
    rng = g.rng
    g.lad = {}
    codes = {"Basic life": "LIFE", "Supplemental life": "SUPP", "AD&D": "ADD", "STD": "STD", "LTD": "LTD",
             "Leave administration": "LOA"}
    leave_clients = ["C017", "C012", "C029", "C051"]
    for cl in g.clients:
        cid, deep = cl["id"], cl["deep"]
        covs = ["Basic life"]
        if g.chance(0.85):
            covs.append("AD&D")
        if g.chance(0.6):
            covs.append("Supplemental life")
        if deep or g.chance(0.7):
            covs.append("STD")
        if deep or g.chance(0.85):
            covs.append("LTD")
        if (deep and cid in leave_clients) or (not deep and g.chance(0.4)):
            covs.append("Leave administration")
        life_carrier = rng.choice(CARRIERS_BY_TYPE["LAD carrier"])
        dis_carrier = life_carrier if g.chance(0.6) else rng.choice(CARRIERS_BY_TYPE["LAD carrier"])
        leave_admin = rng.choice(CARRIERS_BY_TYPE["Leave administrator"])
        salary = {"Technology": 115000, "Financial Services": 98000, "Healthcare": 72000, "Public sector": 66000,
                  "Manufacturing": 64000, "Transportation": 58000, "Retail": 42000}[cl["industry"]]
        std_aso = cl["segment"] in ("Large", "Jumbo") and g.chance(0.4)
        mult = rng.choice([1, 1, 2])
        base_rate = {"Basic life": rng.uniform(0.10, 0.18), "AD&D": rng.uniform(0.02, 0.04),
                     "Supplemental life": rng.uniform(0.15, 0.30), "STD": rng.uniform(0.30, 0.55),
                     "LTD": rng.uniform(0.28, 0.55), "Leave administration": rng.uniform(1.5, 3.5)}
        for y in cl["years"]:
            for cov in covs:
                pid = f"LP-{cid}-{y}-{codes[cov]}"
                kw = dict(program_id=pid, client_id=cid, plan_year=y, coverage=cov,
                          carrier_id=leave_admin if cov == "Leave administration" else
                          (dis_carrier if cov in ("STD", "LTD") else life_carrier),
                          funding="Self-insured ASO" if (cov == "STD" and std_aso) or cov == "Leave administration"
                          else "Insured", rate=round(base_rate[cov] * (1.02 ** (y - 2023)), 4))
                if cov == "Basic life":
                    kw.update(life_multiple=float(mult), guaranteed_issue=float(rng.choice([150000, 250000, 500000])),
                              rate_basis="Per $1,000 of volume")
                elif cov == "AD&D":
                    kw.update(life_multiple=float(mult), rate_basis="Per $1,000 of volume")
                elif cov == "Supplemental life":
                    kw.update(life_multiple=5.0, guaranteed_issue=300000.0, rate_basis="Per $1,000 of volume")
                elif cov == "STD":
                    kw.update(benefit_pct=float(rng.choice([60, 66.67, 70])), max_monthly=round(1500 * 52 / 12, 2),
                              elimination_days=rng.choice([7, 7, 14]), rate_basis="Per $10 of weekly benefit")
                elif cov == "LTD":
                    kw.update(benefit_pct=60.0, max_monthly=float(rng.choice([10000, 15000])),
                              elimination_days=rng.choice([90, 90, 180]), own_occ_months=24,
                              rate_basis="% of covered payroll")
                else:
                    kw.update(rate_basis="PEPM")
                row = g.add("lad_programs", **kw)
                g.lad[(cid, y, cov)] = {"id": pid, "row": row}
                if cov == "Leave administration" or y > 2026:
                    continue
                if cl["rm"] == 1:
                    months = 12 if y < 2026 else 9
                else:
                    months = 12 if y < 2026 else 3
                part = {"Basic life": 0.97, "AD&D": 0.95, "Supplemental life": 0.45, "STD": 0.9, "LTD": 0.92}[cov]
                lives = int(cl["count"] * part * rng.uniform(0.97, 1.03))
                r = kw["rate"]
                if cov in ("Basic life", "AD&D"):
                    prem = lives * salary * mult / 1000 * r * months
                elif cov == "Supplemental life":
                    prem = lives * 60000 / 1000 * r * months
                elif cov == "STD":
                    prem = lives * min(salary / 52 * 0.6, 1500) / 10 * r * months
                else:
                    prem = lives * salary / 12 * r / 100 * months
                inc = {"Basic life": 1.3, "AD&D": 0.25, "Supplemental life": 1.6, "STD": 70, "LTD": 4.0}[cov]
                lr = {"Basic life": rng.uniform(0.55, 0.85), "AD&D": rng.uniform(0.3, 0.7),
                      "Supplemental life": rng.uniform(0.5, 0.85), "STD": rng.uniform(0.62, 0.9),
                      "LTD": rng.uniform(0.45, 0.9)}[cov]
                if cid == "C044" and cov == "LTD":   # signal 5
                    lr = {2023: 0.88, 2024: 1.21, 2025: 1.34, 2026: 0.97}[y]
                    inc = 8.5
                if cid == "C044" and cov == "STD":
                    inc = 98
                cnt = g.poisson(lives * inc / 1000 * months / 12)
                g.add("lad_experience", program_id=pid, experience_year=y, months_reported=months,
                      covered_lives=lives, premium=round(prem, 2), incurred_claims=round(prem * lr, 2),
                      claim_count=cnt)


# ------------------------------------------------------------ 03 census ---
SAL_MID = {"<$40k": 34000, "$40–60k": 50000, "$60–90k": 75000, "$90–130k": 110000, "$130k+": 175000}


def _census(g):
    rng = g.rng
    g.emps = []
    g.members = {}          # member_id -> meta
    g.enrolls = []          # meta
    hourly = {"Healthcare": 55, "Retail": 75, "Transportation": 70, "Manufacturing": 65, "Technology": 10,
              "Financial Services": 25}
    enr_no = 0
    for cid, spec in DEEP.items():
        cl = g.client_by_id[cid]
        for i in range(1, spec["n"] + 1):
            eid = f"EMP-{cid}-{i:05d}"
            if g.chance(0.76):
                hire = g.rdate(date(1990, 1, 1), date(2022, 12, 31))
                term = g.rdate(date(2023, 1, 15), date(2026, 10, 15)) if g.chance(0.3) else None
            else:
                hire = g.rdate(date(2023, 1, 1), date(2026, 9, 15))
                term = g.rdate(hire + timedelta(days=60), hire + timedelta(days=900)) if g.chance(0.25) else None
                if term and term > date(2026, 10, 15):
                    term = None
            level = g.wpick([("Hourly", hourly[cl["industry"]]), ("Salaried", 100 - hourly[cl["industry"]]),
                             ("Executive", 2)])
            band = (g.wpick([("<$40k", 40), ("$40–60k", 50), ("$60–90k", 10)]) if level == "Hourly" else
                    g.wpick([("$40–60k", 15), ("$60–90k", 45), ("$90–130k", 32), ("$130k+", 8)]) if level == "Salaried"
                    else "$130k+")
            by = rng.randint(1958, min(2004, hire.year - 18))
            gender = g.wpick([("Female", 50), ("Male", 49), ("Not disclosed", 1)])
            ws = g.wpick(spec["states"])
            g.add("employees", employee_id=eid, client_id=cid, birth_year=by, gender=gender, work_state=ws,
                  job_level=level, salary_band=band, hire_date=hire, term_date=term,
                  status="Terminated" if term else "Active")
            risk = math.exp(rng.gauss(0, 0.55))
            emp = {"id": eid, "client": cid, "hire": hire, "term": term, "by": by, "gender": gender, "state": ws,
                   "level": level, "salary": SAL_MID[band], "risk": risk, "members": []}
            g.emps.append(emp)
            mems = [(f"{eid}-0", "Employee", by, gender, risk)]
            if g.chance(0.45):
                sg = "Male" if gender == "Female" else "Female"
                mems.append((f"{eid}-1", "Spouse", by + rng.randint(-5, 5), sg, math.exp(rng.gauss(0, 0.55))))
            nk = g.wpick([(0, 55), (1, 18), (2, 18), (3, 9)])
            for k in range(nk):
                kby = min(2022, max(2000, by + rng.randint(24, 40)))
                mems.append((f"{eid}-{len(mems) + 1}", "Child", kby, rng.choice(["Female", "Male"]),
                             math.exp(rng.gauss(0, 0.5))))
            for mid, rel, mby, mg, mr in mems:
                g.add("members", member_id=mid, employee_id=eid, relationship=rel, birth_year=mby, gender=mg)
                m = {"id": mid, "rel": rel, "by": mby, "gender": mg, "risk": mr, "emp": emp, "from": None}
                g.members[mid] = m
                emp["members"].append(m)
            # elections per plan year
            elects = g.chance(0.9)
            hdhp_p = 0.45 if risk < 0.85 else 0.18
            choice = None
            tier = None
            for y in YEARS_CLAIMS:
                s = max(date(y, 1, 1), hire)
                e = min(date(y, 12, 31), term) if term else date(y, 12, 31)
                if s > e:
                    continue
                if g.chance(0.04):
                    elects = not elects
                if not elects:
                    continue
                plans = g.client_plans[(cid, y)]
                types = [p["type"] for p in plans]
                if choice is None or choice not in types or g.chance(0.1):
                    w = []
                    for t in types:
                        w.append((t, {"PPO": 1 - hdhp_p, "HDHP/HSA": hdhp_p}.get(t, 0.18)))
                    choice = g.wpick(w)
                plan = plans[types.index(choice)]
                if tier is None or g.chance(0.08):
                    has_sp = any(m["rel"] == "Spouse" for m in emp["members"])
                    has_ch = any(m["rel"] == "Child" for m in emp["members"])
                    if has_sp and has_ch:
                        tier = g.wpick([("FAM", 80), ("EE", 10), ("EE+SP", 5), ("EE+CH", 5)])
                    elif has_sp:
                        tier = g.wpick([("EE+SP", 75), ("EE", 25)])
                    elif has_ch:
                        tier = g.wpick([("EE+CH", 85), ("EE", 15)])
                    else:
                        tier = "EE"
                enr_no += 1
                row = g.add("enrollments", enrollment_id=f"ENR-{enr_no:07d}", employee_id=eid, plan_id=plan["id"],
                            tier=tier, covered_members=0, start_date=s, end_date=e)
                g.enrolls.append({"row": row, "emp": emp, "plan": plan, "tier": tier, "start": s, "end": e, "year": y})
    for en in g.enrolls:
        _cover(en)
    # NICU newborn (signal 4): an employee with a spouse, enrolled all of 2025 in the PPO, still employed in 2026.
    for emp in g.emps:
        if emp["client"] != NICU["client"] or emp["term"] or emp["hire"] > date(2024, 1, 1):
            continue
        if not any(m["rel"] == "Spouse" for m in emp["members"]):
            continue
        ens = [en for en in g.enrolls if en["emp"] is emp]
        e25 = [en for en in ens if en["year"] == 2025 and en["plan"]["type"] == "PPO"]
        if not e25 or not [en for en in ens if en["year"] == 2026]:
            continue
        mid = f"{emp['id']}-{len(emp['members'])}"
        g.add("members", member_id=mid, employee_id=emp["id"], relationship="Child", birth_year=2025, gender="Male")
        baby = {"id": mid, "rel": "Child", "by": 2025, "gender": "Male", "risk": 1.0, "emp": emp,
                "from": NICU["birth"]}
        g.members[mid] = baby
        emp["members"].append(baby)
        for en in ens:
            if en["year"] >= 2025:
                en["tier"] = "FAM"
                en["row"][COLIDX["enrollments"]["tier"]] = "FAM"
                _cover(en)
        g.nicu_member = mid
        g.nicu_plan = e25[0]["plan"]["id"]
        break
    assert getattr(g, "nicu_member", None), "no NICU candidate"


def _cover(en):
    y, tier = en["year"], en["tier"]
    cov = []
    for m in en["emp"]["members"]:
        if m["rel"] == "Employee" or (m["rel"] == "Spouse" and tier in ("EE+SP", "FAM")) or \
                (m["rel"] == "Child" and tier in ("EE+CH", "FAM") and m["by"] <= y):
            cov.append(m)
    en["covered"] = cov
    en["row"][COLIDX["enrollments"]["covered_members"]] = len(cov)


# ------------------------------------------------------------ 03 claims ---
MED_SETTINGS = [("Professional", 0.56, 210.0), ("Telehealth", 0.08, 85.0), ("Outpatient", 0.24, 1500.0),
                ("ER", 0.085, 2300.0), ("Inpatient", 0.035, 21000.0)]
DX = {"Professional": [("MSK", 18), ("Preventive", 18), ("Mental health", 12), ("Cardiovascular", 9),
                       ("Respiratory", 10), ("Digestive", 6), ("Maternity", 5), ("Cancer", 4), ("Injury", 6),
                       ("Other", 12)],
      "Telehealth": [("Mental health", 40), ("Respiratory", 25), ("Other", 20), ("MSK", 15)],
      "Outpatient": [("MSK", 22), ("Cancer", 14), ("Digestive", 14), ("Cardiovascular", 12), ("Injury", 8),
                     ("Maternity", 6), ("Preventive", 8), ("Other", 16)],
      "ER": [("Injury", 30), ("Cardiovascular", 15), ("Respiratory", 15), ("Digestive", 15), ("MSK", 10),
             ("Mental health", 5), ("Other", 10)],
      "Inpatient": [("Maternity", 22), ("Cardiovascular", 18), ("Cancer", 15), ("MSK", 15), ("Digestive", 8),
                    ("Mental health", 7), ("Injury", 7), ("Respiratory", 5), ("Other", 3)]}
DENIALS = ["Not medically necessary", "Prior authorization missing", "Out of network", "Duplicate submission",
           "Eligibility", "Coding error", "Timely filing"]
SHARE = {"PPO": 0.16, "HMO": 0.10, "EPO": 0.12, "HDHP/HSA": 0.30}
RX_CLASSES = {"Generic": (24.0, 10.0, 0.0), "Brand": (420.0, 40.0, 0.25), "Specialty": (5200.0, 150.0, 0.15),
              "GLP-1 (diabetes)": (950.0, 50.0, 0.30), "GLP-1 (weight loss)": (1050.0, 60.0, 0.30)}
GLP_WL_P = {2023: 0.03, 2024: 0.045, 2025: 0.06, 2026: 0.075}
MED_RATE, RX_RATE = 0.62, 0.30


def _claims(g):
    rng = g.rng
    med, rx = [], []
    exposure = {}
    client_glp = {cid: DEEP[cid]["glp1"] for cid in DEEP}
    denial_p = {cid: rng.uniform(0.045, 0.075) for cid in DEEP}
    hot = rng.choice([cid for cid in DEEP if cid != LATE_FEED_CLIENT])   # one client's denials jump in Q3 2026
    g.denial_hot = hot
    for en in g.enrolls:
        cid = en["emp"]["client"]
        y = en["year"]
        key = (cid, y)
        exposure[key] = exposure.get(key, 0) + employee_months(en["start"], en["end"], y)
        s0 = max(en["start"], CLAIMS_START)
        t0 = min(en["end"], CLAIMS_END)
        if s0 > t0:
            continue
        plan = en["plan"]
        ptype = plan["type"]
        pid = plan["id"]
        rate_pf = 0.88 if ptype == "HDHP/HSA" else 0.95 if ptype in ("HMO", "EPO") else 1.0
        amt_pf = 0.9 if ptype == "HDHP/HSA" else 0.96 if ptype in ("HMO", "EPO") else 1.0
        share = SHARE[ptype]
        oon_p = 0.02 if ptype in ("HMO", "EPO") else 0.07
        glp_cov = plan["prov"][COLIDX["plan_provisions"]["glp1_weight_loss_covered"]] in ("Yes", "With criteria")
        for m in en["covered"]:
            s = max(s0, m["from"]) if m["from"] else s0
            if s > t0:
                continue
            days = (t0 - s).days + 1
            age = y - m["by"]
            agef = 0.55 if m["rel"] == "Child" else 0.6 + max(0, age - 20) * 0.025
            n = g.poisson(MED_RATE * agef * m["risk"] * rate_pf * days / 30.4)
            female_fertile = m["gender"] == "Female" and 18 <= age <= 45
            for _ in range(n):
                sd = s + timedelta(days=rng.randrange(days))
                x = rng.random()
                for setting, p, base in MED_SETTINGS:
                    x -= p
                    if x < 0:
                        break
                dx = g.wpick(DX[setting])
                if dx == "Maternity" and not female_fertile:
                    dx = "Other"
                allowed = base * math.exp(rng.gauss(0, 0.85)) * amt_pf * (0.7 + 0.3 * m["risk"])
                net = "Out" if rng.random() < oon_p else "In"
                sh = min(0.95, share * rng.uniform(0.5, 1.5) + (0.15 if net == "Out" else 0))
                if setting == "Telehealth" or dx == "Preventive":
                    sh = sh * 0.3
                lag = 7 + int(rng.expovariate(1 / 16.0))
                pd = sd + timedelta(days=lag)
                if pd > TODAY:
                    pd = TODAY - timedelta(days=rng.randint(0, 3))
                    if pd < sd:
                        pd = sd + timedelta(days=0)
                dp = denial_p[cid] * (1.6 if cid == hot and sd >= date(2026, 7, 1) else 1.0)
                if rng.random() < dp:
                    status, reason, mp, pp = "Denied", rng.choice(DENIALS), 0.0, 0.0
                else:
                    status = "Adjusted" if rng.random() < 0.04 else "Paid"
                    reason = None
                    mp = allowed * sh
                    pp = allowed - mp
                med.append([None, m["id"], pid, sd, pd, setting, dx, allowed, pp, mp, status, reason, net])
            # Rx
            n = g.poisson(RX_RATE * agef * math.sqrt(m["risk"]) * days / 30.4)
            for _ in range(n):
                fd = s + timedelta(days=rng.randrange(days))
                x = rng.random()
                if m["rel"] != "Child" and glp_cov and x < GLP_WL_P[fd.year]:
                    cls = "GLP-1 (weight loss)"
                elif x < 0.03 + GLP_WL_P[fd.year]:
                    cls = "GLP-1 (diabetes)" if m["rel"] != "Child" else "Generic"
                elif x < 0.045 + GLP_WL_P[fd.year]:
                    cls = "Specialty"
                elif x < 0.20 + GLP_WL_P[fd.year]:
                    cls = "Brand"
                else:
                    cls = "Generic"
                base, copay, _reb = RX_CLASSES[cls]
                ch = "Specialty" if cls == "Specialty" else ("Mail" if rng.random() < 0.22 else "Retail")
                ds = 90 if ch == "Mail" else 30
                cost = base * (ds / 30) * math.exp(rng.gauss(0, 0.35))
                mp = min(cost, copay * (2.5 if ds == 90 else 1) * (1.6 if ptype == "HDHP/HSA" else 1.0))
                rx.append([None, m["id"], pid, fd, cls, ds, ch, 0.0, cost - mp, mp, 0.0])
    g.exposure = exposure
    _calibrate(g, med, rx, client_glp)
    # late feed (defect): the client's Aug-Sep 2026 medical claims are mostly missing.
    keep = []
    for r in med:
        if r[2][2:6] == LATE_FEED_CLIENT and r[3] >= date(2026, 8, 1) and rng.random() < 0.88:
            continue
        keep.append(r)
    med = keep
    # NICU claimant (signal 4)
    baby, bplan = g.nicu_member, g.nicu_plan
    d = NICU["birth"]
    for k, pp in enumerate(NICU["paid"]):
        sd = d + timedelta(days=k * 9)
        mp = 1500.0 if k == 0 else 0.0
        med.append([None, baby, bplan, sd, sd + timedelta(days=21 + k * 4), "Inpatient", "Neonatal / NICU",
                    pp + mp, pp, mp, "Paid", None, "In"])
    for k in range(4):
        sd = d + timedelta(days=60 + k * 30)
        med.append([None, baby, bplan, sd, sd + timedelta(days=14), "Professional", "Neonatal / NICU",
                    420.0 + k * 35, 380.0 + k * 30, 40.0 + k * 5, "Paid", None, "In"])
    # orphans (defect): claims after the employee's coverage ended
    ens_by_emp = {}
    for en in g.enrolls:
        ens_by_emp.setdefault(en["emp"]["id"], []).append(en)
    termed = [e for e in g.emps if e["term"] and e["term"] < date(2026, 7, 1) and e["id"] in ens_by_emp]
    sample_med = [r for r in med if r[10] == "Paid"]
    n_orph = int(len(med) * 0.003)
    for _ in range(n_orph):
        e = rng.choice(termed)
        last = max(ens_by_emp[e["id"]], key=lambda en: en["end"])
        if last["end"] >= CLAIMS_END - timedelta(days=10):
            continue
        m = rng.choice(last["covered"])
        sd = last["end"] + timedelta(days=rng.randint(3, 75))
        if sd > CLAIMS_END:
            sd = CLAIMS_END
        src = rng.choice(sample_med)
        med.append([None, m["id"], last["plan"]["id"], sd, min(TODAY, sd + timedelta(days=rng.randint(9, 40))),
                    src[5], src[6], src[7], src[8], src[9], "Paid", None, src[12]])
    # duplicates (defect): same member, service date and amount, new claim id
    n_dup = int(len(med) * 0.002)
    for _ in range(n_dup):
        src = rng.choice(med)
        if src[1] == baby:
            continue
        dup = list(src)
        dup[4] = min(TODAY, src[4] + timedelta(days=rng.randint(0, 12)))
        med.append(dup)
    # bad dates (defect): service after paid, or after the dataset's today
    normal = [r for r in med if r[1] != baby]
    for _ in range(12):
        r = rng.choice(normal)
        r[4] = r[3] - timedelta(days=rng.randint(1, 25))
    for _ in range(9):
        r = rng.choice(normal)
        r[3] = TODAY + timedelta(days=rng.randint(2, 45))
        r[4] = TODAY - timedelta(days=rng.randint(0, 10))
    med.sort(key=lambda r: (r[4], r[3], r[1], r[2], r[7]))
    for i, r in enumerate(med, 1):
        r[0] = f"MC-{i:08d}"
    rx.sort(key=lambda r: (r[3], r[1], r[2], r[8]))
    for i, r in enumerate(rx, 1):
        r[0] = f"RX-{i:08d}"
    g.rows["medical_claims"] = med
    g.rows["rx_claims"] = rx
    # missing dependent birth years (defect)
    bix = COLIDX["members"]["birth_year"]
    rix = COLIDX["members"]["relationship"]
    deps = [r for r in g.rows["members"] if r[rix] != "Employee" and r[0] != g.nicu_member]
    for r in rng.sample(deps, max(1, len(deps) // 200)):
        r[bix] = None


def _calibrate(g, med, rx, client_glp):
    """Scale claim amounts so each deep-data client-year hits its target cost per employee-month
    (signals 1 and 2). Relative differences between plans and members are kept."""
    tot_med, tot_rx = {}, {}
    for r in med:
        k = (r[2][2:6], r[3].year)
        tot_med[k] = tot_med.get(k, 0.0) + r[8]
    for r in rx:
        k = (r[2][2:6], r[3].year)
        tot_rx[k] = tot_rx.get(k, 0.0) + r[8]
    f_med, f_rx = {}, {}
    for (cid, y), months in g.exposure.items():
        base = g.client_by_id[cid]["base_pepy"] / 12
        total = base * TOTAL_IDX[y] * months
        rx_t = base * RX_SHARE_2023 * RX_IDX[client_glp[cid]][y] * months
        f_med[(cid, y)] = (total - rx_t) / tot_med[(cid, y)]
        f_rx[(cid, y)] = rx_t / tot_rx[(cid, y)]
    for r in med:
        f = f_med[(r[2][2:6], r[3].year)]
        r[7] = round(r[7] * f, 2)
        r[9] = round(r[9] * f, 2)
        r[8] = round(r[8] * f, 2) if r[10] != "Denied" else 0.0
    for r in rx:
        f = f_rx[(r[2][2:6], r[3].year)]
        r[8] = round(r[8] * f, 2)
        r[9] = round(r[9], 2)
        r[7] = round(r[8] + r[9], 2)
        r[10] = round(r[7] * RX_CLASSES[r[4]][2], 2)


# ------------------------------------------------- 06 disability and leave -
STD_DX = [("Maternity", 22), ("Musculoskeletal", 24), ("Mental health", 12), ("Injury", 12), ("Digestive", 8),
          ("Cardiovascular", 5), ("Cancer", 5), ("Respiratory", 5), ("Other", 7)]
STD_DX_C044 = [("Maternity", 8), ("Musculoskeletal", 45), ("Mental health", 8), ("Injury", 16), ("Digestive", 6),
               ("Cardiovascular", 5), ("Cancer", 4), ("Respiratory", 3), ("Other", 5)]
LTD_DX = [("Musculoskeletal", 30), ("Cancer", 20), ("Mental health", 15), ("Cardiovascular", 12), ("Injury", 10),
          ("Other", 13)]


def _disability_and_leave(g):
    rng = g.rng
    dclaims = {cid: [] for cid in DEEP}
    leaves = {cid: [] for cid in DEEP}
    lad_ix = COLIDX["lad_programs"]
    for emp in g.emps:
        cid = emp["client"]
        for y in YEARS_CLAIMS:
            s = max(date(y, 1, 1), emp["hire"])
            e = min(date(y, 12, 31), emp["term"] or date(y, 12, 31), date(2026, 10, 15))
            if (e - s).days < 30:
                continue
            frac = ((e - s).days + 1) / 365
            age = y - emp["by"]
            for ctype in ("STD", "LTD"):
                prog = g.lad[(cid, y, ctype)]
                if ctype == "STD":
                    p = 0.07 * (1.4 if cid == "C044" else 1.0) * (1.3 if emp["level"] == "Hourly" else 1.0)
                else:
                    p = 0.0045 * (2.5 if cid == "C044" else 1.0) * (0.6 + age / 50)
                if rng.random() >= p * frac:
                    continue
                inc = g.rdate(s, e)
                if ctype == "STD":
                    dx = g.wpick(STD_DX_C044 if cid == "C044" else STD_DX)
                    if dx == "Maternity" and not (emp["gender"] == "Female" and age <= 45):
                        dx = "Musculoskeletal"
                    dur = {"Maternity": rng.randint(42, 56), "Musculoskeletal": rng.randint(20, 90),
                           "Mental health": rng.randint(30, 90), "Cancer": rng.randint(45, 180)}.get(
                        dx, rng.randint(10, 60))
                else:
                    dx = g.wpick(LTD_DX)
                    dur = None
                approved = rng.random() < 0.93
                pr = prog["row"]
                pct = pr[lad_ix["benefit_pct"]] / 100
                elim = pr[lad_ix["elimination_days"]]
                if not approved:
                    status, paid, rtw, duration = "Closed – other", 0.0, None, None
                elif ctype == "STD":
                    end = inc + timedelta(days=dur)
                    weekly = min(emp["salary"] / 52 * pct, 1500)
                    if end > TODAY:
                        status, duration, rtw = "Open", None, None
                        paid = weekly * max(0, (TODAY - inc).days - elim) / 7
                    else:
                        duration = dur
                        rtw_ok = rng.random() < 0.88
                        status = "Closed – RTW" if rtw_ok else "Closed – other"
                        rtw = end if rtw_ok else None
                        paid = weekly * max(0, dur - elim) / 7
                else:
                    monthly = min(emp["salary"] / 12 * pct, pr[lad_ix["max_monthly"]])
                    if rng.random() < 0.75:
                        status, duration, rtw = "Open", None, None
                        stop = TODAY
                    else:
                        duration = elim + rng.randint(120, 700)
                        stop = inc + timedelta(days=duration)
                        if stop > TODAY:
                            status, duration, rtw, stop = "Open", None, None, TODAY
                        else:
                            rtw_ok = rng.random() < 0.5
                            status = "Closed – RTW" if rtw_ok else "Closed – other"
                            rtw = stop if rtw_ok else None
                    paid = monthly * max(0, (stop - inc).days - elim) / 30.4
                dclaims[cid].append([None, emp["id"], prog["id"], ctype, dx, inc, approved, duration,
                                     round(paid, 2), status, rtw])
            # leave
            if rng.random() < 0.2 * frac:
                start = g.rdate(s, min(e, date(2026, 10, 15)))
                law = PFML_BY_STATE.get(emp["state"])
                reason = g.wpick([("Own health", 45), ("Bonding", 20), ("Family care", 35)])
                lt = "FMLA"
                if law and start >= law[2] and rng.random() < 0.55:
                    lt = "State PFML"
                elif reason == "Own health" and rng.random() < 0.15:
                    lt = "ADA accommodation"
                elif rng.random() < 0.1:
                    lt = "Company"
                weeks = {"Own health": rng.randint(1, 12), "Bonding": rng.randint(6, 12),
                         "Family care": rng.randint(1, 8)}[reason]
                end = start + timedelta(days=weeks * 7)
                leaves[cid].append([None, emp["id"], lt, emp["state"], law[0] if law else None, reason, start,
                                    None if end > TODAY else end, rng.random() < 0.92, rng.random() < 0.25])
    for cid in DEEP:
        for name, rows, pre in (("disability_claims", dclaims[cid], "DC"), ("leave_cases", leaves[cid], "LV")):
            rows.sort(key=lambda r: (r[5] if name == "disability_claims" else r[6], r[1]))
            for i, r in enumerate(rows, 1):
                r[0] = f"{pre}-{cnum(cid)}-{i:05d}"
            g.rows[name].extend(rows)
    # state laws + client leave policies (signal 6)
    for st, prog, eff, wm, wf, wc, pct, wmax, fund in PFML:
        g.add("state_leave_laws", state=st, program_name=prog, effective_date=eff, max_weeks_medical=wm,
              max_weeks_family=wf, max_weeks_combined=wc, wage_replacement_pct=float(pct), weekly_max=float(wmax),
              funding=fund)
    for cl in g.clients:
        base = {"Own health": rng.choice([12, 16, 26]), "Bonding": rng.choice([8, 12, 12, 16]),
                "Family care": rng.choice([4, 6, 8, 12])}
        pay = float(rng.choice([60, 70, 100, 100]))
        integ = rng.choice(["Offset", "Top-up"])
        for st in cl["states"]:
            law = PFML_BY_STATE.get(st)
            if not law:
                continue
            for reason in ("Own health", "Bonding", "Family care"):
                law_weeks = law[3] if reason == "Own health" else law[4]
                weeks = max(base[reason], law_weeks)
                if cl["id"] == LEAVE_GAP_CLIENT:
                    weeks = 6
                g.add("client_leave_policies", client_id=cl["id"], state=st, reason=reason, weeks_paid=weeks,
                      pay_pct=pay, integrates_with_state="Offset" if cl["id"] == LEAVE_GAP_CLIENT else integ)


# ------------------------------------------------------- 04 benchmarking ---
SIZE_BANDS = ["10–49", "50–199", "200–499", "500–999", "1,000–4,999", "5,000–9,999", "10,000–19,999", "20,000+"]
SIZE_COST = dict(zip(SIZE_BANDS, [0.93, 0.95, 0.97, 0.98, 1.0, 1.02, 1.03, 1.05]))
SIZE_SHARE = dict(zip(SIZE_BANDS, [0.07, 0.12, 0.13, 0.15, 0.25, 0.12, 0.08, 0.08]))
REGION_COST = {"Northeast": 1.09, "West": 1.06, "Midwest": 0.96, "South": 0.94}
REGION_SHARE = {"Northeast": 0.18, "Midwest": 0.24, "South": 0.36, "West": 0.22}
IND_SHARE = {"Healthcare": 0.16, "Manufacturing": 0.18, "Transportation": 0.09, "Retail": 0.12,
             "Financial Services": 0.13, "Technology": 0.12, "Public sector": 0.20}
IND_COST = {"Healthcare": 1.04, "Manufacturing": 0.97, "Transportation": 0.98, "Retail": 0.90,
            "Financial Services": 1.06, "Technology": 1.05, "Public sector": 1.10}
# measure: (unit, domain, kind, definition, {year: national mean for All 500+})
# kind: cost (scales with region/size/industry), level (noise only), prev (percent of employers), trend (additive)
MEASURES = [
    ("cost_per_employee", "USD", "Medical", "cost", "Total health benefit cost per employee per year, employer and employee shares, medical + Rx.", {2023: 15797, 2024: 16501, 2025: 17496}),
    ("cost_increase_pct", "%", "Medical", "trend", "Percent change in total health benefit cost per employee versus the prior year, after plan changes.", {2023: 5.2, 2024: 4.5, 2025: 6.0}),
    ("medical_cost_per_employee", "USD", "Medical", "cost", "Medical (non-Rx) cost per employee per year.", {2023: 12322, 2024: 12706, 2025: 13297}),
    ("rx_cost_per_employee", "USD", "Rx", "cost", "Prescription drug cost per employee per year.", {2023: 3475, 2024: 3795, 2025: 4199}),
    ("ppo_deductible_single", "USD", "Plan design", "level", "Average in-network single deductible in the PPO.", {2023: 990, 2024: 1020, 2025: 1064}),
    ("ppo_oop_max_single", "USD", "Plan design", "level", "Average single out-of-pocket maximum in the PPO.", {2023: 3800, 2024: 3950, 2025: 4100}),
    ("hdhp_deductible_single", "USD", "Plan design", "level", "Average single deductible in the HSA-eligible HDHP.", {2023: 2350, 2024: 2400, 2025: 2481}),
    ("hdhp_oop_max_single", "USD", "Plan design", "level", "Average single out-of-pocket maximum in the HDHP.", {2023: 4900, 2024: 5050, 2025: 5250}),
    ("ee_contrib_single_ppo_monthly", "USD", "Contribution", "cost", "Average employee monthly contribution for single PPO coverage.", {2023: 172, 2024: 181, 2025: 191}),
    ("ee_contrib_family_ppo_monthly", "USD", "Contribution", "cost", "Average employee monthly contribution for family PPO coverage.", {2023: 590, 2024: 615, 2025: 648}),
    ("ee_contrib_single_hdhp_monthly", "USD", "Contribution", "cost", "Average employee monthly contribution for single HDHP coverage.", {2023: 98, 2024: 103, 2025: 109}),
    ("ee_share_premium_single_pct", "%", "Contribution", "level", "Employee share of the total single premium, percent.", {2023: 21, 2024: 21, 2025: 22}),
    ("ee_share_premium_family_pct", "%", "Contribution", "level", "Employee share of the total family premium, percent.", {2023: 27, 2024: 27, 2025: 28}),
    ("hdhp_enrollment_pct", "%", "Plan design", "level", "Percent of covered employees enrolled in an HDHP.", {2023: 32, 2024: 33, 2025: 34}),
    ("offers_hdhp_pct", "%", "Plan design", "prev", "Percent of employers offering an HSA-eligible HDHP.", {2023: 72, 2024: 73, 2025: 74}),
    ("offers_3plus_plans_pct", "%", "Plan design", "prev", "Percent of employers offering 3 or more medical plans at the largest worksite.", {2023: 60, 2024: 65, 2025: 67}),
    ("self_funded_pct", "%", "Plan design", "prev", "Percent of employers self-funding the PPO.", {2023: 76, 2024: 77, 2025: 78}),
    ("narrow_network_pct", "%", "Plan design", "prev", "Percent of employers offering a narrow or high-performance network plan.", {2023: 30, 2024: 33, 2025: 35}),
    ("hsa_employer_contrib_single", "USD", "Contribution", "level", "Average employer HSA contribution for single coverage, per year.", {2023: 600, 2024: 615, 2025: 625}),
    ("pcp_copay", "USD", "Plan design", "level", "Average PPO primary-care copay.", {2023: 28, 2024: 29, 2025: 30}),
    ("specialist_copay", "USD", "Plan design", "level", "Average PPO specialist copay.", {2023: 50, 2024: 52, 2025: 55}),
    ("er_copay", "USD", "Plan design", "level", "Average PPO emergency room copay.", {2023: 250, 2024: 260, 2025: 275}),
    ("spousal_surcharge_pct", "%", "Contribution", "prev", "Percent of employers charging a spousal surcharge.", {2023: 18, 2024: 19, 2025: 20}),
    ("glp1_weight_loss_pct", "%", "Rx", "prev", "Percent of employers covering GLP-1 drugs for weight loss.", {2023: 41, 2024: 44, 2025: 49}),
    ("specialty_rx_share_pct", "%", "Rx", "level", "Specialty drugs as a percent of total Rx cost.", {2023: 50, 2024: 52, 2025: 54}),
    ("generic_dispensing_rate_pct", "%", "Rx", "level", "Generic fills as a percent of all fills.", {2023: 88, 2024: 88.5, 2025: 89}),
    ("telehealth_offered_pct", "%", "Programs", "prev", "Percent of employers offering telehealth.", {2023: 92, 2024: 93, 2025: 94}),
    ("diabetes_program_pct", "%", "Programs", "prev", "Percent of employers offering a diabetes management program.", {2023: 28, 2024: 30, 2025: 32}),
    ("msk_program_pct", "%", "Programs", "prev", "Percent of employers offering a musculoskeletal program.", {2023: 24, 2024: 26, 2025: 28}),
    ("fertility_benefit_pct", "%", "Programs", "prev", "Percent of employers offering a fertility benefit.", {2023: 19, 2024: 21, 2025: 23}),
    ("navigation_pct", "%", "Programs", "prev", "Percent of employers offering navigation or advocacy.", {2023: 45, 2024: 49, 2025: 52}),
    ("pbm_alternative_considering_pct", "%", "Strategy", "prev", "Percent of large employers considering an alternative to a traditional PBM contract.", {2026: 61}),
    ("digital_mental_health_pct", "%", "Strategy", "prev", "Percent of large employers offering digital mental health support.", {2026: 76}),
    ("plan_cost_cutting_pct", "%", "Strategy", "prev", "Percent of employers planning cost-cutting plan changes.", {2026: 59}),
    ("std_incidence_per_100", "per 100", "LAD", "level", "New STD claims per 100 covered employees per year.", {2024: 7.4}),
    ("std_avg_duration_days", "days", "LAD", "level", "Average STD claim duration in days.", {2024: 52}),
    ("leave_admin_outsourced_pct", "%", "LAD", "prev", "Percent of employers outsourcing or co-sourcing leave administration.", {2024: 48}),
    ("paid_parental_leave_weeks", "weeks", "LAD", "level", "Average employer-paid parental leave, weeks.", {2024: 8}),
    ("ltd_incidence_per_1000", "per 1,000", "LAD", "level", "New LTD claims per 1,000 covered lives per year.", {2025: 4.03}),
    ("ltd_avg_duration_months", "months", "LAD", "level", "Average LTD claim duration in months.", {2025: 34}),
]
SOURCES = [("NS-2023", "Mercer National Survey (synthetic)", "Mercer", 2023, "Jun–Aug 2023", 2210),
           ("NS-2024", "Mercer National Survey (synthetic)", "Mercer", 2024, "Jun 12–Aug 16 2024", 2194),
           ("NS-2025", "Mercer National Survey (synthetic)", "Mercer", 2025, "Jun 10–Aug 15 2025", 2010),
           ("NS-2026P", "Mercer National Survey (synthetic)", "Mercer", 2026, "Jun–Aug 2025 (2026 projection)", 1950),
           ("NS-2027P", "Mercer National Survey (synthetic)", "Mercer", 2027, "Jun–Aug 10 2026 (preliminary 2027 projection)", 1800),
           ("STRAT-2026", "Mercer Survey on Health & Benefit Strategies (synthetic)", "Mercer", 2026, "Apr 2025", 711),
           ("ABS-2024", "Mercer Absence & Disability Survey (synthetic)", "Mercer", 2024, "Jan–Mar 2024", 630),
           ("SOA-LTD-2025", "SOA Group LTD Incidence Study (synthetic)", "Society of Actuaries", 2025, "Experience 2015–2022", 17)]


def _benchmarks(g):
    rng = g.rng
    notes = {"NS-2023": "Mean cost per employee for All 500+ is the published figure; percentiles and splits are synthetic.",
             "NS-2024": "Published mean and respondent count; percentiles and splits are synthetic.",
             "NS-2025": "Published means (cost, PPO/HDHP deductibles and contributions); splits are synthetic.",
             "NS-2026P": "Projected 2026 increase (6.7% after changes) is published; cost and splits are derived or synthetic.",
             "NS-2027P": "Preliminary 2027 increase (8.2% after changes) is published; splits are synthetic.",
             "STRAT-2026": "Headline percentages are published; splits are synthetic.",
             "ABS-2024": "Respondent count is published; values and splits are synthetic.",
             "SOA-LTD-2025": "Average LTD incidence (4.03 per 1,000) follows the published study; splits are synthetic."}
    for sid, name, pub, yr, fielded, resp in SOURCES:
        g.add("benchmark_sources", source_id=sid, name=name, publisher=pub, survey_year=yr, fielded=fielded,
              respondents=resp, notes=notes[sid])
    for m, unit, dom, _k, defin, _v in MEASURES:
        g.add("benchmark_measures", measure=m, unit=unit, domain=dom, definition=defin)
    # peer groups
    groups = [("All 500+", "All", "All", "Any")]
    groups += [(b, "All", "All", "Any") for b in SIZE_BANDS]
    groups += [("All 500+", r, "All", "Any") for r in REGION_COST]
    groups += [("All 500+", "All", i, "Any") for i in INDUSTRIES]
    groups += [("All 500+", "All", "All", "Union")]
    groups += [("All 500+", r, i, "Any") for r in REGION_COST for i in INDUSTRIES]
    groups += [(b, r, "All", "Any") for b in SIZE_BANDS for r in REGION_COST]
    groups += [("1,000–4,999", r, i, "Any") for r in REGION_COST for i in INDUSTRIES]
    groups += [("All 500+", r, "All", "Union") for r in REGION_COST]
    groups += [(b, "All", "All", "Union") for b in SIZE_BANDS[3:]]
    pgs = []
    for k, (b, r, i, u) in enumerate(groups, 1):
        pid = f"PG-{k:03d}"
        parts = ([] if i == "All" else [i]) + ([] if r == "All" else [r]) + \
                (["All employers 500+"] if b == "All 500+" and i == "All" and r == "All" else
                 [] if b == "All 500+" else [b]) + ([] if u == "Any" else ["Union"])
        label = " · ".join(parts) if parts else "All employers 500+"
        g.add("peer_groups", peer_group_id=pid, label=label, size_band=b, region=r, industry=i, union_status=u)
        pgs.append((pid, b, r, i, u))
    g.peer_groups = pgs
    meas = {m[0]: m for m in MEASURES}
    plan = [("NS-2023", 2023, [m[0] for m in MEASURES[:31]]), ("NS-2024", 2024, [m[0] for m in MEASURES[:31]]),
            ("NS-2025", 2025, [m[0] for m in MEASURES[:31]]),
            ("NS-2026P", 2026, ["cost_per_employee", "cost_increase_pct"]),
            ("NS-2027P", 2027, ["cost_per_employee", "cost_increase_pct"]),
            ("STRAT-2026", 2026, ["pbm_alternative_considering_pct", "digital_mental_health_pct", "plan_cost_cutting_pct"]),
            ("ABS-2024", 2024, ["std_incidence_per_100", "std_avg_duration_days", "leave_admin_outsourced_pct",
                                "paid_parental_leave_weeks"]),
            ("SOA-LTD-2025", 2025, ["ltd_incidence_per_1000", "ltd_avg_duration_months"])]
    special_means = {("NS-2026P", "cost_per_employee"): 18668.0, ("NS-2026P", "cost_increase_pct"): 6.7,
                     ("NS-2027P", "cost_per_employee"): 20199.0, ("NS-2027P", "cost_increase_pct"): 8.2}
    resp = {s[0]: s[5] for s in SOURCES}
    for sid, yr, mlist in plan:
        for mname in mlist:
            _, unit, dom, kind, _d, means = meas[mname]
            nat = special_means.get((sid, mname), means.get(yr))
            for pid, b, r, i, u in pgs:
                share = (1 if b == "All 500+" else SIZE_SHARE[b]) * (1 if r == "All" else REGION_SHARE[r]) * \
                        (1 if i == "All" else IND_SHARE[i]) * (1 if u == "Any" else 0.14)
                n = int(round(resp[sid] * share * rng.uniform(0.9, 1.1))) if pid != "PG-001" else resp[sid]
                total_cut = pid == "PG-001"
                if kind == "cost":
                    f = (1 if b == "All 500+" else SIZE_COST[b]) * (1 if r == "All" else REGION_COST[r]) * \
                        (1 if i == "All" else IND_COST[i]) * (1 if u == "Any" else 1.08)
                    mean = nat if total_cut else nat * f * rng.uniform(0.98, 1.02)
                    p25, p50, p75 = mean * rng.uniform(0.81, 0.83), mean * rng.uniform(0.96, 0.98), mean * rng.uniform(1.14, 1.16)
                elif kind == "trend":
                    mean = nat if total_cut else nat + rng.uniform(-0.9, 0.9)
                    p25, p50, p75 = mean - rng.uniform(2.3, 2.8), mean - rng.uniform(0.1, 0.3), mean + rng.uniform(2.1, 2.6)
                elif kind == "level":
                    small = b in ("10–49", "50–199", "200–499")
                    f = (1.35 if small and "deductible" in mname else 1.0)
                    mean = nat if total_cut else nat * f * rng.uniform(0.92, 1.08)
                    p25, p50, p75 = mean * 0.7, mean * 0.97, mean * 1.3
                else:
                    big = b in ("10,000–19,999", "20,000+")
                    mean = nat if total_cut else min(99.0, nat * (1.2 if big else 1.0) * rng.uniform(0.85, 1.15))
                    p25 = p50 = p75 = None
                if (sid, pid, mname) == ("NS-2023", "PG-001", "cost_per_employee"):
                    p25, p50, p75 = 12900, 15350, 18100
                elif (sid, pid, mname) == ("NS-2024", "PG-001", "cost_per_employee"):
                    p25, p50, p75 = 13500, 16050, 18950
                elif (sid, pid, mname) == ("NS-2025", "PG-001", "cost_per_employee"):
                    p25, p50, p75 = 14300, 17000, 20100
                elif (sid, pid, mname) == ("NS-2026P", "PG-001", "cost_increase_pct"):
                    p25, p50, p75 = 4.1, 6.5, 9.0
                if (sid, mname) == ("NS-2025", "cost_per_employee") and (b, r, i, u) == \
                        ("1,000–4,999", "Midwest", "Manufacturing", "Any"):
                    p25, p50, p75, mean, n = 13600, 16400, 19200, 16820, 74
                rnd = (lambda v: None if v is None else round(float(v), 2))
                g.add("benchmark_values", source_id=sid, peer_group_id=pid, measure=mname, p25=rnd(p25),
                      p50=rnd(p50), p75=rnd(p75), mean=rnd(mean), n=n if n >= 10 else None)
    # trend assumptions
    tr = {"Medical": [5.0, 5.2, 6.0, 6.5, 7.5, 7.0, 6.5, 6.0, 5.5, 5.0],
          "Rx": [8.4, 7.7, 9.4, 9.0, 9.0, 8.5, 8.0, 7.5, 7.0, 6.5],
          "Dental": [3.0, 3.2, 3.5, 3.8, 4.0, 4.0, 3.8, 3.5, 3.5, 3.5]}
    for k, y in enumerate(range(2023, 2033)):
        src = {2023: "NS-2023", 2024: "NS-2024", 2025: "NS-2025", 2026: "NS-2026P"}.get(y, "NS-2027P")
        for line in ("Medical", "Rx", "Dental"):
            g.add("trend_assumptions", projection_year=y, line_of_coverage=line, trend_pct=tr[line][k],
                  basis="Actual" if y <= 2025 else "Projected", source_id=src)


# ---------------------------------------------------------- 05 surveys ---
AREAS = ["Medical", "Rx", "Dental", "Vision", "Life", "Disability", "Leave", "Retirement", "Wellbeing", "Voluntary"]
IMPORTANCE = dict(zip(AREAS, [4.6, 4.3, 4.0, 3.6, 3.5, 3.6, 3.9, 4.4, 3.4, 2.9]))
SATISFACTION = dict(zip(AREAS, [3.7, 3.3, 3.9, 4.0, 3.7, 3.5, 3.4, 3.8, 3.5, 3.4]))
AREA_LABEL = {"Medical": "medical plan", "Rx": "prescription drug coverage", "Dental": "dental plan",
              "Vision": "vision plan", "Life": "life insurance", "Disability": "disability coverage",
              "Leave": "paid leave", "Retirement": "retirement plan", "Wellbeing": "wellbeing programs",
              "Voluntary": "voluntary benefits"}
LIKERT = ["I understand how my benefits work.", "My benefits are worth what I pay for them.",
          "My benefits meet the needs of my family.", "I can easily find information about my benefits.",
          "My benefits are a reason I stay with this employer.", "I can afford the care I need."]
OPEN = [("Medical", "What one change would most improve your medical plan?"),
        ("Rx", "Tell us about your experience with prescription drug coverage."),
        ("Wellbeing", "Which wellbeing support would you use most?"),
        ("Overall", "Is there anything else you would like to tell us about your benefits?")]
COMMENT_TEXT = {
    ("Cost", "Negative"): ["The {a} costs too much out of my paycheck.", "My deductible went up again and I put off care.",
                           "Paying full price until the deductible is met is hard for my family."],
    ("Cost", "Neutral"): ["I would like a cheaper {a} option even with fewer extras.", "Please show what each option costs for a typical year."],
    ("Cost", "Positive"): ["The HSA contribution from the company really helps.", "The {a} is affordable for what it covers."],
    ("Access", "Negative"): ["It takes weeks to get an appointment in network.", "There are no in-network specialists near me."],
    ("Access", "Positive"): ["Telehealth visits have been quick and easy.", "I found a good doctor close to home."],
    ("Choice", "Neutral"): ["More plan choices would help people with different needs.", "I would like an option with a narrower network and lower cost."],
    ("Communication", "Negative"): ["I never know what is covered until I get the bill.", "The open enrollment guide is confusing."],
    ("Communication", "Positive"): ["The benefits webinar explained my options well."],
    ("Service", "Negative"): ["Customer service could not answer my claim question.", "My prior authorization took far too long."],
    ("Service", "Positive"): ["The care navigator saved me a lot of time."],
    ("Network", "Negative"): ["My children's doctor left the network this year."],
    ("Coverage", "Negative"): ["My weight-loss medication is no longer covered without extra steps.", "Specialty drugs cost me hundreds a month."],
    ("Coverage", "Positive"): ["Fertility coverage made a huge difference for us.", "I am glad GLP-1 medications are covered."],
    ("Wellbeing", "Neutral"): ["A mental health app would be useful.", "I would use a fitness or gym subsidy."],
    ("Wellbeing", "Positive"): ["The counseling sessions through the EAP helped me a lot."]}
SURVEYS = [("C017", 2024, None), ("C017", 2026, ("C017", 2024)), ("C012", 2024, None), ("C012", 2026, ("C012", 2024)),
           ("C023", 2025, None), ("C044", 2025, None), ("C029", 2023, None), ("C029", 2025, ("C029", 2023)),
           ("C005", 2026, None), ("C051", 2025, None), ("C031", 2024, None), ("C031", 2026, ("C031", 2024)),
           ("C002", 2025, None), ("C040", 2026, None)]
SMALL_N = ("SV-C044-2025", "Executive", 7)


def _surveys(g):
    rng = g.rng
    for cid, y, prev in SURVEYS:
        cl = g.client_by_id[cid]
        sid = f"SV-{cid}-{y}"
        n = rng.randint(220, 380)
        invited = int(n / rng.uniform(0.35, 0.65))
        fs = date(y, rng.choice([3, 4, 5]), rng.randint(1, 15))
        g.add("surveys", survey_id=sid, client_id=cid, name=f"{y} Benefits Pulse", field_start=fs,
              field_end=fs + timedelta(days=rng.randint(14, 28)), invited_count=invited,
              previous_survey_id=f"SV-{prev[0]}-{prev[1]}" if prev else None)
        qs = []
        qn = 0
        for a in AREAS:
            for qt in ("Importance", "Satisfaction"):
                qn += 1
                text = (f"How important is your {AREA_LABEL[a]} to you?" if qt == "Importance" else
                        f"How satisfied are you with your {AREA_LABEL[a]}?")
                qs.append((f"{sid}-Q{qn:02d}", a, qt))
                g.add("survey_questions", question_id=qs[-1][0], survey_id=sid, question_no=qn, benefit_area=a,
                      question_type=qt, question_text=text)
        for text in LIKERT:
            qn += 1
            qs.append((f"{sid}-Q{qn:02d}", "Overall", "Likert"))
            g.add("survey_questions", question_id=qs[-1][0], survey_id=sid, question_no=qn, benefit_area="Overall",
                  question_type="Likert", question_text=text)
        opens = []
        for a, text in OPEN:
            qn += 1
            opens.append((f"{sid}-Q{qn:02d}", a))
            g.add("survey_questions", question_id=opens[-1][0], survey_id=sid, question_no=qn, benefit_area=a,
                  question_type="Open", question_text=text)
        # job-level quotas keep every group >= 10 except the planted one
        execs = SMALL_N[2] if sid == SMALL_N[0] else max(12, int(n * 0.04))
        mgr = int(n * 0.15)
        hourly_share = 0.55 if cl["industry"] in ("Healthcare", "Retail", "Transportation", "Manufacturing") else 0.15
        hourly = int((n - execs - mgr) * hourly_share)
        levels = ["Executive"] * execs + ["Manager"] * mgr + ["Hourly"] * hourly + \
                 ["Salaried"] * (n - execs - mgr - hourly)
        rng.shuffle(levels)
        states = cl["states"]
        for k, lvl in enumerate(levels, 1):
            rid = f"{sid}-R{k:04d}"
            pt = g.wpick([("PPO", 48), ("HDHP/HSA", 30), ("HMO", 10), ("Waived", 12)])
            tier = "Waived" if pt == "Waived" else g.wpick([("EE", 42), ("EE+SP", 20), ("EE+CH", 15), ("FAM", 23)])
            g.add("survey_respondents", respondent_id=rid, survey_id=sid, location_state=rng.choice(states),
                  job_level=lvl, tenure_band=g.wpick([("<1 yr", 12), ("1-4 yrs", 38), ("5-9 yrs", 25), ("10+ yrs", 25)]),
                  coverage_tier=tier, medical_plan_type=pt,
                  generation=g.wpick([("Gen Z", 14), ("Millennial", 40), ("Gen X", 32), ("Boomer", 14)]))
            for qid, a, qt in qs:
                if rng.random() < 0.08 or (pt == "Waived" and a in ("Medical", "Rx") and qt == "Satisfaction"):
                    continue
                if qt == "Importance":
                    mu = IMPORTANCE[a]
                elif qt == "Satisfaction":
                    mu = SATISFACTION[a] - (0.8 if pt == "HDHP/HSA" and a == "Medical" else 0) - \
                         (0.3 if pt == "HDHP/HSA" and a == "Rx" else 0) + 0.05 * (y - 2024)
                else:
                    mu = 3.5 - (0.4 if pt == "HDHP/HSA" and "afford" in LIKERT[int(qid[-2:]) - 21] else 0)
                score = int(round(rng.gauss(mu, 0.85)))
                g.add("survey_responses", respondent_id=rid, question_id=qid, score=min(5, max(1, score)))
            for ck in range(1, g.wpick([(0, 40), (1, 45), (2, 15)]) + 1):
                qid, a = rng.choice(opens)
                theme = g.wpick({"Medical": [("Cost", 40), ("Access", 20), ("Network", 10), ("Communication", 15),
                                             ("Choice", 15)],
                                 "Rx": [("Cost", 40), ("Coverage", 40), ("Service", 20)],
                                 "Wellbeing": [("Wellbeing", 80), ("Communication", 20)],
                                 "Overall": [("Communication", 30), ("Service", 20), ("Choice", 20), ("Cost", 30)]}[a])
                opts = [k for k in COMMENT_TEXT if k[0] == theme]
                key = rng.choice(opts)
                if pt == "HDHP/HSA" and theme == "Cost" and ("Cost", "Negative") in COMMENT_TEXT:
                    key = ("Cost", "Negative") if rng.random() < 0.7 else key
                text = rng.choice(COMMENT_TEXT[key]).format(a=AREA_LABEL.get(a, "benefits"))
                g.add("survey_comments", comment_id=f"{rid}-C{ck}",
                      respondent_id=rid, question_id=qid, benefit_area=a, comment_text=text, theme=key[0],
                      sentiment=key[1])
    for a in AREAS:
        for meas in ("importance_mean", "satisfaction_mean", "top2_satisfaction_pct"):
            for y in (2023, 2024, 2025, 2026):
                if meas == "importance_mean":
                    v = IMPORTANCE[a] + rng.uniform(-0.1, 0.1)
                elif meas == "satisfaction_mean":
                    v = SATISFACTION[a] + 0.1 + rng.uniform(-0.1, 0.1)
                else:
                    v = (SATISFACTION[a] - 1) / 4 * 100 * rng.uniform(0.95, 1.05)
                g.add("survey_norms", benefit_area=a, measure=meas, norm_year=y, value=round(v, 2))


# --------------------------------------------------------- 07 strategy ---
GOALS = ["Control cost", "Affordability for low earners", "Attract & retain", "Simplify", "Health outcomes"]
LEVERS = [("Plan design", ["Raise PPO deductible by $250", "Add an HDHP/HSA option", "Variable-copay plan",
                           "Raise out-of-pocket maximum"], (0.01, 0.03), ["Medium", "High"], ["Low"], "Control cost"),
          ("Contribution", ["Contribution shift (+5 pts EE share)", "Salary-banded contributions", "Spousal surcharge"],
           (0.01, 0.025), ["High", "Medium"], ["Low"], "Control cost"),
          ("PBM carve-out", ["PBM carve-out", "Transparent pass-through PBM"], (0.02, 0.04), ["Low"], ["Medium"],
           "Control cost"),
          ("GLP-1 policy", ["GLP-1 weight-loss criteria", "Drop GLP-1 weight-loss coverage",
                            "GLP-1 lifestyle program requirement"], (0.008, 0.02), ["Medium", "High"], ["Medium"],
           "Control cost"),
          ("Centres of excellence", ["Spine & joint centre of excellence", "Cancer centre of excellence",
                                     "Bariatric centre of excellence"], (0.003, 0.01), ["Low"], ["Low"],
           "Health outcomes"),
          ("Narrow network", ["High-performance network option", "Narrow network EPO"], (0.02, 0.05),
           ["Medium", "High"], ["Medium", "High"], "Control cost"),
          ("Point solution", ["Diabetes management program", "Virtual MSK program", "Fertility benefit"],
           (0.002, 0.008), ["Low"], ["Low"], "Health outcomes"),
          ("Navigation", ["Care navigation & advocacy", "Second-opinion service"], (0.004, 0.01), ["Low"], ["Low"],
           "Simplify")]
POINT_SOLUTIONS = [("Glyca Health", "Glyca Diabetes Coaching", "Diabetes"), ("Sugarline", "Sugarline CGM Program", "Diabetes"),
                   ("Betacell Care", "Betacell Prevention", "Diabetes"), ("Insulyn Path", "Insulyn Virtual Clinic", "Diabetes"),
                   ("Flexwell", "Flexwell Digital PT", "MSK"), ("Spineward", "Spineward Back Care", "MSK"),
                   ("Jointwise", "Jointwise Surgery Navigation", "MSK"), ("Motiq", "Motiq MSK Coaching", "MSK"),
                   ("Nestbloom", "Nestbloom Fertility", "Fertility"), ("Cradlepath", "Cradlepath Family Building", "Fertility"),
                   ("Ovara Health", "Ovara IVF Network", "Fertility"), ("Kindred Seed", "Kindred Seed Maternity", "Fertility"),
                   ("Calmharbor", "Calmharbor Therapy", "Mental health"), ("Mindstead", "Mindstead EAP+", "Mental health"),
                   ("Thrivenote", "Thrivenote Coaching", "Mental health"), ("Serene Circuit", "Serene Circuit Psychiatry", "Mental health"),
                   ("Waymark Advocates", "Waymark Advocacy", "Navigation"), ("Quillbay Health", "Quillbay Navigation", "Navigation"),
                   ("Pathlight Care", "Pathlight Second Opinion", "Navigation"), ("Northarrow", "Northarrow Concierge", "Navigation"),
                   ("Doorstep MD", "Doorstep Virtual Primary Care", "Virtual primary care"),
                   ("Clinic Anywhere", "Clinic Anywhere", "Virtual primary care"),
                   ("Primewell Virtual", "Primewell Virtual PCP", "Virtual primary care"),
                   ("Hearthside Health", "Hearthside Virtual Care", "Virtual primary care")]
FIXED_OPTIONS = {"SO-017-03": ("PBM carve-out", "PBM carve-out", 1850000.0, "Low", "Medium", 2027, "Adopted", "Control cost"),
                 "SO-017-05": ("GLP-1 policy", "GLP-1 weight-loss criteria", 920000.0, "Medium", "Medium", 2027, "Adopted", "Control cost"),
                 "SO-023-02": ("Contribution", "Contribution shift (+5 pts EE share)", 640000.0, "High", "Low", 2027, "Rejected", "Control cost")}


def _strategy(g):
    rng = g.rng
    goals_of = {}
    for cl in g.clients:
        gl = list(GOALS)
        rng.shuffle(gl)
        if cl["id"] in ("C017", "C023"):
            gl.remove("Control cost")
            gl.insert(0, "Control cost")
        goals_of[cl["id"]] = gl[:4]
        sy = rng.choice([2024, 2025, 2026])
        for k, goal in enumerate(gl[:4], 1):
            g.add("client_goals", client_id=cl["id"], goal=goal, rank=k, set_year=sy)
    g.options = []
    for cl in g.clients:
        cid = cl["id"]
        spend = cl["count"] * 17000
        nopt = rng.randint(7, 10)
        for k in range(1, nopt + 1):
            oid = f"SO-{cnum(cid)}-{k:02d}"
            if oid in FIXED_OPTIONS:
                lever, desc, sav, imp, risk, ey, status, goal = FIXED_OPTIONS[oid]
            else:
                lever, descs, (lo, hi), imps, risks, goal = rng.choice(LEVERS)
                desc = rng.choice(descs)
                sav = round(spend * rng.uniform(lo, hi), -3)
                imp, risk = rng.choice(imps), rng.choice(risks)
                ey = rng.choice([2024, 2025, 2026, 2027, 2027, 2028])
                if cl["rm"] == 7 and ey == 2027:
                    ey = 2028
                if ey <= 2026:
                    status = "Adopted" if rng.random() < 0.45 else "Rejected"
                elif ey == 2027:
                    status = g.wpick([("Adopted", 45), ("Rejected", 45), ("Proposed", 10)])
                else:
                    status = "Proposed"
                if goal not in goals_of[cid]:
                    goal = goals_of[cid][0]
                if cid == "C017" and lever in ("PBM carve-out", "GLP-1 policy"):
                    lever, desc, status = "Navigation", "Care navigation & advocacy", "Proposed"
                    ey = 2028
            g.add("strategy_options", option_id=oid, client_id=cid, lever=lever, description=desc,
                  est_savings_annual=float(sav), employee_impact=imp, risk=risk, effective_year=ey, status=status,
                  goal=goal)
            g.options.append((oid, cid, status, ey))
    by_sl = [c["id"] for c in g.colleagues if c["sl"] == "SL-STRAT" and c["role"] in ("Senior Consultant", "Principal")]
    for oid, cid, status, ey in g.options:
        if status != "Adopted":
            continue
        owner = rng.choice(by_sl)
        steps = [(ey - 1, 2, "Design approved by client"), (ey - 1, 3, "Vendor contracted and plan documents updated"),
                 (ey - 1, 4, "Open enrollment communication"), (ey, 1, "Go-live")]
        if rng.random() < 0.5:
            steps.append((ey, 4, "First-year results review"))
        for k, (yy, q, ms) in enumerate(steps, 1):
            qend = date(yy, q * 3, 28)
            qstart = date(yy, q * 3 - 2, 1)
            st = "Done" if qend < TODAY else ("In progress" if qstart <= TODAY else "Planned")
            g.add("roadmap_items", item_id=f"{oid}-M{k}", option_id=oid, year=yy, quarter=q, milestone=ms,
                  owner_colleague_id=owner, status=st)
    for k, (v, n, cat) in enumerate(POINT_SOLUTIONS, 1):
        pricing = "PEPM" if k % 3 else "Per engaged member"
        g.add("point_solutions", solution_id=f"PS-{k:02d}", vendor=v, solution_name=n, category=cat, pricing=pricing,
              list_fee=round(rng.uniform(1.5, 6.0) if pricing == "PEPM" else rng.uniform(40, 110), 2))
    ps_rows = g.rows["point_solutions"]
    for cl in g.clients:
        for r in rng.sample(ps_rows, 3):
            eng = round(rng.uniform(5, 35), 2)
            fee = r[5] * rng.uniform(0.8, 1.0) if r[4] == "PEPM" else r[5] * eng / 100
            g.add("client_point_solutions", client_id=cl["id"], solution_id=r[0],
                  start_date=g.rdate(date(2021, 1, 1), date(2026, 7, 1)).replace(day=1),
                  engagement_rate_pct=eng, fee_pepm=round(fee, 2))


# -------------------------------------------------------- 08 data feeds ---
def _feeds(g):
    rng = g.rng
    for cid in DEEP:
        plans = g.client_plans[(cid, 2026)]
        med_carrier = g.rows["plans"][[r[0] for r in g.rows["plans"]].index(plans[0]["id"])][COLIDX["plans"]["carrier_id"]]
        pbm = g.rows["plans"][[r[0] for r in g.rows["plans"]].index(plans[0]["id"])][COLIDX["plans"]["pbm_carrier_id"]]
        feeds = [("ELIG", "Eligibility", rng.choice(CARRIERS_BY_TYPE["Ben admin vendor"]), "Weekly"),
                 ("MED", "Medical claims", med_carrier, "Monthly"), ("RX", "Rx claims", pbm, "Monthly"),
                 ("DIS", "Disability", g.lad[(cid, 2026, "LTD")]["row"][COLIDX["lad_programs"]["carrier_id"]], "Monthly")]
        if (cid, 2026, "Leave administration") in g.lad:
            feeds.append(("LOA", "Leave",
                          g.lad[(cid, 2026, "Leave administration")]["row"][COLIDX["lad_programs"]["carrier_id"]],
                          "Monthly"))
        for code, ftype, carrier, cad in feeds:
            if cad == "Weekly":
                cov, rec, exp, late, st = date(2026, 10, 24), date(2026, 10, 27), date(2026, 11, 3), 0, "On time"
            else:
                cov = CLAIMS_END
                rec = date(2026, 10, rng.randint(10, 18))
                exp, late, st = date(2026, 11, 16), 0, "On time"
            if cid == LATE_FEED_CLIENT and code == "MED":
                cov, rec, exp, late, st = date(2026, 7, 31), date(2026, 8, 14), date(2026, 9, 16), 45, "Late"
            if cid == "C005" and code == "LOA":
                st = "Failed"
            g.add("data_feeds", feed_id=f"FD-{cid}-{code}", client_id=cid, carrier_id=carrier, feed_type=ftype,
                  cadence=cad, last_received=rec, covers_through=cov, expected_by=exp, days_late=late, status=st)


# ------------------------------------------- 01 engagements + revenue -----
def _revenue(g):
    rng = g.rng
    lines_p = [("SL-RX", 0.6), ("SL-LAD", 0.55), ("SL-COMP", 0.6), ("SL-VOL", 0.3), ("SL-WELL", 0.3),
               ("SL-DATA", 0.35), ("SL-RB", 0.4), ("SL-GBM", 0.1), ("SL-SPEC", 0.15)]
    by_sl = {}
    for col in g.colleagues:
        by_sl.setdefault(col["sl"], []).append(col)
    deliver_types = {"SL-STRAT": ["Renewal report", "Benchmark report", "Strategy roadmap"],
                     "SL-ACT": ["Cost projection", "Plan modeling"], "SL-RX": ["PBM audit", "RFP"],
                     "SL-LAD": ["RFP"], "SL-COMP": ["Compliance review"], "SL-VOL": ["RFP"],
                     "SL-WELL": ["Survey report"], "SL-DATA": ["Claims dashboard"], "SL-RB": ["Benchmark report"],
                     "SL-GBM": ["Benchmark report"], "SL-SPEC": ["Plan modeling"]}
    dl_no = 0
    months = [date(y, m, 1) for y in range(2023, 2027) for m in range(1, 13) if date(y, m, 1) <= date(2026, 10, 1)]
    for cl in g.clients:
        cid = cl["id"]
        f2026 = g.funding[(cid, 2026)]
        lines = ["SL-STRAT"] + (["SL-ACT"] if f2026 in ("Self-funded", "Level-funded") else [])
        for sl, p in lines_p:
            if sl == "SL-DATA" and cl["deep"]:
                lines.append(sl)
            elif sl == "SL-GBM" and cl["segment"] != "Jumbo":
                continue
            elif g.chance(p):
                lines.append(sl)
        for sl in lines:
            if sl == "SL-STRAT":
                basis = "Commission" if f2026 != "Self-funded" else "Retainer"
            elif sl in ("SL-LAD", "SL-VOL"):
                basis = "Commission"
            elif sl in ("SL-ACT", "SL-COMP", "SL-DATA", "SL-GBM"):
                basis = "Retainer"
            else:
                basis = "Project fee"
            pool = [c for c in by_sl.get(sl, []) if c["role"] not in ("Analyst", "Associate")] or by_sl["SL-STRAT"]
            local = [c for c in pool if c["office"] == g.rows["clients"][cl["num"] - 1][COLIDX["clients"]["office_id"]]]
            lead = rng.choice(local or pool)["id"]
            if basis == "Project fee":
                start = g.rdate(date(2023, 1, 1), date(2026, 6, 30)).replace(day=1)
                end = start + timedelta(days=rng.randint(90, 300))
            else:
                start = date(max(cl["since"], 2015) if sl == "SL-STRAT" else rng.randint(2016, 2025), 1, 1)
                end = g.rdate(date(2024, 3, 1), date(2026, 9, 30)) if g.chance(0.12) else None
            status = "Completed" if end and end <= TODAY else "Active"
            eid = f"ENG-{cid}-{sl[3:]}"
            g.add("engagements", engagement_id=eid, client_id=cid, service_line_id=sl, lead_colleague_id=lead,
                  fee_basis=basis, start_date=start, end_date=end, status=status)
            cnt = cl["count"]
            if basis == "Commission":
                monthly = cnt * {"SL-STRAT": rng.uniform(3.0, 4.5), "SL-LAD": rng.uniform(0.8, 1.5),
                                 "SL-VOL": rng.uniform(0.4, 0.9)}[sl]
            elif basis == "Retainer":
                annual = {"SL-STRAT": cnt * rng.uniform(9, 18), "SL-ACT": cnt * rng.uniform(4, 9),
                          "SL-COMP": rng.uniform(30000, 90000), "SL-DATA": rng.uniform(60000, 180000),
                          "SL-GBM": rng.uniform(80000, 220000)}[sl]
                monthly = annual / 12
            else:
                total = rng.uniform(40000, 260000)
            active = [m for m in months if m >= start.replace(day=1) and (end is None or m <= end)]
            if basis == "Project fee":
                ms = sorted(rng.sample(active, min(len(active), rng.randint(2, 4)))) if active else []
                for m in ms:
                    g.add("revenue", engagement_id=eid, period_month=m, revenue_type="Fee",
                          amount_usd=round(total / len(ms), 2))
            else:
                for m in active:
                    amt = monthly * (1.06 ** (m.year - 2023 + (m.month - 1) / 12)) * rng.uniform(0.98, 1.02)
                    g.add("revenue", engagement_id=eid, period_month=m,
                          revenue_type="Commission" if basis == "Commission" else "Fee", amount_usd=round(amt, 2))
                    if basis == "Commission" and m.month == 3:
                        g.add("revenue", engagement_id=eid, period_month=m, revenue_type="Supplemental comp",
                              amount_usd=round(amt * 12 * rng.uniform(0.02, 0.05), 2))
            # deliverables
            for y in range(2023, 2027):
                ys, ye = date(y, 1, 1), date(y, 12, 31)
                if start > ye or (end and end < ys):
                    continue
                for dt in deliver_types[sl]:
                    if basis == "Project fee" and dt != deliver_types[sl][0]:
                        continue
                    if rng.random() < 0.2 and sl != "SL-STRAT":
                        continue
                    lo, hi = max(ys, start), min(ye, end) if end else ye
                    if lo > hi:
                        continue
                    if dt == "Renewal report":
                        due = date(y, 7 if cl["rm"] == 1 else 1, rng.randint(1, 28))
                    else:
                        due = g.rdate(lo, hi)
                    if due <= TODAY:
                        if rng.random() < 0.02:
                            dd = None
                        elif rng.random() < 0.14:
                            dd = due + timedelta(days=rng.randint(2, 30))
                        else:
                            dd = due - timedelta(days=rng.randint(0, 10))
                        if dd and dd > TODAY:
                            dd = None
                    else:
                        dd = None
                    dl_no += 1
                    g.add("deliverables", deliverable_id=f"DL-{dl_no:05d}", engagement_id=eid, deliverable_type=dt,
                          title=f"{cl['name']} {y} {dt.lower()}", due_date=due, delivered_date=dd)


# ------------------------------------------------------------------ output -
def q(text):
    return "'" + str(text).replace("'", "''") + "'"


def lit(v, typ):
    if v is None:
        return "NULL"
    if typ in ("money", "pct", "num"):
        return f"{v:.2f}"
    if typ == "rate":
        return f"{v:.4f}"
    if typ == "int":
        return str(int(v))
    if typ == "bool":
        return "true" if v else "false"
    if typ == "date":
        return "'" + v.isoformat() + "'"
    return q(v)


def fk_list():
    out = []
    for t in TABLES:
        for name, _typ, _cmt, ref in t["cols"]:
            if ref:
                rt, rc = ref.split(".")
                out.append((t["name"], name, rt, rc, f"fk_{t['name']}_{name}"[:63]))
    return out


def render(rows):
    """Render the seed SQL text from build() output."""
    out = []
    w = out.append
    w("-- US Health (Mercer US Health & Benefits) data model: PostgreSQL schema + synthetic data.")
    w("-- Generated by scripts/generate-us-health-seed.py; do not edit by hand. All data is synthetic;")
    w("-- the dataset's today is 2026-10-31.")
    w(f"DROP SCHEMA IF EXISTS {S} CASCADE;")
    w(f"CREATE SCHEMA {S};")
    w(f"COMMENT ON SCHEMA {S} IS {q('Synthetic Mercer US Health & Benefits model: firm and clients, benefit programs, members and claims, benchmarks, employee surveys, life/absence/disability, strategy and data feeds. Dataset today = 2026-10-31.')};")
    for t in TABLES:
        n = t["name"]
        lines = [f"  {cn} {SQLTYPE[typ]}" + (" NOT NULL" if cn in t["pk"] else "") for cn, typ, _c, _r in t["cols"]]
        lines.append(f"  PRIMARY KEY ({', '.join(t['pk'])})")
        w(f"CREATE TABLE {S}.{n} (\n" + ",\n".join(lines) + "\n);")
        w(f"COMMENT ON TABLE {S}.{n} IS {q(t['comment'])};")
        for cn, _typ, cmt, _r in t["cols"]:
            w(f"COMMENT ON COLUMN {S}.{n}.{cn} IS {q(cmt)};")
    for t in TABLES:
        n = t["name"]
        types = TYPES[n]
        head = f"INSERT INTO {S}.{n} ({', '.join(COLS[n])}) VALUES\n"
        data = rows[n]
        for i in range(0, len(data), 500):
            vals = ",\n".join("(" + ",".join(lit(v, types[j]) for j, v in enumerate(r)) + ")" for r in data[i:i + 500])
            w(head + vals + ";")
    names = set()
    for tn, cn, rt, rc, fk in fk_list():
        assert fk not in names, fk
        names.add(fk)
        w(f'ALTER TABLE {S}.{tn} ADD CONSTRAINT "{fk}" FOREIGN KEY ({cn}) REFERENCES {S}.{rt} ({rc});')
        w(f"CREATE INDEX ON {S}.{tn} ({cn});")
    w(f"CREATE INDEX ON {S}.medical_claims (service_date);")
    w(f"CREATE INDEX ON {S}.rx_claims (fill_date);")
    for vname, vcomment, vcols, body in VIEWS:
        w(f"CREATE VIEW {S}.{vname} AS\n{body};")
        w(f"COMMENT ON VIEW {S}.{vname} IS {q(vcomment)};")
        for cn, cmt in vcols:
            w(f"COMMENT ON COLUMN {S}.{vname}.{cn} IS {q(cmt)};")
    w(f"ANALYZE {S}.medical_claims;")
    w(f"ANALYZE {S}.rx_claims;")
    return "\n".join(out) + "\n"


def gzip_bytes(sql):
    buf = io.BytesIO()
    # mtime=0 and no embedded file name keep the gzip byte-identical across runs.
    with gzip.GzipFile(filename="", mode="wb", fileobj=buf, mtime=0, compresslevel=9) as fh:
        fh.write(sql.encode("utf-8"))
    return buf.getvalue()


def main(argv):
    out = argv[1] if len(argv) > 1 else DEFAULT_OUT
    rows = build()
    data = gzip_bytes(render(rows))
    with open(out, "wb") as fh:
        fh.write(data)
    total = sum(len(v) for v in rows.values())
    print(f"tables={len(TABLES)} views={len(VIEWS)} rows={total} gz_bytes={len(data)}")
    for n in TNAME:
        print(f"  {n:24s} {len(rows[n]):7d}")


if __name__ == "__main__":
    main(sys.argv)
