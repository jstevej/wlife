import { Component, createResource } from 'solid-js';

const width = 1024;
const height = 1024;
const gridSize = 128;

const App: Component = () => {
    const [foo] = createResource('canvas', async (selector: string) => {
        // Setup canvas.

        if (!navigator.gpu) {
            console.error(`WebGPU not supported on this browser`);
            return undefined;
        }

        const adapter = await navigator.gpu.requestAdapter();

        if (!adapter) {
            console.error(`WebGPU adapter not found`);
            return undefined;
        }

        const device = await adapter.requestDevice();
        const canvas = document.querySelector('canvas');

        if (!canvas) {
            console.error(`canvas not found`);
            return undefined;
        }

        const context = canvas.getContext('webgpu');

        if (!context) {
            console.error(`context not found`);
            return undefined;
        }

        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format });

        // Vertex stuff.

        const vertices = new Float32Array([
            -0.8, -0.8, 0.8, -0.8, 0.8, 0.8, -0.8, -0.8, 0.8, 0.8, -0.8, 0.8,
        ]);
        const vertexBuffer = device.createBuffer({
            label: 'cell vertices',
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/ 0, vertices);
        const vertexBufferLayout: GPUVertexBufferLayout = {
            arrayStride: 8, // 2 32-bit floats (one 2D point) = 8 bytes
            attributes: [
                {
                    format: 'float32x2',
                    offset: 0,
                    shaderLocation: 0, // position: 0-15, see vertex shader
                },
            ],
        };

        const uniformArray = new Float32Array([gridSize, gridSize]);
        const uniformBuffer = device.createBuffer({
            label: 'grid uniforms',
            size: uniformArray.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

        const cellStateArray = new Uint32Array(gridSize * gridSize);
        const cellStateStorage = [
            device.createBuffer({
                label: 'cell state ping',
                size: cellStateArray.byteLength,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            }),
            device.createBuffer({
                label: 'cell state pong',
                size: cellStateArray.byteLength,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            }),
        ];
        for (let i = 0; i < cellStateArray.length; i++) {
            cellStateArray[i] = Math.random() > 0.6 ? 1 : 0;
        }
        device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);

        // Shader stuff.

        const cellShaderModule = device.createShaderModule({
            label: 'cell shader',
            code: `
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
                let state = f32(cellState[input.instance]);
                let i = f32(input.instance);
                let cell = vec2f(i % grid.x, floor(i / grid.x));

                let cellOffset = cell / grid * 2;
                let gridPos = (state * input.pos + 1) / grid - 1 + cellOffset;

                var output: VertexOutput;
                output.pos = vec4f(gridPos, 0, 1);
                output.cell = cell;
                return output;
            }

            @fragment
            //fn fragmentMain(@location(0) cell: vec2f) -> @location(0) vec4f {
            fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
                //return vec4f(0, 0.4, 0.4, 1); // rgba
                let c = input.cell / grid;
                return vec4f(c, 1 - c.x, 1);
            }
            `,
        });

        const workgroupSize = 8;

        const simulationShaderModule = device.createShaderModule({
            label: 'game of life simulation shader',
            code: `
                @group(0) @binding(0) var<uniform> grid: vec2f;
                @group(0) @binding(1) var<storage> cellStateIn: array<u32>;
                @group(0) @binding(2) var<storage, read_write> cellStateOut: array<u32>;

                fn cellIndex(cell: vec2u) -> u32 {
                    return (cell.y % u32(grid.y)) * u32(grid.x) + (cell.x % u32(grid.x));
                }

                fn cellAlive(x: u32, y: u32) -> u32 {
                    return cellStateIn[cellIndex(vec2(x, y))];
                }

                @compute
                @workgroup_size(${workgroupSize}, ${workgroupSize})
                fn computeMain(@builtin(global_invocation_id) cell: vec3u) {
                    let numNeighbors = cellAlive(cell.x + 1, cell.y + 1) +
                        cellAlive(cell.x + 1, cell.y) +
                        cellAlive(cell.x + 1, cell.y - 1) +

                        cellAlive(cell.x, cell.y + 1) +
                        //cellAlive(cell.x, cell.y) +
                        cellAlive(cell.x, cell.y - 1) +

                        cellAlive(cell.x - 1, cell.y + 1) +
                        cellAlive(cell.x - 1, cell.y) +
                        cellAlive(cell.x - 1, cell.y - 1);
                    let i = cellIndex(cell.xy);

                    switch numNeighbors {
                        case 2: {
                            cellStateOut[i] = cellStateIn[i];
                        }
                        case 3: {
                            cellStateOut[i] = 1;
                        }
                        default: {
                            cellStateOut[i] = 0;
                        }
                    }
                }
            `,
        });

        // Pipeline.

        const bindGroupLayout = device.createBindGroupLayout({
            label: 'cell bind group layout',
            entries: [
                {
                    binding: 0,
                    visibility:
                        GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
                    buffer: {}, // grid uniform buffer (default is 'uniform' so can leave empty)
                },
                {
                    binding: 1,
                    visibility:
                        GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'read-only-storage' }, // cell state input buffer
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'storage' }, // cell state output buffer
                },
            ],
        });

        const bindGroups = [
            device.createBindGroup({
                label: 'cell renderer bind group (ping)',
                layout: bindGroupLayout,
                entries: [
                    {
                        binding: 0, // corresponds to @binding(0)
                        resource: { buffer: uniformBuffer },
                    },
                    {
                        binding: 1, // corresponds to @binding(1)
                        resource: { buffer: cellStateStorage[0] },
                    },
                    {
                        binding: 2,
                        resource: { buffer: cellStateStorage[1] },
                    },
                ],
            }),
            device.createBindGroup({
                label: 'cell renderer bind group (pong)',
                layout: bindGroupLayout,
                entries: [
                    {
                        binding: 0, // corresponds to @binding(0)
                        resource: { buffer: uniformBuffer },
                    },
                    {
                        binding: 1, // corresponds to @binding(1)
                        resource: { buffer: cellStateStorage[1] },
                    },
                    {
                        binding: 2,
                        resource: { buffer: cellStateStorage[0] },
                    },
                ],
            }),
        ];

        const pipelineLayout = device.createPipelineLayout({
            label: 'cell pipeline layout',
            bindGroupLayouts: [bindGroupLayout],
        });

        const cellPipeline = device.createRenderPipeline({
            label: 'cell pipeline',
            layout: pipelineLayout,
            vertex: {
                module: cellShaderModule,
                entryPoint: 'vertexMain',
                buffers: [vertexBufferLayout],
            },
            fragment: {
                module: cellShaderModule,
                entryPoint: 'fragmentMain',
                targets: [{ format }],
            },
        });

        const simulationPipeline = device.createComputePipeline({
            label: 'simulation pipeline',
            layout: pipelineLayout,
            compute: {
                module: simulationShaderModule,
                entryPoint: 'computeMain',
            },
        });

        const updateIntervalMs = 200;
        let step = 0;

        function updateGrid() {
            if (!context) return;

            const encoder = device.createCommandEncoder();

            const computePass = encoder.beginComputePass();
            computePass.setPipeline(simulationPipeline);
            computePass.setBindGroup(0, bindGroups[step % 2]);
            const workgroupCount = Math.ceil(gridSize / workgroupSize);
            computePass.dispatchWorkgroups(workgroupCount, workgroupCount);
            computePass.end();

            step++;
            const pass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: context.getCurrentTexture().createView(),
                        loadOp: 'clear',
                        //clearValue: { r: 0.05, g: 0.05, b: 0.1, a: 1 },
                        clearValue: [0.05, 0.05, 0.1, 1],
                        storeOp: 'store',
                    },
                ],
            });

            pass.setPipeline(cellPipeline);
            pass.setVertexBuffer(0, vertexBuffer);
            pass.setBindGroup(0, bindGroups[step % 2]);
            // 2D points, so 2 points per vertex
            // draw a grid full of instances
            pass.draw(vertices.length / 2, gridSize * gridSize);

            pass.end();
            device.queue.submit([encoder.finish()]);
        }

        setInterval(updateGrid, updateIntervalMs);
    });

    return (
        <>
            <h1>WebGPU Life</h1>
            <canvas width={width} height={height} />
        </>
    );
};

export default App;
