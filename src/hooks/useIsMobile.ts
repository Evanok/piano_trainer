import { useEffect, useState } from 'react'

// A phone-sized screen is expected to be used in landscape for practice
// (scroll mode's horizontal staffline, Simply-Piano-style) -- checking only
// window width (e.g. a `(max-width: 768px)` media query) would stop
// detecting "mobile" the moment the phone is rotated sideways, since width
// and height swap and a phone's landscape width easily exceeds a portrait
// breakpoint. The physical screen size doesn't change with rotation, so the
// SMALLER of the two dimensions stays roughly constant either way -- that's
// what actually distinguishes a phone from a tablet/desktop.
const MOBILE_BREAKPOINT_PX = 768

function checkIsMobile(): boolean {
  return Math.min(window.innerWidth, window.innerHeight) <= MOBILE_BREAKPOINT_PX
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(checkIsMobile)

  useEffect(() => {
    const handleResize = () => setIsMobile(checkIsMobile())
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return isMobile
}
