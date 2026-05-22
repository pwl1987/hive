import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useMemo, useState } from 'react'

import type { MarketplaceAgentEntry } from '../api.js'
import { useI18n } from '../i18n.js'
import { sortCategoriesForDisplay } from './categoryLabels.js'
import { MarketplaceAgentCard } from './MarketplaceAgentCard.js'
import { MarketplaceAgentPreview } from './MarketplaceAgentPreview.js'
import { MarketplaceCategoryTree } from './MarketplaceCategoryTree.js'
import { useMarketplace } from './useMarketplace.js'

// Categories surfaced by default in the marketplace. 200+ agents include many
// off-topic roles (marketing, game-dev, academic, etc.) that a CLI-coding tool
// doesn't need front-and-center. User can click "Show all categories" to
// surface the rest.
const CORE_CATEGORIES: ReadonlySet<string> = new Set([
  'engineering',
  'design',
  'product',
  'testing',
  'project-management',
  'specialized',
  'integrations',
])

interface MarketplaceDrawerProps {
  open: boolean
  onClose: () => void
  onImport: (detail: { name: string; description: string }) => void
  importedNames?: ReadonlySet<string>
}

export const MarketplaceDrawer = ({
  open,
  onClose,
  onImport,
  importedNames,
}: MarketplaceDrawerProps) => {
  const { t, language } = useI18n()
  const { manifestState, loadAgent } = useMarketplace(language, open)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<MarketplaceAgentEntry | null>(null)
  const [query, setQuery] = useState('')
  const [showAllCategories, setShowAllCategories] = useState(false)

  // Switching UI language repoints `useMarketplace` to the other repo's
  // manifest. Anything that referenced an entry by path/name in the old
  // language would silently mis-render (preview would 404 against the new
  // fs tree), so drop selection on language change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: language is the trigger; setters are stable
  useEffect(() => {
    setSelectedAgent(null)
    setSelectedCategory(null)
  }, [language])

  const handleOpenChange = (next: boolean) => {
    if (!next) onClose()
  }

  const manifest = manifestState.data

  const categoryCounts = useMemo(() => {
    if (!manifest) return {}
    const counts: Record<string, number> = {}
    for (const agent of manifest.agents) {
      counts[agent.category] = (counts[agent.category] ?? 0) + 1
    }
    return counts
  }, [manifest])

  const visibleCategories = useMemo(() => {
    if (!manifest) return [] as readonly string[]
    const filtered = showAllCategories
      ? manifest.categories
      : manifest.categories.filter((category) => CORE_CATEGORIES.has(category))
    return sortCategoriesForDisplay(filtered, language)
  }, [manifest, showAllCategories, language])

  const hiddenCategoryCount = useMemo(() => {
    if (!manifest) return 0
    return manifest.categories.length - visibleCategories.length
  }, [manifest, visibleCategories])

  const filteredAgents = useMemo(() => {
    if (!manifest) return []
    const lower = query.trim().toLowerCase()
    return manifest.agents.filter((agent) => {
      if (selectedCategory) {
        if (agent.category !== selectedCategory) return false
      } else if (!showAllCategories && !CORE_CATEGORIES.has(agent.category)) {
        return false
      }
      if (!lower) return true
      return (
        agent.name.toLowerCase().includes(lower) || agent.description.toLowerCase().includes(lower)
      )
    })
  }, [manifest, query, selectedCategory, showAllCategories])

  const handleToggleShowAll = () => {
    setShowAllCategories((current) => {
      const next = !current
      if (!next) {
        // Collapsing back to core view: if the selected category or selected
        // agent's category is now hidden, clear them — otherwise the preview
        // pane lingers on an agent whose card is no longer in the grid.
        if (selectedCategory && !CORE_CATEGORIES.has(selectedCategory)) {
          setSelectedCategory(null)
        }
        if (selectedAgent && !CORE_CATEGORIES.has(selectedAgent.category)) {
          setSelectedAgent(null)
        }
      }
      return next
    })
  }

  const handleImport = (detail: { name: string; description: string }) => {
    onImport(detail)
    setSelectedAgent(null)
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="marketplace-overlay"
          className="app-overlay fixed inset-0 z-40"
        />
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
          <Dialog.Content
            data-testid="marketplace-content"
            className="dialog-scale-pop elev-2 pointer-events-auto flex max-h-[calc(100vh-32px)] w-full flex-col rounded-lg border"
            style={{
              background: 'var(--bg-elevated)',
              borderColor: 'var(--border-bright)',
              width: 'min(1280px, calc(100vw - 32px))',
            }}
          >
            <header
              className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-3"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex flex-col gap-0.5">
                <Dialog.Title className="text-base font-semibold text-pri">
                  {t('marketplace.title')}
                </Dialog.Title>
                <Dialog.Description className="text-xs text-ter">
                  {manifest ? t('marketplace.sourceLabel', { repo: manifest.source.repo }) : ' '}
                </Dialog.Description>
              </div>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('marketplace.searchPlaceholder')}
                data-testid="marketplace-search"
                className="w-72 rounded border px-3 py-1.5 text-sm text-pri outline-none focus:border-bright"
                style={{
                  background: 'var(--bg-2)',
                  borderColor: 'var(--border)',
                }}
              />
            </header>
            <div
              className="grid min-h-0 flex-1 divide-x transition-[grid-template-columns] duration-200 ease-out"
              style={{
                borderColor: 'var(--border)',
                gridTemplateColumns: selectedAgent
                  ? '200px minmax(0, 1fr) 380px'
                  : '200px minmax(0, 1fr)',
              }}
            >
              <aside className="min-h-0 overflow-y-auto px-3 py-3">
                {manifest ? (
                  <MarketplaceCategoryTree
                    categories={visibleCategories}
                    selected={selectedCategory}
                    onSelect={(category) => {
                      setSelectedCategory(category)
                      setSelectedAgent(null)
                    }}
                    counts={categoryCounts}
                    showAll={showAllCategories}
                    onToggleShowAll={handleToggleShowAll}
                    hiddenCount={hiddenCategoryCount}
                  />
                ) : null}
              </aside>
              <section
                className="min-h-0 overflow-y-auto px-3 py-3"
                data-testid="marketplace-agent-grid"
              >
                {manifestState.status === 'loading' ? <p className="text-sm text-ter">…</p> : null}
                {manifestState.status === 'error' ? (
                  <p className="text-sm text-ter">
                    {t('marketplace.loadFailed')}: {manifestState.error}
                  </p>
                ) : null}
                {manifestState.status === 'loaded' && filteredAgents.length === 0 ? (
                  <p className="text-sm text-ter">{t('marketplace.empty')}</p>
                ) : null}
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
                >
                  {filteredAgents.map((agent) => (
                    <MarketplaceAgentCard
                      key={agent.path}
                      agent={agent}
                      selected={selectedAgent?.path === agent.path}
                      imported={importedNames?.has(agent.name) ?? false}
                      onSelect={() => setSelectedAgent(agent)}
                    />
                  ))}
                </div>
              </section>
              {selectedAgent && manifest ? (
                <section className="min-h-0">
                  <MarketplaceAgentPreview
                    agent={selectedAgent}
                    sourceRepo={manifest.source.repo}
                    loadAgent={loadAgent}
                    onImport={handleImport}
                  />
                </section>
              ) : null}
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
