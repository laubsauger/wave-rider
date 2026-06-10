/**
 * C2: WebGPU only. No WebGL fallback — absence routes to the unsupported screen.
 */
export async function detectWebGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu
  if (!gpu) return false
  try {
    const adapter = await gpu.requestAdapter()
    return adapter !== null
  } catch {
    return false
  }
}
