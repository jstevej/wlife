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
import { gridScaleLimit, useGameOfLifeControls } from './GameOfLifeControlsProvider';
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
        detectedFrameRate,
        framesPerCompute,
        paused,
        resetListen,
        scale,
        setActualComputeFrameRate,
        setActualRenderFrameRate,
        setAge,
        setScale,
        showAxes,
        showBackgroundAge,
        showGrid,
        gradientName,
        zoomIsInverted,
    } = useGameOfLifeControls();
    const [canvasRef, setCanvasRef] = createSignal<HTMLDivElement>();
    let mouseDragging = false;
    let mouseClientX = 0;
    let mouseClientY = 0;
    let mouseStartX = 0;
    let mouseStartY = 0;
    let mouseDragX = 0;
    let mouseDragY = 0;
    let mouseOffsetX = gameWidth >> 1;
    let mouseOffsetY = gameHeight >> 1;
    const [canvasSize, setCanvasSize] = createSignal<Dimensions>({ height: 100, width: 100 });
    const canvasSizeThrottle = leadingAndTrailing(
        throttle,
        (dim: Dimensions) => setCanvasSize(dim),
        500
    );
    let animationFrameRequest: ReturnType<typeof requestAnimationFrame> | undefined;
    const computeFrameTimesMs = new Array<number>(240).fill(1000);
    const renderFrameTimesMs = new Array<number>(240).fill(1000);
    let prevRenderFrameTime = Date.now();
    let prevComputeFrameTime = Date.now();
    const frameRateUpdateMs = 1000;
    let frame = 0;

    // Resize canvas (throttled).

    let resizeObserver: ResizeObserver | undefined;

    createEffect(() => {
        const ref = canvasRef();
        if (ref === undefined) return;
        if (resizeObserver !== undefined) {
            console.error(`canvasRef effect: resize observer not undefined`);
            resizeObserver.unobserve(ref);
        }

        resizeObserver = new ResizeObserver(entries => {
            const rect = entries[0].contentRect;
            canvasSizeThrottle({
                height: Math.floor(rect.height),
                width: Math.floor(rect.width),
            });
        });
        resizeObserver.observe(ref);
    });

    // Update calculated frame rate.

    setInterval(() => {
        const fr = untrack(detectedFrameRate);
        const framesPerInterval = fr * frameRateUpdateMs * 0.001;

        if (untrack(paused)) {
            setActualComputeFrameRate(0);
        } else {
            const computeFramesPerInterval = Math.round(
                framesPerInterval / untrack(framesPerCompute)
            );
            const startIndex = Math.max(computeFrameTimesMs.length - computeFramesPerInterval, 0);
            let timeMs = 0;

            for (let i = startIndex; i < computeFrameTimesMs.length; i++) {
                timeMs += computeFrameTimesMs[i];
            }

            setActualComputeFrameRate((1000 * computeFramesPerInterval) / timeMs);
        }

        const startIndex = Math.max(renderFrameTimesMs.length - framesPerInterval, 0);
        let timeMs = 0;

        for (let i = startIndex; i < renderFrameTimesMs.length; i++) {
            timeMs += renderFrameTimesMs[i];
        }

        setActualRenderFrameRate((1000 * framesPerInterval) / timeMs);
    }, frameRateUpdateMs);

    // Update age.

    setInterval(() => {
        const untrackedGpuData = untrack(gpuData);

        if (untrackedGpuData !== undefined && typeof untrackedGpuData !== 'string') {
            setAge(untrackedGpuData.step);
        }
    }, 100);

    const insertSorted = <T,>(array: Array<T>, value: T) => {
        let low = 0;
        let high = array.length;

        while (low < high) {
            const mid = (low + high) >>> 1;
            if (array[mid] < value) low = mid + 1;
            else high = mid;
        }

        array.splice(low, 0, value);
    };

    // Initialilze GPU pipeline.

    const [gpuData] = createResource<GpuData | string>(async (): Promise<GpuData | string> => {
        // Detect frame rate. We do this by requesting a number of animation frames, measuring the
        // time between them, and choosing the smallest of the measured times. Choosing the smallest
        // of many measured times helps to filter out missed frames due to system load. Also, the
        // timestamp returned by requestAnimationFrame provides much more accurate and consistent
        // results than explicitly grabbing timestamps with performance.now().

        console.log(`detecting frame rate...`);

        const frameTimesMs: Array<number> = [];
        const detectionStart = performance.now();
        let prevFrameTimestamp = 0;

        while (performance.now() - detectionStart < 100) {
            await new Promise<void>(resolve => {
                requestAnimationFrame(frameTimestamp => {
                    if (prevFrameTimestamp !== 0) {
                        insertSorted(frameTimesMs, frameTimestamp - prevFrameTimestamp);
                    }
                    prevFrameTimestamp = frameTimestamp;
                    resolve();
                });
            });
        }

        const measuredFrameRate = 1000 / frameTimesMs[frameTimesMs.length >> 1];
        const detectedFrameRate = Math.round(measuredFrameRate);

        console.log(`measured frame rate = ${measuredFrameRate.toFixed(3)} fps`);
        console.log(`detected frame rate = ${detectedFrameRate} fps`);

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

    // Frame scheduler. Runs on a timeout. Schedules next animation frame.

    const doAnimationFrame = (timestamp: number) => {
        animationFrameRequest = undefined;
        const untrackedPause = untrack(paused);
        const doCompute = frame === 0 && !untrackedPause;
        const untrackedFramesPerCompute = untrack(framesPerCompute);

        updateGrid(doCompute);

        if (doCompute) {
            const measuredComputeFrameDurationMs = timestamp - prevComputeFrameTime;
            computeFrameTimesMs.shift();
            computeFrameTimesMs.push(measuredComputeFrameDurationMs);
            prevComputeFrameTime = timestamp;
        }

        frame = ++frame % untrackedFramesPerCompute;
        renderFrameTimesMs.shift();
        renderFrameTimesMs.push(timestamp - prevRenderFrameTime);
        prevRenderFrameTime = timestamp;

        animationFrameRequest = requestAnimationFrame(doAnimationFrame);
    };

    // Start initial render.

    createEffect(() => {
        const data = gpuData();

        if (data === undefined || typeof data === 'string') return;

        if (animationFrameRequest === undefined) {
            animationFrameRequest = requestAnimationFrame(doAnimationFrame);
        } else {
            console.error(`initial render effect: animationFrameRequest not undefined`);
        }
    });

    // Set actualComputeFrameRate to 0 when paused.

    createEffect(() => {
        const isPaused = paused();

        if (isPaused) {
            setActualComputeFrameRate(0);
            frame = 0;
        } else {
            prevComputeFrameTime = Date.now();
        }
    });

    // Pass showAxes to GPU pipeline.

    createEffect(() => {
        const data = gpuData();
        const showAxesValue = showAxes() ? 1.0 : 0.0;

        if (data === undefined || typeof data === 'string') return;

        data.simulationParamsArray[0] = showAxesValue;
        data.device.queue.writeBuffer(data.simulationParamsStorage, 0, data.simulationParamsArray);
    });

    // Pass showBackgroundAge to GPU pipeline.

    createEffect(() => {
        const data = gpuData();
        const showBackgroundAgeValue = showBackgroundAge() ? 1.0 : 0.0;

        if (data === undefined || typeof data === 'string') return;

        data.simulationParamsArray[1] = showBackgroundAgeValue;
        data.device.queue.writeBuffer(data.simulationParamsStorage, 0, data.simulationParamsArray);
    });

    // Pass showGrid to GPU pipeline.

    createEffect(() => {
        const data = gpuData();
        const fact = showGrid() && scale() >= gridScaleLimit ? 1 - 2 / scale() : 1;

        if (data === undefined || typeof data === 'string') return;

        for (let i = 0; i < data.vertices.length; i++) {
            // Shrink left and bottom borders.

            if (Math.sign(data.vertices[i]) < 0) {
                data.vertices[i] = Math.sign(data.vertices[i]) * fact;
            }
        }

        data.device.queue.writeBuffer(data.vertexBuffer, 0, data.vertices);
    });

    // Pass gradient to GPU pipeline.

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

    // Reset to random state on reset signal.

    resetListen(() => {
        const data = gpuData();

        if (data === undefined || typeof data === 'string') return;

        data.step = 0;

        for (let i = 0; i < data.cellStateArray.length; i++) {
            data.cellStateArray[i] = Math.random() > 0.6 ? 1 : 0;
        }

        data.device.queue.writeBuffer(data.cellStateStorage[0], 0, data.cellStateArray);
    });

    // Run render and compute pipelines.

    const updateGrid = (doCompute: boolean) => {
        const data = gpuData();

        if (data === undefined || typeof data === 'string') return;

        const untrackedScale = untrack(scale);
        const encoder = data.device.createCommandEncoder();

        data.viewOffsetArray[0] = modulo(mouseOffsetX + mouseDragX, gameWidth);
        data.viewOffsetArray[1] = -modulo(mouseOffsetY + mouseDragY, gameHeight);
        data.device.queue.writeBuffer(data.viewOffsetStorage, 0, data.viewOffsetArray);

        data.viewScaleArray[0] = (untrackedScale * gameWidth) / canvasSize().width;
        data.viewScaleArray[1] = (untrackedScale * gameHeight) / canvasSize().height;
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
                    clearValue: [0.2, 0.2, 0.2, 1],
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
        const untrackedScale = untrack(scale);

        if (mouseDragging) {
            mouseDragX = (event.clientX - mouseStartX) / untrackedScale;
            mouseDragY = (event.clientY - mouseStartY) / untrackedScale;
        }

        mouseClientX = event.clientX;
        mouseClientY = event.clientY;
    };

    const onMouseUp = (event: MouseEvent) => {
        if (mouseDragging) {
            mouseOffsetX = modulo(mouseOffsetX + mouseDragX, gameWidth);
            mouseOffsetY = modulo(mouseOffsetY + mouseDragY, gameHeight);
            mouseDragX = 0;
            mouseDragY = 0;
            mouseDragging = false;
        }
    };

    const onWheel = (event: WheelEvent) => {
        const untrackedScale = untrack(scale);
        const invert = untrack(zoomIsInverted) ? 1 : -1;
        const direction = Math.sign(event.deltaY);
        const newScale = Math.min(Math.max(untrackedScale + invert * direction, 1), 15);
        if (newScale === untrackedScale) return;

        const { width, height } = untrack(canvasSize);
        const dragX = ((1 - newScale / untrackedScale) * (mouseClientX - 0.5 * width)) / newScale;
        const dragY = ((1 - newScale / untrackedScale) * (mouseClientY - 0.5 * height)) / newScale;
        mouseOffsetX = modulo(mouseOffsetX + dragX, gameWidth);
        mouseOffsetY = modulo(mouseOffsetY + dragY, gameHeight);
        setScale(newScale);
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
                <div {...rest} ref={setCanvasRef}>
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
