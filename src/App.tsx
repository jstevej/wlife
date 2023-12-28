import { Component } from 'solid-js';
import { Controls } from './Controls';
import { GameOfLife } from './GameOfLife';
import { GameOfLifeControlsProvider } from './GameOfLifeControlsProvider';

const App: Component = () => {
    return (
        <GameOfLifeControlsProvider>
            <div class="flex h-screen w-screen">
                <div class="flex flex-col flex-1 overflow-hidden">
                    <GameOfLife class="flex-1 overflow-hidden" />
                </div>
                <Controls/>
            </div>
        </GameOfLifeControlsProvider>
    );
};

export default App;
