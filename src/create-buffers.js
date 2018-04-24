module.exports = function createBuffers(regl, settings) {
  let positionsBuffer = new Float32Array(0)
  let randomsBuffer = new Float32Array(0)
  let stateIndexesBuffer = new Float32Array(0)
  let barysBuffer = new Float32Array(0)

  function update({ positions, barys, randoms, buildings }, buildingIdxToStateIndexes) {
    positionsBuffer = positions
    barysBuffer = barys
    randomsBuffer = randoms
    stateIndexesBuffer = new Float32Array(buildings.length * 2)
    let k = 0
    for (let i = 0; i < positions.length / 3; i++) {
      stateIndexesBuffer[k++] = buildingIdxToStateIndexes[buildings[i] * 2]
      stateIndexesBuffer[k++] = buildingIdxToStateIndexes[buildings[i] * 2 + 1]
    }
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
