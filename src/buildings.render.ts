import { mat4 } from 'gl-matrix'
import dataUrl from '../models/processed/DA-all.bin?url'
// import dataUrl from '../models/processed/manhattan.bin?url'
import StreamDecoder from './stream-decoder'

type RenderProps = { view: number[] }
type RenderState = null
type RenderFn = (renderProps: RenderProps, renderState: RenderState, context: GPUCanvasContext) => void

const fadeHeightStart = 1400
const fadeHeightEnd = -700

export default async function createRenderer (device: GPUDevice, texture: GPUTexture): Promise<RenderFn> {
  const result = await getDataStreamer(device, dataUrl)

  const { getCurrentIndexCount, buffers } = result

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
    primitive: {
      topology: 'triangle-list',
      frontFace: 'ccw',
      cullMode: 'back'
    },
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

  let lastIndexesCount = 0
  return function render (renderProps: { view: number[] }, renderState: null, context: GPUCanvasContext) {
    const commandEncoder = device.createCommandEncoder()
    const { width, height } = context.canvas

    const cameraView = mat4.fromValues(renderProps.view[0], renderProps.view[1], renderProps.view[2], renderProps.view[3], renderProps.view[4], renderProps.view[5], renderProps.view[6], renderProps.view[7], renderProps.view[8], renderProps.view[9], renderProps.view[10], renderProps.view[11], renderProps.view[12], renderProps.view[13], renderProps.view[14], renderProps.view[15])
    const projection = mat4.perspective(new Float32Array(16), Math.PI / 4, width / height, 1, 1000000)

    const indexesCount = getCurrentIndexCount()

    const isDirty =
      !mat4.equals(uniformData.subarray(0, 16), projection) ||
      !mat4.equals(uniformData.subarray(16, 32), cameraView) ||
      indexesCount !== lastIndexesCount

    lastIndexesCount = indexesCount

    uniformData.set(projection, 0)
    uniformData.set(cameraView, 16)
    uniformData.set([fadeHeightStart, fadeHeightEnd], 32)
    if (isDirty) {
      console.log('rendering', buffers.indexes.length, 'index buffers')
      const textureView = context.getCurrentTexture().createView()

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

      renderPass.setPipeline(pipeline)
      renderPass.setVertexBuffer(0, buffers.positions)
      renderPass.setBindGroup(0, uniformBindGroup)
      let remainingIndexCount = indexesCount
      for (const indexes of buffers.indexes) {
        const countToDraw = Math.min(remainingIndexCount, MAX_ARRAY_SIZE)
        renderPass.setIndexBuffer(indexes, 'uint32')
        renderPass.drawIndexed(countToDraw)
        remainingIndexCount -= countToDraw
      }
      renderPass.end()
      device.queue.submit([commandEncoder.finish()])
    }
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
  getCurrentIndexCount: () => number
  indexCount: number
  buffers: {
    positions: GPUBuffer
    indexes: GPUBuffer[]
    // barys: GPUBuffer
    // buildingIds: GPUBuffer
  }
}

export const MAX_BUFFER_SIZE_BYTES = 268435456 // 256MiB
export const MAX_ARRAY_SIZE = Math.floor(MAX_BUFFER_SIZE_BYTES / 4 / 3 / 32) * 3
export const MAX_ARRAY_SIZE_BYTES = MAX_ARRAY_SIZE * 4

if (MAX_ARRAY_SIZE % 3 !== 0) throw new Error('Array size is not divisible by 3, which is required for triangle lists')

const VERTEX_IN_BYTES = 3 * 4 // 3 floats * 4 bytes (float32)

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

  const { vertices, indexes, buildingCount, triangleCount, trianglesProcessed, verticesProcessed, version } = decoderResult
  const positionsSample = vertices.slice(0, 18)
  const indexSample = indexes.slice(0, 9)
  console.log({ buildingCount, triangleCount, version, positionsSample, indexSample })

  const positionsBuffer = createGPUBuffer(device, vertices.buffer, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST)
  const indexesBuffers: GPUBuffer[] = []
  let i = triangleCount * 3
  while (i > 0) {
    const bufferSize = Math.min(MAX_ARRAY_SIZE, i) * 4
    indexesBuffers.push(createGPUBuffer(device, new ArrayBuffer(bufferSize), GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST))
    i -= MAX_ARRAY_SIZE
  }

  let lastTrianglesProcessed = trianglesProcessed
  let lastVerticesProcessed = verticesProcessed

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
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const decodeResult = decoder.getCurrentResult()!
        const { vertices, verticesProcessed, trianglesProcessed, indexes } = decodeResult

        const bufferOffset = lastVerticesProcessed * VERTEX_IN_BYTES
        const sizeOfWrite = (verticesProcessed - lastVerticesProcessed) * VERTEX_IN_BYTES
        device.queue.writeBuffer(positionsBuffer, bufferOffset, vertices.buffer, bufferOffset, sizeOfWrite)

        const startIdx = Math.floor(lastTrianglesProcessed * 3 / MAX_ARRAY_SIZE)
        const endIdx = Math.ceil(trianglesProcessed * 3 / MAX_ARRAY_SIZE)

        let curIdx = startIdx
        while (curIdx < endIdx) {
          const indexesBuffer = indexesBuffers[curIdx]
          const size = Math.min(triangleCount * 3 - curIdx * MAX_ARRAY_SIZE, MAX_ARRAY_SIZE)
          // TODO: don't write the whole buffer, just the part that was updated
          device.queue.writeBuffer(indexesBuffer, 0, indexes, curIdx * MAX_ARRAY_SIZE, size)
          curIdx += 1
        }

        lastTrianglesProcessed = trianglesProcessed
        lastVerticesProcessed = verticesProcessed
      }
    }
  }

  setTimeout(() => {
    loadTheRest().catch((err: any) => {
      console.error('Error occured while loading data', err)
    })
  }, 0)

  return {
    indexCount: triangleCount * 3,
    getCurrentIndexCount: () => lastTrianglesProcessed * 3,
    buffers: {
      positions: positionsBuffer,
      indexes: indexesBuffers
    }
  }
}
