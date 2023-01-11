import { TWithContext } from "@haibun/context/build/Context";

export type TFeatureError = {
    ok: false;
    error: {
        message: string;
    };
};
export type TFeatureParsed = {
    ok: true;
    backgrounds: any;
    feature: string;
};

export type TBrowserContextMessage = TWithContext & (TEvent | TControl);

export type TEvent = {
    '@context': '#haibun/event';
    action: 'click' | 'dblclick' | 'submit' | 'goto' | 'setViewportSize' | 'waitForSelector' | 'keydown' | 'change';
    value?: string;
    selector: string,
    tagName: string,
    keyCode: string,
    href: string,
    coordinates?: { x: number, y: number }
}

export type TControl = {
    '@context': '#haibun/control';
    control: string;
    href?: string;
    coordinates?: { width: number, height: number }
}