import { Component, createEffect, createMemo, For, JSX, untrack } from 'solid-js';
import PanZoomIcon from './assets/pan-zoom.svg';
import { gridScaleLimit, useGameOfLifeControls } from './GameOfLifeControlsProvider';
import { getGradientName, getGradientStops, gradientNames, isGradientName } from './Gradients';
import { SimulationResultsChart } from './SimulationResultsChart';

type CheckboxProps = {
    disabled?: boolean;
    label: string;
    onChange: (checked: boolean) => void;
    value: boolean;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'onChange'>;

const Checkbox: Component<CheckboxProps> = props => {
    const isDisabled = () => props.disabled ?? false;
    const onChange = (event: Event) => {
        const target = event.target as HTMLInputElement | null;
        props.onChange(target?.checked ?? false);
    };

    return (
        <div>
            <input
                type="checkbox"
                checked={props.value}
                disabled={isDisabled()}
                onChange={onChange}
            />
            <label
                class={isDisabled() ? 'ml-2 text-gray-400' : 'ml-2'}
                onClick={() => props.onChange(!props.value)}
            >
                {props.label}
            </label>
        </div>
    );
};

type SelectProps = {
    currentValue: string;
    onChange: (value: string | undefined) => void;
    options: Array<[string, string]>; // value, display name
    title: string;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'onChange'>;

const Select: Component<SelectProps> = props => {
    const onChange = (event: Event) => {
        const target = event.target as HTMLSelectElement | null;
        props.onChange(target?.value ?? undefined);
    };

    return (
        <div class="flex flex-row space-x-2 py-1">
            <div>{`${props.title}:`}</div>
            <select onChange={onChange}>
                <For each={props.options}>
                    {opt => (
                        <option value={opt[0]} selected={opt[0] === props.currentValue}>
                            {opt[1]}
                        </option>
                    )}
                </For>
            </select>
        </div>
    );
};

type SliderProps = {
    displayValue?: string;
    max: number;
    min: number;
    onInput: (value: number) => void;
    step?: number;
    title: string;
    value: number;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'onInput'>;

const Slider: Component<SliderProps> = props => {
    const onSliderValueChanged = (event: Event) => {
        const target = event.target as HTMLInputElement | null;
        props.onInput(parseInt(target?.value ?? props.min.toString(), 10));
    };

    return (
        <div class="flex flex-col mb-1">
            <div class="flex flex-row">
                <div class="flex-1 text-gray-400">{`${props.title}: `}</div>
                <div>{props.displayValue ?? props.value.toString()}</div>
            </div>
            <input
                type="range"
                min={props.min}
                max={props.max}
                step={props.step ?? 1}
                value={props.value}
                onInput={onSliderValueChanged}
            />
        </div>
    );
};

export const Controls: Component = () => {
    const {
        actualComputeFrameRate,
        actualRenderFrameRate,
        age,
        canvasSize,
        detectedFrameRate,
        framesPerCompute,
        gradientName,
        gridSize,
        initialDensity,
        paused,
        pixelsPerCell,
        resetEmit,
        setGradientName,
        setFramesPerCompute,
        setInitialDensity,
        setPaused,
        setShowAxes,
        setShowBackgroundAge,
        setShowGrid,
        setZoomIsInverted,
        showAxes,
        showBackgroundAge,
        showGrid,
        zoomIsInverted,
    } = useGameOfLifeControls();

    const gradientStops = () => {
        return getGradientStops(gradientName()).join(', ');
    };

    const framesPerComputeValues = createMemo<Array<number>>(() => {
        const frameRate = detectedFrameRate();
        const newValues: Array<number> = [];
        let currFrameRate = frameRate;

        for (let i = 6; i > 0; i--) {
            newValues.unshift(1 / (1 << i));
        }

        while (currFrameRate > 0.5) {
            newValues.unshift(Math.round(frameRate / currFrameRate));
            currFrameRate *= 0.5;
        }

        return newValues;
    });

    // Initialize framesPerCompute to result in 15 frames per second (based on the detected display
    // frame rate).

    createEffect(() => {
        const detectedFrameRateValue = detectedFrameRate();
        const values = framesPerComputeValues();

        const desiredComputeFrameRate = 15;
        let bestFrameRate = 15;
        let bestFramesPerCompute = 4;
        let bestError = Number.MAX_VALUE;

        for (const currFramesPerCompute of values) {
            const computeFrameRate = detectedFrameRateValue / currFramesPerCompute;
            const error = Math.abs(computeFrameRate - desiredComputeFrameRate);

            if (error < bestError) {
                bestFrameRate = computeFrameRate;
                bestFramesPerCompute = currFramesPerCompute;
                bestError = error;
            }

            if (error === 0 || error > bestError) {
                break;
            }
        }

        console.log(
            `setting initial framesPerCompute = ${bestFramesPerCompute} (${bestFrameRate} fps)`
        );
        setFramesPerCompute(bestFramesPerCompute);
    });

    const onSpeedSliderChanged = (value: number) => {
        setFramesPerCompute(untrack(framesPerComputeValues)[value]);
    };

    const getSpeedSliderValue = () => {
        const currValue = framesPerCompute();
        const index = framesPerComputeValues().indexOf(currValue);
        return index >= 0 ? index : 0;
    };

    const densities = [
        0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7,
        0.71, 0.72, 0.73, 0.74, 0.75, 0.76, 0.77, 0.78, 0.79, 0.8, 0.81, 0.82, 0.83, 0.84, 0.85,
        0.9, 1.0,
    ];

    const indexToDensity = (index: number): number => {
        return densities[Math.min(Math.max(index, 0), densities.length - 1)];
    };

    const densityToIndex = (density: number): number => {
        let bestError = Number.MAX_VALUE;
        let bestIndex = 0;

        for (let i = 0; i < densities.length; i++) {
            const error = Math.abs(density - densities[i]);
            if (error < bestError) {
                bestError = error;
                bestIndex = i;
            }
        }

        return bestIndex;
    };

    return (
        <div class="flex flex-col mx-2 divide-y divide-solid">
            <h1>Controls</h1>
            <Slider
                title="Speed"
                displayValue={`${(detectedFrameRate() / framesPerCompute()).toFixed(1)} fps`}
                min={0}
                max={framesPerComputeValues().length - 1}
                onInput={onSpeedSliderChanged}
                value={getSpeedSliderValue()}
            />
            <div>
                <Select
                    title="Gradient"
                    options={gradientNames.map(name => [name, getGradientName(name)])}
                    currentValue={gradientName()}
                    onChange={value => {
                        if (isGradientName(value)) setGradientName(value);
                    }}
                />
                <div
                    class="mt-1 h-4"
                    style={{
                        background: `linear-gradient(${gradientStops()})`,
                    }}
                ></div>
                <div class="flex flex-row mb-1">
                    <div>0</div>
                    <div class="flex-1 flex flex-row justify-center">
                        <div>← age →</div>
                    </div>
                    <div>100</div>
                </div>
            </div>
            <Checkbox label="Show Axes" value={showAxes()} onChange={setShowAxes} />
            <Checkbox
                label="Background Age"
                value={showBackgroundAge()}
                onChange={setShowBackgroundAge}
            />
            <Checkbox
                label="Show Grid"
                value={showGrid()}
                disabled={pixelsPerCell() < gridScaleLimit}
                onChange={setShowGrid}
            />
            <Checkbox label="Invert Zoom" value={zoomIsInverted()} onChange={setZoomIsInverted} />
            <div>
                <div class="flex flex-col mt-1">
                    <button onClick={() => setPaused(!paused())}>
                        {paused() ? 'Resume' : 'Pause'}
                    </button>
                </div>
            </div>
            <div>
                <div class="flex flex-col mt-1">
                    <button onClick={() => resetEmit()}>Restart</button>
                </div>
            </div>
            <div class="mt-1">
                <Slider
                    title="Initial Density"
                    displayValue={`${(100 * initialDensity()).toFixed(2).replace(/\.?0+$/, '')}%`}
                    min={0}
                    max={densities.length - 1}
                    onInput={value => setInitialDensity(indexToDensity(value))}
                    value={densityToIndex(initialDensity())}
                />
            </div>
            <div class="mt-1">
                <div class="flex flex-row">
                    <div class="flex-1">Age:</div>
                    <div>{`${age().toLocaleString()}`}</div>
                </div>
            </div>
            <div class="mt-1">
                <div class="flex flex-row">
                    <div class="flex-1">Render:</div>
                    <div>{`${actualRenderFrameRate().toFixed(1)} fps`}</div>
                </div>
                <div class="flex flex-row">
                    <div class="flex-1">Compute:</div>
                    <div>{`${actualComputeFrameRate().toFixed(1)} fps`}</div>
                </div>
            </div>
            <div class="mt-1">
                <div class="flex flex-row">
                    <div class="flex-1">Grid Size:</div>
                    <div>{`${gridSize().width} x ${gridSize().height}`}</div>
                </div>
                <div class="flex flex-row">
                    <div class="flex-1">Canvas Size:</div>
                    <div>{`${canvasSize().width} x ${canvasSize().height}`}</div>
                </div>
                <div class="flex flex-row">
                    <div class="flex-1">Zoom:</div>
                    <div>{`${pixelsPerCell()} px/cell`}</div>
                </div>
            </div>
            <SimulationResultsChart class="pt-1" />
            <div class="flex-1"></div>
            <div class="flex flex-row justify-center">
                <div class="my-2 text-blue-500">
                    <PanZoomIcon />
                </div>
            </div>
            <div>
                <a
                    href="https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Conway's Game of Life
                </a>
            </div>
        </div>
    );
};
