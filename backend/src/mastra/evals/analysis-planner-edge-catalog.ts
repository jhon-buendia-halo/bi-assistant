import {
  PLAN_COLUMNS_PER_ENTITY,
  planCatalogBlock,
  type CatalogEntity,
  type EntityColumns,
} from '../workflows/analysis.steps';

/**
 * The Edge Cases sample's entities and columns, as Load catalog hands them
 * to Plan (agents.md 5.11), so the `analysis-planner` cases get the catalog
 * block the app builds (`planCatalogBlock`), capped as it caps (40 columns
 * per entity, the rest counted). Columns and types were read from the seeded
 * `edge_cases` schema (`005_edge_cases.sql`); keep them in step with it. No
 * framework import: the set and its spec read it under Jest.
 */

/** The dataset the catalog belongs to. */
export const EDGE_CASES_DATASET = 'Edge Cases';

/** The catalog of the entity keys: `<database>.<schema>.<table>`. */
const KEY_PREFIX = 'edge_cases.edge_cases.';

type Column = [name: string, type: string];

/** `label_01 text, count_02 integer, …` for the 64 columns of the wide table. */
function wideColumns(): Column[] {
  const kinds: [string, string][] = [
    ['label', 'text'],
    ['count', 'integer'],
    ['amount', 'numeric'],
    ['flag', 'boolean'],
    ['day', 'date'],
    ['seen_at', 'timestamp with time zone'],
    ['score', 'double precision'],
    ['level', 'smallint'],
  ];
  const columns: Column[] = [['customer_id', 'bigint']];
  for (let i = 1; i <= 64; i += 1) {
    const [name, type] = kinds[(i - 1) % kinds.length];
    columns.push([`${name}_${String(i).padStart(2, '0')}`, type]);
  }
  return columns;
}

/** Each entity's columns, in table order, by table name. */
export const EDGE_CASES_COLUMNS: Record<string, Column[]> = {
  store_settings: [
    ['id', 'smallint'],
    ['store_name', 'text'],
    ['base_currency', 'character'],
    ['time_zone', 'text'],
    ['opened_on', 'date'],
    ['free_shipping_threshold', 'numeric'],
    ['settings', 'jsonb'],
  ],
  categories: [
    ['category_id', 'integer'],
    ['parent_category_id', 'integer'],
    ['name', 'text'],
    ['group', 'text'],
    ['sort_order', 'integer'],
  ],
  customers: [
    ['id', 'bigint'],
    ['customer_code', 'text'],
    ['first_name', 'text'],
    ['middle_name', 'text'],
    ['last_name', 'text'],
    ['email', 'text'],
    ['phone', 'text'],
    ['fax', 'text'],
    ['CustomerTier', 'text'],
    ['country', 'text'],
    ['región', 'text'],
    ['city', 'text'],
    ['is_vip', 'boolean'],
    ['birth_date', 'date'],
    ['signup_date', 'text'],
    ['preferences', 'jsonb'],
    ['last_login_ip', 'inet'],
    ['created_at', 'timestamp with time zone'],
    ['updated_at', 'timestamp with time zone'],
  ],
  customer_profile_wide: wideColumns(),
  products: [
    ['id', 'integer'],
    ['sku', 'text'],
    ['name', 'text'],
    ['category_id', 'integer'],
    ['brand', 'text'],
    ['color', 'text'],
    ['unit_price', 'numeric'],
    ['cost', 'numeric'],
    ['margin_pct', 'numeric'],
    ['weight_kg', 'double precision'],
    ['select', 'boolean'],
    ['matching_rows', 'integer'],
    ['tags', 'ARRAY'],
    ['is_active', 'boolean'],
    ['launched_at', 'timestamp with time zone'],
    ['description', 'text'],
  ],
  promotions: [
    ['promotion_id', 'integer'],
    ['name', 'text'],
    ['discount_%', 'numeric'],
    ['start_date', 'date'],
    ['end_date', 'date'],
    ['is_active', 'boolean'],
  ],
  orders: [
    ['id', 'bigint'],
    ['customer_id', 'bigint'],
    ['order', 'integer'],
    ['user', 'text'],
    ['status', 'USER-DEFINED'],
    ['channel', 'text'],
    ['currency', 'text'],
    ['ordered_tz', 'text'],
    ['ordered_at', 'timestamp with time zone'],
    ['expected_delivery_date', 'date'],
    ['Order Notes', 'text'],
    ['ship-to', 'text'],
    ['año', 'smallint'],
    ['discount_%', 'numeric'],
    ['discount_amount', 'numeric'],
    ['shipping_fee', 'numeric'],
    ['order_uuid', 'uuid'],
    ['cancelled_at', 'timestamp with time zone'],
  ],
  order_lines: [
    ['id', 'bigint'],
    ['order_id', 'bigint'],
    ['product_id', 'integer'],
    ['line_number', 'integer'],
    ['quantity', 'integer'],
    ['unit_price', 'numeric'],
    ['discount', 'numeric'],
    ['line_total', 'numeric'],
    ['tax_rate', 'double precision'],
    ['event_sequence', 'bigint'],
    ['gift_message', 'text'],
  ],
  payments: [
    ['id', 'bigint'],
    ['order_id', 'bigint'],
    ['method', 'text'],
    ['amount', 'numeric'],
    ['payer_email', 'text'],
    ['card_last4', 'text'],
    ['transaction_ref', 'uuid'],
    ['paid_at', 'timestamp with time zone'],
  ],
  shipments: [
    ['shipment_id', 'bigint'],
    ['order_id', 'bigint'],
    ['carrier', 'text'],
    ['country', 'text'],
    ['postal_code', 'text'],
    ['tracking_url', 'text'],
    ['shipped_at', 'timestamp with time zone'],
    ['delivered_at', 'timestamp with time zone'],
  ],
  returns: [
    ['return_id', 'integer'],
    ['order_line_id', 'bigint'],
    ['reason', 'text'],
    ['refund_amount', 'numeric'],
    ['restocked', 'boolean'],
    ['returned_at', 'timestamp with time zone'],
  ],
  reviews: [
    ['id', 'bigint'],
    ['product_id', 'integer'],
    ['customer_id', 'bigint'],
    ['rating', 'smallint'],
    ['title', 'text'],
    ['body', 'text'],
    ['language', 'text'],
    ['helpful_votes', 'integer'],
    ['verified_purchase', 'boolean'],
    ['created_at', 'timestamp with time zone'],
  ],
  inventory_snapshots: [
    ['product_id', 'integer'],
    ['warehouse_code', 'text'],
    ['snapshot_date', 'date'],
    ['quantity_on_hand', 'integer'],
    ['reorder_point', 'integer'],
  ],
  gift_cards: [
    ['id', 'bigint'],
    ['code', 'text'],
    ['customer_id', 'bigint'],
    ['initial_balance', 'numeric'],
    ['balance', 'numeric'],
    ['issued_at', 'timestamp with time zone'],
    ['expires_on', 'date'],
  ],
  LegacyOrders: [
    ['legacy_order_id', 'integer'],
    ['customer_id', 'integer'],
    ['legacy_uuid', 'text'],
    ['OrderTotal', 'numeric'],
    ['status', 'text'],
    ['placed_at', 'timestamp without time zone'],
    ['notes', 'text'],
  ],
  v_order_totals: [
    ['order_id', 'bigint'],
    ['customer_id', 'bigint'],
    ['status', 'USER-DEFINED'],
    ['ordered_at', 'timestamp with time zone'],
    ['line_count', 'bigint'],
    ['units', 'bigint'],
    ['order_total', 'numeric'],
  ],
  v_customer_ltv: [
    ['customer_id', 'bigint'],
    ['CustomerTier', 'text'],
    ['country', 'text'],
    ['order_count', 'bigint'],
    ['lifetime_value', 'numeric'],
    ['last_ordered_at', 'timestamp with time zone'],
  ],
  v_product_revenue: [
    ['product_id', 'integer'],
    ['name', 'text'],
    ['color', 'text'],
    ['line_count', 'bigint'],
    ['units', 'bigint'],
    ['revenue', 'numeric'],
  ],
  mv_daily_sales: [
    ['sales_date', 'date'],
    ['order_count', 'bigint'],
    ['units', 'numeric'],
    ['revenue', 'numeric'],
  ],
};

/** The tables and views of the sample, in the registry's order. */
export const EDGE_CASES_TABLES = Object.keys(EDGE_CASES_COLUMNS);

/** The entity key Plan sees for a table. */
export function edgeEntityKey(table: string): string {
  return `${KEY_PREFIX}${table}`;
}

/** What Plan's request carries for the sample (`catalog` and `columns`). */
export function edgeCasesCatalog(): {
  catalog: CatalogEntity[];
  columns: EntityColumns[];
} {
  const catalog: CatalogEntity[] = [];
  const columns: EntityColumns[] = [];
  for (const table of EDGE_CASES_TABLES) {
    const known = EDGE_CASES_COLUMNS[table];
    catalog.push({
      entity: edgeEntityKey(table),
      dataset: EDGE_CASES_DATASET,
      datasourceId: null,
      datasourceKind: 'postgres',
      columnCount: known.length,
    });
    const listed = known
      .slice(0, PLAN_COLUMNS_PER_ENTITY)
      .map(([name, type]) => ({ name, type }));
    columns.push({
      entity: edgeEntityKey(table),
      columns: listed,
      more: known.length - listed.length,
    });
  }
  return { catalog, columns };
}

/**
 * The catalog block of the whole sample, built with the function the Plan
 * step uses; `tables` narrows it to some tables (a smaller dataset).
 */
export function edgeCasesCatalogBlock(tables?: readonly string[]): string {
  const { catalog, columns } = edgeCasesCatalog();
  const keep = (entity: string) =>
    !tables || tables.some((table) => edgeEntityKey(table) === entity);
  return planCatalogBlock(
    catalog.filter((e) => keep(e.entity)),
    columns.filter((e) => keep(e.entity)),
  );
}

/** What a check needs to know about the catalog a case was given. */
export interface PlannerCatalog {
  /** Entity keys, as the plan names them. */
  entities: string[];
  /** Every column the plan may name, by table (the cap applied). */
  columns: Record<string, string[]>;
}

/** The catalog the checks compare a plan against: what Plan was shown. */
export function edgeCasesPlannerCatalog(): PlannerCatalog {
  const { columns } = edgeCasesCatalog();
  return {
    entities: columns.map((entry) => entry.entity),
    columns: Object.fromEntries(
      columns.map((entry) => [
        entry.entity,
        entry.columns.map((column) => column.name),
      ]),
    ),
  };
}
