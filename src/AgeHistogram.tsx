import { Component, JSX, splitProps } from 'solid-js';

export const AgeHistogram: Component<JSX.HTMLAttributes<HTMLDivElement>> = props => {
    const [, rest] = splitProps(props, []);

    return (
        <div {...rest}>
            <div>
                <canvas id="ageHistogram" class="w-64 h-24" />
            </div>
        </div>
    );
};
