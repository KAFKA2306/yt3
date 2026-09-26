import { getKafkaVisualSystem } from "../design/kafka_visual_system.js";
import type {
	ExperienceRenderInput,
	ExperienceRenderItem,
	ExperienceWorld,
} from "../experience/schema.js";
import type { EpisodeShortPlan, EpisodeTimelineItem } from "./compiler.js";
import type { Episode } from "./schema.js";

export const REMOTION_VERSION = "4.0.524";
export const REACT_VERSION = "19.0.0";
export const NOTO_SANS_JP_VERSION = "5.3.0";
export const EPISODE_FONT_FAMILY = "Noto Sans JP Variable";
const DESIGN = getKafkaVisualSystem();
const REMOTION_DESIGN_JSON = JSON.stringify(DESIGN);
const DEFAULT_EXPERIENCE_PALETTE = {
	background: DESIGN.colors.background,
	surface: DESIGN.colors.surface,
	text_primary: DESIGN.colors.text_primary,
	accent_primary: DESIGN.colors.accent_primary,
	accent_secondary: DESIGN.colors.accent_secondary,
	danger: DESIGN.colors.alert,
	coin: DESIGN.colors.warning,
	tether: DESIGN.colors.accent_pink,
};

export type RemotionRenderItem = ExperienceRenderItem;
export type RemotionRenderInput = ExperienceRenderInput;

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
				...(visual?.action ? { action: visual.action } : {}),
				...(visual?.subject ? { subject: visual.subject } : {}),
				...(visual?.reaction ? { reaction: visual.reaction } : {}),
				...(visual?.concept_id ? { concept_id: visual.concept_id } : {}),
				...(visual?.asset_strategy
					? { asset_strategy: visual.asset_strategy }
					: {}),
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

type Item = {id:string;startFrame:number;endFrame:number;speaker:string;text:string;subtitle:string;shortRole:"HOOK"|"HIGHLIGHT"|"CTA"|null;visual:{type:string;props:Record<string,unknown>;action?:string;subject?:string;reaction?:string;concept_id?:string;asset_strategy?:string}};
type Input = {fps:number;width:number;height:number;durationInFrames:number;items:Item[]};
const DESIGN = ${REMOTION_DESIGN_JSON};
const EXPERIENCE_PALETTE: Record<string,string> = ${JSON.stringify(DEFAULT_EXPERIENCE_PALETTE)};
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

const ExperienceVisual = ({item,frame}:{item:Item;frame:number}) => {
  const p = item.visual.props;
  const title = text(p.title, item.text);
  const duration = Math.max(1, item.endFrame - item.startFrame);
  const progress = Math.min(1, Math.max(0, frame / duration));
  const palette = EXPERIENCE_PALETTE;
  const frameBox = <rect x="4" y="4" width="1272" height="632" rx="36" fill={palette.surface} stroke={palette.accent_primary} strokeOpacity=".25" strokeWidth="4"/>;
  const coins = Array.from({length:12},(_,i)=><g key={i} transform={"translate("+(120+(i*97)%1040)+" "+((frame*8+i*53)%510)+")"}><circle r="30" fill={palette.coin}/><circle r="21" fill="none" stroke={palette.surface} strokeWidth="5"/><text textAnchor="middle" y="10" fill={palette.surface} fontSize="28" fontWeight="800">¥</text></g>);
  const scene = text(p.scene_kind);
  let drawing: React.ReactNode;
  switch(scene){
    case "coin_rain": drawing = <>{coins}<path d="M180 520h920l-55 85H235z" fill={palette.accent_primary}/><rect x="250" y="465" width="780" height="80" rx="18" fill={palette.accent_secondary}/><text x="640" y="520" textAnchor="middle" fill={palette.background} fontSize="42" fontWeight="800">配当を受け取る</text></>; break;
    case "per_balloon": { const radius = 92 + progress * 145; drawing = <><line x1="640" y1="430" x2="640" y2="565" stroke={palette.tether} strokeWidth="8"/><ellipse cx="640" cy={300-progress*32} rx={radius} ry={radius*1.2} fill={palette.danger} fillOpacity=".9"/><path d="M630 420l10 22 10-22" fill={palette.danger}/><text x="640" y="310" textAnchor="middle" fill={palette.background} fontSize="60" fontWeight="900">PER</text><text x="640" y="560" textAnchor="middle" fill={palette.text_primary} fontSize="34">利益は同じ、株価だけ上昇</text><text x="640" y="110" textAnchor="middle" fill={palette.accent_secondary} fontSize="44" fontWeight="800">{text(p.start_per,"10")}倍 → {text(p.end_per,"24")}倍</text></>; break; }
    case "covered_call_tether": { const rise = 400-progress*235; drawing = <><path d="M210 520 L500 440 L760 260 L1050 130" fill="none" stroke={palette.accent_primary} strokeWidth="16"/><path d="M210 520 L500 440 L760 330 L1050 330" fill="none" stroke={palette.accent_secondary} strokeWidth="16"/><circle cx="760" cy={rise} r="20" fill={palette.tether}/><line x1="760" y1={rise+24} x2="760" y2="330" stroke={palette.tether} strokeWidth="9" strokeDasharray="14 12"/><text x="1030" y="95" textAnchor="end" fill={palette.accent_primary} fontSize="32">{text(p.rise_label,"株価")}</text><text x="1030" y="390" textAnchor="end" fill={palette.accent_secondary} fontSize="32">{text(p.cap_label,"受取側")}</text><line x1="160" y1="540" x2="1110" y2="540" stroke={palette.text_primary} strokeOpacity=".5" strokeWidth="4"/></>; break; }
    case "drawdown_floor": { const floor = 355+progress*165; drawing = <><path d="M230 150 L400 225 L560 205 L760 335 L1015 440" fill="none" stroke={palette.danger} strokeWidth="18"/><circle cx="1015" cy="440" r="24" fill={palette.danger}/><rect x="150" y={floor} width="980" height="28" rx="14" fill={palette.accent_secondary}/><path d="M565 430l75-100 75 100z" fill={palette.tether}/><circle cx="640" cy="290" r="46" fill={palette.accent_primary}/><text x="640" y="570" textAnchor="middle" fill={palette.text_primary} fontSize="36">下落 {Math.round(progress*Number(p.drop_ratio ?? .42)*100)}% — 足元が沈む</text></>; break; }
    case "capex_capacity": { const factoryOpacity = Math.min(1,progress*3); const beltOpacity=Math.min(1,Math.max(0,(progress-.35)*3)); const outputOpacity=Math.min(1,Math.max(0,(progress-.7)*4)); drawing = <><g opacity={factoryOpacity}><path d="M180 410V245l190 110V245l190 110V245l190 110v160H180z" fill={palette.tether}/><rect x="260" y="425" width="100" height="90" fill={palette.surface}/><rect x="440" y="425" width="100" height="90" fill={palette.surface}/><rect x="620" y="425" width="100" height="90" fill={palette.surface}/><text x="465" y="210" textAnchor="middle" fill={palette.text_primary} fontSize="34">設備投資 → 工場</text></g><g opacity={beltOpacity}><rect x="180" y="535" width="700" height="22" rx="11" fill={palette.accent_primary}/>{[0,1,2,3,4].map(i=><rect key={i} x={235+i*120} y="490" width="54" height="44" rx="8" fill={palette.coin}/>)}</g><g opacity={outputOpacity}><rect x="930" y="365" width="210" height="150" rx="22" fill={palette.accent_secondary}/><text x="1035" y="430" textAnchor="middle" fill={palette.background} fontSize="28" fontWeight="800">生産能力</text><text x="1035" y="475" textAnchor="middle" fill={palette.background} fontSize="30" fontWeight="900">＋</text></g></>; break; }
    default: drawing = <text x="640" y="350" textAnchor="middle" fill={palette.text_primary} fontSize="44">{title}</text>;
  }
  return <div style={{width:${DESIGN.landscape.character_region.width},height:${DESIGN.landscape.character_region.height},position:"relative"}}><svg viewBox="0 0 1280 640" width="100%" height="100%" role="img" aria-label={title}>{frameBox}{drawing}</svg><div style={{position:"absolute",left:${DESIGN.landscape.safe_area.left},top:${DESIGN.landscape.safe_area.top},color:palette.text_primary,fontSize:${DESIGN.landscape.section_counter.font_size},fontWeight:${DESIGN.typography.weights.brand}}}>{title}</div><div style={{position:"absolute",right:${DESIGN.landscape.safe_area.right},top:${DESIGN.landscape.safe_area.top},color:palette.accent_primary,fontSize:${DESIGN.landscape.section_counter.font_size}}}>{item.visual.action ?? ""} · {item.visual.reaction ?? ""}</div></div>;
};

const Visual = ({item,short,frame}:{item:Item;short:boolean;frame:number}) => {
  const p = item.visual.props;
  const title = text(p.title, item.text);
  switch(item.visual.type){
    case "experience": return <ExperienceVisual item={item} frame={frame}/>;
    case "two-column":
    case "comparison": return <div style={{display:"grid",gridTemplateColumns:short ? "${DESIGN.templates.shorts_comparison.width}px" : "${DESIGN.templates.comparison.column_width}px ${DESIGN.templates.comparison.column_width}px",gridTemplateRows:short ? "${DESIGN.templates.shorts_comparison.card_height}px ${DESIGN.templates.shorts_comparison.card_height}px" : undefined,gap:${DESIGN.templates.comparison.gap},width:short ? ${DESIGN.templates.shorts_comparison.width} : ${DESIGN.templates.comparison.width}}}><div style={{...card,height:short ? ${DESIGN.templates.shorts_comparison.card_height} : ${DESIGN.templates.comparison.column_height}}}><h2>{text(p.leftTitle,"A")}</h2>{list(p.left).map((v)=><p key={v}>{v}</p>)}</div><div style={{...card,height:short ? ${DESIGN.templates.shorts_comparison.card_height} : ${DESIGN.templates.comparison.column_height}}}><h2>{text(p.rightTitle,"B")}</h2>{list(p.right).map((v)=><p key={v}>{v}</p>)}</div></div>;
    case "timeline": return <div style={{...card,width:${DESIGN.templates.timeline.width},height:${DESIGN.templates.timeline.height}}}><h1>{title}</h1>{list(p.items).map((v,i)=><p key={v}>{i+1}. {v}</p>)}</div>;
    case "number-highlight": return <div style={{textAlign:"center",width:${DESIGN.templates.number_highlight.width}}}><div style={{fontSize:${DESIGN.templates.number_highlight.number_font_size},fontWeight:${DESIGN.templates.number_highlight.number_weight}}}>{text(p.number,"0")}</div><div style={{fontSize:${DESIGN.templates.number_highlight.label_font_size}}}>{title}</div></div>;
    case "quote": return <div style={{...card,width:${DESIGN.templates.quote.width},height:${DESIGN.templates.quote.height},fontSize:${DESIGN.templates.quote.quote_font_size},fontWeight:${DESIGN.templates.quote.quote_weight}}}>“{text(p.quote,title)}”<div style={{fontSize:${DESIGN.templates.quote.author_font_size},marginTop:${DESIGN.templates.quote.padding},textAlign:"right"}}>{text(p.author)}</div></div>;
    case "source-card": return <div style={{...card,width:${DESIGN.templates.source_card.width},height:${DESIGN.templates.source_card.height}}}><div style={{fontSize:${DESIGN.templates.source_card.source_font_size},opacity:.65}}>SOURCE</div><h1>{title}</h1><p style={{fontSize:${DESIGN.templates.source_card.body_font_size}}}>{text(p.url)}</p></div>;
    case "image": return <div style={{width:${DESIGN.templates.image.width},height:${DESIGN.templates.image.height},display:"grid",placeItems:"center"}}>{text(p.src) ? <img src={text(p.src)} style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/> : <div style={card}>{title}</div>}</div>;
    case "terminal": return <pre style={{...card,width:${DESIGN.templates.source_card.width},background:"${DESIGN.colors.shadow}",color:"${DESIGN.colors.text_primary}",fontSize:${DESIGN.templates.source_card.terminal_font_size},whiteSpace:"pre-wrap"}}>{text(p.code,title)}</pre>;
    case "github": return <div style={{...card,width:${DESIGN.templates.source_card.width},height:${DESIGN.templates.source_card.height}}}><div style={{fontSize:${DESIGN.templates.source_card.source_font_size}}}>GitHub</div><h1>{title}</h1><p style={{fontSize:${DESIGN.templates.source_card.body_font_size}}}>{text(p.repo)}</p><p>{text(p.body)}</p></div>;
    case "title":
    default: return <div style={{textAlign:"center",width:${DESIGN.templates.title.width}}}><h1 style={{fontSize:${DESIGN.templates.title.title_font_size},margin:${DESIGN.spacing[0]}}}>{title}</h1><p style={{fontSize:${DESIGN.templates.title.subtitle_font_size}}}>{text(p.subtitle)}</p></div>;
  }
};

const Scene = ({item}:{item:Item}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame,[0,${DESIGN.motion.scene_fade_in_frames}],[0,1],{extrapolateLeft:"clamp",extrapolateRight:"clamp"});
  const drift = Math.sin(frame / ${DESIGN.motion.content_drift_period_frames}) * ${DESIGN.motion.content_drift_amplitude_px};
  return <AbsoluteFill style={{background:"${DESIGN.colors.background}",color:"${DESIGN.colors.text_primary}",fontFamily:FONT_FAMILY,alignItems:"center",justifyContent:"center",opacity}}><div style={{position:"absolute",left:${DESIGN.landscape.section_label.x},top:${DESIGN.landscape.section_label.baseline_y},fontSize:${DESIGN.landscape.section_label.font_size},letterSpacing:${DESIGN.landscape.section_label.letter_spacing},opacity:.72}}>{item.visual.type === "experience" ? text(item.visual.props.scene_kind,item.visual.type) : item.visual.type}</div>{item.shortRole ? <div style={{position:"absolute",left:${DESIGN.shorts.short_role_chip.x},top:${DESIGN.shorts.short_role_chip.y},width:${DESIGN.shorts.short_role_chip.width},height:${DESIGN.shorts.short_role_chip.height},border:"${DESIGN.stroke.default}px solid ${DESIGN.colors.accent_primary}",borderRadius:${DESIGN.shorts.short_role_chip.radius},fontSize:${DESIGN.shorts.short_role_chip.font_size},fontWeight:${DESIGN.shorts.short_role_chip.font_weight},textAlign:"center"}}>{item.shortRole}</div> : null}<div style={{display:"contents",transform:"translateX("+drift+"px)"}}><Visual item={item} short={item.shortRole !== null} frame={frame}/></div><div style={{position:"absolute",left:${DESIGN.landscape.subtitle.margin_left},right:${DESIGN.landscape.subtitle.margin_right},bottom:${DESIGN.landscape.subtitle.margin_bottom},padding:${DESIGN.spacing[2]},background:"${DESIGN.landscape.caption_band.color}",borderRadius:${DESIGN.radius.medium},textAlign:"center",fontSize:${DESIGN.landscape.subtitle.font_size},fontWeight:${DESIGN.landscape.subtitle.font_weight}}}>{item.subtitle}</div></AbsoluteFill>;
};

const Episode = ({items}:Input) => <AbsoluteFill>{items.map((item)=><Sequence key={item.id} from={item.startFrame} durationInFrames={Math.max(1,item.endFrame-item.startFrame)}><Scene item={item}/></Sequence>)}</AbsoluteFill>;
const metadata = ({props}:{props:Input}) => ({durationInFrames:props.durationInFrames,fps:props.fps,width:props.width,height:props.height,props});
const Root = () => <Composition id="Episode" component={Episode} durationInFrames={1} fps={${DESIGN.canvas.landscape.fps}} width={${DESIGN.canvas.landscape.width}} height={${DESIGN.canvas.landscape.height}} defaultProps={placeholder} calculateMetadata={metadata}/>;
registerRoot(Root);
`;

export function buildRemotionWorkspaceFiles(
	world?: ExperienceWorld,
): Record<string, string> {
	const palette = JSON.stringify(world?.palette ?? DEFAULT_EXPERIENCE_PALETTE);
	return {
		"package.json": remotionPackageJson(),
		"entry.tsx": REMOTION_ENTRY_TSX.replace(
			`const EXPERIENCE_PALETTE: Record<string,string> = ${JSON.stringify(DEFAULT_EXPERIENCE_PALETTE)};`,
			`const EXPERIENCE_PALETTE: Record<string,string> = ${palette};`,
		),
	};
}

export function buildRemotionRenderCommand(
	inputFile: string,
	outputFile: string,
): string[] {
	return [
		"bun",
		"node_modules/@remotion/cli/remotion-cli.js",
		"render",
		"entry.tsx",
		"Episode",
		outputFile,
		`--props=${inputFile}`,
		"--codec=h264",
		"--log=warn",
	];
}
