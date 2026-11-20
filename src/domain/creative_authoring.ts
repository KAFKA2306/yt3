import { z } from "zod";

export const TitleProposalSchema = z.object({
	title: z.string().min(1).max(100),
});

export const TitleReviewSchema = z.object({
	what_it_suggests: z.string().min(1),
	listener_value: z.string().min(1),
	unclear: z.string().min(1),
});
export type TitleReview = z.infer<typeof TitleReviewSchema>;
export type TitleProposal = z.infer<typeof TitleProposalSchema>;

export const TitleFitSchema = z.object({
	title: z.string().min(1).max(100),
	reason: z.string().min(1),
});
export type TitleFit = z.infer<typeof TitleFitSchema>;

export function titleProposalPrompt(input: {
	brand: string;
	context: unknown;
	rules?: string;
}): string {
	return [
		`あなたは${input.brand}の編集者です。本文を作る前に、題材からタイトルを一つ決めてください。`,
		"タイトルだけを返します。本文、台本、歌詞、あらすじ、タイトルの批評は作りません。",
		...(input.rules ? [`タイトル設計ルール: ${input.rules}`] : []),
		`企画の手掛かり: ${JSON.stringify(input.context)}`,
	].join("\n");
}

export function titleOnlyPrompt(input: {
	brand: string;
	title: string;
	rules?: string;
}): string {
	return [
		`あなたは${input.brand}の編集者です。本文を知らない読者として、タイトル文字列だけを批判します。`,
		"本文、題材の説明、あらすじ、企画情報は参照しません。タイトルから何の話だと受け取るか、読む・聴く価値が伝わるか、意味が曖昧な箇所はどこかを短く具体的に評価してください。",
		...(input.rules ? [`確認観点: ${input.rules}`] : []),
		`評価対象のタイトル: ${input.title}`,
	].join("\n");
}

export function titleFitPrompt(input: {
	brand: string;
	initialTitle: string;
	titleReview: TitleReview;
	body: string;
	rules?: string;
}): string {
	return [
		`あなたは${input.brand}の編集者です。タイトルだけの批評を完成本文と照合してください。`,
		"タイトルが本文の実際の魅力を正確に予告し、何の話かと読む・聴く価値を伝えるか判断します。批評で分かりにくいとされた点が本文で解消されていなければ、本文に合うタイトルへ改題します。すでに合っていれば変更しません。本文は変更しません。",
		...(input.rules ? [`タイトル設計ルール: ${input.rules}`] : []),
		`当初のタイトル: ${input.initialTitle}`,
		`タイトルだけの批評: ${JSON.stringify(input.titleReview)}`,
		`完成本文:\n${input.body}`,
	].join("\n\n");
}
