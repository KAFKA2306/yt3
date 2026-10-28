import {
	AbsoluteFill,
	Composition,
	Img,
	Sequence,
	interpolate,
	spring,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";

export type SceneProps = {
	frame: string;
	text: string;
	data: string;
	chip: string;
	full?: string;
	character: string;
	characterLeft: number;
	characterTop: number;
};

export type VideoProps = {
	width: number;
	height: number;
	fps: number;
	entranceFrames: number;
	scenes: SceneProps[];
};

const layer = (file: string) => (
	<Img
		src={staticFile(file)}
		style={{ position: "absolute", left: 0, top: 0 }}
	/>
);

function Scene({ scene }: { scene: SceneProps }) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	if (scene.full) return layer(scene.full);
	const enter = (delay: number) =>
		spring({ frame: frame - delay, fps, config: { damping: 200 } });
	const rise = (delay: number) => ({
		opacity: enter(delay),
		transform: `translateY(${interpolate(enter(delay), [0, 1], [18, 0])}px)`,
	});
	return (
		<AbsoluteFill>
			<AbsoluteFill style={{ opacity: enter(0) }}>
				{layer(scene.frame)}
			</AbsoluteFill>
			<AbsoluteFill style={rise(4)}>{layer(scene.text)}</AbsoluteFill>
			<AbsoluteFill style={rise(10)}>{layer(scene.data)}</AbsoluteFill>
			<AbsoluteFill style={{ opacity: enter(2) }}>
				{layer(scene.chip)}
			</AbsoluteFill>
			<Img
				src={staticFile(scene.character)}
				style={{
					position: "absolute",
					left: scene.characterLeft,
					top: scene.characterTop,
				}}
			/>
		</AbsoluteFill>
	);
}

function Video({ scenes, entranceFrames }: VideoProps) {
	return (
		<AbsoluteFill>
			{scenes.map((scene, index) => (
				<Sequence
					key={scene.frame}
					from={index * entranceFrames}
					durationInFrames={entranceFrames}
				>
					<Scene scene={scene} />
				</Sequence>
			))}
		</AbsoluteFill>
	);
}

export function Root() {
	return (
		<Composition
			id="ByosanVideo"
			component={Video}
			durationInFrames={1}
			fps={30}
			width={1920}
			height={1080}
			defaultProps={{
				width: 1920,
				height: 1080,
				fps: 30,
				entranceFrames: 30,
				scenes: [],
			}}
			calculateMetadata={({ props }) => ({
				durationInFrames: Math.max(
					1,
					props.scenes.length * props.entranceFrames,
				),
				fps: props.fps,
				width: props.width,
				height: props.height,
			})}
		/>
	);
}
