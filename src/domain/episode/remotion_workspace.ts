import { getKafkaVisualSystem } from "../design/kafka_visual_system.js";
import type { EpisodeShortPlan, EpisodeTimelineItem } from "./compiler.js";
import type { Episode } from "./schema.js";

export const REMOTION_VERSION = "4.0.524";
export const REACT_VERSION = "19.0.0";
export const NOTO_SANS_JP_VERSION = "5.3.0";
export const EPISODE_FONT_FAMILY = "Noto Sans JP Variable";
const DESIGN = getKafkaVisualSystem();
const REMOTION_DESIGN_JSON = JSON.stringify(DESIGN);

export interface RemotionRenderItem {
	id: string;
	startFrame: number;
	endFrame: number;
	speaker: string;
	text: string;
	subtitle: string;
	shortRole: "HOOK" | "HIGHLIGHT" | "CTA" | null;
	visual: {
		type: string;
		props: Record<string, unknown>;
	};
}

export interface RemotionRenderInput {
	fps: number;
	width: number;
	height: number;
	durationInFrames: number;
	items: RemotionRenderItem[];
}

export function buildRemotionInput(
	episode: Episode,
	timeline: EpisodeTimelineItem[],
	shortPlan: EpisodeShortPlan | null = null,
): RemotionRenderInput {
	const dialogueById = new Map(
		episode.sections
			.flatMap((section) => section.dialogue)
			.map((item) => [item.id, item]),
	);
	const visualById = new Map(episode.visuals.map((item) => [item.id, item]));
	const allowed = shortPlan ? new Set(shortPlan.dialogue_ids) : null;
	const selected = timeline.filter(
		(item) => !allowed || allowed.has(item.dialogueId),
	);
	const ctaDialogueId = shortPlan?.dialogue_ids.at(-1) ?? null;
	let shortFrameCursor = 0;
	const items = selected.map((item) => {
		const dialogue = dialogueById.get(item.dialogueId);
		if (!dialogue)
			throw new Error(`dialogue ${item.dialogueId} does not exist`);
		const visual = dialogue.visual_ref
			? visualById.get(dialogue.visual_ref)
			: undefined;
		const duration = item.endFrame - item.startFrame;
		const startFrame = shortPlan ? shortFrameCursor : item.startFrame;
		if (shortPlan) shortFrameCursor += duration;
		const shortRole: RemotionRenderItem["shortRole"] = !shortPlan
			? null
			: item.dialogueId === shortPlan.hook_dialogue_id
				? "HOOK"
				: item.dialogueId === ctaDialogueId
					? "CTA"
					: "HIGHLIGHT";
		return {
			id: dialogue.id,
			startFrame,
			endFrame: startFrame + duration,
			speaker: dialogue.speaker,
			text: dialogue.text,
			subtitle: dialogue.subtitle ?? dialogue.text,
			shortRole,
			visual: {
				type: visual?.type ?? "title",
				props: visual?.props ?? { title: dialogue.text },
			},
		};
	});
	return {
		fps: episode.fps,
		width: shortPlan
			? DESIGN.canvas.shorts.width
			: DESIGN.canvas.landscape.width,
		height: shortPlan
			? DESIGN.canvas.shorts.height
			: DESIGN.canvas.landscape.height,
		durationInFrames: items.at(-1)?.endFrame ?? 1,
		items,
	};
}

export function remotionPackageJson(): string {
	return `${JSON.stringify(
		{
			private: true,
			type: "module",
			dependencies: {
				"@fontsource-variable/noto-sans-jp": NOTO_SANS_JP_VERSION,
				"@remotion/cli": REMOTION_VERSION,
				react: REACT_VERSION,
				"react-dom": REACT_VERSION,
				remotion: REMOTION_VERSION,
			},
		},
		null,
		2,
	)}\n`;
}

export const REMOTION_ENTRY_TSX = `import "@fontsource-variable/noto-sans-jp";
import React from "react";
import { AbsoluteFill, Composition, Sequence, cancelRender, continueRender, delayRender, interpolate, registerRoot, useCurrentFrame } from "remotion";

type Item = {id:string;startFrame:number;endFrame:number;speaker:string;text:string;subtitle:string;shortRole:"HOOK"|"HIGHLIGHT"|"CTA"|null;visual:{type:string;props:Record<string,unknown>}};
type Input = {fps:number;width:number;height:number;durationInFrames:number;items:Item[]};
const DESIGN = ${REMOTION_DESIGN_JSON};
const placeholder: Input = {fps:${DESIGN.canvas.landscape.fps},width:${DESIGN.canvas.landscape.width},height:${DESIGN.canvas.landscape.height},durationInFrames:1,items:[]};
const FONT_FAMILY = "${EPISODE_FONT_FAMILY}";
const fontHandle = delayRender("Load deterministic Noto Sans JP webfont");
if (typeof document !== "undefined") {
  Promise.all([
    document.fonts.load('400 42px "'+FONT_FAMILY+'"', "レンダリング確認"),
    document.fonts.load('700 64px "'+FONT_FAMILY+'"', "日本語字幕"),
  ]).then(() => {
    if (!document.fonts.check('400 42px "'+FONT_FAMILY+'"', "レンダリング確認")) throw new Error("CJK font contract failed");
    continueRender(fontHandle);
  }).catch((error) => cancelRender(error instanceof Error ? error : new Error(String(error))));
}
const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const list = (value: unknown) => Array.isArray(value) ? value.map((item) => String(item)) : [];
const card: React.CSSProperties = {background:"${DESIGN.colors.surface}",borderRadius:${DESIGN.radius.card},padding:${DESIGN.templates.source_card.padding},color:"${DESIGN.colors.text_primary}",boxShadow:"none"};

const Visual = ({item,short}:{item:Item;short:boolean}) => {
  const p = item.visual.props;
  const title = text(p.title, item.text);
  switch(item.visual.type){
    case "two-column":
    case "comparison": return <div style={{display:"grid",gridTemplateColumns:short ? "${DESIGN.templates.shorts_comparison.width}px" : "${DESIGN.templates.comparison.column_width}px ${DESIGN.templates.comparison.column_width}px",gridTemplateRows:short ? "${DESIGN.templates.shorts_comparison.card_height}px ${DESIGN.templates.shorts_comparison.card_height}px" : undefined,gap:${DESIGN.templates.comparison.gap},width:short ? ${DESIGN.templates.shorts_comparison.width} : ${DESIGN.templates.comparison.width}}}><div style={{...card,height:short ? ${DESIGN.templates.shorts_comparison.card_height} : ${DESIGN.templates.comparison.column_height}}}><h2>{text(p.leftTitle,"A")}</h2>{list(p.left).map((v)=><p key={v}>{v}</p>)}</div><div style={{...card,height:short ? ${DESIGN.templates.shorts_comparison.card_height} : ${DESIGN.templates.comparison.column_height}}}><h2>{text(p.rightTitle,"B")}</h2>{list(p.right).map((v)=><p key={v}>{v}</p>)}</div></div>;
    case "timeline": return <div style={{...card,width:${DESIGN.templates.timeline.width},height:${DESIGN.templates.timeline.height}}}><h1>{title}</h1>{list(p.items).map((v,i)=><p key={v}>{i+1}. {v}</p>)}</div>;
    case "number-highlight": return <div style={{textAlign:"center",width:${DESIGN.templates.number_highlight.width}}><div style={{fontSize:${DESIGN.templates.number_highlight.number_font_size},fontWeight:${DESIGN.templates.number_highlight.number_weight}}}>{text(p.number,"0")}</div><div style={{fontSize:${DESIGN.templates.number_highlight.label_font_size}}}>{title}</div></div>;
    case "quote": return <div style={{...card,width:${DESIGN.templates.quote.width},height:${DESIGN.templates.quote.height},fontSize:${DESIGN.templates.quote.quote_font_size},fontWeight:${DESIGN.templates.quote.quote_weight}}>“{text(p.quote,title)}”<div style={{fontSize:${DESIGN.templates.quote.author_font_size},marginTop:${DESIGN.templates.quote.padding},textAlign:"right"}}>{text(p.author)}</div></div>;
    case "source-card": return <div style={{...card,width:${DESIGN.templates.source_card.width},height:${DESIGN.templates.source_card.height}}}><div style={{fontSize:${DESIGN.templates.source_card.source_font_size},opacity:.65}}>SOURCE</div><h1>{title}</h1><p style={{fontSize:${DESIGN.templates.source_card.body_font_size}}}>{text(p.url)}</p></div>;
    case "image": return <div style={{width:${DESIGN.templates.image.width},height:${DESIGN.templates.image.height},display:"grid",placeItems:"center"}}>{text(p.src) ? <img src={text(p.src)} style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/> : <div style={card}>{title}</div>}</div>;
    case "terminal": return <pre style={{...card,width:${DESIGN.templates.source_card.width},background:"${DESIGN.colors.shadow}",color:"${DESIGN.colors.text_primary}",fontSize:${DESIGN.templates.source_card.terminal_font_size},whiteSpace:"pre-wrap"}}>{text(p.code,title)}</pre>;
    case "github": return <div style={{...card,width:${DESIGN.templates.source_card.width},height:${DESIGN.templates.source_card.height}}}><div style={{fontSize:${DESIGN.templates.source_card.source_font_size}}>GitHub</div><h1>{title}</h1><p style={{fontSize:${DESIGN.templates.source_card.body_font_size}}}>{text(p.repo)}</p><p>{text(p.body)}</p></div>;
    case "title":
    default: return <div style={{textAlign:"center",width:${DESIGN.templates.title.width}}><h1 style={{fontSize:${DESIGN.templates.title.title_font_size},margin:${DESIGN.spacing[0]}}}>{title}</h1><p style={{fontSize:${DESIGN.templates.title.subtitle_font_size}}}>{text(p.subtitle)}</p></div>;
  }
};

const Scene = ({item}:{item:Item}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame,[0,${DESIGN.motion.scene_fade_in_frames}],[0,1],{extrapolateLeft:"clamp",extrapolateRight:"clamp"});
  const drift = Math.sin(frame / ${DESIGN.motion.content_drift_period_frames}) * ${DESIGN.motion.content_drift_amplitude_px};
  return <AbsoluteFill style={{background:"${DESIGN.colors.background}",color:"${DESIGN.colors.text_primary}",fontFamily:FONT_FAMILY,alignItems:"center",justifyContent:"center",opacity}}><div style={{position:"absolute",left:${DESIGN.landscape.section_label.x},top:${DESIGN.landscape.section_label.baseline_y},fontSize:${DESIGN.landscape.section_label.font_size},letterSpacing:${DESIGN.landscape.section_label.letter_spacing},opacity:.72}}>{item.visual.type}</div>{item.shortRole ? <div style={{position:"absolute",left:${DESIGN.shorts.short_role_chip.x},top:${DESIGN.shorts.short_role_chip.y},width:${DESIGN.shorts.short_role_chip.width},height:${DESIGN.shorts.short_role_chip.height},border:"${DESIGN.stroke.default}px solid ${DESIGN.colors.accent_primary}",borderRadius:${DESIGN.shorts.short_role_chip.radius},fontSize:${DESIGN.shorts.short_role_chip.font_size},fontWeight:${DESIGN.shorts.short_role_chip.font_weight},textAlign:"center"}}>{item.shortRole}</div> : null}<div style={{display:"contents",transform:"translateX("+drift+"px)"}}><Visual item={item} short={item.shortRole !== null}/></div><div style={{position:"absolute",left:${DESIGN.landscape.subtitle.margin_left},right:${DESIGN.landscape.subtitle.margin_right},bottom:${DESIGN.landscape.subtitle.margin_bottom},padding:${DESIGN.spacing[2]}px,background:"${DESIGN.landscape.caption_band.color}",borderRadius:${DESIGN.radius.medium},textAlign:"center",fontSize:${DESIGN.landscape.subtitle.font_size},fontWeight:${DESIGN.landscape.subtitle.font_weight}}}>{item.subtitle}</div></AbsoluteFill>;
};

const Episode = ({items}:Input) => <AbsoluteFill>{items.map((item)=><Sequence key={item.id} from={item.startFrame} durationInFrames={Math.max(1,item.endFrame-item.startFrame)}><Scene item={item}/></Sequence>)}</AbsoluteFill>;
const metadata = ({props}:{props:Input}) => ({durationInFrames:props.durationInFrames,fps:props.fps,width:props.width,height:props.height,props});
const Root = () => <Composition id="Episode" component={Episode} durationInFrames={1} fps={${DESIGN.canvas.landscape.fps}} width={${DESIGN.canvas.landscape.width}} height={${DESIGN.canvas.landscape.height}} defaultProps={placeholder} calculateMetadata={metadata}/>;
registerRoot(Root);
`;

export function buildRemotionWorkspaceFiles(): Record<string, string> {
	return {
		"package.json": remotionPackageJson(),
		"entry.tsx": REMOTION_ENTRY_TSX,
	};
}

export function buildRemotionRenderCommand(
	inputFile: string,
	outputFile: string,
): string[] {
	return [
		"bunx",
		"remotion",
		"render",
		"entry.tsx",
		"Episode",
		outputFile,
		`--props=${inputFile}`,
		"--codec=h264",
		"--log=warn",
	];
}
