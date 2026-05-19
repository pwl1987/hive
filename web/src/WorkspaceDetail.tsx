import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { TeamListItem, WorkspaceSummary } from '../../src/shared/types.js'
import {
  closeWorkspaceShell,
  isWorkspaceShellRun,
  type OrchestratorStartResult,
  renameWorker,
  startWorkspaceShell,
  type TerminalRunSummary,
} from './api.js'
import { useI18n } from './i18n.js'
import { WorkspaceNotifications } from './notifications/WorkspaceNotifications.js'
import { TerminalBottomPanel } from './terminal/TerminalBottomPanel.js'
import { useTerminalPanelTabs } from './terminal/useTerminalPanelTabs.js'
import { useToast } from './ui/useToast.js'
import { usePaneSplit } from './usePaneSplit.js'
import { AddWorkerDialog } from './worker/AddWorkerDialog.js'
import { OrchestratorPane } from './worker/OrchestratorPane.js'
import { useOrchestratorPaneState } from './worker/useOrchestratorPaneState.js'
import { useWorkerComposer } from './worker/useWorkerComposer.js'
import { WelcomePane } from './worker/WelcomePane.js'
import { WorkersPane } from './worker/WorkersPane.js'

type WorkspaceDetailProps = {
  onCreateWorker: WorkerActions['createWorker']
  onDeleteWorker: (workerId: string) => Promise<void>
  onDeleteWorkspace: (workspace: WorkspaceSummary) => Promise<void>
  onStartWorker: (workerId: string) => Promise<{ error: string | null; runId: string | null }>
  onOrchestratorResult: (workspaceId: string, result: OrchestratorStartResult) => void
  onRequestAddWorkspace: () => void
  onShellRunStarted?: (workspaceId: string, run: TerminalRunSummary) => void
  onTryDemo?: () => void
  welcomeDisabledReason?: string
  orchestratorAutostartError: string | null
  orchestratorAutostartRunId: string | null
  terminalRuns: TerminalRunSummary[]
  workers: TeamListItem[]
  workspace: WorkspaceSummary | undefined
}

export const WorkspaceDetail = ({
  onCreateWorker,
  onDeleteWorker,
  onDeleteWorkspace,
  onStartWorker,
  onOrchestratorResult,
  onRequestAddWorkspace,
  onShellRunStarted,
  onTryDemo,
  welcomeDisabledReason,
  orchestratorAutostartError,
  orchestratorAutostartRunId,
  terminalRuns,
  workers,
  workspace,
}: WorkspaceDetailProps) => {
  const { t } = useI18n()
  const [composerOpen, setComposerOpen] = useState(false)
  const [deleteWorkerError, setDeleteWorkerError] = useState<string | null>(null)
  const [shellError, setShellError] = useState<string | null>(null)
  const [shellRunId, setShellRunId] = useState<string | null>(null)
  const [shellStarting, setShellStarting] = useState(false)
  const [startWorkerError, setStartWorkerError] = useState<string | null>(null)
  const [startingWorkerId, setStartingWorkerId] = useState<string | null>(null)
  // Synchronous lock so a fast double-click on the "+" tab button can't fire
  // startWorkspaceShell twice before React commits `disabled={shellStarting}`.
  // The server's shell numbering counter would otherwise skip ahead, leaving
  // the user with shells named "Shell 1" / "Shell 3" / ... .
  const shellStartInFlightByWorkspaceRef = useRef(new Map<string, number>())
  const shellStartRequestSeqRef = useRef(0)
  const closingShellRunIdsByWorkspaceRef = useRef(new Map<string, Set<string>>())
  const closingShellPromisesByWorkspaceRef = useRef(new Map<string, Map<string, Promise<void>>>())
  const shellStartAfterCloseByWorkspaceRef = useRef(new Set<string>())
  const selectedWorkspaceIdRef = useRef<string | null>(workspace?.id ?? null)
  const toast = useToast()
  const composer = useWorkerComposer({ createWorker: onCreateWorker, open: composerOpen })

  const markClosingShellRun = useCallback((workspaceId: string, runId: string) => {
    const ids = closingShellRunIdsByWorkspaceRef.current.get(workspaceId) ?? new Set<string>()
    ids.add(runId)
    closingShellRunIdsByWorkspaceRef.current.set(workspaceId, ids)
  }, [])

  const trackClosingShellPromise = useCallback(
    (workspaceId: string, runId: string, promise: Promise<void>) => {
      const workspacePromises =
        closingShellPromisesByWorkspaceRef.current.get(workspaceId) ??
        new Map<string, Promise<void>>()
      workspacePromises.set(runId, promise)
      closingShellPromisesByWorkspaceRef.current.set(workspaceId, workspacePromises)
      void promise
        .finally(() => {
          const current = closingShellPromisesByWorkspaceRef.current.get(workspaceId)
          if (!current) return
          current.delete(runId)
          if (current.size === 0) closingShellPromisesByWorkspaceRef.current.delete(workspaceId)
        })
        .catch(() => {})
    },
    []
  )

  const unmarkClosingShellRun = useCallback((workspaceId: string, runId: string) => {
    const ids = closingShellRunIdsByWorkspaceRef.current.get(workspaceId)
    if (!ids) return
    ids.delete(runId)
    if (ids.size === 0) closingShellRunIdsByWorkspaceRef.current.delete(workspaceId)
  }, [])

  // Surface composer / delete errors as toasts instead of inline alert bands.
  useEffect(() => {
    if (composer.createWorkerError)
      toast.show({ kind: 'error', message: composer.createWorkerError })
  }, [composer.createWorkerError, toast])

  useEffect(() => {
    if (deleteWorkerError) toast.show({ kind: 'error', message: deleteWorkerError })
  }, [deleteWorkerError, toast])

  // Start failures no longer have a modal banner to display them — surface
  // via toast to keep parity with delete-error feedback.
  useEffect(() => {
    if (startWorkerError) toast.show({ kind: 'error', message: startWorkerError })
  }, [startWorkerError, toast])

  // Shell-start failures no longer have a dialog banner — surface via toast.
  useEffect(() => {
    if (shellError) toast.show({ kind: 'error', message: shellError })
  }, [shellError, toast])

  useLayoutEffect(() => {
    selectedWorkspaceIdRef.current = workspace?.id ?? null
  }, [workspace?.id])

  useEffect(
    () => () => {
      closingShellRunIdsByWorkspaceRef.current.clear()
      closingShellPromisesByWorkspaceRef.current.clear()
      shellStartAfterCloseByWorkspaceRef.current.clear()
    },
    []
  )

  useEffect(() => {
    if (!workspace) return
    const closingIds = closingShellRunIdsByWorkspaceRef.current.get(workspace.id)
    if (!closingIds) return
    const liveShellRunIds = new Set(
      terminalRuns.filter((run) => isWorkspaceShellRun(run, workspace.id)).map((run) => run.run_id)
    )
    for (const runId of Array.from(closingIds)) {
      if (!liveShellRunIds.has(runId)) unmarkClosingShellRun(workspace.id, runId)
    }
  }, [terminalRuns, unmarkClosingShellRun, workspace])

  // B2: when the user switches workspace, clear local error state so we don't
  // surface a stale error from the previous workspace as a fresh toast.
  // biome-ignore lint/correctness/useExhaustiveDependencies: effect intentionally fires only on workspace switch
  useEffect(() => {
    setDeleteWorkerError(null)
    setShellError(null)
    setShellRunId(null)
    setShellStarting(false)
    setStartWorkerError(null)
    setStartingWorkerId(null)
  }, [workspace?.id])
  const orchestrator = useOrchestratorPaneState({
    workspaceId: workspace?.id ?? '',
    terminalRuns,
    autostartError: orchestratorAutostartError,
    suppressAutostartRunId: orchestratorAutostartRunId,
    onClearAutostartError: () => {
      if (workspace) onOrchestratorResult(workspace.id, { ok: true, error: null, run_id: null })
    },
    onAfterStart: (result) => {
      if (workspace) onOrchestratorResult(workspace.id, result)
    },
  })
  const split = usePaneSplit()
  const panelTabs = useTerminalPanelTabs({
    workspaceId: workspace?.id ?? '',
    workers,
    terminalRuns,
  })

  if (!workspace) {
    const welcomeProps: {
      onAddWorkspace: () => void
      onTryDemo?: () => void
      disabledReason?: string
    } = { onAddWorkspace: onRequestAddWorkspace }
    if (onTryDemo) welcomeProps.onTryDemo = onTryDemo
    if (welcomeDisabledReason) welcomeProps.disabledReason = welcomeDisabledReason
    return <WelcomePane {...welcomeProps} />
  }

  const shellRuns = terminalRuns.filter((run) => isWorkspaceShellRun(run, workspace.id))
  const activeShellRun = shellRuns.find((run) => run.run_id === shellRunId) ?? shellRuns[0] ?? null
  const activeShellRunId = activeShellRun?.run_id ?? null

  const handleDeleteWorker = (worker: TeamListItem) => {
    setDeleteWorkerError(null)
    void onDeleteWorker(worker.id).catch((error) => {
      setDeleteWorkerError(error instanceof Error ? error.message : String(error))
    })
  }

  const handleStartWorker = (worker: TeamListItem) => {
    setStartWorkerError(null)
    setStartingWorkerId(worker.id)
    void onStartWorker(worker.id)
      .then(({ error }) => {
        if (error) setStartWorkerError(error)
      })
      .catch((error) => {
        setStartWorkerError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setStartingWorkerId(null))
  }

  const handleRenameWorker = async (
    worker: TeamListItem,
    newName: string
  ): Promise<{ error: string | null }> => {
    try {
      await renameWorker(workspace.id, worker.id, newName)
      toast.show({
        kind: 'success',
        message: t('worker.renameSuccess', { name: newName }),
      })
      return { error: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.show({ kind: 'error', message: t('worker.renameFailed', { message }) })
      return { error: message }
    }
  }

  const startShell = () => {
    if (shellStartInFlightByWorkspaceRef.current.has(workspace.id)) return
    const requestWorkspaceId = workspace.id
    const requestSeq = shellStartRequestSeqRef.current + 1
    shellStartRequestSeqRef.current = requestSeq
    shellStartInFlightByWorkspaceRef.current.set(requestWorkspaceId, requestSeq)
    const isSelectedWorkspace = () => selectedWorkspaceIdRef.current === requestWorkspaceId
    const ownsInFlightMarker = () =>
      shellStartInFlightByWorkspaceRef.current.get(requestWorkspaceId) === requestSeq
    setShellError(null)
    setShellStarting(true)
    void startWorkspaceShell(requestWorkspaceId)
      .then((run) => {
        onShellRunStarted?.(requestWorkspaceId, run)
        if (!isSelectedWorkspace()) return
        setShellRunId(run.run_id)
        panelTabs.openShellTab(run.run_id)
      })
      .catch((error) => {
        if (!isSelectedWorkspace()) return
        setShellError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (ownsInFlightMarker())
          shellStartInFlightByWorkspaceRef.current.delete(requestWorkspaceId)
        if (isSelectedWorkspace()) setShellStarting(false)
      })
  }

  const startShellAfterClosingRuns = () => {
    const requestWorkspaceId = workspace.id
    if (
      shellStartInFlightByWorkspaceRef.current.has(requestWorkspaceId) ||
      shellStartAfterCloseByWorkspaceRef.current.has(requestWorkspaceId)
    ) {
      return
    }

    const closingPromises = Array.from(
      closingShellPromisesByWorkspaceRef.current.get(requestWorkspaceId)?.values() ?? []
    )
    if (closingPromises.length === 0) {
      startShell()
      return
    }

    shellStartAfterCloseByWorkspaceRef.current.add(requestWorkspaceId)
    setShellError(null)
    setShellStarting(true)
    void Promise.allSettled(closingPromises)
      .then((results) => {
        if (results.some((result) => result.status === 'rejected')) return
        if (selectedWorkspaceIdRef.current !== requestWorkspaceId) return
        if (shellStartInFlightByWorkspaceRef.current.has(requestWorkspaceId)) return
        startShell()
      })
      .finally(() => {
        shellStartAfterCloseByWorkspaceRef.current.delete(requestWorkspaceId)
        if (
          selectedWorkspaceIdRef.current === requestWorkspaceId &&
          !shellStartInFlightByWorkspaceRef.current.has(requestWorkspaceId)
        ) {
          setShellStarting(false)
        }
      })
  }

  const openShell = () => {
    if (shellStartInFlightByWorkspaceRef.current.has(workspace.id) || shellStarting) return
    const existingShellTab = panelTabs.tabs.find((tab) => tab.kind === 'shell')
    if (existingShellTab) {
      panelTabs.setActive(existingShellTab.id)
      return
    }
    const closingShellRunIds =
      closingShellRunIdsByWorkspaceRef.current.get(workspace.id) ?? new Set<string>()
    const reusableShellRun = shellRuns.find((run) => !closingShellRunIds.has(run.run_id))
    if (reusableShellRun) {
      setShellRunId(reusableShellRun.run_id)
      panelTabs.openShellTab(reusableShellRun.run_id)
      return
    }
    if (closingShellRunIds.size > 0) {
      startShellAfterClosingRuns()
      return
    }
    startShell()
  }

  const closeShellTab = (runId: string) => {
    const fallbackRun = shellRuns.find((run) => run.run_id !== runId) ?? null
    if (activeShellRunId === runId) setShellRunId(fallbackRun?.run_id ?? null)
    markClosingShellRun(workspace.id, runId)
    const closePromise = closeWorkspaceShell(workspace.id, runId).catch((error) => {
      unmarkClosingShellRun(workspace.id, runId)
      const message = error instanceof Error ? error.message : String(error)
      toast.show({ kind: 'error', message: t('shellTerminal.closeFailed', { message }) })
      throw error
    })
    trackClosingShellPromise(workspace.id, runId, closePromise)
    void closePromise.catch(() => {})
  }

  const orchWidth = `${(split.orchPct * 100).toFixed(2)}%`

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={{ background: 'var(--bg-2)' }}>
      <WorkspaceNotifications terminalRuns={terminalRuns} workers={workers} workspace={workspace} />
      <div ref={split.containerRef} className="relative flex min-h-0 flex-1">
        <div
          className="flex min-w-[480px] shrink-0 flex-col"
          style={{ width: orchWidth }}
          data-testid="orchestrator-pane-shell"
        >
          <OrchestratorPane
            state={orchestrator.state}
            onStop={orchestrator.stop}
            onRemoveWorkspace={() => {
              if (!workspace) return
              void onDeleteWorkspace(workspace).catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error)
                toast.show({ kind: 'error', message: `Delete failed: ${message}` })
              })
            }}
            onStart={orchestrator.start}
            onRestart={orchestrator.restart}
          />
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: <hr> can't host pointer/keyboard handlers and the visible accent line; aria role="separator" is the canonical resize-handle role */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('workerPane.resize')}
          aria-valuenow={Math.round(split.orchPct * 100)}
          aria-valuemin={30}
          aria-valuemax={78}
          tabIndex={0}
          className="pane-splitter"
          style={{ left: `calc(${orchWidth} - 4px)` }}
          data-dragging={split.dragging || undefined}
          data-testid="pane-splitter"
          onPointerDown={split.beginDrag}
          onKeyDown={split.onKeyDown}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <WorkersPane
            onAddWorkerClick={() => setComposerOpen(true)}
            onDeleteWorker={handleDeleteWorker}
            onOpenShellTerminal={openShell}
            onOpenWorker={(worker) => panelTabs.openWorkerTab(worker.id)}
            onRenameWorker={handleRenameWorker}
            onStartWorker={handleStartWorker}
            startingWorkerId={startingWorkerId}
            terminalRuns={terminalRuns}
            workers={workers}
          />
          <TerminalBottomPanel
            tabs={panelTabs.tabs}
            activeId={panelTabs.activeId}
            onSelect={panelTabs.setActive}
            onClose={(tabId) => {
              if (tabId.startsWith('shell:')) {
                const runId = tabId.slice('shell:'.length)
                closeShellTab(runId)
              }
              panelTabs.closeTab(tabId)
            }}
            onNewShell={startShell}
            newShellPending={shellStarting}
            onStartWorker={(workerId) => {
              const worker = workers.find((w) => w.id === workerId)
              if (worker) handleStartWorker(worker)
            }}
            startingWorkerId={startingWorkerId}
          />
        </div>
      </div>
      {composerOpen ? (
        <AddWorkerDialog
          commandPresets={composer.commandPresets}
          commandPresetId={composer.commandPresetId}
          creating={composer.creating}
          onClose={() => setComposerOpen(false)}
          onNameChange={composer.setWorkerName}
          onPresetChange={composer.setCommandPresetId}
          onRandomName={composer.randomizeWorkerName}
          onRoleDescriptionChange={composer.setRoleDescription}
          onRoleDescriptionReset={composer.resetRoleDescription}
          onRoleChange={composer.setWorkerRole}
          onSubmit={(event) => composer.submit(event, () => setComposerOpen(false))}
          onStartupCommandChange={composer.setStartupCommand}
          roleDescription={composer.roleDescription}
          roleDescriptionDefault={composer.roleDescriptionDefault}
          startupCommand={composer.startupCommand}
          workerName={composer.workerName}
          workerRole={composer.workerRole}
        />
      ) : null}
    </div>
  )
}
