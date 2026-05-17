export interface GlobalStyle {
	font_path: string;
	font_name: string;
	thumbnail: { title_size: number; subtitle_size: number };
	video: { subtitle_size: number };
}
export interface DesignTokens {
	primary_brand_color: string;
	accent_brand_color: string;
	contrast_text_color: string;
	alert_color: string;
	success_color: string;
	font_display: string;
	font_text: string;
	font_japanese: string;

	// Humanity Observatory (Cognitive) Palette
	cognitive_base_white: string;
	cognitive_soft_sky: string;
	cognitive_human_cream: string;
	cognitive_evening_orange: string;
	cognitive_gentle_blue: string;
	cognitive_soft_gray: string;
	cognitive_text_charcoal: string;
	cognitive_accent_pink: string;
}
