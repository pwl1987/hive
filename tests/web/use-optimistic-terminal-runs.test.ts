import { describe, expect, test } from 'vitest'

import type { TerminalRunSummary } from '../../web/src/api.js'
import { mergeTerminalRuns } from '../../web/src/terminal/useOptimisticTerminalRuns.js'

const terminalRun = (
  runId: string,
  agentId: string,
  agentName = 'Shell 1'
): TerminalRunSummary => ({
  agent_id: agentId,
  agent_name: agentName,
  run_id: runId,
  status: 'running',
})

describe('mergeTerminalRuns', () => {
  test('keeps an optimistic workspace shell run when another shell already exists', () => {
    const actual = [terminalRun('shell-run-1', 'ws-1:shell', 'Shell 1')]
    const optimistic = [terminalRun('shell-run-2', 'ws-1:shell', 'Shell 2')]

    expect(mergeTerminalRuns(actual, optimistic, 'ws-1')).toEqual([...actual, ...optimistic])
  })

  test('deduplicates optimistic worker runs by agent id', () => {
    const actual = [terminalRun('worker-run-1', 'worker-1', 'Alice')]
    const optimistic = [terminalRun('worker-run-2', 'worker-1', 'Alice')]

    expect(mergeTerminalRuns(actual, optimistic, 'ws-1')).toEqual(actual)
  })
})
