// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { TerminalRunSummary } from '../../web/src/api.js'
import { WorkspaceShellDialog } from '../../web/src/terminal/WorkspaceShellDialog.js'

const workspace = {
  id: 'workspace-1',
  name: 'Hive',
  path: '/tmp/hive',
}

const shellRuns: TerminalRunSummary[] = [
  {
    agent_id: 'workspace-1:shell',
    agent_name: 'Shell 1',
    run_id: 'run-shell-1',
    status: 'running',
  },
  {
    agent_id: 'workspace-1:shell',
    agent_name: 'Shell 2',
    run_id: 'run-shell-2',
    status: 'running',
  },
]

afterEach(cleanup)

describe('WorkspaceShellDialog', () => {
  test('switches terminal tabs and closes one shell tab without closing the dialog', () => {
    const onActiveRunChange = vi.fn()
    const onCloseTab = vi.fn()
    const onClose = vi.fn()
    const onNewTab = vi.fn()

    render(
      <WorkspaceShellDialog
        activeRunId="run-shell-1"
        error={null}
        onActiveRunChange={onActiveRunChange}
        onClose={onClose}
        onCloseTab={onCloseTab}
        onNewTab={onNewTab}
        open={true}
        shellRuns={shellRuns}
        starting={false}
        workspace={workspace}
      />
    )

    expect(screen.getByTestId('workspace-shell-terminal-slot')).toHaveAttribute(
      'id',
      'shell-pty-run-shell-1'
    )

    fireEvent.click(screen.getByTestId('workspace-shell-tab-run-shell-2'))
    expect(onActiveRunChange).toHaveBeenCalledWith('run-shell-2')

    fireEvent.click(screen.getByTestId('workspace-shell-close-tab-run-shell-1'))
    expect(onCloseTab).toHaveBeenCalledWith('run-shell-1')
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('workspace-shell-new-tab'))
    expect(onNewTab).toHaveBeenCalledTimes(1)
  })
})
