struct SimResults {
    numAlive: atomic<i32>,
    numStable: atomic<i32>,
};

const maxAge = 100i;

@group(0) @binding(0) var<uniform> gridSize: vec2f;
@group(0) @binding(5) var<storage, read_write> simResults: SimResults;
@group(0) @binding(6) var<storage> cellStateIn: array<i32>;
@group(0) @binding(7) var<storage, read_write> cellStateOut: array<i32>;

fn cellIndex(x: u32, y: u32) -> u32 {
    return y * u32(gridSize.x) + x;
}

fn isCellAlive(i: u32) -> u32 {
    return u32(cellStateIn[i] > 0);
}

// rules[numNeighbors] = (ifAlive << 1) | (ifDead);

const rules: array<u32, 9> = array(0, 0, 2, 3, 0, 0, 0, 0, 0); // conway's rules
//const rules: array<u32, 9> = array(0, 0, 2, 2, 3, 0, 0, 0, 0);

// WGSL's modulo implementation uses truncated division, which usually is not what we want for
// negative numbers. This implementation is for floored division, which is what we want.
//
// https://en.wikipedia.org/wiki/Modulo

fn modulo(x: i32, n: u32) -> u32 {
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
        isCellAlive(cellIndex(left, top)) +
        isCellAlive(cellIndex(cell.x, top)) +
        isCellAlive(cellIndex(right, top)) +
        isCellAlive(cellIndex(left, cell.y)) +
        isCellAlive(cellIndex(right, cell.y)) +
        isCellAlive(cellIndex(left, bottom)) +
        isCellAlive(cellIndex(cell.x, bottom)) +
        isCellAlive(cellIndex(right, bottom));
    let i = cellIndex(cell.x, cell.y);
    let value = i32((rules[numNeighbors] >> isCellAlive(i)) & 0x01);
    let prev = cellStateIn[i];
    let age = i32(prev >= 0) * prev * value + value + i32(prev <= 0) * (1 - value) * (prev - 1);
    cellStateOut[i] = age;

    if (age > 0) {
        atomicAdd(&simResults.numAlive, 1);

        if (age >= maxAge) {
            atomicAdd(&simResults.numStable, 1);
        }
    }
}
