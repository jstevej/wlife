struct VertexInput {
    @location(0) pos: vec2f,
    @builtin(instance_index) instance: u32,
};

struct VertexOutput {
    @builtin(position) pos: vec4f,
    @location(0) cell: vec2f,
};

struct SimParams {
    showAxes: f32,
};

@group(0) @binding(0) var<uniform> gridSize: vec2f;
@group(0) @binding(1) var<storage> viewScale: vec2f;
@group(0) @binding(2) var<storage> viewOffset: vec2f;
@group(0) @binding(3) var<storage> simParams: SimParams;
//@group(0) @binding(4) var<storage> cellGradient: array<vec3f>;
@group(0) @binding(4) var<storage> cellGradient: array<f32>;
@group(0) @binding(5) var<storage> cellState: array<u32>;

fn modulo(x: vec2f, n: vec2f) -> vec2f {
    //return ((x % n) + n) % n;
    // assume n is positive, then use floored division
    return x - n * floor(x / n);
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    let i = f32(input.instance);
    let cell = vec2f(i % gridSize.x, floor(i / gridSize.x));
    let state = f32(cellState[input.instance] > 0 || (simParams.showAxes > 0 && (cell.x == 0 || cell.y == 0)));
    let offsetCell = modulo(cell + viewOffset, gridSize);
    let gridPos = state * (((input.pos + 1 + 2 * offsetCell) / gridSize) - 1) * viewScale;

    var output: VertexOutput;
    output.pos = vec4f(gridPos, 0, 1);
    output.cell = cell;
    return output;
}

fn cellIndex(cell: vec2f) -> u32 {
    return u32(cell.y * gridSize.x + cell.x);
}

//fn hsl2rgb(hsl: vec3f) -> vec3f {
//    let c = vec3f(fract(hsl.x), clamp(hsl.yz, vec2f(0), vec2f(1)));
//    let rgb = clamp(abs((c.x * 6.0 + vec3f(0.0, 4.0, 2.0)) % 6.0 - 3.0) - 1.0, vec3f(0), vec3f(1));
//    return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
//}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let i = cellIndex(input.cell);
    let state = f32(cellState[i] > 0);
    let age = min(cellState[i], 100);
    let axisColor = vec3f(0.0, 1.0, 0.0);
    let cellColor = vec3f(cellGradient[3 * age], cellGradient[3 * age + 1], cellGradient[3 * age + 2]);
    let rgb = state * cellColor + (1 - state) * axisColor;
    //let hue = 0.667 * min(f32(cellState[i]) / 100.0, 1.0);
    //let rgb = hsl2rgb(vec3f(state * hue + (1 - state) * 0.333, 0.9, 0.5));
    return vec4f(rgb,  1);
}
