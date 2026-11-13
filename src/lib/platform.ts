import { Capacitor } from '@capacitor/core'

/** True inside the Android app, false in any browser.
 *
 * Zetway ships twice from one codebase: as a web app anyone can open from a
 * link, and as an Android app that can act without a tap. Everything the
 * browser can do, both builds do identically. This flag guards only the few
 * places where the app can do more, and the UI uses it to promise only what
 * the build in the rider's hand will actually deliver.
 */
export const isNative = (): boolean => Capacitor.isNativePlatform()

/** Where Zetway's own serverless functions live.
 *
 * On the web the page and the functions share an origin, so a relative path is
 * correct and keeps preview deployments working. Inside the Android app the
 * page is served from the APK itself, so that same relative path would resolve
 * to a file inside the bundle and 404. The native build therefore calls the
 * deployed functions by absolute URL.
 */
export const API_BASE = Capacitor.isNativePlatform() ? 'https://backprop-pirates.vercel.app' : ''
