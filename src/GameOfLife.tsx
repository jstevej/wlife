import { leadingAndTrailing, throttle } from '@solid-primitives/scheduled';
import {
    Component,
    createEffect,
    createResource,
    createSignal,
    JSX,
    Match,
    splitProps,
    Switch,
    untrack,
} from 'solid-js';
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

type GpuData = {
    bindGroups: Array<GPUBindGroup>;
    cellPipeline: GPURenderPipeline;
    cellStateArray: Uint32Array;
    cellStateStorage: Array<GPUBuffer>;
    context: GPUCanvasContext;
    device: GPUDevice;
    gridSizeArray: Float32Array;
    gridSizeBuffer: GPUBuffer;
    step: number;
    simulationPipeline: GPUComputePipeline;
    vertexBuffer: GPUBuffer;
    vertices: Float32Array;
    viewOffsetArray: Float32Array;
    viewOffsetStorage: GPUBuffer;
    viewScaleArray: Float32Array;
    viewScaleStorage: GPUBuffer;
    workgroupSize: number;
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
    const { frameRate, resetListen, zoomIsInverted } = useGameOfLife();
    const [ref, setRef] = createSignal<HTMLDivElement>();
    let mouseDragging = false;
    let mouseClientX = 0;
    let mouseClientY = 0;
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
    let updateTimeout: ReturnType<typeof setTimeout> | undefined;
    let animationFrameRequest: ReturnType<typeof requestAnimationFrame> | undefined;

    createEffect(() => {
        const fooRef = ref();
        if (fooRef === undefined) return;
        const resizeObserver = new ResizeObserver(entries => {
            const rect = entries[0].contentRect;
            canvasSizeThrottle({
                height: Math.floor(rect.height),
                width: Math.floor(rect.width),
            });
        });
        resizeObserver.observe(fooRef);
    });

    const [gpuData] = createResource<GpuData | string>(async (): Promise<GpuData | string> => {
        // Setup canvas.

        if (!navigator.gpu) return `WebGPU not supported on this browser`;

        const adapter = await navigator.gpu.requestAdapter();

        if (!adapter) return `WebGPU adapter not found`;

        const device = await adapter.requestDevice();
        const canvas = document.querySelector('canvas');

        if (!canvas) return `canvas element not found`;

        const context = canvas.getContext('webgpu');

        if (!context) return `context not found`;

        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format });

        // Vertex stuff.

        const vertices = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
        for (let i = 0; i < vertices.length; i += 2) {
            vertices[i] *= 1;
            vertices[i + 1] *= 1;
        }
        const vertexBuffer = device.createBuffer({
            label: 'cell vertices',
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        device.queue.writeBuffer(vertexBuffer, 0, vertices);
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

        return {
            bindGroups,
            cellPipeline,
            cellStateArray,
            cellStateStorage,
            context,
            device,
            gridSizeArray,
            gridSizeBuffer,
            step: 0,
            simulationPipeline,
            vertexBuffer,
            vertices,
            viewOffsetArray,
            viewOffsetStorage,
            viewScaleArray,
            viewScaleStorage,
            workgroupSize,
        };
    });

    const scheduleNextFrame = () => {
        const frameTimestamp = Date.now();
        updateTimeout = undefined;

        animationFrameRequest = requestAnimationFrame(() => {
            animationFrameRequest = undefined;
            updateGrid();
            const fr = untrack(frameRate);
            const frameDurationMs = 1000 / fr;
            const elapsedMs = Date.now() - frameTimestamp;
            const timeoutMs = Math.max(frameDurationMs - elapsedMs, 0);
            updateTimeout = setTimeout(scheduleNextFrame, timeoutMs);
        });
    };

    createEffect(() => {
        const data = gpuData();
        const fr = frameRate();

        if (data === undefined || typeof data === 'string') return;

        const updateTimeoutMs = 1000 / fr;

        if (animationFrameRequest !== undefined) cancelAnimationFrame(animationFrameRequest);
        if (updateTimeout !== undefined) clearTimeout(updateTimeout);

        updateTimeout = setTimeout(scheduleNextFrame, updateTimeoutMs);
    });

    resetListen(() => {
        const data = gpuData();

        if (data === undefined || typeof data === 'string') return;

        data.step = 0;

        for (let i = 0; i < data.cellStateArray.length; i++) {
            data.cellStateArray[i] = Math.random() > 0.6 ? 1 : 0;
        }

        data.device.queue.writeBuffer(data.cellStateStorage[0], 0, data.cellStateArray);
    });

    const updateGrid = () => {
        const data = gpuData();

        if (data === undefined || typeof data === 'string') return;

        data.viewOffsetArray[0] = modulo(mouseOffsetX + mouseDragX, gameWidth);
        data.viewOffsetArray[1] = -modulo(mouseOffsetY + mouseDragY, gameHeight);
        data.device.queue.writeBuffer(data.viewOffsetStorage, 0, data.viewOffsetArray);

        data.viewScaleArray[0] = (scale * gameWidth) / canvasSize().width;
        data.viewScaleArray[1] = (scale * gameHeight) / canvasSize().height;
        data.device.queue.writeBuffer(data.viewScaleStorage, 0, data.viewScaleArray);

        const encoder = data.device.createCommandEncoder();

        const computePass = encoder.beginComputePass();
        computePass.setPipeline(data.simulationPipeline);
        computePass.setBindGroup(0, data.bindGroups[data.step % 2]);
        const workgroupCountX = Math.ceil(gameWidth / data.workgroupSize);
        const workgroupCountY = Math.ceil(gameHeight / data.workgroupSize);
        computePass.dispatchWorkgroups(workgroupCountX, workgroupCountY);
        computePass.end();

        data.step++;

        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: data.context.getCurrentTexture().createView(),
                    loadOp: 'clear',
                    //clearValue: { r: 0.05, g: 0.05, b: 0.1, a: 1 },
                    //clearValue: [0.05, 0.05, 0.1, 1],
                    clearValue: [0, 0, 0, 1],
                    storeOp: 'store',
                },
            ],
        });

        pass.setPipeline(data.cellPipeline);
        pass.setVertexBuffer(0, data.vertexBuffer);
        pass.setBindGroup(0, data.bindGroups[data.step % 2]);
        // 2D points, so 2 points per vertex
        // draw a grid full of instances
        pass.draw(data.vertices.length / 2, gameWidth * gameHeight);

        pass.end();
        data.device.queue.submit([encoder.finish()]);
    };

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
        mouseClientX = event.clientX;
        mouseClientY = event.clientY;
    };

    const onMouseUp = (event: MouseEvent) => {
        mouseOffsetX = modulo(mouseOffsetX + mouseDragX, gameWidth);
        mouseOffsetY = modulo(mouseOffsetY + mouseDragY, gameHeight);
        mouseDragX = 0;
        mouseDragY = 0;
        mouseDragging = false;
    };

    const onWheel = (event: WheelEvent) => {
        const invert = untrack(zoomIsInverted) ? -1 : 1;
        const direction = Math.sign(event.deltaY);
        const newScale = Math.min(Math.max(scale + invert * direction, 1), 15);
        if (newScale === scale) return;

        const { width, height } = untrack(canvasSize);
        const dragX = ((1 - newScale / scale) * (mouseClientX - 0.5 * width)) / newScale;
        const dragY = ((1 - newScale / scale) * (mouseClientY - 0.5 * height)) / newScale;
        mouseOffsetX = modulo(mouseOffsetX + dragX, gameWidth);
        mouseOffsetY = modulo(mouseOffsetY + dragY, gameHeight);
        scale = newScale;
        event.preventDefault();
    };

    return (
        <Switch>
            <Match when={typeof gpuData() === 'string'}>
                <div class="m-4">
                    <div>Unable to initialize canvas and WebGPU.</div>
                    <div>{`Error: ${gpuData() ?? 'unknown'}`}</div>
                    <div>
                        You may need to update to the latest version of Chrome or Edge. Other
                        browsers are not yet supported.
                    </div>
                </div>
            </Match>
            <Match when={true}>
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
            </Match>
        </Switch>
    );
};
