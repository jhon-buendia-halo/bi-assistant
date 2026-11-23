/**
 * Whether the user's words ask for a dashboard (the gate of Avery's
 * build_dashboard, plan bi-dashboard 2.2): English or Spanish, ignoring case
 * and accents. A chart, a table, a panel alone or a board is no dashboard.
 * Plain code, no framework import.
 */

const DASHBOARD_WORDS =
  /\b(?:dashboards?|tableros?|cuadros? de mando|panel(?:es)? de (?:control|indicadores))\b/;

/** The text in lower case without accents ("Gráfico" → "grafico"). */
function folded(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** True when the text asks for a dashboard. */
export function asksForDashboard(text: string): boolean {
  return DASHBOARD_WORDS.test(folded(text ?? ''));
}
