import { Component } from 'solid-js';
import { GameOfLife } from './GameOfLife';

const App: Component = () => {
    return (
        <>
            <h1>WebGPU Life</h1>
            <GameOfLife
                cellExtentX={1.0}
                cellExtentY={1.0}
                gameHeight={2048}
                gameWidth={2048}
                viewHeight={1024}
                viewWidth={2048}
                viewOffsetX={0}
                viewOffsetY={0}
            />
        </>
    );
};

export default App;
