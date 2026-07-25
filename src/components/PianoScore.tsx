import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'

export interface PianoScoreHandle {
  next: () => void
  reset: () => void
  markError: () => void
  markOk: () => void
}

interface PianoScoreProps {
  musicXml: string
  onReady?: (osmd: OpenSheetMusicDisplay) => void
}

export const PianoScore = forwardRef<PianoScoreHandle, PianoScoreProps>(function PianoScore(
  { musicXml, onReady },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }
    const osmd = new OpenSheetMusicDisplay(containerRef.current, {
      autoResize: true,
      backend: 'svg',
      drawTitle: false,
    })
    osmdRef.current = osmd
    let cancelled = false

    osmd.load(musicXml).then(() => {
      if (cancelled) {
        return
      }
      osmd.render()
      osmd.cursor.show()
      onReady?.(osmd)
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicXml])

  useImperativeHandle(
    ref,
    () => ({
      next: () => osmdRef.current?.cursor.next(),
      reset: () => osmdRef.current?.cursor.reset(),
      markError: () => {
        const cursorElement = osmdRef.current?.cursor.cursorElement
        if (cursorElement) {
          cursorElement.style.filter = 'hue-rotate(-120deg) saturate(4)'
        }
      },
      markOk: () => {
        const cursorElement = osmdRef.current?.cursor.cursorElement
        if (cursorElement) {
          cursorElement.style.filter = ''
        }
      },
    }),
    [],
  )

  return <div ref={containerRef} />
})
