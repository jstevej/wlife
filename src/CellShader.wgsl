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

struct HistParams {
    height: f32,
    width: f32,
}

const maxAge = 0u; // {{{_auto-replace_}}}
const minAge = -i32(maxAge) + 1;

@group(0) @binding(0) var<storage> cellState: array<i32>; // TODO: fixed-size?
@group(0) @binding(2) var<uniform> gridSize: vec2f; // TODO: combine uniform?
@group(0) @binding(3) var<storage> pixelsPerCell: vec2f; // TODO: make uniform?
@group(0) @binding(4) var<storage> offsetCells: vec2f; // TODO: make uniform?
@group(0) @binding(5) var<storage> simParams: SimParams; // TODO: make uniform?
@group(0) @binding(6) var<storage> cellGradient: array<f32>; // TODO: fixed-size?
@group(0) @binding(8) var<storage, read_write> ageHistChunks: array<array<u32, 2 * maxAge>>;
@group(0) @binding(9) var<storage> histParams: HistParams;

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
    let age = cellState[i]; // age is already clamped to [-minAge, maxAge]
    let isAlive = f32(age > 0);
    let gradOff = select(
        3 * u32(abs(age)),
        3 * u32(age - 1),
        age > 0
    );
    let isNotOldest = f32(age > minAge);
    let isAxis = (1 - isAlive) * simParams.showAxes * f32(cell.x == 0 || cell.y == 0);
    let cellsPerPixel = 1 / pixelsPerCell;
    let isGrid = (1 - isAxis) * simParams.showGrid * f32(fract(cellF.x) < cellsPerPixel.x  || fract(cellF.y) < cellsPerPixel.y);
    let f = isAlive + (1 - isAlive) * 0.2 * simParams.showBackgroundAge * isNotOldest;
    let axisColor = vec3f(0.0, 1.0, 0.0);
    let gridColor = vec3f(0.2, 0.2, 0.2);
    let cellColor = f * vec3f(cellGradient[gradOff], cellGradient[gradOff + 1], cellGradient[gradOff + 2]);
    let rgb = (1 - isAxis) * (1 - isGrid) * cellColor + isAxis * axisColor + isGrid * gridColor;
    return vec4f(rgb,  1);
}

@vertex
fn histVertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.pos = vec4f(input.pos, 0, 1);
    return output;
}

fn sigmoidMap(x: f32, width: f32, k: f32) -> f32 {
    var y = x / (width - 1);
    y = 1 / (1 + exp(-k * (y - 0.5)));
    return y * (width - 1);
}

//fn asinMap(x: f32, width: f32) -> f32 {
//    var y = x / (width - 1);
//    y = 0.318309886 * asin(2 * (y - 0.5)) + 0.5;
//    return y * (width - 1);
//}

//fn cubicMap(x: f32, width: f32) -> f32 {
//    var y = x / (width - 1);
//    y = 4f * pow(y - 0.5, 3f) + 0.5;
//    return y * (width - 1);
//}

//fn invCubicMap(x: f32, width: f32) -> f32 {
//    var y = x / (width - 1);
//    y = pow(2f, -2f / 3f) * pow(y - 0.5, 1f / 3f) + 0.5;
//    return y * (width - 1);
//}

@fragment
fn histFragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let height2 = 0.5 * histParams.height;
    let width2 = 0.5 * histParams.width;
    let binPerPx = f32(maxAge - 1) / (histParams.width - 1);
    // TODO: not sure why we need to map to width (instead of width - 1) to see last bin
    let xx = select(input.pos.x, histParams.width, input.pos.x > histParams.width - 2);
    //let x = sigmoidMap(xx, histParams.width, 12);
    let x = xx;

    var color = vec4f(0, 0, 0, 1);

    if (input.pos.y < height2) {
        let maxCount = log2(0.5 * gridSize.x * gridSize.y);
        // top half -> age
        let binIndex = u32(floor(x * binPerPx)) + maxAge;
        let count = log2(f32(ageHistChunks[0][binIndex]) + 1);
        let binHeightPx = min(count, maxCount) * height2 / maxCount;
        if (input.pos.y > height2 - binHeightPx) {
            let gradientIndex = 3 * (binIndex - maxAge);
            color.r = cellGradient[gradientIndex];
            color.g = cellGradient[gradientIndex + 1];
            color.b = cellGradient[gradientIndex + 2];
        }
    } else {
        let maxCount = log2(0.5 * gridSize.x * gridSize.y);
        // bottom half -> background age
        let binIndex = maxAge - 1 - u32(floor(x * binPerPx));
        let count = log2(f32(ageHistChunks[0][binIndex]) + 1);
        let binHeightPx = min(count, maxCount) * height2 / maxCount;
        if (input.pos.y < height2 + binHeightPx) {
            let gradientIndex = 3 * (maxAge - 1 - binIndex);
            color.r = 0.4 * cellGradient[gradientIndex];
            color.g = 0.4 * cellGradient[gradientIndex + 1];
            color.b = 0.4 * cellGradient[gradientIndex + 2];
        }
    }

    return color;
}

