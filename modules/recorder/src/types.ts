export interface TClickInteraction {
	type: "click";
	tagName: string;
	text?: string;
	ariaLabel?: string;
	role?: string;
	name?: string;
	id?: string;
	href?: string;
	placeholder?: string;
}

export interface TInputInteraction {
	type: "input";
	value: string;
	name?: string;
	placeholder?: string;
	label?: string;
	ariaLabel?: string;
	id?: string;
}

interface TNavigationInteraction {
	type: "navigation";
	url: string;
}

interface TKeypressInteraction {
	type: "keypress";
	key: string;
}

export type TInteraction = TClickInteraction | TInputInteraction | TNavigationInteraction | TKeypressInteraction;

export interface TRecordedStep {
	timestamp: number;
	interaction: TInteraction;
	generatedStep: string;
}
