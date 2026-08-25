import { useRef, useState } from 'react'
import { guestLinkFor } from '../api/auth'

interface GuestLinkShareProps {
  /** The guest token, which the server only ever sends to the owner. */
  token: string
  className?: string
}

/**
 * Copies text without assuming a secure context. Production is plain HTTP on a
 * bare IP, where `navigator.clipboard` simply does not exist (same class of
 * trap as crypto.randomUUID, see the session log notes), so the deprecated
 * execCommand path is the one that actually runs there. The link stays visible
 * in a selectable field either way, so a failure is never a dead end.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path.
  }
  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(field)
    return copied
  } catch {
    return false
  }
}

/**
 * The owner's way of handing out read-only access: one link to send, nothing
 * for the other person to type. The link carries the guest token itself, so it
 * is a credential -- whoever holds it is in, and revoking it means changing
 * PIANO_TRAINER_GUEST_PASSWORD on the server.
 *
 * Collapsed by default: it is a rare action, and Home stays an intent menu.
 */
export function GuestLinkShare({ token, className = '' }: GuestLinkShareProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const linkFieldRef = useRef<HTMLInputElement | null>(null)
  const link = guestLinkFor(token)

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`text-xs font-medium text-gray-500 hover:text-indigo-600 hover:underline ${className}`}
      >
        Share a guest link
      </button>
    )
  }

  return (
    <div className={`flex w-full max-w-md flex-col gap-2 rounded-lg border border-indigo-100 bg-white/80 p-3 ${className}`}>
      <p className="text-xs text-gray-600">
        Read-only link: the catalog and the stats can be browsed and every score can be played, but nothing can be
        uploaded, edited, deleted, and no practice is recorded.
      </p>
      <div className="flex items-center gap-2">
        <input
          ref={linkFieldRef}
          type="text"
          value={link}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
          aria-label="Guest link"
          className="min-w-0 flex-1 rounded-md border border-indigo-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            void copyText(link).then((ok) => {
              setCopyState(ok ? 'copied' : 'failed')
              // Nothing reached the clipboard, so leave the link selected: the
              // player can still copy it by hand instead of being stuck.
              if (!ok) {
                linkFieldRef.current?.select()
              }
            })
          }}
          className="shrink-0 rounded-md border border-indigo-200 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
        >
          {copyState === 'copied' ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={() => {
            setIsOpen(false)
            setCopyState('idle')
          }}
          aria-label="Close"
          className="shrink-0 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
        >
          Close
        </button>
      </div>
      {copyState === 'failed' && (
        <p className="text-xs text-gray-500">This browser refused the copy. The link above is selected, copy it by hand.</p>
      )}
    </div>
  )
}
