import { leadingAndTrailing, throttle } from '@solid-primitives/scheduled';
import { Component, createEffect, createResource, createSignal, JSX, splitProps } from 'solid-js';
import cellShaderCode from './CellShader.wgsl?raw';
import { useGameOfLife } from './GameOfLifeProvider';
import simulationShaderCode from './SimulationShader.wgsl?raw';

export type GameOfLifeProps = {
    foo?: string;
} & JSX.HTMLAttributes<HTMLDivElement>;

type Dimensions = {
    height: number;
    width: number;
};

// Javascript's modulo is weird for negative numbers. This fixes it.
// https://web.archive.org/web/20090717035140if_/javascript.about.com/od/problemsolving/a/modulobug.htm

function modulo(x: number, n: number): number {
    return ((x % n) + n) % n;
}

export const GameOfLife: Component<GameOfLifeProps> = props => {
    const gameHeight = window.screen.height;
    const gameWidth = window.screen.width;
    const [, rest] = splitProps(props, ['foo']);
    const { cellExtent, frameRate, resetListen } = useGameOfLife();
    const [ref, setRef] = createSignal<HTMLDivElement>();
    let mouseDragging = false;
    let mouseStartX = 0;
    let mouseStartY = 0;
    let mouseDragX = 0;
    let mouseDragY = 0;
    let mouseOffsetX = 0;
    let mouseOffsetY = 0;
    let scale = 4;
    const [canvasSize, setCanvasSize] = createSignal<Dimensions>({ height: 100, width: 100 });
    const canvasSizeThrottle = leadingAndTrailing(
        throttle,
        (dim: Dimensions) => setCanvasSize(dim),
        500
    );

    createEffect(() => {
        const fooRef = ref();
        if (fooRef === undefined) return;
        console.log(`registering resize observer`);
        const resizeObserver = new ResizeObserver(entries => {
            const rect = entries[0].contentRect;
            canvasSizeThrottle({
                height: Math.floor(rect.height),
                width: Math.floor(rect.width),
            });
        });
        resizeObserver.observe(fooRef);
    });

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

        const vertices = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
        for (let i = 0; i < vertices.length; i += 2) {
            vertices[i] *= cellExtent().width;
            vertices[i + 1] *= cellExtent().height;
        }
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

        const gridSizeArray = new Float32Array([gameWidth, gameHeight]);
        const gridSizeBuffer = device.createBuffer({
            label: 'gridSize uniform',
            size: gridSizeArray.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(gridSizeBuffer, 0, gridSizeArray);

        const viewScaleArray = new Float32Array([
            (4 * gameWidth) / canvasSize().width,
            (4 * gameHeight) / canvasSize().height,
        ]);
        const viewScaleStorage = device.createBuffer({
            label: 'viewScale storage',
            size: viewScaleArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(viewScaleStorage, 0, viewScaleArray);

        const viewOffsetArray = new Float32Array([0, 0]);
        const viewOffsetStorage = device.createBuffer({
            label: 'viewOffset storage',
            size: viewOffsetArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(viewOffsetStorage, 0, viewOffsetArray);

        const cellStateArray = new Uint32Array(gameWidth * gameHeight);
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
                    buffer: {}, // gridSize uniform buffer (default is 'uniform' so can leave empty)
                },
                {
                    binding: 1,
                    visibility:
                        GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'read-only-storage' },
                },
                {
                    binding: 2,
                    visibility:
                        GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'read-only-storage' },
                },
                {
                    binding: 3,
                    visibility:
                        GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'read-only-storage' }, // cell state input buffer
                },
                {
                    binding: 4,
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
                        binding: 0,
                        resource: { buffer: gridSizeBuffer },
                    },
                    {
                        binding: 1,
                        resource: { buffer: viewScaleStorage },
                    },
                    {
                        binding: 2,
                        resource: { buffer: viewOffsetStorage },
                    },
                    {
                        binding: 3,
                        resource: { buffer: cellStateStorage[0] },
                    },
                    {
                        binding: 4,
                        resource: { buffer: cellStateStorage[1] },
                    },
                ],
            }),
            device.createBindGroup({
                label: 'cell renderer bind group (pong)',
                layout: bindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: gridSizeBuffer },
                    },
                    {
                        binding: 1,
                        resource: { buffer: viewScaleStorage },
                    },
                    {
                        binding: 2,
                        resource: { buffer: viewOffsetStorage },
                    },
                    {
                        binding: 3,
                        resource: { buffer: cellStateStorage[1] },
                    },
                    {
                        binding: 4,
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

        let step = 0;

        resetListen(() => {
            step = 0;
            for (let i = 0; i < cellStateArray.length; i++) {
                cellStateArray[i] = Math.random() > 0.6 ? 1 : 0;
            }
            device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);
        });

        function updateGrid() {
            if (!context) return;

            viewOffsetArray[0] = modulo(mouseOffsetX + mouseDragX, gameWidth);
            viewOffsetArray[1] = -modulo(mouseOffsetY + mouseDragY, gameHeight);
            device.queue.writeBuffer(viewOffsetStorage, 0, viewOffsetArray);

            viewScaleArray[0] = (scale * gameWidth) / canvasSize().width;
            viewScaleArray[1] = (scale * gameHeight) / canvasSize().height;
            device.queue.writeBuffer(viewScaleStorage, 0, viewScaleArray);

            const encoder = device.createCommandEncoder();

            const computePass = encoder.beginComputePass();
            computePass.setPipeline(simulationPipeline);
            computePass.setBindGroup(0, bindGroups[step % 2]);
            const workgroupCountX = Math.ceil(gameWidth / workgroupSize);
            const workgroupCountY = Math.ceil(gameHeight / workgroupSize);
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
            pass.draw(vertices.length / 2, gameWidth * gameHeight);

            pass.end();
            device.queue.submit([encoder.finish()]);
        }

        let updateInterval: ReturnType<typeof setInterval> | undefined;

        createEffect(() => {
            const updateIntervalMs = 1000 / frameRate();
            console.log(`frameRate = ${frameRate()}, updateIntervalMs = ${updateIntervalMs}`);

            if (updateInterval !== undefined) {
                clearInterval(updateInterval);
            }

            updateInterval = setInterval(updateGrid, updateIntervalMs);
        });
    });

    const onMouseDown = (event: MouseEvent) => {
        mouseStartX = event.clientX;
        mouseStartY = event.clientY;
        mouseDragging = true;
    };

    const onMouseMove = (event: MouseEvent) => {
        if (mouseDragging) {
            mouseDragX = (event.clientX - mouseStartX) / scale;
            mouseDragY = (event.clientY - mouseStartY) / scale;
        }
    };

    const onMouseUp = (event: MouseEvent) => {
        mouseOffsetX = modulo(mouseOffsetX + mouseDragX, gameWidth);
        mouseOffsetY = modulo(mouseOffsetY + mouseDragY, gameHeight);
        mouseDragX = 0;
        mouseDragY = 0;
        mouseDragging = false;
    };

    const onWheel = (event: WheelEvent) => {
        scale = Math.min(Math.max(scale + Math.sign(event.deltaY), 1), 15);
        event.preventDefault();
    };

    return (
        <div {...rest} ref={setRef}>
            <canvas
                width={canvasSize().width}
                height={canvasSize().height}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseOut={onMouseUp}
                onMouseUp={onMouseUp}
                onWheel={onWheel}
            />
        </div>
    );
};
