#!/usr/bin/env python3
"""Defect and structure tests for the US Health seed generator (story BA-306, epic BA-305).

Stdlib only. Run from the repo root:
    python3 -m unittest scripts/test_us_health_structure.py
    python3 scripts/test_us_health_structure.py
"""
import hashlib
import importlib.util
import os
import re
import unittest
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEN_PATH = os.path.join(HERE, "generate-us-health-seed.py")
FIXTURES = os.path.join(ROOT, "backend", "src", "modules", "testing-data", "fixtures")
SEED_PATH = os.path.join(FIXTURES, "004_us_health.sql.gz")
REGISTRY_PATH = os.path.join(FIXTURES, "registry.ts")


def load_generator():
    spec = importlib.util.spec_from_file_location("generate_us_health_seed", GEN_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class UsHealthBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gen = load_generator()
        cls.rows = cls.gen.build()
        cls.sql = cls.gen.render(cls.rows)

    def col(self, table, name):
        i = self.gen.COLIDX[table][name]
        return [r[i] for r in self.rows[table]]


class PlantedDefects(UsHealthBase):
    def test_late_feed(self):
        g = self.gen
        ix = g.COLIDX["data_feeds"]
        feeds = [r for r in self.rows["data_feeds"]
                 if r[ix["client_id"]] == g.LATE_FEED_CLIENT and r[ix["feed_type"]] == "Medical claims"]
        self.assertEqual(len(feeds), 1)
        f = feeds[0]
        self.assertEqual(f[ix["status"]], "Late")
        self.assertEqual(f[ix["days_late"]], 45)
        # 45 days overdue against the dataset today (2026-10-31)
        self.assertEqual((g.TODAY - f[ix["expected_by"]]).days, 45)
        self.assertLess(f[ix["covers_through"]], g.CLAIMS_END)

    def test_late_feed_claims_thin_aug_sep(self):
        g = self.gen
        emp_client = dict(zip(self.col("employees", "employee_id"), self.col("employees", "client_id")))
        mem_emp = dict(zip(self.col("members", "member_id"), self.col("members", "employee_id")))
        ix = g.COLIDX["medical_claims"]
        per = Counter()
        for r in self.rows["medical_claims"]:
            if emp_client[mem_emp[r[ix["member_id"]]]] == g.LATE_FEED_CLIENT:
                d = r[ix["service_date"]]
                per[(d.year, d.month)] += 1
        jan_jul = [per[(2026, m)] for m in range(1, 8)]
        avg = sum(jan_jul) / 7
        self.assertGreater(avg, 100, jan_jul)
        for m in (8, 9):
            self.assertLess(per[(2026, m)], 0.25 * avg, (m, per[(2026, m)], avg))

    def test_duplicated_medical_claims(self):
        ix = self.gen.COLIDX["medical_claims"]
        groups = defaultdict(set)
        for r in self.rows["medical_claims"]:
            groups[(r[ix["member_id"]], r[ix["service_date"]], r[ix["allowed"]])].add(r[ix["claim_id"]])
        extra = sum(len(v) - 1 for v in groups.values() if len(v) > 1)
        total = len(self.rows["medical_claims"])
        self.assertGreaterEqual(extra / total, 0.001, (extra, total))
        self.assertLessEqual(extra / total, 0.005, (extra, total))

    def test_claims_outside_enrollment(self):
        g = self.gen
        mem_emp = dict(zip(self.col("members", "member_id"), self.col("members", "employee_id")))
        periods = defaultdict(list)
        ei = g.COLIDX["enrollments"]
        for r in self.rows["enrollments"]:
            periods[r[ei["employee_id"]]].append((r[ei["start_date"]], r[ei["end_date"]]))
        ix = g.COLIDX["medical_claims"]
        out = 0
        for r in self.rows["medical_claims"]:
            d = r[ix["service_date"]]
            if not any(s <= d <= e for s, e in periods.get(mem_emp[r[ix["member_id"]]], [])):
                out += 1
        total = len(self.rows["medical_claims"])
        self.assertGreaterEqual(out / total, 0.001, (out, total))
        self.assertLessEqual(out / total, 0.006, (out, total))

    def test_service_after_paid_and_after_today(self):
        g = self.gen
        ix = g.COLIDX["medical_claims"]
        total = len(self.rows["medical_claims"])
        after_paid = sum(1 for r in self.rows["medical_claims"]
                         if r[ix["paid_date"]] is not None and r[ix["service_date"]] > r[ix["paid_date"]])
        future = sum(1 for r in self.rows["medical_claims"] if r[ix["service_date"]] > g.TODAY)
        for label, n in (("service>paid", after_paid), ("service>today", future)):
            self.assertGreaterEqual(n, 1, label)
            self.assertLess(n / total, 0.0005, (label, n, total))

    def test_null_birth_year_only_dependents(self):
        ix = self.gen.COLIDX["members"]
        nulls = [r for r in self.rows["members"] if r[ix["birth_year"]] is None]
        self.assertGreater(len(nulls), 0)
        self.assertTrue(all(r[ix["relationship"]] != "Employee" for r in nulls))
        self.assertLess(len(nulls) / len(self.rows["members"]), 0.01)

    def test_small_subgroup_survey(self):
        sid, level, n = self.gen.SMALL_N
        self.assertEqual((sid, n), ("SV-C044-2025", 7))
        ix = self.gen.COLIDX["survey_respondents"]
        got = sum(1 for r in self.rows["survey_respondents"]
                  if r[ix["survey_id"]] == sid and r[ix["job_level"]] == level)
        self.assertEqual(level, "Executive")
        self.assertEqual(got, 7)

    def test_primary_keys_unique_and_not_null(self):
        g = self.gen
        for t in g.TABLES:
            ixs = [g.COLIDX[t["name"]][c] for c in t["pk"]]
            keys = [tuple(r[i] for i in ixs) for r in self.rows[t["name"]]]
            self.assertTrue(all(None not in k for k in keys), f"{t['name']}: null pk")
            self.assertEqual(len(keys), len(set(keys)), f"{t['name']}: duplicate pk")

    def test_every_table_has_rows(self):
        for t in self.gen.TNAME:
            self.assertGreater(len(self.rows[t]), 0, t)


class Structure(UsHealthBase):
    def test_deterministic_render_and_gzip(self):
        g = self.gen
        sql2 = g.render(g.build())
        self.assertEqual(self.sql, sql2)
        self.assertEqual(hashlib.sha256(g.gzip_bytes(self.sql)).hexdigest(),
                         hashlib.sha256(g.gzip_bytes(sql2)).hexdigest())

    def test_committed_seed_sql_matches_generator(self):
        # zlib-independent: the committed seed decompresses to exactly the generated SQL
        import gzip
        with gzip.open(SEED_PATH, "rb") as fh:
            self.assertEqual(fh.read().decode("utf-8"), self.sql)

    def test_committed_seed_is_reproducible(self):
        # byte-for-byte (testing-data spec R4); depends on the zlib build used by gzip level 9
        with open(SEED_PATH, "rb") as fh:
            committed = fh.read()
        self.assertEqual(hashlib.sha256(committed).hexdigest(),
                         hashlib.sha256(self.gen.gzip_bytes(self.sql)).hexdigest())

    def test_sql_creates_required_entities(self):
        tables = re.findall(r"^CREATE TABLE us_health\.(\w+)", self.sql, re.M)
        views = re.findall(r"^CREATE (?:OR REPLACE )?VIEW us_health\.(\w+)", self.sql, re.M)
        got = tables + views
        self.assertEqual((len(tables), len(views)), (41, 4))
        self.assertEqual(len(set(got)), 45)
        self.assertEqual(set(got), set(self.gen.REQUIRED))

    def test_registry_required_tables_match(self):
        with open(REGISTRY_PATH, encoding="utf-8") as fh:
            ts = fh.read()
        start = ts.index("const US_HEALTH")
        m = re.search(r"requiredTables:\s*\[(.*?)\]", ts[start:], re.S)
        self.assertIsNotNone(m)
        names = re.findall(r"'([^']+)'", m.group(1))
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(set(names), set(self.gen.REQUIRED))

    def test_foreign_keys(self):
        g = self.gen
        fks = g.fk_list()
        self.assertGreater(len(fks), 0)
        names = [f[4] for f in fks]
        self.assertEqual(len(names), len(set(names)), "duplicate FK constraint names")
        for tn, cn, rt, rc, name in fks:
            self.assertIn(cn, g.COLS[tn])
            self.assertIn(rt, g.COLS, f"{name}: unknown table {rt}")
            self.assertIn(rc, g.COLS[rt], f"{name}: unknown column {rt}.{rc}")
            self.assertIn(f'ADD CONSTRAINT "{name}" FOREIGN KEY ({cn}) REFERENCES us_health.{rt} ({rc})', self.sql)
            parent = set(self.col(rt, rc))
            orphans = [v for v in self.col(tn, cn) if v is not None and v not in parent]
            self.assertEqual(orphans[:5], [], f"{name}: {len(orphans)} orphan values")

    def test_comments_on_every_entity_and_column(self):
        g = self.gen
        for t in g.TABLES:
            n = t["name"]
            self.assertTrue(t["comment"].strip(), n)
            self.assertIn(f"COMMENT ON TABLE us_health.{n} IS ", self.sql)
            for name, _typ, cmt, _ref in t["cols"]:
                self.assertTrue(cmt.strip(), f"{n}.{name}")
                self.assertIn(f"COMMENT ON COLUMN us_health.{n}.{name} IS ", self.sql, f"{n}.{name}")
        for vname, vcomment, vcols, _body in g.VIEWS:
            self.assertTrue(vcomment.strip(), vname)
            self.assertIn(f"COMMENT ON VIEW us_health.{vname} IS ", self.sql)
            for cn, cmt in vcols:
                self.assertTrue(cmt.strip(), f"{vname}.{cn}")
                self.assertIn(f"COMMENT ON COLUMN us_health.{vname}.{cn} IS ", self.sql, f"{vname}.{cn}")


if __name__ == "__main__":
    unittest.main()
