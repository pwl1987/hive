import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, LoaderCircle, Plus, RotateCcw, Terminal, X } from 'lucide-react'

import type { WorkspaceSummary } from '../../../src/shared/types.js'
import type { TerminalRunSummary } from '../api.js'
import { useI18n } from '../i18n.js'
import { EmptyState } from '../ui/EmptyState.js'
import { Tooltip } from '../ui/Tooltip.js'

type WorkspaceShellDialogProps = {
  activeRunId: string | null
  error: string | null
  onActiveRunChange: (runId: string) => void
  onCloseTab: (runId: string) => void
  onClose: () => void
  onNewTab: () => void
  open: boolean
  shellRuns: TerminalRunSummary[]
  starting: boolean
  workspace: WorkspaceSummary
}

export const WorkspaceShellDialog = ({
  activeRunId,
  error,
  onActiveRunChange,
  onCloseTab,
  onClose,
  onNewTab,
  open,
  shellRuns,
  starting,
  workspace,
}: WorkspaceShellDialogProps) => {
  const { t } = useI18n()
  const activeRun = shellRuns.find((run) => run.run_id === activeRunId) ?? shellRuns[0]
  const runId = activeRun?.run_id ?? null

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="app-overlay fixed inset-0 z-40" />
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
          <Dialog.Content
            aria-label={t('shellTerminal.title')}
            className="dialog-scale-pop pointer-events-auto flex w-[min(1440px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border shadow-2xl"
            data-testid="workspace-shell-dialog"
            onEscapeKeyDown={(event) => event.preventDefault()}
            style={{
              background: 'var(--bg-1)',
              borderColor: 'var(--border)',
              height: 'calc(100vh - 32px)',
            }}
          >
            <div
              className="flex shrink-0 items-center gap-3 border-b px-4 py-3"
              style={{ borderColor: 'var(--border)' }}
            >
              <div
                className="flex h-8 w-8 items-center justify-center rounded border text-sec"
                style={{ borderColor: 'var(--border-bright)', background: 'var(--bg-2)' }}
              >
                <Terminal size={16} aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="truncate text-sm font-medium text-pri">
                  {t('shellTerminal.title')}
                </Dialog.Title>
                <Dialog.Description className="mono truncate text-xs text-ter">
                  {t('shellTerminal.subtitle', { path: workspace.path })}
                </Dialog.Description>
              </div>
              <Tooltip label={t('common.close')}>
                <Dialog.Close asChild>
                  <button type="button" aria-label={t('common.close')} className="float-action">
                    <X size={14} aria-hidden />
                  </button>
                </Dialog.Close>
              </Tooltip>
            </div>

            <div
              className="flex min-h-10 shrink-0 items-center gap-1 border-b px-3 py-1.5"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-2)' }}
              role="tablist"
              aria-label={t('shellTerminal.title')}
            >
              {shellRuns.map((run) => {
                const selected = run.run_id === runId
                return (
                  <div
                    key={run.run_id}
                    className="group flex max-w-[220px] items-center rounded border"
                    style={{
                      background: selected ? 'var(--bg-3)' : 'transparent',
                      borderColor: selected ? 'var(--border-bright)' : 'transparent',
                      color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => onActiveRunChange(run.run_id)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1 text-xs"
                      data-testid={`workspace-shell-tab-${run.run_id}`}
                    >
                      <Terminal size={12} aria-hidden />
                      <span className="truncate">{run.agent_name}</span>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50" />
                    </button>
                    <Tooltip label={t('shellTerminal.closeTab', { name: run.agent_name })}>
                      <button
                        type="button"
                        aria-label={t('shellTerminal.closeTab', { name: run.agent_name })}
                        className="mr-1 rounded p-0.5 opacity-60 hover:bg-2 hover:opacity-100"
                        data-testid={`workspace-shell-close-tab-${run.run_id}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          onCloseTab(run.run_id)
                        }}
                      >
                        <X size={12} aria-hidden />
                      </button>
                    </Tooltip>
                  </div>
                )
              })}
              <button
                type="button"
                className="icon-btn icon-btn--tertiary h-7 px-2 text-xs"
                onClick={onNewTab}
                disabled={starting}
                data-testid="workspace-shell-new-tab"
              >
                {starting ? (
                  <LoaderCircle size={12} className="animate-spin" aria-hidden />
                ) : (
                  <Plus size={12} aria-hidden />
                )}
                {t('shellTerminal.newTab')}
              </button>
            </div>

            {error ? (
              <div
                role="alert"
                className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs"
                style={{
                  background: 'color-mix(in oklab, var(--status-red) 10%, transparent)',
                  borderColor: 'color-mix(in oklab, var(--status-red) 30%, var(--border))',
                  color: 'var(--status-red)',
                }}
              >
                <AlertTriangle size={12} aria-hidden />
                <span className="break-words">{t('shellTerminal.failed', { message: error })}</span>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 p-3">
              <div
                className="flex h-full min-h-0 rounded-lg border"
                style={{ background: 'var(--bg-crust)', borderColor: 'var(--border)' }}
              >
                {runId ? (
                  <div
                    id={`shell-pty-${runId}`}
                    className="flex h-full w-full"
                    data-testid="workspace-shell-terminal-slot"
                    data-pty-slot="shell"
                  />
                ) : (
                  <EmptyState
                    icon={
                      starting ? (
                        <LoaderCircle size={28} className="animate-spin" />
                      ) : (
                        <Terminal size={28} />
                      )
                    }
                    title={starting ? t('shellTerminal.starting') : t('shellTerminal.title')}
                    description={t('shellTerminal.description')}
                    action={
                      <button
                        type="button"
                        onClick={onNewTab}
                        disabled={starting}
                        className="icon-btn icon-btn--primary"
                      >
                        <RotateCcw size={14} aria-hidden />
                        {starting ? t('common.starting') : t('shellTerminal.newTab')}
                      </button>
                    }
                  />
                )}
              </div>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
