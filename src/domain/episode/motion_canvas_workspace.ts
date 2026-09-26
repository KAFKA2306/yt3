import type {
	ExperienceRenderInput,
	ExperienceRenderItem,
	ExperienceWorld,
} from "../experience/schema.js";

export const MOTION_CANVAS_VERSION = "3.17.2";
export const MOTION_CANVAS_VITE_VERSION = "5.4.21";
export const MOTION_CANVAS_PLAYWRIGHT_VERSION = "1.63.0";
const NOTO_SANS_JP_VERSION = "5.3.0";

function buildMotionCanvasPackageJson(): string {
	return `${JSON.stringify(
		{
			name: "yt3-experience-motion-canvas",
			private: true,
			type: "module",
			scripts: {
				dev: "bun node_modules/vite/bin/vite.js --host 127.0.0.1",
				typecheck: "bun node_modules/typescript/bin/tsc --noEmit",
			},
			dependencies: {
				"@fontsource-variable/noto-sans-jp": NOTO_SANS_JP_VERSION,
				"@motion-canvas/2d": MOTION_CANVAS_VERSION,
				"@motion-canvas/core": MOTION_CANVAS_VERSION,
				"playwright-core": MOTION_CANVAS_PLAYWRIGHT_VERSION,
			},
			devDependencies: {
				"@motion-canvas/ui": MOTION_CANVAS_VERSION,
				"@motion-canvas/vite-plugin": MOTION_CANVAS_VERSION,
				typescript: "5.9.3",
				vite: MOTION_CANVAS_VITE_VERSION,
			},
		},
		null,
		2,
	)}\n`;
}

function buildProjectMeta(
	input: ExperienceRenderInput,
	world: ExperienceWorld,
): string {
	return `${JSON.stringify(
		{
			version: 1,
			shared: {
				background: world.palette.background,
				range: [0, null],
				size: { x: input.width, y: input.height },
			},
			preview: { fps: input.fps, resolutionScale: 0.5 },
			rendering: {
				fps: input.fps,
				resolutionScale: 1,
				colorSpace: "srgb",
				exporter: {
					name: "@motion-canvas/core/image-sequence",
					options: {
						fileType: "image/png",
						quality: 1,
						groupByScene: false,
					},
				},
				fileType: "image/png",
				quality: 1,
			},
		},
		null,
		2,
	)}\n`;
}

function sceneSource(
	item: ExperienceRenderItem,
	world: ExperienceWorld,
	fps: number,
): string {
	const sceneData = JSON.stringify(item);
	const palette = JSON.stringify(world.palette);
	return `import "@fontsource-variable/noto-sans-jp";
import {Circle, Line, Rect, Txt, makeScene2D} from "@motion-canvas/2d";
import {all, createRef, waitFor} from "@motion-canvas/core";

const item = ${sceneData} as unknown as {id:string;startFrame:number;endFrame:number;text:string;subtitle:string;visual:{props:Record<string,unknown>;action?:string;[key:string]:unknown}};
const palette = ${palette} as const;
const title = String(item.visual.props.title ?? item.id);
const sceneKind = String(item.visual.props.scene_kind ?? "");
const seconds = Math.max(0.1, (item.endFrame - item.startFrame) / ${fps});

export default makeScene2D(function* (view) {
  view.fill(palette.background);
  view.add(<Txt y={-390} width={1600} text={title} fontFamily="Noto Sans JP Variable" fontSize={68} fontWeight={700} fill={palette.text_primary} textAlign="center"/>);
  view.add(<Txt y={475} width={1680} text={item.subtitle} fontFamily="Noto Sans JP Variable" fontSize={38} fill={palette.text_primary} textAlign="center"/>);

  if (sceneKind === "coin_rain") {
    const coins: ReturnType<typeof createRef<Circle>>[] = [];
    const count = Math.min(18, Math.max(8, Number(item.visual.props.coin_count ?? 12)));
    for (let index = 0; index < count; index++) {
      const coin = createRef<Circle>();
      coins.push(coin);
      view.add(<Circle ref={coin} x={-570 + ((index * 97) % 1140)} y={-260 - ((index * 53) % 330)} size={48} fill={palette.coin} stroke={palette.accent_secondary} lineWidth={5}/>);
    }
    view.add(<Rect x={0} y={260} width={690} height={220} fill={palette.surface} stroke={palette.accent_primary} lineWidth={10}/>);
    const host = createRef<Circle>();
    view.add(<Circle ref={host} x={0} y={85} size={145} fill={palette.accent_primary}/>);
    view.add(<Circle x={-28} y={68} size={12} fill={palette.background}/>);
    view.add(<Circle x={28} y={68} size={12} fill={palette.background}/>);
    view.add(<Txt x={0} y={110} text="⌣" fontSize={48} fill={palette.background}/>);
    yield* all(...coins.map((coin, index) => coin().position.y(145 + (index % 3) * 22, seconds * 0.58)));
    yield* all(host().position.y(65, seconds * 0.12), ...coins.map((coin) => coin().scale(0.82, seconds * 0.12)));
    yield* waitFor(seconds * 0.3);
    return;
  }

  if (sceneKind === "per_balloon") {
    const balloon = createRef<Circle>();
    view.add(<Circle ref={balloon} x={0} y={-25} size={220} fill={palette.accent_secondary} stroke={palette.coin} lineWidth={9}/>);
    view.add(<Line points={[[0, 88], [0, 310]]} stroke={palette.accent_secondary} lineWidth={8}/>);
    view.add(<Txt x={0} y={-30} text="PER" fontFamily="Noto Sans JP Variable" fontSize={52} fontWeight={700} fill={palette.background}/>);
    view.add(<Txt x={0} y={120} text={String(item.visual.props.start_per ?? "10") + " → " + String(item.visual.props.end_per ?? "24")} fontFamily="Noto Sans JP Variable" fontSize={46} fill={palette.text_primary}/>);
    yield* all(balloon().width(410, seconds * 0.58), balloon().height(470, seconds * 0.58), balloon().y(-65, seconds * 0.58));
    yield* waitFor(seconds * 0.42);
    return;
  }

  if (sceneKind === "covered_call_tether") {
    const stock = createRef<Circle>();
    const payoff = createRef<Circle>();
    const tether = createRef<Line>();
    view.add(<Line points={[[-520, 220], [-300, 120], [-40, 30], [220, -75], [520, -215]]} stroke={palette.accent_primary} lineWidth={16}/>);
    view.add(<Line points={[[-520, 220], [-260, 165], [20, 95], [300, 22], [520, 22]]} stroke={palette.accent_secondary} lineWidth={14}/>);
    view.add(<Circle ref={stock} x={-520} y={220} size={52} fill={palette.accent_primary}/>);
    view.add(<Circle ref={payoff} x={-520} y={220} size={48} fill={palette.accent_secondary}/>);
    view.add(<Line ref={tether} points={[[0, 0], [0, 0]]} stroke={palette.tether} lineWidth={12}/>);
    view.add(<Txt x={-390} y={-280} text={String(item.visual.props.rise_label ?? "株価")} fontSize={38} fill={palette.accent_primary}/>);
    view.add(<Txt x={365} y={-25} text={String(item.visual.props.cap_label ?? "上値上限")} fontSize={38} fill={palette.accent_secondary}/>);
    yield* all(stock().position([-40, 30], seconds * 0.65), payoff().position([300, 22], seconds * 0.65));
    yield* all(stock().position([520, -215], seconds * 0.35), tether().points([[300, 22], [520, -215]], seconds * 0.35));
    return;
  }

  if (sceneKind === "drawdown_floor") {
    const floor = createRef<Rect>();
    const host = createRef<Circle>();
    view.add(<Rect ref={floor} x={0} y={190} width={1240} height={35} fill={palette.danger}/>);
    view.add(<Circle ref={host} x={0} y={75} size={135} fill={palette.accent_primary}/>);
    view.add(<Circle x={-26} y={58} size={12} fill={palette.background}/>);
    view.add(<Circle x={26} y={58} size={12} fill={palette.background}/>);
    view.add(<Line points={[[-440, -90], [-220, -15], [0, 60], [220, 145], [440, 230]]} stroke={palette.danger} lineWidth={18}/>);
    yield* all(floor().position.y(330, seconds * 0.5), host().position.y(220, seconds * 0.5));
    yield* all(floor().position.y(300, seconds * 0.14), host().position.y(195, seconds * 0.14));
    yield* waitFor(seconds * 0.36);
    return;
  }

  if (sceneKind === "capex_capacity") {
    const factory = createRef<Rect>();
    const conveyor = createRef<Line>();
    const boxes: ReturnType<typeof createRef<Rect>>[] = [];
    view.add(<Rect ref={factory} x={-270} y={55} width={480} height={310} fill={palette.surface} stroke={palette.accent_primary} lineWidth={12} opacity={0}/>);
    view.add(<Line ref={conveyor} points={[[0, 0], [0, 0]]} stroke={palette.accent_secondary} lineWidth={16}/>);
    view.add(<Txt x={-270} y={-10} text="FACTORY" fontFamily="Noto Sans JP Variable" fontSize={44} fill={palette.text_primary}/>);
    for (let index = 0; index < 4; index++) {
      const box = createRef<Rect>();
      boxes.push(box);
      view.add(<Rect ref={box} x={60 + index * 115} y={175} width={72} height={72} fill={palette.coin} opacity={0}/>);
    }
    yield* all(factory().opacity(1, seconds * 0.22), conveyor().points([[-20, 230], [580, 230]], seconds * 0.22));
    yield* all(...boxes.map((box, index) => all(box().opacity(1, 0.08), box().position.x(130 + index * 125, seconds * 0.38))));
    yield* waitFor(seconds * 0.4);
    return;
  }

  view.add(<Txt y={0} text={item.text} fontFamily="Noto Sans JP Variable" fontSize={52} fill={palette.text_primary} textAlign="center"/>);
  yield* waitFor(seconds);
});
`;
}

export function buildMotionCanvasWorkspaceFiles(
	input: ExperienceRenderInput,
	world: ExperienceWorld,
): Record<string, string> {
	const files: Record<string, string> = {
		"package.json": buildMotionCanvasPackageJson(),
		"vite.config.ts": `import {defineConfig} from "vite";\nimport motionCanvas from "@motion-canvas/vite-plugin";\n\nexport default defineConfig({plugins: [motionCanvas({output: "./render-frames"})]});\n`,
		"index.html": `<!doctype html>\n<html lang="ja"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>YT3 Experience Benchmark</title></head><body><script type="module" src="/@id/__x00__virtual:editor"></script></body></html>\n`,
		"tsconfig.json": `{"extends":"@motion-canvas/2d/tsconfig.project.json","compilerOptions":{"moduleResolution":"bundler","skipLibCheck":true,"types":["vite/client"]},"include":["src","node_modules/@motion-canvas/core/project.d.ts"]}\n`,
		"src/project.meta": buildProjectMeta(input, world),
		"src/project.ts": `import {makeProject} from "@motion-canvas/core";\n${input.items
			.map(
				(item, index) =>
					`import scene${index + 1} from "./scenes/${item.id}?scene";`,
			)
			.join(
				"\n",
			)}\n\nexport default makeProject({scenes: [${input.items.map((_, index) => `scene${index + 1}`).join(", ")}]});\n`,
	};

	for (const item of input.items) {
		files[`src/scenes/${item.id}.tsx`] = sceneSource(item, world, input.fps);
	}
	return files;
}
