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
	humanity_base_white: string;
	humanity_soft_sky: string;
	humanity_human_cream: string;
	humanity_evening_orange: string;
	humanity_gentle_blue: string;
	humanity_soft_gray: string;
	humanity_text_charcoal: string;
	humanity_accent_pink: string;
}
