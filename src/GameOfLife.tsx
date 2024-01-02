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
import { simulationResults } from './SimulationResults';
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
    computeStep: number;
    context: GPUCanvasContext;
    device: GPUDevice;
    gridSizeArray: Float32Array;
    gridSizeBuffer: GPUBuffer;
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
    vertexBuffer: GPUBuffer;
    vertices: Float32Array;
    workgroupSize: number;
};

// Javascript's modulo implementation uses truncated division, which usually is not what we want for
// negative numbers. This implementation is for floored division, which is what we want.
//
// https://en.wikipedia.org/wiki/Modulo

function modulo(x: number, n: number): number {
    return x - n * Math.floor(x / n);
}

export const GameOfLife: Component<GameOfLifeProps> = props => {
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
        const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;

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

        // group 0, location 0: gridSize

        const untrackedGridSize = untrack(gridSize);
        const gridSizeArray = new Float32Array([untrackedGridSize.width, untrackedGridSize.height]);
        const gridSizeBuffer = device.createBuffer({
            label: 'gridSize uniform',
            size: gridSizeArray.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(gridSizeBuffer, 0, gridSizeArray);

        // group 0, location 1: pixelsPerCell

        const pixelsPerCellArray = new Float32Array([4, 4]);
        const pixelsPerCellStorage = device.createBuffer({
            label: 'pixelsPerCell storage',
            size: pixelsPerCellArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(pixelsPerCellStorage, 0, pixelsPerCellArray);

        // group 0, location 2: offsetCells

        const offsetCellsArray = new Float32Array([0, 0]);
        const offsetCellsStorage = device.createBuffer({
            label: 'offsetCells storage',
            size: offsetCellsArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(offsetCellsStorage, 0, offsetCellsArray);

        // group 0, location 3: simulationParams

        const simulationParamsArray = new Float32Array([0.0, 0.0, 0.0]);
        const simulationParamsStorage = device.createBuffer({
            label: 'simulationParams storage',
            size: simulationParamsArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(simulationParamsStorage, 0, simulationParamsArray);

        // group 0, location 4: cellGradient

        const cellGradientStorage = device.createBuffer({
            label: 'cellGradient storage',
            size: 3 * (maxAge + 1) * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(
            cellGradientStorage,
            0,
            getGradientValues(untrack(gradientName))
        );

        // group 0, location 5: simulationResults

        const simulationResultsArray = new Int32Array([0, 0]);
        const simulationResultsStorage = device.createBuffer({
            label: 'simulationResults storage',
            size: simulationResultsArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
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

        // group 0, location 6: cellState input
        // group 0, location 7: cellState output

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
            cellStateArray[i] = Math.random() < untrack(initialDensity) ? 1 : -maxAge;
        }
        device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);
        simulationResults.reset();
        simulationResults.add(100 * untrack(initialDensity), 0);

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
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'storage' }, // TODO: write-only-storage?
                },
                {
                    binding: 6,
                    visibility:
                        GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'read-only-storage' }, // cell state input buffer
                },
                {
                    binding: 7,
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
                        resource: { buffer: pixelsPerCellStorage },
                    },
                    {
                        binding: 2,
                        resource: { buffer: offsetCellsStorage },
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
                        resource: { buffer: simulationResultsStorage },
                    },
                    {
                        binding: 6,
                        resource: { buffer: cellStateStorage[0] },
                    },
                    {
                        binding: 7,
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
                        resource: { buffer: pixelsPerCellStorage },
                    },
                    {
                        binding: 2,
                        resource: { buffer: offsetCellsStorage },
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
                        resource: { buffer: simulationResultsStorage },
                    },
                    {
                        binding: 6,
                        resource: { buffer: cellStateStorage[1] },
                    },
                    {
                        binding: 7,
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
            computeStep: 0,
            context,
            device,
            gridSizeArray,
            gridSizeBuffer,
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
            vertexBuffer,
            vertices,
            workgroupSize,
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

        for (let i = 0; i < data.cellStateArray.length; i++) {
            data.cellStateArray[i] = Math.random() < untrack(initialDensity) ? 1 : -maxAge;
        }

        data.device.queue.writeBuffer(data.cellStateStorage[0], 0, data.cellStateArray);
        simulationResults.reset();
        simulationResults.add(100 * untrack(initialDensity), 0);
    });

    // Run render and compute pipelines.

    const updateGrid = async (doCompute: boolean) => {
        const data = gpuData();

        if (data === undefined || typeof data === 'string') return;

        const untrackedGridSize = untrack(gridSize);
        const untrackedPixelsPerCell = untrack(pixelsPerCell);

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
            let numComputes = untrack(computesPerFrame);

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
                const workgroupCountX = Math.ceil(untrackedGridSize.width / data.workgroupSize);
                const workgroupCountY = Math.ceil(untrackedGridSize.height / data.workgroupSize);
                computePass.dispatchWorkgroups(workgroupCountX, workgroupCountY);
                computePass.end();
                data.computeStep++;

                const resultsWriteBuffer =
                    data.simulationResultsReadBuffers[
                        data.computeStep % data.simulationResultsReadBuffers.length
                    ];

                while (resultsWriteBuffer.mapState !== 'unmapped') {
                    console.warn('resultsWriteBuffer not ready');
                    await new Promise(resolve => setTimeout(resolve, 1));
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
                        await new Promise(resolve => setTimeout(resolve, 1));
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
