'use client';

import { useState } from 'react';
import { createAiHarness, directLlmRunner, type AgAiHarnessSetup, type AgAiPromptStarter, type AgAiToolDetailParams, type AgStudioApi } from 'ag-studio';
import type { AgAiToolDisplay } from 'ag-studio-react';
import { geminiAdapter } from './gemini-adapter';

const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: 'Land check', prompt: 'Which plots failed the land check or still need one, and what does it cost us?' },
  { label: 'Held claims', prompt: 'Which claims are held for review, how much are they worth, and should they be approved?' },
  { label: 'Unpaid harvest', prompt: 'Show the plots whose harvest payment is still open, largest first.' },
  { label: 'Check PayPal', prompt: 'What does PayPal itself show as paid out to farmers and dealers in the last 7 days?' },
];

type Proposal = { milestoneIds: string[]; reason: string };

// The agent may only propose. Paying still goes through the cooperative's approval and the gate.
function proposeApprovals(api: AgStudioApi) {
  return api.defineAiTool({
    name: 'proposeApprovals',
    description:
      'Propose approving claims that are held for review (milestones whose state is "Held for review"). This does not pay anyone: ' +
      'it shows the officer an Approve button, and payment rules are checked again on approval. Use milestone ids from the milestones table.',
    params: (s) => s.object({ milestoneIds: s.array(s.string()), reason: s.string() }),
    execute: ({ milestoneIds, reason }, ctx) =>
      milestoneIds.length
        ? ctx.success(`Proposed approving ${milestoneIds.length} held claim(s). The officer decides with the Approve button.`, { milestoneIds, reason })
        : ctx.error('Name at least one held milestone to propose.'),
  });
}

export function buildComplianceAgent(): AgAiHarnessSetup {
  const adapter = geminiAdapter();
  return ({ api }) =>
    createAiHarness(api, ({ builtIn }) => ({
      primary: 'lead',
      promptStarters: PROMPT_STARTERS,
      agents: [
        directLlmRunner({
          ...builtIn.lead,
          adapter,
          tools: (ctx, params) => [...(builtIn.lead.tools?.(ctx, params as never) ?? []), proposeApprovals(api)],
        }),
        directLlmRunner({ ...builtIn.data, adapter }),
        directLlmRunner({ ...builtIn.page, adapter }),
        directLlmRunner({ ...builtIn.planning, adapter }),
        directLlmRunner({ ...builtIn.widget, adapter }),
      ],
    }));
}

function ApprovalProposal({ args, status, result }: AgAiToolDetailParams<Proposal>) {
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle');
  const [outcome, setOutcome] = useState<string[]>([]);
  const ids = status === 'done' && result?.success ? (args.milestoneIds ?? []) : [];

  async function approve() {
    setState('working');
    const lines: string[] = [];
    for (const id of ids) {
      const res = await fetch(`/api/milestones/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', note: `Approved from the agent's proposal: ${args.reason ?? ''}`.slice(0, 500) }),
      });
      const body = (await res.json().catch(() => ({}))) as { decision?: { kind: string; reasons?: string[] }; payoutBatchId?: string };
      lines.push(body.decision?.kind === 'RELEASE' ? `${id}: paid${body.payoutBatchId ? `, batch ${body.payoutBatchId}` : ''}` : `${id}: not paid (${body.decision?.reasons?.join(', ') ?? 'error'})`);
    }
    setOutcome(lines);
    setState('done');
  }

  if (!ids.length) return null;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p>{args.reason}</p>
      {state === 'done' ? (
        <ul>{outcome.map((line) => <li key={line}>{line}</li>)}</ul>
      ) : (
        <button type="button" onClick={approve} disabled={state === 'working'} style={{ padding: '8px 12px', borderRadius: 6, background: 'var(--at-leaf)', color: 'var(--at-sheet)', fontWeight: 600 }}>
          {state === 'working' ? 'Approving' : `Approve ${ids.length} claim(s)`}
        </button>
      )}
    </div>
  );
}

export const AI_TOOL_DISPLAY: Record<string, AgAiToolDisplay> = {
  proposeApprovals: {
    label: ({ args }) => ({ text: 'Proposed approvals', pill: `${(args as Partial<Proposal>).milestoneIds?.length ?? 0}` }),
    detail: ApprovalProposal as AgAiToolDisplay['detail'],
  },
};
