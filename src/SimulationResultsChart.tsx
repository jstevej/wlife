import { Component, createEffect, createSignal, For, JSX, onCleanup, splitProps } from 'solid-js';
import { useGameOfLifeControls } from './GameOfLifeControlsProvider';
import { getGradientStyle } from './Gradients';
import { simulationResults } from './SimulationResults';

export const defaultRefreshIntervalMs = 1000;

export type ChartData = {
    axis?: number;
    data: Array<number | undefined>;
    label: string;
    max?: number;
    min?: number;
    style: string;
    units?: string;
};

export type ChartProps = {
    backgroundStyle: string;
    data: Array<ChartData>;
} & JSX.HTMLAttributes<HTMLDivElement>;

type AxisInfo = {
    max: number | undefined;
    min: number | undefined;
};

export const Chart: Component<ChartProps> = allProps => {
    const [props, rest] = splitProps(allProps, ['backgroundStyle', 'data']);
    const [canvasRef, setCanvasRef] = createSignal<HTMLCanvasElement>();

    createEffect(() => {
        const ref = canvasRef();
        if (ref === undefined) return;
        const height = ref.height;
        const width = ref.width;
        const backgroundStyle = props.backgroundStyle ?? 'rgb(0, 0, 0)';
        const data = props.data;

        if (ref === undefined) return;

        const ctx = ref.getContext('2d');

        if (!ctx) {
            console.error(`2d canvas context not available`);
            return;
        }

        ctx.fillStyle = backgroundStyle;
        ctx.fillRect(0, 0, width, height);

        const axisInfo: Array<AxisInfo> = [];
        let numSamples: number | undefined;

        for (const series of data) {
            const axis = series.axis ?? 0;
            let ai = axisInfo[axis];

            if (ai === undefined) {
                ai = { max: undefined, min: undefined };
                axisInfo[axis] = ai;
            }

            let max: number | undefined;
            let min: number | undefined;

            for (let i = 0; i < series.data.length; i++) {
                const value = series.data[i];
                if (value === undefined || Number.isNaN(value)) continue;
                if (numSamples === undefined) numSamples = series.data.length - i;
                if (max === undefined || value > max) max = value;
                if (min === undefined || value < min) min = value;
            }

            if (series.max !== undefined) max = series.max;
            if (series.min !== undefined) min = series.min;

            if (ai.max === undefined || (max !== undefined && max > ai.max)) ai.max = max;
            if (ai.min === undefined || (min !== undefined && min < ai.min)) ai.min = min;
        }

        if (numSamples === undefined) numSamples = 1;

        const xScale = width / numSamples;

        for (let s = data.length - 1; s >= 0; s--) {
            const series = data[s];
            const startIndex = Math.max(series.data.length - numSamples, 0);
            const ai = axisInfo[series.axis ?? 0];
            if (ai.max === undefined || ai.min === undefined) continue;
            const yMargin = 2;
            const yScale = (height - 2 * yMargin) / (ai.min - ai.max);
            let firstPoint = true;

            ctx.strokeStyle = series.style;
            ctx.lineWidth = 2;
            ctx.beginPath();

            for (let i = startIndex; i < series.data.length; i++) {
                const value = series.data[i];

                if (value !== undefined && !Number.isNaN(value)) {
                    const y = yScale * (value - ai.max) + yMargin;
                    const x = xScale * (i - startIndex);

                    if (firstPoint) {
                        ctx.moveTo(x, y);
                        firstPoint = false;
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
            }

            ctx.stroke();
        }
    });

    const getSeriesValue = (series: ChartData): string => {
        const value = series.data[series.data.length - 1]?.toPrecision(2) ?? '';
        if (value === undefined) return '';
        return value + series.units ?? '';
    };

    return (
        <div {...rest}>
            <div>
                <canvas ref={setCanvasRef} class="w-64 h-24" />
            </div>
            <For each={props.data}>
                {series => (
                    <div class="flex flex-row">
                        <div
                            class="h-0.5 w-5 mr-1 self-center"
                            style={{ background: series.style }}
                        ></div>
                        <div class="flex-1">{`${series.label}:`}</div>
                        <div>{getSeriesValue(series)}</div>
                    </div>
                )}
            </For>
        </div>
    );
};

export type SimulationResultsChartProps = {
    refreshIntervalMs?: number;
} & JSX.HTMLAttributes<HTMLDivElement>;

export const SimulationResultsChart: Component<SimulationResultsChartProps> = props => {
    const [, rest] = splitProps(props, ['refreshIntervalMs']);
    const { gradientName } = useGameOfLifeControls();
    const [data, setData] = createSignal<Array<ChartData>>([]);
    let pctAliveStyle = 'rgb(0, 1, 0)';
    let pctEldersStyle = 'rgb(0, 0, 1)';
    const updateData = () => {
        setData([
            {
                axis: 0,
                data: simulationResults.pctAlive.values,
                label: 'Alive',
                max: Math.max(simulationResults.pctAlive.max ?? 1, 1),
                min: 0,
                style: pctAliveStyle,
                units: '%',
            },
            {
                axis: 1,
                data: simulationResults.pctElders.values,
                label: 'Elders',
                max: Math.max(simulationResults.pctElders.max ?? 1, 1),
                min: 0,
                style: pctEldersStyle,
                units: '%',
            },
        ]);
    };
    let refreshInterval: ReturnType<typeof setInterval> | undefined;

    createEffect(() => {
        const gradientNameValue = gradientName();
        pctAliveStyle = getGradientStyle(gradientNameValue, 0);
        pctEldersStyle = getGradientStyle(gradientNameValue, 0.5);
        if (refreshInterval !== undefined) clearInterval(refreshInterval);
        refreshInterval = setInterval(() => updateData(), props.refreshIntervalMs ?? 500);
    });

    onCleanup(() => {
        if (refreshInterval !== undefined) clearInterval(refreshInterval);
    });

    return <Chart backgroundStyle="rgb(0, 0, 0)" data={data()} {...rest} />;
};
