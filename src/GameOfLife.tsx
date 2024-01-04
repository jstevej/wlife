import { leadingAndTrailing, throttle } from '@solid-primitives/scheduled';
import {
    Component,
    createEffect,
    createMemo,
    createResource,
    createSignal,
    JSX,
    Match,
    splitProps,
    Switch,
    untrack,
} from 'solid-js';
import cellShaderCode from './CellShader.wgsl?raw';
import {
    gridScaleLimit,
    maxAge,
    useFullResolution,
    useGameOfLifeControls,
} from './GameOfLifeControlsProvider';
import { getGradientValues } from './Gradients';
import histReducerCode from './HistReducer.wgsl?raw';
import { simulationResults } from './SimulationResults';
import simulationShaderCode from './SimulationShader.wgsl?raw';
import { delayMs, waitFor } from './Sutl';
import { replaceConst, replaceWorkgroupSize, wgslReplace } from './WgslReplace';

export type GameOfLifeProps = {
    foo?: string;
} & JSX.HTMLAttributes<HTMLDivElement>;

type Dimensions = {
    height: number;
    width: number;
};

type Vec2 = {
    x: number;
    y: number;
};

type GpuData = {
    ageHistChunksArray: Uint32Array;
    ageHistChunksStorage: GPUBuffer;
    bindGroups: Array<GPUBindGroup>;
    cellGradientStorage: GPUBuffer;
    cellPipeline: GPURenderPipeline;
    cellStateArray: Int32Array;
    cellStateStorage: Array<GPUBuffer>;
    computeStep: number;
    context: GPUCanvasContext;
    device: GPUDevice;
    gridSizeArray: Float32Array;
    gridSizeBuffer: GPUBuffer;
    histContext: GPUCanvasContext;
    histParamsArray: Float32Array;
    histParamsStorage: GPUBuffer;
    histReducerBindGroups: Array<GPUBindGroup>;
    histReducerPipeline: GPUComputePipeline;
    histRenderPipeline: GPURenderPipeline;
    offsetCellsArray: Float32Array;
    offsetCellsStorage: GPUBuffer;
    pixelsPerCellArray: Float32Array;
    pixelsPerCellStorage: GPUBuffer;
    renderStep: number;
    simulationParamsArray: Float32Array;
    simulationParamsStorage: GPUBuffer;
    simulationPipeline: GPUComputePipeline;
    simulationResultsArray: Int32Array;
    simulationResultsReadBuffers: Array<GPUBuffer>;
    simulationResultsStorage: GPUBuffer;
    simulationWorkgroupSize: Vec2;
    vertexBuffer: GPUBuffer;
    vertices: Float32Array;
};

// Javascript's modulo implementation uses truncated division, which usually is not what we want for
// negative numbers. This implementation is for floored division, which is what we want.
//
// https://en.wikipedia.org/wiki/Modulo

function modulo(x: number, n: number): number {
    return x - n * Math.floor(x / n);
}

export const GameOfLife: Component<GameOfLifeProps> = props => {
    console.log(`starting`);

    const [, rest] = splitProps(props, ['foo']);
    const {
        detectedFrameRate,
        framesPerCompute,
        gridSize,
        initialDensity,
        paused,
        resetListen,
        pixelsPerCell,
        setActualComputeFrameRate,
        setActualRenderFrameRate,
        setAge,
        setCanvasSize,
        setDetectedFrameRate,
        setGridSize,
        setPixelsPerCell,
        showAxes,
        showBackgroundAge,
        showGrid,
        gradientName,
        zoomIsInverted,
    } = useGameOfLifeControls();
    const [canvasContainerRef, setCanvasContainerRef] = createSignal<HTMLDivElement>();
    let mouseDragging = false;
    let mouseClientX = 0;
    let mouseClientY = 0;
    let mouseStartX = 0;
    let mouseStartY = 0;
    let mouseDragX = 0;
    let mouseDragY = 0;
    // Offsets are stored as fractional number of grid cells.
    let offsetCellsX = 0;
    let offsetCellsY = 0;
    let offsetCellsInitialized = false;
    const canvasSizeThrottle = leadingAndTrailing(
        throttle,
        (dim: Dimensions) => {
            console.log(
                `canvas size = ${dim.width} x ${dim.height}, dpr = ${window.devicePixelRatio}`
            );
            setCanvasSize(dim);
            const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;

            if (useFullResolution) {
                canvas.style.width = `${dim.width / window.devicePixelRatio}px`;
                canvas.style.height = `${dim.height / window.devicePixelRatio}px`;
            } else {
                canvas.style.width = `${dim.width}px`;
                canvas.style.height = `${dim.height}px`;
            }

            canvas.width = dim.width;
            canvas.height = dim.height;

            if (!offsetCellsInitialized) {
                offsetCellsX = dim.width >> 1;
                offsetCellsY = dim.height >> 1;
                offsetCellsInitialized = true;
            }
        },
        500
    );
    let animationFrameRequest: ReturnType<typeof requestAnimationFrame> | undefined;
    const computeFrameTimesMs = new Array<number>(240).fill(1000);
    const renderFrameTimesMs = new Array<number>(240).fill(1000);
    let prevRenderFrameTime = performance.now();
    let prevComputeFrameTime = performance.now();
    const frameRateUpdateMs = 1000;
    let frame = 0;

    if (useFullResolution) {
        setGridSize({
            height: window.screen.height * window.devicePixelRatio,
            width: window.screen.width * window.devicePixelRatio,
        });
    } else {
        setGridSize({
            height: window.screen.height,
            width: window.screen.width,
        });
    }

    console.log(
        `screen size = ${window.screen.width} x ${window.screen.height}, dpr = ${window.devicePixelRatio}`
    );

    // Calculate computes per frame. This can be greater than 1 because we support compute frame
    // rates faster than the display frame rate.

    const computesPerFrame = createMemo(() => {
        const framesPerComputeValue = framesPerCompute();
        return framesPerComputeValue >= 1 ? 1 : Math.round(1 / framesPerComputeValue);
    });

    // Resize canvas (throttled).

    let resizeObserver: ResizeObserver | undefined;

    createEffect(() => {
        const ref = canvasContainerRef();
        if (ref === undefined) return;
        if (resizeObserver !== undefined) {
            console.error(`canvasContainerRef effect: resize observer not undefined`);
            resizeObserver.unobserve(ref);
        }

        resizeObserver = new ResizeObserver(entries => {
            const rect = entries[0].contentRect;
            if (useFullResolution) {
                canvasSizeThrottle({
                    height: Math.floor(rect.height * window.devicePixelRatio),
                    width: Math.floor(rect.width * window.devicePixelRatio),
                });
            } else {
                canvasSizeThrottle({
                    height: Math.floor(rect.height),
                    width: Math.floor(rect.width),
                });
            }
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
                framesPerInterval / Math.max(untrack(framesPerCompute), 1)
            );
            const startIndex = Math.max(computeFrameTimesMs.length - computeFramesPerInterval, 0);
            const numValues = computeFrameTimesMs.length - startIndex;
            let timeMs = 0;

            for (let i = startIndex; i < computeFrameTimesMs.length; i++) {
                timeMs += computeFrameTimesMs[i];
            }

            setActualComputeFrameRate((untrack(computesPerFrame) * (1000 * numValues)) / timeMs);
        }

        const startIndex = Math.max(renderFrameTimesMs.length - framesPerInterval, 0);
        const numValues = renderFrameTimesMs.length - startIndex;
        let timeMs = 0;

        for (let i = startIndex; i < renderFrameTimesMs.length; i++) {
            timeMs += renderFrameTimesMs[i];
        }

        setActualRenderFrameRate((1000 * numValues) / timeMs);
    }, frameRateUpdateMs);

    // Update age.

    setInterval(() => {
        const untrackedGpuData = untrack(gpuData);

        if (untrackedGpuData !== undefined && typeof untrackedGpuData !== 'string') {
            setAge(untrackedGpuData.computeStep);
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
        // time between them, and choosing the median of the measured times. The timestamp returned
        // by requestAnimationFrame provides much more accurate and consistent results than
        // explicitly grabbing timestamps with performance.now().

        console.log(`detecting frame rate...`);

        const frameTimesMs: Array<number> = [];
        let prevFrameTimestamp = 0;

        for (let i = 0; i < 10; i++) {
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

        const medianFrameRate = 1000 / frameTimesMs[frameTimesMs.length >> 1];
        const detectedFrameRate = Math.round(medianFrameRate);

        console.log(`median measured frame rate = ${medianFrameRate.toFixed(3)} fps`);
        console.log(`detected frame rate = ${detectedFrameRate} fps`);

        setDetectedFrameRate(detectedFrameRate);

        // Setup canvas.

        if (!navigator.gpu) return `WebGPU not supported on this browser`;

        const adapter = await navigator.gpu.requestAdapter();

        if (!adapter) return `WebGPU adapter not found`;

        const device = await adapter.requestDevice();
        const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;

        if (!canvas) return `game canvas element not found`;

        const context = canvas.getContext('webgpu');

        if (!context) return `game context not found`;

        const histCanvas = await waitFor(
            () => document.getElementById('ageHistogram') as HTMLCanvasElement | undefined,
            100,
            5000
        );

        if (!histCanvas) return `histogram canvas element not found`;

        const histContext = histCanvas.getContext('webgpu');

        if (!histContext) return `histogram context not found`;

        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format });
        histContext.configure({ device, format });

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

        // group 0, location 0: cellState input
        // group 0, location 1: cellState output

        const untrackedGridSize = untrack(gridSize);
        const cellStateArray = new Int32Array(untrackedGridSize.width * untrackedGridSize.height);
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
            cellStateArray[i] = Math.random() < untrack(initialDensity) ? 1 : -maxAge + 1;
        }
        device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);

        // group 0, location 2: gridSize

        const gridSizeArray = new Float32Array([untrackedGridSize.width, untrackedGridSize.height]);
        const gridSizeBuffer = device.createBuffer({
            label: 'gridSize uniform',
            size: gridSizeArray.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(gridSizeBuffer, 0, gridSizeArray);

        // group 0, location 3: pixelsPerCell

        const pixelsPerCellArray = new Float32Array([4, 4]);
        const pixelsPerCellStorage = device.createBuffer({
            label: 'pixelsPerCell storage',
            size: pixelsPerCellArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(pixelsPerCellStorage, 0, pixelsPerCellArray);

        // group 0, location 4: offsetCells

        const offsetCellsArray = new Float32Array([0, 0]);
        const offsetCellsStorage = device.createBuffer({
            label: 'offsetCells storage',
            size: offsetCellsArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(offsetCellsStorage, 0, offsetCellsArray);

        // group 0, location 5: simulationParams

        const simulationParamsArray = new Float32Array([0.0, 0.0, 0.0]);
        const simulationParamsStorage = device.createBuffer({
            label: 'simulationParams storage',
            size: simulationParamsArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(simulationParamsStorage, 0, simulationParamsArray);

        // group 0, location 6: cellGradient

        const cellGradientStorage = device.createBuffer({
            label: 'cellGradient storage',
            size: 3 * maxAge * 4, // 3 f32 rgb values
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(cellGradientStorage, 0, getGradientValues(untrack(gradientName)));

        // group 0, location 7: simulationResults

        const simulationResultsArray = new Int32Array([0, 0]);
        const simulationResultsStorage = device.createBuffer({
            label: 'simulationResults storage',
            size: simulationResultsArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });

        // group 0, location 8: ageHistChunks

        const simulationWorkgroupSize = { x: 16, y: 16 };
        const workgroupCountX = Math.ceil(untrackedGridSize.width / simulationWorkgroupSize.x);
        const workgroupCountY = Math.ceil(untrackedGridSize.height / simulationWorkgroupSize.y);
        const numSimulationWorkgroups = workgroupCountX * workgroupCountY;

        // Note that ageHistChunksArray only contains zero data for one histogram. We don't need to
        // zero out the other chunks because the reducer does it.

        const ageHistChunksArray = new Uint32Array(2 * maxAge);
        ageHistChunksArray.fill(0);
        const ageHistChunksStorage = device.createBuffer({
            label: 'ageHistChunks storage',
            size: numSimulationWorkgroups * 2 * maxAge * 4, // 4 bytes per u32
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });

        // group 0, location 9: histogramParams

        const histParamsArray = new Float32Array(2);
        const histParamsStorage = device.createBuffer({
            label: 'histogramParams storage',
            size: histParamsArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        const simulationResultsReadBuffers: Array<GPUBuffer> = [];

        // The more buffers we allocate for simulation results, the less likely we are to have to
        // wait for one to be ready. Typically, this is only noticable at extremely high values of
        // computesPerFrame.

        for (let i = 0; i < 512; i++) {
            simulationResultsReadBuffers.push(
                device.createBuffer({
                    label: `simulationResultsRead buffer ${i}`,
                    size: simulationResultsArray.byteLength,
                    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
                })
            );
        }

        // Shader stuff.

        const cellShaderModule = device.createShaderModule({
            label: 'cell shader',
            code: wgslReplace(cellShaderCode, [replaceConst('maxAge', `${maxAge}u`)]),
        });

        const simulationShaderModule = device.createShaderModule({
            label: 'game of life simulation shader',
            code: wgslReplace(simulationShaderCode, [
                replaceConst('maxAge', `${maxAge}u`),
                replaceWorkgroupSize(
                    'computeMain',
                    simulationWorkgroupSize.x,
                    simulationWorkgroupSize.y
                ),
            ]),
        });

        const histReducerModule = device.createShaderModule({
            label: 'histogram reducer module',
            code: wgslReplace(histReducerCode, [replaceConst('maxAge', `${maxAge}u`)]),
        });

        // Pipeline.

        const bindGroupLayout = device.createBindGroupLayout({
            label: 'cell bind group layout',
            entries: [
                {
                    binding: 0,
                    visibility:
                        GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'read-only-storage' }, // cell state input buffer
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'storage' }, // cell state output buffer
                },
                {
                    binding: 2,
                    visibility:
                        GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
                    buffer: {}, // gridSize uniform buffer (default is 'uniform' so can leave empty)
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
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
                    buffer: { type: 'read-only-storage' },
                },
                {
                    binding: 6,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'read-only-storage' },
                },
                {
                    binding: 7,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'storage' }, // TODO: write-only-storage?
                },
                {
                    binding: 8,
                    visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'storage' }, // TODO: write-only-storage?
                },
                {
                    binding: 9,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'read-only-storage' },
                },
            ],
        });

        const bindGroups: Array<GPUBindGroup> = [0, 1].map(ping =>
            device.createBindGroup({
                label: `cell renderer bind group ${ping}`,
                layout: bindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: cellStateStorage[ping] },
                    },
                    {
                        binding: 1,
                        resource: { buffer: cellStateStorage[ping ? 0 : 1] },
                    },
                    {
                        binding: 2,
                        resource: { buffer: gridSizeBuffer },
                    },
                    {
                        binding: 3,
                        resource: { buffer: pixelsPerCellStorage },
                    },
                    {
                        binding: 4,
                        resource: { buffer: offsetCellsStorage },
                    },
                    {
                        binding: 5,
                        resource: { buffer: simulationParamsStorage },
                    },
                    {
                        binding: 6,
                        resource: { buffer: cellGradientStorage },
                    },
                    {
                        binding: 7,
                        resource: { buffer: simulationResultsStorage },
                    },
                    {
                        binding: 8,
                        resource: { buffer: ageHistChunksStorage },
                    },
                    {
                        binding: 9,
                        resource: { buffer: histParamsStorage },
                    },
                ],
            })
        );

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

        const histReducerPipeline = device.createComputePipeline({
            label: 'histogram reducer pipeline',
            layout: 'auto',
            compute: {
                module: histReducerModule,
                entryPoint: 'reduceHistChunks',
            },
        });

        const histRenderPipeline = device.createRenderPipeline({
            label: 'histogram render pipeline',
            layout: pipelineLayout,
            vertex: {
                module: cellShaderModule,
                entryPoint: 'histVertexMain',
                buffers: [vertexBufferLayout],
            },
            fragment: {
                module: cellShaderModule,
                entryPoint: 'histFragmentMain',
                targets: [{ format }],
            },
        });

        const histReducerBindGroups: Array<GPUBindGroup> = [];
        const numSteps = Math.ceil(Math.log2(numSimulationWorkgroups));
        console.log(`numSimulationWorkgroups = ${numSimulationWorkgroups}`);
        console.log(`numSteps = ${numSteps}`);

        for (let i = 0; i < numSteps; i++) {
            const stride = 2 ** i;
            const strideBuffer = device.createBuffer({
                size: 4,
                usage: GPUBufferUsage.UNIFORM,
                mappedAtCreation: true,
            });
            new Uint32Array(strideBuffer.getMappedRange()).set([stride]);
            strideBuffer.unmap();

            const histReducerBindGroup = device.createBindGroup({
                layout: histReducerPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: ageHistChunksStorage } },
                    { binding: 1, resource: { buffer: strideBuffer } },
                ],
            });

            histReducerBindGroups.push(histReducerBindGroup);
        }

        return {
            ageHistChunksArray,
            ageHistChunksStorage,
            bindGroups,
            cellGradientStorage,
            cellPipeline,
            cellStateArray,
            cellStateStorage,
            computeStep: 0,
            context,
            device,
            gridSizeArray,
            gridSizeBuffer,
            histContext,
            histParamsArray,
            histParamsStorage,
            histReducerBindGroups,
            histReducerPipeline,
            histRenderPipeline,
            offsetCellsArray,
            offsetCellsStorage,
            pixelsPerCellArray,
            pixelsPerCellStorage,
            renderStep: 0,
            simulationParamsArray,
            simulationParamsStorage,
            simulationPipeline,
            simulationResultsArray,
            simulationResultsReadBuffers,
            simulationResultsStorage,
            simulationWorkgroupSize,
            vertexBuffer,
            vertices,
        };
    });

    // Frame scheduler. Runs on a timeout. Schedules next animation frame.

    const doAnimationFrame = async (timestamp: number) => {
        animationFrameRequest = undefined;
        const untrackedPause = untrack(paused);
        const doCompute = frame === 0 && !untrackedPause;
        const untrackedFramesPerCompute = untrack(framesPerCompute);
        const renderedFramesPerCompute = Math.max(untrackedFramesPerCompute, 1);

        await updateGrid(doCompute);

        if (doCompute) {
            computeFrameTimesMs.shift();
            computeFrameTimesMs.push(timestamp - prevComputeFrameTime);
            prevComputeFrameTime = timestamp;
        }

        frame = ++frame % renderedFramesPerCompute;

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
            prevComputeFrameTime = performance.now();
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
        const showGridValue = showGrid() && pixelsPerCell() >= gridScaleLimit ? 1.0 : 0.0;

        if (data === undefined || typeof data === 'string') return;

        data.simulationParamsArray[2] = showGridValue;
        data.device.queue.writeBuffer(data.simulationParamsStorage, 0, data.simulationParamsArray);
    });

    // Pass gradient to GPU pipeline.

    createEffect(() => {
        const data = gpuData();
        const gradientNameValue = gradientName();

        if (data === undefined || typeof data === 'string') return;

        data.device.queue.writeBuffer(
            data.cellGradientStorage,
            0,
            getGradientValues(gradientNameValue)
        );
    });

    // Reset to random state on reset signal.

    resetListen(() => {
        const data = gpuData();

        if (data === undefined || typeof data === 'string') return;

        data.computeStep = 0;
        data.renderStep = 0;
    });

    // Run render and compute pipelines.

    const updateGrid = async (doCompute: boolean) => {
        const data = gpuData();

        if (data === undefined || typeof data === 'string') return;

        const untrackedGridSize = untrack(gridSize);
        const untrackedPixelsPerCell = untrack(pixelsPerCell);

        if (data.renderStep === 0) {
            for (let i = 0; i < data.cellStateArray.length; i++) {
                data.cellStateArray[i] = Math.random() < untrack(initialDensity) ? 1 : -maxAge;
            }

            data.device.queue.writeBuffer(data.cellStateStorage[0], 0, data.cellStateArray);

            simulationResults.reset();
            simulationResults.add(100 * untrack(initialDensity), 0);
        }

        data.offsetCellsArray[0] = modulo(
            offsetCellsX + mouseDragX / untrackedPixelsPerCell,
            untrackedGridSize.width
        );
        data.offsetCellsArray[1] = modulo(
            offsetCellsY + mouseDragY / untrackedPixelsPerCell,
            untrackedGridSize.height
        );
        data.device.queue.writeBuffer(data.offsetCellsStorage, 0, data.offsetCellsArray);

        data.pixelsPerCellArray[0] = untrackedPixelsPerCell;
        data.pixelsPerCellArray[1] = untrackedPixelsPerCell;
        data.device.queue.writeBuffer(data.pixelsPerCellStorage, 0, data.pixelsPerCellArray);

        if (doCompute) {
            const workgroupCountX = Math.ceil(
                untrackedGridSize.width / data.simulationWorkgroupSize.x
            );
            const workgroupCountY = Math.ceil(
                untrackedGridSize.height / data.simulationWorkgroupSize.y
            );
            let numComputes = untrack(computesPerFrame);

            // Initialize the histogram buffers to 0. Note that ageHistChunksArray only contains
            // zero data for one histogram. We don't need to zero out the other chunks because the
            // reducer does it.
            //
            // Also note that when doing multiple computes per render, we sum the histogram data
            // from all the computes into one histogram per render.

            data.device.queue.writeBuffer(data.ageHistChunksStorage, 0, data.ageHistChunksArray);

            while (numComputes-- > 0) {
                data.simulationResultsArray[0] = 0;
                data.simulationResultsArray[1] = 0;
                data.device.queue.writeBuffer(
                    data.simulationResultsStorage,
                    0,
                    data.simulationResultsArray
                );

                const computeEncoder = data.device.createCommandEncoder();
                const computePass = computeEncoder.beginComputePass();
                computePass.setPipeline(data.simulationPipeline);
                computePass.setBindGroup(0, data.bindGroups[data.computeStep % 2]);
                computePass.dispatchWorkgroups(workgroupCountX, workgroupCountY);
                computePass.end();
                data.computeStep++;

                const resultsWriteBuffer =
                    data.simulationResultsReadBuffers[
                        data.computeStep % data.simulationResultsReadBuffers.length
                    ];

                while (resultsWriteBuffer.mapState !== 'unmapped') {
                    console.warn('resultsWriteBuffer not ready');
                    await delayMs(1);
                }

                computeEncoder.copyBufferToBuffer(
                    data.simulationResultsStorage,
                    0,
                    resultsWriteBuffer,
                    0,
                    data.simulationResultsStorage.size
                );

                data.device.queue.submit([computeEncoder.finish()]);

                const bufferIndex = modulo(
                    data.computeStep - 1,
                    data.simulationResultsReadBuffers.length
                );

                setTimeout(async () => {
                    const resultsReadBuffer = data.simulationResultsReadBuffers[bufferIndex];

                    while (resultsReadBuffer.mapState !== 'unmapped') {
                        console.warn('resultsReadBuffer not ready');
                        await delayMs(1);
                    }

                    await resultsReadBuffer.mapAsync(GPUMapMode.READ);
                    const results = new Int32Array(resultsReadBuffer.getMappedRange());
                    const pctAlive =
                        (100 * results[0]) / (untrackedGridSize.width * untrackedGridSize.height);
                    const pctElders = (100 * results[1]) / results[0];
                    simulationResults.add(pctAlive, pctElders);
                    resultsReadBuffer.unmap();
                });
            }

            // Run histogram reducer.

            const histReducerEncoder = data.device.createCommandEncoder();
            const histReducerPass = histReducerEncoder.beginComputePass();
            histReducerPass.setPipeline(data.histReducerPipeline);
            let chunksLeft = workgroupCountX * workgroupCountY;
            data.histReducerBindGroups.forEach(bindGroup => {
                histReducerPass.setBindGroup(0, bindGroup);
                const dispatchCount = Math.floor(0.5 * chunksLeft);
                chunksLeft -= dispatchCount;
                histReducerPass.dispatchWorkgroups(dispatchCount);
            });
            histReducerPass.end();
            data.device.queue.submit([histReducerEncoder.finish()]);
        }

        const renderEncoder = data.device.createCommandEncoder();
        const pass = renderEncoder.beginRenderPass({
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
        pass.setBindGroup(0, data.bindGroups[data.computeStep % 2]);
        // 2D points, so 2 points per vertex; draw a grid full of instances
        pass.draw(data.vertices.length >> 1, 1);
        pass.end();
        data.renderStep++;
        data.device.queue.submit([renderEncoder.finish()]);

        // height, width
        const histCanvas = document.getElementById('ageHistogram') as HTMLCanvasElement;
        data.histParamsArray[0] = histCanvas.height;
        data.histParamsArray[1] = histCanvas.width;
        data.device.queue.writeBuffer(data.histParamsStorage, 0, data.histParamsArray);

        const histRenderEncoder = data.device.createCommandEncoder();
        const histRenderPass = histRenderEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view: data.histContext.getCurrentTexture().createView(),
                    loadOp: 'clear',
                    clearValue: [0, 0, 0, 1],
                    storeOp: 'store',
                },
            ],
        });

        histRenderPass.setPipeline(data.histRenderPipeline);
        histRenderPass.setVertexBuffer(0, data.vertexBuffer);
        histRenderPass.setBindGroup(0, data.bindGroups[data.computeStep % 2]);
        histRenderPass.draw(data.vertices.length >> 1, 1);
        histRenderPass.end();
        data.device.queue.submit([histRenderEncoder.finish()]);
    };

    const onMouseDown = (event: MouseEvent) => {
        mouseStartX = event.clientX;
        mouseStartY = event.clientY;
        mouseDragging = true;
    };

    const onMouseMove = (event: MouseEvent) => {
        if (mouseDragging) {
            if (useFullResolution) {
                mouseDragX = window.devicePixelRatio * (event.clientX - mouseStartX);
                mouseDragY = window.devicePixelRatio * (event.clientY - mouseStartY);
            } else {
                mouseDragX = event.clientX - mouseStartX;
                mouseDragY = event.clientY - mouseStartY;
            }
        }

        if (useFullResolution) {
            mouseClientX = event.clientX * window.devicePixelRatio;
            mouseClientY = event.clientY * window.devicePixelRatio;
        } else {
            mouseClientX = event.clientX;
            mouseClientY = event.clientY;
        }
    };

    const onMouseUp = (event: MouseEvent) => {
        if (mouseDragging) {
            const untrackedPixelsPerCell = untrack(pixelsPerCell);
            const untrackedGridSize = untrack(gridSize);

            offsetCellsX = modulo(
                offsetCellsX + mouseDragX / untrackedPixelsPerCell,
                untrackedGridSize.width
            );
            offsetCellsY = modulo(
                offsetCellsY + mouseDragY / untrackedPixelsPerCell,
                untrackedGridSize.height
            );

            mouseDragX = 0;
            mouseDragY = 0;
            mouseDragging = false;
        }
    };

    const onWheel = (event: WheelEvent) => {
        const untrackedGridSize = untrack(gridSize);
        const untrackedPixelsPerCell = untrack(pixelsPerCell);
        const invert = untrack(zoomIsInverted) ? 1 : -1;
        const direction = Math.sign(event.deltaY);
        const newPixelsPerCell = Math.min(
            Math.max(untrackedPixelsPerCell + invert * direction, 1),
            20
        );

        if (newPixelsPerCell === untrackedPixelsPerCell) return;

        const cellX =
            modulo(
                mouseClientX - 0.5 - offsetCellsX * untrackedPixelsPerCell,
                untrackedPixelsPerCell * untrackedGridSize.width
            ) / untrackedPixelsPerCell;
        const cellY =
            modulo(
                mouseClientY - 0.5 - offsetCellsY * untrackedPixelsPerCell,
                untrackedPixelsPerCell * untrackedGridSize.height
            ) / untrackedPixelsPerCell;

        offsetCellsX = modulo(
            -cellX + (mouseClientX - 0.5) / newPixelsPerCell,
            untrackedGridSize.width
        );
        offsetCellsY = modulo(
            -cellY + (mouseClientY - 0.5) / newPixelsPerCell,
            untrackedGridSize.height
        );

        setPixelsPerCell(newPixelsPerCell);
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
                <div {...rest} ref={setCanvasContainerRef}>
                    <canvas
                        id="gameCanvas"
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
