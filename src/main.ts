import createCameraControls from '3d-view-controls'
import createRenderer from './buildings.render'

async function main (): Promise<void> {
  if (!window.navigator.gpu) {
    const message = `
      Your current browser does not support WebGPU! Make sure you are on a system
      with WebGPU enabled, e.g. Chrome Canary with chrome://flags#enable-unsafe-webgpu enabled.
    `
    document.body.innerText = message
    throw new Error(message)
  }

  const canvas = document.body.appendChild(document.createElement('canvas'))
  window.addEventListener('resize', fit(canvas, document.body, window.devicePixelRatio), false)

  const adapter = await window.navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('Failed to requestAdapter()')

  const device = await adapter.requestDevice()
  if (!device) throw new Error('Failed to requestDevice()')

  const context = canvas.getContext('webgpu')
  if (!context) throw new Error('Failed to getContext("webgpu")')

  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: 'opaque' })

  // NOTE: when we rewrite this file to work in Deno, we will have renderers render to
  // this texture. Then on every pass we'll copy from this texture to a buffer
  // that we'll stream to gstreamer's stdin
  //
  // const outputTexture = device.createTexture({
  //   size: { width: WIDTH, height: HEIGHT },
  //   format: 'rgba8unorm-srgb',
  //   usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
  // })
  // const outputBuffer = device.createBuffer({
  //   size: WIDTH * HEIGHT * 4,
  //   usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  // })

  const CENTER = [1249.5, 1249.5, 800]
  const EYE = [CENTER[0] - 2000, CENTER[1] - 2000, 2000]
  const camera = createCameraControls(canvas, {
    eye: EYE,
    center: CENTER
  })

  // NOTE: it might be preferable to just pass a texture description to createRenderer here
  // instead of an actual texture, so we can prevent the renderer from using the texture outside
  // of a render pass.
  const render = await createRenderer(device, context.getCurrentTexture())

  requestAnimationFrame(function loop () {
    requestAnimationFrame(loop)

    const curTexture = context.getCurrentTexture()

    camera.tick()
    camera.up = [0, 0, 1]
    const view = camera.matrix

    render({ view }, null, curTexture)

    // NOTE: when we rewrite this file to work in Deno, we will have renderers render to
    // the above outputTexture. We'll then copy that texture to this buffer and stream
    // the pixels to gstreamer's stdin.

    // const encoder = device.createCommandEncoder()
    // encoder.copyTextureToBuffer(
    //   { texture: outputTexture },
    //   {
    //     buffer: outputBuffer,
    //     bytesPerRow: outputTexture.width * 4,
    //     rowsPerImage: outputTexture.height
    //   },
    //   [outputTexture.width, outputTexture.height]
    // )
    // device.queue.submit([encoder.finish()])
    // await outputBuffer.mapAsync(GPUMapMode.READ)
    // const outputCPUBuffer = new Uint8Array(outputBuffer.getMappedRange())
    // Deno.stdout.write(outputCPUBuffer)
    // outputBuffer.unmap()
  })
}

main().catch((err: any) => {
  console.error('main() threw an error:', err)
})

// --------- HELPERS ------------

type Resize = () => Resize

function fit (canvas: HTMLCanvasElement, parent: HTMLElement, scale = 1): Resize {
  const p = parent || canvas.parentNode

  canvas.style.position = canvas.style.position || 'absolute'
  canvas.style.top = '0'
  canvas.style.left = '0'
  return resize()

  function resize (): Resize {
    let width = window.innerWidth
    let height = window.innerHeight
    if (p && p !== document.body) {
      const bounds = p.getBoundingClientRect()
      width = bounds.width
      height = bounds.height
    }
    canvas.width = width * scale
    canvas.height = height * scale
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    return resize
  }
}
