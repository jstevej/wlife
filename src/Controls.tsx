import { Component, createEffect, createSignal } from 'solid-js';
import { useGameOfLife } from './GameOfLifeProvider';

export const Controls: Component = () => {
    const { frameRate, resetEmit, setFrameRate } = useGameOfLife();
    const [sliderFrameRate, setSliderFrameRate] = createSignal(20);

    createEffect(() => {
        const fr = sliderFrameRate();
        setFrameRate(fr > 0 ? fr : 1);
    });

    const onSliderFrameRateChanged = (event: Event) => {
        const target = event.target as HTMLInputElement | null;
        const newFrameRate = parseInt(target?.value ?? '1', 10);
        setSliderFrameRate(newFrameRate);
    };

    return (
        <div class="flex flex-col">
            <h1>Controls</h1>
            <button onClick={() => resetEmit()}>Reset</button>
            <input
                type="range"
                min="0"
                max="60"
                step="5"
                style={{ appearance: 'slider-vertical' }}
                value={sliderFrameRate()}
                onInput={onSliderFrameRateChanged}
            />
            <div>fps: {frameRate()}</div>
        </div>
    );
};
