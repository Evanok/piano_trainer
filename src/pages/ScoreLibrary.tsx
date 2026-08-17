import { useEffect, useRef, useState } from 'react'
import { MidiDevice } from '../components/MidiDevice'
import { PencilIcon, TrashIcon } from '../components/icons'
import { deleteScoreEntry, downloadScoreFile, fetchCatalogPage, updateScoreEntry, uploadScore } from '../api/catalog'
import { getStreakStats } from '../engine/streak'
import type { CatalogEntry, CatalogPage, ScoreDifficulty } from '../types/catalog'
import type { MidiDeviceInfo } from '../types/midi'

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
  // so browsing the catalog resumes on the same page/search/filter instead
  // of silently resetting to page 1 every time.
  initialSearch: string
  initialDifficulty: ScoreDifficulty | ''
  initialPage: number
  onBrowseStateChange: (search: string, difficulty: ScoreDifficulty | '', page: number) => void
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
  easy: 'bg-green-50 text-green-700',
  medium: 'bg-amber-50 text-amber-700',
  hard: 'bg-red-50 text-red-700',
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

export function ScoreLibrary({
  devices,
  selectedDeviceId,
  onSelectDevice,
  isSupported,
  midiError,
  onFileLoaded,
  onBack,
  initialSearch,
  initialDifficulty,
  initialPage,
  onBrowseStateChange,
}: ScoreLibraryProps) {
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

  const [searchInput, setSearchInput] = useState(initialSearch)
  const [search, setSearch] = useState(initialSearch)
  const [difficultyFilter, setDifficultyFilter] = useState<ScoreDifficulty | ''>(initialDifficulty)
  const [page, setPage] = useState(initialPage)
  const [reloadToken, setReloadToken] = useState(0)
  const [catalog, setCatalog] = useState<CatalogPage | null>(null)
  const [isCatalogLoading, setIsCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)

  // Editing is inline in the list row, so only one entry's fields need to be
  // held in state at a time (rather than one draft per row).
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editComposer, setEditComposer] = useState('')
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
    onBrowseStateChange(search, difficultyFilter, page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, difficultyFilter, page])

  const handleSelectDifficultyFilter = (value: ScoreDifficulty | '') => {
    setDifficultyFilter(value)
    // A new filter invalidates the current page number, same as a new search.
    setPage(1)
  }

  useEffect(() => {
    const controller = new AbortController()
    setIsCatalogLoading(true)
    fetchCatalogPage({
      search,
      difficulty: difficultyFilter || undefined,
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
  }, [search, difficultyFilter, page, reloadToken])

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

  const startEditing = (entry: CatalogEntry) => {
    setEditingId(entry.id)
    setEditTitle(entry.title)
    setEditComposer(entry.composer ?? '')
    setEditDifficulty(entry.difficulty ?? '')
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
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col items-center gap-3 text-center">
        <div className="flex w-full items-center justify-between gap-4">
          <button type="button" onClick={onBack} className="text-sm text-gray-500 hover:underline">
            Home
          </button>
          <h1 className="text-3xl font-semibold text-gray-900">Practice a score</h1>
          <span className="w-10" />
        </div>
        {streak.totalDaysPracticed > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-gray-600">
            <span>
              {streak.currentStreak} day{streak.currentStreak === 1 ? '' : 's'} streak
            </span>
            <span>
              Longest: {streak.longestStreak} day{streak.longestStreak === 1 ? '' : 's'}
            </span>
            <span>
              {streak.totalDaysPracticed} day{streak.totalDaysPracticed === 1 ? '' : 's'} practiced total
            </span>
          </div>
        )}
      </header>

      <section className="flex w-full flex-col items-center gap-3">
        <label
          className={`w-full rounded-lg border-2 border-dashed border-gray-300 bg-white px-6 py-8 text-center text-sm text-gray-600 ${
            isBusy ? 'cursor-progress opacity-60' : 'cursor-pointer hover:border-gray-400'
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

      <section className="flex w-full flex-col items-center gap-2">
        <p className="text-sm font-medium text-gray-700">MIDI keyboard</p>
        <MidiDevice
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          onSelect={onSelectDevice}
          isSupported={isSupported}
          error={midiError}
        />
      </section>

      <section className="flex w-full flex-col gap-3 border-t border-gray-200 pt-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-medium text-gray-900">Catalog</h2>
          {catalog && catalog.total > 0 && (
            <span className="text-xs text-gray-500">
              {catalog.total} score{catalog.total === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search saved scores..."
            className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
          />
          <select
            value={difficultyFilter}
            onChange={(event) => handleSelectDifficultyFilter(event.target.value as ScoreDifficulty | '')}
            aria-label="Filter by difficulty"
            className="shrink-0 rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
          >
            <option value="">All difficulties</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>

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
            {search || difficultyFilter
              ? `No score matches${search ? ` "${search}"` : ''}${
                  difficultyFilter ? ` (${DIFFICULTY_LABELS[difficultyFilter]} difficulty)` : ''
                }.`
              : 'No score saved yet. Upload one above and it will show up here.'}
          </p>
        )}

        {catalog && catalog.items.length > 0 && (
          <ul className="flex flex-col divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
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
                        className="rounded-md bg-gray-900 px-3 py-1 text-xs text-white hover:bg-gray-800 disabled:opacity-60"
                      >
                        {isSavingEdit ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={entry.id} className="flex items-center gap-1 px-4 py-3 hover:bg-gray-50">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      void handleOpenEntry(entry)
                    }}
                    className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left disabled:cursor-progress disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-gray-900">{entry.title}</span>
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
                    </span>
                    <span className="shrink-0 text-xs text-gray-400">
                      {openingId === entry.id ? 'Opening...' : 'Practice'}
                    </span>
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
              className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
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
              className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Next
            </button>
          </div>
        )}
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
  )
}
