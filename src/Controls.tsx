import { Component, createEffect, createSignal, For, JSX } from 'solid-js';
import { useGameOfLife } from './GameOfLifeProvider';
import { getGradientName, gradientNames, isGradientName } from './Gradients';

type CheckboxProps = {
    label: string;
    onChange: (checked: boolean) => void;
    value: boolean;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'onChange'>;

const Checkbox: Component<CheckboxProps> = props => {
    const onChange = (event: Event) => {
        const target = event.target as HTMLInputElement | null;
        props.onChange(target?.checked ?? false);
    };

    return (
        <div>
            <input type="checkbox" checked={props.value} onChange={onChange} />
            <label class="ml-2">{props.label}</label>
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
        <div class="flex flex-row space-x-2">
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
    step: number;
    title: string;
    value: number;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'onInput'>;

const Slider: Component<SliderProps> = props => {
    const onSliderValueChanged = (event: Event) => {
        const target = event.target as HTMLInputElement | null;
        props.onInput(parseInt(target?.value ?? props.min.toString(), 10));
    };

    return (
        <div class="flex flex-col">
            <div class="flex flex-row">
                <div class="flex-1 text-gray-400">{`${props.title}: `}</div>
                <div>{props.displayValue ?? props.value.toString()}</div>
            </div>
            <input
                type="range"
                min={props.min}
                max={props.max}
                step={props.step}
                value={props.value}
                onInput={onSliderValueChanged}
            />
        </div>
    );
};

export const Controls: Component = () => {
    const {
        actualFrameRate,
        frameRate,
        gradientName,
        resetEmit,
        setGradientName,
        setFrameRate,
        setZoomIsInverted,
        zoomIsInverted,
        showAxes,
        setShowAxes,
        showBackgroundAge,
        setShowBackgroundAge,
    } = useGameOfLife();
    const [sliderFrameRate, setSliderFrameRate] = createSignal(20);

    createEffect(() => {
        const fr = sliderFrameRate();
        setFrameRate(fr > 0 ? fr : 1);
    });

    const onFrameRateSliderChanged = (value: number) => {
        setSliderFrameRate(value);
    };

    return (
        <div class="flex flex-col mx-2 divide-y divide-solid">
            <h1>Controls</h1>
            <Slider
                title="Frame Rate"
                displayValue={`${frameRate()} fps`}
                min={0}
                max={60}
                step={5}
                onInput={onFrameRateSliderChanged}
                value={sliderFrameRate()}
            />
            <Checkbox label="Invert Zoom" value={zoomIsInverted()} onChange={setZoomIsInverted} />
            <Select
                title="Gradient"
                options={gradientNames.map(name => [name, getGradientName(name)])}
                currentValue={gradientName()}
                onChange={value => {
                    if (isGradientName(value)) setGradientName(value);
                }}
            />
            <Checkbox label="Show Axes" value={showAxes()} onChange={setShowAxes} />
            <Checkbox
                label="Background Age"
                value={showBackgroundAge()}
                onChange={setShowBackgroundAge}
            />
            <div>
                <div class="flex flex-col mt-1">
                    <button onClick={() => resetEmit()}>Restart</button>
                </div>
            </div>
            <div>{`Actual: ${actualFrameRate().toFixed(1)} fps`}</div>
        </div>
    );
};
