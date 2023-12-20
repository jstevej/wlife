import { Component } from 'solid-js';
import { Controls } from './Controls';
import { GameOfLife } from './GameOfLife';
import { GameOfLifeProvider } from './GameOfLifeProvider';

const App: Component = () => {
    return (
        <GameOfLifeProvider>
            <div class="flex h-screen w-screen">
                <div class="flex flex-col flex-1 overflow-hidden">
                    <GameOfLife class="flex-1 overflow-hidden" />
                </div>
                <Controls/>
            </div>
        </GameOfLifeProvider>
    );
};

export default App;
