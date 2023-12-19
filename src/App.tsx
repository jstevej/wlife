import { Component } from 'solid-js';
import { GameOfLife } from './GameOfLife';

const App: Component = () => {
    return (
        <>
            <h1>WebGPU Life</h1>
            <GameOfLife
                gameHeight={1024}
                gameWidth={1024}
                pixelsPerCellX={4}
                pixelsPerCellY={4}
                viewHeight={1024}
                viewWidth={1024}
            />
        </>
    );
};

export default App;
