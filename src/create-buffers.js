module.exports = function createBuffers(regl, settings) {
  const get32BitSlotCount = (vertexCount) => (
    vertexCount * 3 + // positions
    vertexCount + // randoms
    vertexCount * 2 + // stateIndexes
    vertexCount * 3 // barys
  )

  const attributesBuffer = regl.buffer({
    usage: 'dynamic',
    type: 'float',
    length: get32BitSlotCount(settings.POSITIONS_LENGTH / 3) * 4
  })

  const byteStride = get32BitSlotCount(1) * 4
  const positionsBuffer = {
    buffer: attributesBuffer,
    offset: 0,
    stride: byteStride
  }

  const randomsBuffer = {
    buffer: attributesBuffer,
    offset: 3 * 4,
    stride: byteStride
  }

  const stateIndexesBuffer = {
    buffer: attributesBuffer,
    offset: 4 * 4,
    stride: byteStride
  }

  const barysBuffer = {
    buffer: attributesBuffer,
    offset: 6 * 4,
    stride: byteStride
  }

  let lastI = 0
  function update({ positions, barys, randoms, buildings }, buildingIdxToStateIndexes) {
    const stride = get32BitSlotCount(1)
    const newData = new Float32Array((positions.length / 3 - lastI) * stride)
    const subDataOffset = lastI * stride * 4
    let k = 0
    for (let i = lastI; i < positions.length / 3; i++) {
      newData[k++] = positions[i * 3 + 0]
      newData[k++] = positions[i * 3 + 1]
      newData[k++] = positions[i * 3 + 2]
      newData[k++] = randoms[i]
      newData[k++] = buildingIdxToStateIndexes[buildings[i] * 2]
      newData[k++] = buildingIdxToStateIndexes[buildings[i] * 2 + 1]
      newData[k++] = barys[i * 3 + 0]
      newData[k++] = barys[i * 3 + 1]
      newData[k++] = barys[i * 3 + 2]
      lastI = i
    }
    attributesBuffer.subdata(newData, subDataOffset)
  }

  function getAttributes() {
    return {
      positions: positionsBuffer,
      randoms: randomsBuffer,
      stateIndexes: stateIndexesBuffer,
      barys: barysBuffer
    }
  }

  return {
    getAttributes,
    update
  }
}
