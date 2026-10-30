import { createFormats, studioTheme, type AgDataSourcesDefinition, type AgFieldDefinition, type AgFormat, type AgReportState, type AgWidgetLayoutState } from 'ag-studio';
import type { AgRegistry } from 'ag-studio-react';
import type { CommandCentreData } from '@/lib/services/command-centre';

type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];

const fields = (specs: FieldSpec[]): AgFieldDefinition[] => specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));

const toPlot = (id: string, table: string) => ({
  id,
  source: { tableId: table, fieldId: 'plotId' },
  target: { tableId: 'plots', fieldId: 'id' },
  type: 'many-to-one' as const,
});

export function buildStudioData(data: CommandCentreData): AgDataSourcesDefinition<AgRegistry> {
  return {
    description:
      `One EU buyer's coffee season ${data.contract.season} with smallholders in Chikkamagaluru, Karnataka, paid through PayPal. ` +
      'Payments are released per plot and milestone only after verified field evidence and a satellite land check (the EU deforestation rule, EUDR). ' +
      'Plots with tree cover lost after 31 December 2020 fail the check and are never paid. Amounts are in USD.',
    sources: [
      {
        id: 'plots',
        description: 'Coffee plots in the contract, with the satellite land check result (no forest cleared after 2020).',
        data: data.plots,
        fields: fields([
          ['id', 'Plot ID', 'textFormat', true],
          ['plot', 'Plot', 'textFormat'],
          ['farmer', 'Farmer', 'textFormat'],
          ['variety', 'Variety', 'textFormat'],
          ['areaHa', 'Area (ha)', 'decimalFormat'],
          ['eudrStatus', 'Land check', 'textFormat'],
          ['lossHa', 'Tree cover lost since 2021 (ha)', 'decimalFormat'],
          ['contractValueUsd', 'Contract value', 'currencyFormat'],
          ['paidUsd', 'Paid for milestones', 'currencyFormat'],
        ]),
      },
      {
        id: 'milestones',
        description: 'Per-plot payment milestones. State is Paid, Held for review, Refused or Open. Reason is the gate code for held or refused ones.',
        data: data.milestones,
        fields: fields([
          ['id', 'Milestone ID', 'textFormat'],
          ['plotId', 'Plot ID', 'textFormat', true],
          ['milestone', 'Milestone', 'textFormat'],
          ['state', 'Milestone state', 'textFormat'],
          ['reason', 'Reason', 'textFormat'],
          ['trancheUsd', 'Tranche', 'currencyFormat'],
          ['opensOn', 'Opens on', 'dateFormat'],
          ['decidedOn', 'Decided on', 'dateFormat'],
        ]),
      },
      {
        id: 'payouts',
        description: 'PayPal Payouts items sent to farmers and input dealers. Status is PayPal’s item status (SUCCESS, PENDING, UNCLAIMED and so on).',
        data: data.payouts,
        fields: fields([
          ['id', 'Payout item', 'textFormat', true],
          ['payee', 'Payee', 'textFormat'],
          ['payeeType', 'Payee type', 'textFormat'],
          ['purpose', 'Paid for', 'textFormat'],
          ['status', 'Payout status', 'textFormat'],
          ['amountUsd', 'Payout amount', 'currencyFormat'],
          ['paidOn', 'Paid on', 'dateFormat'],
        ]),
      },
      {
        id: 'premiums',
        description: 'Traceability premiums the buyer pays on top of the coffee price for verified plots.',
        data: data.premiums,
        fields: fields([
          ['id', 'Premium ID', 'textFormat', true],
          ['plotId', 'Plot ID', 'textFormat', true],
          ['state', 'Premium state', 'textFormat'],
          ['amountUsd', 'Premium', 'currencyFormat'],
          ['accruedOn', 'Earned on', 'dateFormat'],
        ]),
      },
      {
        id: 'paypalCalls',
        name: 'PayPal calls',
        description: 'Every PayPal API call that moved money, and whether the API response or the signed webhook confirmed it first.',
        data: data.paypalCalls,
        fields: fields([
          ['id', 'Call ID', 'textFormat', true],
          ['call', 'PayPal call', 'textFormat'],
          ['status', 'Call status', 'textFormat'],
          ['amountUsd', 'Amount', 'currencyFormat'],
          ['confirmedBy', 'Confirmed by', 'textFormat'],
          ['apiSeconds', 'API seconds', 'decimalFormat'],
          ['webhookSeconds', 'Webhook seconds', 'decimalFormat'],
          ['on', 'Called on', 'dateFormat'],
        ]),
      },
    ],
    relationships: [toPlot('milestones-plot', 'milestones'), toPlot('premiums-plot', 'premiums')],
    formats: createFormats({ overrides: { currencyFormat: { formatOptions: { format: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }) } } } }),
  };
}

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: 'sum' as const });
const kpi = (text: string, value: { id: string; aggregation?: 'sum' | 'countd' }) => ({
  type: 'value' as const,
  dataMapping: { value: [value] },
  format: title(text),
});

export const commandCentreReport: AgReportState = {
  selectedPageId: 'season',
  panels: { filters: { collapsed: true } },
  pages: [
    {
      id: 'season',
      widgets: {
        'kpi-value': kpi('Contract value', sum('plots.contractValueUsd')),
        'kpi-paid': kpi('Paid to farmers and dealers', sum('payouts.amountUsd')),
        'kpi-premiums': kpi('Traceability premiums', sum('premiums.amountUsd')),
        'kpi-plots': kpi('Plots', { id: 'plots.id', aggregation: 'countd' }),
        'eudr-readiness': {
          type: 'donut-chart',
          dataMapping: { categoryKey: [{ id: 'plots.eudrStatus' }], valueKey: [sum('plots.areaHa')] },
          format: title('Plot area by land check'),
        },
        'tranche-progress': {
          type: 'column-chart-stacked',
          dataMapping: { categoryKey: [{ id: 'milestones.milestone' }], valueKey: [sum('milestones.trancheUsd')], legendKey: [{ id: 'milestones.state' }] },
          format: { ...title('Milestone payments by state'), style: { theme: { common: { legend: { enabled: true } } } } },
        },
        'payouts-by-payee': {
          type: 'bar-chart-grouped',
          dataMapping: { categoryKey: [{ id: 'payouts.payee' }], valueKey: [sum('payouts.amountUsd')] },
          format: title('Paid by PayPal Payouts, by payee'),
        },
        confirmations: {
          type: 'donut-chart',
          dataMapping: { categoryKey: [{ id: 'paypalCalls.confirmedBy' }], valueKey: [{ id: 'paypalCalls.id', aggregation: 'countd' }] },
          format: title('How PayPal confirmed each payment'),
        },
        plots: {
          type: 'grid',
          dataMapping: {
            cols: [
              { id: 'plots.plot' },
              { id: 'plots.farmer' },
              { id: 'plots.variety' },
              { id: 'plots.eudrStatus' },
              sum('plots.areaHa'),
              sum('plots.lossHa'),
              sum('plots.contractValueUsd'),
              sum('plots.paidUsd'),
            ],
          },
          format: title('Plots'),
        },
        milestones: {
          type: 'grid',
          dataMapping: { cols: [{ id: 'plots.plot' }, { id: 'milestones.milestone' }, { id: 'milestones.state' }, { id: 'milestones.reason' }, { id: 'milestones.id' }, sum('milestones.trancheUsd')] },
          format: title('Milestones'),
        },
      },
      widgetLayout: {
        'kpi-value': at(0, 0, 6, 7),
        'kpi-paid': at(6, 0, 6, 7),
        'kpi-premiums': at(12, 0, 6, 7),
        'kpi-plots': at(18, 0, 6, 7),
        'eudr-readiness': at(0, 7, 8, 18),
        'tranche-progress': at(8, 7, 16, 18),
        'payouts-by-payee': at(0, 25, 14, 18),
        confirmations: at(14, 25, 10, 18),
        plots: at(0, 43, 24, 14),
        milestones: at(0, 57, 24, 18),
      },
    },
  ],
};

const token = (name: string) => `var(--at-${name})`;
const line = (color: string) => ({ width: 1, color: token(color) });
const PALETTE = ['leaf', 'monsoon', 'cherry', 'canopy-soft', 'contour', 'canopy'];

export const commandCentreTheme = studioTheme.withParams({
  fontFamily: 'var(--font-atkinson)',
  fontSize: 14,
  textColor: token('canopy'),
  foregroundColor: token('canopy'),
  subtleTextColor: token('canopy-soft'),
  backgroundColor: token('sheet'),
  borderColor: token('contour'),
  accentColor: token('leaf'),
  iconColor: token('canopy'),
  rowHoverColor: token('leaf-wash'),
  studioWrapperBorder: false,
  studioWrapperBackgroundColor: token('survey'),
  studioCanvasBorder: false,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: token('survey'),
  studioCanvasPadding: 16,
  studioCanvasRowHeight: 18,
  studioWidgetBackgroundColor: token('sheet'),
  studioWidgetBorder: line('contour'),
  studioWidgetBorderRadius: 8,
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 700,
  studioWidgetTitleTextColor: token('canopy'),
  gridFontFamily: 'var(--font-atkinson)',
  gridHeaderBackgroundColor: token('survey'),
  gridHeaderTextColor: token('canopy-soft'),
  gridRowBorder: line('contour'),
  chartFontFamily: 'var(--font-atkinson)',
  ...Object.fromEntries(PALETTE.flatMap((name, i) => [[`chartPaletteFills${i + 1}Color`, token(name)], [`chartPaletteStrokes${i + 1}Color`, token(name)]])),
});
