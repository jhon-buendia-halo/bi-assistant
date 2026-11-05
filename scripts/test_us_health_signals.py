#!/usr/bin/env python3
"""Planted-signal tests for the US Health seed generator (story BA-306, epic BA-305).

Each test asserts one business fact the generator promises in its PLANTED docstring.
Offline and standard library only; run from the repo root:
    python3 -m unittest scripts/test_us_health_signals.py -v
    python3 scripts/test_us_health_signals.py
"""
import importlib.util
import os
import statistics
import unittest
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("gen_us_health", os.path.join(HERE, "generate-us-health-seed.py"))
gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gen)

_ROWS = None


def _client_of_plan(plan_id):
    """Plan ids are P-<client>-<year>-<line><n>, e.g. P-C017-2026-MED1."""
    return plan_id[2:6]


class _Base(unittest.TestCase):
    rows = None

    @classmethod
    def setUpClass(cls):
        global _ROWS
        if _ROWS is None:  # build() is slow: build once for the whole module
            _ROWS = gen.build()
        cls.rows = _ROWS

    def recs(self, table):
        """Rows of a table as dicts keyed by column name."""
        names = gen.COLS[table]
        return [dict(zip(names, r)) for r in self.rows[table]]


def _emp_client(rows):
    return {r[0]: r[gen.COLIDX["employees"]["client_id"]] for r in rows["employees"]}


class TestCostTrend(_Base):
    """Signal 1: deep-data cost per employee-month follows the market; 2027 renewals ~8%.

    Measure: per deep-data client, plan_paid of medical + Rx claims divided by employee-months (months whose
    15th falls inside an enrollment), excluding the planted NICU claimant, then the median across clients.
    Every month the feed covers is used (full years 2023-2025, Jan-Sep 2026): the generator calibrates each
    client-year in total, so slicing a complete year to Jan-Sep only adds sampling noise (up to +-3 points
    per client). The late-feed client is left out of 2026, whose Aug-Sep medical claims are thin by design.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        r = cls.rows
        mi, ri, ei = gen.COLIDX["medical_claims"], gen.COLIDX["rx_claims"], gen.COLIDX["enrollments"]
        # the planted claimant: Brightwater's NICU baby, first claim on the baby's birth date
        nicu_member = next(row[mi["member_id"]] for row in r["medical_claims"]
                           if row[mi["diagnosis_group"]] == "Neonatal / NICU"
                           and _client_of_plan(row[mi["plan_id"]]) == gen.NICU["client"]
                           and row[mi["service_date"]] == gen.NICU["birth"])
        cost = {}
        for row in r["medical_claims"]:
            sd = row[mi["service_date"]]
            if row[mi["member_id"]] == nicu_member or sd > gen.CLAIMS_END:
                continue
            k = (_client_of_plan(row[mi["plan_id"]]), sd.year)
            cost[k] = cost.get(k, 0.0) + float(row[mi["plan_paid"]])
        for row in r["rx_claims"]:
            fd = row[ri["fill_date"]]
            if row[ri["member_id"]] == nicu_member or fd > gen.CLAIMS_END:
                continue
            k = (_client_of_plan(row[ri["plan_id"]]), fd.year)
            cost[k] = cost.get(k, 0.0) + float(row[ri["plan_paid"]])
        emp_client = _emp_client(r)
        months = {}
        for row in r["enrollments"]:
            cid = emp_client[row[ei["employee_id"]]]
            for y in gen.YEARS_CLAIMS:
                n = gen.employee_months(row[ei["start_date"]], row[ei["end_date"]], y)
                if n:
                    months[(cid, y)] = months.get((cid, y), 0) + n
        cls.pmpm = {k: cost[k] / months[k] for k in cost if months.get(k)}

    def _median_growth(self, y0, y1):
        # the late-feed client's Aug-Sep 2026 medical months are thin by design
        clients = [c for c in gen.DEEP if not (y1 == 2026 and c == gen.LATE_FEED_CLIENT)]
        for c in clients:
            self.assertIn((c, y0), self.pmpm, f"{c} has no {y0} exposure or cost")
            self.assertIn((c, y1), self.pmpm, f"{c} has no {y1} exposure or cost")
        growth = [self.pmpm[(c, y1)] / self.pmpm[(c, y0)] - 1 for c in clients]
        return statistics.median(growth) * 100, {c: round(g * 100, 1) for c, g in zip(clients, growth)}

    def test_2023_to_2024_about_5_percent(self):
        g, per = self._median_growth(2023, 2024)
        self.assertTrue(4.0 <= g <= 6.0, f"median growth {g:.2f}% {per}")

    def test_2024_to_2025_about_6_percent(self):
        g, per = self._median_growth(2024, 2025)
        self.assertTrue(5.0 <= g <= 7.0, f"median growth {g:.2f}% {per}")

    def test_2025_to_2026_6_to_7_percent(self):
        g, per = self._median_growth(2025, 2026)
        self.assertTrue(6.0 <= g <= 7.0, f"median growth {g:.2f}% {per}")

    def test_2027_medical_renewals_average_about_8_percent(self):
        ren = [r for r in self.recs("renewals") if r["plan_year"] == 2027 and r["line_of_coverage"] == "Medical"
               and r["final_increase_pct"] is not None]
        self.assertGreaterEqual(len(ren), 5)
        mean = statistics.mean(float(r["final_increase_pct"]) for r in ren)
        self.assertTrue(7.0 <= mean <= 9.0, f"mean final increase {mean:.2f}% over {len(ren)} renewals")


class TestGlp1(_Base):
    """Signal 2: GLP-1 weight-loss coverage lifts Rx trend; Northgate adopts PBM carve-out and GLP-1 criteria."""

    def test_rx_trend_gap_between_covering_and_non_covering_clients(self):
        prov = {r["plan_id"]: r["glp1_weight_loss_covered"] for r in self.recs("plan_provisions")}
        covered = {}
        for p in self.recs("plans"):
            if p["client_id"] in gen.DEEP and p["line_of_coverage"] == "Medical":
                covered.setdefault(p["client_id"], set()).add(prov[p["plan_id"]] == "Yes")
        yes = {c for c, v in covered.items() if v == {True}}
        no = {c for c, v in covered.items() if v == {False}}
        self.assertTrue(yes and no, f"yes={yes} no={no} all={covered}")
        ri, ei = gen.COLIDX["rx_claims"], gen.COLIDX["enrollments"]
        paid = {}
        for row in self.rows["rx_claims"]:
            k = (_client_of_plan(row[ri["plan_id"]]), row[ri["fill_date"]].year)
            paid[k] = paid.get(k, 0.0) + float(row[ri["plan_paid"]])
        emp_client = _emp_client(self.rows)
        # Exposure is employee-months, the basis the generator calibrates Rx cost on. (Per covered member the
        # gap is 6.9 points because covered-member mix drifts between years: noise, not the planted signal.)
        mem = {}
        for row in self.rows["enrollments"]:
            cid = emp_client[row[ei["employee_id"]]]
            for y in (2024, 2025):
                mem[(cid, y)] = mem.get((cid, y), 0) + gen.employee_months(row[ei["start_date"]], row[ei["end_date"]], y)

        def trend(c):
            return (paid[(c, 2025)] / mem[(c, 2025)]) / (paid[(c, 2024)] / mem[(c, 2024)]) * 100 - 100

        t_yes = statistics.mean(trend(c) for c in yes)
        t_no = statistics.mean(trend(c) for c in no)
        self.assertTrue(4.0 <= t_yes - t_no <= 6.0, f"Rx plan_paid per employee-month 2024->2025, covering {t_yes:.2f}% vs not {t_no:.2f}%")

    def test_northgate_adopted_pbm_carveout_and_glp1_criteria_for_2027(self):
        opts = {r["option_id"]: r for r in self.recs("strategy_options")}
        for oid, lever in (("SO-017-03", "PBM carve-out"), ("SO-017-05", "GLP-1 policy")):
            o = opts[oid]
            self.assertEqual(o["client_id"], "C017")
            self.assertEqual(o["lever"], lever)
            self.assertEqual(o["status"], "Adopted")
            self.assertEqual(o["effective_year"], 2027)


class TestHdhp(_Base):
    """Signal 3: HDHP costs less per member-month than PPO but scores lower on medical satisfaction."""

    def test_hdhp_cheaper_per_member_month_than_ppo(self):
        ptype = {p["plan_id"]: p["plan_type"] for p in self.recs("plans")}
        mi, ei = gen.COLIDX["medical_claims"], gen.COLIDX["enrollments"]
        cost = {"PPO": 0.0, "HDHP/HSA": 0.0}
        for row in self.rows["medical_claims"]:
            t = ptype[row[mi["plan_id"]]]
            if row[mi["service_date"]] > gen.CLAIMS_END or row[mi["diagnosis_group"]] == "Neonatal / NICU":
                continue  # outside the exposure window; the planted NICU claimant is a Brightwater outlier
            if t in cost:
                cost[t] += float(row[mi["plan_paid"]])
        mm = {"PPO": 0, "HDHP/HSA": 0}
        for row in self.rows["enrollments"]:
            t = ptype[row[ei["plan_id"]]]
            if t in mm:
                n = sum(gen.employee_months(row[ei["start_date"]], row[ei["end_date"]], y) for y in gen.YEARS_CLAIMS)
                mm[t] += n * row[ei["covered_members"]]
        ppo, hdhp = cost["PPO"] / mm["PPO"], cost["HDHP/HSA"] / mm["HDHP/HSA"]
        self.assertLess(hdhp, ppo, f"HDHP {hdhp:.2f} vs PPO {ppo:.2f} per member-month")

    def test_hdhp_lower_medical_satisfaction_than_ppo(self):
        resp = {r["respondent_id"]: r["medical_plan_type"] for r in self.recs("survey_respondents")}
        q = {r["question_id"] for r in self.recs("survey_questions")
             if r["benefit_area"] == "Medical" and r["question_type"] == "Satisfaction"}
        scores = {"PPO": [], "HDHP/HSA": []}
        for r in self.recs("survey_responses"):
            if r["question_id"] in q and resp[r["respondent_id"]] in scores:
                scores[resp[r["respondent_id"]]].append(r["score"])
        self.assertGreater(len(scores["HDHP/HSA"]), 100)
        ppo, hdhp = statistics.mean(scores["PPO"]), statistics.mean(scores["HDHP/HSA"])
        self.assertLess(hdhp, ppo - 0.4, f"HDHP {hdhp:.2f} vs PPO {ppo:.2f}")


class TestBrightwaterNicu(_Base):
    """Signal 4: one 2025 claimant above $2M at Brightwater, above the stop-loss specific deductible."""

    def test_single_2025_claimant_over_2m_born_2025_above_deductible(self):
        mi, ri = gen.COLIDX["medical_claims"], gen.COLIDX["rx_claims"]
        paid = {}
        for row in self.rows["medical_claims"]:
            if _client_of_plan(row[mi["plan_id"]]) == "C023" and row[mi["service_date"]].year == 2025:
                paid[row[mi["member_id"]]] = paid.get(row[mi["member_id"]], 0.0) + float(row[mi["plan_paid"]])
        for row in self.rows["rx_claims"]:
            if _client_of_plan(row[ri["plan_id"]]) == "C023" and row[ri["fill_date"]].year == 2025:
                paid[row[ri["member_id"]]] = paid.get(row[ri["member_id"]], 0.0) + float(row[ri["plan_paid"]])
        big = [m for m, v in paid.items() if v > 2_000_000]
        self.assertEqual(len(big), 1, f"claimants over $2M: {big}")
        member = next(r for r in self.recs("members") if r["member_id"] == big[0])
        self.assertEqual(member["birth_year"], 2025)
        sl = next(r for r in self.recs("stop_loss_contracts") if r["client_id"] == "C023" and r["plan_year"] == 2025)
        self.assertGreater(paid[big[0]], float(sl["specific_deductible"]))


class TestHalvorsenDisability(_Base):
    """Signal 5: Halvorsen LTD loss ratio above 100% in 2024 and 2025; MSK is the top STD diagnosis."""

    def test_ltd_loss_ratio_above_100_percent(self):
        ltd = {p["program_id"] for p in self.recs("lad_programs") if p["client_id"] == "C044" and p["coverage"] == "LTD"}
        self.assertTrue(ltd)
        for y in (2024, 2025):
            exp = [e for e in self.recs("lad_experience") if e["program_id"] in ltd and e["experience_year"] == y]
            self.assertTrue(exp, f"no LTD experience for {y}")
            lr = sum(float(e["incurred_claims"]) for e in exp) / sum(float(e["premium"]) for e in exp)
            self.assertGreater(lr, 1.0, f"{y} LTD loss ratio {lr:.3f}")

    def test_musculoskeletal_is_top_std_diagnosis(self):
        std = {p["program_id"] for p in self.recs("lad_programs") if p["client_id"] == "C044" and p["coverage"] == "STD"}
        counts = {}
        for d in self.recs("disability_claims"):
            if d["program_id"] in std and d["claim_type"] == "STD":
                counts[d["diagnosis_category"]] = counts.get(d["diagnosis_category"], 0) + 1
        self.assertTrue(counts)
        self.assertEqual(max(counts, key=counts.get), "Musculoskeletal", counts)


class TestFairhavenLeave(_Base):
    """Signal 6: Fairhaven pays 6 weeks in WA and NY, below those states' laws."""

    def test_six_paid_weeks_below_state_law(self):
        laws = {r["state"]: r for r in self.recs("state_leave_laws")}
        pol = [r for r in self.recs("client_leave_policies") if r["client_id"] == gen.LEAVE_GAP_CLIENT]
        for st in ("WA", "NY"):
            rows = [r for r in pol if r["state"] == st]
            self.assertTrue(rows, f"no Fairhaven policy in {st}")
            for r in rows:
                law = laws[st]["max_weeks_medical" if r["reason"] == "Own health" else "max_weeks_family"]
                self.assertEqual(r["weeks_paid"], 6, f"{st} {r['reason']}")
                self.assertLess(r["weeks_paid"], law, f"{st} {r['reason']}")


class TestRegionBenchmarks(_Base):
    """Signal 7: Northeast and West cost more per employee than South and Midwest (NS-2025, latest full survey)."""

    def test_northeast_and_west_above_south_and_midwest(self):
        pg = {r["peer_group_id"]: r for r in self.recs("peer_groups")}
        mean = {}
        for v in self.recs("benchmark_values"):
            g = pg[v["peer_group_id"]]
            if v["source_id"] == "NS-2025" and v["measure"] == "cost_per_employee" and g["size_band"] == "All 500+" \
                    and g["industry"] == "All" and g["union_status"] == "Any" and g["region"] != "All":
                mean[g["region"]] = float(v["mean"])
        self.assertEqual(set(mean), {"Northeast", "West", "South", "Midwest"}, mean)
        self.assertGreater(min(mean["Northeast"], mean["West"]), max(mean["South"], mean["Midwest"]), mean)


if __name__ == "__main__":
    unittest.main()
