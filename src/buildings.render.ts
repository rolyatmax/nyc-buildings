import { mat4 } from 'gl-matrix'
import dataUrl from '../models/processed/DA-all.bin?url'
import StreamDecoder from './stream-decoder'

type RenderProps = { view: number[] }
type RenderState = null
type RenderFn = (renderProps: RenderProps, renderState: RenderState, curTexture: GPUTexture) => void

const fadeHeightStart = 1400
const fadeHeightEnd = -700

export default async function createRenderer (device: GPUDevice, texture: GPUTexture): Promise<RenderFn> {
  const result = await getDataStreamer(device, dataUrl)

  const { getCurrentVertexCount, buffers } = result

  const shader = `
    struct Uniforms {
      projection: mat4x4<f32>,
      view: mat4x4<f32>,
      fadeHeightRange: vec2<f32>
    };

    @group(0) @binding(0) var<uniform> uniforms: Uniforms;

    struct Output {
      @builtin(position) position: vec4<f32>,
      @location(0) color: vec3<f32>
    };

    fn getColorFromPalette(t: f32) -> vec3<f32> {
      const C1 = vec3(0.22745, 0.06667, 0.10980);
      const C2 = vec3(0.34118, 0.28627, 0.31765);
      const C3 = vec3(0.51373, 0.59608, 0.55686);
      const C4 = vec3(0.73725, 0.87059, 0.64706);
      const C5 = vec3(0.90196, 0.97647, 0.73725);

      if (t < 0.25) {
        return mix(C1, C2, smoothstep(0.0, 0.25, t));
      }
      if (t < 0.5) {
        return mix(C2, C3, smoothstep(0.25, 0.5, t));
      }
      if (t < 0.75) {
        return mix(C3, C4, smoothstep(0.5, 0.75, t));
      }
      return mix(C4, C5, smoothstep(0.75, 1.0, t));
    }

    @vertex
    fn mainVertex(
      @location(0) position: vec3<f32>
    ) -> Output {
      let p = position;
      const colorPow = 2.0;
      const colorOffset = 0.5;
      var t = (p.z + 50.0) / 2000.0;
      var color = getColorFromPalette(pow(t + colorOffset, colorPow));
      let colorMult = 0.4 + smoothstep(uniforms.fadeHeightRange.y, uniforms.fadeHeightRange.x, p.z) * 0.6;
      color *= colorMult;
      var output: Output;
      output.color = color;
      output.position = uniforms.projection * uniforms.view * vec4(p, 1.0);
      return output;
    }

    @fragment
    fn mainFragment(@location(0) color: vec3<f32>) -> @location(0) vec4<f32> {
      return vec4(color, 1.0);
    }
  `

  const uniformData = new Float32Array(36) // 16 + 16 + 2 + padding
  const uniformBuffer = createGPUBuffer(device, uniformData, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)

  const shaderModule = device.createShaderModule({ code: shader })

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0, // projection uniform
      visibility: GPUShaderStage.VERTEX,
      buffer: {}
    }, {
      binding: 1, // view uniform
      visibility: GPUShaderStage.VERTEX,
      buffer: {}
    }, {
      binding: 2, // fadeHeightRange
      visibility: GPUShaderStage.VERTEX,
      buffer: {}
    }]
  })

  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout]
    }),
    vertex: {
      module: shaderModule,
      entryPoint: 'mainVertex',
      buffers: [
        {
          arrayStride: 12,
          attributes: [
            {
              shaderLocation: 0,
              format: 'float32x3',
              offset: 0
            }
          ]
        }
      ]
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'mainFragment',
      targets: [{ format: texture.format }]
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less'
    }
  })

  const uniformBindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: uniformBuffer } },
      { binding: 2, resource: { buffer: uniformBuffer } }
    ]
  })

  const depthTexture = device.createTexture({
    size: { width: texture.width, height: texture.height },
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT
  })

  return function render (renderProps: { view: number[] }, renderState: null, curTexture: GPUTexture) {
    const commandEncoder = device.createCommandEncoder()
    const textureView = curTexture.createView()
    const { width, height } = curTexture

    const projection = mat4.perspective(new Float32Array(16), Math.PI / 4, width / height, 1, 1000000)
    uniformData.set(projection, 0)
    uniformData.set(renderProps.view, 16)
    uniformData.set([fadeHeightStart, fadeHeightEnd], 32)

    device.queue.writeBuffer(uniformBuffer, 0, uniformData)

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.11, g: 0.12, b: 0.13, a: 1.0 },
        loadOp: 'clear' as GPULoadOp,
        storeOp: 'store' as GPUStoreOp
      }],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store'
      }
    })

    const vertexCount = getCurrentVertexCount()

    renderPass.setPipeline(pipeline)
    renderPass.setVertexBuffer(0, buffers.positions)
    renderPass.setBindGroup(0, uniformBindGroup)
    renderPass.draw(vertexCount)
    renderPass.end()
    device.queue.submit([commandEncoder.finish()])
  }
}

function createGPUBuffer (
  device: GPUDevice,
  data: ArrayBuffer,
  usageFlag: GPUBufferUsageFlags
): GPUBuffer {
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage: usageFlag,
    mappedAtCreation: true
  })
  new Uint8Array(buffer.getMappedRange()).set(
    new Uint8Array(data)
  )
  buffer.unmap()
  return buffer
}

// --------- HELPERS ------------

type DataStreamer = {
  getCurrentVertexCount: () => number
  vertexCount: number
  buffers: {
    positions: GPUBuffer
    // barys: GPUBuffer
    // buildingIds: GPUBuffer
  }
}

const TRIANGLE_IN_BYTES = 3 * 3 * 4 // 3 vertices * 3 components (xyz) * 4 bytes (float32)

async function getDataStreamer (device: GPUDevice, url: string): Promise<DataStreamer> {
  const startTime = performance.now()
  const response = await fetch(url)

  if (!response.body) {
    throw new Error('Unable to fetch data. No response.body.')
  }

  const reader = response.body.getReader()

  const result = await reader.read()
  if (result.done || !result.value) throw new Error('Unable to fetch data. Stream completed before any data was received.')

  const decoder = new StreamDecoder()
  decoder.onChunk(result.value)

  let decoderResult = decoder.getCurrentResult()
  while (decoderResult === null) {
    decoderResult = decoder.getCurrentResult()
    const result = await reader.read()
    if (result?.value) decoder.onChunk(result.value)
  }

  const { positions, buildingCount, triangleCount, trianglesProcessed, version } = decoderResult
  const positionsSample = positions.slice(0, 18)

  console.log({ buildingCount, triangleCount, version, positionsSample })

  const positionsBuffer = createGPUBuffer(device, positions.buffer, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST)

  let lastTrianglesProcessed = trianglesProcessed

  async function loadTheRest (): Promise<void> {
    let chunks = 1
    while (true) {
      const result = await reader.read()
      if (result.done) {
        console.log(`finished loading data in ${chunks} chunks. time(ms):`, performance.now() - startTime)
        if (!decoder.done) console.warn('finished loading data but decoder.done is false!')
        return
      }
      chunks += 1

      // this should always have a value, but this check will satisfy typescript
      if (result.value) {
        decoder.onChunk(result.value)
        const decodeResult = decoder.getCurrentResult()!
        const { positions, trianglesProcessed } = decodeResult

        const bufferOffset = lastTrianglesProcessed * TRIANGLE_IN_BYTES
        const sizeOfWrite = (trianglesProcessed - lastTrianglesProcessed) * TRIANGLE_IN_BYTES
        device.queue.writeBuffer(positionsBuffer, bufferOffset, positions.buffer, bufferOffset, sizeOfWrite)
        lastTrianglesProcessed = trianglesProcessed
      }
    }
  }

  setTimeout(() => {
    loadTheRest().catch((err: any) => {
      console.error('Error occured while loading data', err)
    })
  }, 0)

  return {
    vertexCount: triangleCount * 3,
    getCurrentVertexCount: () => lastTrianglesProcessed * 3,
    buffers: { positions: positionsBuffer }
  }
}
