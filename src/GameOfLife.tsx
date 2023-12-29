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
import { useGameOfLifeControls } from './GameOfLifeControlsProvider';
import { getGradientValues } from './Gradients';
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
    cellGradientStorage: GPUBuffer;
    cellPipeline: GPURenderPipeline;
    cellStateArray: Int32Array;
    cellStateStorage: Array<GPUBuffer>;
    context: GPUCanvasContext;
    device: GPUDevice;
    gridSizeArray: Float32Array;
    gridSizeBuffer: GPUBuffer;
    step: number;
    simulationParamsArray: Float32Array;
    simulationParamsStorage: GPUBuffer;
    simulationPipeline: GPUComputePipeline;
    vertexBuffer: GPUBuffer;
    vertices: Float32Array;
    viewOffsetArray: Float32Array;
    viewOffsetStorage: GPUBuffer;
    viewScaleArray: Float32Array;
    viewScaleStorage: GPUBuffer;
    workgroupSize: number;
};

// Javascript's modulo implementation uses truncated division, which usually is not what we want for
// negative numbers. This implementation is for floored division, which is what we want.
//
// https://en.wikipedia.org/wiki/Modulo

function modulo(x: number, n: number): number {
    return x - n * Math.floor(x / n);
}

const maxAge = 100;

export const GameOfLife: Component<GameOfLifeProps> = props => {
    const gameHeight = window.screen.height;
    const gameWidth = window.screen.width;
    const [, rest] = splitProps(props, ['foo']);
    const {
        computeFrameRate,
        paused,
        resetListen,
        setActualComputeFrameRate,
        setActualRenderFrameRate,
        showAxes,
        showBackgroundAge,
        gradientName,
        zoomIsInverted,
    } = useGameOfLifeControls();
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
    let scale = 1;
    const [canvasSize, setCanvasSize] = createSignal<Dimensions>({ height: 100, width: 100 });
    const canvasSizeThrottle = leadingAndTrailing(
        throttle,
        (dim: Dimensions) => setCanvasSize(dim),
        500
    );
    let animationFrameRequest: ReturnType<typeof requestAnimationFrame> | undefined;
    const computeFrameTimesMs = new Array<number>(60).fill(1000);
    const renderFrameTimesMs = new Array<number>(60).fill(1000);
    let prevRenderFrameTime = Date.now();
    let prevComputeFrameTime = Date.now();
    let updateTimeout: ReturnType<typeof setTimeout> | undefined;
    const minRenderFrameRate = 30;
    let frameScheduleDelayMs = 1000 / 20;
    let frame = 0;

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

    setInterval(() => {
        const fr = untrack(computeFrameRate);
        const startIndex = Math.max(computeFrameTimesMs.length - fr, 0);
        let timeMs = 0;

        if (!untrack(paused)) {
            for (let i = startIndex; i < computeFrameTimesMs.length; i++) {
                timeMs += computeFrameTimesMs[i];
            }

            setActualComputeFrameRate((1000 * (computeFrameTimesMs.length - startIndex)) / timeMs);
        }

        timeMs = 0;

        for (const frameTimeMs of renderFrameTimesMs) {
            timeMs += frameTimeMs;
        }

        setActualRenderFrameRate((1000 * renderFrameTimesMs.length) / timeMs);
    }, 1000);

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

        const simulationParamsArray = new Float32Array([0.0, 0.0]);
        const simulationParamsStorage = device.createBuffer({
            label: 'simulationParams storage',
            size: simulationParamsArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(simulationParamsStorage, 0, simulationParamsArray);

        const cellGradientStorage = device.createBuffer({
            label: 'cellGradient storage',
            size: 3 * (maxAge + 1) * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(
            cellGradientStorage,
            0,
            getGradientValues(untrack(gradientName), maxAge)
        );

        const cellStateArray = new Int32Array(gameWidth * gameHeight);
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
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'read-only-storage' },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'read-only-storage' },
                },
                {
                    binding: 3,
                    visibility:
                        GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'read-only-storage' },
                },
                {
                    binding: 4,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'read-only-storage' },
                },
                {
                    binding: 5,
                    visibility:
                        GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'read-only-storage' }, // cell state input buffer
                },
                {
                    binding: 6,
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
                        resource: { buffer: simulationParamsStorage },
                    },
                    {
                        binding: 4,
                        resource: { buffer: cellGradientStorage },
                    },
                    {
                        binding: 5,
                        resource: { buffer: cellStateStorage[0] },
                    },
                    {
                        binding: 6,
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
                        resource: { buffer: simulationParamsStorage },
                    },
                    {
                        binding: 4,
                        resource: { buffer: cellGradientStorage },
                    },
                    {
                        binding: 5,
                        resource: { buffer: cellStateStorage[1] },
                    },
                    {
                        binding: 6,
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
            cellGradientStorage,
            cellPipeline,
            cellStateArray,
            cellStateStorage,
            context,
            device,
            gridSizeArray,
            gridSizeBuffer,
            step: 0,
            simulationParamsArray,
            simulationParamsStorage,
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

    const framesPerCompute = () => {
        if (computeFrameRate() > minRenderFrameRate) {
            return 1;
        }

        return Math.ceil(minRenderFrameRate / computeFrameRate());
    };

    const scheduleNextFrame = () => {
        updateTimeout = undefined;

        animationFrameRequest = requestAnimationFrame(() => {
            const currFrameTime = Date.now();
            animationFrameRequest = undefined;
            const doCompute = frame === 0 && !untrack(paused);
            const untrackedFramesPerCompute = untrack(framesPerCompute);

            updateGrid(doCompute);

            if (doCompute) {
                const measuredComputeFrameDurationMs = currFrameTime - prevComputeFrameTime;
                const targetComputeFrameDurationMs = 1000 / untrack(computeFrameRate);
                const frameDiffMs = targetComputeFrameDurationMs - measuredComputeFrameDurationMs;

                computeFrameTimesMs.shift();
                computeFrameTimesMs.push(measuredComputeFrameDurationMs);
                prevComputeFrameTime = currFrameTime;

                frameScheduleDelayMs += frameDiffMs / untrackedFramesPerCompute;
                frameScheduleDelayMs = Math.max(frameScheduleDelayMs, 0);
            }

            frame = ++frame % untrackedFramesPerCompute;
            renderFrameTimesMs.shift();
            renderFrameTimesMs.push(currFrameTime - prevRenderFrameTime);
            prevRenderFrameTime = currFrameTime;

            updateTimeout = setTimeout(scheduleNextFrame, frameScheduleDelayMs);
        });
    };

    createEffect(() => {
        const data = gpuData();

        if (data === undefined || typeof data === 'string') return;

        if (animationFrameRequest !== undefined) cancelAnimationFrame(animationFrameRequest);
        if (updateTimeout !== undefined) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(scheduleNextFrame, 1);
    });

    createEffect(() => {
        const isPaused = paused();

        if (isPaused) {
            setActualComputeFrameRate(0);
            frame = 0;
        } else {
            prevComputeFrameTime = Date.now();
        }
    });

    createEffect(() => {
        const data = gpuData();
        const showAxesValue = showAxes() ? 1.0 : 0.0;

        if (data === undefined || typeof data === 'string') return;

        data.simulationParamsArray[0] = showAxesValue;
        data.device.queue.writeBuffer(data.simulationParamsStorage, 0, data.simulationParamsArray);
    });

    createEffect(() => {
        const data = gpuData();
        const showBackgroundAgeValue = showBackgroundAge() ? 1.0 : 0.0;

        if (data === undefined || typeof data === 'string') return;

        data.simulationParamsArray[1] = showBackgroundAgeValue;
        data.device.queue.writeBuffer(data.simulationParamsStorage, 0, data.simulationParamsArray);
    });

    createEffect(() => {
        const data = gpuData();
        const gradientNameValue = gradientName();

        if (data === undefined || typeof data === 'string') return;

        data.device.queue.writeBuffer(
            data.cellGradientStorage,
            0,
            getGradientValues(gradientNameValue, maxAge)
        );
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

    const updateGrid = (doCompute: boolean) => {
        const data = gpuData();

        if (data === undefined || typeof data === 'string') return;

        const encoder = data.device.createCommandEncoder();

        data.viewOffsetArray[0] = modulo(mouseOffsetX + mouseDragX, gameWidth);
        data.viewOffsetArray[1] = -modulo(mouseOffsetY + mouseDragY, gameHeight);
        data.device.queue.writeBuffer(data.viewOffsetStorage, 0, data.viewOffsetArray);

        data.viewScaleArray[0] = (scale * gameWidth) / canvasSize().width;
        data.viewScaleArray[1] = (scale * gameHeight) / canvasSize().height;
        data.device.queue.writeBuffer(data.viewScaleStorage, 0, data.viewScaleArray);

        if (doCompute) {
            const computePass = encoder.beginComputePass();
            computePass.setPipeline(data.simulationPipeline);
            computePass.setBindGroup(0, data.bindGroups[data.step % 2]);
            const workgroupCountX = Math.ceil(gameWidth / data.workgroupSize);
            const workgroupCountY = Math.ceil(gameHeight / data.workgroupSize);
            computePass.dispatchWorkgroups(workgroupCountX, workgroupCountY);
            computePass.end();

            data.step++;
        }

        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: data.context.getCurrentTexture().createView(),
                    loadOp: 'clear',
                    clearValue: [0, 0, 0, 1],
                    storeOp: 'store',
                },
            ],
        });

        pass.setPipeline(data.cellPipeline);
        pass.setVertexBuffer(0, data.vertexBuffer);
        pass.setBindGroup(0, data.bindGroups[data.step % 2]);
        // 2D points, so 2 points per vertex; draw a grid full of instances
        pass.draw(data.vertices.length >> 1, gameWidth * gameHeight);

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
        const invert = untrack(zoomIsInverted) ? 1 : -1;
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
                        You may need to update to the latest version of your browser. The latest
                        versions of Chrome, Edge, and Opera are supported. The latest versions of
                        Firefox and Safari need WebGPU support enabled in their settings. Other
                        browsers and platforms are not yet supported. See{' '}
                        <a
                            href="https://caniuse.com/?search=webgpu"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            caniuse
                        </a>{' '}
                        for more information.
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
