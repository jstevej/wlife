struct VertexInput {
    @location(0) pos: vec2f,
    @builtin(instance_index) instance: u32,
};

struct VertexOutput {
    @builtin(position) pos: vec4f,
    @location(0) cell: vec2f,
};

@group(0) @binding(0) var<uniform> grid: vec2f;
@group(0) @binding(1) var<storage> cellState: array<u32>;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    let state = f32(cellState[input.instance] > 0);
    let i = f32(input.instance);
    let cell = vec2f(i % grid.x, floor(i / grid.x));

    let cellOffset = cell / grid * 2;
    let gridPos = (state * input.pos + 1) / grid - 1 + cellOffset;

    var output: VertexOutput;
    output.pos = vec4f(gridPos, 0, 1);
    output.cell = cell;
    return output;
}

fn cellIndex(cell: vec2f) -> u32 {
    return u32(cell.y * grid.x + cell.x);
}

fn hsl2rgb(hsl: vec3f) -> vec3f {
    let c = vec3f(fract(hsl.x), clamp(hsl.yz, vec2f(0), vec2f(1)));
    let rgb = clamp(abs((c.x * 6.0 + vec3f(0.0, 4.0, 2.0)) % 6.0 - 3.0) - 1.0, vec3f(0), vec3f(1));
    return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let i = cellIndex(input.cell);
    let hue = 0.667 * min(f32(cellState[i]) / 100.0, 1.0);
    let rgb = hsl2rgb(vec3f(hue, 0.9, 0.5));
    return vec4f(rgb,  1);
}
