import { createEventBus } from '@solid-primitives/event-bus';
import { createContext, createSignal, ParentComponent, useContext } from 'solid-js';
import { GradientName } from './Gradients';

export type Dimensions = {
    height: number;
    width: number;
};

function useGameOfLifeControlsProvider() {
    const [actualComputeFrameRate, setActualComputeFrameRate] = createSignal(1);
    const [actualRenderFrameRate, setActualRenderFrameRate] = createSignal(1);
    const [age, setAge] = createSignal(0);
    const [computeFrameRate, setComputeFrameRate] = createSignal(20);
    const [gradientName, setGradientName] = createSignal<GradientName>('agSunset');
    const { listen: resetListen, emit: resetEmit } = createEventBus<void>(); // clear not used
    const [paused, setPaused] = createSignal(false);
    const [showAxes, setShowAxes] = createSignal(false);
    const [showBackgroundAge, setShowBackgroundAge] = createSignal(true);
    const [showGrid, setShowGrid] = createSignal(false);
    const [zoomIsInverted, setZoomIsInverted] = createSignal(false);

    return {
        actualComputeFrameRate,
        actualRenderFrameRate,
        age,
        computeFrameRate,
        gradientName,
        paused,
        resetEmit,
        resetListen,
        setActualComputeFrameRate,
        setActualRenderFrameRate,
        setAge,
        setComputeFrameRate,
        setGradientName,
        setPaused,
        setShowAxes,
        setShowBackgroundAge,
        setShowGrid,
        setZoomIsInverted,
        showAxes,
        showBackgroundAge,
        showGrid,
        zoomIsInverted,
    };
}

export type GameOfLifeContextType = ReturnType<typeof useGameOfLifeControlsProvider>;

const GameOfLifeContext = createContext<GameOfLifeContextType>();

export const GameOfLifeControlsProvider: ParentComponent = props => {
    const value = useGameOfLifeControlsProvider();
    return <GameOfLifeContext.Provider value={value}>{props.children}</GameOfLifeContext.Provider>;
};

export function useGameOfLifeControls() {
    const context = useContext(GameOfLifeContext);

    if (context === undefined) {
        throw new Error(
            `useGameOfLifeControls must be used within a GameOfLifeControlsProvider component`
        );
    }

    return context;
}
