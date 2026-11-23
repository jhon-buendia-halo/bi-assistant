import { asksForDashboard } from './dashboard-request';

describe('asksForDashboard (the gate of build_dashboard)', () => {
  it.each([
    'Create a dashboard of goals by team and tournament',
    'Build me two DASHBOARDS: one for sales, one for stock',
    'Can you turn this into a dashboard?',
    'Hazme un tablero de goles por equipo',
    'Quiero tableros por región',
    'Arma un cuadro de mando de ventas',
    'Un panel de control con las ventas por mes',
    'Créame un Panel de Indicadores del torneo',
    'Muéstrame un TABLERO',
    'paneles de control por tienda',
  ])('opens for %p', (text) => {
    expect(asksForDashboard(text)).toBe(true);
  });

  it.each([
    'Show me a chart of goals by team',
    'Hazme un gráfico de barras de goles',
    'Dame una tabla con los goles por equipo',
    'Muéstralo en el panel',
    'Show it in the side panel',
    'Prepare the numbers for the board meeting',
    'Which team scored the most goals?',
    'Board games sold by region',
    'Un cuadro con los goles',
    '',
  ])('stays shut for %p', (text) => {
    expect(asksForDashboard(text)).toBe(false);
  });
});
