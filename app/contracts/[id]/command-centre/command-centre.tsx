'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { AgStudioAiModule, enableStudioDevValidations } from 'ag-studio';
import { AgStudio, AgStudioProvider, type AgRegistry } from 'ag-studio-react';
import type { CommandCentreData } from '@/lib/services/command-centre';
import { AI_TOOL_DISPLAY, buildComplianceAgent } from './ai';
import { buildStudioData, commandCentreReport, commandCentreTheme } from './studio';

if (process.env.NODE_ENV !== 'production') enableStudioDevValidations();

const noSubscription = () => () => {};

export function CommandCentre({ data, licenseKey, agentEnabled }: { data: CommandCentreData; licenseKey?: string; agentEnabled: boolean }) {
  // AG Studio renders in the browser only.
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  const sources = useMemo(() => buildStudioData(data), [data]);
  const ai = useMemo(() => (agentEnabled ? buildComplianceAgent() : undefined), [agentEnabled]);

  if (!inBrowser) return <div className="h-[80vh] animate-pulse rounded-lg bg-sheet" />;
  return (
    <AgStudioProvider licenseKey={licenseKey} modules={[AgStudioAiModule]}>
      <AgStudio<AgRegistry>
        style={{ height: '82vh' }}
        theme={commandCentreTheme}
        data={sources}
        initialState={commandCentreReport}
        mode="view"
        ai={ai}
        aiToolDisplay={AI_TOOL_DISPLAY}
      />
    </AgStudioProvider>
  );
}
