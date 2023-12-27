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
    showBackgroundAge: f32,
};

@group(0) @binding(0) var<uniform> gridSize: vec2f;
@group(0) @binding(1) var<storage> viewScale: vec2f;
@group(0) @binding(2) var<storage> viewOffset: vec2f;
@group(0) @binding(3) var<storage> simParams: SimParams;
@group(0) @binding(4) var<storage> cellGradient: array<f32>;
@group(0) @binding(5) var<storage> cellState: array<i32>;

fn modulo(x: vec2f, n: vec2f) -> vec2f {
    //return ((x % n) + n) % n;
    // assume n is positive, then use floored division
    return x - n * floor(x / n);
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    let i = f32(input.instance);
    let cell = vec2f(i % gridSize.x, floor(i / gridSize.x));
    let offsetCell = modulo(cell + viewOffset, gridSize);
    let gridPos = (((input.pos + 1 + 2 * offsetCell) / gridSize) - 1) * viewScale;

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
    let state = cellState[cellIndex(input.cell)];
    let isAlive = f32(state > 0);
    let age = max(min(state, 100), -100);
    let age3 = 3 * abs(age);
    let axisColor = vec3f(0.0, 1.0, 0.0);
    let isAxis = (1 - isAlive) * simParams.showAxes * f32(input.cell.x == 0 || input.cell.y == 0);
    let f = isAlive + (1 - isAlive) * 0.2 * simParams.showBackgroundAge;
    let cellColor = f * vec3f(cellGradient[age3], cellGradient[age3 + 1], cellGradient[age3 + 2]);
    let rgb = (1 - isAxis) * cellColor + isAxis * axisColor;
    return vec4f(rgb,  1);
}
