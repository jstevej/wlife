struct VertexInput {
    @location(0) pos: vec2f,
    //@builtin(instance_index) instance: u32,
};

struct VertexOutput {
    @builtin(position) pos: vec4f,
    //@location(0) cell: vec2f,
};

struct SimParams {
    showAxes: f32,
    showBackgroundAge: f32,
    showGrid: f32,
};

const maxAge = 100i;
const minAge = -100i;

@group(0) @binding(0) var<uniform> gridSize: vec2f;
@group(0) @binding(1) var<storage> pixelsPerCell: vec2f;
@group(0) @binding(2) var<storage> offsetCells: vec2f;
@group(0) @binding(3) var<storage> simParams: SimParams;
@group(0) @binding(4) var<storage> cellGradient: array<f32>;
@group(0) @binding(5) var<storage> cellState: array<i32>;

// WGSL's modulo implementation uses truncated division, which usually is not what we want for
// negative numbers. This implementation is for floored division, which is what we want.
//
// https://en.wikipedia.org/wiki/Modulo

fn modulo(x: vec2f, n: vec2f) -> vec2f {
    return x - n * floor(x / n);
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.pos = vec4f(input.pos, 0, 1);
    return output;
}

fn cellIndex(cell: vec2f) -> u32 {
    return u32(cell.y * gridSize.x + cell.x);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let cellF = modulo(
        input.pos.xy - 0.5 - offsetCells * pixelsPerCell,
        gridSize * pixelsPerCell
    ) / pixelsPerCell;
    let cell = floor(cellF);
    let i = cellIndex(cell);
    let state = cellState[i];
    let isAlive = f32(state > 0);
    let age = max(min(state, maxAge), minAge);
    let age3 = 3 * abs(age);
    let isNotOldest = f32(age > minAge);
    let isAxis = (1 - isAlive) * simParams.showAxes * f32(cell.x == 0 || cell.y == 0);
    let cellsPerPixel = 1 / pixelsPerCell;
    let isGrid = (1 - isAxis) * simParams.showGrid * f32(fract(cellF.x) < cellsPerPixel.x  || fract(cellF.y) < cellsPerPixel.y);
    let f = isAlive + (1 - isAlive) * 0.2 * simParams.showBackgroundAge * isNotOldest;
    let axisColor = vec3f(0.0, 1.0, 0.0);
    let gridColor = vec3f(0.2, 0.2, 0.2);
    let cellColor = f * vec3f(cellGradient[age3], cellGradient[age3 + 1], cellGradient[age3 + 2]);
    let rgb = (1 - isAxis) * (1 - isGrid) * cellColor + isAxis * axisColor + isGrid * gridColor;
    return vec4f(rgb,  1);
}
