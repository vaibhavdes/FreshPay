'use client';

import { useMemo } from 'react';
import {
  CellStyleModule,
  ClientSideRowModelModule,
  enableDevValidations,
  RowAutoHeightModule,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
} from 'ag-grid-community';
import { MasterDetailModule } from 'ag-grid-enterprise';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { MILESTONE_LABELS, REASON_COPY } from '@/lib/claim-copy';
import type { PlotMilestone } from '@/lib/engine/stateMachine';
import { formatHa, formatUsd } from '@/lib/format';
import type { MilestoneRow, PlotRow } from '@/lib/services/contract-rows';

if (process.env.NODE_ENV !== 'production') {
  enableDevValidations();
}

const modules = [ClientSideRowModelModule, MasterDetailModule, CellStyleModule, RowAutoHeightModule];

const theme = themeQuartz.withParams({
  fontFamily: 'var(--font-atkinson)',
  fontSize: 15,
  accentColor: 'var(--at-leaf)',
  foregroundColor: 'var(--at-canopy)',
  backgroundColor: 'var(--at-sheet)',
  borderColor: 'var(--at-contour)',
  headerBackgroundColor: 'var(--at-survey)',
  headerTextColor: 'var(--at-canopy-soft)',
  headerFontWeight: 600,
  rowHoverColor: 'var(--at-leaf-wash)',
  rowHeight: 52,
});

const TONES = {
  leaf: 'bg-leaf-wash text-leaf',
  cherry: 'bg-cherry-wash text-cherry',
  monsoon: 'bg-monsoon-wash text-[#7a5408]',
  quiet: 'bg-survey text-canopy-soft',
} as const;

function Chip({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded px-2 py-0.5 text-sm font-semibold leading-6 ${TONES[tone]}`}>{children}</span>;
}

function milestoneChip(m: MilestoneRow | undefined) {
  if (!m) return null;
  if (m.state === 'RELEASED') return <Chip tone="leaf">Paid {formatUsd(m.trancheCents)}</Chip>;
  if (m.state === 'REVIEW') return <Chip tone="monsoon">Held for review</Chip>;
  if (m.opStatus === 'FAILED') return <Chip tone="cherry">Payout failed</Chip>;
  if (m.reasons.length) return <Chip tone="cherry">Refused</Chip>;
  return <Chip tone="quiet">{formatUsd(m.trancheCents)}</Chip>;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function confirmation(m: MilestoneRow) {
  if (!m.batchId) return '';
  const parts = [m.syncMs !== null && `API in ${seconds(m.syncMs)}`, m.webhookMs !== null && `webhook in ${seconds(m.webhookMs)}`].filter(Boolean);
  return `${m.learnedFrom === 'WEBHOOK' ? 'Webhook arrived first. ' : ''}${parts.join(', ')}`;
}

const SHORT_HEADERS: Record<PlotMilestone, string> = { PLOT_VERIFIED: 'Registered', INPUTS: 'Inputs', HARVEST: 'Harvest' };

const milestoneColumn = (type: PlotMilestone): ColDef<PlotRow> => ({
  headerName: SHORT_HEADERS[type],
  colId: type,
  valueGetter: ({ data }) => data?.milestones.find((m) => m.type === type)?.state,
  cellRenderer: ({ data }: ICellRendererParams<PlotRow>) => milestoneChip(data?.milestones.find((m) => m.type === type)),
  flex: 1,
  minWidth: 126,
});

const detailColumns: ColDef<MilestoneRow>[] = [
  { headerName: 'Payment', valueGetter: ({ data }) => (data ? MILESTONE_LABELS[data.type].title : ''), minWidth: 160 },
  { headerName: 'Amount', field: 'trancheCents', valueFormatter: ({ value }) => formatUsd(value), type: 'rightAligned', width: 120 },
  {
    headerName: 'Outcome',
    flex: 2,
    minWidth: 260,
    wrapText: true,
    autoHeight: true,
    cellRenderer: ({ data }: ICellRendererParams<MilestoneRow>) =>
      data && (
        <div className="py-2 leading-snug">
          {milestoneChip(data)}
          {data.state !== 'RELEASED' && data.reasons[0] && (
            <p className="mt-1 text-canopy-soft">{REASON_COPY[data.reasons[0] as keyof typeof REASON_COPY] ?? data.reasons[0]}</p>
          )}
        </div>
      ),
  },
  {
    headerName: 'Paid to',
    flex: 2,
    minWidth: 260,
    autoHeight: true,
    cellRenderer: ({ data }: ICellRendererParams<MilestoneRow>) => (
      <ul className="py-2 leading-snug">
        {data?.payouts.map((p) => (
          <li key={p.payee}>
            {p.payee} {formatUsd(p.cents)} <span className="text-canopy-soft">{p.status.toLowerCase()}</span>
          </li>
        ))}
      </ul>
    ),
  },
  { headerName: 'PayPal batch', field: 'batchId', cellClass: 'font-mono', minWidth: 170 },
  { headerName: 'Confirmed by', valueGetter: ({ data }) => (data ? confirmation(data) : ''), flex: 1, minWidth: 220, wrapText: true, autoHeight: true },
];

export function LedgerGrid({ rows }: { rows: PlotRow[] }) {
  const columns = useMemo<ColDef<PlotRow>[]>(
    () => [
      { headerName: 'Plot', field: 'plot', cellRenderer: 'agGroupCellRenderer', minWidth: 185, flex: 1.4 },
      { headerName: 'Farmer', field: 'farmer', minWidth: 138, flex: 1 },
      { headerName: 'Area', field: 'areaHa', valueFormatter: ({ value }) => formatHa(value), type: 'rightAligned', width: 84 },
      {
        headerName: 'Forest check',
        field: 'eudrStatus',
        minWidth: 150,
        cellRenderer: ({ data }: ICellRendererParams<PlotRow>) =>
          data?.eudrStatus === 'PASS' ? (
            <Chip tone="leaf">No loss since 2021</Chip>
          ) : data?.eudrStatus === 'FAIL' ? (
            <Chip tone="cherry">{formatHa(data.lossHa ?? 0)} cleared</Chip>
          ) : (
            <Chip tone="monsoon">Needs review</Chip>
          ),
      },
      milestoneColumn('PLOT_VERIFIED'),
      milestoneColumn('INPUTS'),
      milestoneColumn('HARVEST'),
      { headerName: 'Paid', field: 'paidCents', valueFormatter: ({ value }) => formatUsd(value), type: 'rightAligned', width: 105 },
    ],
    [],
  );

  return (
    <AgGridProvider modules={modules}>
      <AgGridReact<PlotRow>
        theme={theme}
        rowData={rows}
        columnDefs={columns}
        getRowId={({ data }) => data.plotId}
        domLayout="autoHeight"
        masterDetail
        detailRowAutoHeight
        detailCellRendererParams={{
          detailGridOptions: { columnDefs: detailColumns, domLayout: 'autoHeight', getRowId: ({ data }: { data: MilestoneRow }) => data.id },
          getDetailRowData: ({ data, successCallback }: { data: PlotRow; successCallback: (rows: MilestoneRow[]) => void }) => successCallback(data.milestones),
        }}
      />
    </AgGridProvider>
  );
}
