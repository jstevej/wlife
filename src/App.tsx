import { Component } from 'solid-js';
import { GameOfLife } from './GameOfLife';

const App: Component = () => {
    return (
        <div class="flex h-screen w-screen">
            <div class="flex flex-col flex-1 overflow-hidden">
                <GameOfLife class="flex-1 overflow-hidden" cellExtentX={1.0} cellExtentY={1.0} />
            </div>
            <div>
                <h1>Controls</h1>
            </div>
        </div>
    );
};

export default App;
