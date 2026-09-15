import type { EpisodeShortPlan, EpisodeTimelineItem } from "./compiler.js";
import type { Episode } from "./schema.js";

export const REMOTION_VERSION = "4.0.524";
export const REACT_VERSION = "19.0.0";

export interface RemotionRenderItem {
	id: string;
	startFrame: number;
	endFrame: number;
	speaker: string;
	text: string;
	subtitle: string;
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
		return {
			id: dialogue.id,
			startFrame,
			endFrame: startFrame + duration,
			speaker: dialogue.speaker,
			text: dialogue.text,
			subtitle: dialogue.subtitle ?? dialogue.text,
			visual: {
				type: visual?.type ?? "title",
				props: visual?.props ?? { title: dialogue.text },
			},
		};
	});
	return {
		fps: episode.fps,
		width: shortPlan ? 1080 : 1920,
		height: shortPlan ? 1920 : 1080,
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

export const REMOTION_ENTRY_TSX = `import React from "react";
import { AbsoluteFill, Composition, Sequence, interpolate, registerRoot, useCurrentFrame } from "remotion";

type Item = {id:string;startFrame:number;endFrame:number;speaker:string;text:string;subtitle:string;visual:{type:string;props:Record<string,unknown>}};
type Input = {fps:number;width:number;height:number;durationInFrames:number;items:Item[]};
const placeholder: Input = {fps:30,width:1920,height:1080,durationInFrames:1,items:[]};
const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const list = (value: unknown) => Array.isArray(value) ? value.map((item) => String(item)) : [];
const card: React.CSSProperties = {background:"rgba(255,255,255,0.92)",borderRadius:28,padding:44,color:"#0d1b2a",boxShadow:"0 18px 60px rgba(0,0,0,.18)"};

const Visual = ({item}:{item:Item}) => {
  const p = item.visual.props;
  const title = text(p.title, item.text);
  switch(item.visual.type){
    case "two-column":
    case "comparison": return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:36,width:"86%"}}><div style={card}><h2>{text(p.leftTitle,"A")}</h2>{list(p.left).map((v)=><p key={v}>{v}</p>)}</div><div style={card}><h2>{text(p.rightTitle,"B")}</h2>{list(p.right).map((v)=><p key={v}>{v}</p>)}</div></div>;
    case "timeline": return <div style={{...card,width:"82%"}}><h1>{title}</h1>{list(p.items).map((v,i)=><p key={v}>{i+1}. {v}</p>)}</div>;
    case "number-highlight": return <div style={{textAlign:"center"}}><div style={{fontSize:180,fontWeight:900}}>{text(p.number,"0")}</div><div style={{fontSize:64}}>{title}</div></div>;
    case "quote": return <div style={{...card,width:"78%",fontSize:58,fontWeight:700}}>“{text(p.quote,title)}”<div style={{fontSize:32,marginTop:30,textAlign:"right"}}>{text(p.author)}</div></div>;
    case "source-card": return <div style={{...card,width:"80%"}}><div style={{fontSize:30,opacity:.65}}>SOURCE</div><h1>{title}</h1><p style={{fontSize:34}}>{text(p.url)}</p></div>;
    case "image": return <div style={{width:"88%",height:"74%",display:"grid",placeItems:"center"}}>{text(p.src) ? <img src={text(p.src)} style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/> : <div style={card}>{title}</div>}</div>;
    case "terminal": return <pre style={{...card,width:"84%",background:"#0b1020",color:"#d8e2ff",fontSize:32,whiteSpace:"pre-wrap"}}>{text(p.code,title)}</pre>;
    case "github": return <div style={{...card,width:"82%"}}><div style={{fontSize:30}}>GitHub</div><h1>{title}</h1><p style={{fontSize:34}}>{text(p.repo)}</p><p>{text(p.body)}</p></div>;
    case "title":
    default: return <div style={{textAlign:"center",width:"82%"}}><h1 style={{fontSize:92,margin:0}}>{title}</h1><p style={{fontSize:40}}>{text(p.subtitle)}</p></div>;
  }
};

const Scene = ({item}:{item:Item}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame,[0,8],[0,1],{extrapolateLeft:"clamp",extrapolateRight:"clamp"});
  const angle = 135 + (frame % 240) * 0.08;
  const drift = Math.sin(frame / 18) * 1.2;
  return <AbsoluteFill style={{background:"linear-gradient("+angle+"deg,#0d1b2a,#1b263b)",color:"white",fontFamily:"Arial, sans-serif",alignItems:"center",justifyContent:"center",opacity}}><div style={{display:"contents",transform:"translateX("+drift+"px)"}}><Visual item={item}/></div><div style={{position:"absolute",left:"6%",right:"6%",bottom:"5%",padding:"18px 28px",background:"rgba(0,0,0,.72)",borderRadius:20,textAlign:"center",fontSize:42,fontWeight:700}}>{item.subtitle}</div></AbsoluteFill>;
};

const Episode = ({items}:Input) => <AbsoluteFill>{items.map((item)=><Sequence key={item.id} from={item.startFrame} durationInFrames={Math.max(1,item.endFrame-item.startFrame)}><Scene item={item}/></Sequence>)}</AbsoluteFill>;
const metadata = ({props}:{props:Input}) => ({durationInFrames:props.durationInFrames,fps:props.fps,width:props.width,height:props.height,props});
const Root = () => <Composition id="Episode" component={Episode} durationInFrames={1} fps={30} width={1920} height={1080} defaultProps={placeholder} calculateMetadata={metadata}/>;
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
