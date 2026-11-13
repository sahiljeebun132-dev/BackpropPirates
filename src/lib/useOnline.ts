import { useEffect, useState } from 'react'

/** Whether the browser thinks it has a network.
 *
 *  `navigator.onLine` is honest about having no connection at all and
 *  optimistic about everything else: it will say true on a captive portal or
 *  a bar of signal that carries nothing. That is good enough for what it is
 *  used for here — telling the rider which parts of the screen are stored
 *  and which are live — because the live parts fail loudly on their own and
 *  the app already says so when they do.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return online
}
