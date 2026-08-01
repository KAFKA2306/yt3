/**
 * Sovereign Domain: Humanity Observatory
 * Humanity Audit v2 Linguistic Terms and Dictionaries
 */

// 1. 抽象語・自己啓発・ビジネススロップ語 (TED-talk / Abstraction Slop)
export const forbiddenAbstractWords = [
	"現代社会",
	"本質",
	"人間関係",
	"自己肯定感",
	"生産性",
	"課題",
	"最適化",
	"合理性",
	"自己成長",
	"能力向上",
	"問題解決",
	"社会的役割",
	"アイデンティティ",
];

// 2. 解決圧・自己啓発・最適化ワード (Optimization/Solution Pressure)
export const optimizationTerms = [
	"改善",
	"成長",
	"成功",
	"効率",
	"勝ち",
	"克服",
	"是正",
	"進歩",
	"ソリューション",
	"PDCA",
];

// 3. お説教フレーズ (Preachy / TED-talk cadence)
export const tedPhrases = [
	"私たちは",
	"現代人は",
	"つまり",
	"重要なのは",
	"本質的に",
	"現代人",
	"我々は",
	"〜すべき",
	"しなければならない",
];

// 4. 当事者同調表現 (Narrator Self-Inclusion / Shared Humanity)
export const selfInclusionWords = [
	"はうちゃんも",
	"私も",
	"つい",
	"やっちゃうよね",
	"やっちゃいました",
	"えへへ",
	"実は",
	"やっちゃうの",
	"やらかしちゃ",
];

// 5. プロンプトコリュージョン（カンニング）検知対象の例文名詞
export const promptExampleTerms = [
	"夕焼け",
	"アイス",
	"コンビニ",
	"イヤホン",
	"アイスクリーム",
];

// 6. 生活断片オブジェクト分類 (Mundane Object Lexicon)
// NOTE: This is a local domain vocabulary, not an ISO top-level ontology.
export const mundaneClassifications = {
	food: [
		"アイス",
		"ラーメン",
		"お茶",
		"ご飯",
		"コーヒー",
		"パン",
		"チョコレート",
		"プリン",
		"おにぎり",
		"お弁当",
		"ぬるいお茶",
		"レジ袋",
		"割り箸",
	],
	appliance: [
		"洗濯機",
		"冷蔵庫",
		"電子レンジ",
		"エアコン",
		"ベッド",
		"テレビ",
		"掃除機",
		"ドライヤー",
		"扇風機",
		"暖房",
		"充電",
		"充電ケーブル",
		"リモコン",
	],
	time: [
		"深夜",
		"朝",
		"昼",
		"夕方",
		"夜",
		"1時",
		"2時",
		"3時",
		"4時",
		"5時",
		"6時",
		"7時",
		"8時",
		"9時",
		"10時",
		"11時",
		"12時",
		"23時",
		"0時",
		"月曜",
		"金曜",
		"週末",
		"平日",
		"休みの日",
	],
	space: [
		"お風呂",
		"レジ",
		"ベッドの上",
		"ベランダ",
		"玄関",
		"洗面所",
		"キッチン",
		"廊下",
		"布団",
		"スーパー",
		"コンビニ前",
		"エントランス",
		"エレベーター",
	],
	season: [
		"夕暮れ",
		"湿気",
		"日差し",
		"冬",
		"夏",
		"秋",
		"春",
		"雨",
		"雪",
		"湯気",
		"風",
		"冷気",
		"熱気",
		"におい",
	],
	emotion: [
		"恥ずかしい",
		"安心",
		"ほっとする",
		"うれしい",
		"かなしい",
		"ちょっとだけ",
		"少し",
		"なんだか",
		"ふふっ",
		"えへへ",
		"ささやか",
	],
	object: [
		"レシート",
		"エコバッグ",
		"カーテン",
		"イヤホン",
		"スマホ",
		"コップ",
		"お皿",
		"タオル",
		"靴下",
		"鍵",
		"小銭",
	],
};

export const projectOntologyAlignment = {
	scope: "Humanity Observatory domain vocabulary",
	standard_basis: [
		"ISO/IEC 21838-1:2021",
		"ISO 5127:2017",
		"ISO/IEC TR 20943-6:2013",
	],
	role: "local domain vocabulary aligned to a top-level ontology, not a published ISO ontology",
} as const;

// 7. 各種監査閾値
export const thresholds = {
	traceCoverageMin: 0.8,
	mundaneFragmentsMin: 3,
	optimizationTermsMax: 2,
	tedPhrasesMax: 5,
	narratorSelfInclusionMin: 1,
	unsupportedGeneralizationMax: 0,
	promptExampleReuseMax: 3,
	shameScoreMax: 0.4,
	pressureScoreMax: 0.3,
	entropyMin: 1.5, // 簡易的な多様性スコアの閾値
};
