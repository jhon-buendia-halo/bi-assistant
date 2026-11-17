// Generates the Excel / CSV fixtures of excel-datasources.spec.ts. Run once and
// commit the output: `node frontend/e2e/fixtures/make-excel-fixtures.cjs`.
// Uses exceljs from backend/node_modules (run `node scripts/bootstrap.mjs` first).
const { Workbook } = require('../../../backend/node_modules/exceljs');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const wb = new Workbook();
  // "Region": a title row above the column names, then six data rows and a
  // total row. Detection takes row 1 (all text) as the header; the user
  // clicks row 2.
  const region = wb.addWorksheet('Region');
  region.addRow(['Sales report', 'Finance', 'Draft']);
  region.addRow(['Region', 'Product', 'Units']);
  const data = [
    ['North', 'Widget', 120],
    ['North', 'Gadget', 80],
    ['South', 'Widget', 95],
    ['South', 'Gadget', 60],
    ['East', 'Widget', 110],
    ['West', 'Gadget', 70],
  ];
  for (const row of data) region.addRow(row);
  region.addRow(['Total', null, data.reduce((sum, r) => sum + r[2], 0)]);
  // "Notes": empty, so there is no table to import.
  wb.addWorksheet('Notes');

  const dir = __dirname;
  await wb.xlsx.writeFile(path.join(dir, 'sales_2026.xlsx'));
  fs.writeFileSync(
    path.join(dir, 'players.csv'),
    'player,team,goals\nPelé,Brazil,12\nMüller,Germany,14\nEusébio,Portugal,9\n',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
