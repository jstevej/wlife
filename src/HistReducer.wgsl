const maxAge = 0u; // {{{_auto-replace_}}}

struct Uniforms {
    stride: u32,
};

@group(0) @binding(0) var<storage, read_write> ageHistChunks: array<array<u32, 2 * maxAge>>;
@group(0) @binding(1) var<uniform> uni: Uniforms;

@compute
@workgroup_size(2 * maxAge)
fn reduceHistChunks(
    @builtin(local_invocation_id) local_invocation_id: vec3u,
    @builtin(workgroup_id) workgroup_id: vec3u,
) {
    let idx = local_invocation_id.x;
    let chunk0 = workgroup_id.x * 2 * uni.stride;
    let chunk1 = chunk0 + uni.stride;
    let sum = ageHistChunks[chunk0][idx] + ageHistChunks[chunk1][idx];
    ageHistChunks[chunk0][idx] = sum;
    ageHistChunks[chunk1][idx] = 0; // set to zero for next pass
}
