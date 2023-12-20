import { createEventBus } from '@solid-primitives/event-bus';
import { createContext, createSignal, ParentComponent, useContext } from 'solid-js';

export type Dimensions = {
    height: number;
    width: number;
};

function useGameOfLifeProvider() {
    const [cellExtent, setCellExtent] = createSignal<Dimensions>({ height: 1, width: 1 });
    const [frameRate, setFrameRate] = createSignal(20);
    const { listen: resetListen, emit: resetEmit } = createEventBus<void>(); // clear not used

    return {
        cellExtent,
        setCellExtent,
        frameRate,
        setFrameRate,
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
