export function Unsupported() {
  return (
    <div className="hud-safe flex h-full flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-4xl font-bold tracking-[0.3em] text-(--color-neon)">WAVE RIDER</h1>
      <p className="max-w-md text-lg text-white/70">
        This game requires <span className="text-(--color-neon)">WebGPU</span>, which your
        browser does not support.
      </p>
      <p className="max-w-md text-sm text-white/40">
        Try the latest Chrome, Edge, or Safari 26+ on a device with a modern GPU.
      </p>
    </div>
  )
}
