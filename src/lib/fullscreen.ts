export async function requestFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen()
    }
    // Attempt to lock orientation to landscape on mobile devices
    if ('orientation' in screen && 'lock' in screen.orientation) {
      // @ts-ignore - TS types for screen.orientation.lock are incomplete
      await screen.orientation.lock('landscape')
    }
  } catch (err) {
    console.warn('Fullscreen/Orientation lock failed or unsupported:', err)
  }
}
