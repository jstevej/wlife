@group(0) @binding(0) var<uniform> gridSize: vec2f;
@group(0) @binding(3) var<storage> cellStateIn: array<u32>;
@group(0) @binding(4) var<storage, read_write> cellStateOut: array<u32>;

fn cellIndex(cell: vec2u) -> u32 {
    return cell.y * u32(gridSize.x) + cell.x;
}

fn cellAlive(x: u32, y: u32) -> u32 {
    return u32(cellStateIn[cellIndex(vec2(x, y))] > 0);
}

// rules[numNeighbors] = (ifAlive << 1) | (ifDead);

const rules: array<u32, 8> = array(0, 0, 2, 3, 0, 0, 0, 0);

@compute
@workgroup_size(8, 8)
fn computeMain(@builtin(global_invocation_id) cell: vec3u) {
    let left = (cell.x - 1) % u32(gridSize.x);
    let right = (cell.x + 1) % u32(gridSize.x);
    let top = (cell.y + 1) % u32(gridSize.y);
    let bottom = (cell.y - 1) % u32(gridSize.y);

    let numNeighbors = cellAlive(left, top) +
        cellAlive(cell.x, top) +
        cellAlive(right, top) +
        cellAlive(left, cell.y) +
        //cellAlive(cell.x, cell.y) +
        cellAlive(right, cell.y) +
        cellAlive(left, bottom) +
        cellAlive(cell.x, bottom) +
        cellAlive(right, bottom);
    let value = (rules[numNeighbors] >> cellAlive(cell.x, cell.y)) & 0x01;
    let i = cellIndex(cell.xy);
    cellStateOut[i] = cellStateIn[i] * value + value;
}
