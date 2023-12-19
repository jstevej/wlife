import { Component, createResource } from 'solid-js';
import cellShaderCode from './CellShader.wgsl?raw';
import simulationShaderCode from './SimulationShader.wgsl?raw';

//const width = (2048 + 256) * 2;
//const height = (1024 + 256) * 2;
const width = 8192;
const height = 4096;
const gridFactor = 4;
const gridSizeX = width / gridFactor;
const gridSizeY = height / gridFactor;

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

        const uniformArray = new Float32Array([gridSizeX, gridSizeY]);
        const uniformBuffer = device.createBuffer({
            label: 'grid uniforms',
            size: uniformArray.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

        const cellStateArray = new Uint32Array(gridSizeX * gridSizeY);
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
            code: cellShaderCode,
        });

        const workgroupSize = 8;

        const simulationShaderModule = device.createShaderModule({
            label: 'game of life simulation shader',
            code: simulationShaderCode,
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

        const updateIntervalMs = 1000 / 20;
        let step = 0;

        function updateGrid() {
            if (!context) return;

            const encoder = device.createCommandEncoder();

            const computePass = encoder.beginComputePass();
            computePass.setPipeline(simulationPipeline);
            computePass.setBindGroup(0, bindGroups[step % 2]);
            const workgroupCountX = Math.ceil(gridSizeX / workgroupSize);
            const workgroupCountY = Math.ceil(gridSizeY / workgroupSize);
            computePass.dispatchWorkgroups(workgroupCountX, workgroupCountY);
            computePass.end();

            step++;
            const pass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: context.getCurrentTexture().createView(),
                        loadOp: 'clear',
                        //clearValue: { r: 0.05, g: 0.05, b: 0.1, a: 1 },
                        //clearValue: [0.05, 0.05, 0.1, 1],
                        clearValue: [0, 0, 0, 1],
                        storeOp: 'store',
                    },
                ],
            });

            pass.setPipeline(cellPipeline);
            pass.setVertexBuffer(0, vertexBuffer);
            pass.setBindGroup(0, bindGroups[step % 2]);
            // 2D points, so 2 points per vertex
            // draw a grid full of instances
            pass.draw(vertices.length / 2, gridSizeX * gridSizeY);

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
