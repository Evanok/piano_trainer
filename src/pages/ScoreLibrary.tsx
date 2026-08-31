import { useEffect, useRef, useState } from 'react'

import TagTree from '../components/TagTree'
import { MidiDevice } from '../components/MidiDevice'
import { StreakBadges } from '../components/StreakBadges'
import { PencilIcon, StarIcon, TrashIcon } from '../components/icons'
import { isGuest } from '../api/auth'
import { deleteScoreEntry, downloadScoreFile, fetchCatalogPage, updateScoreEntry, uploadScore } from '../api/catalog'
import { getStreakStats } from '../engine/streak'
import {
  CATALOG_SORTS,
  DEFAULT_CATALOG_SORT,
  type CatalogBrowseState,
  type CatalogEntry,
  type CatalogPage,
  type CatalogSort,
  type ScoreDifficulty,
} from '../types/catalog'
import type { MidiDeviceInfo } from '../types/midi'
import { PAGE_BACKGROUND } from '../theme'

const ALLOWED_EXTENSIONS = ['.musicxml', '.xml', '.mxl']
const CATALOG_PAGE_SIZE = 10
// Long enough that typing a word doesn't fire a request per keystroke, short
// enough that the list still feels like it filters as you type.
const SEARCH_DEBOUNCE_MS = 250

interface ScoreLibraryProps {
  devices: MidiDeviceInfo[]
  selectedDeviceId: string | null
  onSelectDevice: (id: string) => void
  isSupported: boolean
  midiError: string | null
  /** The catalog entry is passed along when there is one, so the session log can
   *  record which score was practiced rather than just its file name. */
  onFileLoaded: (scoreFile: File, entry?: CatalogEntry) => void
  onBack: () => void
  // Owned by App (survives this component unmounting when navigating away
  // and back, e.g. via the browser's back button into Practice and back)
  // so browsing the catalog resumes on the same page/search/filter/order
  // instead of silently resetting to page 1 every time.
  initialBrowseState: CatalogBrowseState
  onBrowseStateChange: (state: CatalogBrowseState) => void
}

const SORT_LABELS: Record<CatalogSort, string> = {
  recent: 'Latest upload',
  title: 'Title A-Z',
  lastPlayed: 'Last played',
  progress: 'Most progress',
  played: 'Most played',
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const DIFFICULTY_LABELS: Record<ScoreDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
}

const DIFFICULTY_BADGE_CLASSES: Record<ScoreDifficulty, string> = {
  easy: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
  medium: 'border border-amber-200 bg-amber-50 text-amber-700',
  hard: 'border border-rose-200 bg-rose-50 text-rose-700',
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function formatUploadedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const days = Math.round((startOfLocalDay(new Date()) - startOfLocalDay(date)) / 86400000)
  if (days <= 0) {
    return 'today'
  }
  if (days === 1) {
    return 'yesterday'
  }
  if (days < 7) {
    return `${days} days ago`
  }
  return date.toLocaleDateString()
}

/**
 * How far the piece has been played, from the shared practice history (see
 * engine/scoreProgress.ts). Renders nothing at all for a piece never
 * practised, so a fresh catalog stays a plain list instead of a wall of empty
 * bars. Spans rather than divs: this sits inside the row's <button>.
 */
function ProgressBar({ progress }: { progress: CatalogEntry['progress'] }) {
  if (!progress || progress.percent <= 0) {
    return null
  }
  const finished = progress.completed
  const sessions = `${progress.sessionCount} session${progress.sessionCount === 1 ? '' : 's'}`
  return (
    <span
      className="mt-1.5 flex items-center gap-2"
      title={`Played to ${progress.percent}% over ${sessions}`}
    >
      <span className="block h-1.5 w-24 overflow-hidden rounded-full bg-gray-200">
        <span
          className={`block h-full rounded-full ${finished ? 'bg-emerald-500' : 'bg-indigo-500'}`}
          style={{ width: `${progress.percent}%` }}
        />
      </span>
      <span className={`text-[11px] font-medium ${finished ? 'text-emerald-600' : 'text-gray-500'}`}>
        {finished ? 'Finished' : `${progress.percent}%`}
      </span>
    </span>
  )
}

export function ScoreLibrary({
  devices,
  selectedDeviceId,
  onSelectDevice,
  isSupported,
  midiError,
  onFileLoaded,
  onBack,
  initialBrowseState,
  onBrowseStateChange,
}: ScoreLibraryProps) {
  // Read-only share link: the catalog is browsable and playable, but nothing
  // here may be added, edited, starred or deleted. The server refuses those
  // calls anyway (see server/auth.ts); hiding the controls is so a guest is
  // never offered a button that can only fail.
  const guest = isGuest()
  const [fileError, setFileError] = useState<string | null>(null)
  // Set only when saving to the catalog failed: the score is still perfectly
  // playable, so we offer to practice it without keeping it server-side rather
  // than blocking on an unreachable catalog.
  const [unsavedFile, setUnsavedFile] = useState<File | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Recomputed fresh every time Home mounts (App fully unmounts/remounts it
  // on screen switches), so it always reflects the latest practice day.
  const [streak] = useState(() => getStreakStats())

  const [searchInput, setSearchInput] = useState(initialBrowseState.search)
  const [search, setSearch] = useState(initialBrowseState.search)
  const [difficultyFilter, setDifficultyFilter] = useState<ScoreDifficulty | ''>(initialBrowseState.difficulty)
  const [favoritesOnly, setFavoritesOnly] = useState(initialBrowseState.favoritesOnly)
  const [tagFilter, setTagFilter] = useState(initialBrowseState.tag)
  const [sort, setSort] = useState<CatalogSort>(initialBrowseState.sort)
  const [page, setPage] = useState(initialBrowseState.page)
  const [reloadToken, setReloadToken] = useState(0)
  const [catalog, setCatalog] = useState<CatalogPage | null>(null)
  const [isCatalogLoading, setIsCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  // The entry whose star is mid-request, so the same score can't be toggled
  // twice before the server has answered.
  const [togglingFavoriteId, setTogglingFavoriteId] = useState<string | null>(null)

  // Editing is inline in the list row, so only one entry's fields need to be
  // held in state at a time (rather than one draft per row).
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editComposer, setEditComposer] = useState('')
  // Folders as free text, comma-separated: creating "jeux-video" is typing it,
  // there is no list of known tags to pick from and nothing to register first.
  const [editTags, setEditTags] = useState('')
  const [editDifficulty, setEditDifficulty] = useState<ScoreDifficulty | ''>('')
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // The entry pending confirmation in the delete modal, or null when it's closed.
  const [deletingEntry, setDeletingEntry] = useState<CatalogEntry | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Tracks the searchInput value already reflected in `search`/`page` --
  // lets this effect tell "the user actually typed something new" apart
  // from "searchInput just matches what it was restored to on mount," so
  // resuming on a restored page doesn't get immediately reset to page 1 by
  // this same effect. A ref's initial value is computed once per component
  // instance (not once per effect invocation), which keeps this correct
  // under React StrictMode's deliberate double-invoke of effects on mount.
  const lastDebouncedSearchInputRef = useRef(searchInput)

  useEffect(() => {
    if (lastDebouncedSearchInputRef.current === searchInput) {
      return
    }
    lastDebouncedSearchInputRef.current = searchInput
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      // A new search invalidates the current page number: page 3 of the old
      // results has nothing to do with page 3 of the new ones.
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Reported up to App as the user browses, so navigating away (e.g. opening
  // a score) and back later resumes on the same page/search/filter instead
  // of resetting -- this component fully unmounts on every screen switch.
  useEffect(() => {
    onBrowseStateChange({ search, difficulty: difficultyFilter, favoritesOnly, tag: tagFilter, sort, page })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, difficultyFilter, favoritesOnly, tagFilter, sort, page])

  const handleSelectDifficultyFilter = (value: ScoreDifficulty | '') => {
    setDifficultyFilter(value)
    // A new filter invalidates the current page number, same as a new search.
    setPage(1)
  }

  const handleSelectTag = (value: string) => {
    setTagFilter(value)
    // A study folder is a collection with an order, and its titles start with
    // that order ("Op. 100 No. 3. Pastorale"), so opening one lands on it rather
    // than on upload order. Only from the default sort: an explicit choice of
    // another order is never overridden, and the picker shows what happened.
    if (value && sort === DEFAULT_CATALOG_SORT) {
      setSort('title')
    }
    // Another folder means another result set, so page 3 of the old one is
    // meaningless -- same rule as the search and the difficulty filter.
    setPage(1)
  }

  const handleToggleFavoritesOnly = () => {
    setFavoritesOnly((current) => !current)
    setPage(1)
  }

  const handleSelectSort = (value: CatalogSort) => {
    setSort(value)
    // Page 3 of one order has nothing to do with page 3 of another.
    setPage(1)
  }

  useEffect(() => {
    const controller = new AbortController()
    setIsCatalogLoading(true)
    fetchCatalogPage({
      search,
      difficulty: difficultyFilter || undefined,
      favoritesOnly,
      tag: tagFilter || undefined,
      sort,
      page,
      pageSize: CATALOG_PAGE_SIZE,
      signal: controller.signal,
    })
      .then((result) => {
        setCatalog(result)
        setCatalogError(null)
      })
      .catch((error: unknown) => {
        // An aborted request was superseded by a newer one -- not a failure.
        if (controller.signal.aborted) {
          return
        }
        setCatalogError(errorMessage(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsCatalogLoading(false)
        }
      })
    return () => controller.abort()
  }, [search, difficultyFilter, favoritesOnly, tagFilter, sort, page, reloadToken])

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Cleared right away so picking the same file again still fires a change.
    if (inputRef.current) {
      inputRef.current.value = ''
    }
    if (!file) {
      return
    }
    if (!ALLOWED_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))) {
      setFileError('Please choose a .musicxml, .xml or .mxl file.')
      setUnsavedFile(null)
      return
    }
    setFileError(null)
    setUnsavedFile(null)
    setIsSaving(true)
    try {
      onFileLoaded(file, await uploadScore(file))
    } catch (error: unknown) {
      setIsSaving(false)
      setFileError(`Could not add this score to the catalog: ${errorMessage(error)}`)
      setUnsavedFile(file)
    }
  }

  const handleOpenEntry = async (entry: CatalogEntry) => {
    setOpeningId(entry.id)
    setCatalogError(null)
    try {
      onFileLoaded(await downloadScoreFile(entry), entry)
    } catch (error: unknown) {
      setOpeningId(null)
      setCatalogError(`Could not open "${entry.title}": ${errorMessage(error)}`)
    }
  }

  const handleToggleFavorite = async (entry: CatalogEntry) => {
    const favorite = !entry.favorite
    setTogglingFavoriteId(entry.id)
    setCatalogError(null)
    // Starring is a one-click action taken while browsing, so the star flips
    // straight away instead of waiting for a refetch; a failed request puts
    // the list back the way it was.
    setCatalog((current) =>
      current
        ? { ...current, items: current.items.map((item) => (item.id === entry.id ? { ...item, favorite } : item)) }
        : current,
    )
    try {
      await updateScoreEntry(entry.id, { favorite })
      // Under the favorites filter an un-starred entry no longer belongs on
      // the page at all, so let the server rebuild it (and the total with it).
      if (favoritesOnly) {
        setReloadToken((token) => token + 1)
      }
    } catch (error: unknown) {
      setCatalog((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.id === entry.id ? { ...item, favorite: entry.favorite } : item)),
            }
          : current,
      )
      setCatalogError(`Could not update the favorite for "${entry.title}": ${errorMessage(error)}`)
    } finally {
      setTogglingFavoriteId(null)
    }
  }

  const startEditing = (entry: CatalogEntry) => {
    setEditingId(entry.id)
    setEditTitle(entry.title)
    setEditComposer(entry.composer ?? '')
    setEditDifficulty(entry.difficulty ?? '')
    setEditTags((entry.tags ?? []).join(', '))
    setEditError(null)
  }

  const handleSaveEdit = async (entry: CatalogEntry) => {
    const title = editTitle.trim()
    if (!title) {
      setEditError('Title cannot be empty.')
      return
    }
    setIsSavingEdit(true)
    setEditError(null)
    try {
      await updateScoreEntry(entry.id, {
        title,
        composer: editComposer.trim() || null,
        difficulty: editDifficulty || null,
        // Sent raw; the server normalizes, so "Study / Bartok" and
        // "study/bartok" cannot become two folders.
        tags: editTags.split(','),
      })
      setEditingId(null)
      // Simplest way to get the edited fields back from the server: refetch
      // the current page rather than patch the in-memory list by hand.
      setReloadToken((token) => token + 1)
    } catch (error: unknown) {
      setEditError(errorMessage(error))
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deletingEntry) {
      return
    }
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await deleteScoreEntry(deletingEntry.id)
      setDeletingEntry(null)
      // If this was the last entry on the page, the server will just clamp
      // the page number back down on the next fetch.
      setReloadToken((token) => token + 1)
    } catch (error: unknown) {
      setDeleteError(errorMessage(error))
    } finally {
      setIsDeleting(false)
    }
  }

  const isBusy = isSaving || openingId !== null

  return (
    <div className={`min-h-screen ${PAGE_BACKGROUND}`}>
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col items-center gap-3 text-center">
          <div className="flex w-full items-center justify-between gap-4">
            <button type="button" onClick={onBack} className="text-sm font-medium text-indigo-600 hover:underline">
              Home
            </button>
            <h1 className="text-3xl font-semibold text-gray-900">Practice a score</h1>
            <span className="w-10" />
          </div>
          <StreakBadges streak={streak} className="justify-center" />
        </header>

        {!guest && (
          <section className="flex w-full flex-col items-center gap-3">
            <label
              className={`w-full rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/70 px-6 py-8 text-center text-sm font-medium text-indigo-700 ${
                isBusy ? 'cursor-progress opacity-60' : 'cursor-pointer hover:border-indigo-400 hover:bg-indigo-100/70'
              }`}
            >
              {isSaving ? 'Adding to the catalog...' : 'Choose a MusicXML score (.musicxml, .xml, .mxl)'}
              <input
                ref={inputRef}
                type="file"
                accept=".musicxml,.xml,.mxl"
                disabled={isBusy}
                onChange={(event) => {
                  void handleFileChange(event)
                }}
                className="hidden"
              />
            </label>
            {fileError && <p className="text-sm text-red-600">{fileError}</p>}
            {unsavedFile && (
              <button
                type="button"
                onClick={() => onFileLoaded(unsavedFile)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Practice "{unsavedFile.name}" without saving it
              </button>
            )}
          </section>
        )}

        <section className="flex w-full flex-col items-center gap-2 rounded-xl border border-indigo-100 bg-white/70 px-4 py-4 shadow-sm">
          <p className="text-sm font-medium text-gray-700">MIDI keyboard</p>
          <MidiDevice
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            onSelect={onSelectDevice}
            isSupported={isSupported}
            error={midiError}
          />
        </section>

        <section className="flex w-full flex-col gap-3 border-t border-indigo-100 pt-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium text-gray-900">Catalog</h2>
            {catalog && catalog.total > 0 && (
              <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-medium text-indigo-700">
                {catalog.total} score{catalog.total === 1 ? '' : 's'}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search saved scores..."
              className="min-w-0 flex-1 rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none"
            />
            <select
              value={sort}
              onChange={(event) => handleSelectSort(event.target.value as CatalogSort)}
              aria-label="Sort scores"
              className="shrink-0 rounded-md border border-indigo-200 bg-white px-2 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
            >
              {CATALOG_SORTS.map((option) => (
                <option key={option} value={option}>
                  {SORT_LABELS[option]}
                </option>
              ))}
            </select>
            <select
              value={difficultyFilter}
              onChange={(event) => handleSelectDifficultyFilter(event.target.value as ScoreDifficulty | '')}
              aria-label="Filter by difficulty"
              className="shrink-0 rounded-md border border-indigo-200 bg-white px-2 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
            >
              <option value="">All difficulties</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
            <button
              type="button"
              onClick={handleToggleFavoritesOnly}
              aria-pressed={favoritesOnly}
              title={favoritesOnly ? 'Showing favorites only' : 'Show favorites only'}
              aria-label="Show favorites only"
              className={`shrink-0 rounded-md border px-2 py-2 ${
                favoritesOnly
                  ? 'border-amber-300 bg-amber-50 text-amber-500'
                  : 'border-indigo-200 bg-white text-gray-400 hover:text-amber-500'
              }`}
            >
              <StarIcon className="h-5 w-5" filled={favoritesOnly} />
            </button>
          </div>

          {/* The folder tree is a filter beside the list, not a place the user
              navigates into, so it stays visible while the search box and the
              other filters keep applying. Its counts come from the server under
              those filters (minus the folder one), which is what makes it answer
              "where are my easy favorites?" rather than being a static index. */}
          <div className="grid gap-4 sm:grid-cols-[minmax(150px,190px)_minmax(0,1fr)]">
            <div className="sm:border-r sm:border-indigo-100 sm:pr-3">
              {catalog && (
                <TagTree
                  counts={catalog.tagCounts}
                  total={catalog.totalAcrossFolders}
                  selected={tagFilter}
                  onSelect={handleSelectTag}
                />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-3">

          {catalogError && (
            <div className="flex items-center justify-between gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              <span>{catalogError}</span>
              <button
                type="button"
                onClick={() => setReloadToken((token) => token + 1)}
                className="shrink-0 rounded border border-red-300 px-2 py-1 text-xs hover:bg-red-100"
              >
                Retry
              </button>
            </div>
          )}

          {isCatalogLoading && !catalog && <p className="py-4 text-sm text-gray-500">Loading catalog...</p>}

          {catalog && catalog.items.length === 0 && !isCatalogLoading && (
            <p className="py-4 text-sm text-gray-500">
              {search || difficultyFilter || favoritesOnly
                ? `No ${favoritesOnly ? 'favorite ' : ''}score matches${search ? ` "${search}"` : ''}${
                    difficultyFilter ? ` (${DIFFICULTY_LABELS[difficultyFilter]} difficulty)` : ''
                  }.`
                : guest
                  ? 'No score in the catalog yet.'
                  : 'No score saved yet. Upload one above and it will show up here.'}
            </p>
          )}

          {catalog && catalog.items.length > 0 && (
            <ul className="flex flex-col divide-y divide-indigo-50 overflow-hidden rounded-xl border border-indigo-100 bg-white shadow-sm">
              {catalog.items.map((entry) =>
                editingId === entry.id ? (
                  <li key={entry.id} className="px-4 py-3">
                    <form
                      className="flex flex-col gap-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void handleSaveEdit(entry)
                      }}
                    >
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                        placeholder="Title"
                        autoFocus
                        className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
                      />
                      <input
                        type="text"
                        value={editComposer}
                        onChange={(event) => setEditComposer(event.target.value)}
                        placeholder="Composer (optional)"
                        className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
                      />
                      <input
                        type="text"
                        value={editTags}
                        onChange={(event) => setEditTags(event.target.value)}
                        placeholder="Folders, comma-separated (personal, study/bartok)"
                        aria-label="Folders"
                        className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
                      />
                      <select
                        value={editDifficulty}
                        onChange={(event) => setEditDifficulty(event.target.value as ScoreDifficulty | '')}
                        aria-label="Difficulty"
                        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
                      >
                        <option value="">Difficulty: not set</option>
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                      </select>
                      {editError && <p className="text-xs text-red-600">{editError}</p>}
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={isSavingEdit}
                          onClick={() => setEditingId(null)}
                          className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={isSavingEdit}
                          className="rounded-md bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-700 disabled:opacity-60"
                        >
                          {isSavingEdit ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </form>
                  </li>
                ) : (
                  <li key={entry.id} className="flex items-center gap-1 px-4 py-3 transition-colors hover:bg-indigo-50/60">
                    {/* The row is one big button that opens the score, so the
                        folder chips (buttons of their own) live next to it
                        rather than inside it -- nesting them would be invalid
                        HTML and their click would open the score anyway. */}
                    <div className="flex min-w-0 flex-1 flex-col">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        void handleOpenEntry(entry)
                      }}
                      className="flex w-full min-w-0 items-center justify-between gap-4 text-left disabled:cursor-progress disabled:opacity-60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start gap-2">
                          {/* Two lines, not one truncated one: a study
                              collection's title carries the piece number at the
                              *end* ("Mikrokosmos ... No. 88: Duet for Pipes"),
                              so an ellipsis cuts off exactly the part that says
                              which exercise this is. */}
                          <span className="line-clamp-2 break-words text-sm font-medium text-gray-900">
                            {entry.title}
                          </span>
                          {entry.difficulty && (
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${DIFFICULTY_BADGE_CLASSES[entry.difficulty]}`}
                            >
                              {DIFFICULTY_LABELS[entry.difficulty]}
                            </span>
                          )}
                        </span>
                        {entry.composer && (
                          <span className="block truncate text-xs text-gray-600">{entry.composer}</span>
                        )}
                        <span className="block truncate text-xs text-gray-400">
                          {formatUploadedAt(entry.uploadedAt)} - {formatSize(entry.sizeBytes)}
                        </span>
                        <ProgressBar progress={entry.progress} />
                      </span>
                      <span className="shrink-0 text-xs font-medium text-indigo-600">
                        {openingId === entry.id ? 'Opening...' : 'Practice'}
                      </span>
                    </button>
                    {entry.tags && entry.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {entry.tags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => handleSelectTag(tag)}
                            title={`Show ${tag}`}
                            className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700 hover:bg-indigo-100"
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    )}
                    </div>
                    {!guest && (
                      <>
                        <button
                          type="button"
                          disabled={isBusy || togglingFavoriteId === entry.id}
                          onClick={() => {
                            void handleToggleFavorite(entry)
                          }}
                          aria-pressed={entry.favorite === true}
                          aria-label={entry.favorite ? `Remove "${entry.title}" from favorites` : `Add "${entry.title}" to favorites`}
                          className={`shrink-0 rounded p-1.5 hover:bg-amber-50 disabled:opacity-40 ${
                            entry.favorite ? 'text-amber-500' : 'text-gray-300 hover:text-amber-500'
                          }`}
                        >
                          <StarIcon className="h-4 w-4" filled={entry.favorite === true} />
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => startEditing(entry)}
                          aria-label={`Edit "${entry.title}"`}
                          className="shrink-0 rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            setDeletingEntry(entry)
                            setDeleteError(null)
                          }}
                          aria-label={`Delete "${entry.title}"`}
                          className="shrink-0 rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </li>
                ),
              )}
            </ul>
          )}

          {catalog && catalog.pageCount > 1 && (
            <div className="flex items-center justify-between gap-4 text-sm text-gray-600">
              <button
                type="button"
                disabled={catalog.page <= 1 || isCatalogLoading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="rounded-md border border-indigo-200 bg-white px-3 py-1.5 text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 disabled:hover:bg-white"
              >
                Previous
              </button>
              <span>
                Page {catalog.page} of {catalog.pageCount}
              </span>
              <button
                type="button"
                disabled={catalog.page >= catalog.pageCount || isCatalogLoading}
                onClick={() => setPage((current) => current + 1)}
                className="rounded-md border border-indigo-200 bg-white px-3 py-1.5 text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 disabled:hover:bg-white"
              >
                Next
              </button>
            </div>
          )}
            </div>
          </div>
        </section>

        {deletingEntry && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
            onClick={() => {
              if (!isDeleting) {
                setDeletingEntry(null)
              }
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-score-title"
              onClick={(event) => event.stopPropagation()}
              className="flex w-full max-w-sm flex-col gap-4 rounded-lg bg-white p-6 shadow-xl"
            >
              <h2 id="delete-score-title" className="text-lg font-semibold text-gray-900">
                Delete this score?
              </h2>
              <p className="text-sm text-gray-600">
                "{deletingEntry.title}" will be permanently removed from the catalog. This cannot be undone.
              </p>
              {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setDeletingEntry(null)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => {
                    void handleConfirmDelete()
                  }}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
