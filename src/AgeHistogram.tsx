import { Component, createEffect, createSignal, JSX, splitProps } from 'solid-js';

type Dimensions = {
    height: number;
    width: number;
};

export const AgeHistogram: Component<JSX.HTMLAttributes<HTMLDivElement>> = props => {
    const [, rest] = splitProps(props, []);
    const [canvasRef, setCanvasRef] = createSignal<HTMLCanvasElement>();
    const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
    const [canvasSize, setCanvasSize] = createSignal<Dimensions>({ height: 100, width: 100 });
    let resizeObserver: ResizeObserver | undefined;

    createEffect(() => {
        const ref = containerRef();

        if (ref === undefined) return;

        if (resizeObserver !== undefined) {
            console.error(`containerRef effect: resize observer not undefined`);
            resizeObserver.unobserve(ref);
        }

        resizeObserver = new ResizeObserver(entries => {
            const rect = entries[0].contentRect;
            setCanvasSize({ height: Math.floor(rect.height), width: Math.floor(rect.width) });
        });

        resizeObserver.observe(ref);
    });

    createEffect(() => {
        const { height, width } = canvasSize();
        const ref = canvasRef();
        if (ref === undefined) return;
        ref.style.width = `${width}px`;
        ref.style.height = `${height}px`;
        ref.width = width;
        ref.height = height;
    });

    return (
        <div {...rest}>
            <div ref={setContainerRef}>
                <canvas id="ageHistogram" ref={setCanvasRef} />
            </div>
        </div>
    );
};
