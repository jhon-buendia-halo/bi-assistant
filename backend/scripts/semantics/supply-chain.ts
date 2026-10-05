/**
 * Business-semantics document for the `supply_chain` eval fixture (generated
 * by `docker/postgres/generate/supply-chain.ts`, seed 20260928). Imported by
 * `../fixture-semantics.ts`, which owns the types and the overfitting-guard
 * rules this module follows: every snippet states a rule about the DATA —
 * a column's vocabulary, a join path, a unit, a coverage boundary, a default
 * filter — never a hint about a specific eval question, and nothing here
 * resolves the "biggest supplier" ambiguity the clarification case asks the
 * assistant to notice on its own.
 *
 * The import below is type-only (erased at compile time), so there is no
 * runtime cycle when `fixture-semantics.ts` imports this module back.
 *
 * Verification: every non-obvious fact was checked against the live fixture
 * on 2026-09-28 — Docker Postgres at `localhost:55432`, db `world_cup`, user
 * `world_cup` — with `psql`; the query and its result sit next to the fact.
 */

import type { FixtureSemantics } from '../fixture-semantics';

export const SUPPLY_CHAIN: FixtureSemantics = {
  datasetName: 'Supply Chain',
  schema: 'supply_chain',
  description:
    'Supply Chain (schema supply_chain): inbound purchasing for an industrial ' +
    'distributor — suppliers by tier, a product catalogue bought in case ' +
    'packs, warehouses by region, purchase orders and their lines, shipments ' +
    'with carriers and transport modes, inspection receipts, and month-end ' +
    'inventory snapshots. Answers questions about purchase-order volume and ' +
    'status, committed spend, units ordered and received, supplier delivery ' +
    'performance, inspection quality, freight cost, and stock on hand by ' +
    'warehouse. Grain: one row per purchase order (purchase_orders), per ' +
    'order line (purchase_order_lines), per shipment (shipments), per ' +
    'received lot (receipts), and per warehouse, product and month-end ' +
    '(inventory_snapshots). All money is stored as integer cents (USD). ' +
    'Coverage: purchase orders were raised in calendar years 2024 and 2025 ' +
    'only, and about 2% of them are sandbox test orders (is_test) mixed into ' +
    'the volume on purpose.',
  knowledge: [
    {
      kind: 'term',
      title: 'Purchase order status vocabulary',
      // Verified: `SELECT status, count(*) FROM supply_chain.purchase_orders
      // GROUP BY 1` → CANCELLED 83, CLOSED 237, DRAFT 46, ISSUED 146,
      // PARTIALLY_RECEIVED 83, RECEIVED 305 (900). A CHECK constraint pins the
      // six values; the generator asserts DRAFT/CANCELLED/ISSUED POs have no
      // shipments and ordered_on is NOT NULL on every row.
      body:
        'purchase_orders.status is one of DRAFT, ISSUED, PARTIALLY_RECEIVED, ' +
        'RECEIVED, CLOSED, CANCELLED. An open purchase order has been sent ' +
        'and is still awaiting goods: ISSUED (nothing received yet) or ' +
        'PARTIALLY_RECEIVED. RECEIVED and CLOSED are fulfilled. DRAFT was ' +
        'never sent to the supplier and CANCELLED will never be fulfilled — ' +
        'neither commits any spend. ordered_on is the date the order was ' +
        'raised and is set on every status, DRAFT included.',
      synonyms: ['open', 'outstanding', 'fulfilled', 'draft', 'cancelled'],
      entities: ['supply_chain.purchase_orders'],
      column: 'status',
    },
    {
      kind: 'default_filter',
      title: 'Exclude test purchase orders',
      // Verified: `SELECT count(*) FILTER (WHERE is_test), count(*) FROM
      // supply_chain.purchase_orders` → 21 of 900 (2.3%). is_test exists on
      // purchase_orders only (and on the v_* views, copied from it).
      body:
        'Unless the question explicitly asks about test data, exclude ' +
        'purchase orders where is_test = true from every aggregate — they ' +
        'are sandbox orders raised to test the procurement integration ' +
        '(about 2% of purchase orders). The flag lives on purchase_orders ' +
        'only: apply it to purchase_order_lines, shipments and receipts by ' +
        'joining back to their purchase order. It does not apply to ' +
        'suppliers, products, warehouses, carriers or inventory_snapshots.',
      entities: ['supply_chain.purchase_orders'],
      column: 'is_test',
    },
    {
      kind: 'term',
      title: 'Order quantities are in cases, receipts in units',
      // Verified: `SELECT count(*) FROM supply_chain.purchase_order_lines l
      // JOIN supply_chain.products p ON p.id = l.product_id WHERE
      // l.line_total_cents <> l.cases_ordered * p.case_pack_qty *
      // l.unit_price_cents` → 0. `SELECT min(case_pack_qty),
      // max(case_pack_qty) FROM supply_chain.products` → 1, 500.
      body:
        'purchase_order_lines.cases_ordered counts CASES. Units (eaches) ' +
        'ordered = cases_ordered × products.case_pack_qty, and case packs ' +
        'range from 1 to 500. unit_price_cents is the price of one each, and ' +
        'line_total_cents is already cases_ordered × case_pack_qty × ' +
        'unit_price_cents. receipts.units_received and units_accepted count ' +
        'units, not cases.',
      synonyms: ['units', 'eaches', 'cases', 'case pack', 'quantity'],
      entities: [
        'supply_chain.purchase_order_lines',
        'supply_chain.products',
        'supply_chain.receipts',
      ],
    },
    {
      kind: 'term',
      title: 'Amounts are stored in cents',
      // Verified: `SELECT DISTINCT currency FROM supply_chain.purchase_orders`
      // → USD (CHECK constraint currency = 'USD').
      body:
        'unit_price_cents and line_total_cents on purchase_order_lines, ' +
        'unit_cost_cents on products, and freight_cost_cents and ' +
        'goods_value_cents on shipments are integer cents (USD), not dollars ' +
        '— divide by 100 for a dollar figure. products.unit_cost_cents is a ' +
        'standard cost; the price actually agreed on an order is ' +
        'purchase_order_lines.unit_price_cents.',
      synonyms: ['cents', 'dollars', 'spend', 'cost'],
      entities: [
        'supply_chain.purchase_order_lines',
        'supply_chain.products',
        'supply_chain.shipments',
      ],
    },
    {
      kind: 'term',
      title: 'Unit of measure is always EA',
      // Verified: `SELECT count(DISTINCT unit_of_measure),
      // min(unit_of_measure) FROM supply_chain.products` → 1, EA (CHECK
      // constraint unit_of_measure = 'EA').
      body:
        "products.unit_of_measure is always 'EA' (each) — CHECK constraint — " +
        'so it carries no information; do not group or filter by it. The ' +
        'pack size is products.case_pack_qty, which is not a unit of ' +
        'measure.',
      entities: ['supply_chain.products'],
      column: 'unit_of_measure',
    },
    {
      kind: 'term',
      title: 'Receipt inspection vocabulary',
      // Verified: `SELECT qc_status, count(*), sum(units_accepted),
      // count(*) FILTER (WHERE units_accepted < units_received) FROM
      // supply_chain.receipts GROUP BY 1` → FAILED 341 (all partially or
      // fully rejected), PASSED 1631 (none short), PENDING 259
      // (units_accepted 0). CHECK constraints pin all three rules.
      body:
        'receipts.qc_status is PASSED, FAILED or PENDING. PENDING means not ' +
        'inspected yet: units_accepted stays 0 until inspection, and pending ' +
        'receipts belong in neither the numerator nor the denominator of an ' +
        'acceptance or failure rate. PASSED accepts every unit received; a ' +
        'FAILED receipt rejected some or all of its units ' +
        '(units_accepted < units_received).',
      synonyms: ['inspection', 'quality check', 'QC', 'rejected', 'uninspected'],
      entities: ['supply_chain.receipts'],
      column: 'qc_status',
    },
    {
      kind: 'term',
      title: 'On-time delivery is measured against the purchase order promise',
      // Verified: CHECK ((status = 'DELIVERED') = (delivered_on IS NOT NULL))
      // on shipments; `SELECT status, count(*), count(delivered_on) FROM
      // supply_chain.shipments GROUP BY 1` → DELIVERED 789/789, EXCEPTION
      // 58/0, IN_TRANSIT 30/0.
      body:
        'A shipment is on time when shipments.delivered_on <= ' +
        'purchase_orders.promised_on, the date the supplier committed to ' +
        "when the order was raised. shipments.expected_on is the carrier's " +
        'ETA quoted at dispatch — a different date, not the promise. Only ' +
        'DELIVERED shipments have a delivered_on; IN_TRANSIT and EXCEPTION ' +
        'shipments belong in no on-time rate. See the on_time_delivery_rate ' +
        'metric.',
      synonyms: ['on time', 'late', 'OTD', 'promised date', 'ETA'],
      entities: ['supply_chain.shipments', 'supply_chain.purchase_orders'],
    },
    {
      kind: 'term',
      title: 'Inventory snapshots are month-end point-in-time balances',
      // Verified: `SELECT min(snapshot_date), max(snapshot_date),
      // count(DISTINCT snapshot_date), count(*) FROM
      // supply_chain.inventory_snapshots` → 2024-01-31, 2025-12-31, 24, 4704
      // (7 warehouses × 28 products × 24 month-ends).
      body:
        'inventory_snapshots holds one row per warehouse, stocked product ' +
        'and month-end snapshot_date (2024-01-31 through 2025-12-31). ' +
        'on_hand_units and allocated_units are balances as of that date: ' +
        'never add them up across dates — the stock at a point in time is ' +
        'the snapshot on that date. Unallocated stock = on_hand_units - ' +
        'allocated_units.',
      synonyms: ['stock', 'on hand', 'inventory level', 'balance'],
      entities: ['supply_chain.inventory_snapshots'],
      column: 'snapshot_date',
    },
    {
      kind: 'instruction',
      title: 'Join shipments and receipts to supplier, warehouse and region',
      // Verified: the v_shipments / v_receipts / v_purchase_order_lines view
      // definitions in docker/postgres/init/006_supply_chain.sql perform
      // exactly these joins (region via the PO's warehouse).
      body:
        'Shipments and receipts carry no supplier, warehouse or region. ' +
        'Reach them through the purchase order: shipments.po_id → ' +
        'purchase_orders, then supplier_id → suppliers and warehouse_id → ' +
        'warehouses → regions (warehouses.region_id); receipts.shipment_id → ' +
        'shipments, and receipts.po_line_id → purchase_order_lines → ' +
        "products. A region is the receiving warehouse's region. " +
        'v_shipments, v_receipts and v_purchase_order_lines already perform ' +
        'these joins.',
      entities: [
        'supply_chain.shipments',
        'supply_chain.receipts',
        'supply_chain.purchase_orders',
        'supply_chain.suppliers',
        'supply_chain.warehouses',
        'supply_chain.regions',
      ],
    },
    {
      kind: 'term',
      title: 'Tracking numbers are sparse',
      // Verified: `SELECT count(tracking_number), count(*), count(*) FILTER
      // (WHERE tracking_number IS NOT NULL AND mode <> 'AIR') FROM
      // supply_chain.shipments` → 61 of 877 (7.0%), 0 off air freight.
      body:
        'shipments.tracking_number is null on about 93% of shipments — only ' +
        'some air shipments record one. A null means no number was ' +
        'recorded, not that the shipment is missing, and grouping by ' +
        'tracking_number puts almost every shipment in one null bucket.',
      entities: ['supply_chain.shipments'],
      column: 'tracking_number',
    },
    {
      kind: 'term',
      title: 'Coverage: purchase orders raised in 2024 and 2025 only',
      // Verified: `SELECT min(ordered_on), max(ordered_on) FROM
      // supply_chain.purchase_orders` → 2024-01-02 .. 2025-12-31 (also pinned
      // by the CHECK constraint on ordered_on).
      body:
        'purchase_orders.ordered_on only covers calendar years 2024 and 2025 ' +
        '(CHECK constraint) — there is no earlier or later purchasing ' +
        'history in this fixture.',
      entities: ['supply_chain.purchase_orders'],
      column: 'ordered_on',
    },
    {
      kind: 'instruction',
      title: 'Report products and suppliers by name',
      body:
        'purchase_order_lines carries product_id and purchase_orders carries ' +
        'supplier_id, not names. Report a product by products.name (sku is a ' +
        'code) and a supplier by suppliers.name — do not surface the numeric ' +
        'id as the answer.',
      entities: [
        'supply_chain.purchase_order_lines',
        'supply_chain.products',
        'supply_chain.suppliers',
      ],
    },
  ],
  metrics: [
    {
      // Verified: `SELECT <expression> FROM supply_chain.v_shipments WHERE
      // NOT is_test` → 61.98.
      name: 'on_time_delivery_rate',
      label: 'On-time delivery rate',
      description:
        "Share of delivered shipments that arrived on or before the purchase " +
        "order's promised date, as a percentage. Undelivered (in-transit or " +
        'exception) shipments are in neither the numerator nor the ' +
        'denominator, and the carrier ETA (expected_on) is not the promise. ' +
        'Combine with the "Exclude test purchase orders" filter ' +
        '(v_shipments.is_test) for a reported rate.',
      entity: 'supply_chain.v_shipments',
      expression:
        'ROUND(100.0 * COUNT(*) FILTER (WHERE delivered_on <= promised_on) / NULLIF(COUNT(*) FILTER (WHERE delivered_on IS NOT NULL), 0), 2)',
    },
    {
      // Verified: `SELECT <expression> FROM supply_chain.v_purchase_order_lines
      // WHERE NOT is_test` → 464421244.
      name: 'committed_spend_cents',
      label: 'Committed spend (cents)',
      description:
        'Money committed on purchase orders actually placed: the sum of line ' +
        'totals, in cents, on orders that are not DRAFT or CANCELLED. Divide ' +
        'by 100 for dollars. Combine with the "Exclude test purchase orders" ' +
        'filter (v_purchase_order_lines.is_test).',
      entity: 'supply_chain.v_purchase_order_lines',
      expression: "SUM(line_total_cents) FILTER (WHERE po_status NOT IN ('DRAFT', 'CANCELLED'))",
    },
    {
      // Verified: `SELECT <expression> FROM supply_chain.receipts WHERE
      // shipment_id IN (SELECT sh.id FROM supply_chain.shipments sh JOIN
      // supply_chain.purchase_orders po ON po.id = sh.po_id WHERE NOT
      // po.is_test)` → 0.9326.
      name: 'receipt_acceptance_rate',
      label: 'Receipt acceptance rate',
      description:
        'Share of inspected units that were accepted, as a fraction of 1 ' +
        '(multiply by 100 for a percentage). PENDING receipts have not been ' +
        'inspected and are left out. Combine with the "Exclude test purchase ' +
        'orders" filter, which reaches receipts through shipments → ' +
        'purchase_orders.',
      entity: 'supply_chain.receipts',
      expression:
        "SUM(units_accepted) FILTER (WHERE qc_status <> 'PENDING') * 1.0 / NULLIF(SUM(units_received) FILTER (WHERE qc_status <> 'PENDING'), 0)",
    },
  ],
};
