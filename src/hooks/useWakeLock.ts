import { useEffect, useRef } from 'react'

// The Screen Wake Lock API releases itself whenever the tab is backgrounded
// (tab switch, phone locked manually, etc.) -- that's expected. What it
// prevents is the OS auto-sleeping the screen from inactivity while the tab
// stays visible and in the foreground, which is exactly what happens during
// a practice session: no touch/scroll input for minutes at a time since the
// player is only pressing physical MIDI keys. Re-acquiring on
// visibilitychange handles the case where the lock got silently dropped
// (e.g. returning from a backgrounded tab) while `active` is still true.
export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return
    }

    let cancelled = false

    const acquire = async () => {
      try {
        const sentinel = await navigator.wakeLock.request('screen')
        if (cancelled) {
          void sentinel.release()
          return
        }
        sentinelRef.current = sentinel
      } catch {
        // Can be refused (low battery, backgrounded tab, unsupported browser
        // like iOS Safari pre-16.4) -- practice still works, just with the
        // screen-sleep risk it always had.
      }
    }

    void acquire()

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !sentinelRef.current) {
        void acquire()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      void sentinelRef.current?.release()
      sentinelRef.current = null
    }
  }, [active])
}
