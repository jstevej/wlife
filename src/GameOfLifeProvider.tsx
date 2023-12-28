import { createEventBus } from '@solid-primitives/event-bus';
import { createContext, createSignal, ParentComponent, useContext } from 'solid-js';
import { GradientName } from './Gradients';

export type Dimensions = {
    height: number;
    width: number;
};

function useGameOfLifeProvider() {
    const [actualComputeFrameRate, setActualComputeFrameRate] = createSignal(1);
    const [actualRenderFrameRate, setActualRenderFrameRate] = createSignal(1);
    const [computeFrameRate, setComputeFrameRate] = createSignal(20);
    const [paused, setPaused] = createSignal(false);
    const [zoomIsInverted, setZoomIsInverted] = createSignal(false);
    const [showAxes, setShowAxes] = createSignal(false);
    const [showBackgroundAge, setShowBackgroundAge] = createSignal(true);
    const [gradientName, setGradientName] = createSignal<GradientName>('agSunset');
    const { listen: resetListen, emit: resetEmit } = createEventBus<void>(); // clear not used

    return {
        actualComputeFrameRate,
        setActualComputeFrameRate,
        actualRenderFrameRate,
        setActualRenderFrameRate,
        computeFrameRate,
        setComputeFrameRate,
        paused,
        setPaused,
        zoomIsInverted,
        setZoomIsInverted,
        showAxes,
        setShowAxes,
        showBackgroundAge,
        setShowBackgroundAge,
        gradientName,
        setGradientName,
        resetListen,
        resetEmit,
    };
}

export type GameOfLifeContextType = ReturnType<typeof useGameOfLifeProvider>;

const GameOfLifeContext = createContext<GameOfLifeContextType>();

export const GameOfLifeProvider: ParentComponent = props => {
    const value = useGameOfLifeProvider();
    return <GameOfLifeContext.Provider value={value}>{props.children}</GameOfLifeContext.Provider>;
};

export function useGameOfLife() {
    const context = useContext(GameOfLifeContext);

    if (context === undefined) {
        throw new Error(`useGameOfLife must be used within a GameOfLifeProvider component`);
    }

    return context;
}
