import { Component, createEffect, createSignal, JSX } from 'solid-js';
import { useGameOfLife } from './GameOfLifeProvider';

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
    const { frameRate, resetEmit, setFrameRate } = useGameOfLife();
    const [sliderFrameRate, setSliderFrameRate] = createSignal(20);

    createEffect(() => {
        const fr = sliderFrameRate();
        setFrameRate(fr > 0 ? fr : 1);
    });

    const onFrameRateSliderChanged = (value: number) => {
        setSliderFrameRate(value);
    };

    return (
        <div class="flex flex-col mx-2 divide-y divide-solid w-48">
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
            <div>
                <div class="flex flex-col mt-1">
                    <button onClick={() => resetEmit()}>Restart</button>
                </div>
            </div>
        </div>
    );
};