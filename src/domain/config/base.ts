export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}
export interface Size {
	width: number;
	height: number;
}
export interface OverlayConfig {
	type: string;
	enabled: boolean;
	image_path: string;
	anchor?: string;
	offset?: { top?: number; bottom?: number; left?: number; right?: number };
	width?: number;
	height?: number;
	height_ratio?: number;
	width_ratio?: number;
	scaling?: "fit" | "fill" | "stretch";
	position?: { x: number; y: number };
	size?: { width: number; height: number };
}
