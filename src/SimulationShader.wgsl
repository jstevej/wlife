@group(0) @binding(0) var<uniform> gridSize: vec2f;
@group(0) @binding(5) var<storage> cellStateIn: array<i32>;
@group(0) @binding(6) var<storage, read_write> cellStateOut: array<i32>;

fn cellIndex(cell: vec2u) -> u32 {
    return cell.y * u32(gridSize.x) + cell.x;
}

fn cellAlive(x: u32, y: u32) -> u32 {
    return u32(cellStateIn[cellIndex(vec2(x, y))] > 0);
}

// rules[numNeighbors] = (ifAlive << 1) | (ifDead);

const rules: array<u32, 9> = array(0, 0, 2, 3, 0, 0, 0, 0, 0);
//const rules: array<u32, 9> = array(0, 0, 2, 2, 3, 0, 0, 0, 0); // jenn's rules

fn modulo(x: i32, n: u32) -> u32 {
    // assume n is positive, then use floored division
    return u32(i32(x) - i32(n) * i32(floor(f32(x) / f32(n))));
}

@compute
@workgroup_size(8, 8)
fn computeMain(@builtin(global_invocation_id) cell: vec3u) {
    let left = modulo(i32(cell.x) - 1, u32(gridSize.x));
    let right = modulo(i32(cell.x) + 1, u32(gridSize.x));
    let top = modulo(i32(cell.y) + 1, u32(gridSize.y));
    let bottom = modulo(i32(cell.y) - 1, u32(gridSize.y));

    let numNeighbors =
        cellAlive(left, top) +
        cellAlive(cell.x, top) +
        cellAlive(right, top) +
        cellAlive(left, cell.y) +
        //cellAlive(cell.x, cell.y) +
        cellAlive(right, cell.y) +
        cellAlive(left, bottom) +
        cellAlive(cell.x, bottom) +
        cellAlive(right, bottom);
    let value = i32((rules[numNeighbors] >> cellAlive(cell.x, cell.y)) & 0x01);
    let i = cellIndex(cell.xy);
    let prev = cellStateIn[i];
    cellStateOut[i] = i32(prev >= 0) * prev * value + value + i32(prev <= 0) * (1 - value) * (prev - 1);
}
