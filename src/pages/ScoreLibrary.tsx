import { useEffect, useRef, useState } from 'react'
import { MidiDevice } from '../components/MidiDevice'
import { downloadScoreFile, fetchCatalogPage, uploadScore } from '../api/catalog'
import { getStreakStats } from '../engine/streakStore'
import type { CatalogEntry, CatalogPage } from '../types/catalog'
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
  onFileLoaded: (scoreFile: File) => void
  onBack: () => void
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

export function ScoreLibrary({ devices, selectedDeviceId, onSelectDevice, isSupported, midiError, onFileLoaded, onBack }: ScoreLibraryProps) {
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

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [reloadToken, setReloadToken] = useState(0)
  const [catalog, setCatalog] = useState<CatalogPage | null>(null)
  const [isCatalogLoading, setIsCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      // A new search invalidates the current page number: page 3 of the old
      // results has nothing to do with page 3 of the new ones.
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    const controller = new AbortController()
    setIsCatalogLoading(true)
    fetchCatalogPage({ search, page, pageSize: CATALOG_PAGE_SIZE, signal: controller.signal })
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
  }, [search, page, reloadToken])

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
      await uploadScore(file)
      onFileLoaded(file)
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
      onFileLoaded(await downloadScoreFile(entry))
    } catch (error: unknown) {
      setOpeningId(null)
      setCatalogError(`Could not open "${entry.title}": ${errorMessage(error)}`)
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

        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search saved scores..."
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
        />

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
            {search ? `No score matches "${search}".` : 'No score saved yet. Upload one above and it will show up here.'}
          </p>
        )}

        {catalog && catalog.items.length > 0 && (
          <ul className="flex flex-col divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
            {catalog.items.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    void handleOpenEntry(entry)
                  }}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-gray-50 disabled:cursor-progress disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">{entry.title}</span>
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
              </li>
            ))}
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
    </div>
  )
}
